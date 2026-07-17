import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Plus, Trash2, Copy, ImagePlus, X, Clock, Check, Palette, ArrowLeft, Loader2, Wand2, Eye, Settings,
} from "lucide-react";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Question } from "@shared/schema";
import { answerStyle } from "@/lib/answer-style";
import {
  EDITOR_LEFT_RAIL,
  EDITOR_RIGHT_PANEL,
  QUIZ_CARD_H,
  QUIZ_GRID_GAP,
  QUIZ_MEDIA_BOX,
  QUIZ_MEDIA_WRAP,
  QUIZ_QUESTION_BAR,
  QUIZ_STAGE_GAP,
  QUIZ_STAGE_PAD,
} from "@/components/quiz/layout";
import { getBackgroundStyle } from "@/utils/backgrounds";
import { resolveQuizTheme, type QuizTheme } from "@shared/quiz-theme";
import { ThemeBuilder } from "@/components/quiz/ThemeBuilder";
import { QuizSettingsDialog } from "@/components/quiz/QuizSettingsDialog";
import { QuizQuestionRenderer } from "@/components/quiz/QuizQuestionRenderer";

interface QuizForm {
  title: string;
  description: string;
  background: string;
  isPublic: boolean;
  theme: QuizTheme;
  questions: Question[];
}

const TIME_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

function blankQuestion(): Question {
  return {
    question: "",
    type: "quiz",
    answerType: "single",
    answers: ["", "", "", ""],
    correctAnswers: [0],
    timeLimit: 20,
    points: "standard",
  };
}

function trueFalseQuestion(existing?: Partial<Question>): Question {
  return {
    question: existing?.question ?? "",
    imageUrl: existing?.imageUrl,
    type: "true_false",
    answerType: "single",
    answers: ["True", "False"],
    correctAnswers: [0],
    timeLimit: existing?.timeLimit ?? 20,
    points: existing?.points ?? "standard",
  };
}

// Map an AI-generated (legacy-shaped) question into the canonical shape.
function fromGenerated(q: any): Question {
  return {
    question: q.question ?? "",
    type: "quiz",
    answerType: "single",
    answers: Array.isArray(q.answers) && q.answers.length >= 2 ? q.answers : ["", "", "", ""],
    correctAnswers: [typeof q.correctAnswer === "number" ? q.correctAnswer : 0],
    timeLimit: q.timeLimit ?? 20,
    points: q.points === "double" ? "double" : "standard",
  };
}

