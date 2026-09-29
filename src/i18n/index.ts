import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import fr from "./locales/fr";
import en from "./locales/en";
import ar from "./locales/ar";

let stored: string | null = null;
try { if (typeof window !== "undefined") stored = localStorage.getItem("lang"); } catch { /* Private browsing/storage blocks must not prevent the site or CMP from rendering. */ }
const lang = stored || "fr";

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en }, ar: { translation: ar } },
  lng: lang,
  fallbackLng: "fr",
  interpolation: { escapeValue: false },
});

if (typeof document !== "undefined") {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
}

export const setLang = (l: "fr" | "en" | "ar") => {
  i18n.changeLanguage(l);
  try { localStorage.setItem("lang", l); } catch { /* Language still works for this page view. */ }
  document.documentElement.lang = l;
  document.documentElement.dir = l === "ar" ? "rtl" : "ltr";
};

export default i18n;
