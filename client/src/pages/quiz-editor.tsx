import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Plus, Trash2, Copy, ImagePlus, X, Clock, Check, Palette, ArrowLeft, Loader2, Wand2, Eye,
} from "lucide-react";
import { apiRequest, buildApiUrl } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { Question } from "@shared/schema";
import { answerStyle } from "@/lib/answer-style";
import {
  PRESET_THEMES, getThemeSwatchStyle, getBackgroundStyle,
} from "@/utils/backgrounds";

interface QuizForm {
  title: string;
  description: string;
  background: string;
  questions: Question[];
}

const TIME_OPTIONS = [5, 10, 20, 30, 60, 90, 120];

function blankQuestion(): Question {
  return {
    question: "",
    type: "quiz",
    answerType: "single",
    answers: ["", "", "", ""],
    correctAnswers: [0],
    timeLimit: 20,
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
  };
}

export default function QuizEditor() {
  const { quizId } = useParams();
  const isEditMode = Boolean(quizId);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isAuthenticated, isLoading } = useAuth();

  const [quiz, setQuiz] = useState<QuizForm>({
    title: "",
    description: "",
    background: "aurora",
    questions: [blankQuestion()],
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [uploading, setUploading] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);

  // Redirect unauthenticated users.
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      toast({ title: "Authentication Required", description: "Please login to build quizzes.", variant: "destructive" });
      setLocation("/login");
    }
  }, [isAuthenticated, isLoading, setLocation, toast]);

  // Load an existing quiz in edit mode.
  const { data: loaded } = useQuery<any>({
    queryKey: ["/api/quizzes", quizId],
    enabled: isEditMode && isAuthenticated,
  });
  useEffect(() => {
    if (loaded && isEditMode) {
      if (user && loaded.createdBy !== user.id) {
        toast({ title: "Access Denied", description: "You can only edit your own quizzes.", variant: "destructive" });
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
          }))
        : [blankQuestion()];
      setQuiz({
        title: loaded.title ?? "",
        description: loaded.description ?? "",
        background: loaded.background || "aurora",
        questions,
      });
      setCurrentIndex(0);
    }
  }, [loaded, isEditMode, user, setLocation, toast]);

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
        throw new Error(err.message || "Upload failed");
      }
      const { url } = await res.json();
      patchQuestion(currentIndex, { imageUrl: url });
    } catch (e: any) {
      toast({ title: "Image upload failed", description: e.message, variant: "destructive" });
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
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Upload failed");
      const { url } = await res.json();
      setQuiz((prev) => ({ ...prev, background: url }));
    } catch (e: any) {
      toast({ title: "Theme upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // ---- validation + save ----
  const validate = (): string | null => {
    if (!quiz.title.trim()) return "Give your quiz a title.";
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      if (!q.question.trim()) return `Question ${i + 1} needs text.`;
      if (q.answers.length < 2) return `Question ${i + 1} needs at least 2 answers.`;
      if (q.answers.some((a) => !a.trim())) return `Question ${i + 1} has an empty answer.`;
      if (q.correctAnswers.length === 0) return `Question ${i + 1} needs a correct answer.`;
      if (q.answerType === "single" && q.correctAnswers.length !== 1)
        return `Question ${i + 1} (single-select) must have exactly one correct answer.`;
    }
    return null;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        title: quiz.title.trim(),
        description: quiz.description.trim(),
        background: quiz.background,
        questions: quiz.questions,
        isPublic: true,
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
      toast({ title: isEditMode ? "Quiz updated!" : "Quiz created!" });
      setLocation(isEditMode ? "/my-quizzes" : `/host-quiz/${data.id}`);
    },
    onError: (error: any) => {
      const errs = error?.response?.data?.errors;
      const msg = Array.isArray(errs)
        ? errs.map((e: any) => (e.path?.length ? `${e.path.join(".")}: ${e.message}` : e.message)).join("; ")
        : error?.response?.data?.message || "Failed to save quiz.";
      toast({ title: "Could not save", description: msg, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const err = validate();
    if (err) {
      toast({ title: "Almost there", description: err, variant: "destructive" });
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
      throw new Error("The generator returned no questions.");
    }
    setQuiz((p) => ({
      ...p,
      title: p.title || generated.title || "Generated Quiz",
      description: p.description || generated.description || "",
      questions: generated.questions.map(fromGenerated),
    }));
    setCurrentIndex(0);
    setAiOpen(false);
    toast({ title: "Quiz generated", description: `Added ${generated.questions.length} questions — review before saving.` });
  };

  const runGeneration = async (kind: "topics" | "text" | "url" | "pdf") => {
    setAiBusy(true);
    try {
      let generated: any;
      if (kind === "pdf") {
        if (!aiFile) throw new Error("Choose a PDF file first.");
        const form = new FormData();
        form.append("pdf", aiFile);
        const res = await fetch(buildApiUrl("/api/generate-quiz/pdf"), { method: "POST", body: form, credentials: "include" });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "PDF generation failed");
        generated = await res.json();
      } else {
        const body = kind === "topics" ? { topics: aiTopics } : kind === "text" ? { text: aiText } : { url: aiUrl };
        const res = await apiRequest("POST", `/api/generate-quiz/${kind}`, body);
        generated = await res.json();
      }
      applyGenerated(generated);
    } catch (e: any) {
      toast({ title: "Generation failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setAiBusy(false);
    }
  };

  if (isLoading || !isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between gap-3 px-4 py-3 bg-white border-b">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/my-quizzes")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Exit
          </Button>
          <Input
            value={quiz.title}
            onChange={(e) => setQuiz((p) => ({ ...p, title: e.target.value }))}
            placeholder="Enter quiz title..."
            className="max-w-md font-semibold"
          />
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={aiOpen} onOpenChange={setAiOpen}>
            <DialogTrigger asChild>
              <Button variant="outline"><Wand2 className="w-4 h-4 mr-1" /> Create with AI</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>Generate questions with AI</DialogTitle></DialogHeader>
              <Tabs defaultValue="topics">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="topics">Topics</TabsTrigger>
                  <TabsTrigger value="text">Text</TabsTrigger>
                  <TabsTrigger value="url">URL</TabsTrigger>
                  <TabsTrigger value="pdf">PDF</TabsTrigger>
                </TabsList>
                <TabsContent value="topics" className="space-y-2">
                  <Textarea value={aiTopics} onChange={(e) => setAiTopics(e.target.value)} placeholder="e.g. Photosynthesis, the water cycle, food chains" rows={3} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("topics")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Generate
                  </Button>
                </TabsContent>
                <TabsContent value="text" className="space-y-2">
                  <Textarea value={aiText} onChange={(e) => setAiText(e.target.value)} placeholder="Paste study text (min ~50 characters)" rows={5} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("text")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Generate
                  </Button>
                </TabsContent>
                <TabsContent value="url" className="space-y-2">
                  <Input value={aiUrl} onChange={(e) => setAiUrl(e.target.value)} placeholder="https://example.com/article" />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("url")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Generate
                  </Button>
                </TabsContent>
                <TabsContent value="pdf" className="space-y-2">
                  <Input type="file" accept="application/pdf" onChange={(e) => setAiFile(e.target.files?.[0] ?? null)} />
                  <Button className="w-full abraj-primary text-white" disabled={aiBusy} onClick={() => runGeneration("pdf")}>
                    {aiBusy ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null} Generate
                  </Button>
                </TabsContent>
              </Tabs>
              <p className="text-xs text-gray-400">Generated questions replace the current ones — review and edit before saving.</p>
            </DialogContent>
          </Dialog>
          {isEditMode && (
            <Button variant="outline" onClick={() => setLocation(`/preview/${quizId}`)}>
              <Eye className="w-4 h-4 mr-1" /> Preview
            </Button>
          )}
          <Button className="abraj-primary text-white" onClick={handleSave} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            {isEditMode ? "Save changes" : "Save"}
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        {/* Left: question rail */}
        <aside className="w-40 shrink-0 bg-white border-r p-2 overflow-y-auto space-y-2">
          {quiz.questions.map((q, i) => (
            <div
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`rounded-lg border p-2 cursor-pointer text-xs ${i === currentIndex ? "border-abraj-primary ring-1 ring-abraj-primary bg-teal-50" : "hover:bg-gray-50"}`}
            >
              <div className="flex items-center justify-between mb-1 text-gray-500">
                <span>{i + 1} · {q.type === "true_false" ? "T/F" : "Quiz"}</span>
                <div className="flex gap-1">
                  <button title="Duplicate" onClick={(e) => { e.stopPropagation(); duplicateQuestion(i); }}><Copy className="w-3 h-3" /></button>
                  {quiz.questions.length > 1 && (
                    <button title="Delete" onClick={(e) => { e.stopPropagation(); removeQuestion(i); }}><Trash2 className="w-3 h-3 text-red-500" /></button>
                  )}
                </div>
              </div>
              <div className="line-clamp-2 font-medium text-gray-800">{q.question || "Untitled"}</div>
            </div>
          ))}
          <Button variant="outline" className="w-full" size="sm" onClick={addQuestion}>
            <Plus className="w-4 h-4 mr-1" /> Add
          </Button>
        </aside>

        {/* Center: question editor */}
        <main className="flex-1 min-w-0 p-6 overflow-y-auto" style={getBackgroundStyle(quiz.background)}>
          <div className="max-w-3xl mx-auto space-y-4">
            <Input
              value={current.question}
              onChange={(e) => patchQuestion(currentIndex, { question: e.target.value })}
              placeholder="Start typing your question"
              className="text-center text-lg font-semibold py-6 bg-white"
            />

            {/* Media */}
            <div className="bg-white/90 rounded-xl p-4 flex flex-col items-center justify-center min-h-[160px]">
              {current.imageUrl ? (
                <div className="relative">
                  <img src={current.imageUrl} alt="Question" className="max-h-52 rounded-lg object-contain" />
                  <button
                    onClick={() => patchQuestion(currentIndex, { imageUrl: undefined })}
                    className="absolute -top-2 -right-2 bg-white rounded-full shadow p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => imageInputRef.current?.click()}
                  className="flex flex-col items-center gap-2 text-gray-500 hover:text-abraj-primary"
                  disabled={uploading}
                >
                  {uploading ? <Loader2 className="w-8 h-8 animate-spin" /> : <ImagePlus className="w-8 h-8" />}
                  <span>{uploading ? "Uploading..." : "Find and insert media"}</span>
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

            {/* Answers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {current.answers.map((answer, index) => {
                const style = answerStyle(index);
                const Icon = style.icon;
                const isCorrect = current.correctAnswers.includes(index);
                return (
                  <div key={index} className={`${style.bg} rounded-xl p-3 flex items-center gap-2 text-white`}>
                    <Icon className="w-5 h-5 shrink-0" fill="white" strokeWidth={0} />
                    <Input
                      value={answer}
                      onChange={(e) => setAnswerText(index, e.target.value)}
                      placeholder={`Answer ${index + 1}`}
                      disabled={current.type === "true_false"}
                      className="bg-white/90 text-gray-900 border-0"
                    />
                    <button
                      title={isCorrect ? "Correct" : "Mark correct"}
                      onClick={() => toggleCorrect(index)}
                      className={`shrink-0 w-7 h-7 rounded-full border-2 border-white flex items-center justify-center ${isCorrect ? "bg-white" : "bg-transparent"}`}
                    >
                      {isCorrect && <Check className="w-4 h-4 text-green-600" />}
                    </button>
                    {current.type !== "true_false" && current.answers.length > 2 && (
                      <button title="Remove answer" onClick={() => removeAnswer(index)}>
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {current.type !== "true_false" && current.answers.length < 6 && (
              <div className="text-center">
                <Button variant="secondary" size="sm" onClick={addAnswer}>
                  <Plus className="w-4 h-4 mr-1" /> Add more answers
                </Button>
              </div>
            )}
          </div>
        </main>

        {/* Right: properties panel */}
        <aside className="w-64 shrink-0 bg-white border-l p-4 overflow-y-auto space-y-5">
          <div className="font-semibold text-gray-800">Question properties</div>

          <div>
            <label className="text-xs text-gray-500">Question type</label>
            <Select value={current.type} onValueChange={(v) => setType(v as Question["type"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="quiz">Quiz</SelectItem>
                <SelectItem value="true_false">True or False</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs text-gray-500 flex items-center gap-1"><Clock className="w-3 h-3" /> Time limit</label>
            <Select value={String(current.timeLimit)} onValueChange={(v) => patchQuestion(currentIndex, { timeLimit: parseInt(v, 10) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIME_OPTIONS.map((t) => <SelectItem key={t} value={String(t)}>{t} seconds</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              className="text-xs text-abraj-primary underline mt-1"
              onClick={() => setQuiz((p) => ({ ...p, questions: p.questions.map((q) => ({ ...q, timeLimit: current.timeLimit })) }))}
            >
              Apply to all questions
            </button>
          </div>

          <div>
            <label className="text-xs text-gray-500">Answer options</label>
            <Select
              value={current.answerType}
              onValueChange={(v) => setAnswerMode(v as Question["answerType"])}
              disabled={current.type === "true_false"}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="single">Single select</SelectItem>
                <SelectItem value="multiple">Multi-select</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-gray-400 mt-1">
              {current.answerType === "multiple" ? "Players must pick ALL correct answers." : "Players pick one answer."}
            </p>
          </div>

          {/* Theme picker */}
          <div>
            <label className="text-xs text-gray-500 flex items-center gap-1"><Palette className="w-3 h-3" /> Theme</label>
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-1 w-full h-10 rounded-lg border" style={getBackgroundStyle(quiz.background)} title="Change theme" />
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Choose a theme</DialogTitle></DialogHeader>
                <div className="grid grid-cols-3 gap-3">
                  {PRESET_THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setQuiz((p) => ({ ...p, background: t.id }))}
                      className={`h-16 rounded-lg border-2 relative ${quiz.background === t.id ? "border-abraj-primary" : "border-transparent"}`}
                      style={getThemeSwatchStyle(t)}
                    >
                      <span className="absolute bottom-1 left-1 text-[10px] text-white font-medium drop-shadow">{t.label}</span>
                    </button>
                  ))}
                  <label className="h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer text-gray-500 hover:text-abraj-primary">
                    <ImagePlus className="w-5 h-5" />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadThemeImage(f); e.target.value = ""; }}
                    />
                  </label>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div>
            <label className="text-xs text-gray-500">Description</label>
            <Textarea
              value={quiz.description}
              onChange={(e) => setQuiz((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional description"
              rows={3}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}