export default function QuizEditor() {
  const { quizId } = useParams();
  const isEditMode = Boolean(quizId);
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading } = useAuth();

  const [quiz, setQuiz] = useState<QuizForm>({
    title: "",
    description: "",
    background: "aurora",
    isPublic: true,
    theme: resolveQuizTheme({ background: "aurora" }),
    questions: [blankQuestion()],
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Guards the hydration effect below against react-i18next handing out a new
  // `t` identity on every language change — without this, toggling language
  // mid-edit re-runs hydration and silently discards unsaved edits.
  const hydratedQuizRef = useRef<unknown>(null);

  // Redirect unauthenticated users.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({ title: t("editor.toasts.authRequiredTitle"), description: t("editor.toasts.authRequiredDescription"), variant: "destructive" });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast, t]);

  // Load an existing quiz in edit mode.
  const { data: loaded } = useQuery<any>({
    queryKey: ["/api/quizzes", quizId],
    enabled: isEditMode && isAuthenticated,
  });
  useEffect(() => {
    if (loaded && isEditMode) {
      if (hydratedQuizRef.current === loaded) return;
      hydratedQuizRef.current = loaded;
      if (user && loaded.createdBy !== user.id) {
        toast({ title: t("editor.toasts.accessDeniedTitle"), description: t("editor.toasts.accessDeniedDescription"), variant: "destructive" });
        setLocation("/my-quizzes");
        return;
      }
      const questions: Question[] = Array.isArray(loaded.questions) && loaded.questions.length
        ? loaded.questions.map((q: any) => ({
            question: q.question ?? "",
            imageUrl: q.imageUrl,
            type: q.type ?? "quiz",
            answerType: q.answerType ?? "single",
            answers: Array.isArray(q.answers) ? q.answers : ["", "", "", ""],
            // Normalize legacy single-correct → array.
            correctAnswers: Array.isArray(q.correctAnswers)
              ? q.correctAnswers
              : [typeof q.correctAnswer === "number" ? q.correctAnswer : 0],
            timeLimit: q.timeLimit ?? 20,
            points: q.points === "double" ? "double" : "standard",
          }))
        : [blankQuestion()];
      setQuiz({
        title: loaded.title ?? "",
        description: loaded.description ?? "",
        background: loaded.background || "aurora",
        isPublic: loaded.isPublic ?? true,
        theme: resolveQuizTheme(loaded),
        questions,
      });
      setCurrentIndex(0);
    }
  }, [loaded, isEditMode, user, setLocation, toast, t]);

  const current = quiz.questions[currentIndex] ?? quiz.questions[0];

  // ---- question / answer mutators ----
  const patchQuestion = (index: number, patch: Partial<Question>) => {
    setQuiz((prev) => ({
      ...prev,
      questions: prev.questions.map((q, i) => (i === index ? { ...q, ...patch } : q)),
    }));
  };

  const addQuestion = () => {
    setQuiz((prev) => ({ ...prev, questions: [...prev.questions, blankQuestion()] }));
    setCurrentIndex(quiz.questions.length);
  };

  const duplicateQuestion = (index: number) => {
    setQuiz((prev) => {
      const copy = JSON.parse(JSON.stringify(prev.questions[index])) as Question;
      const questions = [...prev.questions];
      questions.splice(index + 1, 0, copy);
      return { ...prev, questions };
    });
    setCurrentIndex(index + 1);
  };

  const removeQuestion = (index: number) => {
    if (quiz.questions.length <= 1) return;
    setQuiz((prev) => ({ ...prev, questions: prev.questions.filter((_, i) => i !== index) }));
    setCurrentIndex((ci) => Math.max(0, ci >= index ? ci - 1 : ci));
  };

  const setAnswerText = (answerIndex: number, value: string) => {
    patchQuestion(currentIndex, {
      answers: current.answers.map((a, i) => (i === answerIndex ? value : a)),
    });
  };

  const addAnswer = () => {
    if (current.answers.length >= 6 || current.type === "true_false") return;
    patchQuestion(currentIndex, { answers: [...current.answers, ""] });
  };

  const removeAnswer = (answerIndex: number) => {
    if (current.answers.length <= 2 || current.type === "true_false") return;
    const answers = current.answers.filter((_, i) => i !== answerIndex);
    // Re-map correct indices after removal.
    const correctAnswers = current.correctAnswers
      .filter((ci) => ci !== answerIndex)
      .map((ci) => (ci > answerIndex ? ci - 1 : ci));
    patchQuestion(currentIndex, {
      answers,
      correctAnswers: correctAnswers.length ? correctAnswers : [0],
    });
  };

  const toggleCorrect = (answerIndex: number) => {
    if (current.answerType === "single") {
      patchQuestion(currentIndex, { correctAnswers: [answerIndex] });
    } else {
      const set = new Set(current.correctAnswers);
      if (set.has(answerIndex)) set.delete(answerIndex);
      else set.add(answerIndex);
      const next = Array.from(set).sort((a, b) => a - b);
      patchQuestion(currentIndex, { correctAnswers: next.length ? next : [answerIndex] });
    }
  };

  const setType = (type: Question["type"]) => {
    if (type === "true_false") {
      patchQuestion(currentIndex, trueFalseQuestion(current));
    } else {
      patchQuestion(currentIndex, {
        type: "quiz",
        answers: current.answers.length >= 2 ? current.answers : ["", "", "", ""],
      });
    }
  };

  const setAnswerMode = (answerType: Question["answerType"]) => {
    if (answerType === "single") {
      patchQuestion(currentIndex, { answerType, correctAnswers: [current.correctAnswers[0] ?? 0] });
    } else {
      patchQuestion(currentIndex, { answerType });
    }
  };

  // ---- image upload ----
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
      patchQuestion(currentIndex, { imageUrl: url });
    } catch (e: any) {
      toast({ title: t("editor.toasts.imageUploadFailedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const uploadThemeImage = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch(buildApiUrl("/api/upload-image"), { method: "POST", body: form, credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || t("editor.toasts.uploadFailedDefault"));
      const { url } = await res.json();
      setQuiz((prev) => ({ ...prev, background: url, theme: { ...prev.theme, background: url } }));
    } catch (e: any) {
      toast({ title: t("editor.toasts.themeUploadFailedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ---- validation + save ----
  const validate = (): string | null => {
    if (!quiz.title.trim()) return t("editor.toasts.validationTitleRequired");
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const n = i + 1;
      if (!q.question.trim()) return t("editor.toasts.validationQuestionNeedsText", { n });
      if (q.answers.length < 2) return t("editor.toasts.validationNeedsTwoAnswers", { n });
      if (q.answers.some((a) => !a.trim())) return t("editor.toasts.validationEmptyAnswer", { n });
      if (q.correctAnswers.length === 0) return t("editor.toasts.validationNeedsCorrectAnswer", { n });
      if (q.answerType === "single" && q.correctAnswers.length !== 1)
        return t("editor.toasts.validationSingleSelectOneCorrect", { n });
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title: quiz.title.trim(),
        description: quiz.description.trim(),
        background: quiz.theme.background,
        theme: quiz.theme,
        questions: quiz.questions,
        isPublic: quiz.isPublic,
        // insertQuizSchema requires createdBy for BOTH create and update. The
        // server ignores it on create (it stamps the authed user) and never
        // changes ownership on update; owner is enforced server-side.
        createdBy: (isEditMode ? loaded?.createdBy : undefined) ?? user?.id,
      };
      if (isEditMode) {
        const res = await apiRequest("PUT", `/api/quizzes/${quizId}`, payload);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/quizzes", payload);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/my-quizzes"] });
      toast({ title: isEditMode ? t("editor.toasts.quizUpdated") : t("editor.toasts.quizCreated") });
      setLocation(isEditMode ? "/my-quizzes" : `/host-quiz/${data.id}`);
    },
    onError: (error: any) => {
      const errs = error?.response?.data?.errors;
      const msg = Array.isArray(errs)
        ? errs.map((e: any) => (e.path?.length ? `${e.path.join(".")}: ${e.message}` : e.message)).join("; ")
        : error?.response?.data?.message || t("editor.toasts.saveFailedDefault");
      toast({ title: t("editor.toasts.saveFailedTitle"), description: msg, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const err = validate();
    if (err) {
      toast({ title: t("editor.toasts.almostThereTitle"), description: err, variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  // ---- AI generation (topics / text / URL / PDF) ----
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiTopics, setAiTopics] = useState("");
  const [aiText, setAiText] = useState("");
  const [aiUrl, setAiUrl] = useState("");
  const [aiFile, setAiFile] = useState<File | null>(null);

  const applyGenerated = (generated: any) => {
    if (!generated || !Array.isArray(generated.questions) || generated.questions.length === 0) {
      throw new Error(t("editor.toasts.generatorNoQuestions"));
    }
    setQuiz((p) => ({
      ...p,
      title: p.title || generated.title || t("editor.ai.generatedQuizDefaultTitle"),
      description: p.description || generated.description || "",
      questions: generated.questions.map(fromGenerated),
    }));
    setCurrentIndex(0);
    setAiOpen(false);
    toast({ title: t("editor.toasts.quizGeneratedTitle"), description: t("editor.toasts.quizGeneratedDescription", { count: generated.questions.length }) });
  };

  const runGeneration = async (kind: "topics" | "text" | "url" | "pdf") => {
    setAiBusy(true);
    try {
      let generated: any;
      if (kind === "pdf") {
        if (!aiFile) throw new Error(t("editor.toasts.choosePdfFirst"));
        const form = new FormData();
        form.append("pdf", aiFile);
        const res = await fetch(buildApiUrl("/api/generate-quiz/pdf"), { method: "POST", body: form, credentials: "include" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || t("editor.toasts.pdfGenerationFailedDefault"));
        generated = await res.json();
      } else {
        const body = kind === "topics" ? { topics: aiTopics } : kind === "text" ? { text: aiText } : { url: aiUrl };
        const res = await apiRequest("POST", `/api/generate-quiz/${kind}`, body);
        generated = await res.json();
      }
      applyGenerated(generated);
    } catch (e: any) {
      toast({ title: t("editor.toasts.generationFailedTitle"), description: e?.message || t("editor.toasts.generationFailedDefault"), variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  };

  if (isLoading || !isAuthenticated) return null;

  return (
    // Fill exactly the viewport below the sticky 68px nav (h-16 + border-b-4)
    // so the stage is height-constrained like the reference: spare space is
    // absorbed by the media region, never left below the answers.
    <div className="lg:h-[calc(100dvh-68px)] lg:min-h-[560px] bg-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 sm:gap-3 px-4 py-3 bg-white border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/my-quizzes")}>
            <ArrowLeft className="w-4 h-4 me-1 rtl:rotate-180" /> {t("editor.topbar.exit")}
          </Button>
          <Input
            value={quiz.title}
            onChange={(e) => setQuiz((p) => ({ ...p, title: e.target.value }))}
            placeholder={t("editor.topbar.quizTitlePlaceholder")}
            className="max-w-md font-semibold"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            <Settings className="w-4 h-4 me-1" /> {t("editor.topbar.settings")}
          </Button>
          <Dialog open={aiOpen} onOpenChange={setAiOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Wand2 className="w-4 h-4 me-1" /> {t("editor.ai.triggerButton")}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>{t("editor.ai.dialogTitle")}</DialogTitle></DialogHeader>
              <Tabs defaultValue="topics">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="topics">{t("editor.ai.tabTopics")}</TabsTrigger>
                  <TabsTrigger value="text">{t("editor.ai.tabText")}</TabsTrigger>
                  <TabsTrigger value="url">{t("editor.ai.tabUrl")}</TabsTrigger>
                  <TabsTrigger value="pdf">{t("editor.ai.tabPdf")}</TabsTrigger>
                </TabsList>
                <TabsContent value="topics" className="space-y-2">
                  <Textarea value={aiTopics} onChange={(e) => setAiTopics(e.target.value)} placeholder={t("editor.ai.topicsPlaceholder")} rows={3} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("topics")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null} {t("editor.ai.generateButton")}
                  </Button>
                </TabsContent>
                <TabsContent value="text" className="space-y-2">
                  <Textarea value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder={t("editor.ai.textPlaceholder")} rows={5} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("text")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null} {t("editor.ai.generateButton")}
                  </Button>
                </TabsContent>
                <TabsContent value="url" className="space-y-2">
                  <Input value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder={t("editor.ai.urlPlaceholder")} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("url")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null} {t("editor.ai.generateButton")}
                  </Button>
                </TabsContent>
                <TabsContent value="pdf" className="space-y-2">
                  <Input type="file" accept="application/pdf" onChange={(e) => setAiFile(e.target.files?.[0] ?? null)} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("pdf")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null} {t("editor.ai.generateButton")}
                  </Button>
                </TabsContent>
              </Tabs>
              <p className="text-xs text-gray-400">{t("editor.ai.footerNote")}</p>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => { setPreviewIdx(currentIndex); setPreviewOpen(true); }}>
            <Eye className="w-4 h-4 me-1" /> {t("editor.topbar.preview")}
          </Button>
          <Button className="abraj-primary text-white" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 me-1 animate-spin" /> : null}
            {isEditMode ? t("editor.topbar.saveChanges") : t("editor.topbar.save")}
          </Button>
        </div>
      </header>

      <QuizSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title={quiz.title}
        description={quiz.description}
        isPublic={quiz.isPublic}
        onChange={(patch) => setQuiz((p) => ({ ...p, ...patch }))}
      />

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>{t("editor.topbar.previewDialogTitle")}</DialogTitle></DialogHeader>
          <div className="h-[460px]">
            <QuizQuestionRenderer
              question={quiz.questions[Math.min(previewIdx, quiz.questions.length - 1)]}
              theme={quiz.theme}
              questionNumber={Math.min(previewIdx, quiz.questions.length - 1) + 1}
              totalQuestions={quiz.questions.length}
              reveal
              correctAnswers={quiz.questions[Math.min(previewIdx, quiz.questions.length - 1)]?.correctAnswers}
            />
          </div>
          <div className="flex items-center justify-center gap-4">
            <Button variant="ghost" size="sm" disabled={previewIdx === 0} onClick={() => setPreviewIdx((i) => i - 1)}>{t("editor.topbar.previewPrev")}</Button>
            <span className="text-sm text-gray-500">{t("editor.topbar.previewCounter", { current: Math.min(previewIdx, quiz.questions.length - 1) + 1, total: quiz.questions.length })}</span>
            <Button variant="ghost" size="sm" disabled={previewIdx >= quiz.questions.length - 1} onClick={() => setPreviewIdx((i) => i + 1)}>{t("editor.topbar.previewNext")}</Button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Left: question rail — mini-stage thumbnails mirroring the question
            structure (question line, media placeholder, answer bars) */}
        <aside className={`${EDITOR_LEFT_RAIL} order-2 lg:order-1 shrink-0 bg-white border-t lg:border-t-0 lg:border-e p-2 flex flex-row lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto`}>
          {quiz.questions.map((q, i) => (
            <div key={i} onClick={() => setCurrentIndex(i)} className="cursor-pointer shrink-0 w-40 lg:w-auto">
              <div className="flex items-center justify-between px-1 mb-0.5 text-[11px] text-gray-500">
                <span>{i + 1} · {q.type === "true_false" ? t("editor.question.railTypeTrueFalse") : t("editor.question.typeQuiz")}</span>
                <div className="flex gap-1">
                  <button title={t("editor.question.duplicateAction")} onClick={(e) => { e.stopPropagation(); duplicateQuestion(i); }}><Copy className="w-3 h-3" /></button>
                  {quiz.questions.length > 1 && (
                    <button title={t("editor.question.deleteAction")} onClick={(e) => { e.stopPropagation(); removeQuestion(i); }}><Trash2 className="w-3 h-3 text-red-500" /></button>
                  )}
                </div>
              </div>
              <div className={`rounded-lg border bg-white p-2 ${i === currentIndex ? "border-abraj-primary ring-2 ring-abraj-primary" : "hover:bg-gray-50"}`}>
                <div className="text-[10px] font-medium text-gray-800 text-center line-clamp-1 mb-1">{q.question || t("editor.question.untitled")}</div>
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-[9px] text-gray-400 border rounded-full w-5 h-5 flex items-center justify-center shrink-0">{q.timeLimit === 0 ? t("editor.question.noLimitBadge") : q.timeLimit}</span>
                  <div className="flex-1 bg-gray-100 rounded h-7 flex items-center justify-center">
                    <ImagePlus className="w-3.5 h-3.5 text-gray-300" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-0.5">
                  {q.answers.slice(0, 6).map((_, ai) => (
                    <span key={ai} className={`${answerStyle(ai).bg} h-1.5 rounded-sm`} />
                  ))}
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" className="w-auto lg:w-full shrink-0 self-center lg:self-auto" size="sm" onClick={addQuestion}>
            <Plus className="w-4 h-4 me-1" /> {t("editor.question.addButton")}
          </Button>
        </aside>

        {/* Center: question editor — the SAME stage geometry as the live
            renderer: fixed question bar on top, flexible media region in the
            middle (absorbs spare height), fixed-height answer grid pinned at
            the bottom, "Add more answers" directly below it. Full canvas
            width — no narrow centered column. */}
        <main className="order-1 lg:order-2 flex-1 min-w-0 overflow-y-auto" style={getBackgroundStyle(quiz.theme.background)}>
          <div className={`h-full min-h-[480px] flex flex-col ${QUIZ_STAGE_PAD} ${QUIZ_STAGE_GAP}`}>
            <Input
              value={current.question}
              onChange={(e) => patchQuestion(currentIndex, { question: e.target.value })}
              placeholder={t("editor.question.placeholder")}
              className={`shrink-0 ${QUIZ_QUESTION_BAR} text-center text-lg sm:text-xl font-semibold bg-white`}
            />

            {/* Media — flexible middle region at ~55% width (shared tokens).
                Stacked (mobile) layout is content-driven, so give the wrap a
                floor height there; desktop keeps the pure flex fill. */}
            <div className={`${QUIZ_MEDIA_WRAP} min-h-[200px] lg:min-h-0`}>
              <div className={`${QUIZ_MEDIA_BOX} bg-white/85 flex flex-col items-center justify-center relative`}>
                {current.imageUrl ? (
                  <>
                    <img src={current.imageUrl} alt={t("editor.question.imageAlt")} className="w-full h-full object-contain" />
                    <button
                      onClick={() => patchQuestion(currentIndex, { imageUrl: undefined })}
                      className="absolute top-2 end-2 bg-white rounded-full shadow p-1"
                      title={t("editor.question.removeImageTitle")}
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => imageInputRef.current?.click()}
                    className="flex flex-col items-center gap-2 text-gray-500 hover:text-abraj-primary"
                    disabled={uploading}
                  >
                    {uploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <ImagePlus className="w-8 h-8" />}
                    <span>{uploading ? t("editor.question.uploading") : t("editor.question.findAndInsertMedia")}</span>
                    <span className="text-xs text-gray-400"><span className="underline font-medium">{t("editor.question.uploadFileLink")}</span> {t("editor.question.orDragHereToUpload")}</span>
                  </button>
                )}
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadImage(f); e.target.value = ""; }}
                />
              </div>
            </div>

            {/* Answers — fixed-height tiles matching the shared AnswerCard */}
            <div className={`shrink-0 grid grid-cols-2 ${QUIZ_GRID_GAP}`}>
              {current.answers.map((answer, index) => {
                const style = answerStyle(index);
                const Icon = style.icon;
                const isCorrect = current.correctAnswers.includes(index);
                return (
                  <div key={index} className={`${style.bg} ${QUIZ_CARD_H} rounded-xl px-3 sm:px-4 flex items-center gap-2 sm:gap-3 text-white`}>
                    <Icon className="w-5 h-5 sm:w-6 sm:h-6 shrink-0" fill="white" strokeWidth={0} />
                    <Input
                      value={answer}
                      onChange={(e) => setAnswerText(index, e.target.value)}
                      placeholder={t("editor.answers.placeholder", { index: index + 1 })}
                      disabled={current.type === "true_false"}
                      className="bg-white/90 text-gray-900 border-0 h-10"
                    />
                    <button
                      title={isCorrect ? t("editor.answers.correctTitle") : t("editor.answers.markCorrectTitle")}
                      onClick={() => toggleCorrect(index)}
                      aria-pressed={isCorrect}
                      className={`shrink-0 w-9 h-9 rounded-full border-2 border-white flex items-center justify-center ${isCorrect ? "bg-white" : "bg-transparent"}`}
                    >
                      {isCorrect && <Check className="w-5 h-5 text-green-600" />}
                    </button>
                    {current.type !== "true_false" && current.answers.length > 2 && (
                      <button title={t("editor.answers.removeTitle")} aria-label={t("editor.answers.removeAriaLabel", { index: index + 1 })} onClick={() => removeAnswer(index)}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {current.type !== "true_false" && current.answers.length < 6 && (
              <div className="shrink-0 text-center">
                <Button variant="secondary" size="sm" onClick={addAnswer}>
                  <Plus className="w-4 h-4 me-1" /> {t("editor.answers.addMore")}
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* Right: properties panel */}
        <aside className={`${EDITOR_RIGHT_PANEL} order-3 shrink-0 bg-white border-t lg:border-t-0 lg:border-s p-4 lg:overflow-y-auto space-y-5 flex flex-col`}>
          <div className="font-semibold text-gray-800">{t("editor.question.propertiesHeading")}</div>

          <div>
            <label className="text-xs text-gray-500">{t("editor.question.questionTypeLabel")}</label>
            <Select value={current.type} onValueChange={(v) => setType(v as Question["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="quiz">{t("editor.question.typeQuiz")}</SelectItem>
                <SelectItem value="true_false">{t("editor.question.typeTrueFalse")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> {t("editor.timing.label")}</label>
            <Select value={String(current.timeLimit)} onValueChange={(v) => patchQuestion(currentIndex, { timeLimit: parseInt(v, 10) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("editor.timing.noLimit")}</SelectItem>
                {TIME_OPTIONS.map((secs) => (
                  <SelectItem key={secs} value={String(secs)}>{t("editor.timing.secondsOption", { count: secs })}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button
              className="text-xs text-abraj-primary underline mt-1"
              onClick={() => setQuiz((p) => ({ ...p, questions: p.questions.map((q) => ({ ...q, timeLimit: current.timeLimit })) }))}
            >
              {t("editor.timing.applyToAll")}
            </button>
          </div>

          <div>
            <label className="text-xs text-gray-500">{t("editor.question.answerOptionsLabel")}</label>
            <Select
              value={current.answerType}
              onValueChange={(v) => setAnswerMode(v as Question["answerType"])}
              disabled={current.type === "true_false"}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">{t("editor.question.answerModeSingle")}</SelectItem>
                <SelectItem value="multiple">{t("editor.question.answerModeMultiple")}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-gray-400 mt-1">
              {current.answerType === "multiple" ? t("editor.question.answerModeMultipleHint") : t("editor.question.answerModeSingleHint")}
            </p>
          </div>

          <div>
            <label className="text-xs text-gray-500">{t("editor.question.pointsLabel")}</label>
            <Select value={current.points} onValueChange={(v) => patchQuestion(currentIndex, { points: v as Question["points"] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">{t("editor.question.pointsStandard")}</SelectItem>
                <SelectItem value="double">{t("editor.question.pointsDouble")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Theme picker */}
          <div>
            <label className="text-xs text-gray-500 flex items-center gap-1"><Palette className="w-3 h-3" /> {t("editor.theme.fieldLabel")}</label>
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-1 w-full h-10 rounded-lg border" style={getBackgroundStyle(quiz.theme.background)} title={t("editor.theme.changeThemeTitle")} />
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>{t("editor.theme.dialogTitle")}</DialogTitle></DialogHeader>
                <ThemeBuilder
                  theme={quiz.theme}
                  uploading={uploading}
                  onChange={(theme) => setQuiz((p) => ({ ...p, theme, background: theme.background }))}
                  onUploadBackground={uploadThemeImage}
                />
              </DialogContent>
            </Dialog>
          </div>

          {/* Delete / Duplicate — bottom of the panel, as in the reference */}
          <div className="mt-auto pt-4 border-t flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={quiz.questions.length <= 1}
              onClick={() => removeQuestion(currentIndex)}
            >
              {t("editor.question.deleteAction")}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={() => duplicateQuestion(currentIndex)}>
              {t("editor.question.duplicateAction")}
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
