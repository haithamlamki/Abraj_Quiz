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

export default function HostGame() {
  const { pin } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [showResults, setShowResults] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");
  const [showQRCode, setShowQRCode] = useState(false);

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

  useEffect(() => {
    if (timeLeft === null || timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev === null || prev <= 1) {
          setShowResults(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

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

  if (game.status === "waiting") {
    return (
      <div className="min-h-screen py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="font-bold text-4xl text-gray-800 mb-4">Game Lobby</h1>
            <div className="flex justify-center items-center space-x-4 mb-6">
              <Badge variant="secondary" className="text-lg px-4 py-2">
                PIN: {game.gamePin}
              </Badge>
              <Badge variant="outline" className="text-lg px-4 py-2">
                {quiz.title}
              </Badge>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-8">
            <Card>
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
                  <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {players.map((player, index) => (
                      <div key={index} className="bg-gray-100 rounded-lg p-3 text-center">
                        <span className="font-medium">{player.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
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
                    onClick={() => startGameMutation.mutate()}
                    disabled={players.length === 0 || startGameMutation.isPending}
                    className="w-full abraj-green hover:bg-green-600 text-white font-bold text-lg py-3"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Start Game
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (game.status === "active") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-pink-900 text-white py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-8">
            <h1 className="font-bold text-4xl mb-4">Question {(game.currentQuestion || 0) + 1} of {questions.length}</h1>
            <div className="flex justify-center items-center space-x-4">
              <Badge variant="secondary" className="text-lg px-4 py-2">
                PIN: {game.gamePin}
              </Badge>
              {timeLeft !== null && timeLeft > 0 && (
                <div className="abraj-red text-white px-4 py-2 rounded-full font-bold text-lg animate-pulse">
                  <Clock className="inline w-5 h-5 mr-2" />
                  {timeLeft}s
                </div>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2">
              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardContent className="p-8">
                  <div className="bg-white rounded-xl p-6 text-gray-800 mb-6">
                    <h2 className="font-bold text-2xl mb-4">{currentQuestion.question}</h2>
                  </div>

                  {showResults && questionResults ? (
                    <div className="grid grid-cols-2 gap-4">
                      {currentQuestion.answers.map((answer, index) => {
                        const percentage = questionResults.answerPercentages[index] || 0;
                        const count = questionResults.answerCounts[index] || 0;
                        const isCorrect = index === currentQuestion.correctAnswer;
                        
                        return (
                          <div
                            key={index}
                            className={`${
                              index === 0 ? 'abraj-red' :
                              index === 1 ? 'abraj-blue' :
                              index === 2 ? 'abraj-green' : 'abraj-yellow'
                            } rounded-xl p-4 relative overflow-hidden ${isCorrect ? 'ring-4 ring-yellow-400' : ''}`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold text-lg">{String.fromCharCode(65 + index)}. {answer}</span>
                            </div>
                            <div className="bg-white/20 rounded-full h-2 mb-2">
                              <div 
                                className="bg-white rounded-full h-2 transition-all duration-1000"
                                style={{ width: `${percentage}%` }}
                              ></div>
                            </div>
                            <span className="text-sm opacity-90">{percentage}% ({count} players)</span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      {currentQuestion.answers.map((answer, index) => (
                        <div
                          key={index}
                          className={`${
                            index === 0 ? 'abraj-red' :
                            index === 1 ? 'abraj-blue' :
                            index === 2 ? 'abraj-green' : 'abraj-yellow'
                          } rounded-xl p-4`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-lg">{String.fromCharCode(65 + index)}</span>
                          </div>
                          <p className="mt-2">{answer}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {showResults && (
                    <div className="mt-6 text-center">
                      <Button
                        onClick={() => nextQuestionMutation.mutate()}
                        disabled={nextQuestionMutation.isPending}
                        className="abraj-primary hover:abraj-secondary text-white px-8 py-3 font-bold"
                      >
                        <SkipForward className="w-5 h-5 mr-2" />
                        {(game.currentQuestion || 0) + 1 >= questions.length ? "Finish Game" : "Next Question"}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardHeader>
                  <CardTitle className="text-white">Game Info</CardTitle>
                </CardHeader>
                <CardContent className="text-white">
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="opacity-90">Players:</span>
                      <span className="font-bold">{players.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-90">Game PIN:</span>
                      <span className="font-bold text-abraj-blue">{game.gamePin}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="opacity-90">Questions:</span>
                      <span className="font-bold">{(game.currentQuestion || 0) + 1}/{questions.length}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-white/10 backdrop-blur-lg border-white/20">
                <CardContent className="p-6">
                  <Leaderboard players={players} />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
