# AI Theme Background Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let quiz authors generate an AI background image from the editor's theme dialog (pre-filled editable prompt → DALL-E 3 → Supabase Storage URL applied to the theme), with a readability-overlay control.

**Architecture:** Revive the dormant `POST /api/generate-background` route: new zod-validated body (`prompt`/`title`/`description`), DALL-E 3 landscape generation returning a Buffer, server-side upload to Supabase Storage (data-URL fallback when storage isn't configured), `{ url }` response. Client adds an AI section + overlay slider to `ThemeBuilder`; a new optional `overlay` field on `QuizTheme` renders as a CSS dark gradient in `QuizThemeProvider` (the single shared stage wrapper).

**Tech Stack:** Express 4, zod, OpenAI SDK (dall-e-3), Supabase Storage REST, React 18, react-i18next, node:test + tsx.

**Spec:** `docs/superpowers/specs/2026-07-20-ai-theme-background-design.md` (approved).

## Global Constraints

- Work in the worktree `C:\projects\PDO Quiz\Abraj_Quiz-ai-theme`, branch `feat/ai-theme-background` (off main @ 93f748e). NEVER touch the main checkout (`C:\projects\PDO Quiz\Abraj_Quiz`) — `feat/audit-log` is in flight there.
- Gate before every commit: `npm run check && npm test && npm run build`.
- User prompt: 3–300 chars trimmed; server truncates to 300 before embedding. Fixed guardrail frame around user text, never replaced by it.
- DALL-E: model `dall-e-3`, size `1792x1024`, `response_format: "b64_json"`, quality `standard`.
- Overlay: number 0–0.5, default 0; AI generation sets 0.25; slider max 50% step 5.
- Route response key is `{ url }` (the old `{ backgroundUrl }` had no callers).
- On any client failure: current background must remain untouched.
- All new UI strings in BOTH `client/src/locales/en.json` and `ar.json`; layout must work in RTL.
- No new dependencies.

---

### Task 1: Worktree setup + `overlay` on the shared theme model

**Files:**
- Modify: `shared/quiz-theme.ts`
- Test: `shared/quiz-theme.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `QuizTheme.overlay?: number` (0–0.5); `resolveQuizTheme()` always returns a clamped numeric `overlay` (default 0). `DEFAULT_QUIZ_THEME.overlay === 0`. Later tasks (2, 6, 7) rely on `theme.overlay` existing after resolve.

- [ ] **Step 1: One-time worktree setup**

```bash
cd "C:\projects\PDO Quiz\Abraj_Quiz-ai-theme"
npm install
cp "../Abraj_Quiz/.env" .env
```

Expected: install completes; `.env` present (gitignored — verify `git status` does NOT list it).

- [ ] **Step 2: Write the failing tests**

Append to `shared/quiz-theme.test.ts`:

```ts
test("overlay defaults to 0 and clamps to [0, 0.5]", () => {
  assert.equal(resolveQuizTheme({}).overlay, 0);
  assert.equal(resolveQuizTheme({ theme: { overlay: 0.25 } }).overlay, 0.25);
  assert.equal(resolveQuizTheme({ theme: { overlay: 2 } }).overlay, 0.5);
  assert.equal(resolveQuizTheme({ theme: { overlay: -1 } }).overlay, 0);
  assert.equal(resolveQuizTheme({ theme: { overlay: "dark" as unknown as number } }).overlay, 0);
  assert.equal(DEFAULT_QUIZ_THEME.overlay, 0);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm test -- --test-name-pattern="overlay defaults"`
(If pattern filtering is awkward: `node --import tsx --test shared/quiz-theme.test.ts`)
Expected: FAIL — `overlay` is `undefined`.

- [ ] **Step 4: Implement**

In `shared/quiz-theme.ts`:

Add to the `QuizTheme` interface (after `cardStyle`):

```ts
  /** 0–0.5 dark overlay over the background for text readability. Default 0. */
  overlay?: number;
```

Add to `DEFAULT_QUIZ_THEME`:

```ts
  overlay: 0,
```

Add a private helper above `resolveQuizTheme`:

```ts
function clampOverlay(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(0.5, Math.max(0, value));
}
```

Add to the object returned by `resolveQuizTheme` (after `cardStyle`):

```ts
    overlay: clampOverlay(custom.overlay),
```

`themeToCssVars` is intentionally unchanged (overlay is applied as a background layer, not a CSS var).

- [ ] **Step 5: Run tests to verify pass**

Run: `node --import tsx --test shared/quiz-theme.test.ts`
Expected: all pass, including the 5 pre-existing tests.

- [ ] **Step 6: Commit**

```bash
git add shared/quiz-theme.ts shared/quiz-theme.test.ts
git commit -m "feat(theme): optional readability overlay on QuizTheme (clamped 0-0.5, default 0)"
```

---

### Task 2: Overlay rendering in the shared background style

**Files:**
- Modify: `client/src/utils/backgrounds.ts`
- Modify: `client/src/components/quiz/QuizThemeProvider.tsx`
- Test: `client/src/utils/backgrounds.test.ts` (new file)

**Interfaces:**
- Consumes: `theme.overlay` from Task 1.
- Produces: `getBackgroundStyleWithOverlay(backgroundValue: string, overlay?: number): React.CSSProperties` exported from `client/src/utils/backgrounds.ts`. `QuizThemeProvider` renders the overlay for every themed surface (editor preview, host, player, quiz-preview) — no other component needs changes.

- [ ] **Step 1: Write the failing tests**

Create `client/src/utils/backgrounds.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { getBackgroundStyle, getBackgroundStyleWithOverlay } from "./backgrounds";

test("overlay prepends a darkening gradient to any background image", () => {
  const withOverlay = getBackgroundStyleWithOverlay("classroom", 0.25);
  assert.match(String(withOverlay.backgroundImage), /^linear-gradient\(rgba\(0,0,0,0\.25\), rgba\(0,0,0,0\.25\)\), /);
  // Underlying image is preserved after the gradient layer.
  assert.ok(String(withOverlay.backgroundImage).includes(String(getBackgroundStyle("classroom").backgroundImage)));
});

test("overlay of 0 / undefined / out-of-range-low returns the plain style", () => {
  assert.deepEqual(getBackgroundStyleWithOverlay("classroom", 0), getBackgroundStyle("classroom"));
  assert.deepEqual(getBackgroundStyleWithOverlay("aurora", undefined), getBackgroundStyle("aurora"));
  assert.deepEqual(getBackgroundStyleWithOverlay("classroom", -3), getBackgroundStyle("classroom"));
});

test("overlay clamps above 0.5 and applies to gradient presets too", () => {
  const s = getBackgroundStyleWithOverlay("aurora", 0.9);
  assert.match(String(s.backgroundImage), /^linear-gradient\(rgba\(0,0,0,0\.5\), rgba\(0,0,0,0\.5\)\), linear-gradient/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test client/src/utils/backgrounds.test.ts`
Expected: FAIL — `getBackgroundStyleWithOverlay` is not exported.

- [ ] **Step 3: Implement**

Append to `client/src/utils/backgrounds.ts`:

```ts
// Background style with an optional darkening overlay (readability on busy
// images, esp. AI-generated ones). Overlay is clamped to [0, 0.5]; 0 = plain.
export const getBackgroundStyleWithOverlay = (
  backgroundValue: string,
  overlay?: number,
): React.CSSProperties => {
  const style = getBackgroundStyle(backgroundValue);
  const alpha = typeof overlay === "number" && Number.isFinite(overlay)
    ? Math.min(0.5, Math.max(0, overlay))
    : 0;
  if (alpha <= 0 || !style.backgroundImage) return style;
  return {
    ...style,
    backgroundImage: `linear-gradient(rgba(0,0,0,${alpha}), rgba(0,0,0,${alpha})), ${style.backgroundImage}`,
  };
};
```

In `client/src/components/quiz/QuizThemeProvider.tsx`, change the import and the style spread:

```ts
import { getBackgroundStyleWithOverlay } from "@/utils/backgrounds";
```

and in the JSX:

```tsx
      style={{ ...getBackgroundStyleWithOverlay(theme.background, theme.overlay), ...vars, fontFamily: "var(--quiz-font)", ...style }}
```

(Remove the now-unused `getBackgroundStyle` import from QuizThemeProvider.)

- [ ] **Step 4: Run tests + typecheck**

Run: `node --import tsx --test client/src/utils/backgrounds.test.ts && npm run check`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/backgrounds.ts client/src/utils/backgrounds.test.ts client/src/components/quiz/QuizThemeProvider.tsx
git commit -m "feat(theme): render readability overlay via QuizThemeProvider"
```

---

### Task 3: Server — guarded prompt builder + Buffer-returning generation

**Files:**
- Modify: `server/openai-service.ts` (replace `generateBackgroundImage`, lines ~292-349)
- Test: `server/openai-service.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `export interface BackgroundImageInput { prompt?: string; title?: string; description?: string }`
  - `export function buildBackgroundImagePrompt(input: BackgroundImageInput): string` (throws `Error` if usable text < 3 chars)
  - `export async function generateBackgroundImage(input: BackgroundImageInput): Promise<Buffer>` — PNG buffer, 1792x1024. Task 5's route calls this. **This changes the old `(title, description) => Promise<string>` signature — the route in Task 5 is the only caller.**

- [ ] **Step 1: Write the failing tests**

Append to `server/openai-service.test.ts` (import `buildBackgroundImagePrompt` at the top alongside the existing imports):

```ts
test("buildBackgroundImagePrompt wraps user text in the guardrail frame", () => {
  const p = buildBackgroundImagePrompt({ prompt: "space adventure for kids" });
  assert.match(p, /space adventure for kids/);
  assert.match(p, /educational quiz game/i);
  assert.match(p, /enterprise training/i);
  assert.match(p, /center area relatively clean/i);
  assert.match(p, /no text, letters, numbers, logos, watermarks, branding, or UI components/i);
});

test("buildBackgroundImagePrompt prefers prompt over title, falls back to title+description", () => {
  const p = buildBackgroundImagePrompt({ prompt: "volcanoes", title: "Ignored", description: "ignored too" });
  assert.match(p, /volcanoes/);
  assert.doesNotMatch(p, /Ignored/);
  const f = buildBackgroundImagePrompt({ title: "Fire Safety", description: "PPE basics" });
  assert.match(f, /Fire Safety — PPE basics/);
});

test("buildBackgroundImagePrompt truncates user text to 300 chars and rejects <3 chars", () => {
  const long = "x".repeat(400);
  const p = buildBackgroundImagePrompt({ prompt: long });
  assert.ok(!p.includes("x".repeat(301)));
  assert.ok(p.includes("x".repeat(300)));
  assert.throws(() => buildBackgroundImagePrompt({ prompt: "ab" }));
  assert.throws(() => buildBackgroundImagePrompt({}));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test server/openai-service.test.ts`
Expected: FAIL — `buildBackgroundImagePrompt` not exported.

- [ ] **Step 3: Implement**

In `server/openai-service.ts`, replace the whole existing `generateBackgroundImage` function with:

```ts
export interface BackgroundImageInput {
  prompt?: string;
  title?: string;
  description?: string;
}

// Fixed guardrail frame; user text is truncated and embedded, never replaces
// the instructions (same injection posture as the old title-based prompt).
export function buildBackgroundImagePrompt(input: BackgroundImageInput): string {
  const fromPrompt = input.prompt?.trim() ?? "";
  const fromQuiz = [input.title?.trim(), input.description?.trim()].filter(Boolean).join(" — ");
  const userText = (fromPrompt.length >= 3 ? fromPrompt : fromQuiz).substring(0, 300);
  if (userText.trim().length < 3) {
    throw new Error("A prompt or quiz title of at least 3 characters is required");
  }
  return `Background image for an educational quiz game. Theme requested by the user: "${userText}". Professional educational style suitable for enterprise training; vibrant but not busy. The image must work as a backdrop with UI overlaid on top: keep the center area relatively clean and low-contrast. Absolutely no text, letters, numbers, logos, watermarks, branding, or UI components in the image.`;
}

export async function generateBackgroundImage(input: BackgroundImageInput): Promise<Buffer> {
  try {
    const prompt = buildBackgroundImagePrompt(input);

    console.log("Generating background image with DALL-E");

    const response = await getOpenAI().images.generate({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: "1792x1024",
      quality: "standard",
      response_format: "b64_json",
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("Invalid response from image generation API");
    }
    return Buffer.from(b64, "base64");
  } catch (error: any) {
    console.error("Background image generation error:", error);

    // Handle specific OpenAI API errors
    if (error.status === 401) {
      throw new Error("Authentication failed. Please contact support.");
    }
    if (error.status === 429) {
      throw new Error("Service busy. Please try again in a few minutes.");
    }
    if (error.status === 500) {
      throw new Error("Service temporarily unavailable. Please try again later.");
    }
    if (error.code === 'insufficient_quota') {
      throw new Error("Service quota exceeded. Please try again later.");
    }
    if (error.response?.status === 400 && error.response?.data?.error?.message?.includes('content_policy')) {
      throw new Error("Content policy violation. Please try with different quiz details.");
    }
    if (error.message?.includes("at least 3 characters")) {
      throw error; // validation error — surface as-is (route 400s pre-flight anyway)
    }

    throw new Error("Failed to generate background image. Please try again.");
  }
}
```

NOTE: `server/routes.ts` still calls the old signature at this point and will not compile — that is fixed in Task 5. To keep this task independently green, ALSO apply the minimal call-site fix in `server/routes.ts` (~line 541): replace

```ts
      const backgroundDataUrl = await generateBackgroundImage(
        title.trim(), 
        description && typeof description === 'string' ? description.trim() : ""
      );
      res.json({ backgroundUrl: backgroundDataUrl });
```

with

```ts
      const png = await generateBackgroundImage({
        title: title.trim(),
        description: description && typeof description === "string" ? description.trim() : "",
      });
      res.json({ url: `data:image/png;base64,${png.toString("base64")}` });
```

(Task 5 replaces this whole handler; this is just a compile bridge.)

- [ ] **Step 4: Run tests + typecheck**

Run: `node --import tsx --test server/openai-service.test.ts && npm run check`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add server/openai-service.ts server/openai-service.test.ts server/routes.ts
git commit -m "feat(ai-theme): guarded background prompt builder + landscape Buffer generation"
```

---

### Task 4: Server — storage with data-URL fallback

**Files:**
- Modify: `server/supabase-storage.ts`
- Test: `server/supabase-storage.test.ts` (new file)

**Interfaces:**
- Consumes: existing `isImageUploadConfigured()`, `uploadQuizImage(buffer, contentType)` in the same file.
- Produces: `export async function storeGeneratedBackground(png: Buffer): Promise<string>` — https Supabase URL when storage is configured, `data:image/png;base64,...` otherwise. Task 5's route calls this.

- [ ] **Step 1: Write the failing tests**

Create `server/supabase-storage.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { storeGeneratedBackground, isImageUploadConfigured } from "./supabase-storage";

test("storeGeneratedBackground falls back to a data URL when storage is not configured", async (t) => {
  const savedUrl = process.env.SUPABASE_URL;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  t.after(() => {
    if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
    if (savedKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
  });

  assert.equal(isImageUploadConfigured(), false);
  const png = Buffer.from("fake-png-bytes");
  const url = await storeGeneratedBackground(png);
  assert.ok(url.startsWith("data:image/png;base64,"));
  assert.equal(Buffer.from(url.slice("data:image/png;base64,".length), "base64").toString(), "fake-png-bytes");
});
```

(No network test for the configured path — `uploadQuizImage` is already exercised in production via `/api/upload-image`; mocking Supabase here adds no confidence.)

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test server/supabase-storage.test.ts`
Expected: FAIL — `storeGeneratedBackground` not exported.

- [ ] **Step 3: Implement**

Append to `server/supabase-storage.ts`:

```ts
// Stores an AI-generated background PNG. Falls back to an inline data URL when
// Storage isn't configured (bare dev env) so the feature still works — at the
// cost of a fat quiz row, which is acceptable only as a fallback.
export async function storeGeneratedBackground(png: Buffer): Promise<string> {
  if (!isImageUploadConfigured()) {
    return `data:image/png;base64,${png.toString("base64")}`;
  }
  return uploadQuizImage(png, "image/png");
}
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test server/supabase-storage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/supabase-storage.ts server/supabase-storage.test.ts
git commit -m "feat(ai-theme): storeGeneratedBackground with data-URL fallback"
```

---

### Task 5: Server — request schema + route rework

**Files:**
- Create: `server/background-request.ts`
- Modify: `server/routes.ts` (the `/api/generate-background` handler, ~lines 517-555, plus imports)
- Test: `server/background-request.test.ts` (new file)

**Interfaces:**
- Consumes: `generateBackgroundImage(input): Promise<Buffer>` (Task 3), `storeGeneratedBackground(png): Promise<string>` (Task 4).
- Produces: `export const generateBackgroundBodySchema` (zod). Route contract for Task 7: `POST /api/generate-background` body `{ prompt?: string; title?: string; description?: string }` → 200 `{ url: string }` | 400/500 `{ message: string }`.

- [ ] **Step 1: Write the failing tests**

Create `server/background-request.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateBackgroundBodySchema } from "./background-request";

test("accepts a prompt-only body and trims it", () => {
  const r = generateBackgroundBodySchema.safeParse({ prompt: "  space adventure  " });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.prompt, "space adventure");
});

test("accepts a title-only body (legacy shape) and rejects an empty body", () => {
  assert.equal(generateBackgroundBodySchema.safeParse({ title: "Fire Safety" }).success, true);
  assert.equal(generateBackgroundBodySchema.safeParse({}).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "ab" }).success, false);
});

test("enforces length caps: prompt 300, title 100, description 500", () => {
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "x".repeat(301) }).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "x".repeat(300) }).success, true);
  assert.equal(generateBackgroundBodySchema.safeParse({ title: "x".repeat(101) }).success, false);
  assert.equal(generateBackgroundBodySchema.safeParse({ prompt: "valid one", description: "x".repeat(501) }).success, false);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --import tsx --test server/background-request.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the schema**

Create `server/background-request.ts`:

```ts
import { z } from "zod";

// Body for POST /api/generate-background. Either a free-text prompt (drives
// the image) or a quiz title (legacy fallback) must carry >= 3 usable chars.
export const generateBackgroundBodySchema = z
  .object({
    prompt: z.string().trim().min(3).max(300).optional(),
    title: z.string().trim().max(100).optional(),
    description: z.string().trim().max(500).optional(),
  })
  .refine((b) => (b.prompt?.length ?? 0) >= 3 || (b.title?.length ?? 0) >= 3, {
    message: "Provide a prompt (or quiz title) of at least 3 characters",
  });

export type GenerateBackgroundBody = z.infer<typeof generateBackgroundBodySchema>;
```

- [ ] **Step 4: Run schema tests**

Run: `node --import tsx --test server/background-request.test.ts`
Expected: PASS.

- [ ] **Step 5: Rework the route**

In `server/routes.ts`:

Add imports (top of file, near the existing `uploadQuizImage` import):

```ts
import { storeGeneratedBackground } from "./supabase-storage";
import { generateBackgroundBodySchema } from "./background-request";
```

(`uploadQuizImage` import stays — `/api/upload-image` still uses it. `generateBackgroundImage` is already imported.)

Replace the ENTIRE `/api/generate-background` handler (everything between `app.post("/api/generate-background", ...` and its closing `});`, including the Task 3 compile bridge) with:

```ts
  app.post("/api/generate-background", aiLimiter, requireAuth, requireFeature("aiGeneration"), async (req, res) => {
    try {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ message: "Service not configured" });
      }

      const parsed = generateBackgroundBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }

      const png = await generateBackgroundImage(parsed.data);
      const url = await storeGeneratedBackground(png);
      res.json({ url });
    } catch (error: any) {
      captureError(error, { scope: "http.generate-background" });
      console.error("Error generating background image:", error);
      // Return user-friendly error message without leaking internals
      const userMessage = error.message?.includes('OpenAI') || error.message?.includes('API')
        ? "Service temporarily unavailable. Please try again later."
        : error.message || "Failed to generate background image";
      res.status(500).json({ message: userMessage });
    }
  });
```

- [ ] **Step 6: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green (198 pre-existing + ~10 new tests).

- [ ] **Step 7: Commit**

```bash
git add server/background-request.ts server/background-request.test.ts server/routes.ts
git commit -m "feat(ai-theme): zod-validated generate-background route returning storage URL"
```

---

### Task 6: Client — ThemeBuilder AI section + overlay slider + i18n

**Files:**
- Modify: `client/src/components/quiz/ThemeBuilder.tsx`
- Modify: `client/src/locales/en.json` (inside `editor.theme`)
- Modify: `client/src/locales/ar.json` (inside `editor.theme`)

**Interfaces:**
- Consumes: `theme.overlay` (Task 1).
- Produces: new optional `ThemeBuilderProps`: `aiEnabled?: boolean; generating?: boolean; onGenerateBackground?: (prompt: string) => void; defaultAiPrompt?: string`. Task 7 passes all four. i18n keys `editor.theme.ai.*` and `editor.theme.overlayLabel` (Task 7 also uses `editor.theme.ai.failedTitle`).

No unit test — the repo has no React component test infrastructure; this task is verified by typecheck now and browser QA in Task 8.

- [ ] **Step 1: Extend props and add local state**

In `client/src/components/quiz/ThemeBuilder.tsx`:

```ts
import { useState } from "react";
```

Replace the `ThemeBuilderProps` interface with:

```ts
export interface ThemeBuilderProps {
  theme: QuizTheme;
  onChange: (theme: QuizTheme) => void;
  onUploadBackground: (file: File) => void;
  uploading?: boolean;
  /** Tenant has the aiGeneration feature — hides the AI section when false. */
  aiEnabled?: boolean;
  /** An AI generation request is in flight. */
  generating?: boolean;
  onGenerateBackground?: (prompt: string) => void;
  /** Pre-fill for the AI prompt (the quiz title). */
  defaultAiPrompt?: string;
}
```

Update the destructuring:

```ts
export function ThemeBuilder({ theme, onChange, onUploadBackground, uploading, aiEnabled, generating, onGenerateBackground, defaultAiPrompt }: ThemeBuilderProps) {
  const { t } = useTranslation();
  const [aiPrompt, setAiPrompt] = useState(defaultAiPrompt ?? "");
```

Also add `Sparkles` to the lucide import: `import { ImagePlus, Sparkles } from "lucide-react";`

- [ ] **Step 2: Add the AI section JSX**

Insert between the presets `</div>` (closing the Presets block) and the custom-upload `<label>`:

```tsx
        {/* Generate with AI */}
        {aiEnabled && onGenerateBackground && (
          <div>
            <div className="text-xs font-semibold text-gray-500 mb-1">{t("editor.theme.ai.sectionLabel")}</div>
            <div className="flex gap-2">
              <input
                type="text"
                value={aiPrompt}
                maxLength={300}
                disabled={generating}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder={t("editor.theme.ai.promptPlaceholder")}
                className="flex-1 border rounded p-2 text-sm"
              />
              <button
                onClick={() => onGenerateBackground(aiPrompt.trim())}
                disabled={generating || aiPrompt.trim().length < 3}
                className="shrink-0 flex items-center gap-1 rounded-lg border px-3 py-2 text-sm font-medium text-abraj-primary border-abraj-primary disabled:opacity-50"
              >
                <Sparkles className="w-4 h-4" /> {t("editor.theme.ai.generateButton")}
              </button>
            </div>
            <div className="text-[10px] text-gray-400 mt-0.5">{aiPrompt.length} / 300</div>
            {generating && (
              <div className="text-xs text-gray-600 mt-1" role="status" aria-live="polite">
                <div>{t("editor.theme.ai.generatingTitle")}</div>
                <div className="text-gray-400">{t("editor.theme.ai.generatingHint")}</div>
              </div>
            )}
          </div>
        )}
```

(If `text-abraj-primary`/`border-abraj-primary` don't exist as utilities in this codebase, use the same classes as the existing selected-preset ring — check `border-abraj-primary` usage at the preset buttons, which DOES exist in this file.)

- [ ] **Step 3: Add the overlay slider**

Change the Colors grid from `grid-cols-3` to `grid-cols-2` with the three color pickers plus the slider (4 cells), OR simpler — keep `grid-cols-3` and add the slider as a new full-width block right after the colors grid:

```tsx
        {/* Readability overlay */}
        <label className="block text-xs text-gray-500">
          {t("editor.theme.overlayLabel")} ({Math.round((theme.overlay ?? 0) * 100)}%)
          <input
            type="range"
            min={0}
            max={50}
            step={5}
            value={Math.round((theme.overlay ?? 0) * 100)}
            onChange={(e) => set({ overlay: Number(e.target.value) / 100 })}
            className="block w-full mt-1"
          />
        </label>
```

- [ ] **Step 4: Locale keys**

In `client/src/locales/en.json`, inside `editor.theme` (sibling of `"presets"`), add:

```json
      "overlayLabel": "Background dimming",
      "ai": {
        "sectionLabel": "Generate with AI",
        "promptPlaceholder": "Describe your background — e.g. space adventure for kids",
        "generateButton": "Generate",
        "generatingTitle": "✨ Creating your background…",
        "generatingHint": "This usually takes 10–20 seconds.",
        "failedTitle": "Background generation failed"
      },
```

CAUTION: `editor.theme` in en.json currently has no `ai` key, but `editor.ai` exists (the quiz-generation dialog) — do NOT touch that one.

In `client/src/locales/ar.json`, same position inside `editor.theme`:

```json
      "overlayLabel": "تعتيم الخلفية",
      "ai": {
        "sectionLabel": "إنشاء بالذكاء الاصطناعي",
        "promptPlaceholder": "صف الخلفية — مثال: مغامرة فضائية للأطفال",
        "generateButton": "إنشاء",
        "generatingTitle": "✨ جارٍ إنشاء الخلفية…",
        "generatingHint": "يستغرق ذلك عادةً من 10 إلى 20 ثانية.",
        "failedTitle": "فشل إنشاء الخلفية"
      },
```

- [ ] **Step 5: Typecheck + build**

Run: `npm run check && npm run build`
Expected: clean. (ThemeBuilder's new props are all optional — existing call site still compiles.)

- [ ] **Step 6: Commit**

```bash
git add client/src/components/quiz/ThemeBuilder.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(ai-theme): AI generate section + overlay slider in ThemeBuilder (EN/AR)"
```

---

### Task 7: Client — quiz-editor wiring

**Files:**
- Modify: `client/src/pages/quiz-editor.tsx` (state ~line 141, handlers ~line 352, ThemeBuilder call site ~line 891)

**Interfaces:**
- Consumes: route contract from Task 5 (`{ url }`), ThemeBuilder props from Task 6, `useTenant().features.aiGeneration` (client/src/lib/tenant.tsx:18), existing `apiRequest(method, url, body)` from `@/lib/queryClient` (throws on non-OK).
- Produces: nothing further — last code task.

- [ ] **Step 1: Add state + handler**

Next to the existing `const [uploading, setUploading] = useState(false);` add:

```ts
  const [generatingBg, setGeneratingBg] = useState(false);
```

After `uploadThemeImage` (~line 352) add:

```ts
  // AI background generation — on failure the current background is untouched.
  const generateThemeImage = async (prompt: string) => {
    setGeneratingBg(true);
    try {
      const res = await apiRequest("POST", "/api/generate-background", { prompt });
      const { url } = await res.json();
      setQuiz((prev) => ({
        ...prev,
        background: url,
        theme: { ...prev.theme, background: url, overlay: 0.25 },
      }));
    } catch (e: any) {
      toast({ title: t("editor.theme.ai.failedTitle"), description: e.message, variant: "destructive" });
    } finally {
      setGeneratingBg(false);
    }
  };
```

- [ ] **Step 2: Wire the ThemeBuilder call site**

At ~line 891, extend:

```tsx
                <ThemeBuilder
                  theme={quiz.theme}
                  uploading={uploading}
                  onChange={(theme) => setQuiz((p) => ({ ...p, theme, background: theme.background }))}
                  onUploadBackground={uploadThemeImage}
                  aiEnabled={tenant.features.aiGeneration}
                  generating={generatingBg}
                  onGenerateBackground={generateThemeImage}
                  defaultAiPrompt={quiz.title}
                />
```

(`tenant` is already in scope: `const tenant = useTenant();` at ~line 128.)

- [ ] **Step 3: Full gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/quiz-editor.tsx
git commit -m "feat(ai-theme): wire AI background generation into the quiz editor"
```

---

### Task 8: Browser QA + fixes

**Files:**
- No planned changes — fixes only if QA finds issues.

**Interfaces:** consumes everything; produces the QA verdict for the PR body.

- [ ] **Step 1: Start the dev server in the worktree**

```bash
cd "C:\projects\PDO Quiz\Abraj_Quiz-ai-theme"
npm run dev
```

(Port 5000. Make sure the main checkout's dev server is NOT also running.)

- [ ] **Step 2: QA checklist (browser automation or manual), from the spec:**

- [ ] EN + AR: AI section renders in the theme dialog, RTL layout correct.
- [ ] Character counter live-updates; 300 cap enforced; Generate disabled < 3 chars.
- [ ] Generate with an English prompt → loading copy shows both lines → background applies, overlay defaults to 25%, accent untouched.
- [ ] Generate with an **Arabic prompt** → succeeds.
- [ ] Returned background is an **https Supabase URL** (not `data:`) — check the DOM style or network.
- [ ] Save quiz → refresh page → generated background + overlay persist.
- [ ] Autosave chip fires on generation; version history restore round-trips the background.
- [ ] Failure path: temporarily set an invalid `OPENAI_API_KEY` in `.env`, restart, generate → destructive toast, current background preserved. Restore the key after.
- [ ] Storage fallback: temporarily unset `SUPABASE_URL`, restart, generate → data-URL background still works. Restore after.
- [ ] Overlay slider (0→50%) visibly dims editor preview; check host/player stage via preview page.
- [ ] Zero console errors throughout.

- [ ] **Step 3: Fix anything found, re-run gate, commit fixes**

```bash
npm run check && npm test && npm run build
git add -A && git commit -m "fix(ai-theme): browser QA fixes"
```

(Skip the commit if QA is clean.)

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/ai-theme-background
gh pr create --base main --title "feat: AI theme background generation + readability overlay" --body "<summary + QA evidence>"
```
