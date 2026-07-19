# Tenant-Themed PDF Polish (Quiz PDF + Report PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both client-generated PDFs (the printable Quiz PDF and the post-game Report PDF) tenant-branded, overflow-proof, and visually polished — fixing the QR/title overlap, the background-theme override that discards tenant colors, a CMYK `setFillColor` bug, unbounded text overflow, and adding vector medal icons for 1st/2nd/3rd place.

**Architecture:** Both PDFs are generated client-side with jsPDF (`client/src/utils/quiz-pdf-generator.ts` and `client/src/utils/enhanced-pdf-generator.ts`), already receiving a `PdfBranding` object built by `tenantPdfBranding()` in `client/src/lib/tenant.tsx` (only `footerText`/`headerText`/`logoDataUrl` are actually used today — `primaryColor` is mostly ignored). We add one new pure module `client/src/utils/pdf-theme.ts` (color derivation + text fitting, fully unit-tested under `node:test`), then rework each generator to consume it. No server, schema, or API changes.

**Tech Stack:** TypeScript, jsPDF 2.x (`text`, `splitTextToSize`, `getTextWidth`, `roundedRect`, `circle`, `triangle`, `GState`), `qrcode`, node:test via tsx.

## Global Constraints

- Run `npm run check && npm test && npm run build` before any commit (CLAUDE.md workflow rule).
- Never hardcode tenant branding in the client; branding flows from `useTenant()` / `tenantPdfBranding()` (CLAUDE.md hard rule). The neutral fallback color when no branding is passed is slate `[71, 85, 105]` — matching `DEFAULT_TENANT_CONFIG.branding.pdf.primaryColor` in `client/src/lib/tenant.tsx:37` — NOT the old teal.
- Preserve the existing invariant in `enhanced-pdf-generator.ts` (comment block at lines 73–84): a quiz's explicit custom theme (`quiz.theme` object → `resolveQuizTheme().accent`) overrides the tenant primary, but un-themed quizzes MUST keep tenant branding.
- The unit test runner is `node --import tsx --test` (see `package.json:23`). It cannot load modules that import image assets (`@assets/...`), `jspdf`, or touch `window` — so ALL logic that needs unit tests lives in the new pure module `pdf-theme.ts`; the two generator files are verified by `tsc` + build + manual browser QA.
- jsPDF built-in helvetica is WinAnsi-encoded: characters like `✓` (U+2713) are NOT renderable — draw glyphs with vector primitives instead.
- `pdf.setFillColor(a, b, c, d)` with 4 numeric args means **CMYK**, not RGB+alpha. Opacity is done via `pdf.setGState(pdf.GState({ opacity: n }))`.
- Client-only change: do not modify `server/`, `shared/`, or any API surface.
- Work on a fresh branch off `main` named `feat/pdf-polish` (the session's current branch `feat/audit-log` is unrelated in-flight work — do not build on it).

## File Structure

- **Create** `client/src/utils/pdf-theme.ts` — pure, dependency-free helpers: `Rgb` tuple type, `hexToRgb`, `rgbToHex`, `mixWithWhite`, `shade`, `derivePdfTheme` (tenant primary → full palette), `fitText` (ellipsis truncation via injected measure function). Single responsibility: everything unit-testable about PDF theming/fitting.
- **Create** `client/src/utils/pdf-theme.test.ts` — node:test coverage for the above.
- **Modify** `client/src/utils/quiz-pdf-generator.ts` — header rebuilt as a tenant-colored band (logo right, wrapped title left, no overlap), QR moved to a reserved column beside the description, all hardcoded teal → theme colors, `✓` replaced with a drawn checkmark.
- **Modify** `client/src/utils/enhanced-pdf-generator.ts` — background-keyed palettes removed in favor of `derivePdfTheme(branding.primaryColor)` (custom quiz-theme accent override preserved), CMYK bug fixed, long title/description/player names truncated with `fitText`, vector medals drawn for top 3, quiz-details card aligned to the same 25mm inset as every other card.
- **No changes** to `client/src/lib/tenant.tsx`, `client/src/pages/quiz-pdf.tsx`, `client/src/pages/game-results.tsx` — call sites already pass `branding`.

---

### Task 1: Pure theme/fitting module `pdf-theme.ts` (TDD)

**Files:**
- Create: `client/src/utils/pdf-theme.ts`
- Test: `client/src/utils/pdf-theme.test.ts`

**Interfaces:**
- Consumes: nothing (pure module, no imports).
- Produces (used verbatim by Tasks 2–5):
  - `type Rgb = [number, number, number]`
  - `interface PdfTheme { primary: Rgb; accent: Rgb; tint: Rgb; tintStrong: Rgb }`
  - `hexToRgb(hex: string): Rgb | null`
  - `rgbToHex(rgb: Rgb): string`
  - `mixWithWhite(rgb: Rgb, ratio: number): Rgb` — ratio = fraction of white mixed in (0 = unchanged, 1 = white)
  - `shade(rgb: Rgb, ratio: number): Rgb` — ratio = fraction darkened (0 = unchanged, 1 = black)
  - `derivePdfTheme(primary: number[] | undefined): PdfTheme` — undefined/short arrays fall back to `[71, 85, 105]` per channel
  - `fitText(text: string, maxWidth: number, measure: (s: string) => number): string` — returns `text` untouched if it fits, else longest prefix + `'...'` that fits

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/pdf-theme.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hexToRgb,
  rgbToHex,
  mixWithWhite,
  shade,
  derivePdfTheme,
  fitText,
} from "./pdf-theme";

