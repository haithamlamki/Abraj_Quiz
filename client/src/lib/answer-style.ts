import { Triangle, Diamond, Circle, Square, Star, Hexagon, type LucideIcon } from "lucide-react";

// Single source of truth for the Kahoot-style answer color + shape per option
// index. Supports up to 6 answers (was hardcoded to 4 in three separate places).
// The first four keep the existing app palette so the look is unchanged; the
// 5th/6th add teal + purple for the new higher answer counts.
export interface AnswerStyle {
  /** CSS background utility class (abraj-* from index.css, or a Tailwind class). */
  bg: string;
  icon: LucideIcon;
}

export const ANSWER_STYLES: AnswerStyle[] = [
  { bg: "abraj-red", icon: Triangle },
  { bg: "abraj-blue", icon: Diamond },
  { bg: "abraj-green", icon: Circle },
  { bg: "abraj-yellow", icon: Square },
  { bg: "bg-teal-500", icon: Star },
  { bg: "bg-purple-600", icon: Hexagon },
];

export function answerStyle(index: number): AnswerStyle {
  return ANSWER_STYLES[index % ANSWER_STYLES.length];
}
