import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Clock, Users, Eye, Edit, Trash2 } from "lucide-react";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
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
    queryKey: ["/api/my-quizzes"],
    enabled: isAuthenticated,
  });

  if (isLoading || quizzesLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100">
        <Navigation />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
              <p className="text-gray-600">Loading your quizzes...</p>
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-100 via-purple-50 to-pink-100">
      <Navigation />
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold text-gray-800 mb-4">
              My Quiz History
            </h1>
            <p className="text-xl text-gray-600">
              Manage all the quizzes you've created
            </p>
          </div>

          {!quizzes || quizzes.length === 0 ? (
            <div className="text-center py-12">
              <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md mx-auto">
                <div className="mb-6">
                  <div className="w-24 h-24 bg-gray-100 rounded-full mx-auto flex items-center justify-center mb-4">
                    <Clock className="w-12 h-12 text-gray-400" />
                  </div>
                  <h3 className="text-xl font-semibold text-gray-800 mb-2">No Quizzes Yet</h3>
                  <p className="text-gray-600 mb-6">
                    You haven't created any quizzes yet. Start building your first quiz to engage your audience!
                  </p>
                  <Link href="/create-quiz">
                    <Button className="abraj-primary hover:abraj-secondary text-white font-medium">
                      Create Your First Quiz
                    </Button>
                  </Link>
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {quizzes.map((quiz) => (
                <Card key={quiz.id} className="bg-white shadow-lg hover:shadow-xl transition-shadow duration-300">
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
                    
                    <div className="flex gap-2">
                      <Link href={`/quiz/${quiz.id}`}>
                        <Button variant="outline" size="sm" className="flex-1">
                          <Eye className="w-4 h-4 mr-2" />
                          View
                        </Button>
                      </Link>
                      <Link href={`/edit-quiz/${quiz.id}`}>
                        <Button variant="outline" size="sm" className="flex-1">
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                      </Link>
                      <Link href={`/host-quiz/${quiz.id}`}>
                        <Button size="sm" className="abraj-primary hover:abraj-secondary text-white flex-1">
                          Host Game
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          
          <div className="text-center mt-12">
            <Link href="/create-quiz">
              <Button className="abraj-primary hover:abraj-secondary text-white font-medium px-8 py-3">
                Create New Quiz
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}