test("hexToRgb parses 6-digit, 3-digit, and rejects junk", () => {
  assert.deepEqual(hexToRgb("#019ebd"), [1, 158, 189]);
  assert.deepEqual(hexToRgb("019ebd"), [1, 158, 189]);
  assert.deepEqual(hexToRgb("#fff"), [255, 255, 255]);
  assert.equal(hexToRgb("not-a-color"), null);
  assert.equal(hexToRgb("#12345"), null);
});

test("rgbToHex round-trips and clamps", () => {
  assert.equal(rgbToHex([1, 158, 189]), "#019ebd");
  assert.equal(rgbToHex([300, -5, 0]), "#ff0000");
});

test("mixWithWhite lightens toward white", () => {
  assert.deepEqual(mixWithWhite([0, 0, 0], 1), [255, 255, 255]);
  assert.deepEqual(mixWithWhite([100, 100, 100], 0), [100, 100, 100]);
  assert.deepEqual(mixWithWhite([0, 100, 200], 0.5), [128, 178, 228]);
});

test("shade darkens toward black", () => {
  assert.deepEqual(shade([200, 100, 50], 0), [200, 100, 50]);
  assert.deepEqual(shade([200, 100, 50], 1), [0, 0, 0]);
  assert.deepEqual(shade([200, 100, 50], 0.5), [100, 50, 25]);
});

test("derivePdfTheme builds palette from primary", () => {
  const t = derivePdfTheme([1, 158, 189]);
  assert.deepEqual(t.primary, [1, 158, 189]);
  assert.deepEqual(t.accent, shade([1, 158, 189], 0.2));
  assert.deepEqual(t.tint, mixWithWhite([1, 158, 189], 0.94));
  assert.deepEqual(t.tintStrong, mixWithWhite([1, 158, 189], 0.85));
});

test("derivePdfTheme falls back to neutral slate per missing channel", () => {
  assert.deepEqual(derivePdfTheme(undefined).primary, [71, 85, 105]);
  assert.deepEqual(derivePdfTheme([]).primary, [71, 85, 105]);
  assert.deepEqual(derivePdfTheme([10]).primary, [10, 85, 105]);
});

test("fitText returns short text unchanged", () => {
  const measure = (s: string) => s.length;
  assert.equal(fitText("hello", 10, measure), "hello");
});

test("fitText truncates with ellipsis to fit maxWidth", () => {
  const measure = (s: string) => s.length; // 1 unit per char
  // budget 10 => longest prefix p with len(p) + 3 <= 10 => 7 chars
  assert.equal(fitText("abcdefghijklmno", 10, measure), "abcdefg...");
});

