import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import type { Question } from "@shared/schema";
import type { BankQuestionRow } from "./BankQuestionDialog";

const ALL_SUBJECTS = "__all__";

interface BankPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (questions: Question[]) => void;
}

// Multi-select picker over the live bank. Selected questions are DEEP-COPIED
// into the quiz with sourceQuestionId stamped (copy + provenance): later bank
// edits do NOT propagate; the id enables a future "re-sync?" feature.
export function BankPickerDialog({ open, onOpenChange, onAdd }: BankPickerDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState(ALL_SUBJECTS);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (subject !== ALL_SUBJECTS) params.set("subject", subject);
    if (activeTags.length) params.set("tags", activeTags.join(","));
    const qs = params.toString();
    return `/api/bank/questions${qs ? `?${qs}` : ""}`;
  }, [search, subject, activeTags]);

  const { data: rows } = useQuery<BankQuestionRow[]>({ queryKey: [listUrl], enabled: open });
  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: open,
  });

  const toggleRow = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  const handleAdd = () => {
    const chosen = (rows ?? []).filter((r) => selected.has(r.id));
    const copies: Question[] = chosen.map((r) => {
      // Deep copy; overwrite any stale nested provenance with THIS row's id.
      const copy = JSON.parse(JSON.stringify(r.question)) as Question;
      return { ...copy, sourceQuestionId: r.id };
    });
    onAdd(copies);
    setSelected(new Set());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setSelected(new Set()); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[85dvh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("editor.bank.pickerTitle")}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("bank.searchPlaceholder")} />
          </div>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>{t("bank.allSubjects")}</SelectItem>
              {(meta?.subjects ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(meta?.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {meta!.tags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={activeTags.includes(tag)}>
                <Badge variant={activeTags.includes(tag) ? "default" : "outline"}>{tag}</Badge>
              </button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto space-y-2 min-h-[200px]">
          {(rows ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-8">{t("editor.bank.pickerEmpty")}</p>
          ) : (
            (rows ?? []).map((row) => (
              <label key={row.id} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50">
                <Checkbox checked={selected.has(row.id)} onCheckedChange={() => toggleRow(row.id)} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-medium line-clamp-2">{row.question.question}</div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {row.subject && <Badge variant="default">{row.subject}</Badge>}
                    {row.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                </div>
              </label>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("bank.cancel")}</Button>
          <Button onClick={handleAdd} disabled={selected.size === 0}>
            {t("editor.bank.addSelected", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
