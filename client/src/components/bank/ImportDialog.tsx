import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, FileUp, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { TagInput } from "@/components/bank/TagInput";
import type { Question } from "@shared/schema";

interface ImportItem { question: Question; subject?: string; tags: string[] }
interface ImportPreview {
  source: "template" | "ai";
  valid: ImportItem[];
  errors: Array<{ row: number; message: string }>;
  meta: { fileName: string; totalRows: number; truncated?: boolean };
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  meta: { subjects: string[]; tags: string[] };
  onImported: () => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Three-step import: upload (+ optional file-level defaults) → server-parsed
// preview (valid questions + per-row errors) → confirm posts the valid items
// to the existing bulk endpoint (atomic; server re-validates every item).
export function ImportDialog({ open, onOpenChange, meta, onImported }: ImportDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const flight = useRef(0);

  const [file, setFile] = useState<File | null>(null);
  const [defaultSubject, setDefaultSubject] = useState("");
  const [defaultTags, setDefaultTags] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const isDocx = !!file && file.name.toLowerCase().endsWith(".docx");

  const reset = () => {
    flight.current++;
    setFile(null); setDefaultSubject(""); setDefaultTags([]); setPreview(null);
    setParsing(false); setImporting(false);
  };
  const close = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const downloadTemplate = async (kind: "xlsx" | "csv") => {
    try {
      const res = await fetch(buildApiUrl(`/api/import/template.${kind}`), { credentials: "include" });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `question-import-template.${kind}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: t("bank.import.parseFailedTitle"), variant: "destructive" });
    }
  };

  const runParse = async () => {
    if (!file) return;
    const id = ++flight.current;
    setParsing(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (defaultSubject.trim()) form.append("defaultSubject", defaultSubject.trim());
      if (defaultTags.length) form.append("defaultTags", defaultTags.join(";"));
      const res = await fetch(buildApiUrl("/api/import/parse"), { method: "POST", body: form, credentials: "include" });
      if (id !== flight.current) return;
      if (!res.ok) {
        throw new Error((await res.json().catch(() => ({}))).message || t("bank.import.parseFailedTitle"));
      }
      const body = await res.json();
      if (id !== flight.current) return;
      setPreview(body);
    } catch (e: any) {
      if (id !== flight.current) return;
      toast({ title: t("bank.import.parseFailedTitle"), description: e?.message, variant: "destructive" });
    } finally {
      if (id === flight.current) setParsing(false);
    }
  };

  const runImport = async () => {
    if (!preview || preview.valid.length === 0) return;
    const id = ++flight.current;
    setImporting(true);
    try {
      await apiRequest("POST", "/api/bank/questions/bulk", { items: preview.valid });
      if (id !== flight.current) return;
      toast({ title: t("bank.import.importedToast", { count: preview.valid.length }) });
      onImported();
      close(false);
    } catch (e: any) {
      if (id !== flight.current) return;
      toast({ title: t("bank.import.importFailedTitle"), description: e?.message, variant: "destructive" });
    } finally {
      if (id === flight.current) setImporting(false);
    }
  };

  const typeKey = (q: Question) =>
    q.type === "true_false" ? "editor.question.typeTrueFalse"
      : q.type === "poll" ? "editor.question.typePoll"
      : "editor.question.typeQuiz";

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("bank.import.title")}</DialogTitle>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t("bank.import.uploadHint")}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>{t("bank.import.templateLabel")}</span>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate("xlsx")} data-testid="button-template-xlsx">
                <Download className="w-4 h-4 me-1" /> {t("bank.import.templateXlsx")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => downloadTemplate("csv")} data-testid="button-template-csv">
                <Download className="w-4 h-4 me-1" /> {t("bank.import.templateCsv")}
              </Button>
            </div>

            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
              role="button"
              tabIndex={0}
              aria-label={t("bank.import.chooseFile")}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInput.current?.click();
                }
              }}
              data-testid="import-dropzone"
            >
              <FileUp className="w-6 h-6 mx-auto mb-2 text-gray-400" />
              {file ? (
                <p className="text-sm font-medium">{t("bank.import.selectedFile", { name: file.name })}</p>
              ) : (
                <>
                  <p className="text-sm font-medium">{t("bank.import.chooseFile")}</p>
                  <p className="text-xs text-gray-500">{t("bank.import.dropHere")}</p>
                </>
              )}
              <input
                ref={fileInput}
                type="file"
                accept=".xlsx,.csv,.docx"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                data-testid="input-import-file"
              />
            </div>
            {isDocx && <p className="text-xs text-amber-700">{t("bank.import.wordAiNote")}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="import-default-subject">{t("bank.import.defaultSubjectLabel")}</Label>
                <Input
                  id="import-default-subject"
                  value={defaultSubject}
                  onChange={(e) => setDefaultSubject(e.target.value)}
                  maxLength={100}
                  list="import-subject-suggestions"
                />
                <datalist id="import-subject-suggestions">
                  {meta.subjects.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
              <div>
                <Label>{t("bank.import.defaultTagsLabel")}</Label>
                <TagInput value={defaultTags} onChange={setDefaultTags} suggestions={meta.tags} />
              </div>
            </div>

            <DialogFooter>
              <Button onClick={runParse} disabled={!file || parsing} data-testid="button-import-parse">
                {parsing && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
                {parsing ? (isDocx ? t("bank.import.parsingAi") : t("bank.import.parsing")) : t("bank.import.parse")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm font-medium">
              {t("bank.import.validCount", { count: preview.valid.length })}
              {" · "}
              {t("bank.import.errorCount", { count: preview.errors.length })}
            </p>
            {preview.meta.truncated && <p className="text-xs text-amber-700">{t("bank.import.truncatedNote")}</p>}

            {preview.errors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded-md p-3 max-h-40 overflow-y-auto space-y-1">
                {preview.errors.map((err, i) => (
                  <p key={i} className="text-sm text-red-700">
                    <span className="font-medium">
                      {t(preview.source === "template" ? "bank.import.rowLabel" : "bank.import.questionLabel", { row: err.row })}
                    </span>
                    {": "}{err.message}
                  </p>
                ))}
                <p className="text-xs text-red-600">{t("bank.import.fixHint")}</p>
              </div>
            )}

            {preview.valid.length === 0 ? (
              <p className="text-sm text-gray-600">{t("bank.import.noValid")}</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {preview.valid.map((item, i) => (
                  <details key={i} className="border rounded-md p-2">
                    <summary className="cursor-pointer text-sm">
                      <Badge variant="secondary" className="me-1">{t(typeKey(item.question))}</Badge>
                      {item.question.difficulty && (
                        <Badge variant="outline" className="me-1">{t(`bank.difficulty${cap(item.question.difficulty)}`)}</Badge>
                      )}
                      {item.question.question}
                    </summary>
                    <ul className="mt-2 space-y-1 text-sm">
                      {item.question.answers.map((a, ai) => (
                        <li key={ai} className={item.question.correctAnswers.includes(ai) ? "text-green-700 font-medium" : "text-gray-600"}>
                          {item.question.correctAnswers.includes(ai) ? "✓ " : ""}{a}
                        </li>
                      ))}
                    </ul>
                    {(item.subject || item.tags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {item.subject && <Badge variant="default">{item.subject}</Badge>}
                        {item.tags.map((tg) => <Badge key={tg} variant="outline">{tg}</Badge>)}
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setPreview(null)} data-testid="button-import-back">
                {t("bank.import.back")}
              </Button>
              <Button
                onClick={runImport}
                disabled={preview.valid.length === 0 || importing}
                data-testid="button-import-confirm"
              >
                {importing && <Loader2 className="w-4 h-4 me-1 animate-spin" />}
                {importing ? t("bank.import.importing") : t("bank.import.importCount", { count: preview.valid.length })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
