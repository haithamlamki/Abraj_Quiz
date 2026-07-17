import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { PageLoader } from "@/components/page-loader";
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
import { Clock, Users, Edit, Trash2, FileText, BarChart3 } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatQuizDate } from "@/lib/language";

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
  const { t, i18n } = useTranslation();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showArchived, setShowArchived] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: t("history.authRequiredTitle"),
        description: t("history.authRequiredDescription"),
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast, t]);

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
      toast({ title: t("history.archivedToastTitle"), description: t("history.archivedToastDescription") });
    },
    onError: () => toast({ title: t("history.deleteFailedTitle"), variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/quizzes/${id}/restore`),
    onSuccess: () => {
      invalidateBothLists();
      toast({ title: t("history.restoredToastTitle") });
    },
    onError: () => toast({ title: t("history.restoreFailedTitle"), variant: "destructive" }),
  });

  if (isLoading || quizzesLoading) {
    return <PageLoader />;
  }

  if (!isAuthenticated) {
    return null;
  }

  const formatDate = (dateString: string) => formatQuizDate(dateString, i18n.language);

  return (
    <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8 animate-scale-in">
            <h1 className="text-4xl font-bold gradient-text mb-4">
              {t("history.title")}
            </h1>
            <p className="text-xl text-gray-600">
              {t("history.subtitle")}
            </p>
            <div className="mt-4">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowArchived((v) => !v)}
                data-testid="button-toggle-archived"
              >
                {showArchived ? t("history.backToMyQuizzes") : t("history.archived")}
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
                      <h3 className="text-xl font-semibold gradient-text mb-2">{t("history.noArchivedQuizzes")}</h3>
                    </>
                  ) : (
                    <>
                      <h3 className="text-xl font-semibold gradient-text mb-2">{t("history.noQuizzesYetTitle")}</h3>
                      <p className="text-gray-600 mb-6">
                        {t("history.noQuizzesYetDescription")}
                      </p>
                      <Link href="/create">
                        <Button className="abraj-primary hover:abraj-secondary text-white font-medium btn-glow">
                          {t("history.createFirstQuiz")}
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
                        {quiz.isPublic ? t("history.public") : t("history.private")}
                      </Badge>
                      <div className="text-sm text-gray-500">
                        {formatDate(quiz.createdAt)}
                      </div>
                    </div>
                    <CardTitle className="text-xl font-bold text-gray-800 line-clamp-2">
                      {quiz.title}
                    </CardTitle>
                    <CardDescription className="text-gray-600 line-clamp-3">
                      {quiz.description || t("history.noDescriptionProvided")}
                    </CardDescription>
                  </CardHeader>

                  <CardContent>
                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-4">
                      <div className="flex items-center gap-1">
                        <Users className="w-4 h-4" />
                        <span>{t("history.questionsCount", { count: quiz.questions.length })}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Clock className="w-4 h-4" />
                        <span>{t("history.estimatedMinutes", { count: Math.ceil(quiz.questions.reduce((acc, q) => acc + q.timeLimit, 0) / 60) })}</span>
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
                          {t("history.restore")}
                        </Button>
                      ) : (
                        <>
                          <Link href={`/edit-quiz/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px]">
                              <Edit className="w-4 h-4 me-1" />
                              {t("history.edit")}
                            </Button>
                          </Link>
                          <Link href={`/quiz-pdf/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px] border-[#019ebd] text-[#019ebd] hover:bg-[#019ebd] hover:text-white">
                              <FileText className="w-4 h-4 me-1" />
                              {t("history.pdf")}
                            </Button>
                          </Link>
                          <Link href={`/quiz-insights/${quiz.id}`}>
                            <Button variant="outline" size="sm" className="flex-1 min-w-[80px]" data-testid={`button-insights-quiz-${quiz.id}`}>
                              <BarChart3 className="w-4 h-4 me-1" />
                              {t("history.insights")}
                            </Button>
                          </Link>
                          <Link href={`/host-quiz/${quiz.id}`}>
                            <Button size="sm" className="abraj-primary hover:abraj-secondary text-white flex-1 min-w-[80px] btn-glow">
                              {t("history.hostGame")}
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
                                <AlertDialogTitle>{t("history.deleteDialogTitle")}</AlertDialogTitle>
                                <AlertDialogDescription>
                                  {t("history.deleteDialogDescription", { title: quiz.title })}
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>{t("history.cancel")}</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => deleteMutation.mutate(quiz.id)}
                                  className="bg-red-600 hover:bg-red-700"
                                >
                                  {t("history.delete")}
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
                {t("history.createNewQuiz")}
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}