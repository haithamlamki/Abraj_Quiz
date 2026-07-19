# AI Content Upgrade — Design Spec

> **Status:** Approved design, pre-implementation.
> **Date:** 2026-07-19
> **Source roadmap:** `docs/superpowers/plans/2026-07-18-product-polish-enterprise-audit.md` §4 Wave 4+ item 3 (dependencies — Question Bank, canonical `correctAnswers[]` shape — both shipped).
> **Constraints (CLAUDE.md hard rules):** never leak answer keys pre-close (now includes `explanation` — see §3); all storage via StorageCtx (`tctx(req)`); additive-only schema; gameplay untouched; all client strings bilingual EN/AR; `gpt-4o` model pinned in openai-service.ts stays (its comment forbids changing it without an explicit request).

## 1. Problem

The 5 AI endpoints (`/api/generate-quiz/{topics,text,url,pdf}` + `/api/generate-background`) work but emit the LEGACY question shape: exactly 4 answers, single `correctAnswer: number`, hand-rolled validation (~80 duplicated lines). The client's `fromGenerated` down-converts everything to plain single-select. AI quizzes are second-class: no true/false, no multi-select, no difficulty, no explanations, no route into the Question Bank.

## 2. Scope

**In:** canonical-native generation (mixed types), `difficulty` + `explanation` question fields, quiz-level `subject`/`tags` suggestions, Zod validation of generated output, bulk bank persistence endpoint + editor checkbox, difficulty/explanation editing in `QuestionForm`, EN+AR strings.

