import { supabase } from "@/integrations/supabase/client";
import { isI18nString, type I18nString } from "./i18n-content";

export type Lang = "fr" | "en" | "ar";
export type TargetLang = "en" | "ar";

export type TranslationRow = {
  table_name: string;
  row_id: string;
  field: string;
  language: TargetLang;
  value_text: string | null;
  status: "auto" | "verified" | "manual";
  source_text_hash: string | null;
};

export type TranslateItem = {
  table: string;
  rowId: string;
  field: string;
  sourceText: string;
  targetLang: TargetLang;
  /** When false, the edge function only translates and returns; doesn't store. */
  persist?: boolean;
};

export async function fetchTranslations(table: string, lang: TargetLang, rowIds?: string[]) {
  let q = supabase
    .from("content_translations")
    .select("table_name,row_id,field,language,value_text,status,source_text_hash")
    .eq("table_name", table)
    .eq("language", lang);
  if (rowIds && rowIds.length) q = q.in("row_id", rowIds);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as TranslationRow[];
}

/** Build a `{rowId: {field: value}}` map. */
export function indexTranslations(rows: TranslationRow[]) {
  const map: Record<string, Record<string, string>> = {};
  for (const r of rows) {
    if (!r.value_text) continue;
    (map[r.row_id] ||= {})[r.field] = r.value_text;
  }
  return map;
}

/** Pick the translated value or fall back to French. */
export function pickTranslated<T = any>(
  frValue: T,
  translated: Record<string, string> | undefined,
  field: string,
): T {
  const t = translated?.[field];
  if (t && t.trim()) return t as unknown as T;
  return frValue;
}

/** Bulk translate via edge function, batches of 25. */
export async function bulkTranslate(items: TranslateItem[], onProgress?: (done: number, total: number) => void) {
  const BATCH = 25;
  const all: any[] = [];
  let done = 0;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const { data, error } = await supabase.functions.invoke("translate-content", {
      body: { items: batch },
    });
    if (error) throw error;
    if (data?.noCredits) throw new Error("Crédits IA épuisés. Ajoutez du crédit dans les paramètres Lovable Cloud.");
    if (data?.rateLimited) throw new Error("Limite de débit atteinte. Réessayez dans quelques secondes.");
    if (Array.isArray(data?.results)) all.push(...data.results);
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return all;
}

/** Save a manual edit to a translation. */
export async function saveTranslation(
  table: string,
  rowId: string,
  field: string,
  language: TargetLang,
  value: string,
  sourceText: string,
) {
  const sha = await sha1(sourceText ?? "");
  const { error } = await supabase.from("content_translations").upsert(
    {
      table_name: table,
      row_id: rowId,
      field,
      language,
      value_text: value,
      status: "manual",
      source_text_hash: sha,
    },
    { onConflict: "table_name,row_id,field,language" },
  );
  if (error) throw error;
}

async function sha1(text: string) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** Walk a JSONB `pages.content` value, finding I18nString leaves with empty en/ar. */
export function collectMissingI18nLeaves(
  value: any,
  path: string[] = [],
): { path: string[]; fr: string }[] {
  const out: { path: string[]; fr: string }[] = [];
  const walk = (v: any, p: string[]) => {
    if (isI18nString(v)) {
      const fr = (v as I18nString).fr ?? "";
      if (fr.trim() && (!(v as I18nString).en?.trim() || !(v as I18nString).ar?.trim())) {
        out.push({ path: p, fr });
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, String(i)]));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], [...p, k]);
  };
  walk(value, path);
  return out;
}

export function setAtPath(obj: any, path: string[], leafKey: "en" | "ar", val: string) {
  let cur = obj;
  for (const k of path) cur = cur[k];
  cur[leafKey] = val;
}