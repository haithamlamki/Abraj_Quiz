// Pure parsing core for the Import pipeline: file bytes/text → rows →
// validated bank items. No HTTP, no storage — everything here is
// unit-testable without a server or files on disk.

import { z } from "zod";
import { insertBankQuestionSchema, MAX_BANK_BULK_ITEMS } from "@shared/schema";

export class UnreadableFileError extends Error {}

// RFC-4180 CSV: quoted fields ("" escapes a quote, newlines allowed inside
// quotes), CRLF or LF endings, UTF-8 BOM tolerated. Delimiter (, vs ;) is
// autodetected from the header line because Arabic-locale Excel exports
// semicolon-delimited CSV.
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!src) return [];
  const nl = src.indexOf("\n");
  const headerLine = (nl === -1 ? src : src.slice(0, nl)).replace(/"[^"]*"/g, "");
  const semis = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  const delim = semis > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

export interface ImportRowError { row: number; message: string }
export type ImportBankItem = z.infer<typeof insertBankQuestionSchema>;
export interface ImportParseResult { valid: ImportBankItem[]; errors: ImportRowError[]; totalRows: number }

export const MAX_IMPORT_ROWS = MAX_BANK_BULK_ITEMS;

// lowercase header cell -> canonical column name
const COLUMNS: Record<string, string> = {
  question: "question", type: "type",
  answer1: "answer1", answer2: "answer2", answer3: "answer3",
  answer4: "answer4", answer5: "answer5", answer6: "answer6",
  correct: "correct", timelimit: "timeLimit", points: "points",
  difficulty: "difficulty", explanation: "explanation",
  subject: "subject", tags: "tags",
};

const TYPES: Record<string, "quiz" | "true_false" | "poll"> = {
  quiz: "quiz", true_false: "true_false", "true/false": "true_false", truefalse: "true_false", poll: "poll",
};

const LETTERS = "abcdef";

function splitMulti(cell: string): string[] {
  return cell.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
}

// Map spreadsheet rows (header + data) to validated bank items. Two-layer
// validation: friendly cell-level messages first, then the canonical
// insertBankQuestionSchema so nothing can bypass the shared rules. Error rows
// are Excel display rows (header = 1, first data row = 2).
export function rowsToBankItems(
  rows: string[][],
  defaults: { subject?: string; tags?: string[] } = {},
): ImportParseResult {
  const valid: ImportBankItem[] = [];
  const errors: ImportRowError[] = [];
  if (rows.length === 0) {
    return { valid, errors: [{ row: 1, message: "The file is empty" }], totalRows: 0 };
  }

  const headerIdx = new Map<string, number>();
  rows[0].forEach((raw, i) => {
    const canonical = COLUMNS[raw.trim().toLowerCase()];
    if (canonical && !headerIdx.has(canonical)) headerIdx.set(canonical, i);
  });
  if (!headerIdx.has("question")) {
    return {
      valid,
      errors: [{ row: 1, message: 'Missing required column "question" — download the template for the expected layout' }],
      totalRows: 0,
    };
  }

  let totalRows = 0;
  for (let i = 1; i < rows.length; i++) {
    const displayRow = i + 1;
    const cells = rows[i];
    const get = (name: string): string => {
      const idx = headerIdx.get(name);
      return idx === undefined ? "" : (cells[idx] ?? "").trim();
    };
    if (cells.every((c) => c.trim() === "")) continue; // blank row
    totalRows++;

    const rowErrors: string[] = [];

    const questionText = get("question");
    if (!questionText) rowErrors.push("Question text is required");

    const typeRaw = get("type").toLowerCase();
    const type = typeRaw === "" ? "quiz" : TYPES[typeRaw];
    if (!type) rowErrors.push(`Unknown type "${get("type")}" (use quiz, true_false, or poll)`);

    let answers: string[] = [];
    let gapAt: number | null = null;
    for (let k = 1; k <= 6; k++) {
      const a = get(`answer${k}`);
      if (a) {
        if (answers.length !== k - 1 && gapAt === null) gapAt = k;
        answers.push(a);
      }
    }
    if (gapAt !== null) {
      rowErrors.push(`Answer columns must be filled in order starting at answer1 (answer${gapAt} is filled but an earlier answer column is empty)`);
    }
    if (type === "true_false" && answers.length === 0) answers = ["True", "False"];

    const correctTokens = splitMulti(get("correct"));
    const correctAnswers: number[] = [];
    for (const tok of correctTokens) {
      const letterIdx = tok.length === 1 ? LETTERS.indexOf(tok.toLowerCase()) : -1;
      let idx: number | null = null;
      if (letterIdx >= 0) idx = letterIdx;
      else if (/^\d+$/.test(tok)) idx = parseInt(tok, 10) - 1;
      if (idx === null || idx < 0) {
        rowErrors.push(`Invalid correct value "${tok}" (use numbers like 1;3 or letters like A;C)`);
      } else if (idx >= answers.length) {
        rowErrors.push(`"correct" refers to answer ${idx + 1} but only ${answers.length} answers are filled`);
      } else if (!correctAnswers.includes(idx)) {
        correctAnswers.push(idx);
      }
    }
    if (type === "poll" && correctTokens.length > 0) {
      rowErrors.push("Poll questions cannot have a correct answer");
    }
    if (type !== "poll" && type !== undefined && correctTokens.length === 0) {
      rowErrors.push("Mark at least one correct answer in the \"correct\" column");
    }

    const timeRaw = get("timeLimit");
    let timeLimit = 20;
    if (timeRaw !== "") {
      if (/^\d+$/.test(timeRaw)) timeLimit = parseInt(timeRaw, 10);
      else rowErrors.push(`"timeLimit" must be a whole number of seconds (got "${timeRaw}")`);
    }

    const pointsRaw = get("points").toLowerCase();
    const points = pointsRaw === "" ? "standard" : pointsRaw === "standard" || pointsRaw === "double" ? pointsRaw : null;
    if (points === null) rowErrors.push(`"points" must be standard or double (got "${get("points")}")`);

    const diffRaw = get("difficulty").toLowerCase();
    const difficulty = diffRaw === "" ? undefined : diffRaw === "easy" || diffRaw === "medium" || diffRaw === "hard" ? diffRaw : null;
    if (difficulty === null) rowErrors.push(`"difficulty" must be easy, medium, or hard (got "${get("difficulty")}")`);

    if (rowErrors.length > 0) {
      errors.push({ row: displayRow, message: rowErrors.join("; ") });
      continue;
    }

    const rowTags = splitMulti(get("tags"));
    const candidate = {
      question: {
        question: questionText,
        type,
        answerType: correctAnswers.length > 1 ? "multiple" : "single",
        answers,
        correctAnswers,
        timeLimit,
        points,
        difficulty,
        explanation: get("explanation") || undefined,
      },
      subject: get("subject") || defaults.subject || undefined,
      tags: rowTags.length > 0 ? rowTags : defaults.tags ?? [],
    };
    const parsed = insertBankQuestionSchema.safeParse(candidate);
    if (parsed.success) {
      valid.push(parsed.data);
    } else {
      errors.push({
        row: displayRow,
        message: parsed.error.errors.map((e) => e.message).join("; "),
      });
    }
  }
  return { valid, errors, totalRows };
}
