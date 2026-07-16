import type { QuizTheme, QuizFont, QuizCardStyle } from "@shared/quiz-theme";
import { PRESET_QUIZ_THEMES } from "@shared/quiz-theme";
import { getThemeSwatchStyle, PRESET_THEMES } from "@/utils/backgrounds";
import { QuizQuestionRenderer } from "./QuizQuestionRenderer";
import { ImagePlus } from "lucide-react";

const FONTS: QuizFont[] = ["sans", "serif", "rounded", "mono"];
const CARD_STYLES: QuizCardStyle[] = ["solid", "soft", "outline"];

export interface ThemeBuilderProps {
  theme: QuizTheme;
  onChange: (theme: QuizTheme) => void;
  onUploadBackground: (file: File) => void;
  uploading?: boolean;
}

export function ThemeBuilder({ theme, onChange, onUploadBackground, uploading }: ThemeBuilderProps) {
  const set = (patch: Partial<QuizTheme>) => onChange({ ...theme, ...patch });
  const previewQuestion = {
    question: "Sample question preview",
    answers: ["Answer A", "Answer B", "Answer C", "Answer D"],
    answerType: "single" as const,
    type: "quiz" as const,
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
      <div className="space-y-4">
        {/* Presets */}
        <div>
          <div className="text-xs font-semibold text-gray-500 mb-1">Preset themes</div>
          <div className="grid grid-cols-4 gap-2">
            {PRESET_QUIZ_THEMES.map((p) => {
              const swatch = PRESET_THEMES.find((t) => t.id === p.theme.background);
              return (
                <button
                  key={p.id}
                  onClick={() => onChange(p.theme)}
                  className={`h-12 rounded-lg border-2 relative ${theme.background === p.theme.background ? "border-abraj-primary" : "border-transparent"}`}
                  style={swatch ? getThemeSwatchStyle(swatch) : { background: p.theme.accent }}
                  title={p.label}
                />
              );
            })}
          </div>
        </div>

        {/* Custom background upload */}
        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
          <ImagePlus className="w-4 h-4" /> {uploading ? "Uploading…" : "Custom background image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadBackground(f); e.target.value = ""; }} />
        </label>

        {/* Colors */}
        <div className="grid grid-cols-3 gap-3">
          <label className="text-xs text-gray-500">Accent
            <input type="color" value={theme.accent} onChange={(e) => set({ accent: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">Question text
            <input type="color" value={theme.questionText} onChange={(e) => set({ questionText: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
          <label className="text-xs text-gray-500">Question card
            <input type="color" value={theme.questionCard} onChange={(e) => set({ questionCard: e.target.value })} className="block w-full h-8 mt-1" />
          </label>
        </div>

        {/* Font + card style */}
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-gray-500">Font
            <select value={theme.font} onChange={(e) => set({ font: e.target.value as QuizFont })} className="block w-full mt-1 border rounded p-1 text-sm">
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-500">Card style
            <select value={theme.cardStyle} onChange={(e) => set({ cardStyle: e.target.value as QuizCardStyle })} className="block w-full mt-1 border rounded p-1 text-sm">
              {CARD_STYLES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
      </div>

      {/* Live preview — the real renderer */}
      <div className="h-72">
        <div className="text-xs font-semibold text-gray-500 mb-1">Live preview</div>
        <div className="h-64">
          <QuizQuestionRenderer question={previewQuestion} theme={theme} questionNumber={1} totalQuestions={5} />
        </div>
      </div>
    </div>
  );
}
