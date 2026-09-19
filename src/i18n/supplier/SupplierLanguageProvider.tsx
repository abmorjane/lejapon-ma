import { createContext, useContext, useMemo, useState, useEffect, type ReactNode } from "react";
import { createInstance } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import catalog from "./catalog.json";

export type SupplierLanguage = "en" | "ja";
export type SupplierTranslator = (source: string, values?: Record<string, unknown>) => string;
const isLanguage = (value: unknown): value is SupplierLanguage => value === "en" || value === "ja";
const storageKey = (id?: string) => `lejapon:supplier-language:${id || "guest"}`;
function storedLanguage(id?: string) {
  try { return localStorage.getItem(storageKey(id)); } catch { return null; }
}
export function initialSupplierLanguage(user?: { id: string; user_metadata?: Record<string, unknown> } | null): SupplierLanguage {
  const preference = user?.user_metadata?.supplier_language;
  try {
    const pending = localStorage.getItem(`${storageKey(user?.id)}:pending`);
    if (isLanguage(pending)) return pending;
  } catch { /* Storage can be unavailable in restricted browsers. */ }
  const stored = storedLanguage(user?.id) || storedLanguage();
  return isLanguage(preference) ? preference : isLanguage(stored) ? stored : "en";
}
const interpolate: SupplierTranslator = (source, values = {}) => source.replace(/\{\{(\w+)\}\}/g, (match, key) => key in values ? String(values[key] ?? "") : match);
const localizedCopies = new Set(Object.values(catalog).flatMap(copy => [copy.en, copy.ja]));
const patterns = Object.keys(catalog).filter((key) => key.includes("{{")).map((key) => {
  const names: string[] = [];
  const escaped = key.split(/(\{\{\w+\}\})/g).map((part) => {
    const match = part.match(/^\{\{(\w+)\}\}$/);
    if (match) { names.push(match[1]); return "([\\s\\S]*?)"; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }).join("");
  return { key, names, regex: new RegExp(`^${escaped}$`) };
}).sort((a, b) => b.key.replace(/\{\{\w+\}\}/g, "").length - a.key.replace(/\{\{\w+\}\}/g, "").length);

export function createSupplierTranslator(language: SupplierLanguage | "fr"): SupplierTranslator {
  if (language === "fr") return interpolate;
  const instance = createInstance();
  const resources = Object.fromEntries(["en", "ja"].map((lang) => [lang, { translation: Object.fromEntries(Object.entries(catalog).map(([key, copy]) => [key, copy[lang as SupplierLanguage]])) }]));
  void instance.init({ lng: language, fallbackLng: "en", resources, initAsync: false, keySeparator: false, nsSeparator: false, interpolation: { escapeValue: false } });
  return (source, values) => {
    if (Object.prototype.hasOwnProperty.call(catalog, source)) return String(instance.t(source, values || {}));
    // Only call this translator on app-owned labels/diagnostics, never on user-entered data.
    for (const pattern of patterns) {
      const match = source.match(pattern.regex);
      if (match) return String(instance.t(pattern.key, Object.fromEntries(pattern.names.map((name, index) => [name, match[index + 1]]))));
    }
    return interpolate(source, values);
  };
}
function supplierDate(value: string | null | undefined, language: SupplierLanguage | "fr", time = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString(language === "fr" ? "fr-FR" : language === "ja" ? "ja-JP" : "en-GB", {
    year: "numeric", month: language === "ja" ? "long" : time ? "2-digit" : "short",
    day: language === "fr" ? "2-digit" : "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } as const : {}),
  });
}
const dateFormatters = (language: SupplierLanguage | "fr") => ({
  formatDate: (value?: string | null) => supplierDate(value, language),
  formatDateTime: (value?: string | null) => supplierDate(value, language, true),
});
const Context = createContext<{ language: SupplierLanguage | "fr"; t: SupplierTranslator; setLanguage?: (language: SupplierLanguage) => Promise<void>; saving?: boolean } & ReturnType<typeof dateFormatters>>({ language: "fr", t: interpolate, ...dateFormatters("fr") });
export const useSupplierTranslation = () => useContext(Context);

export function SupplierLanguageProvider({ children, user }: { children: ReactNode; user?: { id: string; user_metadata?: Record<string, unknown> } | null }) {
  const [language, setLocalLanguage] = useState<SupplierLanguage>(() => initialSupplierLanguage(user));
  const [saving, setSaving] = useState(false);
  const t = useMemo(() => createSupplierTranslator(language), [language]);
  const persist = async (next: SupplierLanguage) => {
    try { localStorage.setItem(storageKey(user?.id), next); if (user) localStorage.setItem(`${storageKey(user.id)}:pending`, next); } catch { /* Auth remains the cross-device preference. */ }
    if (!user) return;
    setSaving(true);
    try {
      // A non-security preference. No authorization decisions use user_metadata.
      const { error } = await supabase.auth.updateUser({ data: { supplier_language: next } });
      if (error) throw error;
      try { localStorage.removeItem(`${storageKey(user.id)}:pending`); } catch { /* Saved in Auth. */ }
    } catch (error) {
      console.error("Supplier language preference save failed", error);
      const tr = createSupplierTranslator(next);
      toast.error(`${tr("Language changed here, but the email language could not be saved. Please retry.")} ${supplierErrorMessage(tr, error)}`);
    } finally { setSaving(false); }
  };
  useEffect(() => { if (user && !isLanguage(user.user_metadata?.supplier_language)) void persist(language); }, [user?.id]);
  useEffect(() => {
    const previousLanguage = document.documentElement.lang;
    const previousDirection = document.documentElement.dir;
    document.documentElement.lang = language;
    document.documentElement.dir = "ltr";
    return () => { document.documentElement.lang = previousLanguage; document.documentElement.dir = previousDirection; };
  }, [language]);
  const setLanguage = async (next: SupplierLanguage) => { setLocalLanguage(next); await persist(next); };
  return <Context.Provider value={{ language, t, setLanguage, saving, ...dateFormatters(language) }}><div lang={language} dir="ltr">{children}</div></Context.Provider>;
}

export function SupplierLanguageSelector() {
  const { language, setLanguage, saving, t } = useSupplierTranslation();
  return <div className="inline-flex shrink-0 items-center gap-1 text-xs" aria-label={t("Language")}>
    <button type="button" lang="ja" aria-pressed={language === "ja"} disabled={saving} className={`rounded px-2 py-1 ${language === "ja" ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`} onClick={() => void setLanguage?.("ja")}>日本語</button>
    <span aria-hidden="true">|</span>
    <button type="button" lang="en" aria-pressed={language === "en"} disabled={saving} className={`rounded px-2 py-1 ${language === "en" ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground"}`} onClick={() => void setLanguage?.("en")}>EN</button>
  </div>;
}

export function supplierErrorMessage(t: SupplierTranslator, error: unknown) {
  const value = typeof error === "string" ? { message: error } : (error || {}) as { code?: string; message?: string; details?: string; hint?: string };
  const raw = [value.code, value.message, value.details, value.hint].filter(Boolean).join(" · ") || "Erreur Supabase inconnue";
  const translated = t(raw);
  // Staff retains the existing French diagnostics. Supplier always sees a localized explanation plus real backend details.
  if (t("Backend request failed") === "Backend request failed") return raw;
  if (translated !== raw) return translated;
  if (localizedCopies.has(raw)) return raw;
  const key = /42501|403|permission denied|access denied|not_staff|not_supplier|accès refusé|row.level security/i.test(raw) ? "Permission denied"
    : /401|invalid_token|JWT|session.*expired|missing_auth/i.test(raw) ? "Authentication required"
    : /fetch|network|connection|offline/i.test(raw) ? "Network request failed" : "Backend request failed";
  return `${t(key)} (${raw})`;
}
