import type { Express, RequestHandler, Response } from "express";
import type { IStorage, StorageCtx } from "./storage";
import { quizDraftSchema, type Quiz } from "@shared/schema";
import { captureError } from "./instrument";

// Quiz version-history + draft-autosave routes (report-routes DI pattern).
// EVERY route is owner-gated: version/draft payloads carry correctAnswers,
// so they may only ever be readable by the quiz owner — never players.
// Restore is deliberately client-side (load a version into the editor, then a
// normal Save records it as a new version); there is no restore endpoint.
export interface VersionRouteDeps {
  storage: IStorage;
  requireAuth: RequestHandler;
  tctx: (req: any) => StorageCtx;
  draftLimiter: RequestHandler;
}

export function registerVersionRoutes(app: Express, { storage, requireAuth, tctx, draftLimiter }: VersionRouteDeps): void {
  // Resolves + owner-authorizes the quiz, or writes the error response and
  // returns null. Same copy as PUT /api/quizzes/:id — these are edit surfaces.
  async function loadOwnedQuiz(req: any, res: Response): Promise<Quiz | null> {
    const quizId = parseInt(req.params.id, 10);
    if (!Number.isInteger(quizId) || quizId <= 0) {
      res.status(400).json({ message: "Invalid quiz id" });
      return null;
    }
    const quiz = await storage.getQuiz(tctx(req), quizId);
    if (!quiz) {
      res.status(404).json({ message: "Quiz not found" });
      return null;
    }
    if (quiz.createdBy !== req.authUserId) {
      res.status(403).json({ message: "You can only edit your own quizzes" });
      return null;
    }
    return quiz;
  }

  app.get("/api/quizzes/:id/versions", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      res.json(await storage.listQuizVersions(tctx(req), quiz.id));
    } catch (error) {
      captureError(error, { scope: "http.quiz-versions" });
      res.status(500).json({ message: "Failed to load version history" });
    }
  });

  app.get("/api/quizzes/:id/versions/:versionNumber", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const versionNumber = parseInt(req.params.versionNumber, 10);
      if (!Number.isInteger(versionNumber) || versionNumber <= 0) {
        return res.status(400).json({ message: "Invalid version number" });
      }
      const version = await storage.getQuizVersion(tctx(req), quiz.id, versionNumber);
      if (!version) return res.status(404).json({ message: "Version not found" });
      res.json(version);
    } catch (error) {
      captureError(error, { scope: "http.quiz-versions" });
      res.status(500).json({ message: "Failed to load version" });
    }
  });

  app.get("/api/quizzes/:id/draft", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const draft = await storage.getQuizDraft(tctx(req), quiz.id);
      if (!draft) return res.status(404).json({ message: "No draft" });
      res.json({ payload: draft.payload, updatedAt: draft.updatedAt });
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to load draft" });
    }
  });

  app.put("/api/quizzes/:id/draft", requireAuth, draftLimiter, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      const validation = quizDraftSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid draft payload", errors: validation.error.errors });
      }
      const draft = await storage.upsertQuizDraft(tctx(req), quiz.id, validation.data);
      res.json({ updatedAt: draft.updatedAt });
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to save draft" });
    }
  });

  app.delete("/api/quizzes/:id/draft", requireAuth, async (req: any, res) => {
    try {
      const quiz = await loadOwnedQuiz(req, res);
      if (!quiz) return;
      await storage.deleteQuizDraft(tctx(req), quiz.id);
      res.status(204).end();
    } catch (error) {
      captureError(error, { scope: "http.quiz-draft" });
      res.status(500).json({ message: "Failed to discard draft" });
    }
  });
}
