import type { Question } from "@shared/schema";
import { getBackgroundStyle } from "@/utils/backgrounds";
import type { QuizTheme } from "@shared/quiz-theme";
import { QuizThemeProvider } from "./QuizThemeProvider";
import { AnswerGrid } from "./AnswerGrid";
import { Clock } from "lucide-react";

export interface QuizQuestionRendererProps {
  question: Pick<Question, "question" | "imageUrl" | "answers" | "answerType" | "type">;
  background?: string;
  theme?: QuizTheme;
  questionNumber?: number;
  totalQuestions?: number;
  timeRemaining?: number | null;
  /** Participant tiles: colored shapes only (no text/question). */
  shapeOnly?: boolean;

  // Player interaction
  selectedIndices?: number[];
  onSelect?: (index: number) => void;
  disabled?: boolean;

  // Reveal (host/player after close)
  reveal?: boolean;
  correctAnswers?: number[];
  distribution?: { counts: number[]; percentages: number[] };

  className?: string;
}

// THE shared question stage. Editor, preview, host, and player all present the
// question through this one component, so the preview is pixel-identical to the
// live game and sizing can never drift. Surrounding chrome (host controls,
// player result overlays) lives in the pages; the "stage" lives here.
export function QuizQuestionRenderer({
  question,
  background = "aurora",
  theme,
  questionNumber,
  totalQuestions,
  timeRemaining,
  shapeOnly = false,
  selectedIndices,
  onSelect,
  disabled,
  reveal,
  correctAnswers,
  distribution,
  className = "",
}: QuizQuestionRendererProps) {
  // Participant view: just the colored shape grid, filling the container.
  if (shapeOnly) {
    const shapeClass = `h-full rounded-2xl overflow-hidden p-3 flex ${className}`;
    const shapeInner = (
      <AnswerGrid answers={question.answers} shapeOnly onSelect={onSelect} selectedIndices={selectedIndices} disabled={disabled} className="flex-1" />
    );
    if (theme) {
      return <QuizThemeProvider theme={theme} className={shapeClass}>{shapeInner}</QuizThemeProvider>;
    }
    return (
      <div className={shapeClass} style={getBackgroundStyle(background)}>
        {shapeInner}
      </div>
    );
  }

  const stageClass = `h-full w-full rounded-2xl overflow-hidden flex flex-col p-3 sm:p-5 gap-3 sm:gap-4 ${className}`;
  const stageInner = (
    <>
      {/* Progress + timer bar */}
      {(questionNumber != null || timeRemaining != null) && (
        <div className="flex items-center justify-between shrink-0">
          {questionNumber != null ? (
            <span
              className="text-white text-xs sm:text-sm font-semibold rounded-full px-3 py-1"
              style={{ backgroundColor: theme ? "var(--quiz-accent)" : "rgba(255,255,255,0.9)", color: theme ? "#fff" : "#1e293b" }}
            >
              Question {questionNumber}{totalQuestions ? ` of ${totalQuestions}` : ""}
            </span>
          ) : <span />}
          {timeRemaining != null && (
            <span className={`flex items-center gap-1 text-white font-bold rounded-full px-3 py-1 ${timeRemaining <= 5 ? "bg-red-600" : "bg-black/40"}`}>
              <Clock className="w-4 h-4" /> {timeRemaining}
            </span>
          )}
        </div>
      )}

      {/* Question text — fixed, centered, never grows the answers */}
      <div
        className="shrink-0 rounded-xl px-4 sm:px-6 py-3 sm:py-4 text-center shadow"
        style={{ backgroundColor: theme ? "var(--quiz-question-card)" : "#fff" }}
      >
        <h2
          className="font-bold text-base sm:text-xl md:text-2xl leading-snug line-clamp-3"
          style={{ color: theme ? "var(--quiz-question-text)" : "#1e293b" }}
        >
          {question.question || "Untitled question"}
        </h2>
      </div>

      {/* Media — fixed aspect container so different image sizes don't shift layout */}
      {question.imageUrl && (
        <div className="shrink-0 flex justify-center">
          <div className="w-full max-w-md aspect-[16/9] rounded-xl overflow-hidden bg-black/10 flex items-center justify-center">
            <img src={question.imageUrl} alt="Question" className="w-full h-full object-contain" />
          </div>
        </div>
      )}

      {/* Answers — fixed-size grid fills the remaining space */}
      <AnswerGrid
        answers={question.answers}
        selectedIndices={selectedIndices}
        disabled={disabled}
        onSelect={onSelect}
        correctAnswers={correctAnswers}
        reveal={reveal}
        distribution={distribution}
        className="flex-1 min-h-0"
      />
    </>
  );

  if (theme) {
    return <QuizThemeProvider theme={theme} className={stageClass}>{stageInner}</QuizThemeProvider>;
  }
  return (
    <div className={stageClass} style={getBackgroundStyle(background)}>
      {stageInner}
    </div>
  );
}