**Out (YAGNI):** poll generation (tally questions don't fit generated educational content); two-pass metadata enrichment; showing explanations in gameplay (future post-question reveal, BACKLOG); per-question tag differentiation on bulk save (quiz-level tags apply to every question; curate in the bank); async job pipeline (generation stays synchronous, as today); `/api/generate-background` (unchanged).

## 3. Shared schema (additive)

Two optional fields on `questionObjectSchema` (exactly the `sourceQuestionId` pattern — explicit optional fields, or Zod strips them):

```ts
difficulty: z.enum(["easy", "medium", "hard"]).optional(),
explanation: z.string().trim().max(500).optional(),
```

**Security invariant (lesson from the insights-snapshot review):** `explanation` text routinely states the correct answer, so it is answer-key-equivalent. `sanitizeQuizForCaller` (routes.ts) adds `explanation` to its per-question omit list, alongside `correctAnswer`/`correctAnswers` — covering non-owner quiz fetches and mid-game results. The game-snapshot path is already safe (`toClientGame` strips the whole snapshot). `difficulty` does not leak answers and stays visible. A regression test pins explanation-stripping.

New `generatedQuizSchema` (in `shared/schema.ts`, next to `questionSchema`):

```ts
export const generatedQuizSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(500).default(""),
  subject: z.string().trim().max(100).optional(),
  tags: z.array(z.string().max(50)).max(8).default([]).transform(normalizeTags),
  questions: z.array(questionSchema).min(1).max(12),
});
export type GeneratedQuiz = z.infer<typeof generatedQuizSchema>;
```

(`questionSchema` already accepts the new optional fields once they're added; polls remain impossible in generated output because the prompt never asks for them and any `type:"poll"` with correct answers fails the existing superRefine.)

## 4. Generation service (`server/openai-service.ts`)

- One shared prompt core used by the topics path and the content path (pdf/url/text funnel through `generateQuizFromContent` as today). The prompt instructs `gpt-4o` to emit canonical JSON directly: 8–12 questions; mostly 4-option single-select; 1–3 true/false (`type:"true_false"`, answers exactly ["True","False"]); 0–2 multi-select (`answerType:"multiple"`, 2+ `correctAnswers`); per-question `timeLimit` (10–30s), `difficulty`, and a 1–2 sentence `explanation` of the correct answer; quiz-level `subject` and 2–4 `tags`.
- Output validated with `generatedQuizSchema.safeParse`. On failure: ONE retry, appending the Zod error summary to the prompt ("your previous response failed validation: …"); second failure → throw the existing user-facing error ("Failed to generate properly formatted quiz…"). Existing per-source wrappers, error mapping (401/429/500/quota), content-length limits, and the legacy `QuizQuestion`/`GeneratedQuiz` local interfaces are replaced by the schema-inferred types.
- Routes `/api/generate-quiz/*`: paths, `requireAuth`, `aiLimiter`, `requireFeature(aiGeneration)` gates all unchanged; they simply return the richer validated object.

## 5. Bulk bank endpoint

`POST /api/bank/questions/bulk` (in `server/bank-routes.ts`, `requireAuth` + `tctx`):

- Body: `{ items: Array<{ question, subject?, tags? }> }`, 1–50 items, each validated by the existing `insertBankQuestionSchema`.
- All-or-nothing: validate every item first; any failure → `400 { message, index, errors }` (the first failing index); nothing inserted. Then insert all via new storage method `createBankQuestions(ctx, items: Array<InsertBankQuestion & { createdBy }>)` — MemStorage loops `createBankQuestion`; DatabaseStorage uses one multi-row insert. Response: `201 { created: n }`.
- `createdBy` stamped from `req.authUserId` on every item. This endpoint is deliberately shaped for the future Import wave.

## 6. Client (`quiz-editor.tsx` + shared components)

- **`fromGenerated`:** generated questions are already canonical — parse each through `questionSchema.safeParse`, keep successes, drop failures (defensive; never crash the dialog). Falls back to the legacy mapping only if `correctAnswers` is absent and `correctAnswer` present (belt-and-suspenders for cached older server responses during deploy overlap).
- **AI dialog:** one checkbox, default ON — "Also save to Question Bank" (`editor.ai.saveToBank`). After a successful generation: populate the editor as today, and if checked, fire one `POST /api/bank/questions/bulk` with `{question, subject: generated.subject, tags: generated.tags}` per question; success toast "Saved {{count}} to the bank" (pluralized EN `_one/_other`, AR full CLDR); bulk failure → non-blocking destructive toast (the editor content is unaffected).
- **`QuestionForm`** (bank dialog; shared): optional difficulty select (—/easy/medium/hard) and explanation textarea (max 500). Bank question cards show a difficulty badge when present.
- All new strings in BOTH `en.json` and `ar.json`.

## 7. Testing

- Schema: `difficulty`/`explanation` accepted + optional + round-trip; explanation >500 rejected; `generatedQuizSchema` accepts a mixed-type fixture (single/TF/multi), rejects poll-with-correct, legacy `correctAnswer` fixture normalizes via preprocess.
- Sanitize regression: non-owner `GET /api/quizzes/:id` response contains neither `correctAnswers` nor `explanation` (extends the existing secrecy tests).
- Generation core: unit test the retry/validation flow with a mocked OpenAI client (fixture responses: valid, invalid-then-valid, invalid-twice). No live OpenAI in CI.
- Bulk endpoint HTTP tests (MemStorage harness, same pattern as bank-routes.test.ts): 401 anon, 400-with-index on one bad item + nothing inserted, happy path `created: n`, 50-item cap.
- Storage: `createBankQuestions` both-backend semantics (Mem test; DB via tsc + shared route tests).
- Client: `fromGenerated` unit tests (canonical passthrough, invalid dropped, legacy fallback).
- Live-generation smoke test in PR 2 browser QA (needs OPENAI_API_KEY locally).

## 8. Rollout — 2 PRs

1. **Server** (`feat/ai-canonical-server`): schema fields + `generatedQuizSchema` + sanitize hardening + openai-service rewrite + bulk endpoint + storage method + all server tests. Deployable alone — old clients keep working (legacy fallback unnecessary server-side: quiz save already normalizes).
2. **Client** (`feat/ai-canonical-client`): `fromGenerated`, AI-dialog checkbox + bulk wiring, QuestionForm fields, badges, i18n, browser QA incl. one live generation on both tenants.

## 9. Risks

| Risk | Mitigation |
|---|---|
| GPT emits malformed canonical JSON more often than legacy | Zod-validated with one error-fed retry; clean user-facing failure after; prompt includes a full JSON example |
| `explanation` leaks answers mid-game | Stripped in `sanitizeQuizForCaller` wherever answer keys are stripped; regression test (spec §3) |
| Bulk endpoint abused to spam the shared bank | requireAuth + existing rate-limiting posture; 50-item cap; same per-item validation as single create |
| Deploy overlap: new client + old server (or vice versa) | Server-first rollout; client keeps a legacy-shape fallback in `fromGenerated` |
| Mixed types confuse the editor's generated-quiz hydration | `fromGenerated` parses through `questionSchema` — the same shape the editor already edits natively |
