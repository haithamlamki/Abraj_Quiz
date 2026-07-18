import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Question } from "@shared/schema";
import { validateQuestion } from "@/lib/question-form-utils";
import { TagInput } from "./TagInput";

interface SaveToBankDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;
}

// Saves a snapshot of an editor question into the bank. The NEW bank row is a
// fresh source — any sourceQuestionId on the editor question (itself copied
// from the bank earlier) is stripped so provenance always points one hop back.
export function SaveToBankDialog({ open, onOpenChange, question }: SaveToBankDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [subject, setSubject] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    if (open) {
      setSubject("");
      setTags([]);
    }
  }, [open]);

  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { sourceQuestionId: _omit, ...bare } = (question ?? {}) as Question & { sourceQuestionId?: number };
      const res = await apiRequest("POST", "/api/bank/questions", {
        question: bare,
        subject: subject.trim() || undefined,
        tags,
      });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("editor.bank.savedToast") });
      onOpenChange(false);
    },
    onError: (error: any) => {
      toast({
        title: t("editor.bank.saveFailedTitle"),
        description: error?.response?.data?.message || error?.message,
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (!question) return;
    if (validateQuestion(question)) {
      // Incomplete question (no text / empty answers / no correct) — tell the
      // user to finish it first instead of persisting a broken bank row.
      toast({ title: t("editor.bank.incompleteTitle"), description: t("editor.bank.incompleteDescription"), variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("editor.bank.saveDialogTitle")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-gray-600 line-clamp-2">{question?.question}</p>
        <div className="space-y-3">
          <div>
            <label className="text-xs text-gray-500">{t("bank.subjectLabel")}</label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t("bank.subjectPlaceholder")} maxLength={100} list="save-bank-subjects" />
            <datalist id="save-bank-subjects">
              {(meta?.subjects ?? []).map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label className="text-xs text-gray-500">{t("bank.tagsLabel")}</label>
            <TagInput value={tags} onChange={setTags} suggestions={meta?.tags ?? []} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null}
            {t("editor.bank.saveButton")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
