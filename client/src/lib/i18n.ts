import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "@/locales/en.json";
import ar from "@/locales/ar.json";

// UI chrome only — quiz content (questions/answers/titles/names) is never
// passed through translation. Untranslated surfaces (editor/admin) fall back
// to the English bundle.
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: "en",              // real value applied once tenant config resolves
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  returnEmptyString: false,
});

export default i18n;
