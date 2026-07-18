# AI Content Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the AI quiz generators to canonical-native output (mixed types, `correctAnswers[]`, difficulty, explanations), persist generations into the Question Bank, per `docs/superpowers/specs/2026-07-19-ai-content-upgrade-design.md`.

**Architecture:** Two additive question fields (`difficulty`, `explanation`) + a `generatedQuizSchema` validate GPT output directly (replacing hand-rolled validation). One shared prompt core emits canonical JSON with one error-fed retry. A new `POST /api/bank/questions/bulk` endpoint (Import-ready) persists generations. The editor's AI dialog gains a save-to-bank checkbox; `QuestionForm` gains difficulty/explanation editing. `explanation` is answer-key-equivalent and is stripped everywhere answer keys are stripped.

**Tech Stack:** OpenAI `gpt-4o` (pinned), Zod, Express, Drizzle, node:test (unit), Vitest (integration), React 18 + TanStack Query + react-i18next.

## Global Constraints

- Additive-only schema: `difficulty`/`explanation` are explicit optional fields on `questionObjectSchema` (Zod strips unknown keys, exactly like `sourceQuestionId`).
- SECURITY: `explanation` is answer-key-equivalent — `sanitizeQuizForCaller` must strip it alongside `correctAnswer`/`correctAnswers`. Pinned by a regression test. `difficulty` stays visible.
- Model `gpt-4o` stays (openai-service.ts comment forbids changing without explicit request).
- All storage via `StorageCtx` (`tctx(req)` on request paths); bulk endpoint stamps `createdBy` from `req.authUserId`.
- Gameplay untouched; generation stays synchronous; `/api/generate-background` unchanged.
- All new client strings in BOTH `en.json` and `ar.json` (parity + no-identical-Arabic tests enforce; count keys use EN `_one/_other`, AR full CLDR set).
- Run `npm run check && npm test && npm run build` before EVERY commit. 2 PRs: server-first (`feat/ai-canonical-server`) then client (`feat/ai-canonical-client`).
- Windows; Bash tool runs Git Bash. Repo root: `C:\projects\PDO Quiz\Abraj_Quiz`.

---

# PR 1 — Server (branch `feat/ai-canonical-server`)

### Task 1: Schema — difficulty/explanation fields + generatedQuizSchema (TDD)

**Files:**
- Modify: `shared/schema.ts` (questionObjectSchema ~line 242; new schema after quizQuestionsSchema ~line 293)
- Test: `shared/schema.test.ts` (append)

**Interfaces:**
- Produces: optional `difficulty?: "easy"|"medium"|"hard"` and `explanation?: string` on `Question`; `generatedQuizSchema` + `GeneratedQuiz` type. Consumed by Tasks 2 (openai-service), 3 (sanitize test lives here conceptually but is in routes), client Task.

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/ai-canonical-server
```

- [ ] **Step 2: Write the failing tests** — append to `shared/schema.test.ts`:

```ts
test("questionSchema accepts optional difficulty and explanation, round-trips them", () => {
  const q = {
    question: "Q?", type: "quiz", answerType: "single",
    answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard",
    difficulty: "medium", explanation: "A is right because reasons.",
  };
  const parsed = questionSchema.parse(q) as any;
  assert.equal(parsed.difficulty, "medium");
  assert.equal(parsed.explanation, "A is right because reasons.");
  const { difficulty: _d, explanation: _e, ...bare } = q;
  const bareParsed = questionSchema.parse(bare) as any;
  assert.equal(bareParsed.difficulty, undefined);
  assert.equal(bareParsed.explanation, undefined);
});

