import { 
  users, presentations, presentationSessions, sessionInteractions,
  type User, type InsertUser,
  type Presentation, type InsertPresentation,
  type PresentationSession, type InsertPresentationSession,
  type SessionInteraction, type InsertSessionInteraction
} from "@shared/schema";
import { db } from "./db";
import { eq } from "drizzle-orm";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Presentations
  getPresentation(id: number): Promise<Presentation | undefined>;
  getPresentations(): Promise<Presentation[]>;
  getPublicPresentations(): Promise<Presentation[]>;
  getUserPresentations(userId: number): Promise<Presentation[]>;
  createPresentation(presentation: InsertPresentation): Promise<Presentation>;
  updatePresentation(id: number, presentation: Partial<InsertPresentation>): Promise<Presentation>;
  deletePresentation(id: number): Promise<boolean>;

  // Presentation Sessions
  getSession(id: number): Promise<PresentationSession | undefined>;
  getSessionByPin(pin: string): Promise<PresentationSession | undefined>;
  createSession(session: InsertPresentationSession): Promise<PresentationSession>;
  updateSession(id: number, session: Partial<PresentationSession>): Promise<PresentationSession | undefined>;
  deleteSession(id: number): Promise<boolean>;

  // Session Interactions
  getSessionInteractions(sessionId: number): Promise<SessionInteraction[]>;
  createSessionInteraction(interaction: InsertSessionInteraction): Promise<SessionInteraction>;
  getViewerInteractions(sessionId: number, viewerName: string): Promise<SessionInteraction[]>;
  
  // Latest Session Results
  getLatestCompletedSession(): Promise<{ session: PresentationSession; viewers: any[]; totalSlides: number } | undefined>;
}

