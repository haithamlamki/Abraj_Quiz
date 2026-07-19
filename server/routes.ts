import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage, SYSTEM_CTX, type StorageCtx } from "./storage";
import { insertQuizSchema, quizQuestionsSchema, questionSchema, insertUserSchema } from "@shared/schema";
import { tallyDistribution } from "@shared/quiz-scoring";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import multer from "multer";
import { generateQuizFromPDF, generateQuizFromURL, generateQuizFromTopics, generateQuizFromText, generateBackgroundImage, extractQuizFromText } from "./openai-service";
import { gameWS } from "./websocket";
import { gameRoomManager, RoomError, toClientGame } from "./game-room-manager";
import { tenantMiddleware, requireFeature } from "./tenant";
import { signToken, verifyToken } from "./token";
import { brandingSchema, featuresSchema, type Tenant } from "@shared/schema";
import { getAllowedOrigins } from "./origins";
import { registerAdminRoutes } from "./admin-routes";
import { registerBankRoutes } from "./bank-routes";
import { registerImportRoutes } from "./import-routes";
import { registerReportRoutes } from "./report-routes";
import { registerVersionRoutes } from "./version-routes";
import { uploadQuizImage } from "./supabase-storage";
import { captureError } from "./instrument";
import { buildRateLimiters } from "./rate-limits";