test("questionSchema rejects an over-long explanation and a bad difficulty", () => {
  const base = { question: "Q?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 20, points: "standard" };
  assert.throws(() => questionSchema.parse({ ...base, explanation: "x".repeat(501) }));
  assert.throws(() => questionSchema.parse({ ...base, difficulty: "trivial" }));
});

test("generatedQuizSchema accepts mixed types, normalizes tags, rejects poll-with-correct", () => {
  const ok = generatedQuizSchema.parse({
    title: "Mixed", description: "d", subject: " Safety ", tags: ["Fire", "fire", " ppe "],
    questions: [
      { question: "single?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [1], timeLimit: 20, points: "standard", difficulty: "easy", explanation: "b" },
      { question: "tf?", type: "true_false", answerType: "single", answers: ["True", "False"], correctAnswers: [0], timeLimit: 15, points: "standard", difficulty: "medium", explanation: "true" },
      { question: "multi?", type: "quiz", answerType: "multiple", answers: ["a", "b", "c"], correctAnswers: [0, 2], timeLimit: 30, points: "standard", difficulty: "hard", explanation: "a and c" },
    ],
  });
  assert.equal(ok.subject, "Safety");
  assert.deepEqual(ok.tags, ["Fire", "ppe"]);
  assert.equal(ok.questions.length, 3);
  // poll with correct answers is rejected by the underlying questionSchema
  assert.throws(() => generatedQuizSchema.parse({
    title: "x", description: "", questions: [{ question: "p?", type: "poll", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" }],
  }));
  // empty questions rejected
  assert.throws(() => generatedQuizSchema.parse({ title: "x", description: "", questions: [] }));
});
```

Extend the test file's import to include `generatedQuizSchema` (merge with the existing `./schema` import line).

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `generatedQuizSchema` not exported; difficulty/explanation stripped (undefined) so the round-trip asserts fail.

- [ ] **Step 4: Implement in `shared/schema.ts`**

(a) Inside `questionObjectSchema`, after the `points` field (before the closing `})` that precedes `.superRefine`), add:

```ts
    // Optional metadata (additive, like sourceQuestionId). Set by AI generation
    // and editable in the bank/editor; ignored by gameplay/scoring.
    // NOTE: `explanation` typically states the correct answer, so it is
    // answer-key-equivalent — server strips it wherever it strips correctAnswers
    // (see sanitizeQuizForCaller). `difficulty` is safe to expose.
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    explanation: z.string().trim().max(500).optional(),
```

(b) After `export const quizQuestionsSchema = z.array(questionSchema);` (and after `normalizeTags`/`insertBankQuestionSchema` are declared — place it directly below `insertBankQuestionSchema` so `normalizeTags` is in scope), add:

```ts
// Validated shape for AI-generated quizzes. Questions are the canonical
// questionSchema (mixed types, correctAnswers[], optional difficulty/explanation);
// the generator emits this directly and the server rejects anything else.
export const generatedQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  subject: z.string().trim().max(100).optional().transform((s) => (s ? s : undefined)),
  tags: z.array(z.string().max(50)).max(8).default([]).transform(normalizeTags),
  questions: z.array(questionSchema).min(1).max(12),
});
export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; all pass including the 3 new tests.

- [ ] **Step 6: Commit**

```bash
git add shared/schema.ts shared/schema.test.ts
git commit -m "feat(ai): optional difficulty/explanation question fields + generatedQuizSchema"
```

---

### Task 2: openai-service — canonical-native generation with validated retry

**Files:**
- Modify: `server/openai-service.ts` (replace the `QuizQuestion`/`GeneratedQuiz` interfaces ~24-35; rewrite `generateQuizFromTopics` ~108, `generateQuizFromContent` ~217; the pdf/url/text wrappers keep their structure)
- Test: `server/openai-service.test.ts` (create)

**Interfaces:**
- Consumes: `generatedQuizSchema`, `GeneratedQuiz` from `@shared/schema` (Task 1).
- Produces: an exported pure helper `parseGeneratedQuiz(raw: unknown): { ok: true; data: GeneratedQuiz } | { ok: false; errors: string }` and `buildGenerationPrompt(kind: "topics" | "content", input: string, sourceTitle?: string): string` — both unit-testable without OpenAI. The four `generateQuizFrom*` functions still return `Promise<GeneratedQuiz>`.

- [ ] **Step 1: Write the failing tests** — `server/openai-service.test.ts` (pure helpers only; no live OpenAI):

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseGeneratedQuiz, buildGenerationPrompt } from "./openai-service";

test("parseGeneratedQuiz accepts a valid canonical mixed-type payload", () => {
  const raw = {
    title: "T", description: "d", subject: "Safety", tags: ["fire"],
    questions: [
      { question: "q1?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [2], timeLimit: 20, points: "standard", difficulty: "easy", explanation: "c" },
      { question: "q2?", type: "true_false", answerType: "single", answers: ["True", "False"], correctAnswers: [1], timeLimit: 15, points: "standard", difficulty: "medium", explanation: "false" },
    ],
  };
  const res = parseGeneratedQuiz(raw);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.data.questions.length, 2);
});

test("parseGeneratedQuiz reports errors for a legacy {correctAnswer} payload (no correctAnswers)", () => {
  // The generator must emit correctAnswers[]; a legacy-only shape without it
  // normalizes via questionSchema's preprocess, so it actually SUCCEEDS — assert that,
  // documenting the back-compat path.
  const raw = { title: "T", description: "", questions: [
    { question: "q?", answers: ["a", "b", "c", "d"], correctAnswer: 1, timeLimit: 10 },
  ] };
  const res = parseGeneratedQuiz(raw);
  assert.equal(res.ok, true);
  if (res.ok) assert.deepEqual(res.data.questions[0].correctAnswers, [1]);
});

test("parseGeneratedQuiz rejects junk and yields a non-empty error string", () => {
  const res = parseGeneratedQuiz({ title: "", questions: "nope" });
  assert.equal(res.ok, false);
  if (!res.ok) assert.ok(res.errors.length > 0);
});

