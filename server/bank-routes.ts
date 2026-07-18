import type { Express } from "express";
import { z } from "zod";
import { insertBankQuestionSchema } from "@shared/schema";
import type { IStorage, StorageCtx } from "./storage";
import { captureError } from "./instrument";

// Bank routes live in their own module with injected deps (storage,
// requireAuth, tctx are closures inside registerRoutes) so they can be
// unit-tested over HTTP against MemStorage without a database.
export interface BankRouteDeps {
  storage: IStorage;
  requireAuth: (req: any, res: any, next: any) => void;
  tctx: (req: any) => StorageCtx;
}

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  subject: z.string().max(100).optional(),
  tags: z.string().max(500).optional(), // comma-separated
  archived: z.string().optional(),
});

// PUT accepts partial updates; each present field is fully validated.
// Subject override: present-but-empty means "clear it" (null); absent means
// "leave unchanged" — the insert schema's empty→undefined transform would
// silently no-op a clear.
const updateBankQuestionSchema = insertBankQuestionSchema.partial().extend({
  subject: z
    .string()
    .trim()
    .max(100)
    .transform((s) => (s ? s : null))
    .optional(),
});

function parseId(raw: string): number | null {
  const id = parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function registerBankRoutes(app: Express, { storage, requireAuth, tctx }: BankRouteDeps): void {
  app.get("/api/bank/questions", requireAuth, async (req, res) => {
    try {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid query", errors: parsed.error.errors });
      }
      const rows = await storage.getBankQuestions(tctx(req), {
        search: parsed.data.search,
        subject: parsed.data.subject,
        tags: parsed.data.tags ? parsed.data.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
        archived: parsed.data.archived === "1" || parsed.data.archived === "true",
      });
      res.json(rows);
    } catch (error) {
      captureError(error, { scope: "http.bank-list" });
      res.status(500).json({ message: "Failed to fetch bank questions" });
    }
  });

  app.get("/api/bank/questions/meta", requireAuth, async (req, res) => {
    try {
      res.json(await storage.getBankSubjectsAndTags(tctx(req)));
    } catch (error) {
      captureError(error, { scope: "http.bank-meta" });
      res.status(500).json({ message: "Failed to fetch bank metadata" });
    }
  });

  app.post("/api/bank/questions", requireAuth, async (req, res) => {
    try {
      const validation = insertBankQuestionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid bank question", errors: validation.error.errors });
      }
      const row = await storage.createBankQuestion(tctx(req), {
        ...validation.data,
        createdBy: (req as any).authUserId,
      });
      res.status(201).json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-create" });
      res.status(500).json({ message: "Failed to create bank question" });
    }
  });

  app.post("/api/bank/questions/bulk", requireAuth, async (req, res) => {
    try {
      const items = (req.body as { items?: unknown })?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ message: "items must be an array of 1..50 bank questions" });
      }
      // All-or-nothing: validate every item BEFORE inserting any.
      const validated: Array<z.infer<typeof insertBankQuestionSchema>> = [];
      for (let i = 0; i < items.length; i++) {
        const parsed = insertBankQuestionSchema.safeParse(items[i]);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid bank question", index: i, errors: parsed.error.errors });
        }
        validated.push(parsed.data);
      }
      const createdBy = (req as any).authUserId as number;
      const rows = await storage.createBankQuestions(tctx(req), validated.map((v) => ({ ...v, createdBy })));
      res.status(201).json({ created: rows.length });
    } catch (error) {
      captureError(error, { scope: "http.bank-bulk-create" });
      res.status(500).json({ message: "Failed to create bank questions" });
    }
  });

  app.put("/api/bank/questions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const validation = updateBankQuestionSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid bank question", errors: validation.error.errors });
      }
      const row = await storage.updateBankQuestion(tctx(req), id, validation.data);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-update" });
      res.status(500).json({ message: "Failed to update bank question" });
    }
  });

  app.delete("/api/bank/questions/:id", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const row = await storage.archiveBankQuestion(tctx(req), id);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.status(204).end();
    } catch (error) {
      captureError(error, { scope: "http.bank-archive" });
      res.status(500).json({ message: "Failed to archive bank question" });
    }
  });

  app.post("/api/bank/questions/:id/restore", requireAuth, async (req, res) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ message: "Invalid question id" });
      const row = await storage.restoreBankQuestion(tctx(req), id);
      if (!row) return res.status(404).json({ message: "Bank question not found" });
      res.json(row);
    } catch (error) {
      captureError(error, { scope: "http.bank-restore" });
      res.status(500).json({ message: "Failed to restore bank question" });
    }
  });
}
