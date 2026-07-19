# Import Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Excel/CSV/Word file upload → strict validation → preview → atomic import into the Question Bank.

**Architecture:** Stateless parse-then-bulk. A new `POST /api/import/parse` endpoint parses the file (xlsx/csv deterministically via a downloadable template; docx via GPT-4o extraction), validates every candidate through `insertBankQuestionSchema`, and returns a `{valid, errors, meta}` preview. The client shows the preview; confirm posts the valid items to the existing `POST /api/bank/questions/bulk` (cap raised 50→200), which re-validates and inserts atomically. No new tables, no migration.

**Tech Stack:** Express 4 + multer (memory), `exceljs` (xlsx read/write), `mammoth` (docx→text), hand-rolled RFC-4180 CSV parser, Zod, OpenAI gpt-4o (existing plumbing), React 18 + shadcn dialog + TanStack Query + react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-19-import-pipeline-design.md` — read it before starting.

## Global Constraints

- Work on branch `feat/import-pipeline` (create from `main` in Task 1).
- Gate before every commit: `npm run check && npm test && npm run build` (from repo root). All three must pass.
- `npm audit --omit=dev` must report **0 vulnerabilities** after adding `exceljs` and `mammoth`. If it doesn't, STOP and report — do not proceed.
- Max **200** questions per import file; bulk endpoint cap becomes **200** (`MAX_BANK_BULK_ITEMS` in `shared/schema.ts`).
- docx is the ONLY lane that calls OpenAI. xlsx/csv never touch it.
- All storage calls go through the existing bulk endpoint's `tctx(req)` path — import code itself never calls storage.
- Never leak answer keys to players: import touches only authenticated bank/import routes; do not modify any game/player route.
- All new user-facing strings exist in BOTH `client/src/locales/en.json` and `ar.json` (Arabic CLDR plural forms `_zero/_one/_two/_few/_many/_other` for count strings).
- OpenAI model stays pinned to `gpt-4o`.
- Error row numbers shown to users match Excel display rows (header = row 1, first data row = 2).

---

### Task 1: Dependencies + shared schema additions

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `shared/schema.ts` (after `generatedQuizSchema`, ~line 368)
- Modify: `server/bank-routes.ts:90-91` (bulk cap)
- Test: `shared/schema.test.ts`, `server/bank-routes.test.ts`

**Interfaces:**
- Consumes: existing `generatedQuizSchema`, `questionSchema`, `insertBankQuestionSchema`.
- Produces: `extractedQuizSchema` (Zod), `type ExtractedQuiz`, `export const MAX_BANK_BULK_ITEMS = 200` — all exported from `@shared/schema`. Bulk endpoint accepts 1..200 items.

- [ ] **Step 1: Create branch**

```bash
git checkout main && git pull && git checkout -b feat/import-pipeline
```

- [ ] **Step 2: Install dependencies and audit**

```bash
npm install exceljs mammoth
npm audit --omit=dev
```

Expected: audit reports **found 0 vulnerabilities**. If not, STOP and report the audit output.

- [ ] **Step 3: Write the failing tests**

Append to `shared/schema.test.ts` (import `extractedQuizSchema` by adding it to the existing import from `./schema`):

```ts
test("extractedQuizSchema allows up to 100 questions; generatedQuizSchema stays capped at 12", () => {
  const q = { question: "q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" };
  const many = { title: "T", description: "", questions: Array.from({ length: 40 }, () => ({ ...q })) };
  assert.equal(extractedQuizSchema.safeParse(many).success, true);
  assert.equal(generatedQuizSchema.safeParse(many).success, false);
  const tooMany = { ...many, questions: Array.from({ length: 101 }, () => ({ ...q })) };
  assert.equal(extractedQuizSchema.safeParse(tooMany).success, false);
});
```

Append to `server/bank-routes.test.ts` (uses the existing `makeApp`/`withServer`/`AUTH`/`VALID_QUESTION` helpers):

```ts
test("bulk: accepts 200 items atomically, rejects 201", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const item = { question: VALID_QUESTION, tags: [] };
    const ok = await fetch(`${base}/api/bank/questions/bulk`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ items: Array.from({ length: 200 }, () => item) }),
    });
    assert.equal(ok.status, 201);
    assert.equal((await ok.json()).created, 200);
    const over = await fetch(`${base}/api/bank/questions/bulk`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ items: Array.from({ length: 201 }, () => item) }),
    });
    assert.equal(over.status, 400);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `extractedQuizSchema` is not exported; the 200-item bulk test fails with 400 (cap is still 50).

- [ ] **Step 5: Implement**

In `shared/schema.ts`, directly after the `GeneratedQuiz` type export (~line 369), add:

```ts
// AI extraction from an uploaded document (Import pipeline). Same shape as
// generatedQuizSchema, but a document can legitimately hold far more than a
// generated quiz's 12 questions; ~100 is the realistic bound for one model
// response.
export const extractedQuizSchema = generatedQuizSchema.extend({
  questions: z.array(questionSchema).min(1).max(100),
});
export type ExtractedQuiz = z.infer<typeof extractedQuizSchema>;

// Shared ceiling for bank bulk-insert and file import (one file = one atomic
// bulk call, so these must match).
export const MAX_BANK_BULK_ITEMS = 200;
```

In `server/bank-routes.ts`: add `MAX_BANK_BULK_ITEMS` to the `@shared/schema` import, then change the bulk guard:

```ts
      if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BANK_BULK_ITEMS) {
        return res.status(400).json({ message: `items must be an array of 1..${MAX_BANK_BULK_ITEMS} bank questions` });
      }
```

- [ ] **Step 6: Run the gate**

Run: `npm run check && npm test && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json shared/schema.ts shared/schema.test.ts server/bank-routes.ts server/bank-routes.test.ts
git commit -m "feat(import): extractedQuizSchema + raise bank bulk cap to 200; add exceljs/mammoth"
```

---

### Task 2: CSV parser (`parseCsv`)

**Files:**
- Create: `server/import-service.ts`
- Test: `server/import-service.test.ts` (create)

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `export function parseCsv(text: string): string[][]` — RFC-4180 parse, BOM-stripped, delimiter (`,` vs `;`) autodetected from the header line, trailing fully-blank rows dropped. Also `export class UnreadableFileError extends Error {}` (used by later tasks).

- [ ] **Step 1: Write the failing tests**

Create `server/import-service.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { parseCsv } = await import("./import-service");

test("parseCsv: plain comma-delimited rows", () => {
  assert.deepEqual(parseCsv("a,b,c\r\n1,2,3\r\n"), [["a", "b", "c"], ["1", "2", "3"]]);
});

test("parseCsv: strips BOM, handles quoted fields with commas, escaped quotes, embedded newlines", () => {
  const csv = '\uFEFFquestion,tags\r\n"What, exactly?","a;b"\r\n"He said ""hi""","line1\nline2"\r\n';
  assert.deepEqual(parseCsv(csv), [
    ["question", "tags"],
    ["What, exactly?", "a;b"],
    ['He said "hi"', "line1\nline2"],
  ]);
});

test("parseCsv: autodetects semicolon delimiter from the header line (Arabic-locale Excel)", () => {
  assert.deepEqual(parseCsv("question;type\nq1;quiz\n"), [["question", "type"], ["q1", "quiz"]]);
});

test("parseCsv: quoted header cells don't confuse delimiter detection", () => {
  assert.deepEqual(parseCsv('"a;x",b\n1,2\n'), [["a;x", "b"], ["1", "2"]]);
});

test("parseCsv: drops trailing fully-blank rows, keeps interior ones", () => {
  assert.deepEqual(parseCsv("a,b\n,\n1,2\n,\n,\n"), [["a", "b"], ["", ""], ["1", "2"]]);
});

test("parseCsv: empty input → no rows", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("\uFEFF"), []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./import-service` module not found.

