import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { gameRoomManager } from "./game-room-manager";
import { wsClientMessageSchema, type WsServerMessage } from "@shared/ws-protocol";
import { verifyToken } from "./token";

interface GameClient {
  ws: WebSocket;
  gamePin: string;
  playerName?: string;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
}

type SessionRequest = IncomingMessage & {
  session?: {
    userId?: number;
    username?: string;
  };
};

interface InitializeOptions {
  allowedOrigins?: string[];
  getAllowedOrigins?: () => string[];
  sessionMiddleware?: (req: any, res: any, next: (err?: unknown) => void) => void;
}

export function isOriginAllowed(
  allowedOrigins: string[],
  origin: string | undefined,
  isProduction: boolean,
): boolean {
  if (allowedOrigins.length === 0) {
    return !isProduction;
  }

  return !!origin && allowedOrigins.includes(origin);
}

class GameWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, GameClient[]> = new Map();
  private messageTimestamps: WeakMap<WebSocket, number[]> = new WeakMap();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private allowedOrigins: string[] = [];
  private originProvider: () => string[] = () => this.allowedOrigins;
  private sessionMiddleware?: InitializeOptions["sessionMiddleware"];

  private readonly gamePinPattern = /^\d{6}$/;
  private readonly maxMessageBytes = 2048;
  private readonly maxMessagesPerMinute = 30;
  private readonly maxClientsPerGame = 250;

  initialize(server: Server, options: InitializeOptions = {}) {
    this.allowedOrigins = options.allowedOrigins || [];
    this.originProvider = options.getAllowedOrigins ?? (() => this.allowedOrigins);
    this.sessionMiddleware = options.sessionMiddleware;

    this.wss = new WebSocketServer({
      server,
      path: "/game-ws",
      maxPayload: this.maxMessageBytes,
    });

    this.wss.on("connection", (ws: WebSocket, request: SessionRequest) => {
      if (!this.isAllowedOrigin(request.headers.origin)) {
        ws.close(1008, "Origin not allowed");
        return;
      }

      // Attach lifecycle listeners synchronously so cleanup runs even if the
      // socket dies during session hydration.
      let closed = false;
      ws.on("close", () => {
        closed = true;
        this.removeClient(ws);
      });
      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.removeClient(ws);
      });
      ws.on("pong", () => {
        gameRoomManager.markSocketSeen(ws);
      });

      // Buffer inbound messages until session hydration finishes. The `'message'`
      // listener MUST be attached synchronously: hydrateSession is an async
      // Postgres lookup and the client (legitimately) sends `join` immediately
      // after the WS open event, well before hydrate resolves. Without this
      // queue the early message would be dropped — Node's EventEmitter doesn't
      // buffer events for late listeners.
      let hydrated = false;
      let hydrationFailed = false;
      const pending: RawData[] = [];

      const processMessage = async (message: RawData): Promise<void> => {
        try {
          if (!this.checkRateLimit(ws)) {
            this.safeSend(ws, { type: "error", code: "INVALID_PAYLOAD", message: "Too many WebSocket messages" });
            ws.close(1008, "Rate limit exceeded");
            return;
          }
          const data = this.parseMessage(message);
          await this.handleMessage(ws, request, data);
        } catch (error) {
          console.error("WebSocket message error:", error);
          this.safeSend(ws, { type: "error", code: "INVALID_PAYLOAD", message: "Invalid WebSocket message" });
        }
      };

      ws.on("message", (message: RawData) => {
        if (hydrationFailed) return;
        if (!hydrated) {
          pending.push(message);
          return;
        }
        void processMessage(message);
      });

      void this.hydrateSession(request)
        .then(async () => {
          if (closed) return;
          console.log("New WebSocket connection");
          // Drain queued messages in arrival order before flipping to the live
          // path. New messages received during the drain re-enter the queue
          // (hydrated is still false) and get drained in subsequent iterations.
          while (pending.length > 0 && !closed) {
            const next = pending.shift()!;
            await processMessage(next);
          }
          if (!closed) hydrated = true;
        })
        .catch((error) => {
          console.error("WebSocket session parse error:", error);
          hydrationFailed = true;
          pending.length = 0;
          this.safeSend(ws, {
            type: "error",
            code: "SESSION_HYDRATION_FAILED",
            message: "Session unavailable",
          });
          ws.close(4001, "session_hydration_failed");
        });
    });

    console.log("WebSocket server initialized");
    this.startHeartbeat();
  }

  private async handleMessage(ws: WebSocket, request: SessionRequest, data: any) {
    if (!data || typeof data !== "object") {
      throw new Error("Message must be an object");
    }

    const validation = wsClientMessageSchema.safeParse(data);
    if (!validation.success) {
      this.safeSend(ws, { type: "error", code: "INVALID_PAYLOAD", message: "Invalid WebSocket payload" });
      return;
    }

    const message = validation.data;

    if (message.type === "join") {
      try {
        const auth = this.resolveAuth(request);
        await gameRoomManager.registerClient({
          ws,
          gamePin: message.gamePin,
          playerName: message.playerName,
          wantsHostRole: Boolean(message.isHost),
          userId: auth.userId,
          tokenTenantId: auth.tokenTenantId,
        });
      } catch (error) {
        const httpError = gameRoomManager.toHttpError(error);
        this.safeSend(ws, {
          type: "error",
          code: httpError.body.code || "INVALID_PAYLOAD",
          message: httpError.body.message,
        });
        ws.close(1008, httpError.body.code || "INVALID_PAYLOAD");
      }
    } else if (message.type === "leave") {
      this.removeClient(ws);
    } else {
      this.safeSend(ws, { type: "error", code: "INVALID_PAYLOAD", message: "Unsupported WebSocket message type" });
    }
  }

  private removeClient(ws: WebSocket) {
    gameRoomManager.removeClient(ws);

    for (const [gamePin, clients] of Array.from(this.clients.entries())) {
      const index = clients.findIndex((c: GameClient) => c.ws === ws);
      if (index !== -1) {
        clients.splice(index, 1);
        console.log(`Client left game ${gamePin}. Remaining clients: ${clients.length}`);
        
        if (clients.length === 0) {
          this.clients.delete(gamePin);
        }
        break;
      }
    }
  }

  broadcastToGame(gamePin: string, message: any, excludeHost = false) {
    const clients = this.clients.get(gamePin);
    if (!clients) return;

    const payload = JSON.stringify(message);
    let sentCount = 0;

    for (const client of [...clients]) {
      if (excludeHost && client.isHost) continue;
      
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        client.lastSeenAt = Date.now();
        sentCount++;
      } else {
        this.removeClient(client.ws);
      }
    }

    console.log(`Broadcast to game ${gamePin}: ${message.type}, sent to ${sentCount} clients`);
  }

  broadcastToHosts(gamePin: string, message: any) {
    const clients = this.clients.get(gamePin);
    if (!clients) return;

    const payload = JSON.stringify(message);
    let sentCount = 0;

    for (const client of [...clients]) {
      if (client.isHost && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        client.lastSeenAt = Date.now();
        sentCount++;
      } else if (client.ws.readyState !== WebSocket.OPEN) {
        this.removeClient(client.ws);
      }
    }

    console.log(`Broadcast to hosts in game ${gamePin}: ${message.type}, sent to ${sentCount} hosts`);
  }

  getClientCount(gamePin: string): number {
    return this.clients.get(gamePin)?.length || 0;
  }

  private parseMessage(message: RawData): any {
    const payload = message.toString("utf8");
    if (Buffer.byteLength(payload, "utf8") > this.maxMessageBytes) {
      throw new Error("Message too large");
    }

    return JSON.parse(payload);
  }

  private checkRateLimit(ws: WebSocket): boolean {
    const now = Date.now();
    const windowStart = now - 60_000;
    const timestamps = (this.messageTimestamps.get(ws) || []).filter((timestamp) => timestamp > windowStart);
    timestamps.push(now);
    this.messageTimestamps.set(ws, timestamps);
    return timestamps.length <= this.maxMessagesPerMinute;
  }

  private findClient(ws: WebSocket): GameClient | undefined {
    for (const clients of Array.from(this.clients.values())) {
      const client = clients.find((item: GameClient) => item.ws === ws);
      if (client) return client;
    }

    return undefined;
  }

  private safeSend(ws: WebSocket, message: WsServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    return isOriginAllowed(
      this.originProvider(),
      origin,
      process.env.NODE_ENV === "production",
    );
  }

  // Host identity comes from a bearer token in the WS URL (?token=...) when
  // present — cookies are third-party on a cross-site WS and get dropped — and
  // falls back to the hydrated session cookie for same-site clients.
  private resolveAuth(request: SessionRequest): { userId: number | undefined; tokenTenantId: number | undefined } {
    try {
      const token = new URL(request.url || "", "http://localhost").searchParams.get("token");
      const payload = verifyToken(token);
      if (payload) return { userId: payload.userId, tokenTenantId: payload.tenantId };
    } catch {
      // ignore malformed URL/token — fall through to the session
    }
    return { userId: request.session?.userId, tokenTenantId: undefined };
  }

  private hydrateSession(request: SessionRequest): Promise<void> {
    if (!this.sessionMiddleware) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const response = {
        getHeader: () => undefined,
        setHeader: () => undefined,
        writeHead: () => undefined,
      };

      this.sessionMiddleware!(request, response, (error?: unknown) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      gameRoomManager.heartbeat(90_000);
    }, 30_000);

    this.heartbeatInterval.unref();
  }
}

export const gameWS = new GameWebSocketServer();
