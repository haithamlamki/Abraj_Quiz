import i18n from "i18next";

export type AppLanguage = "en" | "ar";
export const LANGUAGE_STORAGE_KEY = "app-language";

const VALID: ReadonlySet<string> = new Set(["en", "ar"]);

export function resolveLanguage(stored: string | null, tenantDefault: string | undefined): AppLanguage {
  if (stored && VALID.has(stored)) return stored as AppLanguage;
  if (tenantDefault && VALID.has(tenantDefault)) return tenantDefault as AppLanguage;
  return "en";
}

export function applyLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // private mode — non-fatal
  }
}
