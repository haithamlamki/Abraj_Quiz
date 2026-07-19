import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { PageLoader } from "@/components/page-loader";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Edit, Library, Plus, Search, Trash2, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { formatQuizDate } from "@/lib/language";
import { BankQuestionDialog, type BankQuestionRow } from "@/components/bank/BankQuestionDialog";
import { ImportDialog } from "@/components/bank/ImportDialog";

const ALL_SUBJECTS = "__all__";

export default function QuestionBank() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated, isLoading } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState(ALL_SUBJECTS);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<BankQuestionRow | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({ title: t("bank.authRequiredTitle"), variant: "destructive" });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast, t]);

  const listUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (subject !== ALL_SUBJECTS) params.set("subject", subject);
    if (activeTags.length) params.set("tags", activeTags.join(","));
    if (showArchived) params.set("archived", "1");
    const qs = params.toString();
    return `/api/bank/questions${qs ? `?${qs}` : ""}`;
  }, [search, subject, activeTags, showArchived]);

  const { data: rows, isLoading: rowsLoading } = useQuery<BankQuestionRow[]>({
    queryKey: [listUrl],
    enabled: isAuthenticated,
  });

  const { data: meta } = useQuery<{ subjects: string[]; tags: string[] }>({
    queryKey: ["/api/bank/questions/meta"],
    enabled: isAuthenticated,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/bank/questions") });
  };

  const archiveMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bank/questions/${id}`),
    onSuccess: () => { invalidate(); toast({ title: t("bank.archivedToast") }); },
    onError: () => toast({ title: t("bank.archiveFailedTitle"), variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/bank/questions/${id}/restore`),
    onSuccess: () => { invalidate(); toast({ title: t("bank.restoredToast") }); },
    onError: () => toast({ title: t("bank.restoreFailedTitle"), variant: "destructive" }),
  });

  const toggleTag = (tag: string) =>
    setActiveTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag]));

  if (isLoading) return <PageLoader />;
  if (!isAuthenticated) return null;

  const typeBadgeKey = (row: BankQuestionRow) =>
    row.question.type === "true_false" ? "editor.question.typeTrueFalse"
      : row.question.type === "poll" ? "editor.question.typePoll"
      : "editor.question.typeQuiz";

  return (
    <div className="page-fill bg-slate-50">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-800">{t("bank.title")}</h1>
            <p className="text-gray-600">{t("bank.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)} data-testid="button-toggle-archived-bank">
              {showArchived ? t("bank.backToLive") : t("bank.showArchived")}
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-bank">
              <Upload className="w-4 h-4 me-1" /> {t("bank.import.button")}
            </Button>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }} data-testid="button-new-bank-question">
              <Plus className="w-4 h-4 me-1" /> {t("bank.newQuestion")}
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input className="ps-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("bank.searchPlaceholder")} />
          </div>
          <Select value={subject} onValueChange={setSubject}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SUBJECTS}>{t("bank.allSubjects")}</SelectItem>
              {(meta?.subjects ?? []).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(meta?.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-6">
            {meta!.tags.map((tag) => (
              <button key={tag} type="button" onClick={() => toggleTag(tag)} aria-pressed={activeTags.includes(tag)}>
                <Badge variant={activeTags.includes(tag) ? "default" : "outline"}>{tag}</Badge>
              </button>
            ))}
          </div>
        )}

        {rowsLoading ? (
          <PageLoader />
        ) : !rows || rows.length === 0 ? (
          <EmptyState
            icon={<Library />}
            title={showArchived ? t("bank.emptyArchivedTitle") : t("bank.emptyTitle")}
            description={showArchived ? undefined : t("bank.emptyDescription")}
            action={
              showArchived ? undefined : (
                <Button onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  {t("bank.newQuestion")}
                </Button>
              )
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {rows.map((row) => (
              <Card key={row.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="secondary">{t(typeBadgeKey(row))}</Badge>
                      {row.question.difficulty && (
                        <Badge variant="outline">{t(`bank.difficulty${row.question.difficulty.charAt(0).toUpperCase() + row.question.difficulty.slice(1)}`)}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-gray-500">{formatQuizDate(row.updatedAt, i18n.language)}</span>
                  </div>
                  <CardTitle className="text-base line-clamp-2">{row.question.question}</CardTitle>
                </CardHeader>
                <CardContent>
                  {row.question.imageUrl && (
                    <img src={row.question.imageUrl} alt="" className="h-16 rounded border object-cover mb-2" />
                  )}
                  <div className="flex flex-wrap gap-1 mb-3 min-h-5">
                    {row.subject && <Badge variant="default">{row.subject}</Badge>}
                    {row.tags.map((tag) => <Badge key={tag} variant="outline">{tag}</Badge>)}
                  </div>
                  <div className="flex gap-2">
                    {row.deletedAt ? (
                      <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate(row.id)} data-testid={`button-restore-bank-${row.id}`}>
                        {t("bank.restore")}
                      </Button>
                    ) : (
                      <>
                        <Button variant="outline" size="sm" onClick={() => { setEditing(row); setDialogOpen(true); }} data-testid={`button-edit-bank-${row.id}`}>
                          <Edit className="w-4 h-4 me-1" /> {t("bank.edit")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-red-600 border-red-300 hover:bg-red-50"
                          onClick={() => archiveMutation.mutate(row.id)}
                          data-testid={`button-archive-bank-${row.id}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <BankQuestionDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          initial={editing}
          meta={meta ?? { subjects: [], tags: [] }}
          onSaved={invalidate}
        />
        <ImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          meta={meta ?? { subjects: [], tags: [] }}
          onImported={invalidate}
        />
      </div>
    </div>
  );
}
