import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

interface GameClient {
  ws: WebSocket;
  gamePin: string;
  playerName?: string;
  isHost: boolean;
}

class GameWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, GameClient[]> = new Map();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/game-ws" });

    this.wss.on("connection", (ws: WebSocket) => {
      console.log("New WebSocket connection");

      ws.on("message", (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(ws, data);
        } catch (error) {
          console.error("WebSocket message error:", error);
        }
      });

      ws.on("close", () => {
        this.removeClient(ws);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.removeClient(ws);
      });
    });

    console.log("WebSocket server initialized");
  }

  private handleMessage(ws: WebSocket, data: any) {
    const { type, gamePin, playerName, isHost } = data;

    if (type === "join") {
      this.addClient(ws, gamePin, playerName, isHost);
      ws.send(JSON.stringify({ type: "joined", gamePin }));
    } else if (type === "leave") {
      this.removeClient(ws);
    }
  }

  private addClient(ws: WebSocket, gamePin: string, playerName?: string, isHost = false) {
    const client: GameClient = { ws, gamePin, playerName, isHost };
    
    if (!this.clients.has(gamePin)) {
      this.clients.set(gamePin, []);
    }
    
    this.clients.get(gamePin)!.push(client);
    console.log(`Client joined game ${gamePin}. Total clients: ${this.clients.get(gamePin)!.length}`);
  }

  private removeClient(ws: WebSocket) {
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

    clients.forEach(client => {
      if (excludeHost && client.isHost) return;
      
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        sentCount++;
      }
    });

    console.log(`Broadcast to game ${gamePin}: ${message.type}, sent to ${sentCount} clients`);
  }

  broadcastToHosts(gamePin: string, message: any) {
    const clients = this.clients.get(gamePin);
    if (!clients) return;

    const payload = JSON.stringify(message);
    let sentCount = 0;

    clients.forEach(client => {
      if (client.isHost && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
        sentCount++;
      }
    });

    console.log(`Broadcast to hosts in game ${gamePin}: ${message.type}, sent to ${sentCount} hosts`);
  }

  getClientCount(gamePin: string): number {
    return this.clients.get(gamePin)?.length || 0;
  }
}

export const gameWS = new GameWebSocketServer();
