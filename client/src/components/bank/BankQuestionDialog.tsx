import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Question } from "@shared/schema";
import { blankQuestion, validateQuestion, type QuestionValidationKey } from "@/lib/question-form-utils";
import { QuestionForm } from "./QuestionForm";
import { TagInput } from "./TagInput";

export interface BankQuestionRow {
  id: number;
  createdBy: number;
  question: Question;
  subject: string | null;
  tags: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const VALIDATION_MSG: Record<QuestionValidationKey, string> = {
  needsText: "editor.toasts.validationQuestionNeedsText",
  needsTwoAnswers: "editor.toasts.validationNeedsTwoAnswers",
  emptyAnswer: "editor.toasts.validationEmptyAnswer",
  needsCorrectAnswer: "editor.toasts.validationNeedsCorrectAnswer",
  singleSelectOneCorrect: "editor.toasts.validationSingleSelectOneCorrect",
};

interface BankQuestionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: BankQuestionRow | null;
  meta: { subjects: string[]; tags: string[] };
  onSaved: () => void;
}

export function BankQuestionDialog({ open, onOpenChange, initial, meta, onSaved }: BankQuestionDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [question, setQuestion] = useState<Question>(blankQuestion());
  const [subject, setSubject] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);

  // Re-seed local state each time the dialog opens (create vs edit).
  useEffect(() => {
    if (open) {
      setQuestion(initial ? initial.question : blankQuestion());
      setSubject(initial?.subject ?? "");
      setTags(initial?.tags ?? []);
    }
  }, [open, initial]);

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(buildApiUrl("/api/upload-image"), { method: "POST", body: form, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || t("editor.toasts.uploadFailedDefault"));
      }
      const { url } = await res.json();
      setQuestion((q) => ({ ...q, imageUrl: url }));
    } catch (e: any) {
      toast({ title: t("editor.toasts.imageUploadFailedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { question, subject: subject.trim() || undefined, tags };
      const res = initial
        ? await apiRequest("PUT", `/api/bank/questions/${initial.id}`, payload)
        : await apiRequest("POST", "/api/bank/questions", payload);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: initial ? t("bank.updatedToast") : t("bank.createdToast") });
      onOpenChange(false);
      onSaved();
    },
    onError: (error: any) => {
      toast({
        title: t("bank.saveFailedTitle"),
        description: error?.response?.data?.message || error?.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const key = validateQuestion(question);
    if (key) {
      toast({ title: t("editor.toasts.almostThereTitle"), description: t(VALIDATION_MSG[key], { n: 1 }), variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? t("bank.editTitle") : t("bank.createTitle")}</DialogTitle>
        </DialogHeader>

        <QuestionForm value={question} onChange={setQuestion} uploading={uploading} onUploadImage={uploadImage} />

        <div className="grid grid-cols-1 gap-3 pt-2 border-t">
          <div>
            <label className="text-xs text-gray-500">{t("bank.subjectLabel")}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("bank.subjectPlaceholder")} maxLength={100} list="bank-subjects" />
            <datalist id="bank-subjects">
              {meta.subjects.map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("bank.tagsLabel")}</label>
            <TagInput value={tags} onChange={setTags} suggestions={meta.tags} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null}
            {t("bank.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
