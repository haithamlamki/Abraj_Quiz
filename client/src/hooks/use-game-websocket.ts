import { useEffect, useRef, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WsServerMessage } from "@shared/ws-protocol";

let devFallbackLogged = false;

interface UseGameWebSocketOptions {
  gamePin: string;
  playerName?: string;
  isHost?: boolean;
  enabled?: boolean;
}

export interface RuntimeQuestionState {
  status: "idle" | "open" | "closed" | "completed";
  questionIndex: number | null;
  timeRemaining: number | null;
  correctAnswer?: number;
  answerCounts?: number[];
  answerPercentages?: number[];
  totalResponses?: number;
  players?: any[];
}

export function useGameWebSocket({ gamePin, playerName, isHost = false, enabled = true }: UseGameWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isActiveRef = useRef<boolean>(true);
  const reconnectAttemptsRef = useRef(0);
  const [runtimeState, setRuntimeState] = useState<RuntimeQuestionState>({
    status: "idle",
    questionIndex: null,
    timeRemaining: null,
  });

  const connect = useCallback(() => {
    if (!enabled || !gamePin || !isActiveRef.current) return;

    const rawWsUrl = (import.meta.env.VITE_WS_URL ?? "").trim();

    if (import.meta.env.PROD) {
      if (!rawWsUrl) {
        throw new Error(
          "VITE_WS_URL must be set in production builds. Static frontend cannot serve WebSocket connections.",
        );
      }
      if (!rawWsUrl.startsWith("wss://")) {
        console.warn(
          `VITE_WS_URL is "${rawWsUrl}" — production should use wss:// to match the https frontend.`,
        );
      }
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = rawWsUrl || `${protocol}//${window.location.host}/game-ws`;

    if (!rawWsUrl && import.meta.env.DEV && !devFallbackLogged) {
      devFallbackLogged = true;
      console.info(
        `[useGameWebSocket] VITE_WS_URL not set; using dev fallback ${wsUrl}`,
      );
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        console.log("WebSocket connected to game:", gamePin);
        ws.send(JSON.stringify({
          type: "join",
          gamePin,
          playerName,
          isHost
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as WsServerMessage;
          console.log("WebSocket message received:", message.type);

          switch (message.type) {
            case "joined":
              console.log("Successfully joined game via WebSocket");
              break;

            case "game_updated":
            case "game_started":
            case "next_question":
              // Invalidate game query to trigger refetch with new data
              queryClient.invalidateQueries({ queryKey: ["/api/games", gamePin] });
              if (message.type === "next_question") {
                setRuntimeState({
                  status: "idle",
                  questionIndex: null,
                  timeRemaining: null,
                });
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/games", gamePin, "question-results"] 
                });
              }
              break;

            case "question_started":
              setRuntimeState({
                status: "open",
                questionIndex: message.questionIndex,
                timeRemaining: message.timeRemaining,
              });
              queryClient.invalidateQueries({ queryKey: ["/api/games", gamePin] });
              break;

            case "time_remaining":
              setRuntimeState((current) => ({
                ...current,
                status: "open",
                questionIndex: message.questionIndex,
                timeRemaining: message.timeRemaining,
              }));
              break;

            case "question_closed":
              setRuntimeState({
                status: "closed",
                questionIndex: message.questionIndex,
                timeRemaining: 0,
                correctAnswer: message.correctAnswer,
                answerCounts: message.distribution.answerCounts,
                answerPercentages: message.distribution.answerPercentages,
                totalResponses: message.distribution.totalResponses,
                players: message.players,
              });
              queryClient.invalidateQueries({ queryKey: ["/api/games", gamePin] });
              queryClient.invalidateQueries({ 
                queryKey: ["/api/games", gamePin, "question-results"] 
              });
              break;

            case "game_completed":
              setRuntimeState((current) => ({
                ...current,
                status: "completed",
                timeRemaining: 0,
              }));
              queryClient.invalidateQueries({ queryKey: ["/api/games", gamePin] });
              break;

            case "error":
              console.warn("WebSocket protocol error:", message.code, message.message);
              break;

            default:
              console.log("Unknown WebSocket message type");
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = (event) => {
        console.log("WebSocket disconnected from game:", gamePin);
        wsRef.current = null;
        
        // Policy violation usually means invalid room, invalid host session, or invalid player membership.
        if (enabled && isActiveRef.current && event.code !== 1008) {
          const attempt = reconnectAttemptsRef.current++;
          const delay = Math.min(30000, 1000 * 2 ** attempt);
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("Attempting to reconnect WebSocket...");
            connect();
          }, delay);
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
    }
  }, [gamePin, playerName, isHost, enabled, queryClient]);

  const disconnect = useCallback(() => {
    // Mark as inactive to prevent reconnection
    isActiveRef.current = false;
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "leave" }));
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    isActiveRef.current = true;
    connect();
    
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { disconnect, runtimeState };
}
