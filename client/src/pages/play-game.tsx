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

export default function PlayGame() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Get player name from URL params
  const urlParams = new URLSearchParams(window.location.search);
  const playerName = urlParams.get('player') || '';
  
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [hasAnswered, setHasAnswered] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [playerScore, setPlayerScore] = useState(0);

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

  useEffect(() => {
    if (game?.status === "active" && quiz) {
      const questions = quiz.questions as Question[];
      const currentQuestion = questions[game.currentQuestion || 0];
      if (currentQuestion) {
        setTimeLeft(currentQuestion.timeLimit);
        setShowResult(false);
        setSelectedAnswer(null);
        setHasAnswered(false);
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
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  // Show results when timer reaches 0 AND we have a result from answering
  useEffect(() => {
    if (timeLeft === 0 && lastResult && hasAnswered) {
      setShowResult(true);
    }
  }, [timeLeft, lastResult, hasAnswered]);

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

  const playCountdownSound = () => {
    if (typeof Audio !== 'undefined') {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = 800;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
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

  if (game.status === "waiting") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="w-full max-w-md mx-4">
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
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100">
        <Card className="w-full max-w-md mx-4">
          <CardContent className="pt-6 text-center space-y-6">
            <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-3 ${
              lastResult.isCorrect ? 'abraj-green' : 'abraj-red'
            } text-white`}>
              {lastResult.isCorrect ? <Check className="w-10 h-10" /> : <X className="w-10 h-10" />}
            </div>
            
            <div>
              <h3 className="font-bold text-2xl text-gray-800 mb-2">
                {lastResult.isCorrect ? "Correct!" : "Incorrect"}
              </h3>
              {lastResult.isCorrect && (
                <p className="text-gray-600">+{lastResult.pointsEarned} points</p>
              )}
              {!lastResult.isCorrect && currentQuestion && (
                <p className="text-gray-600">
                  Correct answer: {String.fromCharCode(65 + lastResult.correctAnswer)} - {currentQuestion.answers[lastResult.correctAnswer]}
                </p>
              )}
            </div>
            
            <div className="bg-gradient-to-r from-abraj-primary to-abraj-secondary rounded-xl p-4 text-white text-center">
              <p className="text-sm opacity-90">Your Score</p>
              <p className="font-bold text-2xl">{(currentPlayer?.score || 0).toLocaleString()}</p>
            </div>
            
            <div className="text-center">
              <p className="text-gray-600 text-sm mb-2">Current Rank</p>
              <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-xl mx-auto ${
                currentRank === 1 ? 'abraj-green' :
                currentRank === 2 ? 'bg-gray-400' :
                currentRank === 3 ? 'bg-orange-500' :
                'abraj-primary'
              } text-white`}>
                {currentRank === 1 ? <Trophy className="w-6 h-6" /> : currentRank}
              </div>
            </div>
            
            <p className="text-sm text-gray-500">Waiting for next question...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100 p-4">
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="text-center mb-6">
          <Badge variant="secondary" className="mb-2">
            Question {(game.currentQuestion || 0) + 1} of {questions.length}
          </Badge>
          
          {timeLeft !== null && timeLeft > 0 && !hasAnswered && (
            <div 
              className="abraj-red text-white w-16 h-16 rounded-full flex items-center justify-center font-bold text-2xl mx-auto mb-2 animate-pulse hover:scale-110 transition-transform cursor-pointer"
              onClick={() => playCountdownSound()}
            >
              {timeLeft}
            </div>
          )}
          
          <p className="text-gray-600 text-sm">
            {hasAnswered ? "Answer submitted!" : timeLeft === 0 ? "Time's up!" : "seconds left"}
          </p>
        </div>

        {/* Question */}
        <Card className="mb-6">
          <CardContent className="p-4 text-center">
            <h2 className="font-bold text-lg text-gray-800">{currentQuestion?.question}</h2>
          </CardContent>
        </Card>

        {/* Answer Options */}
        <div className="space-y-4">
          {currentQuestion?.answers.map((answer, index) => {
            const colors = ['abraj-red', 'abraj-blue', 'abraj-green', 'abraj-yellow'];
            const isSelected = selectedAnswer === index;
            const isDisabled = hasAnswered || timeLeft === 0;
            
            return (
              <Button
                key={index}
                onClick={() => handleAnswerSelect(index)}
                disabled={isDisabled}
                className={`w-full ${colors[index]} hover:scale-105 text-white p-6 rounded-xl font-bold text-lg transition-all transform ${
                  isSelected ? 'ring-4 ring-white' : ''
                } ${isDisabled ? 'opacity-60' : 'active:scale-95'}`}
              >
                <div className="flex items-center justify-between w-full">
                  <span>{String.fromCharCode(65 + index)}</span>
                  <span className="flex-1 text-center">{answer}</span>
                </div>
              </Button>
            );
          })}
        </div>

        {/* Player Info */}
        <div className="mt-6 text-center">
          <div className="bg-white rounded-lg p-4 shadow">
            <div className="flex justify-between items-center">
              <span className="text-gray-600">Score:</span>
              <span className="font-bold text-abraj-primary">{(currentPlayer?.score || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-gray-600">Rank:</span>
              <span className="font-bold">{currentRank} of {players.length}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
