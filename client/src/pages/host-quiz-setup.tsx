import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Clock, Users, Play, Settings, Share2, Copy, QrCode } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";
import QRCode from "qrcode";

interface Quiz {
  id: number;
  title: string;
  description: string;
  createdBy: number;
  questions: Array<{
    question: string;
    answers: string[];
    correctAnswer: number;
    timeLimit: number;
  }>;
  isPublic: boolean;
  createdAt: string;
}

interface Game {
  id: number;
  quizId: number;
  gamePin: string;
  hostId: number;
  status: string;
  currentQuestion: number;
  players: any[];
  createdAt: string;
}

export default function HostQuizSetup() {
  const { quizId } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading } = useAuth();
  const [createdGame, setCreatedGame] = useState<Game | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string>("");

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

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please login to host quizzes.",
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast]);

  const { data: quiz, isLoading: quizLoading } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", quizId],
    enabled: !!quizId && isAuthenticated,
  });

  const createGameMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/games", {
        quizId: parseInt(quizId!),
      });
      return response.json();
    },
    onSuccess: async (game: Game) => {
      // Generate QR code for the game join URL
      const gameUrl = `${window.location.origin}/join/${game.gamePin}`;
      try {
        const qrDataUrl = await QRCode.toDataURL(gameUrl, {
          width: 256,
          margin: 2,
          color: {
            dark: '#0EA5E9', // Abraj blue color
            light: '#FFFFFF'
          }
        });
        setQrCodeUrl(qrDataUrl);
      } catch (error) {
        console.error('Failed to generate QR code:', error);
      }
      
      setCreatedGame(game);
      toast({
        title: "Game Created!",
        description: `Game PIN: ${game.gamePin}. Players can now join!`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create game. Please try again.",
        variant: "destructive",
      });
    }
  });

  if (isLoading || quizLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
            <p className="text-gray-600">Loading quiz...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  if (!quiz) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="text-center py-12">
          <h1 className="text-2xl font-bold text-gray-800 mb-4">Quiz Not Found</h1>
          <p className="text-gray-600 mb-6">The quiz you're looking for doesn't exist.</p>
          <Button onClick={() => setLocation("/")} className="abraj-primary hover:abraj-secondary text-white">
            Go Home
          </Button>
        </div>
      </div>
    );
  }

  const totalQuestions = quiz.questions.length;
  const estimatedTime = Math.ceil(quiz.questions.reduce((acc, q) => acc + q.timeLimit, 0) / 60);

  return (
    <div>
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">
              Ready to Host Your Quiz?
            </h1>
            <p className="text-xl text-gray-600">
              Set up your quiz game and get players to join
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* Quiz Details */}
            <Card className="bg-white shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Settings className="w-6 h-6 text-abraj-primary" />
                  Quiz Details
                </CardTitle>
                <CardDescription>
                  Review your quiz before starting the game
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg text-gray-800 mb-2">{quiz.title}</h3>
                  <p className="text-gray-600">{quiz.description || "No description provided"}</p>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    <span>{totalQuestions} questions</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>~{estimatedTime} min</span>
                  </div>
                </div>

                <div className="pt-4">
                  <Badge variant={quiz.isPublic ? "default" : "secondary"}>
                    {quiz.isPublic ? "Public Quiz" : "Private Quiz"}
                  </Badge>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-medium text-gray-800 mb-2">Questions Preview:</h4>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {quiz.questions.slice(0, 3).map((question, index) => (
                      <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                        {index + 1}. {question.question}
                      </div>
                    ))}
                    {quiz.questions.length > 3 && (
                      <div className="text-sm text-gray-500 text-center">
                        ... and {quiz.questions.length - 3} more questions
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Host Game */}
            <Card className="bg-white shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                  <Play className="w-6 h-6 text-abraj-primary" />
                  Start Game
                </CardTitle>
                <CardDescription>
                  Create a game session for your quiz
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!createdGame ? (
                  <div className="text-center space-y-4">
                    

                    <Button
                      onClick={() => createGameMutation.mutate()}
                      disabled={createGameMutation.isPending}
                      className="w-full abraj-primary hover:abraj-secondary text-white font-medium py-3 text-lg"
                    >
                      {createGameMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                          Creating Game...
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 mr-2" />
                          Create Game & Get PIN
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center space-y-6">
                    {/* Game PIN Display */}
                    <div className="bg-abraj-primary/10 rounded-lg p-6">
                      <h3 className="font-semibold text-lg text-gray-800 mb-2">Game PIN</h3>
                      <div className="text-4xl font-bold text-abraj-primary mb-2">
                        {createdGame.gamePin}
                      </div>
                      <p className="text-sm text-gray-600">Players can join using this PIN</p>
                    </div>

                    {/* QR Code */}
                    {qrCodeUrl && (
                      <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 justify-center">
                          <QrCode className="w-4 h-4" />
                          QR Code
                        </h4>
                        <div className="flex justify-center mb-3">
                          <Dialog>
                            <DialogTrigger asChild>
                              <button className="hover:scale-105 transition-transform cursor-pointer">
                                <img src={qrCodeUrl} alt="QR Code to join game" className="w-32 h-32 rounded border hover:border-abraj-primary" />
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle className="text-center flex items-center gap-2 justify-center">
                                  <QrCode className="w-5 h-5" />
                                  Game QR Code
                                </DialogTitle>
                              </DialogHeader>
                              <div className="flex flex-col items-center space-y-4 p-4">
                                <div className="bg-white p-6 rounded-lg border">
                                  <img src={qrCodeUrl} alt="QR Code to join game" className="w-64 h-64" />
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-2xl text-abraj-primary mb-2">{createdGame.gamePin}</p>
                                  <p className="text-sm text-gray-600">Scan to join the game</p>
                                  <p className="text-xs text-gray-500 mt-2">Or visit: {window.location.origin}/join/{createdGame.gamePin}</p>
                                </div>
                                <Button
                                  variant="outline"
                                  onClick={() => copyToClipboard(`${window.location.origin}/join/${createdGame.gamePin}`, "Join link")}
                                  className="w-full"
                                >
                                  <Copy className="w-4 h-4 mr-2" />
                                  Copy Join Link
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <p className="text-xs text-gray-500">Click to view larger • Players can scan this QR code to join</p>
                      </div>
                    )}

                    {/* Share Options */}
                    <div className="space-y-3">
                      <h4 className="font-semibold text-gray-800 flex items-center gap-2 justify-center">
                        <Share2 className="w-4 h-4" />
                        Share with Players
                      </h4>
                      
                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(createdGame.gamePin, "Game PIN")}
                          className="w-full"
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          Copy PIN
                        </Button>
                        
                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(`${window.location.origin}/join/${createdGame.gamePin}`, "Join link")}
                          className="w-full"
                        >
                          <Copy className="w-4 h-4 mr-2" />
                          Copy Join Link
                        </Button>
                      </div>
                    </div>

                    {/* Start Hosting */}
                    <Button
                      onClick={() => setLocation(`/host/${createdGame.gamePin}`)}
                      className="w-full abraj-green hover:bg-green-600 text-white font-medium py-3 text-lg"
                    >
                      <Play className="w-5 h-5 mr-2" />
                      Start Hosting
                    </Button>
                  </div>
                )}

                <div className="pt-4 border-t text-center">
                  <p className="text-sm text-gray-500 mb-3">
                    Not ready to host yet?
                  </p>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      onClick={() => setLocation("/my-quizzes")}
                      className="w-full"
                    >
                      Back to My Quizzes
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setLocation(`/create`)}
                      className="w-full"
                    >
                      Edit Quiz
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}