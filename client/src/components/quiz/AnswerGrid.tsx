import { AnswerCard, type Reveal } from "./AnswerCard";
import { QUIZ_GRID_GAP } from "./layout";

export interface AnswerGridProps {
  answers: string[];
  /** Participant tiles: colored shapes only, no text. */
  shapeOnly?: boolean;
  /** Fill mode: rows stretch to fill the container (participant shape grid).
   *  Default (fixed) mode: every card is the shared fixed height, so the grid
   *  sits as a compact block pinned to the bottom of the stage. */
  fill?: boolean;
  selectedIndices?: number[];
  disabled?: boolean;
  onSelect?: (index: number) => void;
  /** When revealing: the correct set (single or multi). */
  correctAnswers?: number[];
  reveal?: boolean;
  /** Poll reveal: show distribution bars only — never a correct/wrong ring or
   *  a check/X icon (a poll has no correct answer to leak). */
  isPoll?: boolean;
  /** Host distribution bars. */
  distribution?: { counts: number[]; percentages: number[] };
  className?: string;
}

// Equal-sized grid for 2–6 answers. Always 2 columns so every card is the SAME
// size regardless of text length or answer count (2 → one wide row, 3–4 → 2×2,
// 5–6 → 2×3). This is the single grid used by the editor, preview, host, and
// player — sizing comes from the shared layout tokens, never per-page CSS.
export function AnswerGrid({
  answers,
  shapeOnly = false,
  fill = false,
  selectedIndices = [],
  disabled = false,
  onSelect,
  correctAnswers,
  reveal = false,
  isPoll = false,
  distribution,
  className = "",
}: AnswerGridProps) {
  const correct = new Set(correctAnswers ?? []);
  return (
    <div className={`grid grid-cols-2 ${fill ? "auto-rows-fr" : ""} ${QUIZ_GRID_GAP} ${className}`}>
      {answers.map((text, i) => {
        let rev: Reveal = "none";
        // Polls have no correct answer (correctAnswers is always []) — without
        // this guard every option would fall through to "wrong" (opacity + X).
        if (reveal && !isPoll) rev = correct.has(i) ? "correct" : "wrong";
        const bar =
          distribution && reveal
            ? { percent: distribution.percentages[i] ?? 0, count: distribution.counts[i] ?? 0 }
            : null;
        return (
          <AnswerCard
            key={i}
            index={i}
            text={text}
            shapeOnly={shapeOnly}
            fill={fill}
            selected={selectedIndices.includes(i)}
            disabled={disabled}
            reveal={rev}
            bar={bar}
            onClick={onSelect ? () => onSelect(i) : undefined}
          />
        );
      })}
    </div>
  );
}
