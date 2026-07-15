import { AnswerCard, type Reveal } from "./AnswerCard";

export interface AnswerGridProps {
  answers: string[];
  /** Participant tiles: colored shapes only, no text. */
  shapeOnly?: boolean;
  selectedIndices?: number[];
  disabled?: boolean;
  onSelect?: (index: number) => void;
  /** When revealing: the correct set (single or multi). */
  correctAnswers?: number[];
  reveal?: boolean;
  /** Host distribution bars. */
  distribution?: { counts: number[]; percentages: number[] };
  className?: string;
}

// Equal-sized fixed grid for 2–6 answers. Always 2 columns with auto-rows-fr so
// every card is the SAME size regardless of text length or answer count
// (2 → one wide row, 3–4 → 2×2, 5–6 → 2×3). This is the single grid used by the
// preview, host, and player renderers.
export function AnswerGrid({
  answers,
  shapeOnly = false,
  selectedIndices = [],
  disabled = false,
  onSelect,
  correctAnswers,
  reveal = false,
  distribution,
  className = "",
}: AnswerGridProps) {
  const correct = new Set(correctAnswers ?? []);
  return (
    <div className={`grid grid-cols-2 auto-rows-fr gap-2 sm:gap-3 ${className}`}>
      {answers.map((text, i) => {
        let rev: Reveal = "none";
        if (reveal) rev = correct.has(i) ? "correct" : "wrong";
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
