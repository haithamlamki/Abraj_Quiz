import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";

interface VersionListItem {
  versionNumber: number;
  title: string;
  questionCount: number;
  createdAt: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quizId: string;
  // Receives the FULL version row; the editor maps it via toQuizForm and marks
  // the form dirty so autosave + a normal Save record the restore.
  onRestore: (version: any) => void;
}

export function VersionHistorySheet({ open, onOpenChange, quizId, onRestore }: Props) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  const { data: versions, isLoading } = useQuery<VersionListItem[]>({
    queryKey: ["/api/quizzes", quizId, "versions"],
    enabled: open,
  });

  const { data: detail, isLoading: detailLoading, isError: detailError } = useQuery<any>({
    queryKey: ["/api/quizzes", quizId, "versions", String(selected)],
    enabled: open && selected != null,
  });

  const close = (o: boolean) => {
    if (!o) {
      setSelected(null);
      setConfirming(false);
    }
    onOpenChange(o);
  };

  return (
    <Sheet open={open} onOpenChange={close}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{t("editor.history.title")}</SheetTitle>
        </SheetHeader>

        {isLoading && <Loader2 className="w-5 h-5 mt-6 animate-spin" />}

        {!isLoading && (!versions || versions.length === 0) && (
          <p className="mt-6 text-sm text-muted-foreground">{t("editor.history.empty")}</p>
        )}

        <div className="mt-4 space-y-2">
          {versions?.map((v) => (
            <button
              key={v.versionNumber}
              type="button"
              onClick={() => setSelected(selected === v.versionNumber ? null : v.versionNumber)}
              className={`w-full rounded-lg border p-3 text-start transition-colors hover:bg-accent ${
                selected === v.versionNumber ? "border-primary" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">
                  {t("editor.history.versionLabel", { n: v.versionNumber })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {v.createdAt ? new Date(v.createdAt).toLocaleString() : ""}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground truncate">{v.title}</span>
                <Badge variant="secondary">{t("editor.history.questionCount", { count: v.questionCount })}</Badge>
              </div>
            </button>
          ))}
        </div>

        {selected != null && (
          <div className="mt-4 rounded-lg border p-3">
            {detailLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {detailError && <p className="text-sm text-destructive">{t("editor.history.loadFailed")}</p>}
            {detail && (
              <>
                <p className="font-medium text-sm mb-2">{detail.title}</p>
                <ol className="space-y-1 list-decimal ms-5">
                  {(detail.questions as any[]).map((q, i) => (
                    <li key={i} className="text-xs text-muted-foreground">
                      <span className="text-foreground">{q.question || "—"}</span>{" "}
                      <Badge variant="outline" className="ms-1 align-middle">{q.type ?? "quiz"}</Badge>
                    </li>
                  ))}
                </ol>
                <Button className="mt-3 w-full" size="sm" onClick={() => setConfirming(true)}>
                  {t("editor.history.restore")}
                </Button>
              </>
            )}
          </div>
        )}

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("editor.history.restoreConfirmTitle")}</AlertDialogTitle>
              <AlertDialogDescription>{t("editor.history.restoreConfirmBody")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("editor.history.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirming(false);
                  if (detail) {
                    onRestore(detail);
                    close(false);
                  }
                }}
              >
                {t("editor.history.restore")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
