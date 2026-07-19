# AI Theme Background — Design

**Date:** 2026-07-20
**Status:** Approved by user (with amendments, incorporated below)
**Branch:** `feat/ai-theme-background` (worktree off `main` @ 93f748e; `feat/audit-log` is in flight in the main checkout — do not touch it)

## Goal

Let quiz authors generate a custom background image with AI from inside the
editor's theme dialog, in one flow: type (or accept the pre-filled) prompt →
Generate → background applies to the live theme. Background-only: accent /
text / card colors stay manual.

## What already exists (reuse, don't rebuild)

- `POST /api/generate-background` (server/routes.ts ~517): DALL-E 3 via
  `generateBackgroundImage()` (server/openai-service.ts ~292). Guarded by
  `aiLimiter`, `requireAuth`, `requireFeature("aiGeneration")`. Currently
  **dead code** — no client caller. Returns a base64 data URL.
- `uploadQuizImage(buffer, mimetype)` → Supabase Storage → https URL (used by
  `/api/upload-image`).
- `ThemeBuilder` (client/src/components/quiz/ThemeBuilder.tsx): presets grid,
  custom background upload (`onUploadBackground` → `uploadThemeImage` in
  quiz-editor.tsx sets `quiz.background` + `theme.background`).
- Theme model: `shared/quiz-theme.ts` (`QuizTheme`, `resolveQuizTheme`,
  `themeToCssVars`); backgrounds resolved by `client/src/utils/backgrounds.ts`
  (accepts preset ids, https URLs, and legacy data URLs).

## Server changes

### 1. Route: extend `POST /api/generate-background`

Request body (all optional except that at least `prompt` or `title` must
yield ≥3 usable chars):

```ts
{ prompt?: string; title?: string; description?: string }
```

- `prompt` (user free text): trim, 3–300 chars. If present it drives the
  image subject. If absent, fall back to today's title+description behavior.
- Existing `title` (≤100) / `description` (≤500) validation stays.
- Response: `{ url: string }` — an https Supabase Storage URL. **Fallback:**
  if image storage is not configured (`uploadQuizImage` throws its
  "not configured" error), return the base64 data URL instead so bare dev
  environments still work. Same response key either way.
- Guards unchanged: `aiLimiter`, `requireAuth`, `requireFeature("aiGeneration")`,
  `OPENAI_API_KEY` presence check, Sentry `captureError`, no-internals error
  mapping.

### 2. `generateBackgroundImage()` in openai-service.ts

- New signature: `generateBackgroundImage(input: { prompt?: string; title?: string; description?: string }): Promise<Buffer>` —
  returns the PNG buffer; the route owns upload/fallback encoding.
- Model `gpt-image-1`, size `1536x1024` (landscape — backgrounds are
  widescreen). Originally specced as dall-e-3 @ 1792x1024; live QA found
  dall-e-3 retired on this org and `response_format` removed from the
  Images API, so the implementation targets gpt-image-1 (quality "medium",
  b64 or URL response both handled).
- Prompt template (fixed wrapper around user text — injection posture
  unchanged: user text is truncated and embedded, never replaces the
  instruction frame):

  > Background image for an educational quiz game. Theme requested by the
  > user: "«user prompt or title+description»". Professional educational
  > style suitable for enterprise training; vibrant but not busy. The image
  > must work as a backdrop with UI overlaid on top: keep the center area
  > relatively clean and low-contrast. Absolutely no text, letters, numbers,
  > logos, watermarks, branding, or UI components in the image.

- Keep the existing OpenAI error mapping (401/429/500/quota/content-policy).

## Shared model change: readability overlay

`QuizTheme` gains one optional field:

```ts
/** 0–0.5 dark overlay on the background for text readability. Default 0. */
overlay?: number;
```

- `resolveQuizTheme`: default `0`, clamp to `[0, 0.5]` (non-numeric → 0).
- Rendering: in `QuizQuestionRenderer` (the single shared stage), when
  `overlay > 0`, prepend `linear-gradient(rgba(0,0,0,α), rgba(0,0,0,α))` to
  the background style returned by `getBackgroundStyle`. One place — editor
  preview, host, player, and quiz-preview all inherit it.
- Backward compatible: stored themes without `overlay` render exactly as
  today (0). No DB migration (`theme` is a jsonb-ish blob).
- PDF branding is unaffected (uses colors only).

## Client changes (ThemeBuilder + quiz-editor)

New "Generate with AI" section between the preset grid and the custom-upload
row:

- Text input pre-filled with the quiz title (editable → covers both
  "type what I want" and "one click from title"). Live character counter
  `N / 300` under the input; over-limit blocks Generate.
- ✨ Generate button. Disabled while generating or when trimmed prompt < 3
  chars. Loading state is a two-line message, not a bare spinner:
  - "✨ Creating your background…"
  - "This usually takes 10–20 seconds."
- On success: set background exactly like `uploadThemeImage` does
  (`quiz.background` + `theme.background` = returned URL) **and** set
  `theme.overlay = 0.25`. Autosave/versioning pick it up like any theme edit.
- On failure: keep the current background untouched; show the existing
  destructive toast pattern with the server's message. Never clear state.
- Overlay slider (0–50%, step 5) in the colors area, always visible — works
  for uploaded and preset backgrounds too. Label: "Background dimming".
- Visibility: the whole AI section renders only when
  `useTenant().features.aiGeneration` is true (client/src/lib/tenant.tsx —
  same flag the server route enforces via `requireFeature`).
- i18n: all new strings in `en.json` + `ar.json`
  (`editor.theme.ai.*`, `editor.theme.overlayLabel`). RTL-safe: plain
  input+button+slider rows, no directional CSS.
- The ThemeBuilder callback for generation lives in quiz-editor.tsx
  (`generateThemeImage(prompt)`) alongside `uploadThemeImage`, sharing the
  busy/`uploading` state so upload and generate can't race each other.

## Not in scope (explicitly agreed)

Gallery of generated images, prompt history, regenerate variants, palette
extraction (AI-picked accent colors), storing prompts server-side, pptx-style
per-slide backgrounds.

## Error handling summary

| Failure | Behavior |
|---|---|
| OPENAI_API_KEY missing | 500 "Service not configured" (existing) |
| Prompt too short/long | 400 with message; client blocks most cases pre-flight |
| OpenAI 429/quota | Existing friendly messages via error mapping |
| Content policy | Existing "Content policy violation…" message |
| Storage not configured | Data-URL fallback, feature still works |
| Any client-side failure | Toast; current background preserved |

## Testing

**Unit (node:test, existing patterns):**
- Prompt validation branches (prompt-only, title-only, neither → 400, >300 → 400).
- Prompt wrapper contains guardrail phrases and the truncated user text.
- `resolveQuizTheme` overlay: default 0, clamp, round-trip.
- Route storage-fallback branch (mock uploadQuizImage throwing "not configured").

**Browser QA (localhost, live OpenAI):**
- EN + AR UI; **Arabic prompt** generates successfully.
- Long prompt (counter, 300 cap).
- Generated image persists after save + page refresh (URL in DB, not base64).
- Autosave picks up generated background; version history restore round-trips it.
- Failure path: kill OPENAI_API_KEY → toast, background preserved.
- Overlay slider affects editor preview, host, and player stages.
- Zero console errors throughout.

**Gate:** `npm run check && npm test && npm run build` before every commit.
