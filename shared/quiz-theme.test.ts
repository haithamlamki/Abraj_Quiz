import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveQuizTheme, themeToCssVars, DEFAULT_QUIZ_THEME, PRESET_QUIZ_THEMES } from "./quiz-theme";

test("resolves the default theme for a quiz with no theme and no background", () => {
  const t = resolveQuizTheme({});
  assert.equal(t.accent, DEFAULT_QUIZ_THEME.accent);
});

test("legacy quiz (background only, theme null) keeps its background", () => {
  const t = resolveQuizTheme({ background: "sunset", theme: null });
  assert.equal(t.background, "sunset");
});

test("custom theme overrides only the provided keys", () => {
  const t = resolveQuizTheme({ background: "aurora", theme: { accent: "#ff0000" } });
  assert.equal(t.accent, "#ff0000");
  assert.equal(t.background, "aurora"); // background still comes from the quiz field
  assert.equal(t.questionText, DEFAULT_QUIZ_THEME.questionText); // untouched key falls back
});

test("themeToCssVars emits the expected variable names", () => {
  const vars = themeToCssVars(DEFAULT_QUIZ_THEME);
  for (const key of ["--quiz-accent", "--quiz-question-text", "--quiz-question-card", "--quiz-font", "--quiz-card-radius", "--quiz-card-shadow"]) {
    assert.ok(key in vars, `missing ${key}`);
  }
});

test("every preset resolves to a full theme", () => {
  for (const p of PRESET_QUIZ_THEMES) {
    assert.ok(p.theme.accent && p.theme.questionText && p.theme.background);
  }
});
