import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Trophy } from "lucide-react";
import { apiRequest, retryTransient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Game, Quiz, Question } from "@shared/schema";
import { getBackgroundStyle } from "@/utils/backgrounds";
import { useGameWebSocket } from "@/hooks/use-game-websocket";
import { ConnectionBanner } from "@/components/connection-banner";
import { encodeSelection } from "@shared/quiz-scoring";
import { QuizQuestionRenderer } from "@/components/quiz/QuizQuestionRenderer";
import { QUIZ_STAGE_CONTAINER } from "@/components/quiz/layout";
import { resolveQuizTheme } from "@shared/quiz-theme";

export default function PlayGame() {
  const { t } = useTranslation();
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const playUrgentCountdownSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'square';
      gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    }
  };
  
  // Get player name from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const playerName = urlParams.get('player') || '';
  
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]); // multi-select
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [lastResult, setLastResult] = useState<{ isCorrect: boolean; pointsEarned: number; streak: number } | null>(null);
  const [scoreAtQuestionStart, setScoreAtQuestionStart] = useState(0);
  const [showTimeUpEffect, setShowTimeUpEffect] = useState(false);
  const [soundPlayed, setSoundPlayed] = useState(false);
  // Consecutive-correct streak from the answer-submit HTTP response (Task 1/2).
  // Captured on submit so it's available when the question closes and the
  // correct/incorrect screen renders.
  const [submittedStreak, setSubmittedStreak] = useState(0);
  // Rank movement vs. the previous question_closed — displayed on the result
  // screen ("moved up/down N places"). prevRankRef persists ACROSS questions
  // (it is the baseline the next close diffs against); positionDelta is the
  // transient display value, cleared whenever a new question starts.
  const [positionDelta, setPositionDelta] = useState<{ direction: "up" | "down"; places: number } | null>(null);
  const prevRankRef = useRef<number | null>(null);


  // Use WebSocket for real-time updates
  const { runtimeState, connectionStatus } = useGameWebSocket({
    gamePin: pin || "",
    playerName,
    isHost: false,
    enabled: !!pin && !!playerName
  });

  const { data: game, isLoading } = useQuery<Game>({
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

  // Computed early (before the hooks below reference it in dependency
  // arrays) and defensively against game/quiz still being undefined during
  // the initial load — the later render-only derivations (players, noLimit,
  // etc.) stay below the loading/not-found guards where game/quiz are known.
  const questions = (quiz?.questions as Question[] | undefined) || [];
  const currentQuestionIndex = runtimeState.questionIndex ?? game?.currentQuestion ?? 0;
  const currentQuestion = questions[currentQuestionIndex];
  const isPoll = currentQuestion?.type === "poll";

  const submitAnswerMutation = useMutation({
    mutationFn: async (answerData: {
      selectedAnswer: number;
      responseTime: number;
    }) => {
      const response = await apiRequest("POST", `/api/games/${pin}/answer`, {
        playerName,
        questionIndex: game?.currentQuestion || 0,
        selectedAnswer: answerData.selectedAnswer,
        responseTime: answerData.responseTime
      });
      return response.json();
    },
    onSuccess: (data) => {
      setSubmittedStreak(typeof data?.streak === "number" ? data.streak : 0);
    },
    onError: () => {
      setHasAnswered(false);
      setSelectedAnswer(null);
      toast({
        title: t("play.submitFailedTitle"),
        description: t("play.submitFailed"),
        variant: "destructive",
      });
    }
  });

  useEffect(() => {
    if (!playerName) {
      setLocation(`/join/${pin}`);
      return;
    }
  }, [playerName, pin, setLocation]);

  // No automatic countdown for players - they see the game directly when it starts
  // The countdown is only for the host when starting the game

  useEffect(() => {
    if (runtimeState.questionIndex === null) return;

    setTimeLeft(runtimeState.timeRemaining);
    if (runtimeState.status === "open") {
      setShowResult(false);
      setShowTimeUpEffect(false);
      const players = runtimeState.players || (game?.players as any[]) || [];
      const currentPlayer = players.find((player) => player.name === playerName);
      setScoreAtQuestionStart(currentPlayer?.score || 0);
    }

    // Polls have no correct/incorrect framing or points — they're handled by
    // dedicated screens further down, driven off runtimeState.status directly.
    if (runtimeState.status === "closed" && hasAnswered && !isPoll) {
      const players = runtimeState.players || (game?.players as any[]) || [];
      const currentPlayer = players.find((player) => player.name === playerName);
      // Correctness is derived from the authoritative score delta (works for
      // single- AND multi-select: the server awards points only when correct).
      const pointsEarned = Math.max(0, (currentPlayer?.score || 0) - scoreAtQuestionStart);
      const isCorrect = pointsEarned > 0;

      setLastResult({ isCorrect, pointsEarned, streak: submittedStreak });
    }
  }, [
    runtimeState.questionIndex,
    runtimeState.timeRemaining,
    runtimeState.status,
    runtimeState.correctAnswer,
    runtimeState.players,
    game?.players,
    playerName,
    hasAnswered,
    selectedAnswer,
    scoreAtQuestionStart,
    isPoll,
    submittedStreak,
  ]);

  // Rank movement vs. the previous question_closed. prevRankRef is the
  // baseline from the last close and MUST persist across questions (that's
  // the whole point of "vs. the previous close") — only positionDelta (what's
  // actually rendered) is cleared per-question, below.
  useEffect(() => {
    if (runtimeState.status !== "closed" || runtimeState.questionIndex == null || !runtimeState.players) return;

    const sorted = [...runtimeState.players].sort((a, b) => (b.score || 0) - (a.score || 0));
    const newRank = sorted.findIndex((p) => p.name === playerName) + 1 || null;
    const prevRank = prevRankRef.current;

    if (newRank != null && prevRank != null && newRank !== prevRank) {
      setPositionDelta(
        newRank < prevRank
          ? { direction: "up", places: prevRank - newRank }
          : { direction: "down", places: newRank - prevRank },
      );
    } else {
      setPositionDelta(null);
    }

    if (newRank != null) prevRankRef.current = newRank;
  }, [runtimeState.status, runtimeState.questionIndex, runtimeState.players, playerName]);

  // A fresh lobby means a brand-new game session — the rank baseline from any
  // earlier game no longer applies. (Mid-game "next_question" deliberately
  // does NOT reset prevRankRef: it must persist across questions so each new
  // close can diff against the previous one.)
  useEffect(() => {
    if (game?.status === "waiting") {
      prevRankRef.current = null;
      setPositionDelta(null);
    }
  }, [game?.status]);

  useEffect(() => {
    if (timeLeft !== null && timeLeft > 0 && timeLeft <= 3 && !hasAnswered) {
      playUrgentCountdownSound();
    }
  }, [timeLeft, hasAnswered]);

  // Show results when timer reaches 0 AND we have a result from answering
  useEffect(() => {
    if (runtimeState.status === "closed" && lastResult && hasAnswered) {
      setShowResult(true);
    } else if (runtimeState.status === "closed" && !hasAnswered) {
      // Show time-up effect for players who haven't answered
      setShowTimeUpEffect(true);
      playTimeUpSound(); // Play time-up sound effect

      // Hide time-up effect after 3 seconds; clear on unmount / deps change so
      // we don't call setState on an unmounted component.
      const timer = setTimeout(() => {
        setShowTimeUpEffect(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [runtimeState.status, lastResult, hasAnswered]);

  // Reset sound flag when question changes
  useEffect(() => {
    setSoundPlayed(false);
    setShowResult(false);
    setLastResult(null);
    setHasAnswered(false);
    setSelectedAnswer(null);
    setSelectedIndices([]);
    setShowTimeUpEffect(false);
    setSubmittedStreak(0);
    // The displayed delta is per-question; the historical baseline (prevRankRef)
    // is intentionally left alone here so the NEXT close can diff against it.
    setPositionDelta(null);
  }, [game?.currentQuestion, runtimeState.questionIndex]);

  // Play sound immediately when results are shown (only once per question)
  useEffect(() => {
    if (showResult && lastResult && !soundPlayed) {
      // Immediate sound feedback when results become visible
      if (lastResult.isCorrect) {
        playCorrectSound();
      } else {
        playWrongSound();
      }
      setSoundPlayed(true);
    }
  }, [showResult, lastResult, soundPlayed]);

  useEffect(() => {
    if (game?.status === "completed" || runtimeState.status === "completed") {
      setLocation(`/results/${pin}?player=${encodeURIComponent(playerName)}`);
    }
  }, [game?.status, runtimeState.status, pin, playerName, setLocation]);

  // Warn before leaving if player is in an active game
  useEffect(() => {
    if (!game || !playerName) return;
    
    const shouldWarn = game.status === "waiting" || game.status === "active";
    
    if (shouldWarn) {
      const handleBeforeUnload = (e: BeforeUnloadEvent) => {
        e.preventDefault();
        e.returnValue = "";
        return "";
      };
      
      window.addEventListener("beforeunload", handleBeforeUnload);
      
      return () => {
        window.removeEventListener("beforeunload", handleBeforeUnload);
      };
    }
  }, [game?.status, playerName]);

  // Sound effects
  const playClickSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 600;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    }
  };



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

  const playWrongSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Enhanced wrong answer sound with dramatic discord
      // Play dissonant chord progression for wrong answers
      const discordantNotes = [200, 220, 170, 150]; // Dissonant low frequencies
      discordantNotes.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'square'; // Harsh square wave for dramatic effect
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime + index * 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.05 + 0.6);
        
        oscillator.start(audioContext.currentTime + index * 0.05);
        oscillator.stop(audioContext.currentTime + index * 0.05 + 0.6);
      });
      
      // Add declining tone for disappointment effect
      const decliningFreqs = [300, 250, 180, 120]; // Descending sad tones
      decliningFreqs.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'sawtooth';
        gainNode.gain.setValueAtTime(0.12, audioContext.currentTime + 0.3 + index * 0.15);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3 + index * 0.15 + 0.5);
        
        oscillator.start(audioContext.currentTime + 0.3 + index * 0.15);
        oscillator.stop(audioContext.currentTime + 0.3 + index * 0.15 + 0.5);
      });
    }
  };

  const playTimeUpSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      
      // Play descending tone sequence for time-up effect
      const frequencies = [440, 330, 220]; // A, E, A (lower)
      frequencies.forEach((freq, index) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        oscillator.frequency.value = freq;
        oscillator.type = 'triangle';
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime + index * 0.2);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + index * 0.2 + 0.5);
        
        oscillator.start(audioContext.currentTime + index * 0.2);
        oscillator.stop(audioContext.currentTime + index * 0.2 + 0.5);
      });
    }
  };

  const handleAnswerSelect = (answerIndex: number) => {
    if (hasAnswered || (!noLimit && timeLeft === 0) || runtimeState.status !== "open") return;
    playClickSound();

    if (currentQuestion?.answerType === "multiple") {
      // Multi-select: toggle, don't submit yet (confirm with the Submit button).
      setSelectedIndices((prev) =>
        prev.includes(answerIndex) ? prev.filter((i) => i !== answerIndex) : [...prev, answerIndex],
      );
      return;
    }

    // Single-select: submit immediately (selectedAnswer IS the index).
    setSelectedAnswer(answerIndex);
    setHasAnswered(true);
    submitAnswerMutation.mutate({ selectedAnswer: answerIndex, responseTime: 0 });
  };

  const handleSubmitMulti = () => {
    if (hasAnswered || (!noLimit && timeLeft === 0) || runtimeState.status !== "open" || selectedIndices.length === 0) return;
    setHasAnswered(true);
    // Encode the chosen options as a bitmask for the multi-select answer.
    submitAnswerMutation.mutate({ selectedAnswer: encodeSelection("multiple", selectedIndices), responseTime: 0 });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">{t("play.loadingGame")}</p>
        </div>
      </div>
    );
  }

  if (!game || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-600 mb-4">{t("play.gameNotFound")}</p>
            <Button onClick={() => setLocation("/")} className="abraj-primary">
              {t("play.goHome")}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // questions / currentQuestionIndex / currentQuestion / isPoll are computed
  // earlier (before the hooks above) so they're available in dependency arrays.
  const noLimit = currentQuestion?.timeLimit === 0;
  const isMulti = currentQuestion?.answerType === "multiple";
  const players = runtimeState.players || (game.players as any[]) || [];
  const currentPlayer = players.find(p => p.name === playerName);
  const currentRank = players
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .findIndex(p => p.name === playerName) + 1;

  // Time-up effect overlay component
  const TimeUpOverlay = () => {
    if (!showTimeUpEffect) return null;
    
    return (
      <div className="fixed inset-0 bg-red-500 bg-opacity-80 flex items-center justify-center z-50 animate-pulse">
        <div className="text-center">
          <div className="w-40 h-40 rounded-full bg-white flex items-center justify-center font-bold text-4xl mx-auto mb-6 animate-bounce text-red-500 shadow-2xl">
            ⏰
          </div>
          <h2 className="text-white text-4xl font-bold mb-2 animate-bounce">{t("play.timesUp")}</h2>
          <p className="text-white text-xl">{t("play.didntAnswerInTime")}</p>
        </div>
      </div>
    );
  };



  if (game.status === "waiting") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <ConnectionBanner status={connectionStatus} />
        <Card className="w-full max-w-md mx-4 bg-white/95 backdrop-blur-sm">
          <CardContent className="pt-6 text-center space-y-6">
            <div className="abraj-primary text-white w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl mx-auto">
              {playerName.charAt(0).toUpperCase()}
            </div>
            
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">{t("play.welcomePlayer", { name: playerName })}</h2>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                {t("play.gamePinBadge", { pin: game.gamePin })}
              </Badge>
            </div>

            <div>
              <h3 className="font-bold text-lg mb-2">{quiz.title}</h3>
              <p className="text-gray-600">{quiz.description}</p>
            </div>

            <div className="flex justify-between text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
              <span>{t("play.questionsCount", { count: questions.length })}</span>
              <span>{t("play.playersCount", { count: players.length })}</span>
            </div>

            <p className="text-gray-600">{t("play.waitingForHost")}</p>
            
            <div className="animate-pulse flex justify-center">
              <div className="abraj-primary w-2 h-2 rounded-full mx-1"></div>
              <div className="abraj-primary w-2 h-2 rounded-full mx-1"></div>
              <div className="abraj-primary w-2 h-2 rounded-full mx-1"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Poll, still open (or closing) after the player has voted: no correct/
  // incorrect framing, no points — just an acknowledgement.
  if (isPoll && hasAnswered && runtimeState.status !== "closed") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-700 animate-in fade-in duration-300">
        <ConnectionBanner status={connectionStatus} />
        <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-10 py-12 text-center shadow-2xl max-w-md">
          <p className="text-2xl font-bold text-gray-800">{t("play.voteRecorded")}</p>
        </div>
      </div>
    );
  }

  // Poll closed: show the distribution via the shared renderer — reveal is on,
  // but AnswerGrid/QuizQuestionRenderer suppress the correct ring/✓/✗ for
  // question.type === "poll" (there is no correct answer to leak).
  if (isPoll && runtimeState.status === "closed") {
    return (
      <div className="h-[calc(100dvh-68px)] overflow-hidden flex flex-col p-3 sm:p-4 bg-slate-900">
        <ConnectionBanner status={connectionStatus} />
        <div className={QUIZ_STAGE_CONTAINER}>
          <div className="flex-shrink-0 mb-2 text-center">
            <h2 className="text-white text-xl sm:text-2xl font-bold">{t("play.pollResults")}</h2>
          </div>
          {currentQuestion && (
            <div className="flex-1 min-h-0">
              <QuizQuestionRenderer
                question={currentQuestion}
                background={quiz?.background || "classroom"}
                theme={theme}
                questionNumber={currentQuestionIndex + 1}
                totalQuestions={questions.length}
                reveal
                correctAnswers={[]}
                distribution={
                  runtimeState.answerCounts
                    ? { counts: runtimeState.answerCounts, percentages: runtimeState.answerPercentages ?? [] }
                    : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  if (showResult && lastResult) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${
        lastResult.isCorrect ? 'bg-green-500' : 'bg-red-500'
      } animate-in fade-in duration-300`}>
        <ConnectionBanner status={connectionStatus} />
        {/* Large Icon */}
        <div className={`mb-8 animate-in zoom-in-50 duration-500 ${
          lastResult.isCorrect ? '' : 'animate-bounce'
        }`}>
          {lastResult.isCorrect ? (
            <Check className="w-32 h-32 text-white drop-shadow-2xl" strokeWidth={3} />
          ) : (
            <X className="w-32 h-32 text-white drop-shadow-2xl" strokeWidth={3} />
          )}
        </div>
        
        {/* Result Text */}
        <h1 className="text-white text-6xl md:text-7xl font-black mb-6 animate-in slide-in-from-bottom-4 duration-500 delay-100 drop-shadow-lg">
          {lastResult.isCorrect ? t("play.correct") : t("play.incorrect")}
        </h1>

        {/* Points Earned */}
        {lastResult.isCorrect && (
          <div className="text-white text-3xl font-bold mb-4 animate-in zoom-in-75 duration-500 delay-200">
            {t("play.pointsEarned", { points: lastResult.pointsEarned })}
          </div>
        )}

        {/* Streak Badge — only for a correct answer with a streak of 2+ */}
        {lastResult.isCorrect && lastResult.streak >= 2 && (
          <div className="mb-8 animate-in zoom-in-75 duration-500 delay-200">
            <span className="inline-block bg-orange-500 text-white text-xl font-extrabold px-5 py-2 rounded-full shadow-lg">
              {t("play.streak", { n: lastResult.streak })}
            </span>
          </div>
        )}

        {/* Correct answer is shown on the host/results screens, not leaked from the answer API. */}
        {!lastResult.isCorrect && (
          <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-8 py-4 mb-8 animate-in slide-in-from-bottom-3 duration-500 delay-200">
            <p className="text-white text-xl font-semibold text-center">
              {t("play.waitForReveal")}
            </p>
          </div>
        )}

        {/* Score and Rank Cards */}
        <div className="flex gap-4 mb-8 animate-in slide-in-from-bottom-2 duration-500 delay-300">
          {/* Score Card */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 text-center shadow-2xl">
            <p className="text-gray-600 text-sm mb-1">{t("play.scoreLabel")}</p>
            <p className="text-4xl font-black text-gray-800">{(currentPlayer?.score || 0).toLocaleString()}</p>
          </div>

          {/* Rank Card */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 text-center shadow-2xl">
            <p className="text-gray-600 text-sm mb-1">{t("play.rankLabel")}</p>
            <div className="flex items-center justify-center">
              {currentRank === 1 ? (
                <Trophy className="w-10 h-10 text-yellow-500" />
              ) : (
                <p className="text-4xl font-black text-gray-800">{currentRank}</p>
              )}
            </div>
          </div>
        </div>

        {/* Position Delta — vs. the previous question_closed rank */}
        {positionDelta && (
          <p className="text-white text-lg font-semibold mb-2 animate-in fade-in duration-500">
            {positionDelta.direction === "up"
              ? t("play.movedUp", { count: positionDelta.places })
              : t("play.movedDown", { count: positionDelta.places })}
          </p>
        )}

        {/* Waiting Message */}
        <p className="text-white text-lg animate-pulse">{t("play.waitingNextQuestion")}</p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-68px)] overflow-hidden flex flex-col p-3 sm:p-4 bg-slate-900">
      <ConnectionBanner status={connectionStatus} />
      <TimeUpOverlay />
      <div className={QUIZ_STAGE_CONTAINER}>
        {/* Shared question stage — identical component to preview + host */}
        {currentQuestion && (
          <div className="flex-1 min-h-0 mb-3">
            <QuizQuestionRenderer
              question={currentQuestion}
              background={quiz?.background || "classroom"}
              theme={theme}
              questionNumber={currentQuestionIndex + 1}
              totalQuestions={questions.length}
              timeRemaining={noLimit ? null : timeLeft}
              selectedIndices={isMulti ? selectedIndices : (selectedAnswer != null ? [selectedAnswer] : [])}
              onSelect={handleAnswerSelect}
              disabled={hasAnswered || (!noLimit && timeLeft === 0) || runtimeState.status !== "open"}
            />
          </div>
        )}

        {/* Multi-select confirm */}
        {isMulti && !hasAnswered && runtimeState.status === "open" && (
          <div className="flex-shrink-0 mb-3">
            <Button
              onClick={handleSubmitMulti}
              disabled={selectedIndices.length === 0}
              className="w-full abraj-primary text-white font-bold py-3 rounded-xl"
            >
              {t("play.submit")} {selectedIndices.length > 0 ? t("play.selectedCount", { count: selectedIndices.length }) : ""}
            </Button>
          </div>
        )}

        {/* Player Info */}
        <div className="flex-shrink-0">
          <div className="glass card-3d-enhanced rounded-lg p-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">{t("play.scoreLabelColon")}</span>
              <span className="font-bold gradient-text text-sm">{(currentPlayer?.score || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">{t("play.rankLabelColon")}</span>
              <span className="font-bold">{t("play.rankOfTotal", { rank: currentRank, total: players.length })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
