// Helpers to resolve i18n-aware site content stored in the DB.
// A translatable string is stored as `{ fr?: string; en?: string; ar?: string }`.
// Plain strings are treated as French (legacy). Booleans / URLs / numbers
// pass through unchanged.

export type I18nString = { fr?: string; en?: string; ar?: string };

export function isI18nString(v: any): v is I18nString {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    ("fr" in v || "en" in v || "ar" in v) &&
    Object.keys(v).every((k) => ["fr", "en", "ar"].includes(k))
  );
}

export function pickI18n(v: I18nString | string | undefined | null, lang: string): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  return v[lang as keyof I18nString] || v.fr || v.en || v.ar || "";
}

/** Recursively replace any `{fr,en,ar}` leaf with the resolved string for `lang`. */
export function resolveContent<T = any>(value: any, lang: string): T {
  if (isI18nString(value)) return pickI18n(value, lang) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => resolveContent(v, lang)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveContent(v, lang);
    return out as T;
  }
  return value as T;
}

/** Read i18n value for an admin editor; if legacy string, return `{fr: string}`. */
export function ensureI18n(v: any): I18nString {
  if (typeof v === "string") return { fr: v };
  if (isI18nString(v)) return v;
  return {};
}