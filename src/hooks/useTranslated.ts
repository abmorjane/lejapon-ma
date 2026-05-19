import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { fetchTranslations, indexTranslations, type TargetLang } from "@/lib/translations";

/**
 * Loads all translations for a given table+language and returns a function
 * that merges a French row with its translation (with FR fallback).
 */
export function useTranslatedTable<T extends Record<string, any>>(
  table: string,
  rows: T[] | undefined | null,
  fields: (keyof T & string)[],
  idKey: keyof T = "id" as keyof T,
) {
  const { i18n } = useTranslation();
  const lang = (i18n.language || "fr") as "fr" | TargetLang;
  const [map, setMap] = useState<Record<string, Record<string, string>>>({});

  const ids = useMemo(
    () => (rows ?? []).map((r) => String(r[idKey])).filter(Boolean),
    [rows, idKey],
  );

  useEffect(() => {
    if (lang === "fr" || ids.length === 0) {
      setMap({});
      return;
    }
    let alive = true;
    fetchTranslations(table, lang as TargetLang, ids)
      .then((tr) => alive && setMap(indexTranslations(tr)))
      .catch(() => alive && setMap({}));
    return () => {
      alive = false;
    };
  }, [table, lang, ids.join("|")]);

  return useMemo(() => {
    if (!rows) return [] as T[];
    if (lang === "fr") return rows;
    return rows.map((r) => {
      const tr = map[String(r[idKey])];
      if (!tr) return r;
      const out = { ...r };
      for (const f of fields) {
        const v = tr[f];
        if (v && v.trim()) (out as any)[f] = v;
      }
      return out;
    });
  }, [rows, map, lang, fields.join("|"), idKey]);
}

/** Single-row variant. */
export function useTranslatedRow<T extends Record<string, any>>(
  table: string,
  row: T | undefined | null,
  fields: (keyof T & string)[],
  idKey: keyof T = "id" as keyof T,
) {
  const arr = useMemo(() => (row ? [row] : []), [row]);
  const [out] = useTranslatedTable(table, arr, fields, idKey);
  return out ?? row ?? null;
}