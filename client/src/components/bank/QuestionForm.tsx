import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, ImagePlus, Loader2, Plus, X } from "lucide-react";
import type { Question } from "@shared/schema";
import {
  withAnswerText, withAddedAnswer, withRemovedAnswer, withToggledCorrect, withType, withAnswerMode,
} from "@/lib/question-form-utils";

const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

interface QuestionFormProps {
  value: Question;
  onChange: (q: Question) => void;
  uploading?: boolean;
  onUploadImage?: (file: File) => void;
}

// Compact question editor for dialogs (bank create/edit). Shares ALL mutation
// and validation logic with the quiz editor via question-form-utils; only the
// layout differs (vertical form vs. the editor's full-canvas stage).
export function QuestionForm({ value, onChange, uploading, onUploadImage }: QuestionFormProps) {
  const { t } = useTranslation();
  const imageInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-4">
      <Textarea
        value={value.question}
        onChange={(e) => onChange({ ...value, question: e.target.value })}
        placeholder={t("editor.question.placeholder")}
        rows={2}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("editor.question.questionTypeLabel")}</label>
          <Select value={value.type} onValueChange={(v) => onChange(withType(value, v as Question["type"]))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="quiz">{t("editor.question.typeQuiz")}</SelectItem>
              <SelectItem value="true_false">{t("editor.question.typeTrueFalse")}</SelectItem>
              <SelectItem value="poll">{t("editor.question.typePoll")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("editor.timing.label")}</label>
          <Select value={String(value.timeLimit)} onValueChange={(v) => onChange({ ...value, timeLimit: parseInt(v, 10) })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("editor.timing.noLimit")}</SelectItem>
              {TIME_OPTIONS.map((secs) => (
                <SelectItem key={secs} value={String(secs)}>{t("editor.timing.secondsOption", { count: secs })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("editor.question.answerOptionsLabel")}</label>
          <Select
            value={value.answerType}
            onValueChange={(v) => onChange(withAnswerMode(value, v as Question["answerType"]))}
            disabled={value.type === "true_false"}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">{t("editor.question.answerModeSingle")}</SelectItem>
              <SelectItem value="multiple">{t("editor.question.answerModeMultiple")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {value.type !== "poll" && (
          <div>
            <label className="text-xs text-gray-500">{t("editor.question.pointsLabel")}</label>
            <Select value={value.points} onValueChange={(v) => onChange({ ...value, points: v as Question["points"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t("editor.question.pointsStandard")}</SelectItem>
                <SelectItem value="double">{t("editor.question.pointsDouble")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="space-y-2">
        {value.answers.map((answer, index) => {
          const isCorrect = value.correctAnswers.includes(index);
          return (
            <div key={index} className="flex items-center gap-2">
              <Input
                value={answer}
                onChange={(e) => onChange(withAnswerText(value, index, e.target.value))}
                placeholder={t("editor.answers.placeholder", { index: index + 1 })}
                disabled={value.type === "true_false"}
              />
              {value.type !== "poll" && (
                <button
                  type="button"
                  title={isCorrect ? t("editor.answers.correctTitle") : t("editor.answers.markCorrectTitle")}
                  onClick={() => onChange(withToggledCorrect(value, index))}
                  aria-pressed={isCorrect}
                  className={`shrink-0 w-8 h-8 rounded-full border-2 flex items-center justify-center ${
                    isCorrect ? "border-green-600 bg-green-50" : "border-gray-300 bg-transparent"
                  }`}
                >
                  {isCorrect && <Check className="w-4 h-4 text-green-600" />}
                </button>
              )}
              {value.type !== "true_false" && value.answers.length > 2 && (
                <button
                  type="button"
                  title={t("editor.answers.removeTitle")}
                  aria-label={t("editor.answers.removeAriaLabel", { index: index + 1 })}
                  onClick={() => onChange(withRemovedAnswer(value, index))}
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          );
        })}
        {value.type !== "true_false" && value.answers.length < 6 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => onChange(withAddedAnswer(value))}>
            <Plus className="w-4 h-4 me-1" /> {t("editor.answers.addMore")}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3">
        <div>
          <label className="text-xs text-gray-500">{t("bank.difficultyLabel")}</label>
          <Select
            value={value.difficulty ?? "none"}
            onValueChange={(v) => onChange({ ...value, difficulty: v === "none" ? undefined : (v as "easy" | "medium" | "hard") })}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("bank.difficultyNone")}</SelectItem>
              <SelectItem value="easy">{t("bank.difficultyEasy")}</SelectItem>
              <SelectItem value="medium">{t("bank.difficultyMedium")}</SelectItem>
              <SelectItem value="hard">{t("bank.difficultyHard")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-gray-500">{t("bank.explanationLabel")}</label>
          <Textarea
            value={value.explanation ?? ""}
            onChange={(e) => onChange({ ...value, explanation: e.target.value ? e.target.value : undefined })}
            placeholder={t("bank.explanationPlaceholder")}
            rows={2}
            maxLength={500}
          />
        </div>
      </div>

      {onUploadImage && (
        <div>
          {value.imageUrl ? (
            <div className="relative inline-block">
              <img src={value.imageUrl} alt={t("editor.question.imageAlt")} className="max-h-32 rounded-lg border" />
              <button
                type="button"
                onClick={() => onChange({ ...value, imageUrl: undefined })}
                className="absolute top-1 end-1 bg-white rounded-full shadow p-1"
                title={t("editor.question.removeImageTitle")}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => imageInputRef.current?.click()}>
              {uploading ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : <ImagePlus className="w-4 h-4 me-1" />}
              {uploading ? t("editor.question.uploading") : t("bank.addImage")}
            </Button>
          )}
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadImage(f); e.target.value = ""; }}
          />
        </div>
      )}
    </div>
  );
}
