import type { Express, RequestHandler } from "express";
import multer from "multer";
import path from "path";
import { z } from "zod";
import {
  insertBankQuestionSchema, normalizeTags, MAX_BANK_BULK_ITEMS, type ExtractedQuiz,
} from "@shared/schema";
import {
  buildTemplateCsv, buildTemplateXlsx, parseCsv, parseWorkbook, rowsToBankItems,
  extractDocxText as realExtractDocxText, UnreadableFileError, FileTooLargeError,
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
          if (error instanceof FileTooLargeError) {
            return res.status(400).json({
              message: `The file has too many rows; the limit is ${MAX_BANK_BULK_ITEMS} questions per file. Split it and import in parts.`,
            });
          }
          if (!(error instanceof UnreadableFileError) && !(error instanceof FileTooLargeError)) {
            captureError(error, { scope: "http.import-parse" });
          }
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
