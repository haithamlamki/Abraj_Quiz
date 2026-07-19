import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Monitor, Smartphone } from "lucide-react";
import type { Quiz, Question } from "@shared/schema";
import { QuizQuestionRenderer } from "@/components/quiz/QuizQuestionRenderer";
import { resolveQuizTheme } from "@shared/quiz-theme";
import { PageLoader } from "@/components/page-loader";

// Normalize a stored question (legacy or new) to the fields the renderer needs.
function normalize(q: any): Question {
  return {
    question: q.question ?? "",
    imageUrl: q.imageUrl,
    type: q.type ?? "quiz",
    answerType: q.answerType ?? "single",
    answers: Array.isArray(q.answers) ? q.answers : [],
    correctAnswers: Array.isArray(q.correctAnswers)
      ? q.correctAnswers
      : [typeof q.correctAnswer === "number" ? q.correctAnswer : 0],
    timeLimit: q.timeLimit ?? 20,
    points: q.points === "double" ? "double" : "standard",
  };
}

export default function QuizPreview() {
  const { t } = useTranslation();
  const { quizId } = useParams();
  const [, setLocation] = useLocation();
  const [index, setIndex] = useState(0);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  const { data: quiz, isLoading } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", quizId],
    enabled: !!quizId,
  });

  if (isLoading) return <PageLoader label={t("preview.loading")} />;
  if (!quiz) return <div className="page-fill flex items-center justify-center text-white bg-slate-900">{t("preview.notFound")}</div>;

  const questions = (Array.isArray(quiz.questions) ? quiz.questions : []).map(normalize);
  const q = questions[index];
  const bg = quiz.background || "classroom";
  const theme = resolveQuizTheme(quiz);

  return (
    <div className="page-fill bg-slate-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" size="sm" className="text-white" onClick={() => setLocation(`/edit-quiz/${quizId}`)}>
          <ArrowLeft className="w-4 h-4 me-1 rtl:rotate-180" /> {t("preview.backToEditor")}
        </Button>
        <div className="flex items-center gap-2 bg-slate-800 rounded-lg p-1">
          <button onClick={() => setDevice("desktop")} className={`px-2 py-1 rounded ${device === "desktop" ? "bg-slate-600" : ""}`} title={t("preview.desktopTitle")}><Monitor className="w-4 h-4" /></button>
          <button onClick={() => setDevice("mobile")} className={`px-2 py-1 rounded ${device === "mobile" ? "bg-slate-600" : ""}`} title={t("preview.mobileTitle")}><Smartphone className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 px-6 pb-6">
        {/* Host view — the exact shared renderer used in the live game */}
        <div className="min-w-0">
          <div className="text-slate-300 text-sm mb-2">{t("preview.hostView")}</div>
          <div className={`mx-auto ${device === "mobile" ? "max-w-sm" : ""} h-[460px]`}>
            <QuizQuestionRenderer
              question={q}
              background={bg}
              theme={theme}
              questionNumber={index + 1}
              totalQuestions={questions.length}
              reveal
              correctAnswers={q?.correctAnswers}
            />
          </div>
        </div>

        {/* Participant view — same renderer, shape-only tiles */}
        <div className="min-w-0">
          <div className="text-slate-300 text-sm mb-2">{t("preview.participantView")}</div>
          <div className="mx-auto max-w-xs h-[460px]">
            <QuizQuestionRenderer question={q} background={bg} theme={theme} shapeOnly />
          </div>
        </div>
      </div>

      <footer className="flex items-center justify-center gap-4 py-4">
        <Button variant="ghost" size="sm" className="text-white" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ChevronLeft className="w-4 h-4 rtl:rotate-180" />
        </Button>
        <span className="text-slate-300 text-sm">{t("preview.pageCounter", { current: index + 1, total: questions.length })}</span>
        <Button variant="ghost" size="sm" className="text-white" disabled={index >= questions.length - 1} onClick={() => setIndex((i) => i + 1)}>
          <ChevronRight className="w-4 h-4 rtl:rotate-180" />
        </Button>
      </footer>
    </div>
  );
}
