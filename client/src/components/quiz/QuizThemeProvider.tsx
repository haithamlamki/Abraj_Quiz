import type { CSSProperties, ReactNode } from "react";
import type { QuizTheme } from "@shared/quiz-theme";
import { themeToCssVars } from "@shared/quiz-theme";
import { getBackgroundStyle } from "@/utils/backgrounds";

export interface QuizThemeProviderProps {
  theme: QuizTheme;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

// Injects the theme as CSS variables + background onto a wrapper element. Every
// surface (renderer, editor canvas, preview) wraps its stage in this so the
// theme is applied identically and cannot drift.
export function QuizThemeProvider({ theme, children, className = "", style }: QuizThemeProviderProps) {
  const vars = themeToCssVars(theme) as CSSProperties;
  return (
    <div
      className={className}
      style={{ ...getBackgroundStyle(theme.background), ...vars, fontFamily: "var(--quiz-font)", ...style }}
    >
      {children}
    </div>
  );
}
