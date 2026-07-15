// The quiz theme model — shared by the client renderer, the editor's theme
// builder, and the PDF report branding. A theme controls the STAGE chrome
// (background, accent, question card, font, answer-card shape) only; the 6
// answer option colors/shapes are the game's fixed identity and are never
// themed (see client/src/lib/answer-style.ts).

export type QuizFont = "sans" | "serif" | "rounded" | "mono";
export type QuizCardStyle = "solid" | "soft" | "outline";

export interface QuizTheme {
  /** Gradient id | image id | https URL — resolved by utils/backgrounds.ts. */
  background: string;
  /** Progress pill, timer chip, selected ring. Hex. */
  accent: string;
  /** Question text color. Hex. */
  questionText: string;
  /** Question card background. Hex or rgba(). */
  questionCard: string;
  font: QuizFont;
  cardStyle: QuizCardStyle;
}

export const QUIZ_FONT_STACKS: Record<QuizFont, string> = {
  sans: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
  serif: "ui-serif, Georgia, Cambria, 'Times New Roman', serif",
  rounded: "'Nunito', ui-rounded, 'Segoe UI', system-ui, sans-serif",
  mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
};

const CARD_RADIUS: Record<QuizCardStyle, string> = {
  solid: "0.75rem",
  soft: "1.25rem",
  outline: "0.5rem",
};

const CARD_SHADOW: Record<QuizCardStyle, string> = {
  solid: "0 4px 6px rgba(0,0,0,0.15)",
  soft: "0 10px 20px rgba(0,0,0,0.20)",
  outline: "0 0 0 2px rgba(255,255,255,0.6) inset",
};

export const DEFAULT_QUIZ_THEME: QuizTheme = {
  background: "aurora",
  accent: "#0f766e",
  questionText: "#1e293b",
  questionCard: "#ffffff",
  font: "sans",
  cardStyle: "solid",
};

export const PRESET_QUIZ_THEMES: Array<{ id: string; label: string; theme: QuizTheme }> = [
  { id: "aurora",   label: "Aurora",   theme: { ...DEFAULT_QUIZ_THEME, background: "aurora",   accent: "#6d28d9" } },
  { id: "sunset",   label: "Sunset",   theme: { ...DEFAULT_QUIZ_THEME, background: "sunset",   accent: "#db2777" } },
  { id: "mint",     label: "Mint",     theme: { ...DEFAULT_QUIZ_THEME, background: "mint",     accent: "#059669" } },
  { id: "grape",    label: "Grape",    theme: { ...DEFAULT_QUIZ_THEME, background: "grape",    accent: "#7c3aed" } },
  { id: "ember",    label: "Ember",    theme: { ...DEFAULT_QUIZ_THEME, background: "ember",    accent: "#ea580c" } },
  { id: "midnight", label: "Midnight", theme: { ...DEFAULT_QUIZ_THEME, background: "midnight", accent: "#38bdf8", questionText: "#0f172a", font: "rounded" } },
  { id: "classroom", label: "Classroom", theme: { ...DEFAULT_QUIZ_THEME, background: "classroom", accent: "#2563eb" } },
];

function isQuizTheme(value: unknown): value is Partial<QuizTheme> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// A quiz stores `background` (legacy single field) and optionally `theme` (the
// richer config). The theme's background falls back to the quiz.background so
// existing quizzes keep their look with no data migration.
export function resolveQuizTheme(quiz: { background?: string | null; theme?: unknown }): QuizTheme {
  const custom = isQuizTheme(quiz.theme) ? quiz.theme : {};
  return {
    ...DEFAULT_QUIZ_THEME,
    background: custom.background ?? quiz.background ?? DEFAULT_QUIZ_THEME.background,
    accent: custom.accent ?? DEFAULT_QUIZ_THEME.accent,
    questionText: custom.questionText ?? DEFAULT_QUIZ_THEME.questionText,
    questionCard: custom.questionCard ?? DEFAULT_QUIZ_THEME.questionCard,
    font: custom.font ?? DEFAULT_QUIZ_THEME.font,
    cardStyle: custom.cardStyle ?? DEFAULT_QUIZ_THEME.cardStyle,
  };
}

export function themeToCssVars(theme: QuizTheme): Record<string, string> {
  return {
    "--quiz-accent": theme.accent,
    "--quiz-question-text": theme.questionText,
    "--quiz-question-card": theme.questionCard,
    "--quiz-font": QUIZ_FONT_STACKS[theme.font],
    "--quiz-card-radius": CARD_RADIUS[theme.cardStyle],
    "--quiz-card-shadow": CARD_SHADOW[theme.cardStyle],
  };
}