test("fitText trims trailing whitespace before ellipsis", () => {
  const measure = (s: string) => s.length;
  assert.equal(fitText("abcd  efghijklm", 9, measure), "abcd...");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module` (or ERR_MODULE_NOT_FOUND) for `./pdf-theme` from `pdf-theme.test.ts`.

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/pdf-theme.ts`:

```ts
// Shared color-derivation and text-fitting helpers for the two client-side
// jsPDF generators. Pure module: no jsPDF, no DOM, no asset imports — it must
// stay loadable under the node:test runner.

export type Rgb = [number, number, number];

export interface PdfTheme {
  /** Tenant primary — header bands, section titles, table header fills. */
  primary: Rgb;
  /** Darker primary — section header bars, outlines. */
  accent: Rgb;
  /** Near-white primary tint — page backgrounds. */
  tint: Rgb;
  /** Stronger tint — table header fills, highlighted rows. */
  tintStrong: Rgb;
}

const NEUTRAL_PRIMARY: Rgb = [71, 85, 105];

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

export function hexToRgb(hex: string): Rgb | null {
  if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return null;
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
  ];
}

export function rgbToHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => clampChannel(c).toString(16).padStart(2, "0")).join("");
}

export function mixWithWhite(rgb: Rgb, ratio: number): Rgb {
  return rgb.map((c) => clampChannel(c * (1 - ratio) + 255 * ratio)) as Rgb;
}

export function shade(rgb: Rgb, ratio: number): Rgb {
  return rgb.map((c) => clampChannel(c * (1 - ratio))) as Rgb;
}

export function derivePdfTheme(primary: number[] | undefined): PdfTheme {
  const p: Rgb = [
    clampChannel(primary?.[0] ?? NEUTRAL_PRIMARY[0]),
    clampChannel(primary?.[1] ?? NEUTRAL_PRIMARY[1]),
    clampChannel(primary?.[2] ?? NEUTRAL_PRIMARY[2]),
  ];
  return {
    primary: p,
    accent: shade(p, 0.2),
    tint: mixWithWhite(p, 0.94),
    tintStrong: mixWithWhite(p, 0.85),
  };
}

export function fitText(
  text: string,
  maxWidth: number,
  measure: (s: string) => number,
): string {
  if (measure(text) <= maxWidth) return text;
  const ellipsis = "...";
  let t = text;
  while (t.length > 1 && measure(t.trimEnd() + ellipsis) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t.trimEnd() + ellipsis;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all new `pdf-theme` tests green, existing suite unchanged.

- [ ] **Step 5: Type check and commit**

Run: `npm run check && npm test && npm run build`
Expected: all green.

```bash
git add client/src/utils/pdf-theme.ts client/src/utils/pdf-theme.test.ts
git commit -m "feat(pdf): pure pdf-theme module (palette derivation + fitText)"
```

---

### Task 2: Quiz PDF — tenant colors, non-overlapping header, drawn checkmark

**Files:**
- Modify: `client/src/utils/quiz-pdf-generator.ts`

**Interfaces:**
- Consumes from Task 1: `derivePdfTheme`, `fitText`, `rgbToHex`, `type PdfTheme` from `./pdf-theme`.
- Produces: no new exports — `QuizPDFGenerator` / `generateQuizPDF` signatures unchanged (call site `client/src/pages/quiz-pdf.tsx:48` keeps working untouched).

**Context (the bug being fixed):** today `addLogo()` draws the logo top-right at y=20, `addQRCode()` draws a 30mm QR at x=20/y=20, and `addHeader()` then draws the title and description starting at x=20/y=20 — directly on top of the QR code. Also every accent is hardcoded teal `(1,158,189)` and the `✓` character renders as a broken glyph (WinAnsi helvetica has no U+2713).

- [ ] **Step 1: Add theme member and imports**

At the top of `client/src/utils/quiz-pdf-generator.ts`, replace:

```ts
import type { PdfBranding } from "./enhanced-pdf-generator";
```

with:

```ts
import type { PdfBranding } from "./enhanced-pdf-generator";
import { derivePdfTheme, fitText, rgbToHex, type PdfTheme } from "./pdf-theme";
```

In the class, add a member below `private currentPage: number = 1;`:

```ts
  private theme: PdfTheme;
```

and at the end of the constructor (after the landscape margin block):

```ts
    this.theme = derivePdfTheme(options.branding?.primaryColor);
```

- [ ] **Step 2: Replace logo loading with a data-URL loader**

Replace the entire `addLogo()` method with a loader that returns the data URL instead of drawing (the header will place it):

```ts
  private loadLogoDataUrl(): Promise<string | undefined> {
    return new Promise((resolve) => {
      const source = this.options.branding?.logoDataUrl || logo;
      if (source.startsWith("data:")) {
        resolve(source);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
          canvas.width = img.width;
          canvas.height = img.height;
          ctx?.drawImage(img, 0, 0);
          try {
            resolve(canvas.toDataURL("image/png", 0.8));
          } catch (error) {
            console.warn("Could not convert logo for PDF:", error);
            resolve(undefined);
          }
        };
        img.onerror = () => resolve(undefined);
        img.src = source;
      } catch (error) {
        console.warn("Logo processing failed:", error);
        resolve(undefined);
      }
    });
  }
```

- [ ] **Step 3: Rebuild the header as a tenant-colored band**

Replace the entire `addHeader()` method with:

```ts
  private async addHeader(): Promise<void> {
    const bandHeight = 40;
    const [pr, pg, pb] = this.theme.primary;

    // Brand band across the full page width
    this.pdf.setFillColor(pr, pg, pb);
    this.pdf.rect(0, 0, this.pageWidth, bandHeight, "F");

    // Logo on the right, vertically centered inside the band
    const logoWidth = 24;
    const logoHeight = 19;
    const logoX = this.pageWidth - this.rightMargin - logoWidth;
    const logoDataUrl = await this.loadLogoDataUrl();
    if (logoDataUrl) {
      try {
        this.pdf.addImage(logoDataUrl, "PNG", logoX, (bandHeight - logoHeight) / 2, logoWidth, logoHeight);
      } catch (error) {
        console.warn("Could not add logo to PDF:", error);
      }
    }

    // Title on the left, wrapped to stop before the logo, max 2 lines
    const titleMaxWidth = this.pageWidth - this.leftMargin - this.rightMargin - logoWidth - 8;
    this.pdf.setFontSize(20);
    this.pdf.setFont("helvetica", "bold");
    this.pdf.setTextColor(255, 255, 255);
    let titleLines: string[] = this.pdf.splitTextToSize(this.quiz.title, titleMaxWidth);
    if (titleLines.length > 2) {
      titleLines = [
        titleLines[0],
        fitText(titleLines.slice(1).join(" "), titleMaxWidth, (s) => this.pdf.getTextWidth(s)),
      ];
    }
    const titleY = titleLines.length > 1 ? 15 : 19;
    titleLines.forEach((line, i) => {
      this.pdf.text(line, this.leftMargin, titleY + i * 9);
    });

    // Subtitle inside the band
    const questionCount = (this.quiz.questions as any[]).length;
    const creationDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    this.pdf.setFontSize(10);
    this.pdf.setFont("helvetica", "normal");
    this.pdf.text(`${questionCount} questions  |  ${creationDate}`, this.leftMargin, bandHeight - 6);

    this.yPosition = bandHeight + 12;
  }
```

- [ ] **Step 4: Move description + QR into a shared, non-overlapping intro row**

Replace the entire `addQRCode()` method with:

```ts
  private async addIntroSection(): Promise<void> {
    const qrSize = 30;
    const hasQR = !!this.options.includeQRCode;
    const startY = this.yPosition;
    let textBottom = startY;
    let qrBottom = startY;

    // Description wraps in the space left of the QR column
    const textWidth = this.pageWidth - this.leftMargin - this.rightMargin - (hasQR ? qrSize + 10 : 0);
    if (this.quiz.description && this.quiz.description.trim()) {
      this.pdf.setFontSize(11);
      this.pdf.setFont("helvetica", "normal");
      this.pdf.setTextColor(80, 80, 80);
      const lines: string[] = this.pdf.splitTextToSize(this.quiz.description, textWidth);
      lines.forEach((line, i) => {
        this.pdf.text(line, this.leftMargin, startY + i * 6);
      });
      textBottom = startY + lines.length * 6;
    }

    if (hasQR) {
      try {
        const quizUrl = `${window.location.origin}/quiz/${this.quiz.id}`;
        const qrCodeDataUrl = await QRCode.toDataURL(quizUrl, {
          width: 200,
          margin: 2,
          color: { dark: rgbToHex(this.theme.primary), light: "#ffffff" },
        });
        const qrX = this.pageWidth - this.rightMargin - qrSize;
        const qrY = startY - 4;
        this.pdf.addImage(qrCodeDataUrl, "PNG", qrX, qrY, qrSize, qrSize);
        this.pdf.setFontSize(8);
        this.pdf.setFont("helvetica", "normal");
        this.pdf.setTextColor(100, 100, 100);
        this.pdf.text("Scan to open quiz", qrX + qrSize / 2, qrY + qrSize + 4, { align: "center" });
        qrBottom = qrY + qrSize + 6;
      } catch (error) {
        console.warn("Could not generate QR code:", error);
      }
    }

    this.yPosition = Math.max(textBottom, qrBottom) + 4;

    // Separator line
    const [pr, pg, pb] = this.theme.primary;
    this.pdf.setDrawColor(pr, pg, pb);
    this.pdf.setLineWidth(1);
    this.pdf.line(this.leftMargin, this.yPosition, this.pageWidth - this.rightMargin, this.yPosition);
    this.yPosition += 12;
  }
```

- [ ] **Step 5: Wire the new flow in `generatePDF`**

Replace the body of `generatePDF()` with:

```ts
  public async generatePDF(): Promise<jsPDF> {
    await this.addHeader();
    await this.addIntroSection();
    this.addQuestionSection();
    this.addAnswerKey();
    this.addFooter();
    return this.pdf;
  }
```

- [ ] **Step 6: Replace every hardcoded teal with the theme**

Apply these exact substitutions (all other code in each method unchanged):

- `addFooter()` line `this.pdf.setDrawColor(1, 158, 189);` → 
  ```ts
  this.pdf.setDrawColor(this.theme.primary[0], this.theme.primary[1], this.theme.primary[2]);
  ```
- `addQuestionSection()` line `this.pdf.setTextColor(1, 158, 189);` (under "Section header") → 
  ```ts
  this.pdf.setTextColor(this.theme.primary[0], this.theme.primary[1], this.theme.primary[2]);
  ```
- `addAnswerKey()` line `this.pdf.setTextColor(1, 158, 189);` → same replacement as above.
- `addAnswerKey()` table-header fill `this.pdf.setFillColor(240, 248, 255);` → 
  ```ts
  this.pdf.setFillColor(this.theme.tintStrong[0], this.theme.tintStrong[1], this.theme.tintStrong[2]);
  ```

- [ ] **Step 7: Replace the `✓` glyph with a drawn checkmark**

Add this method to the class:

```ts
  private drawCheck(x: number, y: number): void {
    this.pdf.setDrawColor(0, 120, 0);
    this.pdf.setLineWidth(0.9);
    this.pdf.line(x, y - 1.6, x + 1.2, y - 0.2);
    this.pdf.line(x + 1.2, y - 0.2, x + 3.4, y - 3.4);
  }
```

In `addQuestionSection()`, replace:

```ts
        if (isCorrect && this.options.includeAnswerKey !== false) {
          // Highlight correct answer
          this.pdf.setFont('helvetica', 'bold');
          this.pdf.setTextColor(0, 120, 0); // Green color
          this.pdf.text('✓', this.leftMargin, this.yPosition);
        } else {
```

with:

```ts
        if (isCorrect && this.options.includeAnswerKey !== false) {
          this.drawCheck(this.leftMargin, this.yPosition);
          this.pdf.setFont('helvetica', 'bold');
          this.pdf.setTextColor(0, 120, 0);
        } else {
```

- [ ] **Step 8: Verify and commit**

Run: `npm run check && npm test && npm run build`
Expected: all green (this file has no unit tests; tsc + build are the gate here).

```bash
git add client/src/utils/quiz-pdf-generator.ts
git commit -m "feat(pdf): quiz PDF tenant colors + non-overlapping header band + drawn checkmark"
```

---

### Task 3: Report PDF — tenant theming, CMYK overlay bug, header/footer cleanup

**Files:**
- Modify: `client/src/utils/enhanced-pdf-generator.ts`

**Interfaces:**
- Consumes from Task 1: `derivePdfTheme`, `fitText`, `hexToRgb`, `type Rgb` from `./pdf-theme`.
- Produces: `generateEnhancedPDF(data, branding?)` signature unchanged; `export interface PdfBranding` stays in this file (Task 2 and `tenant.tsx` import it from here). The local `hexToRgb` function is deleted in favor of the shared one.

**Context (the bugs being fixed):** (a) tenant `primaryColor` is set as the default but then overridden by the background-keyed palette map — the default background `classroom` maps to steel blue, so nearly every report silently loses tenant branding; (b) `pdf.setFillColor(255, 255, 255, 0.90)` is interpreted as **CMYK** ≈ near-black, so custom-image-background reports get a dark smear instead of a white wash; (c) a long tenant `headerText` overflows the logo area.

- [ ] **Step 1: Swap imports and delete the local `hexToRgb`**

Replace:

```ts
import jsPDF from 'jspdf';
import logo from "@assets/ABRJ.OM - Copy_1753146533010.png";
import { resolveQuizTheme } from "@shared/quiz-theme";

function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) return null;
  const m = hex.replace("#", "");
  const n = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}
```

with:

```ts
import jsPDF from 'jspdf';
import logo from "@assets/ABRJ.OM - Copy_1753146533010.png";
import { resolveQuizTheme } from "@shared/quiz-theme";
import { derivePdfTheme, fitText, hexToRgb, shade, type Rgb } from "./pdf-theme";
```

- [ ] **Step 2: Replace the theme-selection block with tenant derivation**

Replace everything from `// Determine theme based on quiz background` down to (and including) the `if (hasCustomTheme) { ... }` block (currently lines 45–84) with:

```ts
  // Tenant-derived palette. The quiz `background` no longer picks colors —
  // branding always comes from the tenant unless the quiz has an explicit
  // custom theme (see below).
  const derived = derivePdfTheme(branding?.primaryColor);
  let currentTheme: ThemeColors = {
    primary: derived.primary,
    secondary: derived.tint,
    accent: derived.accent,
  };
  const quizBackground = game.quiz?.background || 'classroom';

  // Override the primary with the quiz's resolved theme accent, but ONLY when
  // the quiz has an explicit custom theme object. Un-themed quizzes (the vast
  // majority — pre-existing quizzes and any quiz created without opening the
  // theme builder) must keep the tenant-branded primary set above;
  // resolveQuizTheme() falls back to the default teal accent when quiz.theme
  // is absent, and unconditionally applying that would override every
  // tenant's branding with teal.
  const hasCustomTheme = !!(game.quiz && (game.quiz as any).theme && typeof (game.quiz as any).theme === "object");
  if (hasCustomTheme) {
    const accentRgb = hexToRgb(resolveQuizTheme(game.quiz ?? {}).accent);
    if (accentRgb) {
      currentTheme = {
        primary: accentRgb,
        secondary: derivePdfTheme(accentRgb).tint,
        accent: derivePdfTheme(accentRgb).accent,
      };
    }
  }
```

And change the `ThemeColors` interface (drop the now-unused `name`):

```ts
interface ThemeColors {
  primary: [number, number, number];
  secondary: [number, number, number];
  accent: [number, number, number];
}
```

- [ ] **Step 3: Fix the CMYK overlay bug in `applyBackground`**

Inside `applyBackground`, replace:

```ts
        pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
        pdf.setFillColor(255, 255, 255, 0.90);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
```

with:

```ts
        pdf.addImage(quizBackground, 'JPEG', 0, 0, pageWidth, pageHeight);
        pdf.setGState(pdf.GState({ opacity: 0.9 }));
        pdf.setFillColor(255, 255, 255);
        pdf.rect(0, 0, pageWidth, pageHeight, 'F');
        pdf.setGState(pdf.GState({ opacity: 1 }));
```

- [ ] **Step 4: Fit the header title and drop the theme name from subtitle/footer**

Replace:

```ts
  pdf.setFontSize(30);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  pdf.text(branding?.headerText ?? 'ABRAJ QUIZ COMPLETE REPORT', pageWidth / 2, yPosition + 16, { align: 'center' });
  
  // Subtitle
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`${currentTheme.name} • Generated ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition + 26, { align: 'center' });
```

with:

```ts
  pdf.setFontSize(30);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(255, 255, 255);
  const headerTitle = fitText(
    branding?.headerText ?? 'QUIZ COMPLETE REPORT',
    pageWidth - 130,
    (s) => pdf.getTextWidth(s),
  );
  pdf.text(headerTitle, pageWidth / 2, yPosition + 16, { align: 'center' });

  // Subtitle
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  pdf.text(`Generated ${new Date().toLocaleDateString()}`, pageWidth / 2, yPosition + 26, { align: 'center' });
```

In the footer, replace:

```ts
  pdf.text(`Generated by ${branding?.appName ?? 'Abraj Quiz'} System - ${currentTheme.name}`, 25, yPosition + 6);
