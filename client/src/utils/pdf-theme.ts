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
