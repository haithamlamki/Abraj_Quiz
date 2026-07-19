import type { Express, RequestHandler, Response } from "express";
import type { IStorage, StorageCtx } from "./storage";
import {
  buildGameReport, buildQuizReport,
  buildGameReportXlsx, buildQuizReportXlsx,
  buildGameReportCsv, buildQuizReportCsv,
  reportSlug, type GameReportData, type QuizReportData, type ReportLang,
} from "./reports";
import { captureError } from "./instrument";

// Compliance-report routes (bank/import-routes DI pattern). Reads only —
// no new tables; host/owner gates guard the PII-adjacent roster data.
export interface ReportRouteDeps {
  storage: IStorage;
  requireAuth: RequestHandler;
  tctx: (req: any) => StorageCtx;
}

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function langOf(req: any): ReportLang {
  return req.query?.lang === "ar" ? "ar" : "en";
}

function sendFile(res: Response, body: Buffer | string, filename: string, mime: string): void {
  res.setHeader("Content-Type", mime);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

export function registerReportRoutes(app: Express, { storage, requireAuth, tctx }: ReportRouteDeps): void {
  // Shared loader: resolves + authorizes a game report or writes the error
  // response and returns null.
  async function loadGameReport(req: any, res: Response): Promise<{ data: GameReportData; slug: string } | null> {
    const game = await storage.getGameByPin(tctx(req), req.params.pin);
    if (!game) { res.status(404).json({ message: "Game not found" }); return null; }
    if (game.hostId !== req.authUserId) { res.status(403).json({ message: "Only the game host can download this report" }); return null; }
    if (game.status !== "completed") { res.status(409).json({ message: "This game is not finished yet — reports are available after completion" }); return null; }
    const quiz = await storage.getQuiz(tctx(req), game.quizId);
    if (!quiz) { res.status(404).json({ message: "Quiz not found" }); return null; }
    const [players, responses] = await Promise.all([
      storage.getGamePlayers(tctx(req), game.id),
      storage.getGameResponses(tctx(req), game.id),
    ]);
    return {
      data: buildGameReport({ game, quiz, players, responses }),
      slug: `${reportSlug(quiz.title, `quiz-${quiz.id}`)}-game-${game.gamePin}-report`,
    };
  }

  async function loadQuizReport(req: any, res: Response): Promise<{ data: QuizReportData; slug: string } | null> {
    const quizId = parseInt(req.params.id, 10);
    if (!Number.isInteger(quizId) || quizId <= 0) { res.status(400).json({ message: "Invalid quiz id" }); return null; }
    const quiz = await storage.getQuiz(tctx(req), quizId);
    if (!quiz) { res.status(404).json({ message: "Quiz not found" }); return null; }
    if (quiz.createdBy !== req.authUserId) { res.status(403).json({ message: "You can only view insights for your own quizzes" }); return null; }
    const games = await storage.getCompletedQuizGames(tctx(req), quizId);
    const playersByGame = new Map<number, Awaited<ReturnType<IStorage["getGamePlayers"]>>>();
    const responsesByGame = new Map<number, Awaited<ReturnType<IStorage["getGameResponses"]>>>();
    for (const g of games) {
      const [players, responses] = await Promise.all([
        storage.getGamePlayers(tctx(req), g.id),
        storage.getGameResponses(tctx(req), g.id),
      ]);
      playersByGame.set(g.id, players);
      responsesByGame.set(g.id, responses);
    }
    return {
      data: buildQuizReport({ quiz, games, playersByGame, responsesByGame }),
      slug: `${reportSlug(quiz.title, `quiz-${quiz.id}`)}-report`,
    };
  }

  app.get("/api/games/:pin/report.xlsx", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadGameReport(req, res);
      if (!loaded) return;
      sendFile(res, await buildGameReportXlsx(loaded.data, langOf(req)), `${loaded.slug}.xlsx`, XLSX_MIME);
    } catch (error) {
      captureError(error, { scope: "http.game-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/games/:pin/report.csv", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadGameReport(req, res);
      if (!loaded) return;
      sendFile(res, buildGameReportCsv(loaded.data, langOf(req)), `${loaded.slug}.csv`, "text/csv; charset=utf-8");
    } catch (error) {
      captureError(error, { scope: "http.game-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/quizzes/:id/report.xlsx", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadQuizReport(req, res);
      if (!loaded) return;
      sendFile(res, await buildQuizReportXlsx(loaded.data, langOf(req)), `${loaded.slug}.xlsx`, XLSX_MIME);
    } catch (error) {
      captureError(error, { scope: "http.quiz-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });

  app.get("/api/quizzes/:id/report.csv", requireAuth, async (req: any, res) => {
    try {
      const loaded = await loadQuizReport(req, res);
      if (!loaded) return;
      sendFile(res, buildQuizReportCsv(loaded.data, langOf(req)), `${loaded.slug}.csv`, "text/csv; charset=utf-8");
    } catch (error) {
      captureError(error, { scope: "http.quiz-report" });
      res.status(500).json({ message: "Failed to build the report" });
    }
  });
}