- [ ] **Step 3: Implement**

Create `server/import-service.ts`:

```ts
// Pure parsing core for the Import pipeline: file bytes/text → rows →
// validated bank items. No HTTP, no storage — everything here is
// unit-testable without a server or files on disk.

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all `parseCsv` tests green).

- [ ] **Step 5: Commit**

```bash
git add server/import-service.ts server/import-service.test.ts
git commit -m "feat(import): RFC-4180 CSV parser with delimiter autodetect"
```

---

### Task 3: Row → bank-item mapping (`rowsToBankItems`)

**Files:**
- Modify: `server/import-service.ts`
- Test: `server/import-service.test.ts`

**Interfaces:**
- Consumes: `insertBankQuestionSchema`, `MAX_BANK_BULK_ITEMS` from `@shared/schema`.
- Produces (all exported from `server/import-service.ts`):
  - `interface ImportRowError { row: number; message: string }`
  - `type ImportBankItem = z.infer<typeof insertBankQuestionSchema>` (i.e. `{ question: Question; subject?: string; tags: string[] }`)
  - `interface ImportParseResult { valid: ImportBankItem[]; errors: ImportRowError[]; totalRows: number }`
  - `const MAX_IMPORT_ROWS = MAX_BANK_BULK_ITEMS`
  - `function rowsToBankItems(rows: string[][], defaults?: { subject?: string; tags?: string[] }): ImportParseResult`
- Error `row` values are Excel display rows (header = 1, first data row = 2). `totalRows` counts non-blank data rows.

- [ ] **Step 1: Write the failing tests**

Append to `server/import-service.test.ts` (add `rowsToBankItems` to the dynamic import destructure):

```ts
const HEADERS = ["question", "type", "answer1", "answer2", "answer3", "answer4", "answer5", "answer6", "correct", "timeLimit", "points", "difficulty", "explanation", "subject", "tags"];

function row(cells: Partial<Record<string, string>>): string[] {
  return HEADERS.map((h) => cells[h] ?? "");
}

test("rowsToBankItems: happy path — single, multi, true/false-with-defaults, poll", () => {
  const res = rowsToBankItems([
    HEADERS,
    row({ question: "Single?", answer1: "a", answer2: "b", answer3: "c", correct: "2", difficulty: "easy", explanation: "b is right", subject: "Math", tags: "alg;basics" }),
    row({ question: "Multi?", answer1: "a", answer2: "b", answer3: "c", correct: "1;3" }),
    row({ question: "Sky is blue.", type: "true_false", correct: "A" }),
    row({ question: "Favourite?", type: "poll", answer1: "x", answer2: "y" }),
  ]);
  assert.equal(res.errors.length, 0);
  assert.equal(res.totalRows, 4);
  const [single, multi, tf, poll] = res.valid.map((v) => v.question);
  assert.deepEqual(single.correctAnswers, [1]);
  assert.equal(single.answerType, "single");
  assert.equal(single.difficulty, "easy");
  assert.equal(res.valid[0].subject, "Math");
  assert.deepEqual(res.valid[0].tags, ["alg", "basics"]);
  assert.deepEqual(multi.correctAnswers, [0, 2]);
  assert.equal(multi.answerType, "multiple");
  assert.equal(tf.type, "true_false");
  assert.deepEqual(tf.answers, ["True", "False"]);
  assert.deepEqual(tf.correctAnswers, [0]);
  assert.equal(poll.type, "poll");
  assert.deepEqual(poll.correctAnswers, []);
});

test("rowsToBankItems: letters, pipes, case-insensitive headers, timeLimit/points parsing", () => {
  const res = rowsToBankItems([
    ["QUESTION", "Type", "Answer1", "answer2", "CORRECT", "timelimit", "Points"],
    ["q?", "quiz", "a", "b", "A|B", "0", "double"],
  ]);
  assert.equal(res.errors.length, 0);
  const q = res.valid[0].question;
  assert.deepEqual(q.correctAnswers, [0, 1]);
  assert.equal(q.timeLimit, 0);
  assert.equal(q.points, "double");
});

test("rowsToBankItems: file-level defaults fill blank subject/tags; row values win", () => {
  const res = rowsToBankItems(
    [
      HEADERS,
      row({ question: "q1?", answer1: "a", answer2: "b", correct: "1" }),
      row({ question: "q2?", answer1: "a", answer2: "b", correct: "1", subject: "Own", tags: "own" }),
    ],
    { subject: "Default", tags: ["d1", "d2"] },
  );
  assert.equal(res.valid[0].subject, "Default");
  assert.deepEqual(res.valid[0].tags, ["d1", "d2"]);
  assert.equal(res.valid[1].subject, "Own");
  assert.deepEqual(res.valid[1].tags, ["own"]);
});

test("rowsToBankItems: per-row errors with Excel row numbers; blank rows skipped silently", () => {
  const res = rowsToBankItems([
    HEADERS,
    row({ question: "good?", answer1: "a", answer2: "b", correct: "1" }),   // row 2
    HEADERS.map(() => ""),                                                   // row 3: blank → skipped
    row({ question: "out of range?", answer1: "a", answer2: "b", correct: "5" }), // row 4
    row({ question: "", answer1: "a", answer2: "b", correct: "1" }),         // row 5: no question text
    row({ question: "bad type?", type: "essay", answer1: "a", answer2: "b", correct: "1" }), // row 6
    row({ question: "no correct?", answer1: "a", answer2: "b" }),            // row 7
    row({ question: "poll with correct?", type: "poll", answer1: "a", answer2: "b", correct: "1" }), // row 8
  ]);
  assert.equal(res.valid.length, 1);
  assert.equal(res.totalRows, 6);
  assert.deepEqual(res.errors.map((e) => e.row), [4, 5, 6, 7, 8]);
  assert.match(res.errors[0].message, /answer 5.*only 2/i);
});

test("rowsToBankItems: missing question column → single header error", () => {
  const res = rowsToBankItems([["type", "answer1"], ["quiz", "a"]]);
  assert.equal(res.valid.length, 0);
  assert.deepEqual(res.errors.map((e) => e.row), [1]);
  assert.match(res.errors[0].message, /question/i);
});

