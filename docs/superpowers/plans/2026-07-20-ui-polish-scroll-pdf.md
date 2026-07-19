# UI Polish: Scrollbars, Home Cards, Host Lobby, PDF Logo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six user-requested UI fixes: static Recent Quizzes cards, a one-line theme-aware feature strip, a single scrollbar app-wide, no phantom empty space on short pages, a host lobby that fits one screen, and a legible logo plate in both PDF exports.

**Architecture:** All changes are client-side (React + Tailwind + jsPDF). The scroll fixes hinge on one fact: the sticky `<nav>` is 68px tall (`h-16` = 64px + `border-b-4` = 4px, `client/src/components/navigation.tsx:19-21`), yet page wrappers size themselves to the FULL viewport (`h-screen` inner scrollers → two scrollbars; `min-h-screen` → document always 68px taller than the viewport → scrollbar on empty pages). We add one CSS utility `.page-fill` (`min-height: calc(100dvh - 68px)`) and sweep every page wrapper onto it, letting the body be the single scroller. The PDF fix adds a pure `logoPlateRect` helper (unit-tested) that both jsPDF generators use to draw a white rounded plate behind the logo.

**Tech Stack:** React 18, Tailwind (arbitrary values + `@layer utilities` in `client/src/index.css`), i18next (`client/src/locales/en.json` + `ar.json`), jsPDF, node:test via `npm test`.

## Global Constraints

- Run `npm run check && npm test && npm run build` before EVERY commit (CLAUDE.md workflow rule). All three must pass.
- Never hardcode tenant branding in the client — theme colors come from CSS vars `--abraj-primary`/`--abraj-secondary` set by `TenantProvider` (`client/src/lib/tenant.tsx:95-96`). Use existing utilities like `text-abraj-primary` (`client/src/index.css:125`).
- One session = one worktree = one branch. Create via `git worktree add "../Abraj_Quiz-ui-polish" -b feat/ui-polish-scroll-pdf origin/main`, run `npm ci` there once, and verify `git branch --show-current` prints `feat/ui-polish-scroll-pdf` before EVERY commit.
- Every user-visible string goes through i18next with keys in BOTH `en.json` and `ar.json`.
- `client/src/utils/pdf-theme.ts` must stay a pure module — no jsPDF, no DOM, no asset imports (it runs under node:test).
- Frontend deploys to Vercel as static only; no server changes in this plan.

---

### Task 1: `.page-fill` utility + single-scrollbar sweep

Fixes user items 3 (double scrollbar) and 4 (empty pages force scroll).

**Files:**
- Modify: `client/src/index.css` (inside `@layer utilities`, after `.pulse-ring` block ~line 417)
- Modify: `client/src/pages/home.tsx:168`
- Modify: `client/src/pages/game-results.tsx:120,148,230`
- Modify: `client/src/pages/host-game.tsx:290`
- Modify: `client/src/pages/host-quiz-setup.tsx:136,156`
- Modify: `client/src/pages/quiz-pdf.tsx:77,93`
- Modify: `client/src/pages/question-bank.tsx:92`
- Modify: `client/src/pages/not-found.tsx:6`
- Modify: `client/src/pages/quiz-insights.tsx:54,61,76`
- Modify: `client/src/pages/signup.tsx:94`
- Modify: `client/src/pages/login.tsx:71`
- Modify: `client/src/pages/play-game.tsx:474,518,560,605`
- Modify: `client/src/pages/join-game.tsx:116`
- Modify: `client/src/pages/quiz-history.tsx:101`
- Modify: `client/src/pages/quiz-preview.tsx:41,49`
- Modify: `client/src/components/page-loader.tsx:13`
- Modify: `client/src/App.tsx:92` (error-boundary fallback)

**Interfaces:**
- Produces: CSS class `page-fill` = `min-height: calc(100dvh - 68px)`. Later tasks (host lobby) rely on the same 68px constant via Tailwind arbitrary value `h-[calc(100dvh-68px)]` (already the idiom in `play-game.tsx:574` and `quiz-editor.tsx:548`).
- Do NOT touch: `quiz-editor.tsx:548` (already `lg:h-[calc(100dvh-68px)]`), `play-game.tsx:574,687` and `host-game.tsx:518` (already `h-[calc(100dvh-68px)] overflow-hidden`), `ui/toast.tsx` (`max-h-screen` is a toast viewport, not a page).

