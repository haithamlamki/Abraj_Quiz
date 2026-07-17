import test from "node:test";
import assert from "node:assert/strict";

const { resolveLanguage } = await import("./language");
// Key-parity check reads the locale JSON directly — no DOM needed.
const en = (await import("../locales/en.json", { with: { type: "json" } })).default;
const ar = (await import("../locales/ar.json", { with: { type: "json" } })).default;

test("resolveLanguage: stored override wins, tenant default second, en last", () => {
  assert.equal(resolveLanguage("ar", "en"), "ar");
  assert.equal(resolveLanguage("en", "ar"), "en");
  assert.equal(resolveLanguage(null, "ar"), "ar");
  assert.equal(resolveLanguage(null, "en"), "en");
  assert.equal(resolveLanguage(null, undefined), "en");
});

test("resolveLanguage: garbage values fall through", () => {
  assert.equal(resolveLanguage("fr", "ar"), "ar");
  assert.equal(resolveLanguage("banana", undefined), "en");
  assert.equal(resolveLanguage(null, "de"), "en");
});

function flatKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object" ? flatKeys(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test("locale files have identical key sets (en ↔ ar parity)", () => {
  const enKeys = flatKeys(en).sort();
  const arKeys = flatKeys(ar).sort();
  assert.deepEqual(arKeys, enKeys);
  assert.ok(enKeys.length > 0, "locales must not be empty");
});

test("no Arabic value is left identical to its English source (untranslated placeholder guard)", () => {
  const flatten = (o: Record<string, unknown>, p = ""): Array<[string, string]> =>
    Object.entries(o).flatMap(([k, v]) =>
      v !== null && typeof v === "object" ? flatten(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)]],
    );
  const enMap = new Map(flatten(en));
  const identical = flatten(ar).filter(([k, v]) => enMap.get(k) === v && v.length > 3 && !/^\{\{.*\}\}$/.test(v));
  assert.deepEqual(identical.map(([k]) => k), []);
});