export async function registerRoutes(app: Express): Promise<Server> {
  // Multer configuration for file uploads
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB limit
    },
    fileFilter: (req, file, cb) => {
      if (file.mimetype === 'application/pdf') {
        cb(null, true);
      } else {
        cb(new Error('Only PDF files are allowed'));
      }
    }
  });

  // Separate uploader for question / theme images (goes to Supabase Storage).
  const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB, matches the bucket limit
    fileFilter: (req, file, cb) => {
      if (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error("Only PNG, JPEG, GIF, or WEBP images are allowed"));
      }
    },
  });

  // Session configuration with PostgreSQL store
  const PgSession = connectPgSimple(session);
  const isProduction = process.env.NODE_ENV === "production";
  // TODO: consolidate origin parsing/guard with server/index.ts:11 into a shared util. See BACKLOG.md.
  const sessionSecret = process.env.SESSION_SECRET;

  if (isProduction && !sessionSecret) {
    throw new Error("SESSION_SECRET must be set in production");
  }

  const rawClientOrigin = process.env.CLIENT_ORIGIN ?? "";
  const rawCorsOrigin = process.env.CORS_ORIGIN ?? "";
  const allowedOrigins = (rawClientOrigin || rawCorsOrigin)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error(
      `CLIENT_ORIGIN must resolve to at least one origin in production. ` +
        `CLIENT_ORIGIN=${JSON.stringify(rawClientOrigin)} CORS_ORIGIN=${JSON.stringify(rawCorsOrigin)}`,
    );
  }

  const sessionMiddleware = session({
    store: new PgSession({
      pool: pool,
      tableName: 'session',
      createTableIfMissing: false
    }),
    secret: sessionSecret || 'abraj-quiz-secret-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: isProduction,
      httpOnly: true,
      sameSite: isProduction ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  });

  app.use(sessionMiddleware);

  // Resolve the tenant for every API request. /api/healthz and /api/readyz are
  // registered earlier in server/index.ts and are unaffected.
  app.use("/api", tenantMiddleware);

  // Resolve the caller's identity from a bearer token (preferred — works
  // cross-site where third-party cookies are blocked) or the session cookie.
  // The token is bound to a tenant, so a token minted on one tenant's domain
  // cannot authenticate on another. Downstream handlers read req.authUserId.
  app.use("/api", (req: any, _res, next) => {
    const header = req.headers.authorization as string | undefined;
    if (header && header.startsWith("Bearer ")) {
      const payload = verifyToken(header.slice(7));
      if (payload && payload.tenantId === (req.tenant as Tenant).id) {
        req.authUserId = payload.userId;
      }
    }
    if (req.authUserId === undefined) {
      req.authUserId = req.session?.userId;
    }
    next();
  });

  // Build rate limiters once per server startup
  const { authLimiter, aiLimiter, uploadLimiter, joinLimiter, draftLimiter } = buildRateLimiters();

  app.get("/api/tenant/config", (req, res) => {
    const tenant = req.tenant as Tenant;
    res.json({
      slug: tenant.slug,
      name: tenant.name,
      branding: brandingSchema.parse((tenant.branding as object) ?? {}),
      features: featuresSchema.parse((tenant.features as object) ?? {}),
    });
  });

  registerAdminRoutes(app);

  // Tenant context for the current request (tenantMiddleware guarantees req.tenant on /api).
  const tctx = (req: any): StorageCtx => {
    const tenant = req.tenant as Tenant | undefined;
    if (!tenant) {
      throw new Error("Tenant context missing — tenantMiddleware not applied");
    }
    return { tenantId: tenant.id };
  };

  // Authentication middleware. Also verifies the session user exists IN THE REQUEST'S
  // TENANT — a session cookie can be shared across tenant domains on this backend, so a
  // valid session for a user in another tenant must not be treated as authenticated here.
  const requireAuth = async (req: any, res: any, next: any) => {
    try {
      if (!req.authUserId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(tctx(req), req.authUserId);
      if (!user) {
        // Identity belongs to a user from another tenant (shared backend).
        return res.status(401).json({ message: "Not authenticated" });
      }
      next();
    } catch (error) {
      captureError(error, { scope: "http.auth-check" });
      console.error("Auth check failed:", error);
      res.status(500).json({ message: "Authentication check failed" });
    }
  };

  const gamePinSchema = z.string().regex(/^\d{6}$/, "Game PIN must be 6 digits");
  const playerNameSchema = z.string().trim().min(1).max(40);
  const answerSubmissionSchema = z.object({
    playerName: playerNameSchema,
    questionIndex: z.number().int().min(0),
    // Single-select: a chosen index (0..5). Multi-select: a bitmask of chosen
    // options (max 6 answers => max mask 2^6 - 1 = 63).
    selectedAnswer: z.number().int().min(0).max(63),
    responseTime: z.number().int().min(0),
  });

  const getValidatedGamePin = (pin: string, res: any): string | undefined => {
    const result = gamePinSchema.safeParse(pin);
    if (!result.success) {
      res.status(400).json({ message: "Invalid game PIN" });
      return undefined;
    }

    return result.data;
  };

  // Authentication routes
  app.post("/api/register", authLimiter, async (req, res) => {
    try {
      const validation = insertUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid user data", errors: validation.error.errors });
      }

      const { username, password } = validation.data;

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(tctx(req), username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await storage.createUser(tctx(req), {
        username,
        password: hashedPassword
      });

      // Set the session cookie (for same-site clients) and issue a bearer
      // token (used cross-site where third-party cookies are blocked).
      (req as any).session.userId = user.id;
      (req as any).session.username = user.username;
      const token = signToken({ userId: user.id, tenantId: (req.tenant as Tenant).id });

      res.status(201).json({
        id: user.id,
        username: user.username,
        token,
        message: "User registered successfully"
      });
    } catch (error) {
      captureError(error, { scope: "http.register" });
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post("/api/login", authLimiter, async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Find user
      const user = await storage.getUserByUsername(tctx(req), username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Set the session cookie (for same-site clients) and issue a bearer
      // token (used cross-site where third-party cookies are blocked).
      (req as any).session.userId = user.id;
      (req as any).session.username = user.username;
      const token = signToken({ userId: user.id, tenantId: (req.tenant as Tenant).id });

      res.json({
        id: user.id,
        username: user.username,
        token,
        message: "Login successful"
      });
    } catch (error) {
      captureError(error, { scope: "http.login" });
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  app.post("/api/logout", (req, res) => {
    (req as any).session.destroy((err: any) => {
      if (err) {
        captureError(err, { scope: "http.logout" });
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/me", async (req, res) => {
    try {
      const userId = (req as any).authUserId;
      if (!userId) {
        return res.status(401).json({ message: "Not authenticated" });
      }
      const user = await storage.getUser(tctx(req), userId);
      if (!user) {
        // Session belongs to a user from another tenant (shared backend cookie).
        return res.status(401).json({ message: "Not authenticated" });
      }
      res.json({ id: user.id, username: user.username });
    } catch (error) {
      captureError(error, { scope: "http.me" });
      console.error("Failed to fetch current user:", error);
      res.status(500).json({ message: "Failed to fetch current user" });
    }
  });

  // correctAnswer must only be visible to the quiz's creator (so the editor UI works);
  // any other caller sees the questions with that field stripped.
  const sanitizeQuizForCaller = <T extends { createdBy: number; questions: unknown }>(
    quiz: T,
    callerId: number | undefined,
  ): T => {
    if (callerId === quiz.createdBy) return quiz;
    if (!Array.isArray(quiz.questions)) return quiz;
    const questions = (quiz.questions as Array<Record<string, unknown>>).map((q) => {
      // Strip the legacy single-correct field, the canonical correct-set field, AND
      // the explanation (which typically states the correct answer) so players
      // can't read the answer key mid-game. difficulty is safe and kept.
      const { correctAnswer: _omit, correctAnswers: _omit2, explanation: _omit3, ...rest } = q;
      return rest;
    });
    return { ...quiz, questions } as T;
  };

  // Quiz routes
  app.get("/api/quizzes", async (req, res) => {
    try {
      const features = featuresSchema.parse(((req as any).tenant?.features as object) ?? {});
      if (!features.publicQuizzes) {
        return res.json([]);
      }
      const callerId = (req as any).authUserId as number | undefined;
      const quizzes = await storage.getPublicQuizzes(tctx(req));
      res.json(quizzes.map((q) => sanitizeQuizForCaller(q, callerId)));
    } catch (error) {
      captureError(error, { scope: "http.quizzes-list" });
      res.status(500).json({ message: "Failed to fetch quizzes" });
    }
  });

  app.get("/api/quizzes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid quiz id" });
      }
      const quiz = await storage.getQuiz(tctx(req), id);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      const callerId = (req as any).authUserId as number | undefined;
      // A private/archived quiz is visible to its creator, and to anyone else
      // only while a live game (waiting/active) on it exists — players joining
      // that game need the (sanitized) quiz even though it is hidden from
      // listings. Without a live game, hidden quizzes stay 404 so they are not
      // enumerable.
      if ((!quiz.isPublic || quiz.deletedAt) && callerId !== quiz.createdBy) {
        const live = await storage.quizHasLiveGame(tctx(req), id);
        if (!live) {
          return res.status(404).json({ message: "Quiz not found" });
        }
      }
      res.json(sanitizeQuizForCaller(quiz, callerId));
    } catch (error) {
      captureError(error, { scope: "http.quiz-get" });
      res.status(500).json({ message: "Failed to fetch quiz" });
    }
  });

  app.get("/api/my-quizzes", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).authUserId;
      const archived = req.query.archived === "1" || req.query.archived === "true";
      const quizzes = await storage.getUserQuizzes(tctx(req), userId, { archived });
      res.json(quizzes);
    } catch (error) {
      captureError(error, { scope: "http.my-quizzes" });
      res.status(500).json({ message: "Failed to fetch user quizzes" });
    }
  });

  // Debug endpoint to check OpenAI API availability
  if (!isProduction) {
    app.get("/api/debug/openai", requireAuth, async (req, res) => {
      try {
        const hasApiKey = !!process.env.OPENAI_API_KEY;
        const userId = (req as any).authUserId;
        
        res.json({
          hasApiKey,
          isAuthenticated: true,
          userId,
          apiKeyLength: process.env.OPENAI_API_KEY?.length || 0
        });
      } catch (error) {
        captureError(error, { scope: "http.debug-openai" });
        console.error("Debug endpoint error:", error);
        res.status(500).json({ message: "Debug check failed" });
      }
    });
  }

  // Auto-generation routes
  app.post("/api/generate-quiz/pdf", aiLimiter, requireAuth, requireFeature("aiGeneration"), upload.single('pdf'), async (req, res) => {
    try {
      console.log("PDF quiz generation request - User ID:", (req as any).authUserId);
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "No PDF file uploaded" });
      }

      const generatedQuiz = await generateQuizFromPDF(req.file.buffer);
      res.json(generatedQuiz);
    } catch (error: any) {
      captureError(error, { scope: "http.generate-quiz-pdf" });
      console.error("Error generating quiz from PDF:", error);
      res.status(500).json({ message: error.message || "Failed to generate quiz from PDF" });
    }
  });

  app.post("/api/generate-quiz/url", aiLimiter, requireAuth, requireFeature("aiGeneration"), async (req, res) => {
    try {
      console.log("URL quiz generation request - User ID:", (req as any).authUserId);
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server" });
      }

      const { url } = req.body;
      
      if (!url || typeof url !== 'string') {
        return res.status(400).json({ message: "Valid URL is required" });
      }

      // Basic URL validation
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ message: "Invalid URL format" });
      }

      const generatedQuiz = await generateQuizFromURL(url);
      res.json(generatedQuiz);
    } catch (error: any) {
      captureError(error, { scope: "http.generate-quiz-url" });
      console.error("Error generating quiz from URL:", error);
      res.status(500).json({ message: error.message || "Failed to generate quiz from URL" });
    }
  });

  app.post("/api/generate-quiz/topics", aiLimiter, requireAuth, requireFeature("aiGeneration"), async (req, res) => {
    try {
      console.log("Topics quiz generation request - User ID:", (req as any).authUserId);
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server" });
      }

      const { topics } = req.body;
      
      if (!topics || typeof topics !== 'string' || topics.trim().length < 3) {
        return res.status(400).json({ message: "Topics input is required and must be at least 3 characters long" });
      }

      const generatedQuiz = await generateQuizFromTopics(topics.trim());
      res.json(generatedQuiz);
    } catch (error: any) {
      captureError(error, { scope: "http.generate-quiz-topics" });
      console.error("Error generating quiz from topics:", error);
      res.status(500).json({ message: error.message || "Failed to generate quiz from topics" });
    }
  });

  app.post("/api/generate-quiz/text", aiLimiter, requireAuth, requireFeature("aiGeneration"), async (req, res) => {
    try {
      console.log("Text quiz generation request - User ID:", (req as any).authUserId);
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "OpenAI API key is not configured on the server" });
      }

      const { text } = req.body;
      
      if (!text || typeof text !== 'string' || text.trim().length < 50) {
        return res.status(400).json({ message: "Text content is required and must be at least 50 characters long" });
      }

      const generatedQuiz = await generateQuizFromText(text.trim());
      res.json(generatedQuiz);
    } catch (error: any) {
      captureError(error, { scope: "http.generate-quiz-text" });
      console.error("Error generating quiz from text:", error);
      res.status(500).json({ message: error.message || "Failed to generate quiz from text" });
    }
  });

  app.post("/api/generate-background", aiLimiter, requireAuth, requireFeature("aiGeneration"), async (req, res) => {
    try {
      console.log("Background image generation request - User ID:", (req as any).authUserId);
      
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "Service not configured" });
      }

      const { title, description } = req.body;
      
      // Validate title
      if (!title || typeof title !== 'string' || title.trim().length < 3) {
        return res.status(400).json({ message: "Quiz title is required and must be at least 3 characters long" });
      }

      if (title.trim().length > 100) {
        return res.status(400).json({ message: "Quiz title must be less than 100 characters" });
      }

      // Validate description length
      if (description && typeof description === 'string' && description.trim().length > 500) {
        return res.status(400).json({ message: "Description must be less than 500 characters" });
      }

      const png = await generateBackgroundImage({
        title: title.trim(),
        description: description && typeof description === "string" ? description.trim() : "",
      });
      res.json({ url: `data:image/png;base64,${png.toString("base64")}` });
    } catch (error: any) {
      captureError(error, { scope: "http.generate-background" });
      console.error("Error generating background image:", error);
      // Return user-friendly error message without leaking internals
      const userMessage = error.message?.includes('OpenAI') || error.message?.includes('API')
        ? "Service temporarily unavailable. Please try again later."
        : error.message || "Failed to generate background image";
      res.status(500).json({ message: userMessage });
    }
  });

  // Upload a question or theme image to Supabase Storage; returns { url }.
  app.post("/api/upload-image", uploadLimiter, requireAuth, imageUpload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No image uploaded" });
      }
      const url = await uploadQuizImage(req.file.buffer, req.file.mimetype);
      res.json({ url });
    } catch (error: any) {
      captureError(error, { scope: "http.upload-image" });
      console.error("Image upload error:", error);
      const configured = /not configured/i.test(error?.message || "");
      res
        .status(configured ? 503 : 500)
        .json({ message: configured ? "Image upload is not configured on the server" : "Failed to upload image" });
    }
  });

  app.post("/api/quizzes", requireAuth, async (req, res) => {
    try {
      const validation = insertQuizSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid quiz data", errors: validation.error.errors });
      }

      // Validate questions format
      const questionsValidation = quizQuestionsSchema.safeParse(validation.data.questions);
      if (!questionsValidation.success) {
        return res.status(400).json({ message: "Invalid questions format", errors: questionsValidation.error.errors });
      }

      const quiz = await storage.createQuiz(tctx(req), {
        title: validation.data.title,
        description: validation.data.description,
        // Store the normalized (canonical) question shape.
        questions: questionsValidation.data,
        background: validation.data.background || "classroom",
        isPublic: validation.data.isPublic,
        createdBy: (req as any).authUserId
      });
      res.status(201).json(quiz);
    } catch (error) {
      captureError(error, { scope: "http.quiz-create" });
      res.status(500).json({ message: "Failed to create quiz" });
    }
  });

  app.put("/api/quizzes/:id", requireAuth, async (req, res) => {
    try {
      const quizId = parseInt(req.params.id, 10);
      if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ message: "Invalid quiz id" });
      }
      const userId = (req as any).authUserId;

      // Check if quiz exists and user owns it
      const existingQuiz = await storage.getQuiz(tctx(req), quizId);
      if (!existingQuiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      if (existingQuiz.createdBy !== userId) {
        return res.status(403).json({ message: "You can only edit your own quizzes" });
      }

      const validation = insertQuizSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid quiz data", errors: validation.error.errors });
      }

      // Validate questions format
      const questionsValidation = quizQuestionsSchema.safeParse(validation.data.questions);
      if (!questionsValidation.success) {
        return res.status(400).json({ message: "Invalid questions format", errors: questionsValidation.error.errors });
      }

      // Versioned save: banks the previous row state into quiz_versions, deletes
      // any autosave draft, and prunes history — all in one transaction.
      const updatedQuiz = await storage.updateQuizWithVersion(tctx(req), quizId, {
        title: validation.data.title,
        description: validation.data.description,
        // Persist the NORMALIZED questions (canonical correctAnswers/type/answerType
        // shape) so edited quizzes migrate off the legacy shape.
        questions: questionsValidation.data,
        background: validation.data.background,
        isPublic: validation.data.isPublic
      });

      res.json(updatedQuiz);
    } catch (error) {
      captureError(error, { scope: "http.quiz-update" });
      res.status(500).json({ message: "Failed to update quiz" });
    }
  });

  app.delete("/api/quizzes/:id", requireAuth, async (req, res) => {
    try {
      const quizId = parseInt(req.params.id, 10);
      if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ message: "Invalid quiz id" });
      }
      const userId = (req as any).authUserId;
      const existingQuiz = await storage.getQuiz(tctx(req), quizId);
      if (!existingQuiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      if (existingQuiz.createdBy !== userId) {
        return res.status(403).json({ message: "You can only delete your own quizzes" });
      }
      const archived = await storage.deleteQuiz(tctx(req), quizId);
      if (!archived) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      res.status(204).end();
    } catch (error) {
      captureError(error, { scope: "http.quiz-delete" });
      res.status(500).json({ message: "Failed to delete quiz" });
    }
  });

  app.post("/api/quizzes/:id/restore", requireAuth, async (req, res) => {
    try {
      const quizId = parseInt(req.params.id, 10);
      if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ message: "Invalid quiz id" });
      }
      const userId = (req as any).authUserId;
      const existingQuiz = await storage.getQuiz(tctx(req), quizId);
      if (!existingQuiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      if (existingQuiz.createdBy !== userId) {
        return res.status(403).json({ message: "You can only restore your own quizzes" });
      }
      const restored = await storage.restoreQuiz(tctx(req), quizId);
      if (!restored) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      res.json(restored);
    } catch (error) {
      captureError(error, { scope: "http.quiz-restore" });
      res.status(500).json({ message: "Failed to restore quiz" });
    }
  });

  // Question Bank (per-tenant reusable question library). Routes live in
  // server/bank-routes.ts with injected deps so they're testable sans DB.
  registerBankRoutes(app, { storage, requireAuth, tctx });

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

  registerReportRoutes(app, { storage, requireAuth, tctx });

  registerVersionRoutes(app, { storage, requireAuth, tctx, draftLimiter });

  app.get("/api/quizzes/:id/insights", requireAuth, async (req, res) => {
    try {
      const quizId = parseInt(req.params.id, 10);
      if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ message: "Invalid quiz id" });
      }
      const userId = (req as any).authUserId;
      const existingQuiz = await storage.getQuiz(tctx(req), quizId);
      if (!existingQuiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      // Owner-only — includes archived quizzes: history is the point of archive.
      if (existingQuiz.createdBy !== userId) {
        return res.status(403).json({ message: "You can only view insights for your own quizzes" });
      }
      const insights = await storage.getQuizInsights(tctx(req), quizId);
      res.json(insights);
    } catch (error) {
      captureError(error, { scope: "http.quiz-insights" });
      res.status(500).json({ message: "Failed to load quiz insights" });
    }
  });

  // Game routes
  app.post("/api/games", requireAuth, async (req, res) => {
    try {
      const quizId = Number(req.body.quizId);
      if (!Number.isInteger(quizId) || quizId <= 0) {
        return res.status(400).json({ message: "Valid quizId is required" });
      }
      
      // Check if quiz exists
      const quiz = await storage.getQuiz(tctx(req), quizId);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      // A private quiz can only be hosted by its creator. Without this, a
      // non-owner could create a game from someone else's private quiz, host
      // it to completion, and read every question/answer via the results
      // endpoint — bypassing the private-quiz gate on GET /api/quizzes/:id.
      // Return 404 (not 403) so the existence of a private quiz is not disclosed.
      if (!quiz.isPublic && quiz.createdBy !== (req as any).authUserId) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      if (quiz.deletedAt) {
        return res.status(400).json({ message: "This quiz has been deleted and cannot be hosted" });
      }

      // Generate unique game PIN
      let gamePin: string;
      let attempts = 0;
      do {
        gamePin = (storage as any).generateGamePin();
        attempts++;
      } while (await storage.getGameByPin(SYSTEM_CTX, gamePin) && attempts < 10);

      if (attempts >= 10) {
        return res.status(500).json({ message: "Failed to generate unique game PIN" });
      }

      const gameData = {
        quizId,
        hostId: (req as any).authUserId,
        gamePin,
        status: "waiting" as const
      };

      const game = await storage.createGame(tctx(req), gameData);
      res.status(201).json(toClientGame(game));
    } catch (error) {
      captureError(error, { scope: "http.game-create" });
      res.status(500).json({ message: "Failed to create game" });
    }
  });

  app.get("/api/games/:pin", async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const game = await storage.getGameByPin(tctx(req), pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }
      // Overlay the authoritative roster from game_players. If a live runtime
      // room exists, getGameSnapshot replaces this with the room's live scores;
      // otherwise (waiting lobby, no host yet) the DB roster is the source.
      const roster = await storage.getGamePlayers(tctx(req), game.id);
      const players = roster.map((p) => ({ name: p.name, score: p.score }));
      res.json(await gameRoomManager.getGameSnapshot(pin, { ...game, players }));
    } catch (error) {
      captureError(error, { scope: "http.game-get", gamePin: req.params.pin });
      res.status(500).json({ message: "Failed to fetch game" });
    }
  });

  app.post("/api/games/:pin/join", joinLimiter, async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const playerNameValidation = playerNameSchema.safeParse(req.body.playerName);
      if (!playerNameValidation.success) {
        return res.status(400).json({ message: "Player name is required and must be 40 characters or fewer" });
      }
      const playerName = playerNameValidation.data;

      // Independent game_players INSERT — no games-row lock, so a 400-player
      // join storm no longer serializes. Duplicate/full/busy are controlled
      // outcomes, never a 500.
      const result = await storage.joinGame(tctx(req), pin, playerName);
      if (result.status === "not_found") {
        return res.status(404).json({ message: "Game not found" });
      }
      if (result.status === "not_waiting") {
        return res.status(400).json({ message: "Game is not accepting new players" });
      }
      if (result.status === "duplicate") {
        return res.status(400).json({ message: "Player name already taken" });
      }
      if (result.status === "full") {
        return res.status(409).json({ message: "This game is full", code: "GAME_FULL" });
      }
      if (result.status === "busy") {
        // Transient DB contention (pool/lock/serialization). Ask the client to
        // retry rather than surfacing a 500.
        res.setHeader("Retry-After", "1");
        return res.status(503).json({ message: "The game is busy, please try again", code: "GAME_BUSY" });
      }
      const updatedGame = result.game;
      await gameRoomManager.addPersistedPlayer(pin, playerName, 0);

      // Broadcast player joined to active runtime room clients.
      await gameRoomManager.broadcastGameUpdated(pin, updatedGame);

      res.json({ success: true, game: toClientGame(updatedGame), playerCount: result.playerCount });
    } catch (error) {
      // joinGame maps transient DB contention to GAME_BUSY before it gets
      // here, so anything landing in this catch is unexpected — a silent 500
      // hid 152 pooler rejections during the 2026-07-16 load test.
      captureError(error, { scope: "http.join", gamePin: req.params.pin });
      res.status(500).json({ message: "Failed to join game" });
    }
  });

  app.post("/api/games/:pin/start", requireAuth, async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const game = await storage.getGameByPin(tctx(req), pin);

      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      if (game.hostId !== (req as any).authUserId) {
        return res.status(403).json({ message: "Only the game host can start this game" });
      }

      if (game.status !== "waiting") {
        return res.status(400).json({ message: "Game cannot be started" });
      }

      const updatedGame = await gameRoomManager.startGame(pin, (req as any).authUserId);
      res.json(updatedGame);
    } catch (error) {
      if (!(error instanceof RoomError)) {
        captureError(error, { scope: "http.game-start", gamePin: req.params.pin });
      }
      const runtimeError = gameRoomManager.toHttpError(error);
      res.status(runtimeError.status).json(runtimeError.body);
    }
  });

  app.post("/api/games/:pin/answer", async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      // Validate the PIN belongs to the caller's tenant before touching the
      // runtime room (the engine resolves rooms by globally-unique PIN under
      // SYSTEM_CTX, so without this a caller on tenant B could submit answers
      // into tenant A's game). Mirrors /start and /next-question.
      const game = await storage.getGameByPin(tctx(req), pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const submission = answerSubmissionSchema.safeParse(req.body);
      if (!submission.success) {
        return res.status(400).json({ message: "Invalid answer submission", errors: submission.error.errors });
      }
      const { playerName, questionIndex, selectedAnswer } = submission.data;

      const result = await gameRoomManager.submitAnswer({
        gamePin: pin,
        playerName,
        questionIndex,
        selectedAnswer,
      });

      res.json(result);
    } catch (error) {
      if (!(error instanceof RoomError)) {
        captureError(error, { scope: "http.game-answer", gamePin: req.params.pin });
      }
      const runtimeError = gameRoomManager.toHttpError(error);
      res.status(runtimeError.status).json(runtimeError.body);
    }
  });

  app.post("/api/games/:pin/next-question", requireAuth, async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const game = await storage.getGameByPin(tctx(req), pin);

      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      if (game.hostId !== (req as any).authUserId) {
        return res.status(403).json({ message: "Only the game host can advance this game" });
      }

      const result = await gameRoomManager.advanceQuestion(pin, (req as any).authUserId);
      res.json(result);
    } catch (error) {
      if (!(error instanceof RoomError)) {
        captureError(error, { scope: "http.next-question", gamePin: req.params.pin });
      }
      const runtimeError = gameRoomManager.toHttpError(error);
      res.status(runtimeError.status).json(runtimeError.body);
    }
  });

  app.get("/api/games/:pin/results", async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const game = await storage.getGameByPin(tctx(req), pin);

      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const rawQuiz = await storage.getQuiz(tctx(req), game.quizId);
      // Never expose correctAnswer while the game is still in progress. This
      // endpoint has no host gate (players load their own results here), so a
      // player polling it mid-game could otherwise read every upcoming answer.
      // Correct answers are attached only once the game is completed, for the
      // final review screen and the host PDF report.
      const quiz =
        rawQuiz && game.status !== "completed"
          ? sanitizeQuizForCaller(rawQuiz, undefined)
          : rawQuiz;
      const responses = await storage.getGameResponses(tctx(req), game.id);
      // Authoritative roster from game_players (final scores are persisted there
      // at game completion), not the frozen games.players JSON.
      const roster = await storage.getGamePlayers(tctx(req), game.id);
      const players = roster.map((p) => ({ name: p.name, score: p.score }));

      // Sort players by score
      const sortedPlayers = players.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

      // Attach quiz data to game object for PDF generation
      const gameWithQuiz = {
        ...toClientGame(game),
        quiz
      };

      res.json({ 
        game: gameWithQuiz, 
        players: sortedPlayers, 
        responses,
        totalQuestions: Array.isArray(quiz?.questions) ? (quiz.questions as any[]).length : 0
      });
    } catch (error) {
      captureError(error, { scope: "http.game-results", gamePin: req.params.pin });
      res.status(500).json({ message: "Failed to get game results" });
    }
  });

  app.get("/api/games/:pin/question-results/:questionIndex", requireAuth, async (req, res) => {
    try {
      const pin = getValidatedGamePin(req.params.pin, res);
      if (!pin) return;

      const questionIndex = parseInt(req.params.questionIndex);
      if (!Number.isInteger(questionIndex) || questionIndex < 0) {
        return res.status(400).json({ message: "Invalid question index" });
      }

      const game = await storage.getGameByPin(tctx(req), pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      if (game.hostId !== (req as any).authUserId) {
        return res.status(403).json({ message: "Only the game host can view question results" });
      }

      const responses = await storage.getGameResponses(tctx(req), game.id);
      const questionResponses = responses.filter(r => r.questionIndex === questionIndex);
      const runtimeResults = gameRoomManager.getQuestionResults(pin, questionIndex);
      const quiz = await storage.getQuiz(tctx(req), game.quizId);

      if (runtimeResults) {
        return res.json({
          questionIndex,
          answerCounts: runtimeResults.answerCounts,
          answerPercentages: runtimeResults.answerPercentages,
          totalResponses: runtimeResults.totalResponses,
          responses: questionResponses
        });
      }

      // Calculate answer distribution, sized to the question's answer count
      // (variable, 2-6). Normalize the stored question so legacy 4-answer rows
      // and new multi-select rows both tally correctly.
      const rawQuestion = Array.isArray(quiz?.questions)
        ? (quiz!.questions as any[])[questionIndex]
        : undefined;
      const parsedQuestion = rawQuestion ? questionSchema.safeParse(rawQuestion) : undefined;
      const question = parsedQuestion?.success ? parsedQuestion.data : undefined;
      const answerCounts = question
        ? tallyDistribution(question, questionResponses.map((r) => r.selectedAnswer))
        : [0, 0, 0, 0];

      const totalResponses = questionResponses.length;
      const answerPercentages = answerCounts.map(count => 
        totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0
      );

      res.json({
        questionIndex,
        answerCounts,
        answerPercentages,
        totalResponses,
        responses: questionResponses
      });
    } catch (error) {
      captureError(error, { scope: "http.question-results", gamePin: req.params.pin });
      res.status(500).json({ message: "Failed to get question results" });
    }
  });

  // Get latest quiz results for home page
  app.get("/api/latest-results", async (req, res) => {
    try {
      const result = await storage.getLatestCompletedGame(tctx(req));
      
      if (!result) {
        return res.json({ hasResults: false });
      }

      const { game, players, totalQuestions } = result;
      const top3Players = players.slice(0, 3);

      // Get quiz details
      const quiz = await storage.getQuiz(tctx(req), game.quizId);
      
      res.json({
        hasResults: true,
        game: {
          gamePin: game.gamePin,
          quizTitle: quiz?.title || 'Untitled Quiz',
          completedAt: game.createdAt,
          totalQuestions
        },
        top3Players: top3Players.map((player, index) => ({
          name: player.name,
          score: player.score || 0,
          rank: index + 1
        }))
      });
    } catch (error) {
      captureError(error, { scope: "http.latest-results" });
      console.error("Failed to get latest results:", error);
      res.status(500).json({ message: "Failed to get latest results" });
    }
  });

  const httpServer = createServer(app);

  gameWS.initialize(httpServer, { sessionMiddleware, allowedOrigins, getAllowedOrigins });

  return httpServer;
}
