import i18n from "i18next";

export type AppLanguage = "en" | "ar";
export const LANGUAGE_STORAGE_KEY = "app-language";

const VALID: ReadonlySet<string> = new Set(["en", "ar"]);

export function resolveLanguage(stored: string | null, tenantDefault: string | undefined): AppLanguage {
  if (stored && VALID.has(stored)) return stored as AppLanguage;
  if (tenantDefault && VALID.has(tenantDefault)) return tenantDefault as AppLanguage;
  return "en";
}

export function formatQuizDate(dateStr: string, lang: string): string {
  // "ar-u-nu-latn-ca-gregory" pins Western (Latin) numerals + the Gregorian
  // calendar for Arabic, matching what hosts read aloud elsewhere in the app
  // (scores/PINs/timers) — plain "ar" would default to Arabic-Indic digits.
  const locale = lang === "ar" ? "ar-u-nu-latn-ca-gregory" : "en-US";
  return new Date(dateStr).toLocaleDateString(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function applyLanguage(lang: AppLanguage, opts: { persist?: boolean } = {}): void {
  const { persist = true } = opts;
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  if (!persist) return;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // private mode — non-fatal
  }
}