```

with:

```ts
  pdf.text(`Generated by ${branding?.appName ?? 'Abraj Quiz'}`, 25, yPosition + 6);
```

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm test && npm run build`
Expected: all green. `tsc` will also catch any remaining reference to the removed `ThemeColors.name` or old `themes` map — there must be none.

```bash
git add client/src/utils/enhanced-pdf-generator.ts
git commit -m "fix(pdf): report uses tenant palette (no background override), fix CMYK white-wash bug"
```

---

### Task 4: Report PDF — overflow-proof long titles, descriptions, and player names

**Files:**
- Modify: `client/src/utils/enhanced-pdf-generator.ts`

**Interfaces:**
- Consumes: `fitText` from `./pdf-theme` (imported in Task 3); jsPDF's `getTextWidth` (measures at the currently set font size — always set font/size BEFORE calling `fitText` with it).
- Produces: no signature changes.

**Context:** player names and the quiz title are drawn at fixed x-positions with no width limit — a long name overflows into the FINAL SCORE column and off podium cards; a long description is measured at a different width (`pageWidth - 90`) than it needs and is uncapped, growing the card unboundedly.

- [ ] **Step 1: Add a shared measure helper**

Immediately after `const pageHeight = pdf.internal.pageSize.getHeight();`, add:

```ts
  const measure = (s: string) => pdf.getTextWidth(s);
```