- [ ] **Step 1: Add the utility to `client/src/index.css`**

Append inside the `@layer utilities { ... }` block, after the `.pulse-ring` rule:

```css
  /* Fills the viewport below the 68px sticky nav (h-16 + 4px border in
     navigation.tsx). Pages use this instead of h-screen/min-h-screen so the
     document is never taller than the viewport when content is short, and the
     body stays the ONLY scroller (no nested overflow-y-auto page wrappers). */
  .page-fill {
    min-height: calc(100dvh - 68px);
  }
```

- [ ] **Step 2: Remove the two inner page scrollers (double-scrollbar sources)**

These wrappers create a second scrollbar because they are full-viewport-height scroll containers sitting below the 68px nav inside an already-scrollable body:

`client/src/pages/home.tsx:168` — replace:
```tsx
    <div className="h-screen overflow-y-auto relative">
```
with:
```tsx
    <div className="page-fill relative">
```

`client/src/pages/game-results.tsx:230` — replace:
```tsx
    <div className="h-screen overflow-y-auto animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-6">
```
with:
```tsx
    <div className="page-fill animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 py-6">
```

(`host-game.tsx:339` is the third inner scroller — it is reworked in Task 4, not here.)

- [ ] **Step 3: Replace `min-h-screen` with `page-fill` on every page wrapper**

In each location below, replace the single token `min-h-screen` with `page-fill` in the `className`, keeping every other class unchanged. These are all top-level page wrappers rendered below the nav; `min-h-screen` (100vh) + 68px nav makes the document minimum 100vh+68px, which is the "empty page still scrolls" bug.

| File | Lines |
|---|---|
| `client/src/pages/game-results.tsx` | 120, 148 |
| `client/src/pages/host-game.tsx` | 290 |
| `client/src/pages/host-quiz-setup.tsx` | 136, 156 |
| `client/src/pages/quiz-pdf.tsx` | 77, 93 |
| `client/src/pages/question-bank.tsx` | 92 |
| `client/src/pages/not-found.tsx` | 6 |
| `client/src/pages/quiz-insights.tsx` | 54, 61, 76 |
| `client/src/pages/signup.tsx` | 94 |
| `client/src/pages/login.tsx` | 71 |
| `client/src/pages/play-game.tsx` | 474, 518, 560, 605 |
| `client/src/pages/join-game.tsx` | 116 |
| `client/src/pages/quiz-history.tsx` | 101 |
| `client/src/pages/quiz-preview.tsx` | 41, 49 |
| `client/src/components/page-loader.tsx` | 13 |
| `client/src/App.tsx` | 92 |

Example (`client/src/pages/login.tsx:71`):
```tsx
    <div className="page-fill animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center p-4">
```

After the sweep, run this to confirm no page-level stragglers remain (only the exclusions listed in Interfaces should match):

