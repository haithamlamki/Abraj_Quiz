import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
        title: t("host.copiedTitle"),
        description: t("host.copiedDescription", { label }),
      });
    } catch (error) {
      toast({
        title: t("host.copyFailedTitle"),
        description: t("host.copyFailedDescription"),
        variant: "destructive",
      });
    }
  };

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({
        title: t("host.authRequiredTitle"),
        description: t("host.authRequiredDescription"),
        variant: "destructive",
      });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast, t]);

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
        title: t("host.gameCreatedTitle"),
        description: t("host.gameCreatedDescription", { pin: game.gamePin }),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/games"] });
    },
    onError: () => {
      toast({
        title: t("host.errorTitle"),
        description: t("host.createGameFailed"),
        variant: "destructive",
      });
    }
  });

  if (isLoading || quizLoading) {
    return (
      <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <div className="animate-pulse card-3d-enhanced glass p-8 rounded-2xl">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-abraj-primary mx-auto mb-4"></div>
                <p className="text-gray-600">{t("host.loadingQuiz")}</p>
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

  if (!quiz) {
    return (
      <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center py-12 animate-scale-in">
            <div className="card-3d-enhanced glass p-8 max-w-md mx-auto">
              <h1 className="text-2xl font-bold gradient-text mb-4">{t("host.quizNotFoundTitle")}</h1>
              <p className="text-gray-600 mb-6">{t("host.quizNotFoundDescription")}</p>
              <Button onClick={() => setLocation("/")} className="abraj-primary hover:abraj-secondary text-white btn-glow">
                {t("play.goHome")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalQuestions = quiz.questions.length;
  const estimatedTime = Math.ceil(quiz.questions.reduce((acc, q) => acc + q.timeLimit, 0) / 60);

  return (
    <div className="min-h-screen animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8 animate-scale-in">
            <h1 className="text-4xl font-bold gradient-text mb-4">
              {t("host.setupTitle")}
            </h1>
            <p className="text-xl text-gray-600">
              {t("host.setupSubtitle")}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2">
            {/* Quiz Details */}
            <Card className="card-3d-enhanced glass">
              <CardHeader>
                <CardTitle className="text-2xl font-bold gradient-text flex items-center gap-2">
                  <Settings className="w-6 h-6 text-abraj-primary" />
                  {t("host.quizDetailsTitle")}
                </CardTitle>
                <CardDescription>
                  {t("host.quizDetailsSubtitle")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold text-lg text-gray-800 mb-2">{quiz.title}</h3>
                  <p className="text-gray-600">{quiz.description || t("host.noDescriptionProvided")}</p>
                </div>

                <div className="flex items-center gap-4 text-sm text-gray-600">
                  <div className="flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    <span>{t("play.questionsCount", { count: totalQuestions })}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Clock className="w-4 h-4" />
                    <span>{t("host.estimatedMinutes", { count: estimatedTime })}</span>
                  </div>
                </div>

                <div className="pt-4">
                  <Badge variant={quiz.isPublic ? "default" : "secondary"}>
                    {quiz.isPublic ? t("host.publicQuiz") : t("host.privateQuiz")}
                  </Badge>
                </div>

                <div className="pt-4 border-t">
                  <h4 className="font-medium text-gray-800 mb-2">{t("host.questionsPreview")}</h4>
                  <div className="space-y-2 max-h-32 overflow-y-auto">
                    {quiz.questions.slice(0, 3).map((question, index) => (
                      <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                        {index + 1}. {question.question}
                      </div>
                    ))}
                    {quiz.questions.length > 3 && (
                      <div className="text-sm text-gray-500 text-center">
                        {t("host.moreQuestions", { count: quiz.questions.length - 3 })}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Host Game */}
            <Card className="card-3d-enhanced glass">
              <CardHeader>
                <CardTitle className="text-2xl font-bold gradient-text flex items-center gap-2">
                  <Play className="w-6 h-6 text-abraj-primary" />
                  {t("host.startGameTitle")}
                </CardTitle>
                <CardDescription>
                  {t("host.startGameSubtitle")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!createdGame ? (
                  <div className="text-center space-y-4">


                    <Button
                      onClick={() => createGameMutation.mutate()}
                      disabled={createGameMutation.isPending}
                      className="w-full abraj-primary hover:abraj-secondary text-white font-medium py-3 text-lg btn-glow"
                      data-testid="button-create-game"
                    >
                      {createGameMutation.isPending ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white me-2"></div>
                          {t("host.creatingGame")}
                        </>
                      ) : (
                        <>
                          <Play className="w-5 h-5 me-2" />
                          {t("host.createGameAndGetPin")}
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <div className="text-center space-y-6">
                    {/* Game PIN Display */}
                    <div className="bg-abraj-primary/10 rounded-lg p-6">
                      <h3 className="font-semibold text-lg text-gray-800 mb-2">{t("host.gamePinLabel")}</h3>
                      <div className="text-4xl font-bold text-abraj-primary mb-2">
                        {createdGame.gamePin}
                      </div>
                      <p className="text-sm text-gray-600">{t("host.playersCanJoinWithPin")}</p>
                    </div>

                    {/* QR Code */}
                    {qrCodeUrl && (
                      <div className="bg-white p-4 rounded-lg border-2 border-gray-200">
                        <h4 className="font-semibold text-gray-800 mb-3 flex items-center gap-2 justify-center">
                          <QrCode className="w-4 h-4" />
                          {t("host.qrCode")}
                        </h4>
                        <div className="flex justify-center mb-3">
                          <Dialog>
                            <DialogTrigger asChild>
                              <button className="hover:scale-105 transition-transform cursor-pointer">
                                <img src={qrCodeUrl} alt={t("host.qrCodeAlt")} className="w-32 h-32 rounded border hover:border-abraj-primary" />
                              </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                              <DialogHeader>
                                <DialogTitle className="text-center flex items-center gap-2 justify-center">
                                  <QrCode className="w-5 h-5" />
                                  {t("host.gameQrCode")}
                                </DialogTitle>
                              </DialogHeader>
                              <div className="flex flex-col items-center space-y-4 p-4">
                                <div className="bg-white p-6 rounded-lg border">
                                  <img src={qrCodeUrl} alt={t("host.qrCodeAlt")} className="w-64 h-64" />
                                </div>
                                <div className="text-center">
                                  <p className="font-bold text-2xl text-abraj-primary mb-2">{createdGame.gamePin}</p>
                                  <p className="text-sm text-gray-600">{t("host.scanToJoin")}</p>
                                  <p className="text-xs text-gray-500 mt-2">{t("host.orVisit", { url: `${window.location.origin}/join/${createdGame.gamePin}` })}</p>
                                </div>
                                <Button
                                  variant="outline"
                                  onClick={() => copyToClipboard(`${window.location.origin}/join/${createdGame.gamePin}`, t("host.joinLinkLabel"))}
                                  className="w-full"
                                >
                                  <Copy className="w-4 h-4 me-2" />
                                  {t("host.copyJoinLink")}
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                        </div>
                        <p className="text-xs text-gray-500">{t("host.clickToViewLarger")}</p>
                      </div>
                    )}

                    {/* Share Options */}
                    <div className="space-y-3">
                      <h4 className="font-semibold text-gray-800 flex items-center gap-2 justify-center">
                        <Share2 className="w-4 h-4" />
                        {t("host.shareWithPlayers")}
                      </h4>

                      <div className="space-y-2">
                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(createdGame.gamePin, t("host.gamePinLabel"))}
                          className="w-full"
                        >
                          <Copy className="w-4 h-4 me-2" />
                          {t("host.copyPin")}
                        </Button>

                        <Button
                          variant="outline"
                          onClick={() => copyToClipboard(`${window.location.origin}/join/${createdGame.gamePin}`, t("host.joinLinkLabel"))}
                          className="w-full"
                        >
                          <Copy className="w-4 h-4 me-2" />
                          {t("host.copyJoinLink")}
                        </Button>
                      </div>
                    </div>

                    {/* Start Hosting */}
                    <Button
                      onClick={() => setLocation(`/host/${createdGame.gamePin}`)}
                      className="w-full abraj-green hover:bg-green-600 text-white font-medium py-3 text-lg btn-glow"
                      data-testid="button-start-hosting"
                    >
                      <Play className="w-5 h-5 me-2" />
                      {t("host.startHosting")}
                    </Button>
                  </div>
                )}

                <div className="pt-4 border-t text-center">
                  <p className="text-sm text-gray-500 mb-3">
                    {t("host.notReadyToHost")}
                  </p>
                  <div className="space-y-2">
                    <Button
                      variant="outline"
                      onClick={() => setLocation("/my-quizzes")}
                      className="w-full"
                    >
                      {t("host.backToMyQuizzes")}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => setLocation(`/edit-quiz/${quizId}`)}
                      className="w-full"
                      data-testid="button-edit-quiz"
                    >
                      {t("host.editQuiz")}
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