- [ ] **Step 2: Cap the quiz description at 3 lines and reuse one computation**

Replace the pre-card measurement block:

```ts
  let descriptionLines = 0;
  if (game.quiz?.description) {
    const tempDescLines = pdf.splitTextToSize(game.quiz.description, pageWidth - 90);
    descriptionLines = tempDescLines.length;
  }
  const quizCardHeight = 55 + (descriptionLines > 0 ? (descriptionLines - 1) * 5 : 0);
```

with:

```ts
  pdf.setFontSize(11);
  pdf.setFont('helvetica', 'normal');
  let descLines: string[] = [];
  if (game.quiz?.description) {
    const descWidth = pageWidth - 108; // text starts at x=78, card right edge minus padding
    descLines = pdf.splitTextToSize(game.quiz.description, descWidth);
    if (descLines.length > 3) {
      descLines = descLines.slice(0, 3);
      descLines[2] = fitText(descLines[2] + ' ...', descWidth, measure);
    }
  }
  const quizCardHeight = 55 + (descLines.length > 0 ? (descLines.length - 1) * 5 : 0);
```

Then in the card body, replace the description-rendering block:

```ts
  if (game.quiz?.description) {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 100, 100);
    pdf.text('Description:', 30, quizInfoY + quizInfoOffset);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(60, 60, 60);
    const descLines = pdf.splitTextToSize(game.quiz.description, pageWidth - 90);
    pdf.text(descLines, 78, quizInfoY + quizInfoOffset);
    // Account for description height
    quizInfoOffset += descLines.length * 5;
  }
```

