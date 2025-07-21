import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, Users, Play, Settings } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import Navigation from "@/components/navigation";

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
    onSuccess: (game: Game) => {
      toast({
        title: "Game Created!",
        description: `Game PIN: ${game.gamePin}. Players can now join!`,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
      setLocation(`/host/${game.gamePin}`);
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
                <div className="text-center space-y-4">
                  <div className="bg-abraj-primary/10 rounded-lg p-6">
                    <h3 className="font-semibold text-lg text-gray-800 mb-2">How it works:</h3>
                    <ol className="text-left text-gray-600 space-y-2">
                      <li className="flex items-start gap-2">
                        <span className="bg-abraj-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">1</span>
                        <span>Click "Create Game" to generate a unique game PIN</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="bg-abraj-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">2</span>
                        <span>Share the PIN with players so they can join</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="bg-abraj-primary text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">3</span>
                        <span>Start the game when all players have joined</span>
                      </li>
                    </ol>
                  </div>

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