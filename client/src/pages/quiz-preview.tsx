import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Check } from "lucide-react";
import type { Quiz, Question } from "@shared/schema";
import { answerStyle } from "@/lib/answer-style";
import { getBackgroundStyle } from "@/utils/backgrounds";

// Normalize a stored question (legacy or new) to the fields the preview needs.
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
  };
}

export default function QuizPreview() {
  const { quizId } = useParams();
  const [, setLocation] = useLocation();
  const [index, setIndex] = useState(0);

  const { data: quiz, isLoading } = useQuery<Quiz>({
    queryKey: ["/api/quizzes", quizId],
    enabled: !!quizId,
  });

  if (isLoading) return <div className="min-h-screen flex items-center justify-center text-white bg-slate-900">Loading…</div>;
  if (!quiz) return <div className="min-h-screen flex items-center justify-center text-white bg-slate-900">Quiz not found.</div>;

  const questions = (Array.isArray(quiz.questions) ? quiz.questions : []).map(normalize);
  const q = questions[index];
  const bg = getBackgroundStyle(quiz.background || "classroom");

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col">
      <header className="flex items-center justify-between px-4 py-3">
        <Button variant="ghost" size="sm" className="text-white" onClick={() => setLocation(`/edit-quiz/${quizId}`)}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to editor
        </Button>
        <div className="text-sm text-slate-300">Preview</div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6 px-6 pb-6">
        {/* Host view */}
        <div>
          <div className="text-slate-300 text-sm mb-2">Host view</div>
          <div className="rounded-2xl p-6 flex flex-col gap-4 min-h-[420px]" style={bg}>
            <div className="bg-white text-slate-900 font-bold text-xl rounded-xl px-6 py-4 text-center max-w-xl mx-auto w-full">
              {q?.question || "Untitled question"}
            </div>
            {q?.imageUrl && (
              <div className="flex justify-center"><img src={q.imageUrl} alt="" className="max-h-40 rounded-xl object-contain shadow-lg" /></div>
            )}
            <div className="mt-auto grid grid-cols-2 auto-rows-fr gap-3">
              {q?.answers.map((a, i) => {
                const s = answerStyle(i);
                const Icon = s.icon;
                const correct = q.correctAnswers.includes(i);
                return (
                  <div key={i} className={`${s.bg} text-white rounded-xl px-3 min-h-[64px] flex items-center gap-2 font-semibold ${correct ? "ring-4 ring-yellow-400" : ""}`}>
                    <Icon className="w-5 h-5 shrink-0" fill="white" strokeWidth={0} />
                    <span className="line-clamp-2 text-sm">{a}</span>
                    {correct && <Check className="w-5 h-5 ml-auto shrink-0" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Participant view */}
        <div>
          <div className="text-slate-300 text-sm mb-2">Participant view</div>
          <div className="rounded-2xl p-4 bg-slate-800 min-h-[420px] flex flex-col">
            <div className="text-xs text-slate-400 mb-2">{q?.type === "true_false" ? "True / False" : q?.answerType === "multiple" ? "Multi-select" : "Quiz"}</div>
            <div className="flex-1 grid grid-cols-2 auto-rows-fr gap-3">
              {q?.answers.map((_, i) => {
                const s = answerStyle(i);
                const Icon = s.icon;
                return (
                  <div key={i} className={`${s.bg} rounded-xl flex items-center justify-center min-h-[64px]`}>
                    <Icon className="w-8 h-8 text-white" fill="white" strokeWidth={0} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <footer className="flex items-center justify-center gap-4 py-4">
        <Button variant="ghost" size="sm" className="text-white" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          <ChevronLeft className="w-4 h-4" />
        </Button>
        <span className="text-slate-300 text-sm">{index + 1} / {questions.length}</span>
        <Button variant="ghost" size="sm" className="text-white" disabled={index >= questions.length - 1} onClick={() => setIndex((i) => i + 1)}>
          <ChevronRight className="w-4 h-4" />
        </Button>
      </footer>
    </div>
  );
}
