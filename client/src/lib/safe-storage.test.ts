import test from "node:test";
import assert from "node:assert/strict";

// Stub window BEFORE importing the module under test. `storageBlocked`
// simulates the browsers behind Sentry ABRAJ-QUIZ-CLIENT-B, where merely
// touching the localStorage getter throws a SecurityError.
let storageBlocked = false;
const realStore = new Map<string, string>();
const workingStorage = {
  getItem: (k: string) => realStore.get(k) ?? null,
  setItem: (k: string, v: string) => void realStore.set(k, v),
  removeItem: (k: string) => void realStore.delete(k),
};
(globalThis as any).window = {
  get localStorage() {
    if (storageBlocked) throw new DOMException("Access is denied for this document.", "SecurityError");
    return workingStorage;
  },
  get sessionStorage() {
    if (storageBlocked) throw new DOMException("Access is denied for this document.", "SecurityError");
    return workingStorage;
  },
  location: { reload() {} },
};

const { safeLocalStorage, safeSessionStorage } = await import("./safe-storage");

test("passes through to real storage when available", () => {
  storageBlocked = false;
  safeLocalStorage.setItem("k", "v");
  assert.equal(realStore.get("k"), "v");
  assert.equal(safeLocalStorage.getItem("k"), "v");
  safeLocalStorage.removeItem("k");
  assert.equal(realStore.has("k"), false);
  assert.equal(safeLocalStorage.getItem("k"), null);
});

test("never throws when storage access is blocked; falls back to memory", () => {
  storageBlocked = true;
  // The unguarded equivalent of each of these throws SecurityError.
  assert.doesNotThrow(() => safeLocalStorage.setItem("lang", "ar"));
  assert.equal(safeLocalStorage.getItem("lang"), "ar"); // served from memory
  assert.doesNotThrow(() => safeLocalStorage.removeItem("lang"));
  assert.equal(safeLocalStorage.getItem("lang"), null);
  assert.doesNotThrow(() => safeSessionStorage.setItem("s", "1"));
  assert.equal(safeSessionStorage.getItem("s"), "1");
  storageBlocked = false;
});

test("memory fallback is isolated per storage kind", () => {
  storageBlocked = true;
  safeLocalStorage.setItem("dup", "local");
  safeSessionStorage.setItem("dup", "session");
  assert.equal(safeLocalStorage.getItem("dup"), "local");
  assert.equal(safeSessionStorage.getItem("dup"), "session");
  storageBlocked = false;
});

test("mid-session block: reads fall back without crashing", () => {
  storageBlocked = false;
  safeLocalStorage.setItem("pre", "1");
  storageBlocked = true;
  // Real storage has the value but is now unreachable — memory doesn't.
  // The contract is "never throw", not "never lose": expect null, no crash.
  assert.doesNotThrow(() => safeLocalStorage.getItem("pre"));
  assert.equal(safeLocalStorage.getItem("pre"), null);
  storageBlocked = false;
});
