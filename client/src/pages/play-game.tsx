import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Check, X, Trophy } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Game, Quiz, Question } from "@shared/schema";
import { getBackgroundStyle } from "@/utils/backgrounds";

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


  const { data: game, isLoading } = useQuery<Game>({
    queryKey: ["/api/games", pin],
    refetchInterval: 2000,
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
        setTimeLeft(currentQuestion.timeLimit);
        setShowResult(false);
        setSelectedAnswer(null);
        setHasAnswered(false);
        setShowTimeUpEffect(false);
      }
    }
  }, [game?.currentQuestion, game?.status, quiz]);

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          return 0;
        }
        // Play urgent sound for last 3 seconds
        if (prev <= 3) {
          playUrgentCountdownSound();
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
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
      <div className="min-h-screen flex items-center justify-center" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <Card className={`w-full max-w-md mx-4 bg-white/95 backdrop-blur-sm animate-in slide-in-from-bottom-4 duration-500 ${
          !lastResult.isCorrect ? 'animate-pulse' : ''
        }`}>
          <CardContent className="pt-6 text-center space-y-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-3 ${
              lastResult.isCorrect ? 'abraj-green animate-bounce shadow-lg shadow-green-500/50' : 'abraj-red animate-ping shadow-lg shadow-red-500/50'
            } text-white transform transition-all duration-500 ${
              lastResult.isCorrect ? 'scale-110' : 'scale-105 animate-pulse'
            }`}>
              {lastResult.isCorrect ? <Check className="w-10 h-10 animate-spin" /> : <X className="w-10 h-10 animate-bounce" />}
            </div>
            
            <div className="animate-in fade-in-50 duration-700 delay-200">
              <h3 className={`font-bold text-2xl mb-2 ${
                lastResult.isCorrect ? 'text-green-600' : 'text-red-600 animate-pulse'
              }`}>
                {lastResult.isCorrect ? "Correct!" : "Incorrect"}
              </h3>
              {lastResult.isCorrect && (
                <p className="text-green-600 font-semibold animate-in zoom-in-50 duration-500 delay-300">
                  +{lastResult.pointsEarned} points
                </p>
              )}
              {!lastResult.isCorrect && currentQuestion && (
                <p className="text-gray-600 animate-in slide-in-from-bottom-2 duration-500 delay-300 bg-red-50 p-3 rounded-lg border-2 border-red-200 animate-bounce">
                  <span className="text-red-600 font-bold">Correct answer:</span> {String.fromCharCode(65 + lastResult.correctAnswer)} - {currentQuestion.answers[lastResult.correctAnswer]}
                </p>
              )}
            </div>
            
            <div className="bg-gradient-to-r from-purple-500 to-pink-500 rounded-xl p-4 text-white text-center animate-in zoom-in-75 duration-500 delay-400 shadow-lg">
              <p className="text-sm opacity-90">Your Score</p>
              <p className="font-bold text-2xl">{(currentPlayer?.score || 0).toLocaleString()}</p>
            </div>
            
            <div className="text-center animate-in slide-in-from-bottom-3 duration-500 delay-500">
              <p className="text-gray-600 text-sm mb-2">Current Rank</p>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl mx-auto ${
                currentRank === 1 ? 'abraj-green animate-pulse' :
                currentRank === 2 ? 'bg-gray-400' :
                currentRank === 3 ? 'bg-orange-500' :
                'abraj-primary'
              } text-white shadow-lg transform transition-all duration-300 hover:scale-110`}>
                {currentRank === 1 ? <Trophy className="w-6 h-6" /> : currentRank}
              </div>
            </div>
            
            <p className="text-sm text-gray-500 animate-pulse">Waiting for next question...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4" style={getBackgroundStyle(quiz?.background || 'classroom')}>
      <TimeUpOverlay />
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <Badge variant="secondary" className="mb-2">
            Question {(game.currentQuestion || 0) + 1} of {questions.length}
          </Badge>
          
          {timeLeft !== null && timeLeft > 0 && !hasAnswered && (
            <div 
              className={`text-white w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl mx-auto mb-2 hover:scale-110 transition-transform cursor-pointer ${
                timeLeft <= 3 ? 'bg-red-600 animate-ping shadow-lg shadow-red-500/50' : 
                timeLeft <= 5 ? 'bg-orange-500 animate-bounce' : 
                'abraj-red animate-pulse'
              }`}
              onClick={() => playCountdownSound(timeLeft)}
            >
              {timeLeft}
            </div>
          )}
          
          <p className="text-gray-600 text-sm">
            {hasAnswered ? "Answer submitted!" : timeLeft === 0 ? "Time's up!" : "seconds left"}
          </p>
        </div>

        {/* Question */}
        <Card className="mb-6 bg-white/95 backdrop-blur-sm">
          <CardContent className="p-3 sm:p-4 text-center">
            <h2 className="font-bold text-base sm:text-lg md:text-xl text-gray-800 leading-snug">{currentQuestion?.question}</h2>
          </CardContent>
        </Card>

        {/* Answer Options - 2x2 Grid */}
        <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-6">
          {currentQuestion?.answers.map((answer, index) => {
            const colors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];
            const isSelected = selectedAnswer === index;
            const isDisabled = hasAnswered || timeLeft === 0;
            
            return (
              <Button
                key={index}
                onClick={() => handleAnswerSelect(index)}
                disabled={isDisabled}
                className={`${colors[index]} hover:scale-105 text-white p-2 sm:p-4 md:p-6 lg:p-8 rounded-xl font-bold transition-all transform min-h-[80px] sm:min-h-[96px] h-auto ${
                  isSelected ? 'ring-4 ring-white' : ''
                } ${isDisabled ? 'opacity-60' : 'active:scale-95'}`}
              >
                <div className="flex flex-col items-center justify-center w-full h-full gap-1 sm:gap-2">
                  <span className="text-lg sm:text-xl md:text-2xl font-black shrink-0">{String.fromCharCode(65 + index)}</span>
                  <span className="text-center text-xs sm:text-sm md:text-base lg:text-lg leading-tight break-words overflow-wrap-anywhere hyphens-auto px-1">{answer}</span>
                </div>
              </Button>
            );
          })}
        </div>

        {/* Player Info */}
        <div className="mt-6 text-center">
          <div className="bg-white/95 backdrop-blur-sm rounded-lg p-3 sm:p-4 shadow">
            <div className="flex justify-between items-center">
              <span className="text-gray-600 text-sm sm:text-base">Score:</span>
              <span className="font-bold text-abraj-primary text-sm sm:text-base">{(currentPlayer?.score || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-gray-600 text-sm sm:text-base">Rank:</span>
              <span className="font-bold text-sm sm:text-base">{currentRank} of {players.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