test("buildGenerationPrompt embeds the input and asks for canonical mixed-type JSON", () => {
  const p = buildGenerationPrompt("topics", "Fire safety");
  assert.match(p, /Fire safety/);
  assert.match(p, /correctAnswers/);
  assert.match(p, /true_false/);
  assert.match(p, /difficulty/);
  assert.match(p, /explanation/);
  const c = buildGenerationPrompt("content", "some text", "My Source");
  assert.match(c, /My Source/);
  assert.match(c, /some text/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — helpers not exported.

- [ ] **Step 3: Implement in `server/openai-service.ts`**

(a) Replace the top imports block additions and the local `QuizQuestion`/`GeneratedQuiz` interfaces (lines ~24-35) with an import and the two pure helpers:

```ts
import { generatedQuizSchema, type GeneratedQuiz } from "@shared/schema";

// A compact JSON example the model must match. Kept in one place so the prompt
// and the validator never drift.
const CANONICAL_EXAMPLE = `{
  "title": "Quiz title",
  "description": "One-sentence description",
  "subject": "Subject area (optional)",
  "tags": ["2-4", "topic", "tags"],
  "questions": [
    {
      "question": "A single-select question?",
      "type": "quiz",
      "answerType": "single",
      "answers": ["A", "B", "C", "D"],
      "correctAnswers": [0],
      "timeLimit": 20,
      "points": "standard",
      "difficulty": "easy",
      "explanation": "Why A is correct, in 1-2 sentences."
    },
    {
      "question": "A true/false question?",
      "type": "true_false",
      "answerType": "single",
      "answers": ["True", "False"],
      "correctAnswers": [0],
      "timeLimit": 15,
      "points": "standard",
      "difficulty": "medium",
      "explanation": "Why it is true."
    }
  ]
}`;

export function buildGenerationPrompt(kind: "topics" | "content", input: string, sourceTitle?: string): string {
  const head =
    kind === "topics"
      ? `Create a comprehensive educational quiz based on these topics: "${input.trim()}"`
      : `Based on the following content, create a comprehensive educational quiz.\n\nContent Title: ${sourceTitle ?? "Content"}\nContent: ${input}`;
  return `${head}

Requirements:
1. Generate 8-12 questions.
2. MOST questions are single-select (type "quiz", answerType "single", 4 answers, exactly one index in correctAnswers).
3. Include 1-3 true/false questions (type "true_false", answers exactly ["True","False"]).
4. Include 0-2 multi-select questions (answerType "multiple", 2+ indexes in correctAnswers).
5. NEVER produce poll questions.
6. Each question needs a timeLimit (10-30), a "difficulty" of "easy"|"medium"|"hard", and a 1-2 sentence "explanation" of the correct answer.
7. Add a quiz-level "subject" and 2-4 "tags".
8. Answers are unambiguous and accurate; correctAnswers indexes are 0-based and in range.

Respond with ONLY valid JSON in exactly this shape:
${CANONICAL_EXAMPLE}`;
}

export function parseGeneratedQuiz(raw: unknown):
  | { ok: true; data: GeneratedQuiz }
  | { ok: false; errors: string } {
  const result = generatedQuizSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  const errors = result.error.errors
    .map((e) => `${e.path.join(".") || "(root)"}: ${e.message}`)
    .join("; ");
  return { ok: false, errors };
}

// Shared generation core: prompt → OpenAI → validate → one error-fed retry.
async function generateValidated(kind: "topics" | "content", input: string, sourceTitle?: string): Promise<GeneratedQuiz> {
  const basePrompt = buildGenerationPrompt(kind, input, sourceTitle);
  let lastErrors = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = attempt === 0
      ? basePrompt
      : `${basePrompt}\n\nYour previous response failed validation: ${lastErrors}\nReturn corrected JSON only.`;
    const response = await getOpenAI().chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are an expert educator and quiz creator. Always respond with valid JSON matching the exact schema requested." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 3500,
    });
    const content = response.choices[0].message.content;
    if (!content) { lastErrors = "empty response"; continue; }
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { lastErrors = "response was not valid JSON"; continue; }
    const parsed = parseGeneratedQuiz(raw);
    if (parsed.ok) return parsed.data;
    lastErrors = parsed.errors;
  }
  throw new Error("Failed to generate a properly formatted quiz. Please try again.");
}
```

(b) Rewrite `generateQuizFromTopics` body to delegate (keeping its input guard + the OpenAI error mapping in its catch):

```ts
export async function generateQuizFromTopics(topics: string): Promise<GeneratedQuiz> {
  try {
    if (!topics || topics.trim().length < 3) {
      throw new Error("Topics input is too short. Please provide specific topics or subjects.");
    }
    return await generateValidated("topics", topics.trim());
  } catch (error: any) {
    console.error("Topics quiz generation error:", error);
    throw mapOpenAiError(error, `Failed to generate quiz from topics: ${error.message}`);
  }
}
```

(c) Rewrite `generateQuizFromContent` body:

```ts
async function generateQuizFromContent(content: string, sourceTitle: string): Promise<GeneratedQuiz> {
  const maxContentLength = 8000;
  const truncated = content.length > maxContentLength ? content.substring(0, maxContentLength) + "..." : content;
  return await generateValidated("content", truncated, sourceTitle);
}
```

(d) Add a shared error-mapper near the top (extracted from the repeated blocks — DRY), and use it in the topics/text catch blocks (pdf/url keep their specific network-error messages before falling through to it):

```ts
function mapOpenAiError(error: any, fallbackMessage: string): Error {
  if (error?.status === 401) return new Error("OpenAI API authentication failed. Please check API key configuration.");
  if (error?.status === 429) return new Error("OpenAI API rate limit exceeded. Please try again in a few minutes.");
  if (error?.status === 500) return new Error("OpenAI API service is temporarily unavailable. Please try again later.");
  if (error?.code === "insufficient_quota") return new Error("OpenAI API quota exceeded. Please check your account usage.");
  // Preserve already-user-facing messages thrown by our own guards/validator.
  if (typeof error?.message === "string" && /too short|Failed to generate a properly formatted quiz/.test(error.message)) return error;
  return new Error(fallbackMessage);
}
```

Update `generateQuizFromText`'s catch to `throw mapOpenAiError(error, ...)` too. Leave `generateQuizFromPDF`/`generateQuizFromURL` network-specific `throw`s intact but route their final fallthrough through `mapOpenAiError`. `generateBackgroundImage` is untouched.

- [ ] **Step 4: Run to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; the 4 new helper tests pass; full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/openai-service.ts server/openai-service.test.ts
git commit -m "feat(ai): canonical-native generation with validated one-retry core + prompt/parse helpers"
```

---

### Task 3: sanitizeQuizForCaller strips explanation + regression test

**Files:**
- Modify: `server/routes.ts` (`sanitizeQuizForCaller` ~line 300)
- Test: an integration assertion in `tests/integration/auth.test.ts` (the creator-vs-non-creator secrecy tests already exist there) — plus a fast unit-level guard is not possible (sanitize is a closure); use the integration file.

**Interfaces:**
- Consumes: nothing new. Produces: guarantee that non-owner quiz responses omit `explanation`.

- [ ] **Step 1: Add the regression assertions** — in `tests/integration/auth.test.ts`, the "does NOT include correctAnswer for unauthenticated requests" and "non-creator" tests: extend their per-question loops with:

```ts
      expect(question.explanation).toBeUndefined();
```

(both the unauth and non-creator loops; leave the creator test asserting the fields ARE present — add `expect(question.difficulty === undefined || ["easy","medium","hard"].includes(question.difficulty)).toBe(true);` there to document difficulty stays). NOTE: these are integration tests (live DB, not in the unit glob) — they won't run in the standard gate; they are the deploy-time verification.

- [ ] **Step 2: Implement** — in `server/routes.ts` `sanitizeQuizForCaller`, extend the destructure:

```ts
      // Strip the legacy single-correct field, the canonical correct-set, AND
      // the explanation (which typically states the correct answer) so players
      // can't read the answer key mid-game. difficulty is safe and kept.
      const { correctAnswer: _omit, correctAnswers: _omit2, explanation: _omit3, ...rest } = q;
```

- [ ] **Step 3: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green (unit suite unaffected; the integration change compiles).

- [ ] **Step 4: Commit**

```bash
git add server/routes.ts tests/integration/auth.test.ts
git commit -m "fix(ai): strip question explanation for non-owners (answer-key-equivalent) + regression assertions"
```

---

### Task 4: Storage — createBankQuestions bulk method (TDD)

**Files:**
- Modify: `server/storage.ts` (IStorage interface after `getBankSubjectsAndTags`; both implementations)
- Test: `server/storage.test.ts` (append)

**Interfaces:**
- Consumes: `InsertBankQuestion`, `BankQuestion` (existing).
- Produces: `createBankQuestions(ctx: StorageCtx, items: Array<InsertBankQuestion & { createdBy: number }>): Promise<BankQuestion[]>` on `IStorage` — consumed by Task 5's bulk route.

- [ ] **Step 1: Write the failing test** — append to `server/storage.test.ts`:

```ts
test("createBankQuestions inserts many rows, stamps tenant + createdBy, tenant-isolated", async () => {
  const s = new MemStorage();
  const q = (text: string): any => ({ question: text, type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" });
  const rows = await s.createBankQuestions(T1, [
    { question: q("bulk-1"), subject: "S", tags: ["t"], createdBy: 7 },
    { question: q("bulk-2"), subject: undefined, tags: [], createdBy: 7 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].tenantId, 1);
  assert.equal(rows[0].createdBy, 7);
  assert.equal((await s.getBankQuestions(T1)).length, 2);
  assert.equal((await s.getBankQuestions(T2)).length, 0);
  // empty input is a no-op
  assert.deepEqual(await s.createBankQuestions(T1, []), []);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `createBankQuestions` is not a function.

- [ ] **Step 3: Implement**

(a) Add to `IStorage` (after `getBankSubjectsAndTags`):

```ts
  createBankQuestions(ctx: StorageCtx, items: Array<InsertBankQuestion & { createdBy: number }>): Promise<BankQuestion[]>;
```

(b) MemStorage (after `createBankQuestion`):

```ts
  async createBankQuestions(ctx: StorageCtx, items: Array<InsertBankQuestion & { createdBy: number }>): Promise<BankQuestion[]> {
    const out: BankQuestion[] = [];
    for (const item of items) out.push(await this.createBankQuestion(ctx, item));
    return out;
  }
```

(c) DatabaseStorage (after `createBankQuestion`):

```ts
  async createBankQuestions(ctx: StorageCtx, items: Array<InsertBankQuestion & { createdBy: number }>): Promise<BankQuestion[]> {
    if (items.length === 0) return [];
    const tenantId = requireTenantId(ctx);
    return withCtx(ctx, async (tx) => {
      return tx.insert(bankQuestions).values(items.map((item) => ({
        tenantId,
        createdBy: item.createdBy,
        question: item.question,
        subject: item.subject ?? null,
        tags: item.tags ?? [],
      }))).returning();
    });
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run check && npm test`
Expected: tsc clean; the new test passes.

- [ ] **Step 5: Commit**

```bash
git add server/storage.ts server/storage.test.ts
git commit -m "feat(bank): createBankQuestions bulk insert on both storage backends"
```

---

### Task 5: Bulk bank route POST /api/bank/questions/bulk (TDD)

**Files:**
- Modify: `server/bank-routes.ts` (add the route in `registerBankRoutes`)
- Test: `server/bank-routes.test.ts` (append)

**Interfaces:**
- Consumes: `createBankQuestions` (Task 4), `insertBankQuestionSchema` (existing).
- Produces: `POST /api/bank/questions/bulk` — body `{ items: [...] }`, 1–50, all-or-nothing; `201 { created: n }`; `400 { message, index?, errors? }`; `401` anon.

- [ ] **Step 1: Write the failing tests** — append to `server/bank-routes.test.ts` (reuses the file's `makeApp`/`withServer`/`AUTH`/`VALID_QUESTION`):

```ts
test("bulk: 401 anon, 201 happy path, createdBy stamped", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const anon = await fetch(`${base}/api/bank/questions/bulk`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items: [] }) });
    assert.equal(anon.status, 401);

    const res = await fetch(`${base}/api/bank/questions/bulk`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ items: [
        { question: VALID_QUESTION, subject: "Math", tags: ["a"] },
        { question: VALID_QUESTION, tags: [] },
      ] }),
    });
    assert.equal(res.status, 201);
    assert.deepEqual(await res.json(), { created: 2 });
    const list = await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json();
    assert.equal(list.length, 2);
    assert.equal(list[0].createdBy, 1);
  });
});

test("bulk: one invalid item → 400 with its index, nothing inserted (atomic)", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const res = await fetch(`${base}/api/bank/questions/bulk`, {
      method: "POST", headers: AUTH,
      body: JSON.stringify({ items: [
        { question: VALID_QUESTION },
        { question: { ...VALID_QUESTION, type: "poll" } }, // poll-with-correct → invalid
      ] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.index, 1);
    assert.equal((await (await fetch(`${base}/api/bank/questions`, { headers: AUTH })).json()).length, 0);
  });
});

test("bulk: empty items and over-cap both 400", async () => {
  await withServer(makeApp(new MemStorage()), async (base) => {
    const empty = await fetch(`${base}/api/bank/questions/bulk`, { method: "POST", headers: AUTH, body: JSON.stringify({ items: [] }) });
    assert.equal(empty.status, 400);
    const tooMany = await fetch(`${base}/api/bank/questions/bulk`, { method: "POST", headers: AUTH, body: JSON.stringify({ items: Array.from({ length: 51 }, () => ({ question: VALID_QUESTION })) }) });
    assert.equal(tooMany.status, 400);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — route returns 404.

- [ ] **Step 3: Implement** — in `server/bank-routes.ts`, add inside `registerBankRoutes` (after the POST `/api/bank/questions` handler). Add `z` import if missing (it's already imported):

```ts
  app.post("/api/bank/questions/bulk", requireAuth, async (req, res) => {
    try {
      const items = (req.body as { items?: unknown })?.items;
      if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
        return res.status(400).json({ message: "items must be an array of 1..50 bank questions" });
      }
      // All-or-nothing: validate every item BEFORE inserting any.
      const validated: Array<z.infer<typeof insertBankQuestionSchema>> = [];
      for (let i = 0; i < items.length; i++) {
        const parsed = insertBankQuestionSchema.safeParse(items[i]);
        if (!parsed.success) {
          return res.status(400).json({ message: "Invalid bank question", index: i, errors: parsed.error.errors });
        }
        validated.push(parsed.data);
      }
      const createdBy = (req as any).authUserId as number;
      const rows = await storage.createBankQuestions(tctx(req), validated.map((v) => ({ ...v, createdBy })));
      res.status(201).json({ created: rows.length });
    } catch (error) {
      captureError(error, { scope: "http.bank-bulk-create" });
      res.status(500).json({ message: "Failed to create bank questions" });
    }
  });
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run check && npm test`
Expected: tsc clean; the 3 new tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/bank-routes.ts server/bank-routes.test.ts
git commit -m "feat(bank): POST /api/bank/questions/bulk — atomic multi-insert (Import-ready)"
```

---

### Task 6: PR 1 gate + PR

- [ ] **Step 1: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Push + PR**

```bash
git push -u origin feat/ai-canonical-server
gh pr create --title "feat(ai): canonical-native generation + bulk bank endpoint (server, PR 1/2)" --body "$(cat <<'EOF'
## Summary
- Additive `difficulty`/`explanation` optional question fields + `generatedQuizSchema` validating AI output directly.
- openai-service rewritten to emit canonical mixed-type JSON (single/true-false/multi-select) with per-question difficulty/explanation and quiz-level subject/tags, validated by Zod with one error-fed retry; ~80 lines of hand-rolled validation removed; shared prompt/parse helpers unit-tested without live OpenAI.
- SECURITY: `explanation` is answer-key-equivalent — `sanitizeQuizForCaller` now strips it alongside correctAnswers (regression assertions in the auth integration test).
- New `POST /api/bank/questions/bulk` (atomic, 1..50, per-item validated, createdBy stamped) + `createBankQuestions` on both storage backends — Import-ready.

## Spec
docs/superpowers/specs/2026-07-19-ai-content-upgrade-design.md (PR 1 of 2)

## Tests
3 schema + 4 openai-helper + 1 storage + 3 bulk-route unit tests; full suite green, tsc clean, build OK. Live generation is verified in PR 2 browser QA (CI has no OPENAI_API_KEY).

## Deploy
Server-first; old clients keep working (quiz save already normalizes). No migration.

## Rollback
Revert the PR; all changes additive.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

# PR 2 — Client (branch `feat/ai-canonical-client`, based on main after PR 1 merges)

### Task 7: fromGenerated canonical passthrough (TDD) + editor wiring

**Files:**
- Modify: `client/src/pages/quiz-editor.tsx` (`fromGenerated` ~line 65; `applyGenerated` ~line 326; `runGeneration` ~line 341; AI dialog JSX ~line 389)
- Create: `client/src/lib/from-generated.ts` (extract the pure mapper so it's unit-testable)
- Test: `client/src/lib/from-generated.test.ts`

**Interfaces:**
- Consumes: `questionSchema` from `@shared/schema`.
- Produces: `normalizeGeneratedQuestions(raw: unknown[]): Question[]` (drops invalid; canonical passthrough; legacy `{correctAnswer}` fallback via schema preprocess).

- [ ] **Step 1: Create the branch**

```bash
git checkout main && git pull && git checkout -b feat/ai-canonical-client
```

- [ ] **Step 2: Write the failing tests** — `client/src/lib/from-generated.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGeneratedQuestions } from "./from-generated";

test("passes through a canonical mixed-type question incl. difficulty/explanation", () => {
  const out = normalizeGeneratedQuestions([
    { question: "q?", type: "quiz", answerType: "single", answers: ["a", "b", "c", "d"], correctAnswers: [2], timeLimit: 20, points: "standard", difficulty: "hard", explanation: "c" },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].correctAnswers[0], 2);
  assert.equal((out[0] as any).difficulty, "hard");
});

test("normalizes a legacy {correctAnswer} question via schema preprocess", () => {
  const out = normalizeGeneratedQuestions([
    { question: "q?", answers: ["a", "b", "c", "d"], correctAnswer: 1, timeLimit: 10 },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].correctAnswers, [1]);
});

test("drops invalid questions instead of throwing", () => {
  const out = normalizeGeneratedQuestions([
    { question: "ok?", type: "quiz", answerType: "single", answers: ["a", "b"], correctAnswers: [0], timeLimit: 10, points: "standard" },
    { question: "", answers: [] },            // invalid
    { garbage: true },                         // invalid
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].question, "ok?");
});

test("empty / non-array input yields empty array", () => {
  assert.deepEqual(normalizeGeneratedQuestions([]), []);
  assert.deepEqual(normalizeGeneratedQuestions(undefined as any), []);
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `client/src/lib/from-generated.ts`**

```ts
import { questionSchema, type Question } from "@shared/schema";

// AI generations are already canonical (server validates generatedQuizSchema).
// Parse each through questionSchema — this also normalizes any legacy
// {correctAnswer} shape from a cached older server response during deploy
// overlap — and drop anything that fails rather than crashing the dialog.
export function normalizeGeneratedQuestions(raw: unknown[]): Question[] {
  if (!Array.isArray(raw)) return [];
  const out: Question[] = [];
  for (const item of raw) {
    const parsed = questionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}
```

- [ ] **Step 5: Rewire `quiz-editor.tsx`** — delete the local `fromGenerated` function (~lines 65-86); import the helper; update `applyGenerated`:

```ts
import { normalizeGeneratedQuestions } from "@/lib/from-generated";
```

In `applyGenerated`, replace `questions: generated.questions.map(fromGenerated)` with:

```ts
      questions: normalizeGeneratedQuestions(generated.questions),
```

(Keep the surrounding title/description/toast logic. If `normalizeGeneratedQuestions` returns empty, keep the existing "no questions" guard — add one if applyGenerated lacks it: `if (questions.length === 0) throw new Error(t("editor.toasts.generatorNoQuestions"));`.)

- [ ] **Step 6: Run to verify they pass**

Run: `npm run check && npm test && npm run build`
Expected: tsc clean; 4 new tests pass; build OK.

- [ ] **Step 7: Commit**

```bash
git add client/src/lib/from-generated.ts client/src/lib/from-generated.test.ts client/src/pages/quiz-editor.tsx
git commit -m "feat(ai): fromGenerated canonical passthrough (schema-validated, drops invalid)"
```

---

### Task 8: Save-to-bank checkbox + bulk wiring in the AI dialog

**Files:**
- Modify: `client/src/pages/quiz-editor.tsx` (AI dialog state + JSX + `runGeneration`)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json`

**Interfaces:**
- Consumes: `POST /api/bank/questions/bulk` (PR 1), `apiRequest`.
- Produces: after a generation, optionally bulk-saves the generated questions with the AI's subject/tags.

- [ ] **Step 1: Add dialog state + the save call** — near the other AI state (`aiOpen`/`aiBusy`, ~line 319):

```ts
const [aiSaveToBank, setAiSaveToBank] = useState(true);
```

In `applyGenerated(generated)`, after populating the editor and BEFORE closing the dialog, add the optional bulk save (guard on questions existing):

```ts
    if (aiSaveToBank && Array.isArray(generated.questions) && generated.questions.length > 0) {
      const items = normalizeGeneratedQuestions(generated.questions).map((q) => ({
        question: q,
        subject: generated.subject || undefined,
        tags: Array.isArray(generated.tags) ? generated.tags : [],
      }));
      if (items.length > 0) {
        apiRequest("POST", "/api/bank/questions/bulk", { items })
          .then((res) => res.json())
          .then((data) => toast({ title: t("editor.ai.savedToBankToast", { count: data.created ?? items.length }) }))
          .catch(() => toast({ title: t("editor.ai.saveToBankFailed"), variant: "destructive" }));
      }
    }
```

(This is fire-and-forget — the editor is already populated; a bank failure must not block the generation UX.)

- [ ] **Step 2: Add the checkbox to the AI dialog JSX** — inside the `<DialogContent>` of the AI dialog (after the `<Tabs>` block, before the footer note ~line 415), add:

```tsx
              <label className="flex items-center gap-2 text-sm text-gray-600 mt-2">
                <Checkbox checked={aiSaveToBank} onCheckedChange={(v) => setAiSaveToBank(v === true)} />
                {t("editor.ai.saveToBank")}
              </label>
```

Add `Checkbox` to the imports: `import { Checkbox } from "@/components/ui/checkbox";`.

- [ ] **Step 3: Add i18n keys** — in `en.json` under `editor.ai`:

```json
"saveToBank": "Also save these questions to the Question Bank",
"savedToBankToast_one": "Saved {{count}} question to the bank",
"savedToBankToast_other": "Saved {{count}} questions to the bank",
"saveToBankFailed": "Couldn't save to the Question Bank"
```

In `ar.json` under `editor.ai` (full CLDR plural set for the count key — mirror the suffix convention used by existing plural keys like `editor.bank.addedToast`):

```json
"saveToBank": "احفظ هذه الأسئلة أيضًا في بنك الأسئلة",
"savedToBankToast_zero": "تم حفظ {{count}} سؤال في البنك",
"savedToBankToast_one": "تم حفظ سؤال واحد في البنك",
"savedToBankToast_two": "تم حفظ سؤالين في البنك",
"savedToBankToast_few": "تم حفظ {{count}} أسئلة في البنك",
"savedToBankToast_many": "تم حفظ {{count}} سؤالًا في البنك",
"savedToBankToast_other": "تم حفظ {{count}} سؤال في البنك",
"saveToBankFailed": "تعذّر الحفظ في بنك الأسئلة"
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green (locale parity + Arabic-CLDR tests pass).

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/quiz-editor.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(ai): 'also save to Question Bank' checkbox + bulk wiring in the AI dialog"
```

---

### Task 9: QuestionForm difficulty + explanation fields; bank card difficulty badge

**Files:**
- Modify: `client/src/components/bank/QuestionForm.tsx` (add fields before the image block)
- Modify: `client/src/pages/question-bank.tsx` (difficulty badge on cards)
- Modify: `client/src/locales/en.json`, `client/src/locales/ar.json`

**Interfaces:**
- Consumes: `Question` (now with difficulty/explanation).
- Produces: editable difficulty/explanation in the shared question form; visible difficulty badge on bank cards.

- [ ] **Step 1: Add fields to `QuestionForm.tsx`** — before the `{onUploadImage && (` image block, add:

```tsx
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
```

(`Select*` and `Textarea` are already imported in QuestionForm.tsx — verify; add if missing.)

- [ ] **Step 2: Add the difficulty badge to bank cards** — in `question-bank.tsx`, where the type badge / subject / tags render on each card, add next to the type badge:

```tsx
                    {row.question.difficulty && (
                      <Badge variant="outline">{t(`bank.difficulty${row.question.difficulty.charAt(0).toUpperCase() + row.question.difficulty.slice(1)}`)}</Badge>
                    )}
```

(This maps `easy|medium|hard` → `bank.difficultyEasy|Medium|Hard`. `Badge` is already imported.)

- [ ] **Step 3: Add i18n keys** — `en.json` under `bank`:

```json
"difficultyLabel": "Difficulty",
"difficultyNone": "None",
"difficultyEasy": "Easy",
"difficultyMedium": "Medium",
"difficultyHard": "Hard",
"explanationLabel": "Explanation",
"explanationPlaceholder": "Why the correct answer is right (optional)"
```

`ar.json` under `bank`:

```json
"difficultyLabel": "الصعوبة",
"difficultyNone": "بدون",
"difficultyEasy": "سهل",
"difficultyMedium": "متوسط",
"difficultyHard": "صعب",
"explanationLabel": "التفسير",
"explanationPlaceholder": "سبب صحة الإجابة الصحيحة (اختياري)"
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm test && npm run build`
Expected: all green (locale parity passes).

- [ ] **Step 5: Commit**

```bash
git add client/src/components/bank/QuestionForm.tsx client/src/pages/question-bank.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(ai): edit difficulty/explanation in QuestionForm; difficulty badge on bank cards"
```

---

### Task 10: PR 2 gate + browser QA + PR

- [ ] **Step 1: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Browser QA** (dev server; needs `OPENAI_API_KEY` in `.env`). Log in → editor → "Create with AI" → Topics: "Workplace fire safety" → keep "Also save to Question Bank" checked → Generate. Verify: (a) editor populates with a mix of single/true-false/multi-select questions, some showing difficulty in the right panel; (b) "Saved N questions to the bank" toast; (c) `/question-bank` shows the N new questions with difficulty badges + subject/tags; (d) open one in the bank editor — explanation + difficulty are editable. Switch to Arabic: dialog checkbox + toasts + bank fields all Arabic, RTL clean. Then host a game on the generated quiz → plays normally; as a player mid-game, confirm no explanation/answer leaks (spot-check via devtools network on `/api/games/:pin/results`).

- [ ] **Step 3: Commit any QA fixes, then push + PR**

```bash
git push -u origin feat/ai-canonical-client
gh pr create --base main --title "feat(ai): canonical AI in the editor + bank persistence (client, PR 2/2)" --body "$(cat <<'EOF'
## Summary
- `fromGenerated` → schema-validated `normalizeGeneratedQuestions` (canonical passthrough, drops invalid, legacy fallback) — AI quizzes now carry mixed types + difficulty/explanation into the editor.
- AI dialog: "Also save to Question Bank" checkbox (default on) → one bulk POST with the AI's subject/tags; pluralized success toast.
- `QuestionForm` gains difficulty select + explanation textarea (used by the bank dialog and manual authors); bank cards show a difficulty badge.
- Full EN+AR strings incl. Arabic CLDR plurals.

## Spec
docs/superpowers/specs/2026-07-19-ai-content-upgrade-design.md (PR 2 of 2)

## Browser QA
Live generation on both tenants: mixed-type output, bank bulk-save + badges, editable explanation/difficulty, Arabic RTL, gameplay + mid-game no-leak spot check. See task checklist.

## Rollback
Revert the PR; client-only.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review checklist (done at plan-writing time)

- **Spec coverage:** §3 fields+generatedQuizSchema → Task 1; §3 security → Task 3; §4 generation rewrite → Task 2; §5 bulk endpoint → Tasks 4–5; §6 client → Tasks 7–9; §7 testing → embedded per task; §8 two-PR rollout → PR boundaries. No gaps.
- **Placeholders:** none; every code step carries complete code.
- **Type consistency:** `generatedQuizSchema`/`GeneratedQuiz` (Task 1) consumed by Task 2; `parseGeneratedQuiz`/`buildGenerationPrompt` names stable across Task 2 + its tests; `createBankQuestions(ctx, items)` identical in Tasks 4→5; `normalizeGeneratedQuestions` identical across Task 7 (+ its consumers in Task 8); i18n keys match between JSON and components.
- **Judgment calls (documented in code/comments):** legacy-fallback path kept for deploy overlap; bulk save is fire-and-forget (never blocks generation UX); per-question tags = quiz-level tags (curate later, per spec §2).
