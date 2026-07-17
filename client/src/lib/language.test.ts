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

// i18next v4 JSON pluralization suffixes (CLDR plural categories). A key like
// "playersCount_few" belongs to the plural family whose base is "playersCount".
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function baseKey(key: string): string {
  return key.replace(PLURAL_SUFFIX, "");
}

test("locale files have identical base key sets (en ↔ ar parity, plural-suffix aware)", () => {
  const enKeys = flatKeys(en);
  const arKeys = flatKeys(ar);
  const enBaseKeys = new Set(enKeys.map(baseKey));
  const arBaseKeys = new Set(arKeys.map(baseKey));
  assert.deepEqual([...arBaseKeys].sort(), [...enBaseKeys].sort());
  assert.ok(enBaseKeys.size > 0, "locales must not be empty");
});

test("Arabic supplies full CLDR plural categories for every pluralized key; English has one/other", () => {
  // i18next v4 JSON does NOT fall back to `_other` within a language, so Arabic
  // (which has 6 CLDR plural categories) must define all of them explicitly.
  const enPluralFamilies = new Map<string, Set<string>>();
  for (const key of flatKeys(en)) {
    const m = key.match(PLURAL_SUFFIX);
    if (!m) continue;
    const base = baseKey(key);
    if (!enPluralFamilies.has(base)) enPluralFamilies.set(base, new Set());
    enPluralFamilies.get(base)!.add(m[1]);
  }

  const arPluralFamilies = new Map<string, Set<string>>();
  for (const key of flatKeys(ar)) {
    const m = key.match(PLURAL_SUFFIX);
    if (!m) continue;
    const base = baseKey(key);
    if (!arPluralFamilies.has(base)) arPluralFamilies.set(base, new Set());
    arPluralFamilies.get(base)!.add(m[1]);
  }

  assert.ok(enPluralFamilies.size > 0, "expected at least one pluralized key to check");
  assert.deepEqual([...enPluralFamilies.keys()].sort(), [...arPluralFamilies.keys()].sort());

  // en only needs the categories Intl.PluralRules("en") actually produces.
  const enExpectedCategories = new Set(new Intl.PluralRules("en").resolvedOptions().pluralCategories);
  const arExpectedCategories = new Set(["zero", "one", "two", "few", "many", "other"]);

  for (const [base, categories] of enPluralFamilies) {
    for (const expected of enExpectedCategories) {
      assert.ok(categories.has(expected), `en.${base} is missing plural category "${expected}"`);
    }
  }
  for (const [base, categories] of arPluralFamilies) {
    for (const expected of arExpectedCategories) {
      assert.ok(categories.has(expected), `ar.${base} is missing plural category "${expected}"`);
    }
  }
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
