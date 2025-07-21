import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export default function JoinGame() {
  const { pin: urlPin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  
  const [gamePin, setGamePin] = useState(urlPin || "");
  const [playerName, setPlayerName] = useState("");
  const [step, setStep] = useState<"pin" | "name">(urlPin ? "name" : "pin");

  // Auto-fill player name if user is authenticated
  useEffect(() => {
    if (isAuthenticated && user && !playerName) {
      setPlayerName(user.username);
    }
  }, [isAuthenticated, user, playerName]);

  const checkGameMutation = useMutation({
    mutationFn: async (pin: string) => {
      const response = await apiRequest("GET", `/api/games/${pin}`);
      return response.json();
    },
    onSuccess: () => {
      setStep("name");
    },
    onError: () => {
      toast({
        title: "Game Not Found",
        description: "Please check the game PIN and try again.",
        variant: "destructive",
      });
    }
  });

  const joinGameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/games/${gamePin}/join`, {
        playerName: playerName.trim()
      });
      return response.json();
    },
    onSuccess: () => {
      setLocation(`/play/${gamePin}?player=${encodeURIComponent(playerName.trim())}`);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to Join",
        description: error.message || "Unable to join the game. Please try again.",
        variant: "destructive",
      });
    }
  });

  const handlePinSubmit = () => {
    if (!gamePin.trim()) {
      toast({
        title: "Invalid PIN",
        description: "Please enter a valid game PIN.",
        variant: "destructive",
      });
      return;
    }
    checkGameMutation.mutate(gamePin.trim());
  };

  const handleNameSubmit = () => {
    if (!playerName.trim()) {
      toast({
        title: "Invalid Name",
        description: "Please enter your name.",
        variant: "destructive",
      });
      return;
    }
    joinGameMutation.mutate();
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4">
        {step === "pin" ? (
          <Card className="shadow-2xl">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Join a Game</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <img 
                  src="https://images.unsplash.com/photo-1434030216411-0b793f4b4173?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=400&h=200" 
                  alt="Students actively using mobile devices to participate in quiz" 
                  className="rounded-lg w-full h-32 object-cover mb-4"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Game PIN
                </label>
                <Input
                  type="text"
                  value={gamePin}
                  onChange={(e) => setGamePin(e.target.value)}
                  placeholder="Enter Game PIN"
                  className="text-center text-2xl font-bold"
                  onKeyPress={(e) => e.key === 'Enter' && handlePinSubmit()}
                  autoFocus
                />
              </div>
              
              <Button
                onClick={handlePinSubmit}
                disabled={checkGameMutation.isPending}
                className="w-full abraj-primary hover:abraj-secondary text-white font-bold text-lg py-3"
              >
                {checkGameMutation.isPending ? "Checking..." : "Continue"}
              </Button>
              
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/")}
                  className="text-gray-500"
                >
                  Back to Home
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="shadow-2xl">
            <CardHeader>
              <CardTitle className="text-center text-2xl">Enter Your Name</CardTitle>
              <p className="text-center text-gray-600">Game PIN: {gamePin}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <div className="abraj-primary text-white w-20 h-20 rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4">
                  {playerName.charAt(0).toUpperCase() || "?"}
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Your Name
                  {isAuthenticated && user && (
                    <span className="text-abraj-primary text-xs ml-2">
                      (Auto-filled from your account)
                    </span>
                  )}
                </label>
                <Input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder={isAuthenticated && user ? user.username : "Enter your name"}
                  className="text-center text-xl font-medium"
                  maxLength={20}
                  onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
                  autoFocus
                />
                {!isAuthenticated && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    <Button
                      variant="link"
                      onClick={() => setLocation("/login")}
                      className="text-abraj-primary p-0 h-auto text-xs"
                    >
                      Login
                    </Button>
                    {" "}to auto-fill your name
                  </p>
                )}
              </div>
              
              <Button
                onClick={handleNameSubmit}
                disabled={joinGameMutation.isPending}
                className="w-full abraj-green hover:bg-green-600 text-white font-bold text-lg py-3"
              >
                {joinGameMutation.isPending ? "Joining..." : "Join Game"}
              </Button>
              
              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setStep("pin")}
                  className="text-gray-500"
                >
                  Change PIN
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
