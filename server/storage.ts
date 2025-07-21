import { 
  users, quizzes, games, gameResponses,
  type User, type InsertUser,
  type Quiz, type InsertQuiz,
  type Game, type InsertGame,
  type GameResponse, type InsertGameResponse
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  // Quizzes
  getQuiz(id: number): Promise<Quiz | undefined>;
  getQuizzes(): Promise<Quiz[]>;
  getPublicQuizzes(): Promise<Quiz[]>;
  createQuiz(quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(id: number, quiz: Partial<Quiz>): Promise<Quiz | undefined>;
  deleteQuiz(id: number): Promise<boolean>;

  // Games
  getGame(id: number): Promise<Game | undefined>;
  getGameByPin(pin: string): Promise<Game | undefined>;
  createGame(game: InsertGame): Promise<Game>;
  updateGame(id: number, game: Partial<Game>): Promise<Game | undefined>;
  deleteGame(id: number): Promise<boolean>;

  // Game Responses
  getGameResponses(gameId: number): Promise<GameResponse[]>;
  createGameResponse(response: InsertGameResponse): Promise<GameResponse>;
  getPlayerResponses(gameId: number, playerName: string): Promise<GameResponse[]>;
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

  async createQuiz(insertQuiz: InsertQuiz): Promise<Quiz> {
    const id = this.currentQuizId++;
    const quiz: Quiz = { 
      ...insertQuiz, 
      id,
      createdAt: new Date()
    };
    this.quizzes.set(id, quiz);
    return quiz;
  }

  async updateQuiz(id: number, updates: Partial<Quiz>): Promise<Quiz | undefined> {
    const quiz = this.quizzes.get(id);
    if (!quiz) return undefined;
    
    const updatedQuiz = { ...quiz, ...updates };
    this.quizzes.set(id, updatedQuiz);
    return updatedQuiz;
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

  async getPlayerResponses(gameId: number, playerName: string): Promise<GameResponse[]> {
    return Array.from(this.gameResponses.values()).filter(
      response => response.gameId === gameId && response.playerName === playerName
    );
  }

  // Helper method to generate unique game PIN
  generateGamePin(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const storage = new MemStorage();
