import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Check, X, Trophy, Triangle, Diamond, Circle, Square } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Game, Quiz, Question } from "@shared/schema";
import { getBackgroundStyle } from "@/utils/backgrounds";
import { useGameWebSocket } from "@/hooks/use-game-websocket";

export default function PlayGame() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Sound effects for countdown
  const playCountdownSound = (count: number) => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = count === 0 ? 880 : 440;
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
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [playerScore, setPlayerScore] = useState(0);
  const [showTimeUpEffect, setShowTimeUpEffect] = useState(false);
  const [soundPlayed, setSoundPlayed] = useState(false);


  // Use WebSocket for real-time updates
  useGameWebSocket({
    gamePin: pin || "",
    playerName,
    isHost: false,
    enabled: !!pin && !!playerName
  });

  const { data: game, isLoading } = useQuery<Game>({
    queryKey: ["/api/games", pin],
    enabled: !!pin
  });

  const { data: quiz } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", game?.quizId],
    enabled: !!game?.quizId
  });

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
      // Store the result but don't show it until timer expires
      setLastResult(data);
      setPlayerScore(prev => prev + (data.pointsEarned || 0));
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to submit answer. Please try again.",
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
    if (game?.status === "active" && quiz) {
      const questions = quiz.questions as Question[];
      const currentQuestion = questions[game.currentQuestion || 0];
      if (currentQuestion) {
        console.log('Player: Setting timer for question', game.currentQuestion, 'to', currentQuestion.timeLimit);
        setTimeLeft(currentQuestion.timeLimit);
        setShowResult(false);
        setSelectedAnswer(null);
        setHasAnswered(false);
        setShowTimeUpEffect(false);
        
        // Backup timer initialization after 1 second if timer doesn't start
        setTimeout(() => {
          if (timeLeft === null || timeLeft === currentQuestion.timeLimit) {
            console.log('Player: Backup timer initialization triggered');
            setTimeLeft(currentQuestion.timeLimit);
          }
        }, 1000);
      }
    }
  }, [game?.currentQuestion, game?.status, quiz]);

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    console.log('Player: Starting countdown timer from', timeLeft);
    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          console.log('Player: Timer reached 0');
          return 0;
        }
        // Play urgent sound for last 3 seconds
        if (prev <= 3) {
          playUrgentCountdownSound();
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      console.log('Player: Clearing countdown timer');
      clearInterval(timer);
    };
  }, [timeLeft]);

  // Show results when timer reaches 0 AND we have a result from answering
  useEffect(() => {
    if (timeLeft === 0 && lastResult && hasAnswered) {
      setShowResult(true);
    } else if (timeLeft === 0 && !hasAnswered) {
      // Show time-up effect for players who haven't answered
      setShowTimeUpEffect(true);
      playTimeUpSound(); // Play time-up sound effect
      
      // Hide time-up effect after 3 seconds
      setTimeout(() => {
        setShowTimeUpEffect(false);
      }, 3000);
    }
  }, [timeLeft, lastResult, hasAnswered]);

  // Reset sound flag when question changes
  useEffect(() => {
    setSoundPlayed(false);
    setShowResult(false);
    setLastResult(null);
    setHasAnswered(false);
    setSelectedAnswer(null);
    setShowTimeUpEffect(false);
  }, [game?.currentQuestion]);

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
    if (game?.status === "completed") {
      setLocation(`/results/${pin}?player=${encodeURIComponent(playerName)}`);
    }
  }, [game?.status, pin, playerName, setLocation]);

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
      harmonicChord.forEach((freq, index) => {
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
    if (hasAnswered || timeLeft === 0) return;
    
    playClickSound();
    
    const responseTime = quiz ? 
      ((quiz.questions as Question[])[game?.currentQuestion || 0]?.timeLimit || 10) * 1000 - (timeLeft || 0) * 1000 
      : 0;
    
    setSelectedAnswer(answerIndex);
    setHasAnswered(true);
    
    submitAnswerMutation.mutate({
      selectedAnswer: answerIndex,
      responseTime
    });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Loading game...</p>
        </div>
      </div>
    );
  }

  if (!game || !quiz) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center">
            <p className="text-lg text-gray-600 mb-4">Game not found</p>
            <Button onClick={() => setLocation("/")} className="abraj-primary">
              Go Home
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const questions = quiz.questions as Question[];
  const currentQuestion = questions[game.currentQuestion || 0];
  const players = (game.players as any[]) || [];
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
          <h2 className="text-white text-4xl font-bold mb-2 animate-bounce">TIME'S UP!</h2>
          <p className="text-white text-xl">You didn't answer in time</p>
        </div>
      </div>
    );
  };



  if (game.status === "waiting") {
    return (
      <div className="min-h-screen flex items-center justify-center" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <Card className="w-full max-w-md mx-4 bg-white/95 backdrop-blur-sm">
          <CardContent className="pt-6 text-center space-y-6">
            <div className="abraj-primary text-white w-20 h-20 rounded-full flex items-center justify-center font-bold text-2xl mx-auto">
              {playerName.charAt(0).toUpperCase()}
            </div>
            
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-2">Welcome, {playerName}!</h2>
              <Badge variant="secondary" className="text-lg px-4 py-2">
                Game PIN: {game.gamePin}
              </Badge>
            </div>
            
            <div>
              <h3 className="font-bold text-lg mb-2">{quiz.title}</h3>
              <p className="text-gray-600">{quiz.description}</p>
            </div>
            
            <div className="flex justify-between text-sm text-gray-500 bg-gray-50 rounded-lg p-4">
              <span>{questions.length} questions</span>
              <span>{players.length} players</span>
            </div>
            
            <p className="text-gray-600">Waiting for host to start the game...</p>
            
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

  if (showResult && lastResult) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-4 ${
        lastResult.isCorrect ? 'bg-green-500' : 'bg-red-500'
      } animate-in fade-in duration-300`}>
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
          {lastResult.isCorrect ? "Correct!" : "Incorrect"}
        </h1>
        
        {/* Points Earned */}
        {lastResult.isCorrect && (
          <div className="text-white text-3xl font-bold mb-8 animate-in zoom-in-75 duration-500 delay-200">
            +{lastResult.pointsEarned} points
          </div>
        )}
        
        {/* Correct Answer (if incorrect) */}
        {!lastResult.isCorrect && currentQuestion && (
          <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-8 py-4 mb-8 animate-in slide-in-from-bottom-3 duration-500 delay-200">
            <p className="text-white text-xl font-semibold text-center">
              {currentQuestion.answers[lastResult.correctAnswer]}
            </p>
          </div>
        )}
        
        {/* Score and Rank Cards */}
        <div className="flex gap-4 mb-8 animate-in slide-in-from-bottom-2 duration-500 delay-300">
          {/* Score Card */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 text-center shadow-2xl">
            <p className="text-gray-600 text-sm mb-1">Score</p>
            <p className="text-4xl font-black text-gray-800">{(currentPlayer?.score || 0).toLocaleString()}</p>
          </div>
          
          {/* Rank Card */}
          <div className="bg-white/95 backdrop-blur-sm rounded-2xl px-8 py-6 text-center shadow-2xl">
            <p className="text-gray-600 text-sm mb-1">Rank</p>
            <div className="flex items-center justify-center">
              {currentRank === 1 ? (
                <Trophy className="w-10 h-10 text-yellow-500" />
              ) : (
                <p className="text-4xl font-black text-gray-800">{currentRank}</p>
              )}
            </div>
          </div>
        </div>
        
        {/* Waiting Message */}
        <p className="text-white text-lg animate-pulse">Waiting for next question...</p>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden flex flex-col p-4" style={getBackgroundStyle(quiz?.background || 'classroom')}>
      <TimeUpOverlay />
      <div className="max-w-4xl mx-auto flex-1 flex flex-col min-h-0">
        {/* Header */}
        <div className="text-center mb-3 flex-shrink-0">
          <Badge variant="secondary" className="mb-1">
            Question {(game.currentQuestion || 0) + 1} of {questions.length}
          </Badge>
          
          {timeLeft !== null && timeLeft > 0 && !hasAnswered && (
            <div 
              className={`text-white w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl mx-auto mb-1 hover:scale-110 transition-transform cursor-pointer ${
                timeLeft <= 10 ? 'pulse-ring' : ''
              } ${
                timeLeft <= 3 ? 'bg-red-600 animate-ping shadow-lg shadow-red-500/50' : 
                timeLeft <= 5 ? 'bg-orange-500 animate-bounce' : 
                'abraj-red animate-pulse'
              }`}
              onClick={() => playCountdownSound(timeLeft)}
            >
              {timeLeft}
            </div>
          )}
          
          <p className="text-gray-600 text-xs">
            {hasAnswered ? "Answer submitted!" : timeLeft === 0 ? "Time's up!" : "seconds left"}
          </p>
        </div>

        {/* Question */}
        <Card className="mb-3 glass card-3d-enhanced flex-shrink-0">
          <CardContent className="p-2 sm:p-3 text-center">
            <h2 className="font-bold text-sm sm:text-base md:text-lg text-gray-800 leading-snug">{currentQuestion?.question}</h2>
          </CardContent>
        </Card>

        {/* Answer Options - 2x2 Grid */}
        <div className="grid grid-cols-2 gap-2 mb-3 flex-1 min-h-0">
          {currentQuestion?.answers.map((answer, index) => {
            const colors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];
            const symbols = [Triangle, Diamond, Circle, Square];
            const SymbolIcon = symbols[index];
            const isSelected = selectedAnswer === index;
            const isDisabled = hasAnswered || timeLeft === 0;
            
            return (
              <Button
                key={index}
                onClick={() => handleAnswerSelect(index)}
                disabled={isDisabled}
                className={`${colors[index]} text-white p-2 sm:p-3 rounded-xl font-bold card-3d-enhanced h-full flex ${
                  isSelected ? 'ring-4 ring-white animate-pulse' : ''
                } ${isDisabled ? 'opacity-60' : ''}`}
              >
                <div className="flex flex-col items-center justify-center w-full gap-1">
                  <SymbolIcon className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" fill="white" strokeWidth={0} />
                  <span className="text-center text-xs sm:text-sm md:text-base leading-tight break-words overflow-wrap-anywhere hyphens-auto px-1 font-semibold">{answer}</span>
                </div>
              </Button>
            );
          })}
        </div>

        {/* Player Info */}
        <div className="flex-shrink-0">
          <div className="glass card-3d-enhanced rounded-lg p-2">
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">Score:</span>
              <span className="font-bold gradient-text text-sm">{(currentPlayer?.score || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-xs">
              <span className="text-gray-600">Rank:</span>
              <span className="font-bold">{currentRank} of {players.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