test("rowsToBankItems: duplicate correct tokens dedupe; empty file errors", () => {
  const ok = rowsToBankItems([HEADERS, row({ question: "q?", answer1: "a", answer2: "b", correct: "1;1;A" })]);
  assert.deepEqual(ok.valid[0].question.correctAnswers, [0]);
  const empty = rowsToBankItems([]);
  assert.equal(empty.valid.length, 0);
  assert.equal(empty.errors.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `rowsToBankItems` is not exported.

- [ ] **Step 3: Implement**

Append to `server/import-service.ts` (add these imports at the top of the file):

```ts
import { z } from "zod";
import { insertBankQuestionSchema, MAX_BANK_BULK_ITEMS } from "@shared/schema";
```

Then the mapping code:

```ts
export interface ImportRowError { row: number; message: string }
export type ImportBankItem = z.infer<typeof insertBankQuestionSchema>;
export interface ImportParseResult { valid: ImportBankItem[]; errors: ImportRowError[]; totalRows: number }

export const MAX_IMPORT_ROWS = MAX_BANK_BULK_ITEMS;

// lowercase header cell → canonical column name
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
    for (let k = 1; k <= 6; k++) {
      const a = get(`answer${k}`);
      if (a) answers.push(a);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS. If the poll case fails on `answerType`: polls with zero correct answers map to `answerType: "single"`, which the schema accepts — verify against the actual Zod error before changing anything.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/import-service.ts server/import-service.test.ts
git commit -m "feat(import): row-to-bank-item mapping with friendly per-row errors"
```

---

### Task 4: xlsx parsing + template generation

**Files:**
- Modify: `server/import-service.ts`
- Test: `server/import-service.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `rowsToBankItems`, `UnreadableFileError` (same file).
- Produces (exported from `server/import-service.ts`):
  - `const TEMPLATE_HEADERS: readonly string[]`
  - `async function parseWorkbook(buffer: Buffer): Promise<string[][]>` — first worksheet, cell text only, throws `UnreadableFileError` on corrupt input
  - `async function buildTemplateXlsx(): Promise<Buffer>` — "Questions" sheet (headers + 2 example rows) + "Instructions" sheet
  - `function buildTemplateCsv(): string` — BOM-prefixed CSV of the same headers + examples

- [ ] **Step 1: Write the failing tests**

Append to `server/import-service.test.ts` (extend the dynamic import destructure with `parseWorkbook, buildTemplateXlsx, buildTemplateCsv, UnreadableFileError`):

```ts
test("template xlsx roundtrip: build → parse → map yields 2 valid questions, 0 errors", async () => {
  const buf = await buildTemplateXlsx();
  const rows = await parseWorkbook(buf);
  const res = rowsToBankItems(rows);
  assert.equal(res.errors.length, 0);
  assert.equal(res.valid.length, 2);
  assert.equal(res.valid[0].question.type, "quiz");
  assert.equal(res.valid[1].question.type, "true_false");
});

test("template csv roundtrip: build → parse → map yields 2 valid questions, 0 errors", () => {
  const res = rowsToBankItems(parseCsv(buildTemplateCsv()));
  assert.equal(res.errors.length, 0);
  assert.equal(res.valid.length, 2);
});

test("parseWorkbook: garbage bytes throw UnreadableFileError", async () => {
  await assert.rejects(parseWorkbook(Buffer.from("not an xlsx")), UnreadableFileError);
});

test("parseWorkbook: preserves Arabic text", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.addRow(["question", "answer1", "answer2", "correct"]);
  ws.addRow(["ما هي عاصمة عُمان؟", "مسقط", "صلالة", "1"]);
  const rows = await parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
  const res = rowsToBankItems(rows);
  assert.equal(res.errors.length, 0);
  assert.equal(res.valid[0].question.question, "ما هي عاصمة عُمان؟");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `parseWorkbook` etc. not exported.

- [ ] **Step 3: Implement**

Append to `server/import-service.ts` (add `import ExcelJS from "exceljs";` at the top):

```ts
export const TEMPLATE_HEADERS = [
  "question", "type", "answer1", "answer2", "answer3", "answer4", "answer5", "answer6",
  "correct", "timeLimit", "points", "difficulty", "explanation", "subject", "tags",
] as const;

const EXAMPLE_ROWS: string[][] = [
  ["What is the boiling point of water at sea level?", "quiz", "90°C", "100°C", "110°C", "120°C", "", "",
    "2", "20", "standard", "easy", "Water boils at 100°C at 1 atm.", "Science", "physics;basics"],
  ["The sun rises in the east.", "true_false", "True", "False", "", "", "", "",
    "1", "15", "standard", "easy", "", "Science", ""],
];

const INSTRUCTIONS: string[] = [
  "How to fill the Questions sheet:",
  "- question: required.",
  "- type: quiz (default), true_false, or poll.",
  "- answer1..answer6: 2-6 answers. true_false rows may leave them blank (True/False is assumed).",
  "- correct: answer numbers or letters, e.g. 2 or A;C. Leave empty for poll questions.",
  "- timeLimit: 0 (no limit) or 5-120 seconds. Default 20.",
  "- points: standard or double.",
  "- difficulty: easy, medium, or hard (optional).",
  "- explanation: why the answer is correct (optional, max 500 characters).",
  "- subject and tags are optional; separate tags with ; or |.",
  "- Max 200 questions per file. Delete the example rows before importing.",
];

// First worksheet → rows of cell text. Text only — no formula evaluation, no
// style traversal (the safe subset of exceljs).
export async function parseWorkbook(buffer: Buffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer);
  } catch {
    throw new UnreadableFileError("Could not read this Excel file");
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const colCount = Math.min(ws.columnCount || 0, 40);
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= colCount; c++) {
      cells.push(String(row.getCell(c).text ?? ""));
    }
    rows.push(cells);
  }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  return rows;
}

export async function buildTemplateXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Questions");
  ws.addRow([...TEMPLATE_HEADERS]);
  ws.getRow(1).font = { bold: true };
  for (const r of EXAMPLE_ROWS) ws.addRow(r);
  ws.columns.forEach((c) => { c.width = 18; });
  const inst = wb.addWorksheet("Instructions");
  for (const line of INSTRUCTIONS) inst.addRow([line]);
  inst.getColumn(1).width = 90;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function csvEscape(cell: string): string {
  return /[",;\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

// BOM prefix so Excel opens the file as UTF-8 (matters for Arabic content).
export function buildTemplateCsv(): string {
  const lines = [[...TEMPLATE_HEADERS], ...EXAMPLE_ROWS].map((r) => r.map(csvEscape).join(","));
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/import-service.ts server/import-service.test.ts
git commit -m "feat(import): xlsx parsing + downloadable xlsx/csv templates"
```

---

### Task 5: docx text extraction + AI extraction (`extractQuizFromText`)

**Files:**
- Modify: `server/import-service.ts` (docx → text)
- Modify: `server/openai-service.ts` (shared validated-completion loop + extraction)
- Test: `server/openai-service.test.ts`, `server/import-service.test.ts`

**Interfaces:**
- Consumes: `extractedQuizSchema`, `ExtractedQuiz` from `@shared/schema`; existing `CANONICAL_EXAMPLE`, `getOpenAI`, `mapOpenAiError` in `openai-service.ts`.
- Produces:
  - `server/import-service.ts`: `async function extractDocxText(buffer: Buffer): Promise<string>` — trimmed raw text; throws `UnreadableFileError` on corrupt input.
  - `server/openai-service.ts`: `function buildExtractionPrompt(documentText: string): string`, `function parseExtractedQuiz(raw: unknown): { ok: true; data: ExtractedQuiz } | { ok: false; errors: string }`, `async function extractQuizFromText(documentText: string): Promise<ExtractedQuiz>`.
- Length guards (<50 chars → 400, >50k chars → truncate) live in the ROUTE (Task 6), not here — these functions stay pure text-in/quiz-out.

- [ ] **Step 1: Write the failing tests**

Append to `server/openai-service.test.ts` (add `buildExtractionPrompt, parseExtractedQuiz` to the import from `./openai-service`):

```ts
test("buildExtractionPrompt embeds the document and the extraction rules", () => {
  const p = buildExtractionPrompt("The capital of Oman is Muscat.");
  assert.match(p, /The capital of Oman is Muscat\./);
  assert.match(p, /NEVER invent/i);
  assert.match(p, /original language/i);
  assert.match(p, /SKIP that question/i);
  assert.match(p, /correctAnswers/);
});

test("parseExtractedQuiz accepts 40 questions (beyond the generation cap) and rejects junk", () => {
  const q = { question: "q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" };
  const ok = parseExtractedQuiz({ title: "T", description: "", questions: Array.from({ length: 40 }, () => ({ ...q })) });
  assert.equal(ok.ok, true);
  const bad = parseExtractedQuiz({ title: "", questions: [] });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.ok(bad.errors.length > 0);
});
```

Append to `server/import-service.test.ts` (add `extractDocxText` to the destructure):

```ts
test("extractDocxText: garbage bytes throw UnreadableFileError", async () => {
  await assert.rejects(extractDocxText(Buffer.from("not a docx")), UnreadableFileError);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `buildExtractionPrompt`, `parseExtractedQuiz`, `extractDocxText` not exported.

- [ ] **Step 3: Implement docx extraction**

Append to `server/import-service.ts`:

```ts
// docx → trimmed raw text. Dynamic import mirrors the pdf-parse pattern in
// openai-service.ts (avoids load cost at boot).
export async function extractDocxText(buffer: Buffer): Promise<string> {
  // Resolve the module OUTSIDE the try/catch below: an interop problem
  // (default vs namespace export) must surface as a crash, not be silently
  // misreported as an unreadable user file.
  const mod: any = await import("mammoth");
  const mammoth = mod.default ?? mod;
  try {
    const result = await mammoth.extractRawText({ buffer });
    return (result.value ?? "").trim();
  } catch {
    throw new UnreadableFileError("Could not read this Word document");
  }
}
```

If `npm run check` reports `Could not find a declaration file for module 'mammoth'`, create `server/types/mammoth.d.ts`:

```ts
declare module "mammoth" {
  interface ExtractResult { value: string; messages: unknown[] }
  const mammoth: {
    extractRawText(input: { buffer: Buffer } | { path: string }): Promise<ExtractResult>;
  };
  export default mammoth;
}
```

(Check `tsconfig.json` `include` covers `server/**` — it does; no config change needed.)

- [ ] **Step 4: Implement the extraction path in `server/openai-service.ts`**

First, refactor the existing retry loop so generation and extraction share it. Replace the whole `generateValidated` function (lines 90-117) with:

```ts
// Shared core: prompt → OpenAI → validate → one error-fed retry. Used by both
// quiz GENERATION (create questions about a topic) and quiz EXTRACTION (pull
// existing questions out of an uploaded document).
async function completeValidated<T>(
  basePrompt: string,
  parse: (raw: unknown) => { ok: true; data: T } | { ok: false; errors: string },
  opts: { temperature: number; maxTokens: number },
): Promise<T> {
  let lastErrors = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\n\nYour previous response failed validation: ${lastErrors}\nReturn corrected JSON only.`;
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert educator and quiz creator. Always respond with valid JSON matching the exact schema requested." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    });
    const content = response.choices[0].message.content;
    if (!content) { lastErrors = "empty response"; continue; }
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { lastErrors = "response was not valid JSON"; continue; }
    const parsed = parse(raw);
    if (parsed.ok) return parsed.data;
    lastErrors = parsed.errors;
  }
  throw new Error("Failed to generate a properly formatted quiz. Please try again.");
}

async function generateValidated(kind: "topics" | "content", input: string, sourceTitle?: string): Promise<GeneratedQuiz> {
  return completeValidated(buildGenerationPrompt(kind, input, sourceTitle), parseGeneratedQuiz, {
    temperature: 0.7,
    maxTokens: 3500,
  });
}
```

Then update the schema import at the top of the file:

```ts
import { generatedQuizSchema, extractedQuizSchema, type GeneratedQuiz, type ExtractedQuiz } from "@shared/schema";
```

Then add the extraction exports (place them directly after `parseGeneratedQuiz`):

```ts
export function parseExtractedQuiz(raw: unknown):
  | { ok: true; data: ExtractedQuiz }
  | { ok: false; errors: string } {
  const result = extractedQuizSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.errors
    .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
    .join("; ");
  return { ok: false, errors };
}

export function buildExtractionPrompt(documentText: string): string {
  return `Extract the quiz questions that appear in the following document.

STRICT RULES:
1. Extract ONLY questions that actually exist in the document. NEVER invent new questions.
2. Keep the document's original language (Arabic stays Arabic, English stays English) for questions, answers, and explanations.
3. If the document marks the correct answer (answer key, bold, asterisk, "Answer: B", etc.), use it.
4. If the correct answer is not marked but is unambiguous from the document content, infer it.
5. If a question's correct answer cannot be determined, SKIP that question entirely.
6. NEVER produce poll questions; every question needs at least one correct answer.
7. Set "difficulty" and "explanation" only when the document itself supports them; otherwise omit those fields.
8. Set a quiz-level "subject" and up to 8 "tags" from the document's topic.
9. Each question has 2-6 answers; correctAnswers are 0-based indexes; questions with several correct answers use answerType "multiple".
10. Title the quiz from the document's title or main topic.

Document:
${documentText}

Respond with ONLY valid JSON in exactly this shape:
${CANONICAL_EXAMPLE}`;
}

// Low temperature: extraction is transcription, not creativity. High token
// cap: a document can hold up to 100 questions (extractedQuizSchema's max).
export async function extractQuizFromText(documentText: string): Promise<ExtractedQuiz> {
  try {
    return await completeValidated(buildExtractionPrompt(documentText), parseExtractedQuiz, {
      temperature: 0.2,
      maxTokens: 16000,
    });
  } catch (error: any) {
    console.error("Quiz extraction error:", error);
    throw mapOpenAiError(error, `Failed to extract questions from the document: ${error.message}`);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — including all pre-existing `openai-service` and integration-free generation tests (the refactor must not change generation behavior: same prompts, same temperature 0.7, same max_tokens 3500, same retry message).

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/import-service.ts server/import-service.test.ts server/openai-service.ts server/openai-service.test.ts
git commit -m "feat(import): docx text extraction + gpt-4o extract-don't-invent lane"
```

(Include `server/types/mammoth.d.ts` in the `git add` if you created it.)

---

### Task 6: Import routes + registration

**Files:**
- Create: `server/import-routes.ts`
- Modify: `server/routes.ts` (registration, next to `registerBankRoutes` at line 676)
- Test: `server/import-routes.test.ts` (create)

**Interfaces:**
- Consumes: everything Tasks 2-5 produced; `insertBankQuestionSchema`, `normalizeTags`, `featuresSchema`, `MAX_BANK_BULK_ITEMS`, `ExtractedQuiz` from `@shared/schema`; `captureError` from `./instrument`.
- Produces:

```ts
export interface ImportRouteDeps {
  requireAuth: RequestHandler;
  aiLimiter: RequestHandler;
  hasAiFeature: (req: any) => boolean;
  extractQuizFromText: (text: string) => Promise<ExtractedQuiz>;
  extractDocxText?: (buffer: Buffer) => Promise<string>; // test seam; defaults to the real one
}
export function registerImportRoutes(app: Express, deps: ImportRouteDeps): void;
```

Routes: `GET /api/import/template.xlsx`, `GET /api/import/template.csv`, `POST /api/import/parse` (multipart field `file`, optional string fields `defaultSubject`, `defaultTags`). Parse response: `{ source: "template"|"ai", valid: ImportBankItem[], errors: ImportRowError[], meta: { fileName, totalRows, truncated? } }`.

- [ ] **Step 1: Write the failing tests**

Create `server/import-routes.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

process.env.DATABASE_URL ||= "postgres://user:pass@localhost:5432/test";

const { registerImportRoutes } = await import("./import-routes");
const { buildTemplateXlsx, buildTemplateCsv } = await import("./import-service");
const { extractedQuizSchema } = await import("@shared/schema");

const passThrough = (_req: any, _res: any, next: any) => next();

const fakeExtract = async (_text: string) =>
  extractedQuizSchema.parse({
    title: "Doc",
    description: "",
    subject: "History",
    tags: ["docx"],
    questions: [
      { question: "Extracted?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" },
    ],
  });

// Same harness idiom as bank-routes.test.ts: real express, auth faked via
// x-test-user; AI seams injected so no OpenAI/mammoth is touched.
function makeApp(overrides: Record<string, unknown> = {}) {
  const app = express();
  const requireAuth = (req: any, res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (!uid) return res.status(401).json({ message: "Authentication required" });
    req.authUserId = parseInt(String(uid), 10);
    next();
  };
  registerImportRoutes(app, {
    requireAuth,
    aiLimiter: passThrough,
    hasAiFeature: () => true,
    extractQuizFromText: fakeExtract,
    extractDocxText: async () => "x".repeat(100),
    ...overrides,
  } as any);
  return app;
}

async function withServer(app: express.Express, fn: (base: string) => Promise<void>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const { port } = server.address() as { port: number };
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function upload(base: string, name: string, content: Buffer | string, fields: Record<string, string> = {}, auth = true) {
  const form = new FormData();
  const bytes = typeof content === "string" ? Buffer.from(content) : content;
  form.append("file", new Blob([bytes]), name);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return fetch(`${base}/api/import/parse`, {
    method: "POST",
    headers: auth ? { "x-test-user": "1" } : {},
    body: form,
  });
}

const CSV_HEADER = "question,type,answer1,answer2,answer3,answer4,answer5,answer6,correct,timeLimit,points,difficulty,explanation,subject,tags";

test("import routes: 401 without auth", async () => {
  await withServer(makeApp(), async (base) => {
    assert.equal((await fetch(`${base}/api/import/template.xlsx`)).status, 401);
    assert.equal((await fetch(`${base}/api/import/template.csv`)).status, 401);
    assert.equal((await upload(base, "a.csv", CSV_HEADER, {}, false)).status, 401);
  });
});

test("template downloads: correct content types and parseable bodies", async () => {
  await withServer(makeApp(), async (base) => {
    const xlsx = await fetch(`${base}/api/import/template.xlsx`, { headers: { "x-test-user": "1" } });
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get("content-type") ?? "", /spreadsheetml/);
    assert.ok((await xlsx.arrayBuffer()).byteLength > 0);
    const csv = await fetch(`${base}/api/import/template.csv`, { headers: { "x-test-user": "1" } });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
    assert.match(await csv.text(), /question,type,answer1/);
  });
});

test("parse: template xlsx roundtrip through the endpoint", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "template.xlsx", await buildTemplateXlsx());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, "template");
    assert.equal(body.valid.length, 2);
    assert.equal(body.errors.length, 0);
    assert.equal(body.meta.totalRows, 2);
  });
});

test("parse: csv with bad rows reports Excel row numbers; defaults applied", async () => {
  await withServer(makeApp(), async (base) => {
    const csv = [
      CSV_HEADER,
      "Good?,quiz,a,b,,,,,1,,,,,,",          // row 2: valid, no subject/tags
      "Bad?,quiz,a,b,,,,,9,,,,,,",           // row 3: correct out of range
    ].join("\r\n");
    const res = await upload(base, "quiz.csv", csv, { defaultSubject: "Hist", defaultTags: "a;b" });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.valid.length, 1);
    assert.equal(body.valid[0].subject, "Hist");
    assert.deepEqual(body.valid[0].tags, ["a", "b"]);
    assert.deepEqual(body.errors.map((e: any) => e.row), [3]);
  });
});

test("parse: over 200 data rows → 400 with split message", async () => {
  await withServer(makeApp(), async (base) => {
    const rows = Array.from({ length: 201 }, (_, i) => `Q${i}?,quiz,a,b,,,,,1,,,,,,`);
    const res = await upload(base, "big.csv", [CSV_HEADER, ...rows].join("\n"));
    assert.equal(res.status, 400);
    assert.match((await res.json()).message, /200/);
  });
});

test("parse: disallowed extension → 400; unreadable xlsx → 400 (never 500)", async () => {
  await withServer(makeApp(), async (base) => {
    assert.equal((await upload(base, "notes.txt", "hello")).status, 400);
    assert.equal((await upload(base, "fake.xlsx", "not an xlsx")).status, 400);
  });
});

test("parse: docx lane maps extracted quiz; quiz-level subject/tags used as fallback", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "doc.docx", "binary-ignored-by-fake");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.source, "ai");
    assert.equal(body.valid.length, 1);
    assert.equal(body.valid[0].subject, "History");
    assert.deepEqual(body.valid[0].tags, ["docx"]);
  });
});

test("parse: docx with user defaults overrides extracted subject/tags", async () => {
  await withServer(makeApp(), async (base) => {
    const res = await upload(base, "doc.docx", "x", { defaultSubject: "Mine", defaultTags: "t1" });
    const body = await res.json();
    assert.equal(body.valid[0].subject, "Mine");
    assert.deepEqual(body.valid[0].tags, ["t1"]);
  });
});

test("parse: docx without the AI feature → 403; empty docx text → 400", async () => {
  await withServer(makeApp({ hasAiFeature: () => false }), async (base) => {
    assert.equal((await upload(base, "doc.docx", "x")).status, 403);
  });
  await withServer(makeApp({ extractDocxText: async () => "short" }), async (base) => {
    assert.equal((await upload(base, "doc.docx", "x")).status, 400);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `./import-routes` module not found.

- [ ] **Step 3: Implement `server/import-routes.ts`**

```ts
import type { Express, RequestHandler } from "express";
import multer from "multer";
import path from "path";
import { z } from "zod";
import {
  insertBankQuestionSchema, normalizeTags, MAX_BANK_BULK_ITEMS, type ExtractedQuiz,
} from "@shared/schema";
import {
  buildTemplateCsv, buildTemplateXlsx, parseCsv, parseWorkbook, rowsToBankItems,
  extractDocxText as realExtractDocxText, UnreadableFileError,
  type ImportBankItem, type ImportRowError,
} from "./import-service";
import { captureError } from "./instrument";

// Import routes follow the bank-routes pattern: injected deps so the whole
// module is HTTP-testable without a database, OpenAI, or real files. The AI
// lane (docx) is the only path that spends tokens; xlsx/csv are deterministic.
export interface ImportRouteDeps {
  requireAuth: RequestHandler;
  aiLimiter: RequestHandler;
  hasAiFeature: (req: any) => boolean;
  extractQuizFromText: (text: string) => Promise<ExtractedQuiz>;
  extractDocxText?: (buffer: Buffer) => Promise<string>;
}

const EXTENSIONS = new Set([".xlsx", ".csv", ".docx"]);
const MIMETYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream", // browsers on Windows commonly report this
]);

const defaultsSchema = z.object({
  defaultSubject: z.string().trim().max(100).optional().transform((s) => (s ? s : undefined)),
  defaultTags: z.string().max(1000).optional(),
});

const MIN_DOCX_TEXT = 50;
const MAX_DOCX_TEXT = 50_000;

export function registerImportRoutes(app: Express, deps: ImportRouteDeps): void {
  const { requireAuth, aiLimiter, hasAiFeature, extractQuizFromText } = deps;
  const extractDocx = deps.extractDocxText ?? realExtractDocxText;

  const importUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (EXTENSIONS.has(ext) && MIMETYPES.has(file.mimetype)) cb(null, true);
      else cb(new Error("Only .xlsx, .csv, or .docx files are allowed"));
    },
  });
  // Route multer failures (size/type) to a 400, not the default error handler.
  const uploadSingle: RequestHandler = (req, res, next) =>
    importUpload.single("file")(req, res, (err: any) => {
      if (err) return res.status(400).json({ message: err.message || "Upload failed" });
      next();
    });

  app.get("/api/import/template.xlsx", requireAuth, async (_req, res) => {
    try {
      const buf = await buildTemplateXlsx();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="question-import-template.xlsx"');
      res.send(buf);
    } catch (error) {
      captureError(error, { scope: "http.import-template" });
      res.status(500).json({ message: "Failed to build the template" });
    }
  });

  app.get("/api/import/template.csv", requireAuth, (_req, res) => {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="question-import-template.csv"');
    res.send(buildTemplateCsv());
  });

  app.post("/api/import/parse", aiLimiter, requireAuth, uploadSingle, async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const parsedDefaults = defaultsSchema.safeParse(req.body ?? {});
      if (!parsedDefaults.success) {
        return res.status(400).json({ message: "Invalid defaults", errors: parsedDefaults.error.errors });
      }
      const defaults = {
        subject: parsedDefaults.data.defaultSubject,
        tags: normalizeTags((parsedDefaults.data.defaultTags ?? "").split(/[;,|]/)).slice(0, 20),
      };
      const ext = path.extname(req.file.originalname).toLowerCase();

      if (ext === ".xlsx" || ext === ".csv") {
        let rows: string[][];
        try {
          rows = ext === ".xlsx" ? await parseWorkbook(req.file.buffer) : parseCsv(req.file.buffer.toString("utf8"));
        } catch (error) {
          if (!(error instanceof UnreadableFileError)) captureError(error, { scope: "http.import-parse" });
          return res.status(400).json({ message: "Could not read this file. Use the downloaded template as a starting point." });
        }
        const result = rowsToBankItems(rows, defaults);
        if (result.totalRows > MAX_BANK_BULK_ITEMS) {
          return res.status(400).json({
            message: `The file has ${result.totalRows} questions; the limit is ${MAX_BANK_BULK_ITEMS} per file. Split it and import in parts.`,
          });
        }
        return res.json({
          source: "template",
          valid: result.valid,
          errors: result.errors,
          meta: { fileName: req.file.originalname, totalRows: result.totalRows },
        });
      }

      // .docx — AI lane (feature-gated like the generate-quiz routes).
      if (!hasAiFeature(req)) {
        return res.status(403).json({ message: "This feature is not enabled for your organization" });
      }
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server" });
      }
      let text: string;
      try {
        text = await extractDocx(req.file.buffer);
      } catch (error) {
        if (!(error instanceof UnreadableFileError)) captureError(error, { scope: "http.import-parse" });
        return res.status(400).json({ message: "Could not read this Word document." });
      }
      if (text.length < MIN_DOCX_TEXT) {
        return res.status(400).json({ message: "The document appears to be empty or has no readable text." });
      }
      const truncated = text.length > MAX_DOCX_TEXT;
      const quiz = await extractQuizFromText(truncated ? text.slice(0, MAX_DOCX_TEXT) : text);
      const valid: ImportBankItem[] = [];
      const errors: ImportRowError[] = [];
      quiz.questions.forEach((q, i) => {
        const parsed = insertBankQuestionSchema.safeParse({
          question: q,
          subject: defaults.subject ?? quiz.subject,
          tags: defaults.tags.length > 0 ? defaults.tags : quiz.tags,
        });
        if (parsed.success) valid.push(parsed.data);
        else errors.push({ row: i + 1, message: parsed.error.errors.map((e) => e.message).join("; ") });
      });
      return res.json({
        source: "ai",
        valid,
        errors,
        meta: { fileName: req.file.originalname, totalRows: quiz.questions.length, truncated: truncated || undefined },
      });
    } catch (error: any) {
      captureError(error, { scope: "http.import-parse" });
      res.status(500).json({ message: error?.message || "Failed to import questions" });
    }
  });
}
```

- [ ] **Step 4: Register in `server/routes.ts`**

Add imports near the `registerBankRoutes` import (line 20):

```ts
import { registerImportRoutes } from "./import-routes";
import { extractQuizFromText } from "./openai-service";
import { featuresSchema } from "@shared/schema";
```

(Check the file's existing imports first — `featuresSchema` may already be imported; `openai-service` already has an import line to extend.)

Directly after `registerBankRoutes(app, { storage, requireAuth, tctx });` (line 676):

```ts
  registerImportRoutes(app, {
    requireAuth,
    aiLimiter,
    // Same semantics as requireFeature("aiGeneration") in tenant.ts, exposed
    // as a predicate because only the docx lane of the parse route is gated.
    hasAiFeature: (req) => {
      try {
        return featuresSchema.parse((req.tenant?.features as object) ?? {}).aiGeneration === true;
      } catch {
        return false;
      }
    },
    extractQuizFromText,
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all import-routes tests green, nothing else broken.

- [ ] **Step 6: Run the gate and commit**

Run: `npm run check && npm test && npm run build` — all pass, then:

```bash
git add server/import-routes.ts server/import-routes.test.ts server/routes.ts
git commit -m "feat(import): parse + template endpoints with injected AI seams"
```

---

### Task 7: i18n strings (EN + AR)

**Files:**
- Modify: `client/src/locales/en.json` (inside the `"bank"` object, after `"explanationLabel"`)
- Modify: `client/src/locales/ar.json` (same position in its `"bank"` object)

**Interfaces:**
- Produces: the `bank.import.*` keys consumed by Task 8's `ImportDialog`. Key names below are exact — Task 8 uses them verbatim.

- [ ] **Step 1: Add the EN keys**

Inside the `"bank": { ... }` object in `client/src/locales/en.json`, add (mind the comma on the preceding key):

```json
"import": {
  "button": "Import",
  "title": "Import questions",
  "uploadHint": "Upload an Excel (.xlsx), CSV, or Word (.docx) file.",
  "wordAiNote": "Word documents are read by AI — review the preview carefully before importing.",
  "templateLabel": "Download template:",
  "templateXlsx": "Excel template",
  "templateCsv": "CSV template",
  "defaultSubjectLabel": "Default subject (optional)",
  "defaultTagsLabel": "Default tags (optional)",
  "chooseFile": "Choose file",
  "dropHere": "…or drag and drop it here",
  "selectedFile": "Selected: {{name}}",
  "parse": "Upload & preview",
  "parsing": "Reading file…",
  "parsingAi": "Extracting questions with AI — this can take up to a minute…",
  "validCount_one": "{{count}} valid question",
  "validCount_other": "{{count}} valid questions",
  "errorCount_one": "{{count}} error",
  "errorCount_other": "{{count}} errors",
  "rowLabel": "Row {{row}}",
  "questionLabel": "Question {{row}}",
  "fixHint": "Fix these rows in your source file and upload it again.",
  "truncatedNote": "The document was long; only the first part was read.",
  "noValid": "No valid questions found in this file.",
  "back": "Back",
  "importCount_one": "Import {{count}} question",
  "importCount_other": "Import {{count}} questions",
  "importing": "Importing…",
  "importedToast_one": "{{count}} question imported",
  "importedToast_other": "{{count}} questions imported",
  "importFailedTitle": "Import failed",
  "parseFailedTitle": "Could not read the file"
}
```

- [ ] **Step 2: Add the AR keys**

Inside the `"bank": { ... }` object in `client/src/locales/ar.json`, add:

```json
"import": {
  "button": "استيراد",
  "title": "استيراد أسئلة",
  "uploadHint": "ارفع ملف Excel ‏(.xlsx) أو CSV أو Word ‏(.docx).",
  "wordAiNote": "تُقرأ ملفات Word بالذكاء الاصطناعي — راجع المعاينة بعناية قبل الاستيراد.",
  "templateLabel": "تنزيل القالب:",
  "templateXlsx": "قالب Excel",
  "templateCsv": "قالب CSV",
  "defaultSubjectLabel": "المادة الافتراضية (اختياري)",
  "defaultTagsLabel": "الوسوم الافتراضية (اختياري)",
  "chooseFile": "اختر ملفًا",
  "dropHere": "…أو اسحب الملف وأفلته هنا",
  "selectedFile": "الملف المحدد: {{name}}",
  "parse": "رفع ومعاينة",
  "parsing": "جارٍ قراءة الملف…",
  "parsingAi": "جارٍ استخراج الأسئلة بالذكاء الاصطناعي — قد يستغرق ذلك دقيقة…",
  "validCount_zero": "لا أسئلة صالحة",
  "validCount_one": "سؤال واحد صالح",
  "validCount_two": "سؤالان صالحان",
  "validCount_few": "{{count}} أسئلة صالحة",
  "validCount_many": "{{count}} سؤالًا صالحًا",
  "validCount_other": "{{count}} سؤال صالح",
  "errorCount_zero": "لا أخطاء",
  "errorCount_one": "خطأ واحد",
  "errorCount_two": "خطآن",
  "errorCount_few": "{{count}} أخطاء",
  "errorCount_many": "{{count}} خطأً",
  "errorCount_other": "{{count}} خطأ",
  "rowLabel": "الصف {{row}}",
  "questionLabel": "السؤال {{row}}",
  "fixHint": "صحّح هذه الصفوف في الملف الأصلي ثم ارفعه مرة أخرى.",
  "truncatedNote": "المستند طويل؛ تمت قراءة الجزء الأول منه فقط.",
  "noValid": "لم يتم العثور على أسئلة صالحة في هذا الملف.",
  "back": "رجوع",
  "importCount_zero": "لا شيء للاستيراد",
  "importCount_one": "استيراد سؤال واحد",
  "importCount_two": "استيراد سؤالين",
  "importCount_few": "استيراد {{count}} أسئلة",
  "importCount_many": "استيراد {{count}} سؤالًا",
  "importCount_other": "استيراد {{count}} سؤال",
  "importing": "جارٍ الاستيراد…",
  "importedToast_zero": "لم يتم استيراد أي سؤال",
  "importedToast_one": "تم استيراد سؤال واحد",
  "importedToast_two": "تم استيراد سؤالين",
  "importedToast_few": "تم استيراد {{count}} أسئلة",
  "importedToast_many": "تم استيراد {{count}} سؤالًا",
  "importedToast_other": "تم استيراد {{count}} سؤال",
  "importFailedTitle": "فشل الاستيراد",
  "parseFailedTitle": "تعذّرت قراءة الملف"
}
```

- [ ] **Step 3: Verify JSON validity and commit**

Run: `npm run check && npm run build`
Expected: build passes (Vite parses both locale files; a stray comma fails the build).

```bash
git add client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(import): EN+AR strings for the import dialog (Arabic CLDR plurals)"
```

---

### Task 8: `ImportDialog` component

**Files:**
- Create: `client/src/components/bank/ImportDialog.tsx`

**Interfaces:**
- Consumes: `bank.import.*` i18n keys (Task 7), `POST /api/import/parse`, `GET /api/import/template.{xlsx,csv}`, `POST /api/bank/questions/bulk` (Task 6/1); `TagInput` (`{value, onChange, suggestions, placeholder?}`); `apiRequest`/`buildApiUrl` from `@/lib/queryClient`; shadcn `Dialog/Button/Input/Label/Badge`; `useToast`.
- Produces: `export function ImportDialog(props: { open: boolean; onOpenChange: (open: boolean) => void; meta: { subjects: string[]; tags: string[] }; onImported: () => void })` — consumed by Task 9.

- [ ] **Step 1: Implement the component**

Create `client/src/components/bank/ImportDialog.tsx`:

```tsx
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, FileUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { TagInput } from "@/components/bank/TagInput";
import type { Question } from "@shared/schema";

interface ImportItem { question: Question; subject?: string; tags: string[] }
interface ImportPreview {
  source: "template" | "ai";
  valid: ImportItem[];
  errors: Array<{ row: number; message: string }>;
  meta: { fileName: string; totalRows: number; truncated?: boolean };
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: { subjects: string[]; tags: string[] };
  onImported: () => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Three-step import: upload (+ optional file-level defaults) → server-parsed
// preview (valid questions + per-row errors) → confirm posts the valid items
// to the existing bulk endpoint (atomic; server re-validates every item).
export function ImportDialog({ open, onOpenChange, meta, onImported }: ImportDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [defaultSubject, setDefaultSubject] = useState("");
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const isDocx = !!file && file.name.toLowerCase().endsWith(".docx");

  const reset = () => {
    setFile(null); setDefaultSubject(""); setDefaultTags([]); setPreview(null);
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = async (kind: "xlsx" | "csv") => {
    const res = await fetch(buildApiUrl(`/api/import/template.${kind}`), { credentials: "include" });
    if (!res.ok) {
      toast({ title: t("bank.import.parseFailedTitle"), variant: "destructive" });
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `question-import-template.${kind}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runParse = async () => {
    if (!file) return;
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (defaultSubject.trim()) form.append("defaultSubject", defaultSubject.trim());
      if (defaultTags.length) form.append("defaultTags", defaultTags.join(";"));
      const res = await fetch(buildApiUrl("/api/import/parse"), { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).message || t("bank.import.parseFailedTitle"));
      }
      setPreview(await res.json());
    } catch (e: any) {
      toast({ title: t("bank.import.parseFailedTitle"), description: e?.message, variant: "destructive" });
    } finally {
      setParsing(false);
    }
  };

  const runImport = async () => {
    if (!preview || preview.valid.length === 0) return;
    setImporting(true);
    try {
      await apiRequest("POST", "/api/bank/questions/bulk", { items: preview.valid });
      toast({ title: t("bank.import.importedToast", { count: preview.valid.length }) });
      onImported();
      close(false);
    } catch (e: any) {
      toast({ title: t("bank.import.importFailedTitle"), description: e?.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const typeKey = (q: Question) =>
    q.type === "true_false" ? "editor.question.typeTrueFalse"
      : q.type === "poll" ? "editor.question.typePoll"
      : "editor.question.typeQuiz";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("bank.import.title")}</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t("bank.import.uploadHint")}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t("bank.import.templateLabel")}</span>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate("xlsx")} data-testid="button-template-xlsx">
                <Download className="w-4 h-4 me-1" /> {t("bank.import.templateXlsx")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate("csv")} data-testid="button-template-csv">
                <Download className="w-4 h-4 me-1" /> {t("bank.import.templateCsv")}
              </Button>
            </div>

            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
              data-testid="import-dropzone"
            >
              <FileUp className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              {file ? (
                <p className="text-sm font-medium">{t("bank.import.selectedFile", { name: file.name })}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{t("bank.import.chooseFile")}</p>
                  <p className="text-xs text-gray-500">{t("bank.import.dropHere")}</p>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,.docx"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="input-import-file"
              />
            </div>
            {isDocx && <p className="text-xs text-amber-700">{t("bank.import.wordAiNote")}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="import-default-subject">{t("bank.import.defaultSubjectLabel")}</Label>
                <Input
                  id="import-default-subject"
                  value={defaultSubject}
                  onChange={(e) => setDefaultSubject(e.target.value)}
                  maxLength={100}
                  list="import-subject-suggestions"
                />
                <datalist id="import-subject-suggestions">
                  {meta.subjects.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <Label>{t("bank.import.defaultTagsLabel")}</Label>
                <TagInput value={defaultTags} onChange={setDefaultTags} suggestions={meta.tags} />
              </div>
            </div>

            <DialogFooter>
              <Button onClick={runParse} disabled={!file || parsing} data-testid="button-import-parse">
                {parsing && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
                {parsing ? (isDocx ? t("bank.import.parsingAi") : t("bank.import.parsing")) : t("bank.import.parse")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              {t("bank.import.validCount", { count: preview.valid.length })}
              {" · "}
              {t("bank.import.errorCount", { count: preview.errors.length })}
            </p>
            {preview.meta.truncated && <p className="text-xs text-amber-700">{t("bank.import.truncatedNote")}</p>}

            {preview.errors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-md p-3 max-h-40 overflow-y-auto space-y-1">
                {preview.errors.map((err, i) => (
                  <p key={i} className="text-sm text-red-700">
                    <span className="font-medium">
                      {t(preview.source === "template" ? "bank.import.rowLabel" : "bank.import.questionLabel", { row: err.row })}
                    </span>
                    {": "}{err.message}
                  </p>
                ))}
                <p className="text-xs text-red-600">{t("bank.import.fixHint")}</p>
              </div>
            )}

            {preview.valid.length === 0 ? (
              <p className="text-sm text-gray-600">{t("bank.import.noValid")}</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {preview.valid.map((item, i) => (
                  <details key={i} className="border rounded-md p-2">
                    <summary className="cursor-pointer text-sm">
                      <Badge variant="secondary" className="me-1">{t(typeKey(item.question))}</Badge>
                      {item.question.difficulty && (
                        <Badge variant="outline" className="me-1">{t(`bank.difficulty${cap(item.question.difficulty)}`)}</Badge>
                      )}
                      {item.question.question}
                    </summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {item.question.answers.map((a, ai) => (
                        <li key={ai} className={item.question.correctAnswers.includes(ai) ? "text-green-700 font-medium" : "text-gray-600"}>
                          {item.question.correctAnswers.includes(ai) ? "✓ " : ""}{a}
                        </li>
                      ))}
                    </ul>
                    {(item.subject || item.tags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.subject && <Badge variant="default">{item.subject}</Badge>}
                        {item.tags.map((tg) => <Badge key={tg} variant="outline">{tg}</Badge>)}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} data-testid="button-import-back">
                {t("bank.import.back")}
              </Button>
              <Button
                onClick={runImport}
                disabled={preview.valid.length === 0 || importing}
                data-testid="button-import-confirm"
              >
                {importing && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
                {importing ? t("bank.import.importing") : t("bank.import.importCount", { count: preview.valid.length })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Type check**

Run: `npm run check`
Expected: PASS. If `buildApiUrl` is not exported from `@/lib/queryClient`, find its actual home with `grep -rn "export function buildApiUrl" client/src` and import from there (quiz-editor.tsx line 355 uses it — copy that file's import).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/bank/ImportDialog.tsx
git commit -m "feat(import): three-step import dialog (upload -> preview -> confirm)"
```

---

### Task 9: Question Bank page wiring + full gate

**Files:**
- Modify: `client/src/pages/question-bank.tsx`

**Interfaces:**
- Consumes: `ImportDialog` from Task 8; existing `invalidate` helper and `meta` query on the page.

- [ ] **Step 1: Wire the dialog**

In `client/src/pages/question-bank.tsx`:

1. Add to imports: `Upload` in the existing lucide import (line 13), and

```tsx
import { ImportDialog } from "@/components/bank/ImportDialog";
```

2. Add state next to the other dialog state (line 32):

```tsx
  const [importOpen, setImportOpen] = useState(false);
```

3. In the header actions `div` (line 97-104), add an Import button BEFORE the New-question button:

```tsx
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-bank">
              <Upload className="w-4 h-4 me-1" /> {t("bank.import.button")}
            </Button>
```

4. Next to the existing `<BankQuestionDialog … />` (line 198), render:

```tsx
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          meta={meta ?? { subjects: [], tags: [] }}
          onImported={invalidate}
        />
```

- [ ] **Step 2: Run the full gate**

Run: `npm run check && npm test && npm run build`
Expected: all pass (type check clean, full server/shared suite green, client builds with both locales).

- [ ] **Step 3: Audit re-check**

Run: `npm audit --omit=dev`
Expected: 0 vulnerabilities.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/question-bank.tsx
git commit -m "feat(import): Import button on the Question Bank page"
```

---

### Task 10: Push branch + PR

- [ ] **Step 1: Push and open the PR**

```bash
git push -u origin feat/import-pipeline
gh pr create --title "feat: Import pipeline — xlsx/csv template + docx AI extraction into Question Bank" --body "Implements docs/superpowers/specs/2026-07-19-import-pipeline-design.md.

- Template lane: downloadable xlsx/csv template, deterministic RFC-4180/exceljs parsing, per-row Excel-numbered errors
- AI lane: docx -> mammoth -> gpt-4o extract-don't-invent -> extractedQuizSchema (1..100)
- Stateless preview: POST /api/import/parse returns {valid, errors, meta}; confirm re-uses POST /api/bank/questions/bulk (cap 50 -> 200, atomic)
- Three-step ImportDialog on /question-bank, full EN+AR (Arabic CLDR plurals)
- No migration; no new tables; deps exceljs + mammoth (audit clean)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 2: Report for review**

Whole-branch review + browser QA happen OUTSIDE this plan (per the session working method): reviewer pass over the full diff, then browser QA with the user (template xlsx EN+AR content, csv with deliberate bad rows checking row numbers, real docx through live GPT-4o) before merge.
