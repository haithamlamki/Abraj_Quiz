import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertQuizSchema, insertGameSchema, insertGameResponseSchema, quizQuestionsSchema, insertUserSchema } from "@shared/schema";
import { z } from "zod";
import bcrypt from "bcryptjs";
import session from "express-session";

export async function registerRoutes(app: Express): Promise<Server> {
  // Session configuration
  app.use(session({
    secret: process.env.SESSION_SECRET || 'abraj-quiz-secret-dev',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // Set to true in production with HTTPS
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  // Authentication middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    next();
  };

  // Authentication routes
  app.post("/api/register", async (req, res) => {
    try {
      const validation = insertUserSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ message: "Invalid user data", errors: validation.error.errors });
      }

      const { username, password } = validation.data;

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(username);
      if (existingUser) {
        return res.status(400).json({ message: "Username already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10);

      // Create user
      const user = await storage.createUser({
        username,
        password: hashedPassword
      });

      // Set session
      (req as any).session.userId = user.id;
      (req as any).session.username = user.username;

      res.status(201).json({ 
        id: user.id, 
        username: user.username,
        message: "User registered successfully" 
      });
    } catch (error) {
      console.error("Registration error:", error);
      res.status(500).json({ message: "Failed to register user" });
    }
  });

  app.post("/api/login", async (req, res) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }

      // Find user
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      // Set session
      (req as any).session.userId = user.id;
      (req as any).session.username = user.username;

      res.json({ 
        id: user.id, 
        username: user.username,
        message: "Login successful" 
      });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ message: "Failed to login" });
    }
  });

  app.post("/api/logout", (req, res) => {
    (req as any).session.destroy((err: any) => {
      if (err) {
        return res.status(500).json({ message: "Failed to logout" });
      }
      res.json({ message: "Logout successful" });
    });
  });

  app.get("/api/me", (req, res) => {
    if (!(req as any).session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }

    res.json({
      id: (req as any).session.userId,
      username: (req as any).session.username
    });
  });

  // Quiz routes
  app.get("/api/quizzes", async (req, res) => {
    try {
      const quizzes = await storage.getPublicQuizzes();
      res.json(quizzes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch quizzes" });
    }
  });

  app.get("/api/quizzes/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const quiz = await storage.getQuiz(id);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }
      res.json(quiz);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch quiz" });
    }
  });

  app.get("/api/my-quizzes", requireAuth, async (req, res) => {
    try {
      const userId = (req as any).session.userId;
      const quizzes = await storage.getUserQuizzes(userId);
      res.json(quizzes);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch user quizzes" });
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

      const quiz = await storage.createQuiz({
        title: validation.data.title,
        description: validation.data.description,
        questions: validation.data.questions,
        isPublic: validation.data.isPublic,
        createdBy: (req as any).session.userId
      });
      res.status(201).json(quiz);
    } catch (error) {
      res.status(500).json({ message: "Failed to create quiz" });
    }
  });

  // Game routes
  app.post("/api/games", requireAuth, async (req, res) => {
    try {
      const { quizId, hostId } = req.body;
      
      // Check if quiz exists
      const quiz = await storage.getQuiz(quizId);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      // Generate unique game PIN
      let gamePin: string;
      let attempts = 0;
      do {
        gamePin = (storage as any).generateGamePin();
        attempts++;
      } while (await storage.getGameByPin(gamePin) && attempts < 10);

      if (attempts >= 10) {
        return res.status(500).json({ message: "Failed to generate unique game PIN" });
      }

      const gameData = {
        quizId,
        hostId: (req as any).session.userId,
        gamePin,
        status: "waiting" as const
      };

      const game = await storage.createGame(gameData);
      res.status(201).json(game);
    } catch (error) {
      res.status(500).json({ message: "Failed to create game" });
    }
  });

  app.get("/api/games/:pin", async (req, res) => {
    try {
      const pin = req.params.pin;
      const game = await storage.getGameByPin(pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }
      res.json(game);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch game" });
    }
  });

  app.post("/api/games/:pin/join", async (req, res) => {
    try {
      const pin = req.params.pin;
      const { playerName } = req.body;

      if (!playerName || typeof playerName !== 'string') {
        return res.status(400).json({ message: "Player name is required" });
      }

      const game = await storage.getGameByPin(pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      if (game.status !== "waiting") {
        return res.status(400).json({ message: "Game is not accepting new players" });
      }

      // Check if player name already exists
      const players = (game.players as any[]) || [];
      if (players.some((p: any) => p.name === playerName)) {
        return res.status(400).json({ message: "Player name already taken" });
      }

      // Add player to game
      const updatedPlayers = [...players, { name: playerName, score: 0 }];
      const updatedGame = await storage.updateGame(game.id, { players: updatedPlayers });

      res.json({ success: true, game: updatedGame });
    } catch (error) {
      res.status(500).json({ message: "Failed to join game" });
    }
  });

  app.post("/api/games/:pin/start", async (req, res) => {
    try {
      const pin = req.params.pin;
      const game = await storage.getGameByPin(pin);
      
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      if (game.status !== "waiting") {
        return res.status(400).json({ message: "Game cannot be started" });
      }

      const updatedGame = await storage.updateGame(game.id, { 
        status: "active",
        currentQuestion: 0
      });

      res.json(updatedGame);
    } catch (error) {
      res.status(500).json({ message: "Failed to start game" });
    }
  });

  app.post("/api/games/:pin/answer", async (req, res) => {
    try {
      const pin = req.params.pin;
      const { playerName, questionIndex, selectedAnswer, responseTime } = req.body;

      const game = await storage.getGameByPin(pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const quiz = await storage.getQuiz(game.quizId);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      const questions = quiz.questions as any[];
      const question = questions[questionIndex];
      if (!question) {
        return res.status(400).json({ message: "Invalid question index" });
      }

      const isCorrect = selectedAnswer === question.correctAnswer;
      
      // Calculate points based on speed and correctness
      let pointsEarned = 0;
      if (isCorrect) {
        const maxPoints = 1000;
        const timeBonus = Math.max(0, (question.timeLimit - responseTime / 1000) / question.timeLimit);
        pointsEarned = Math.round(maxPoints * (0.5 + 0.5 * timeBonus));
      }

      const responseData = {
        gameId: game.id,
        playerName,
        questionIndex,
        selectedAnswer,
        responseTime,
        isCorrect,
        pointsEarned
      };

      await storage.createGameResponse(responseData);

      // Update player score
      const players = (game.players as any[]) || [];
      const updatedPlayers = players.map((player: any) => {
        if (player.name === playerName) {
          return { ...player, score: (player.score || 0) + pointsEarned };
        }
        return player;
      });

      await storage.updateGame(game.id, { players: updatedPlayers });

      res.json({ 
        success: true, 
        isCorrect, 
        pointsEarned,
        correctAnswer: question.correctAnswer
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to submit answer" });
    }
  });

  app.post("/api/games/:pin/next-question", async (req, res) => {
    try {
      const pin = req.params.pin;
      const game = await storage.getGameByPin(pin);
      
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const quiz = await storage.getQuiz(game.quizId);
      if (!quiz) {
        return res.status(404).json({ message: "Quiz not found" });
      }

      const questions = quiz.questions as any[];
      const nextQuestion = (game.currentQuestion || 0) + 1;

      if (nextQuestion >= questions.length) {
        // Game is complete
        const updatedGame = await storage.updateGame(game.id, { status: "completed" });
        res.json({ gameComplete: true, game: updatedGame });
      } else {
        const updatedGame = await storage.updateGame(game.id, { currentQuestion: nextQuestion });
        res.json({ gameComplete: false, game: updatedGame });
      }
    } catch (error) {
      res.status(500).json({ message: "Failed to advance to next question" });
    }
  });

  app.get("/api/games/:pin/results", async (req, res) => {
    try {
      const pin = req.params.pin;
      const game = await storage.getGameByPin(pin);
      
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const quiz = await storage.getQuiz(game.quizId);
      const responses = await storage.getGameResponses(game.id);
      const players = (game.players as any[]) || [];
      
      // Sort players by score
      const sortedPlayers = players.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

      res.json({ 
        game, 
        players: sortedPlayers, 
        responses,
        totalQuestions: Array.isArray(quiz?.questions) ? (quiz.questions as any[]).length : 0
      });
    } catch (error) {
      res.status(500).json({ message: "Failed to get game results" });
    }
  });

  app.get("/api/games/:pin/question-results/:questionIndex", async (req, res) => {
    try {
      const pin = req.params.pin;
      const questionIndex = parseInt(req.params.questionIndex);

      const game = await storage.getGameByPin(pin);
      if (!game) {
        return res.status(404).json({ message: "Game not found" });
      }

      const responses = await storage.getGameResponses(game.id);
      const questionResponses = responses.filter(r => r.questionIndex === questionIndex);

      // Calculate answer distribution
      const answerCounts = [0, 0, 0, 0];
      questionResponses.forEach(response => {
        if (response.selectedAnswer >= 0 && response.selectedAnswer < 4) {
          answerCounts[response.selectedAnswer]++;
        }
      });

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
      res.status(500).json({ message: "Failed to get question results" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
