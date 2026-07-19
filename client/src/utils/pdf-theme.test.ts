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
