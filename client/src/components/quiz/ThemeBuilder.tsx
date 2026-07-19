import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { QuizTheme, QuizFont, QuizCardStyle } from "@shared/quiz-theme";
import { PRESET_QUIZ_THEMES } from "@shared/quiz-theme";
import { getThemeSwatchStyle, PRESET_THEMES } from "@/utils/backgrounds";
import { QuizQuestionRenderer } from "./QuizQuestionRenderer";
import { ImagePlus, Sparkles } from "lucide-react";

const FONTS: QuizFont[] = ["sans", "serif", "rounded", "mono"];
const CARD_STYLES: QuizCardStyle[] = ["solid", "soft", "outline"];

export interface ThemeBuilderProps {
  theme: QuizTheme;
  onChange: (theme: QuizTheme) => void;
  onUploadBackground: (file: File) => void;
  uploading?: boolean;
  /** Tenant has the aiGeneration feature — hides the AI section when false. */
  aiEnabled?: boolean;
  /** An AI generation request is in flight. */
  generating?: boolean;
  onGenerateBackground?: (prompt: string) => void;
  /** Pre-fill for the AI prompt (the quiz title). */
  defaultAiPrompt?: string;
}

export function ThemeBuilder({ theme, onChange, onUploadBackground, uploading, aiEnabled, generating, onGenerateBackground, defaultAiPrompt }: ThemeBuilderProps) {
  const { t } = useTranslation();
  const [aiPrompt, setAiPrompt] = useState(defaultAiPrompt ?? "");
  const set = (patch: Partial<QuizTheme>) => onChange({ ...theme, ...patch });
  const previewQuestion = {
    question: t("editor.theme.previewSampleQuestion"),
    answers: [
      t("editor.theme.previewAnswerA"),
      t("editor.theme.previewAnswerB"),
      t("editor.theme.previewAnswerC"),
      t("editor.theme.previewAnswerD"),
    ],
    answerType: "single" as const,
    type: "quiz" as const,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-4">
        {/* Presets */}
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">{t("editor.theme.presetThemesLabel")}</div>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_QUIZ_THEMES.map((p) => {
              const swatch = PRESET_THEMES.find((preset) => preset.id === p.theme.background);
              return (
                <button
                  key={p.id}
                  onClick={() => onChange(p.theme)}
                  className={`h-12 rounded-lg border-2 relative ${theme.background === p.theme.background ? "border-abraj-primary" : "border-transparent"}`}
                  style={swatch ? getThemeSwatchStyle(swatch) : { background: p.theme.accent }}
                  title={t(`editor.theme.presets.${p.id}`, { defaultValue: p.label })}
                />
              );
            })}
          </div>
        </div>

        {/* Generate with AI */}
        {aiEnabled && onGenerateBackground && (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">{t("editor.theme.ai.sectionLabel")}</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                maxLength={300}
                disabled={generating}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t("editor.theme.ai.promptPlaceholder")}
                className="flex-1 border rounded p-2 text-sm"
              />
              <button
                onClick={() => onGenerateBackground(aiPrompt.trim())}
                disabled={generating || aiPrompt.trim().length < 3}
                className="shrink-0 flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium text-abraj-primary border-abraj-primary disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" /> {t("editor.theme.ai.generateButton")}
              </button>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{aiPrompt.length} / 300</div>
            {generating && (
              <div className="text-xs text-gray-600 mt-1" role="status" aria-live="polite">
                <div>{t("editor.theme.ai.generatingTitle")}</div>
                <div className="text-gray-400">{t("editor.theme.ai.generatingHint")}</div>
              </div>
            )}
          </div>
        )}

        {/* Custom background upload */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <ImagePlus className="w-4 h-4" /> {uploading ? t("editor.theme.uploading") : t("editor.theme.customBackgroundLabel")}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadBackground(f); e.target.value = ""; }} />
        </label>

        {/* Colors */}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">{t("editor.theme.accentLabel")}
            <input type="color" value={theme.accent} onChange={(e) => set({ accent: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">{t("editor.theme.questionTextLabel")}
            <input type="color" value={theme.questionText} onChange={(e) => set({ questionText: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">{t("editor.theme.questionCardLabel")}
            <input type="color" value={theme.questionCard} onChange={(e) => set({ questionCard: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
        </div>

        {/* Readability overlay */}
        <label className="block text-xs text-gray-500">
          {t("editor.theme.overlayLabel")} ({Math.round((theme.overlay ?? 0) * 100)}%)
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={Math.round((theme.overlay ?? 0) * 100)}
            onChange={(e) => set({ overlay: Number(e.target.value) / 100 })}
            className="block w-full mt-1"
          />
        </label>

        {/* Font + card style — option text mirrors the internal font/card-style
            ids (sans/serif/rounded/mono, solid/soft/outline); these are not
            translated, same as preset theme ids. */}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">{t("editor.theme.fontLabel")}
            <select value={theme.font} onChange={(e) => set({ font: e.target.value as QuizFont })} className="block w-full mt-1 border rounded p-1 text-sm">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">{t("editor.theme.cardStyleLabel")}
            <select value={theme.cardStyle} onChange={(e) => set({ cardStyle: e.target.value as QuizCardStyle })} className="block w-full mt-1 border rounded p-1 text-sm">
              {CARD_STYLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Live preview — the real renderer */}
      <div className="h-72">
        <div className="text-xs font-semibold text-gray-500 mb-1">{t("editor.theme.livePreviewLabel")}</div>
        <div className="h-64">
          <QuizQuestionRenderer question={previewQuestion} theme={theme} questionNumber={1} totalQuestions={5} />
        </div>
      </div>
    </div>
  );
}
