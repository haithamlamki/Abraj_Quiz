import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Play, SkipForward, Copy, Share2 } from "lucide-react";
import { apiRequest, retryTransient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Game, Quiz, Question } from "@shared/schema";
import QRCode from "qrcode";
import { getBackgroundStyle } from "@/utils/backgrounds";
import { QuizQuestionRenderer } from "@/components/quiz/QuizQuestionRenderer";
import { QUIZ_STAGE_CONTAINER } from "@/components/quiz/layout";
import { useGameWebSocket } from "@/hooks/use-game-websocket";
import { ConnectionBanner } from "@/components/connection-banner";
import { resolveQuizTheme } from "@shared/quiz-theme";
import { PageLoader } from "@/components/page-loader";

export default function HostGame() {
  const { t } = useTranslation();
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [gameStartCountdown, setGameStartCountdown] = useState<number | null>(null);
  const [isStartingGame, setIsStartingGame] = useState(false);
  const [soundPlayed, setSoundPlayed] = useState(false);

  // Sound effects for countdown
  const playCountdownSound = (count: number) => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Different frequencies for countdown vs warning
      oscillator.frequency.value = count === 0 ? 880 : 440; // Higher pitch for final beep
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }
  };

  const playUrgentCountdownSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800; // Urgent high pitch
      oscillator.type = 'square';
      gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: t("host.copiedTitle"),
        description: t("host.copiedDescription", { label }),
      });
    } catch {
      toast({
        title: t("host.copyFailedTitle"),
        description: t("host.copyFailedDescription"),
        variant: "destructive",
      });
    }
  };

  // Use WebSocket for real-time updates
  const { runtimeState, connectionStatus } = useGameWebSocket({
    gamePin: pin || "",
    isHost: true,
    enabled: !!pin
  });

  const { data: game, isLoading: gameLoading } = useQuery<Game>({
    queryKey: ["/api/games", pin],
    enabled: !!pin,
    retry: retryTransient,
    retryDelay: (attempt) => Math.min(4000, 500 * 2 ** attempt)
  });

  const { data: quiz } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", game?.quizId],
    enabled: !!game?.quizId,
    retry: retryTransient,
    retryDelay: (attempt) => Math.min(4000, 500 * 2 ** attempt)
  });

  const theme = resolveQuizTheme(quiz ?? {});

  const { data: questionResults } = useQuery<{answerPercentages: number[], answerCounts: number[]}>({
    queryKey: ["/api/games", pin, "question-results", game?.currentQuestion],
    enabled: !!pin && !!game && showResults && game.status === "active",
    refetchInterval: showResults ? 500 : false
  });

  const startGameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/games/${pin}/start`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games", pin] });
      toast({
        title: t("host.gameStartedTitle"),
        description: t("host.gameStartedDescription"),
      });
    },
    onError: (error: any) => {
      // Reset the lobby so the host can retry instead of being stuck.
      setIsStartingGame(false);
      setGameStartCountdown(null);
      toast({
        title: t("host.startGameFailedTitle"),
        description: error?.message || t("host.pleaseTryAgain"),
        variant: "destructive",
      });
    }
  });

  const nextQuestionMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/games/${pin}/next-question`, {});
      return response.json();
    },
    onSuccess: (data) => {
      if (data.gameComplete) {
        setLocation(`/results/${pin}`);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/games", pin] });
        setShowResults(false);
        // timeLeft is owned by the runtimeState effect below. Nulling it here
        // races the question_started broadcast: for no-limit questions there
        // are no time_remaining ticks to repopulate it, so the host's
        // Next/Finish button (gated on timeLeft === 0) would never render.
      }
    },
    onError: (error: any) => {
      toast({
        title: t("host.advanceGameFailedTitle"),
        description: error?.message || t("host.pleaseTryAgain"),
        variant: "destructive",
      });
    }
  });

  useEffect(() => {
    if (runtimeState.questionIndex !== null) {
      setTimeLeft(runtimeState.timeRemaining);
      setShowResults(runtimeState.status === "closed");
    }
  }, [runtimeState.questionIndex, runtimeState.timeRemaining, runtimeState.status]);

  // Generate QR code when game loads
  useEffect(() => {
    if (game && !qrCodeUrl) {
      const gameUrl = `${window.location.origin}/join/${game.gamePin}`;
      QRCode.toDataURL(gameUrl, {
        width: 256,
        margin: 2,
        color: {
          dark: '#0EA5E9', // Abraj blue color
          light: '#FFFFFF'
        }
      }).then(setQrCodeUrl).catch(console.error);
    }
  }, [game, qrCodeUrl]);

  // Game start countdown effect
  useEffect(() => {
    if (gameStartCountdown === null || !isStartingGame) return;

    if (gameStartCountdown > 0) {
      playCountdownSound(gameStartCountdown);
      const timer = setTimeout(() => {
        setGameStartCountdown(prev => prev! - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      // Countdown finished, start the game
      setIsStartingGame(false);
      setGameStartCountdown(null);
      startGameMutation.mutate();
    }
  }, [gameStartCountdown, isStartingGame, startGameMutation]);

  useEffect(() => {
    if (timeLeft !== null && timeLeft > 0 && timeLeft <= 3 && !showResults) {
      playUrgentCountdownSound();
    }
  }, [timeLeft, showResults]);

  // Reset sound flag when question changes
  useEffect(() => {
    console.log('Question changed to', game?.currentQuestion, 'resetting state');
    setSoundPlayed(false);
    setShowResults(false);
    // Do NOT reset timeLeft here: the runtimeState effect above mirrors it
    // from server state, and this effect runs after it in the same commit.
    // Nulling it would erase the timeRemaining=0 of a no-limit question
    // (which never ticks), hiding the host's Next/Finish button forever.
  }, [game?.currentQuestion, runtimeState.questionIndex]);

  // Play correct answer sound immediately when results are shown (only once per question)
  useEffect(() => {
    if (showResults && game && quiz && !soundPlayed) {
      const questions = quiz.questions as Question[];
      const currentQ = questions[game.currentQuestion || 0];
      if (currentQ) {
        // Play sound immediately when results become visible
        playCorrectSound();
        setSoundPlayed(true);
      }
    }
  }, [showResults, game, quiz, soundPlayed]);

  // Warn before leaving if game is active
  const shouldWarnBeforeUnload = game?.status === "waiting" || game?.status === "active";

  useEffect(() => {
    if (!shouldWarnBeforeUnload) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [shouldWarnBeforeUnload]);

  if (gameLoading) {
    return <PageLoader label={t("play.loadingGame")} />;
  }

  if (!game || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-600 mb-4">{t("play.gameNotFound")}</p>
            <Button onClick={() => setLocation("/")}>
              {t("play.goHome")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const questions = quiz.questions as Question[];
  const currentQuestion = questions[game.currentQuestion || 0];
  const noLimit = currentQuestion?.timeLimit === 0;
  const players = runtimeState.players || (game.players as any[]) || [];

  // Countdown overlay component
  const CountdownOverlay = () => {
    if (!isStartingGame || gameStartCountdown === null) return null;
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
        <div className="text-center">
          <div className={`w-32 h-32 rounded-full flex items-center justify-center font-bold text-6xl mx-auto mb-6 ${
            gameStartCountdown === 3 ? 'bg-red-500 animate-pulse' :
            gameStartCountdown === 2 ? 'bg-yellow-500 animate-bounce' :
            'bg-green-500 animate-ping'
          } text-white shadow-2xl`}>
            {gameStartCountdown}
          </div>
          <h2 className="text-white text-2xl font-bold">{t("host.gameStarting")}</h2>
        </div>
      </div>
    );
  };

  if (game.status === "waiting") {
    return (
      <div className="h-screen overflow-y-auto py-8 animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <ConnectionBanner status={connectionStatus} />
        <CountdownOverlay />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex flex-col">
          <div className="text-center mb-8">
            <h1 className="font-bold text-4xl mb-4 gradient-text">{t("host.gameLobby")}</h1>
            <div className="flex justify-center items-center space-x-4 mb-6">
              <Badge variant="secondary" className="inline-flex items-center rounded-full border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent hover:bg-secondary/80 text-lg px-4 py-2 bg-[#019ebd] text-[#ffffff] pulse-ring">
                {t("host.pinBadge", { pin: game.gamePin })}
              </Badge>
              <Badge className="text-lg px-4 py-2 bg-[#019ebd] text-[#ffffff]">
                {quiz.title}
              </Badge>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-4 flex-1 min-h-0">
            <Card className="card-3d-enhanced glass flex flex-col">
              <CardHeader className="flex-shrink-0">
                <CardTitle className="flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>{t("host.playersHeading", { count: players.length })}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 overflow-y-auto">
                {players.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    {t("host.waitingForPlayers")}
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {players.map((player, index) => (
                      <div key={index} className="player-card-float card-3d-enhanced bg-gray-100 rounded-lg p-3 text-center">
                        <span className="font-medium">{player.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="card-3d-enhanced glass flex flex-col">
              <CardHeader className="flex-shrink-0">
                <CardTitle>{t("host.shareGame")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 flex-shrink-0">
                {qrCodeUrl && (
                  <div className="text-center space-y-1">
                    <img
                      src={qrCodeUrl}
                      alt={t("host.qrCodeAlt")}
                      className="w-24 h-24 mx-auto"
                      data-testid="img-join-qr"
                    />
                    <p className="text-xs text-gray-500">{t("host.scanToJoinShort")}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(game.gamePin, t("host.gamePinLabel"))}
                    className="w-full py-2"
                  >
                    <Copy className="w-4 h-4 me-2" />
                    {t("host.copyPinWithValue", { pin: game.gamePin })}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(`${window.location.origin}/join/${game.gamePin}`, t("host.joinLinkLabel"))}
                    className="w-full py-2"
                  >
                    <Share2 className="w-4 h-4 me-2" />
                    {t("host.copyJoinLink")}
                  </Button>
                </div>

                <div className="pt-2 border-t">
                  <div className="text-center space-y-1 mb-3">
                    <h3 className="font-bold text-base">{quiz.title}</h3>
                    <p className="text-xs text-gray-500">
                      {t("host.questionsMultipleChoice", { count: questions.length })}
                    </p>
                  </div>

                  <Button
                    onClick={() => {
                      if (players.length === 0) return;
                      setIsStartingGame(true);
                      setGameStartCountdown(3);
                    }}
                    disabled={players.length === 0 || startGameMutation.isPending || isStartingGame}
                    variant="success"
                    className="w-full font-bold text-base py-2"
                  >
                    <Play className="w-4 h-4 me-2" />
                    {isStartingGame ? t("host.startingInCountdown", { count: gameStartCountdown }) : t("host.startGame")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }



  const playCorrectSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Enhanced celebratory correct answer sound
      // Play main triumphant chord progression: C major scale ascending
      const mainNotes = [523, 587, 659, 698, 784, 880, 988]; // C, D, E, F, G, A, B
      mainNotes.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime + index * 0.08);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.08 + 0.3);
        
        oscillator.start(audioContext.currentTime + index * 0.08);
        oscillator.stop(audioContext.currentTime + index * 0.08 + 0.3);
      });
      
      // Add harmonic chord at the end for richness
      const harmonicChord = [523, 659, 784, 1047]; // C, E, G, C (octave)
      harmonicChord.forEach((freq) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'triangle';
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime + 0.5);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.2);
        
        oscillator.start(audioContext.currentTime + 0.5);
        oscillator.stop(audioContext.currentTime + 1.2);
      });
      
      // Add sparkle effect with high-pitched bell-like tones
      const sparkleNotes = [1318, 1567, 1760, 2093]; // E6, G6, A6, C7
      sparkleNotes.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sine';
        gainNode.gain.setValueAtTime(0.08, audioContext.currentTime + 0.3 + index * 0.1);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3 + index * 0.1 + 0.4);
        
        oscillator.start(audioContext.currentTime + 0.3 + index * 0.1);
        oscillator.stop(audioContext.currentTime + 0.3 + index * 0.1 + 0.4);
      });
    }
  };



  if (game.status === "active") {
    return (
      <div className="h-[calc(100dvh-68px)] overflow-hidden flex flex-col p-3 sm:p-4 bg-slate-900">
        <ConnectionBanner status={connectionStatus} />
        <div className={`${QUIZ_STAGE_CONTAINER} relative`}>
          {/* Next Question Button - Top End */}
          {(showResults || timeLeft === 0) && (
            <div className="absolute top-0 end-0 z-10">
              <Button
                onClick={() => {
                  nextQuestionMutation.mutate();
                  playCountdownSound(3);
                }}
                disabled={nextQuestionMutation.isPending}
                className="px-6 py-2 font-bold shadow-lg"
              >
                <SkipForward className="w-4 h-4 me-2 rtl:rotate-180" />
                {(game.currentQuestion || 0) + 1 >= questions.length ? t("host.finishGame") : t("host.nextQuestion")}
              </Button>
            </div>
          )}
          
          {/* Shared question stage — identical component to preview + player */}
          {currentQuestion && (
            <div className="flex-1 min-h-0 mb-3">
              <QuizQuestionRenderer
                question={currentQuestion}
                background={quiz?.background || "classroom"}
                theme={theme}
                questionNumber={(game.currentQuestion || 0) + 1}
                totalQuestions={questions.length}
                timeRemaining={!showResults && !noLimit ? timeLeft : null}
                reveal={showResults}
                correctAnswers={runtimeState.correctAnswers ?? (currentQuestion as any).correctAnswers ?? []}
                distribution={
                  showResults && (runtimeState.answerCounts || questionResults?.answerCounts)
                    ? {
                        counts: runtimeState.answerCounts ?? questionResults?.answerCounts ?? [],
                        percentages: runtimeState.answerPercentages ?? questionResults?.answerPercentages ?? [],
                      }
                    : undefined
                }
              />
            </div>
          )}

          {/* Game Info & Leaderboard in Compact Row */}
          <div className="grid grid-cols-2 gap-2 flex-shrink-0">
            <div className="glass card-3d-enhanced rounded-lg p-2">
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-gray-600">{t("host.pinLabel")}</span>
                <span className="font-bold text-[#019ebd]">{game.gamePin}</span>
              </div>
              <div className="flex justify-between items-center text-xs mb-1">
                <span className="text-gray-600">{t("host.playersLabel")}</span>
                <span className="font-bold">{players.length}</span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-gray-600">{t("host.progressLabel")}</span>
                <span className="font-bold">{(game.currentQuestion || 0) + 1}/{questions.length}</span>
              </div>
            </div>

            <div className="glass card-3d-enhanced rounded-lg p-2">
              <div className="text-center text-xs font-bold mb-1">{t("host.topThree")}</div>
              <div className="space-y-1">
                {players.slice(0, 3).map((player, idx) => (
                  <div key={idx} className="flex justify-between items-center text-[10px]">
                    <span className="truncate">{player.name}</span>
                    <span className="font-bold ms-1">{player.score || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