with:

```ts
  if (descLines.length > 0) {
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(100, 100, 100);
    pdf.text('Description:', 30, quizInfoY + quizInfoOffset);
    pdf.setTextColor(60, 60, 60);
    pdf.text(descLines, 78, quizInfoY + quizInfoOffset);
    quizInfoOffset += descLines.length * 5;
  }
```

- [ ] **Step 3: Truncate the quiz title inside the details card**

Replace:

```ts
  pdf.text(game.quiz?.title || 'Untitled Quiz', 60, quizInfoY);
```

with (the bold 11pt font is already set by the preceding lines):

```ts
  pdf.text(fitText(game.quiz?.title || 'Untitled Quiz', pageWidth / 2 - 60, measure), 60, quizInfoY);
```

- [ ] **Step 4: Truncate podium player names**

In the 1st-place card, replace:

```ts
    pdf.text(sortedPlayers[0].name, pageWidth / 2, yPosition + 22, { align: 'center' });
```

with:

```ts
    pdf.text(fitText(sortedPlayers[0].name, 120, measure), pageWidth / 2, yPosition + 22, { align: 'center' });
```

In the 2nd-place card, replace:

```ts
      pdf.text(secondPlace.name, 45, yPosition + 17);
```

with:

```ts
      pdf.text(fitText(secondPlace.name, (pageWidth / 2) - 78, measure), 45, yPosition + 17);
```

In the 3rd-place card, replace:

```ts
        pdf.text(thirdPlace.name, pageWidth / 2 + 25, yPosition + 17);
```

with:

```ts
        pdf.text(fitText(thirdPlace.name, (pageWidth / 2) - 78, measure), pageWidth / 2 + 25, yPosition + 17);
```

- [ ] **Step 5: Truncate rankings-table names and the fastest-player label**

In the rankings row loop, replace:

```ts
    pdf.text(player.name, 75, yPosition + 5);
```

with (name column runs x=75 to the score column at x=175):

```ts
    pdf.text(fitText(player.name, 95, measure), 75, yPosition + 5);
```

In the per-question analytics, replace:

```ts
        pdf.text(`Fastest: ${fastestPlayerName}`, pageWidth - 120, analyticsY + 5);
```

with (label runs from x = pageWidth-120 to the card edge at pageWidth-57):

```ts
        pdf.text(fitText(`Fastest: ${fastestPlayerName}`, 60, measure), pageWidth - 120, analyticsY + 5);
```

- [ ] **Step 6: Verify and commit**

Run: `npm run check && npm test && npm run build`
Expected: all green. Note: with the 3-line description cap, the details card maxes out at 65mm and always fits below the 45mm header on page 1 — no page-break handling needed.

```bash
git add client/src/utils/enhanced-pdf-generator.ts
git commit -m "fix(pdf): report survives long titles, descriptions, and player names"
```

---

### Task 5: Report PDF — vector medal icons for top 3 + aligned card insets

**Files:**
- Modify: `client/src/utils/enhanced-pdf-generator.ts`

**Interfaces:**
- Consumes: `shade`, `type Rgb` from `./pdf-theme` (imported in Task 3); jsPDF primitives `circle(x, y, r, style)` and `triangle(x1, y1, x2, y2, x3, y3, style)`.
- Produces: a local `drawMedal` closure (not exported).

- [ ] **Step 1: Add the medal-drawing helper**

Immediately after the `measure` helper added in Task 4, add:

```ts
  // Vector medal: two ribbon strands + a colored disc with the rank number.
  // Drawn with primitives because WinAnsi helvetica has no medal/trophy glyphs.
  const drawMedal = (x: number, y: number, r: number, color: Rgb, rank: string) => {
    const dark = shade(color, 0.3);
    pdf.setFillColor(dark[0], dark[1], dark[2]);
    pdf.triangle(x - r * 0.7, y - r - r * 0.6, x - r * 0.1, y - r - r * 0.6, x - r * 0.3, y - r * 0.4, 'F');
    pdf.triangle(x + r * 0.7, y - r - r * 0.6, x + r * 0.1, y - r - r * 0.6, x + r * 0.3, y - r * 0.4, 'F');
    pdf.setDrawColor(dark[0], dark[1], dark[2]);
    pdf.setLineWidth(0.5);
    pdf.setFillColor(color[0], color[1], color[2]);
    pdf.circle(x, y, r, 'FD');
    pdf.setFontSize(r * 2.6);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(255, 255, 255);
    pdf.text(rank, x, y + r * 0.35, { align: 'center' });
  };
```

- [ ] **Step 2: Place medals on the three podium cards**

In the 1st-place card, immediately after the gold accent-bar block (the `pdf.rect(pageWidth / 2 - 70, yPosition + 3, 140, 3, 'F');` line), add:

```ts
    drawMedal(pageWidth / 2 - 58, yPosition + 19, 7, [218, 165, 32], '1');
```

In the 2nd-place card, after its accent-bar block (`pdf.rect(40, yPosition + 2.5, ...)` line), add:

```ts
      drawMedal(50, yPosition + 14, 5.5, [169, 169, 169], '2');
```

and shift its three text lines right — replace x-coordinate `45` with `60` in the `'2ND PLACE'`, name, and points `pdf.text(...)` calls.

In the 3rd-place card, after its accent-bar block, add:

```ts
        drawMedal(pageWidth / 2 + 30, yPosition + 14, 5.5, [205, 127, 50], '3');
```

and shift its three text lines right — replace x-coordinate `pageWidth / 2 + 25` with `pageWidth / 2 + 40` in the `'3RD PLACE'`, name, and points `pdf.text(...)` calls. (The Task 4 name truncation widths already leave room for this shift.)

- [ ] **Step 3: Add small medal discs to the top-3 rankings rows**

In the rankings row loop, inside the existing `if (index < 3) { ... }` styling block, at its end (after the bronze `setTextColor`), add:

```ts
      const medalColors: Rgb[] = [[218, 165, 32], [169, 169, 169], [205, 127, 50]];
      drawMedal(28, yPosition + 3.5, 2.5, medalColors[index], '');
      pdf.setFontSize(10);
      pdf.setFont('helvetica', 'bold');
```

(The empty rank string keeps the disc clean at this size; re-setting font size/family is required because `drawMedal` changes them.)

Then re-apply the row text color after the medal, since `drawMedal` sets white text — replace:

```ts
    pdf.text(`#${index + 1}`, 32, yPosition + 5);
