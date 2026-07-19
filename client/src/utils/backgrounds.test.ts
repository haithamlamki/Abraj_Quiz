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
