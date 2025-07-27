import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Leaderboard from "@/components/leaderboard";
import { Clock, Users, Play, SkipForward, QrCode, Copy, Share2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Game, Quiz, Question } from "@shared/schema";
import QRCode from "qrcode";
import { getBackgroundStyle } from "@/utils/backgrounds";

export default function HostGame() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQRCode, setShowQRCode] = useState(false);
  const [gameStartCountdown, setGameStartCountdown] = useState<number | null>(null);
  const [isStartingGame, setIsStartingGame] = useState(false);

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
        title: "Copied!",
        description: `${label} copied to clipboard.`,
      });
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Please copy the link manually.",
        variant: "destructive",
      });
    }
  };

  const { data: game, isLoading: gameLoading } = useQuery<Game>({
    queryKey: ["/api/games", pin],
    refetchInterval: (query) => query.state.data?.status === "waiting" ? 2000 : false,
    enabled: !!pin
  });

  const { data: quiz } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", game?.quizId],
    enabled: !!game?.quizId
  });

  const { data: questionResults } = useQuery<{answerPercentages: number[], answerCounts: number[]}>({
    queryKey: ["/api/games", pin, "question-results", game?.currentQuestion],
    enabled: !!pin && !!game && showResults && game.status === "active",
    refetchInterval: showResults ? 1000 : false
  });

  const startGameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/games/${pin}/start`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/games", pin] });
      toast({
        title: "Game Started!",
        description: "Players can now answer questions.",
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
        setTimeLeft(null);
      }
    }
  });

  useEffect(() => {
    if (game?.status === "active" && !showResults && quiz) {
      const questions = quiz.questions as Question[];
      const currentQuestion = questions[game.currentQuestion || 0];
      if (currentQuestion) {
        setTimeLeft(currentQuestion.timeLimit);
      }
    }
  }, [game?.status, game?.currentQuestion, showResults, quiz]);

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
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          setShowResults(true);
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

  // Play correct answer sound immediately when results are shown
  useEffect(() => {
    if (showResults && game && quiz) {
      const questions = quiz.questions as Question[];
      const currentQ = questions[game.currentQuestion || 0];
      if (currentQ) {
        // Play sound immediately when results become visible
        playCorrectSound();
      }
    }
  }, [showResults, game, quiz]);

  if (gameLoading) {
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
        <Card className="w-full max-w-md">
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
          <h2 className="text-white text-2xl font-bold">Game Starting...</h2>
        </div>
      </div>
    );
  };

  if (game.status === "waiting") {
    return (
      <div className="min-h-screen py-8" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <CountdownOverlay />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="font-bold text-4xl text-gray-800 mb-4">Game Lobby</h1>
            <div className="flex justify-center items-center space-x-4 mb-6">
              <Badge variant="secondary" className="inline-flex items-center rounded-full border font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border-transparent hover:bg-secondary/80 text-lg px-4 py-2 bg-[#019ebd] text-[#ffffff]">
                PIN: {game.gamePin}
              </Badge>
              <Badge className="text-lg px-4 py-2 bg-[#019ebd] text-[#ffffff]">
                {quiz.title}
              </Badge>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <Card className="bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  <Users className="w-5 h-5" />
                  <span>Players ({players.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {players.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    Waiting for players to join...
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {players.map((player, index) => (
                      <div key={index} className="bg-gray-100 rounded-lg p-3 text-center">
                        <span className="font-medium">{player.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>Share Game</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowQRCode(!showQRCode)}
                    className="p-2"
                  >
                    <QrCode className="w-4 h-4" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {showQRCode && qrCodeUrl && (
                  <div className="text-center space-y-2">
                    <img src={qrCodeUrl} alt="QR Code to join game" className="w-32 h-32 mx-auto" />
                    <p className="text-xs text-gray-500">Players can scan to join</p>
                  </div>
                )}
                
                <div className="space-y-2">
                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(game.gamePin, "Game PIN")}
                    className="w-full"
                  >
                    <Copy className="w-4 h-4 mr-2" />
                    Copy PIN ({game.gamePin})
                  </Button>
                  
                  <Button
                    variant="outline"
                    onClick={() => copyToClipboard(`${window.location.origin}/join/${game.gamePin}`, "Join link")}
                    className="w-full"
                  >
                    <Share2 className="w-4 h-4 mr-2" />
                    Copy Join Link
                  </Button>
                </div>

                <div className="pt-4 border-t">
                  <div className="text-center space-y-2 mb-4">
                    <h3 className="font-bold text-lg">{quiz.title}</h3>
                    <p className="text-sm text-gray-500">
                      {questions.length} questions • Multiple Choice
                    </p>
                  </div>
                  
                  <Button
                    onClick={() => {
                      if (players.length === 0) return;
                      setIsStartingGame(true);
                      setGameStartCountdown(3);
                    }}
                    disabled={players.length === 0 || startGameMutation.isPending || isStartingGame}
                    className="w-full abraj-green hover:bg-green-600 text-white font-bold text-lg py-3"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    {isStartingGame ? `Starting in ${gameStartCountdown}...` : 'Start Game'}
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



  if (game.status === "active") {
    return (
      <div className="min-h-screen p-4" style={getBackgroundStyle(quiz?.background || 'classroom')}>
        <div className="max-w-4xl mx-auto relative">
          {/* Next Question Button - Top Right */}
          {showResults && (
            <div className="absolute top-0 right-0 z-10">
              <Button
                onClick={() => {
                  nextQuestionMutation.mutate();
                  playCountdownSound(3);
                }}
                disabled={nextQuestionMutation.isPending}
                className="abraj-primary hover:abraj-secondary text-white px-6 py-2 font-bold hover:scale-105 active:scale-95 transition-transform shadow-lg"
              >
                <SkipForward className="w-4 h-4 mr-2" />
                {(game.currentQuestion || 0) + 1 >= questions.length ? "Finish Game" : "Next Question"}
              </Button>
            </div>
          )}
          
          {/* Header */}
          <div className="text-center mb-6">
            <Badge variant="secondary" className="mb-2 bg-[#019ebd] text-[#ffffff]">
              Question {(game.currentQuestion || 0) + 1} of {questions.length}
            </Badge>
            
            {timeLeft !== null && timeLeft > 0 && !showResults && (
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
              {showResults ? "Results displayed!" : timeLeft === 0 ? "Time's up!" : "seconds left"}
            </p>
          </div>

          {/* Question */}
          <Card className="mb-6 hover:scale-105 transition-transform duration-200 bg-white/95 backdrop-blur-sm">
            <CardContent className="p-3 sm:p-4 text-center">
              <h2 className="font-bold text-base sm:text-lg md:text-xl text-gray-800 leading-snug">{currentQuestion?.question}</h2>
            </CardContent>
          </Card>

          {/* Answer Options - 2x2 Grid Layout */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 mb-6">
            {currentQuestion?.answers.map((answer, index) => {
              const colors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];
              const percentage = showResults && questionResults ? questionResults.answerPercentages[index] || 0 : 0;
              const count = showResults && questionResults ? questionResults.answerCounts[index] || 0 : 0;
              const isCorrect = index === currentQuestion.correctAnswer;
              
              return (
                <div
                  key={index}
                  className={`${colors[index]} text-white p-2 sm:p-4 md:p-6 lg:p-8 rounded-xl font-bold transition-all transform hover:scale-105 cursor-pointer active:scale-95 relative overflow-hidden min-h-[80px] sm:min-h-[96px] lg:h-24 ${
                    showResults && isCorrect ? 'ring-4 ring-yellow-400 animate-bounce shadow-lg shadow-yellow-400/50' : 
                    showResults && !isCorrect ? 'opacity-75 animate-pulse ring-2 ring-gray-400' : ''
                  }`}
                  onClick={() => {
                    if (showResults) {
                      if (isCorrect) {
                        playCorrectSound();
                      } else {
                        playWrongSound();
                      }
                    }
                  }}
                  onMouseEnter={() => {
                    if (showResults && isCorrect) {
                      playCorrectSound();
                    }
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between w-full h-full gap-1 sm:gap-2">
                    <span className="text-lg sm:text-xl md:text-2xl font-black shrink-0">{String.fromCharCode(65 + index)}</span>
                    <span className="flex-1 text-center text-xs sm:text-sm md:text-base lg:text-lg leading-tight break-words">{answer}</span>
                  </div>
                  
                  {showResults && questionResults && (
                    <>
                      <div className="mt-2 sm:mt-3 bg-white/20 rounded-full h-1.5 sm:h-2">
                        <div 
                          className="bg-white rounded-full h-1.5 sm:h-2 transition-all duration-1000"
                          style={{ width: `${percentage}%` }}
                        ></div>
                      </div>
                      <div className="mt-1 sm:mt-2 text-xs sm:text-sm opacity-90 text-center">
                        {percentage}% ({count} players)
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>



          {/* Game Info - Matching Player Page Style */}
          <div className="mt-6">
            <div className="bg-white/95 backdrop-blur-sm rounded-lg p-4 shadow hover:scale-105 transition-transform">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">PIN:</span>
                <span className="font-bold text-[#019ebd]">{game.gamePin}</span>
              </div>
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-600">Players:</span>
                <span className="font-bold">{players.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-gray-600">Progress:</span>
                <span className="font-bold">{(game.currentQuestion || 0) + 1}/{questions.length}</span>
              </div>
            </div>
          </div>

          {/* Leaderboard Preview */}
          <div className="mt-6">
            <Card className="bg-white/95 backdrop-blur-sm hover:scale-105 transition-transform">
              <CardHeader>
                <CardTitle className="text-center">Top Players</CardTitle>
              </CardHeader>
              <CardContent>
                <Leaderboard players={players.slice(0, 3)} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
