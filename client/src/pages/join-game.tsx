import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, apiRequestWithBackoff } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";

export default function JoinGame() {
  const { t } = useTranslation();
  const { pin: urlPin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { user, isAuthenticated } = useAuth();
  
  const [gamePin, setGamePin] = useState(urlPin || "");
  const [playerName, setPlayerName] = useState("");
  const [step, setStep] = useState<"pin" | "name">(urlPin ? "name" : "pin");
  // When the name step appeared. "Join Game" renders at the same screen
  // position as "Continue", so a double-click on Continue (or a second tap on
  // a slow network) lands on Join Game right after the async step flip and
  // instantly joins with the auto-filled account name — creating a ghost
  // player once the user renames and joins again. Submissions inside a short
  // grace window after the flip are ignored.
  const [nameStepReadyAt, setNameStepReadyAt] = useState(() => (urlPin ? Date.now() : 0));

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
      setNameStepReadyAt(Date.now());
    },
    onError: () => {
      toast({
        title: t("join.gameNotFoundTitle"),
        description: t("join.gameNotFoundDescription"),
        variant: "destructive",
      });
    }
  });

  const joinGameMutation = useMutation({
    mutationFn: async () => {
      // Auto-retry on 503 GAME_BUSY (transient DB contention during a join
      // storm) with exponential backoff + full jitter. A full lobby (409
      // GAME_FULL) or duplicate name (400) is not retried — it throws straight
      // to onError.
      const response = await apiRequestWithBackoff("POST", `/api/games/${gamePin}/join`, {
        playerName: playerName.trim()
      });
      return response.json();
    },
    onSuccess: () => {
      setLocation(`/play/${gamePin}?player=${encodeURIComponent(playerName.trim())}`);
    },
    onError: (error: any) => {
      // Known server error codes get a translated message; unknown codes fall
      // back to whatever the server sent (English, as received).
      const code = error?.response?.code as string | undefined;
      const description =
        code === "GAME_FULL"
          ? t("join.gameFull")
          : code === "GAME_BUSY"
            ? t("join.gameBusy")
            : error.message || t("join.unableToJoin");
      toast({
        title: t("join.failedToJoinTitle"),
        description,
        variant: "destructive",
      });
    }
  });

  const handlePinSubmit = () => {
    if (!gamePin.trim()) {
      toast({
        title: t("join.invalidPinTitle"),
        description: t("join.invalidPinDescription"),
        variant: "destructive",
      });
      return;
    }
    checkGameMutation.mutate(gamePin.trim());
  };

  const handleNameSubmit = () => {
    // Ignore click-through from the Continue button (same screen position)
    // and double-submits while a join is already in flight.
    if (Date.now() - nameStepReadyAt < 400) return;
    if (joinGameMutation.isPending) return;
    if (!playerName.trim()) {
      toast({
        title: t("join.invalidNameTitle"),
        description: t("join.invalidNameDescription"),
        variant: "destructive",
      });
      return;
    }
    joinGameMutation.mutate();
  };

  return (
    <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center py-8">
      <div className="max-w-md w-full mx-4 animate-scale-in">
        {step === "pin" ? (
          <Card className="card-3d-enhanced glass">
            <CardHeader>
              <CardTitle className="text-center text-2xl gradient-text">{t("join.title")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <img
                  src="https://images.unsplash.com/photo-1434030216411-0b793f4b4173?ixlib=rb-4.0.3&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=400&h=200"
                  alt={t("join.heroImageAlt")}
                  className="rounded-lg w-full h-32 object-cover mb-4"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("join.gamePinLabel")}
                </label>
                <Input
                  type="text"
                  value={gamePin}
                  onChange={(e) => setGamePin(e.target.value)}
                  placeholder={t("join.gamePinPlaceholder")}
                  className="text-center text-2xl font-bold shimmer"
                  onKeyPress={(e) => e.key === 'Enter' && handlePinSubmit()}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- sole input on this dedicated PIN-entry step
                  autoFocus
                  data-testid="input-game-pin"
                />
              </div>

              <Button
                onClick={handlePinSubmit}
                disabled={checkGameMutation.isPending}
                className="w-full font-bold text-lg py-3"
                data-testid="button-continue"
              >
                {checkGameMutation.isPending ? t("join.checking") : t("join.continue")}
              </Button>

              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setLocation("/")}
                  className="text-gray-500"
                >
                  {t("join.backToHome")}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="card-3d-enhanced glass">
            <CardHeader>
              <CardTitle className="text-center text-2xl gradient-text">{t("join.enterYourName")}</CardTitle>
              <p className="text-center text-gray-600">{t("join.gamePinDisplay", { pin: gamePin })}</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="text-center">
                <div className="bg-primary text-primary-foreground w-20 h-20 rounded-full flex items-center justify-center font-bold text-3xl mx-auto mb-4">
                  {playerName.charAt(0).toUpperCase() || "?"}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t("join.yourNameLabel")}
                  {isAuthenticated && user && (
                    <span className="text-abraj-primary text-xs ms-2">
                      {t("join.autoFilledFromAccount")}
                    </span>
                  )}
                </label>
                <Input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder={isAuthenticated && user ? user.username : t("join.namePlaceholder")}
                  className="text-center text-xl font-medium shimmer"
                  maxLength={20}
                  onKeyPress={(e) => e.key === 'Enter' && handleNameSubmit()}
                  // eslint-disable-next-line jsx-a11y/no-autofocus -- sole input on this dedicated name-entry step
                  autoFocus
                  data-testid="input-player-name"
                />
                {!isAuthenticated && (
                  <p className="text-xs text-gray-500 mt-2 text-center">
                    <Button
                      variant="link"
                      onClick={() => setLocation("/login")}
                      className="text-primary p-0 h-auto text-xs"
                    >
                      {t("join.login")}
                    </Button>
                    {" "}{t("join.autoFillHint")}
                  </p>
                )}
              </div>

              <Button
                onClick={handleNameSubmit}
                disabled={joinGameMutation.isPending}
                className="w-full abraj-green hover:bg-green-600 text-white font-bold text-lg py-3"
                data-testid="button-join-game"
              >
                {joinGameMutation.isPending ? t("join.joining") : t("join.joinGame")}
              </Button>

              <div className="text-center">
                <Button
                  variant="ghost"
                  onClick={() => setStep("pin")}
                  className="text-gray-500"
                >
                  {t("join.changePin")}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