export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Presentations
  async getPresentation(id: number): Promise<Presentation | undefined> {
    const [presentation] = await db.select().from(presentations).where(eq(presentations.id, id));
    return presentation || undefined;
  }

  async getPresentations(): Promise<Presentation[]> {
    return await db.select().from(presentations);
  }

  async getPublicPresentations(): Promise<Presentation[]> {
    return await db.select().from(presentations).where(eq(presentations.isPublic, true));
  }

  async getUserQuizzes(userId: number): Promise<Quiz[]> {
    return await db.select().from(quizzes).where(eq(quizzes.createdBy, userId));
  }

  async createQuiz(insertQuiz: InsertQuiz): Promise<Quiz> {
    const [quiz] = await db
      .insert(quizzes)
      .values(insertQuiz)
      .returning();
    return quiz;
  }

  async updateQuiz(id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    const [quiz] = await db
      .update(quizzes)
      .set(updates)
      .where(eq(quizzes.id, id))
      .returning();
    return quiz;
  }

  async deleteQuiz(id: number): Promise<boolean> {
    const result = await db.delete(quizzes).where(eq(quizzes.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Games
  async getGame(id: number): Promise<Game | undefined> {
    const [game] = await db.select().from(games).where(eq(games.id, id));
    return game || undefined;
  }

  async getGameByPin(pin: string): Promise<Game | undefined> {
    const [game] = await db.select().from(games).where(eq(games.gamePin, pin));
    return game || undefined;
  }

  async createGame(insertGame: InsertGame): Promise<Game> {
    const [game] = await db
      .insert(games)
      .values(insertGame)
      .returning();
    return game;
  }

  async updateGame(id: number, updates: Partial<Game>): Promise<Game | undefined> {
    const [game] = await db
      .update(games)
      .set(updates)
      .where(eq(games.id, id))
      .returning();
    return game || undefined;
  }

  async deleteGame(id: number): Promise<boolean> {
    const result = await db.delete(games).where(eq(games.id, id));
    return (result.rowCount || 0) > 0;
  }

  // Game Responses
  async getGameResponses(gameId: number): Promise<GameResponse[]> {
    return await db.select().from(gameResponses).where(eq(gameResponses.gameId, gameId));
  }

  async createGameResponse(insertResponse: InsertGameResponse): Promise<GameResponse> {
    const [response] = await db
      .insert(gameResponses)
      .values(insertResponse)
      .returning();
    return response;
  }

  async updateGameResponse(id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    const [response] = await db
      .update(gameResponses)
      .set(updates)
      .where(eq(gameResponses.id, id))
      .returning();
    return response || undefined;
  }

  async getPlayerResponses(gameId: number, playerName: string): Promise<GameResponse[]> {
    const { and } = await import("drizzle-orm");
    return await db
      .select()
      .from(gameResponses)
      .where(and(
        eq(gameResponses.gameId, gameId),
        eq(gameResponses.playerName, playerName)
      ));
  }

  async getLatestCompletedGame(): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    const { desc } = await import("drizzle-orm");
    
    // Get the most recent completed game
    const [latestGame] = await db
      .select()
      .from(games)
      .where(eq(games.status, "completed"))
      .orderBy(desc(games.id))
      .limit(1);

    if (!latestGame) {
      return undefined;
    }

    // Get the quiz to determine total questions
    const quiz = await this.getQuiz(latestGame.quizId);
    if (!quiz) {
      return undefined;
    }

    const players = (latestGame.players as any[]) || [];
    const totalQuestions = (quiz.questions as any[])?.length || 0;

    return {
      game: latestGame,
      players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
      totalQuestions
    };
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export class MemStorage implements IStorage {
  private users: Map<number, User>;
  private quizzes: Map<number, Quiz>;
  private games: Map<number, Game>;
  private gameResponses: Map<number, GameResponse>;
  private currentUserId: number;
  private currentQuizId: number;
  private currentGameId: number;
  private currentResponseId: number;

  constructor() {
    this.users = new Map();
    this.quizzes = new Map();
    this.games = new Map();
    this.gameResponses = new Map();
    this.currentUserId = 1;
    this.currentQuizId = 1;
    this.currentGameId = 1;
    this.currentResponseId = 1;

    // Add some sample quizzes
    this.initializeSampleData();
  }

  private initializeSampleData() {
    // Sample user
    const sampleUser: User = {
      id: 1,
      username: "demo_user",
      password: "password123"
    };
    this.users.set(1, sampleUser);
    this.currentUserId = 2;

    // Sample quizzes
    const sampleQuizzes: Quiz[] = [
      {
        id: 1,
        title: "World Geography Challenge",
        description: "Test your knowledge of countries, capitals, and landmarks around the globe.",
        createdBy: 1,
        questions: [
          {
            question: "What is the capital of France?",
            answers: ["Paris", "London", "Madrid", "Berlin"],
            correctAnswer: 0,
            timeLimit: 30
          },
          {
            question: "Which planet is known as the Red Planet?",
            answers: ["Venus", "Mars", "Jupiter", "Earth"],
            correctAnswer: 1,
            timeLimit: 30
          },
          {
            question: "What is the largest ocean on Earth?",
            answers: ["Atlantic", "Indian", "Arctic", "Pacific"],
            correctAnswer: 3,
            timeLimit: 30
          }
        ],
        isPublic: true,
        createdAt: new Date()
      },
      {
        id: 2,
        title: "Science Trivia",
        description: "Explore fascinating facts about biology, chemistry, and physics.",
        createdBy: 1,
        questions: [
          {
            question: "What is the chemical symbol for gold?",
            answers: ["Go", "Gd", "Au", "Ag"],
            correctAnswer: 2,
            timeLimit: 30
          },
          {
            question: "How many chambers does a human heart have?",
            answers: ["2", "3", "4", "5"],
            correctAnswer: 2,
            timeLimit: 30
          }
        ],
        isPublic: true,
        createdAt: new Date()
      },
      {
        id: 3,
        title: "Math Masters",
        description: "Challenge yourself with algebra, geometry, and calculus problems.",
        createdBy: 1,
        questions: [
          {
            question: "What is 15% of 200?",
            answers: ["25", "30", "35", "40"],
            correctAnswer: 1,
            timeLimit: 30
          }
        ],
        isPublic: true,
        createdAt: new Date()
      }
    ];

    sampleQuizzes.forEach(quiz => {
      this.quizzes.set(quiz.id, quiz);
    });
    this.currentQuizId = 4;
  }

  // Users
  async getUser(id: number): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = this.currentUserId++;
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Quizzes
  async getQuiz(id: number): Promise<Quiz | undefined> {
    return this.quizzes.get(id);
  }

  async getQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizzes.values());
  }

  async getPublicQuizzes(): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(quiz => quiz.isPublic);
  }

  async getUserQuizzes(userId: number): Promise<Quiz[]> {
    return Array.from(this.quizzes.values()).filter(quiz => quiz.createdBy === userId);
  }

  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const id = this.currentQuizId++;
    const newQuiz: Quiz = {
      id,
      title: quiz.title,
      description: quiz.description || null,
      questions: quiz.questions,
      isPublic: quiz.isPublic ?? true,
      createdBy: quiz.createdBy,
      createdAt: new Date()
    };
    this.quizzes.set(id, newQuiz);
    return newQuiz;
  }

  async updateQuiz(id: number, updates: Partial<InsertQuiz>): Promise<Quiz> {
    const existing = this.quizzes.get(id);
    if (!existing) {
      throw new Error("Quiz not found");
    }
    
    const updated: Quiz = {
      ...existing,
      ...updates,
      id: existing.id,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt
    };
    
    this.quizzes.set(id, updated);
    return updated;
  }



  async deleteQuiz(id: number): Promise<boolean> {
    return this.quizzes.delete(id);
  }

  // Games
  async getGame(id: number): Promise<Game | undefined> {
    return this.games.get(id);
  }

  async getGameByPin(pin: string): Promise<Game | undefined> {
    return Array.from(this.games.values()).find(game => game.gamePin === pin);
  }

  async createGame(insertGame: InsertGame): Promise<Game> {
    const id = this.currentGameId++;
    const game: Game = { 
      ...insertGame, 
      id,
      currentQuestion: 0,
      players: [],
      createdAt: new Date()
    };
    this.games.set(id, game);
    return game;
  }

  async updateGame(id: number, updates: Partial<Game>): Promise<Game | undefined> {
    const game = this.games.get(id);
    if (!game) return undefined;
    
    const updatedGame = { ...game, ...updates };
    this.games.set(id, updatedGame);
    return updatedGame;
  }

  async deleteGame(id: number): Promise<boolean> {
    return this.games.delete(id);
  }

  // Game Responses
  async getGameResponses(gameId: number): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      response => response.gameId === gameId
    );
  }

  async createGameResponse(insertResponse: InsertGameResponse): Promise<GameResponse> {
    const id = this.currentResponseId++;
    const response: GameResponse = { ...insertResponse, id };
    this.gameResponses.set(id, response);
    return response;
  }

  async updateGameResponse(id: number, updates: Partial<GameResponse>): Promise<GameResponse | undefined> {
    const response = this.gameResponses.get(id);
    if (!response) return undefined;
    
    const updatedResponse = { ...response, ...updates };
    this.gameResponses.set(id, updatedResponse);
    return updatedResponse;
  }

  async getPlayerResponses(gameId: number, playerName: string): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      response => response.gameId === gameId && response.playerName === playerName
    );
  }

  async getLatestCompletedGame(): Promise<{ game: Game; players: any[]; totalQuestions: number } | undefined> {
    // Get the most recent completed game
    const completedGames = Array.from(this.games.values())
      .filter(game => game.status === "completed")
      .sort((a, b) => b.id - a.id);

    if (completedGames.length === 0) {
      return undefined;
    }

    const latestGame = completedGames[0];
    
    // Get the quiz to determine total questions
    const quiz = await this.getQuiz(latestGame.quizId);
    if (!quiz) {
      return undefined;
    }

    const players = (latestGame.players as any[]) || [];
    const totalQuestions = (quiz.questions as any[])?.length || 0;

    return {
      game: latestGame,
      players: players.sort((a, b) => (b.score || 0) - (a.score || 0)),
      totalQuestions
    };
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const storage = new DatabaseStorage();
