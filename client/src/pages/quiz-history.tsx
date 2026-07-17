import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Link, useLocation } from "wouter";
import { Clock, Users, Eye, Edit, Trash2, FileText, BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
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

export default function QuizHistory() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: "Authentication Required",
        description: "Please login to view your quiz history.",
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast]);

  const { data: quizzes, isLoading: quizzesLoading } = useQuery<Quiz[]>({
    queryKey: showArchived ? ["/api/my-quizzes?archived=1"] : ["/api/my-quizzes"],
    enabled: isAuthenticated,
  });

  const invalidateBothLists = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/my-quizzes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/my-quizzes?archived=1"] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/quizzes/${id}`),
    onSuccess: () => {
      invalidateBothLists();
      toast({ title: "Quiz archived", description: "You can restore it from the Archived view." });
    },
    onError: () => toast({ title: "Failed to delete quiz", variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/quizzes/${id}/restore`),
    onSuccess: () => {
      invalidateBothLists();
      toast({ title: "Quiz restored" });
    },
    onError: () => toast({ title: "Failed to restore quiz", variant: "destructive" }),
  });

  if (isLoading || quizzesLoading) {
    return (
      <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-pulse card-3d-enhanced glass p-8 rounded-2xl">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
                <p className="text-gray-600">Loading your quizzes...</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 animate-scale-in">
            <h1 className="text-4xl font-bold gradient-text mb-4">
              My Quiz History
            </h1>
            <p className="text-xl text-gray-600">
              Manage all the quizzes you've created
            </p>
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowArchived((v) => !v)}
                data-testid="button-toggle-archived"
              >
                {showArchived ? "Back to My Quizzes" : "Archived"}
              </Button>
            </div>
          </div>

          {!quizzes || quizzes.length === 0 ? (
            <div className="text-center py-12">
              <div className="card-3d-enhanced glass p-8 max-w-md mx-auto">
                <div className="mb-6">
                  <div className="w-24 h-24 bg-gray-100 rounded-full mx-auto flex items-center justify-center mb-4">
                    <Clock className="w-12 h-12 text-gray-400" />
                  </div>
                  {showArchived ? (
                    <>
                      <h3 className="text-xl font-semibold gradient-text mb-2">No archived quizzes.</h3>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold gradient-text mb-2">No Quizzes Yet</h3>
                      <p className="text-gray-600 mb-6">
                        You haven't created any quizzes yet. Start building your first quiz to engage your audience!
                      </p>
                      <Link href="/create">
                        <Button className="abraj-primary hover:abraj-secondary text-white font-medium btn-glow">
                          Create Your First Quiz
                        </Button>
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {quizzes.map((quiz) => (
                <Card key={quiz.id} className="card-3d-enhanced glass hover:shadow-xl transition-shadow duration-300">
                  <CardHeader>
                    <div className="flex justify-between items-start mb-2">
                      <Badge variant={quiz.isPublic ? "default" : "secondary"} className="mb-2">
                        {quiz.isPublic ? "Public" : "Private"}
                      </Badge>
                      <div className="text-sm text-gray-500">
                        {formatDate(quiz.createdAt)}
                      </div>
                    </div>
                    <CardTitle className="text-xl font-bold text-gray-800 line-clamp-2">
                      {quiz.title}
                    </CardTitle>
                    <CardDescription className="text-gray-600 line-clamp-3">
                      {quiz.description || "No description provided"}
                    </CardDescription>
                  </CardHeader>
                  
                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>{quiz.questions.length} questions</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>~{Math.ceil(quiz.questions.reduce((acc, q) => acc + q.timeLimit, 0) / 60)} min</span>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 flex-wrap">
                      {showArchived ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => restoreMutation.mutate(quiz.id)}
                          data-testid={`button-restore-quiz-${quiz.id}`}
                        >
                          Restore
                        </Button>
                      ) : (
                        <>
                          <Link href={`/edit-quiz/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px]">
                              <Edit className="w-4 h-4 mr-1" />
                              Edit
                            </Button>
                          </Link>
                          <Link href={`/quiz-pdf/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px] border-[#019ebd] text-[#019ebd] hover:bg-[#019ebd] hover:text-white">
                              <FileText className="w-4 h-4 mr-1" />
                              PDF
                            </Button>
                          </Link>
                          <Link href={`/quiz-insights/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px]" data-testid={`button-insights-quiz-${quiz.id}`}>
                              <BarChart3 className="w-4 h-4 mr-1" />
                              Insights
                            </Button>
                          </Link>
                          <Link href={`/host-quiz/${quiz.id}`}>
                            <Button size="sm" className="abraj-primary hover:abraj-secondary text-white flex-1 min-w-[80px] btn-glow">
                              Host Game
                            </Button>
                          </Link>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-red-600 border-red-300 hover:bg-red-50"
                                data-testid={`button-delete-quiz-${quiz.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this quiz?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  "{quiz.title}" will be archived: it disappears from your quizzes and can no longer be hosted.
                                  Results of games already played are kept. You can restore it from the Archived view.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(quiz.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          
          <div className="text-center mt-12">
            <Link href="/create">
              <Button className="abraj-primary hover:abraj-secondary text-white font-medium px-8 py-3 btn-glow">
                Create New Quiz
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}