```

with:

```ts
    if (index === 0) pdf.setTextColor(218, 165, 32);
    else if (index === 1) pdf.setTextColor(169, 169, 169);
    else if (index === 2) pdf.setTextColor(205, 127, 50);
    else pdf.setTextColor(80, 80, 80);
    pdf.text(`#${index + 1}`, 32, yPosition + 5);
```

- [ ] **Step 4: Align the quiz-details card to the shared 25mm inset**

Every other block (question cards, section headers, rankings table, footer rule) sits at x=25; the details card alone sits at x=20. Replace the card's three shape calls:

```ts
  pdf.roundedRect(20, yPosition, pageWidth - 40, quizCardHeight, 4, 4, 'FD');
```
→
```ts
  pdf.roundedRect(25, yPosition, pageWidth - 50, quizCardHeight, 4, 4, 'FD');
```

```ts
  pdf.roundedRect(20.5, yPosition + 0.5, pageWidth - 40, quizCardHeight, 4, 4, 'F');
```
→
```ts
  pdf.roundedRect(25.5, yPosition + 0.5, pageWidth - 50, quizCardHeight, 4, 4, 'F');
```

```ts
  pdf.roundedRect(20, yPosition, pageWidth - 40, 12, 4, 4, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(20, yPosition + 8, pageWidth - 40, 4, 'F');
```
→
```ts
  pdf.roundedRect(25, yPosition, pageWidth - 50, 12, 4, 4, 'F');
  pdf.setFillColor(255, 255, 255);
  pdf.rect(25, yPosition + 8, pageWidth - 50, 4, 'F');
```

The card's inner text x-coordinates (30, 60, 78, `pageWidth / 2 + 10`, etc.) stay as they are — they remain inside the moved card.

- [ ] **Step 5: Verify and commit**

Run: `npm run check && npm test && npm run build`
Expected: all green.

```bash
git add client/src/utils/enhanced-pdf-generator.ts
git commit -m "feat(pdf): vector medals for top-3 podium and rankings, align details card inset"
```

---

### Task 6: Full gate + manual browser QA

**Files:**
- None created/modified (verification only; fixes found here are follow-up commits on the same branch).

**Interfaces:**
- Consumes: everything above via the running app.
- Produces: verified PDFs; QA notes for the PR description.

- [ ] **Step 1: Run the full gate**

Run: `npm run check && npm test && npm run build`
Expected: tsc clean, full test suite green (including the new `pdf-theme` tests), build succeeds.

- [ ] **Step 2: Manual QA — Quiz PDF**

Start the app (`npm run dev`), open a quiz's PDF page (`/quiz-pdf/<id>` via the editor's PDF button), and generate PDFs to verify:

1. Header band uses the tenant primary color; logo sits right, title left — **no overlap** between QR, logo, title, or description (test with a quiz that has a long title AND a long description, QR enabled).
2. QR code renders in the tenant primary color and its caption is centered beneath it.
3. Correct answers show a clean drawn green checkmark (no `%` or broken glyph).
4. Answer-key table header fill is a light tint of the tenant primary.
5. Repeat with QR disabled — description spans full width, no gap artifacts.

- [ ] **Step 3: Manual QA — Report PDF**

Complete (or open an existing completed) game and click "Download PDF Report" on `/results/<pin>` to verify:

1. Header band, section titles, and table header use the tenant primary (an un-themed quiz on the PDO tenant must NOT come out steel-blue/teal).
2. A quiz WITH a custom theme (set via the editor's theme builder) uses that theme's accent instead — the preserved invariant.
3. Long player name (join a game with a ~40-char nickname) is ellipsized in the podium card and rankings table without colliding with the score column.
4. Long quiz description caps at 3 lines inside the details card; card height stays correct.
5. Top-3 podium cards show gold/silver/bronze medals with rank numbers; rankings rows 1–3 show small medal discs.
6. A quiz with a custom image background gets a light white wash over the image (not a near-black smear).
7. Arabic tenant (PDO): Arabic titles/names render as jsPDF's helvetica cannot shape Arabic — confirm behavior is no worse than before this change (pre-existing limitation, out of scope; note anything alarming in the PR).

- [ ] **Step 4: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to wrap up (PR to `main` per repo convention).

---

## Self-Review

- **Spec coverage:** tenant-themed layout/colors for both PDFs → Tasks 1–3; quiz-PDF header/QR overlap → Task 2; report long-description/name resilience → Task 4; 1st/2nd/3rd icons + section alignment + spacing → Task 5; "check the issue with Download PDF Report" → the CMYK near-black overlay and the background-palette override are the two real defects found, fixed in Task 3 and verified in Task 6.
- **Placeholder scan:** every code step contains the literal code; QA steps list concrete scenarios. No TBDs.
- **Type consistency:** `Rgb`/`PdfTheme`/`fitText(text, maxWidth, measure)` defined in Task 1 and used with identical signatures in Tasks 2–5; `ThemeColors.name` removal (Task 3) is matched by the subtitle/footer rewrites in the same task; `drawMedal` is defined in Task 5 before both use sites.