Run: `rg -n "min-h-screen|h-screen" client/src`
Expected: matches only in `client/src/components/ui/toast.tsx` (`max-h-screen`) and `client/src/App.tsx` (the outer app shell keeps `min-h-screen` deliberately — it contains the nav, so `page-fill`'s below-nav floor would be the wrong semantics there) — nothing else.

- [ ] **Step 4: Verify with the quality gate**

Run: `npm run check && npm test && npm run build`
Expected: tsc clean, all tests pass, build succeeds.

- [ ] **Step 5: Visual spot-check (dev server)**

Check :5000 first per CLAUDE.md; if taken by another session, use another port. Run `npm run dev`, then in a browser:
- `/` (home): exactly ONE scrollbar (the browser's), scrolling moves the whole page under the sticky nav.
- `/login`: NO scrollbar at all (content fits, no 68px phantom overflow).
- `/my-quizzes` with few quizzes: no scrollbar.

- [ ] **Step 6: Commit**

```bash
git add client/src/index.css client/src/pages client/src/components/page-loader.tsx client/src/App.tsx
git commit -m "fix(layout): single body scrollbar via page-fill utility, no phantom 68px overflow

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Static Recent Quizzes cards

Fixes user item 1 — remove the float animation and hover motion from the "Your Recent Quizzes" cards.

**Files:**
- Modify: `client/src/pages/home.tsx:370`

**Interfaces:**
- Consumes: nothing from other tasks (independent).
- Produces: nothing later tasks use.

- [ ] **Step 1: Remove motion classes from the quiz card**

`client/src/pages/home.tsx:370` — replace:
```tsx
                    <Card key={quiz.id} className="bg-white shadow-lg hover:shadow-xl transition-all duration-300 card-3d-enhanced player-card-float w-72 flex-shrink-0 hover:scale-105">
```
with:
```tsx
                    <Card key={quiz.id} className="bg-white shadow-lg hover:shadow-xl card-3d-enhanced w-72 flex-shrink-0">
```

`player-card-float` (the perpetual float loop, `index.css:388-400`) and `hover:scale-105` + `transition-all duration-300` (hover motion) go; the static shadow-on-hover stays. Do NOT delete the `.player-card-float` CSS itself — the game lobby player chips (`host-game.tsx:371`) still use it deliberately.

- [ ] **Step 2: Verify with the quality gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/home.tsx
git commit -m "fix(home): recent quiz cards are static (no float/scale animation)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: One-line theme-aware feature strip

Fixes user item 2 — the highlight cards at the bottom of home become six compact cards in one row on desktop, colored by the tenant theme (CSS var, not the hardcoded `#019ebd`), covering the real feature set: AI generation, theme builder, question bank, import, reports, live games.

**Files:**
- Modify: `client/src/locales/en.json` (home section, replaces `featureTimeLimits*/featureRichMedia*/featureTeamMode*/featureAnalytics*` keys, ~lines 64-71)
- Modify: `client/src/locales/ar.json` (same keys, ~lines 72-79)
- Modify: `client/src/pages/home.tsx:8` (icon imports) and `home.tsx:441-468` (Features Grid block)

**Interfaces:**
- Consumes: `text-abraj-primary` utility (`index.css:125`) driven by the tenant-set `--abraj-primary` var — this is what makes the strip "reflect the theme".
- Produces: i18n keys `home.featureAiTitle/Desc`, `home.featureThemeTitle/Desc`, `home.featureBankTitle/Desc`, `home.featureImportTitle/Desc`, `home.featureReportsTitle/Desc`, `home.featureLiveTitle/Desc` (used only by home.tsx).

- [ ] **Step 1: Replace the feature keys in `client/src/locales/en.json`**

In the `"home"` object, DELETE these 8 keys:
`featureTimeLimitsTitle`, `featureTimeLimitsDesc`, `featureRichMediaTitle`, `featureRichMediaDesc`, `featureTeamModeTitle`, `featureTeamModeDesc`, `featureAnalyticsTitle`, `featureAnalyticsDesc`

and ADD in their place:
```json
    "featureAiTitle": "AI Generation",
    "featureAiDesc": "Generate quizzes with AI",
    "featureThemeTitle": "Theme Builder",
    "featureThemeDesc": "Custom colors & backgrounds",
    "featureBankTitle": "Question Bank",
    "featureBankDesc": "Reuse saved questions",
    "featureImportTitle": "Import",
    "featureImportDesc": "Excel, CSV & Word",
    "featureReportsTitle": "Reports & Insights",
    "featureReportsDesc": "Excel, CSV & PDF exports",
    "featureLiveTitle": "Live Games",
    "featureLiveDesc": "Real-time hosted play"
```

- [ ] **Step 2: Replace the same keys in `client/src/locales/ar.json`**

Delete the same 8 old keys, add:
```json
    "featureAiTitle": "توليد بالذكاء الاصطناعي",
    "featureAiDesc": "أنشئ اختبارات بالذكاء الاصطناعي",
    "featureThemeTitle": "منشئ السمات",
    "featureThemeDesc": "ألوان وخلفيات مخصصة",
    "featureBankTitle": "بنك الأسئلة",
    "featureBankDesc": "أعد استخدام الأسئلة المحفوظة",
    "featureImportTitle": "استيراد",
    "featureImportDesc": "‏Excel و‏CSV و‏Word",
    "featureReportsTitle": "التقارير والتحليلات",
    "featureReportsDesc": "تصدير Excel و‏CSV و‏PDF",
    "featureLiveTitle": "ألعاب مباشرة",
    "featureLiveDesc": "لعب مباشر في الوقت الفعلي"
```

- [ ] **Step 3: Rewrite the Features Grid in `client/src/pages/home.tsx`**

Update the lucide import on line 8 — remove `Clock`, `Image`, `Users` (only used by the old grid; `BarChart` and `BookOpen` remain in use) and add `Sparkles`, `Palette`, `Library`, `FileUp`, `Gamepad2`:

```tsx
import { Trophy, Sparkles, Palette, Library, FileUp, Gamepad2, BarChart, BookOpen, Play, QrCode, X, Crown, Medal, Award } from "lucide-react";
```

Add the card list right after the imports/interfaces (module scope, above `export default function Home()`):

```tsx
const featureCards = [
  { icon: Sparkles, titleKey: "home.featureAiTitle", descKey: "home.featureAiDesc" },
  { icon: Palette, titleKey: "home.featureThemeTitle", descKey: "home.featureThemeDesc" },
  { icon: Library, titleKey: "home.featureBankTitle", descKey: "home.featureBankDesc" },
  { icon: FileUp, titleKey: "home.featureImportTitle", descKey: "home.featureImportDesc" },
  { icon: BarChart, titleKey: "home.featureReportsTitle", descKey: "home.featureReportsDesc" },
  { icon: Gamepad2, titleKey: "home.featureLiveTitle", descKey: "home.featureLiveDesc" },
] as const;
```

Replace the whole `{/* Features Grid - Horizontal */}` block (`home.tsx:441-468`, the `max-w-6xl` div containing the four hardcoded cards) with:

```tsx
            {/* Feature highlights — one line on desktop, tenant-theme colored */}
            <div className="max-w-6xl mx-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {featureCards.map(({ icon: Icon, titleKey, descKey }) => (
                  <div key={titleKey} className="p-4 rounded-xl text-center card-3d-enhanced text-abraj-primary">
                    <Icon className="w-6 h-6 mb-2 mx-auto" />
                    <h4 className="font-bold text-sm">{t(titleKey)}</h4>
                    <p className="text-xs opacity-80">{t(descKey)}</p>
                  </div>
                ))}
              </div>
            </div>
```

Notes: no `animate-scale-in`/`animationDelay` (strip is static), no hardcoded `text-[#019ebd]` (that was the theme violation), `card-3d-enhanced` already themes its background/border via `--card`/`--border`.

- [ ] **Step 4: Verify with the quality gate**

Run: `npm run check && npm test && npm run build`
Expected: all green. `npm run check` will also catch any now-unused icon import.

- [ ] **Step 5: Visual spot-check**

On `/` in the dev server: six cards in ONE row at desktop width, icons/text in the tenant primary color (toggle to Arabic with the nav language button — titles must render in Arabic, RTL order).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/home.tsx client/src/locales/en.json client/src/locales/ar.json
git commit -m "feat(home): one-line theme-aware feature strip (AI, themes, bank, import, reports, live)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Compact host-game lobby to fit one screen

Fixes user item 5 — the waiting-lobby branch of the host page currently uses `h-screen overflow-y-auto py-8` (its own scroller, third double-scrollbar source) with roomy spacing. Make it a fixed `calc(100dvh-68px)` box on desktop with tighter spacing so it fits without scrolling; on small screens it degrades to normal page scroll.

**Files:**
- Modify: `client/src/pages/host-game.tsx:339,342-345,355,384`

**Interfaces:**
- Consumes: the 68px nav-height convention from Task 1 (Tailwind arbitrary value, matching the active-game branch at `host-game.tsx:518`).
- Produces: nothing later tasks use.

- [ ] **Step 1: Fix the wrapper height and spacing**

`client/src/pages/host-game.tsx:339` — replace:
```tsx
      <div className="h-screen overflow-y-auto py-8 animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50" style={getBackgroundStyle(quiz?.background || 'classroom')}>
```
with:
```tsx
      <div className="h-[calc(100dvh-68px)] overflow-y-auto lg:overflow-hidden py-4 animate-gradient bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50" style={getBackgroundStyle(quiz?.background || 'classroom')}>
```

(`lg:overflow-hidden` = fits-without-scroll on desktop, the user's ask; phones keep an internal scroll rather than clipping the Start button.)

- [ ] **Step 2: Tighten the header block**

`host-game.tsx:343-345` — replace:
```tsx
          <div className="text-center mb-8">
            <h1 className="font-bold text-4xl mb-4 gradient-text">{t("host.gameLobby")}</h1>
            <div className="flex justify-center items-center space-x-4 mb-6">
```
with:
```tsx
          <div className="text-center mb-4">
            <h1 className="font-bold text-3xl mb-2 gradient-text">{t("host.gameLobby")}</h1>
            <div className="flex justify-center items-center space-x-4 mb-2">
```

- [ ] **Step 3: Let the cards shrink on desktop, grow on mobile**

`host-game.tsx:355` — replace:
```tsx
          <div className="grid lg:grid-cols-2 gap-4 flex-1 min-h-0">
```
with:
```tsx
          <div className="grid lg:grid-cols-2 gap-4 flex-1 lg:min-h-0">
```

(Without `min-h-0` on mobile the grid grows to content height and the wrapper's `overflow-y-auto` scrolls it; with it on `lg` the players list scrolls INSIDE its card via the existing `CardContent overflow-y-auto` at line 363.)

`host-game.tsx:384` — replace:
```tsx
              <CardContent className="space-y-3 flex-shrink-0">
```
with:
```tsx
              <CardContent className="space-y-3 flex-1 min-h-0 lg:overflow-y-auto">
```

(Safety valve: on unusually short desktop windows the share column scrolls internally instead of clipping the Start Game button.)

- [ ] **Step 4: Verify with the quality gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 5: Visual spot-check**

Create a game (host any quiz) and open the lobby at 1920×1080 and at a ~1366×768 window: the whole lobby (title, PIN badges, players card, QR, copy buttons, Start Game) fits with NO scrollbar. Join with 10+ players from a second tab and confirm the players list scrolls inside its card while the page still doesn't.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/host-game.tsx
git commit -m "fix(host): lobby fits one screen without scrolling (calc-height + compact spacing)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: White logo plate in both PDF exports (TDD)

Fixes user item 6 — in the quiz PDF (`quiz-pdf-generator.ts`) and the results report (`enhanced-pdf-generator.ts`) the logo is drawn straight onto the primary-colored header band, so dark/transparent tenant logos vanish into it. Draw a white rounded backing plate behind the logo in both. The plate geometry lives in the pure `pdf-theme.ts` module so it gets a unit test.

**Files:**
- Modify: `client/src/utils/pdf-theme.ts` (append helper)
- Test: `client/src/utils/pdf-theme.test.ts` (append test)
- Modify: `client/src/utils/quiz-pdf-generator.ts:6,156-162`
- Modify: `client/src/utils/enhanced-pdf-generator.ts:4,117-126`

**Interfaces:**
- Produces: `logoPlateRect(logoX: number, logoY: number, logoW: number, logoH: number, pad?: number): { x: number; y: number; w: number; h: number; r: number }` exported from `client/src/utils/pdf-theme.ts`. Units are PDF mm; `r` is the corner radius passed twice to jsPDF's `roundedRect(x, y, w, h, rx, ry, style)`.
- Consumes: nothing from other tasks (independent).

- [ ] **Step 1: Write the failing test**

Append to `client/src/utils/pdf-theme.test.ts` (add `logoPlateRect` to the existing import from `./pdf-theme`):

```ts
test("logoPlateRect pads the logo box symmetrically with rounded corners", () => {
  assert.deepEqual(logoPlateRect(150, 10.5, 24, 19), { x: 147.5, y: 8, w: 29, h: 24, r: 2 });
  assert.deepEqual(logoPlateRect(20, 20, 35, 30, 3), { x: 17, y: 17, w: 41, h: 36, r: 2 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `logoPlateRect` is not exported (`SyntaxError`/`TypeError` on import).

- [ ] **Step 3: Implement the helper**

Append to `client/src/utils/pdf-theme.ts`:

```ts
/**
 * White backing plate behind a header logo. Both PDF generators stamp the
 * logo onto the primary-colored band; without a plate, dark or transparent
 * tenant logos disappear into it. Units: PDF mm. `r` feeds jsPDF
 * roundedRect(x, y, w, h, r, r, "F").
 */
export function logoPlateRect(
  logoX: number,
  logoY: number,
  logoW: number,
  logoH: number,
  pad = 2.5,
): { x: number; y: number; w: number; h: number; r: number } {
  return { x: logoX - pad, y: logoY - pad, w: logoW + pad * 2, h: logoH + pad * 2, r: 2 };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS (all suites).

- [ ] **Step 5: Wire the plate into the quiz PDF generator**

`client/src/utils/quiz-pdf-generator.ts:6` — add `logoPlateRect` to the existing import:
```ts
import { derivePdfTheme, fitText, logoPlateRect, rgbToHex, type PdfTheme } from "./pdf-theme";
```

`quiz-pdf-generator.ts:156-162` — inside `addHeader()`, replace:
```ts
    if (logoDataUrl) {
      try {
        this.pdf.addImage(logoDataUrl, "PNG", logoX, (bandHeight - logoHeight) / 2, logoWidth, logoHeight);
      } catch (error) {
        console.warn("Could not add logo to PDF:", error);
      }
    }
```
with:
```ts
    if (logoDataUrl) {
      try {
        const logoY = (bandHeight - logoHeight) / 2;
        const plate = logoPlateRect(logoX, logoY, logoWidth, logoHeight);
        this.pdf.setFillColor(255, 255, 255);
        this.pdf.roundedRect(plate.x, plate.y, plate.w, plate.h, plate.r, plate.r, "F");
        this.pdf.addImage(logoDataUrl, "PNG", logoX, logoY, logoWidth, logoHeight);
      } catch (error) {
        console.warn("Could not add logo to PDF:", error);
      }
    }
```

- [ ] **Step 6: Wire the plate into the results-report generator**

`client/src/utils/enhanced-pdf-generator.ts:4` — add `logoPlateRect` to the existing import:
```ts
import { derivePdfTheme, fitText, hexToRgb, logoPlateRect, shade, type Rgb } from "./pdf-theme";
```

`enhanced-pdf-generator.ts:117-126` — replace the logo block:
```ts
  // Add logo
  try {
    const logoWidth = 35;
    const logoHeight = 30;
    const logoData = branding?.logoDataUrl || logo;
    const logoFormat = typeof logoData === "string" && logoData.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    pdf.addImage(logoData, logoFormat, 20, yPosition, logoWidth, logoHeight);
  } catch (error) {
    console.warn('Could not add logo to PDF:', error);
  }
```
with:
```ts
  // Add logo on a white plate so it stays legible on the colored band
  try {
    const logoWidth = 35;
    const logoHeight = 30;
    const logoData = branding?.logoDataUrl || logo;
    const logoFormat = typeof logoData === "string" && logoData.startsWith("data:image/jpeg") ? "JPEG" : "PNG";
    const plate = logoPlateRect(20, yPosition, logoWidth, logoHeight, 3);
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(plate.x, plate.y, plate.w, plate.h, plate.r, plate.r, "F");
    pdf.addImage(logoData, logoFormat, 20, yPosition, logoWidth, logoHeight);
  } catch (error) {
    console.warn('Could not add logo to PDF:', error);
  }
```

(Note `yPosition` is still 20 at this point in the function; the plate at pad 3 spans y 17-53 inside the 45mm band + its 2mm shadow — visually a card overlapping the band edge slightly, which is fine and matches the "modern card" style of the rest of the report.)

- [ ] **Step 7: Verify with the quality gate**

Run: `npm run check && npm test && npm run build`
Expected: all green.

- [ ] **Step 8: Visual spot-check of both PDFs**

In the dev server: open a quiz → PDF export page (`/quiz-pdf/:id`) and download; finish (or open a completed) game → results page → download the report. In both PDFs the logo sits on a white rounded plate clearly separated from the colored header band. (Chrome blocks a 2nd automation-triggered blob download in one session — if QA-ing via browser automation, verify one PDF per page load or generate via the module directly.)

- [ ] **Step 9: Commit**

```bash
git add client/src/utils/pdf-theme.ts client/src/utils/pdf-theme.test.ts client/src/utils/quiz-pdf-generator.ts client/src/utils/enhanced-pdf-generator.ts
git commit -m "fix(pdf): white backing plate behind logo in quiz PDF and results report

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Final verification & handoff

- [ ] Run the full gate once more on the branch tip: `npm run check && npm test && npm run build` — all green.
- [ ] Browser QA pass covering all six items in BOTH languages (EN + AR/RTL): home single scrollbar + static quiz cards + 6-card strip in tenant color, empty pages scroll-free, host lobby fits one screen, both PDFs show the logo plate.
- [ ] Use superpowers:finishing-a-development-branch — PR against `main`, referencing this plan. No migration, no server changes, no new dependencies.
