import { Check, X } from "lucide-react";
import { answerStyle } from "@/lib/answer-style";

// Shared design tokens for answer cards — the single source of sizing so the
// editor, preview, host, and player never drift. Cards are FIXED height and
// text is clamped, so long answers never resize the grid.
export const ANSWER_CARD_MIN_H = "min-h-[64px] sm:min-h-[72px]";

export type Reveal = "none" | "correct" | "wrong";

export interface AnswerCardProps {
  index: number;                 // 0..5 → color + shape
  text?: string;
  /** Participant tiles show only the colored shape (no text). */
  shapeOnly?: boolean;
  selected?: boolean;
  disabled?: boolean;
  reveal?: Reveal;
  /** Host distribution bar. */
  bar?: { percent: number; count: number } | null;
  onClick?: () => void;
  className?: string;
}

// One fixed-size Kahoot answer card used across every live/preview surface.
export function AnswerCard({
  index,
  text,
  shapeOnly = false,
  selected = false,
  disabled = false,
  reveal = "none",
  bar = null,
  onClick,
  className = "",
}: AnswerCardProps) {
  const style = answerStyle(index);
  const Icon = style.icon;

  const revealRing =
    reveal === "correct"
      ? "ring-4 ring-yellow-400 shadow-lg shadow-yellow-400/40"
      : reveal === "wrong"
        ? "opacity-60 ring-2 ring-white/30"
        : "";
  const selectedRing = selected ? "ring-4 ring-white" : "";
  const interactive = onClick && !disabled ? "cursor-pointer hover:brightness-105 active:scale-[0.99]" : "";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      aria-pressed={selected}
      className={`${style.bg} ${ANSWER_CARD_MIN_H} w-full h-full text-white font-bold relative overflow-hidden flex items-center transition-all ${revealRing} ${selectedRing} ${interactive} ${disabled && !selected && reveal === "none" ? "opacity-70" : ""} ${className}`}
      style={{ borderRadius: "var(--quiz-card-radius, 0.75rem)", boxShadow: "var(--quiz-card-shadow, 0 4px 6px rgba(0,0,0,0.15))" }}
    >
      {shapeOnly ? (
        <div className="flex items-center justify-center w-full">
          <Icon className="w-10 h-10 sm:w-12 sm:h-12" fill="white" strokeWidth={0} />
        </div>
      ) : (
        <div className="flex items-center gap-2 sm:gap-3 w-full px-3 py-2">
          <Icon className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" fill="white" strokeWidth={0} />
          <span className="flex-1 text-left text-sm sm:text-base leading-tight line-clamp-3">{text}</span>
          {reveal === "correct" && <Check className="w-6 h-6 shrink-0" strokeWidth={3} />}
          {reveal === "wrong" && <X className="w-6 h-6 shrink-0 opacity-80" strokeWidth={3} />}
        </div>
      )}

      {bar && (
        <div className="absolute left-0 right-0 bottom-0 px-3 pb-1">
          <div className="bg-white/25 rounded-full h-1.5 w-full overflow-hidden">
            <div className="bg-white h-1.5 rounded-full transition-all duration-700" style={{ width: `${bar.percent}%` }} />
          </div>
          <div className="text-[10px] sm:text-xs text-white/90 text-right mt-0.5">{bar.percent}% ({bar.count})</div>
        </div>
      )}
    </button>
  );
}
