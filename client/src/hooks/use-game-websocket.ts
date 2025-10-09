import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface UseGameWebSocketOptions {
  gamePin: string;
  playerName?: string;
  isHost?: boolean;
  enabled?: boolean;
}

export function useGameWebSocket({ gamePin, playerName, isHost = false, enabled = true }: UseGameWebSocketOptions) {
  const wsRef = useRef<WebSocket | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const isActiveRef = useRef<boolean>(true);

  const connect = useCallback(() => {
    if (!enabled || !gamePin || !isActiveRef.current) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/game-ws`;
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
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
          const message = JSON.parse(event.data);
          console.log("WebSocket message received:", message.type);

          switch (message.type) {
            case "joined":
              console.log("Successfully joined game via WebSocket");
              break;

            case "game_updated":
            case "game_started":
            case "next_question":
            case "game_completed":
              // Invalidate game query to trigger refetch with new data
              queryClient.invalidateQueries({ queryKey: ["/api/games", gamePin] });
              
              // If it's a question change, also invalidate question results
              if (message.type === "next_question") {
                queryClient.invalidateQueries({ 
                  queryKey: ["/api/games", gamePin, "question-results"] 
                });
              }
              break;

            default:
              console.log("Unknown WebSocket message type:", message.type);
          }
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected from game:", gamePin);
        wsRef.current = null;
        
        // Attempt to reconnect after 2 seconds if still enabled AND component is active
        if (enabled && isActiveRef.current) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("Attempting to reconnect WebSocket...");
            connect();
          }, 2000);
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

  return { disconnect };
}
