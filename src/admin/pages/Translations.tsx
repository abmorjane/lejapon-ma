import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Languages, Sparkles, Loader2, RefreshCw } from "lucide-react";
import {
  bulkTranslate,
  fetchTranslations,
  indexTranslations,
  setAtPath,
  type TargetLang,
  type TranslateItem,
} from "@/lib/translations";

type EntityKey = "trips" | "extras" | "faqs" | "articles" | "programmes" | "programme_days" | "pages";

const ENTITY_FIELDS: Record<Exclude<EntityKey, "faqs" | "pages">, string[]> = {
  trips: ["title", "season", "short_description", "long_description", "label", "cover_alt", "destination"],
  extras: ["name", "description", "alt_text", "category", "city"],
  articles: ["title", "excerpt", "meta_title", "meta_description", "category"],
  programmes: ["title", "subtitle", "introduction", "description", "hero_alt", "cta_label", "meta_description", "duration"],
  programme_days: ["title", "description", "city", "badge", "special_note"],
};

const ENTITY_LABEL: Record<EntityKey, string> = {
  trips: "Voyages à l'affiche",
  extras: "Activités / Extras",
  faqs: "FAQ",
  articles: "Articles & blog",
  programmes: "Programmes",
  programme_days: "Programmes — jours",
  pages: "Pages & textes frontend",
};

type Stats = {
  rows: number;
  fields: number;
  missingEn: number;
  missingAr: number;
};

export default function AdminTranslations() {
  const [stats, setStats] = useState<Partial<Record<EntityKey, Stats>>>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<EntityKey | "all" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  async function loadStats() {
    setLoading(true);
    try {
      const out: Partial<Record<EntityKey, Stats>> = {};

      // Generic tables (content_translations based)
      for (const t of Object.keys(ENTITY_FIELDS) as (keyof typeof ENTITY_FIELDS)[]) {
        const fields = ENTITY_FIELDS[t];
        const { data, error } = await supabase.from(t as any).select("id," + fields.join(","));
        if (error) continue;
        const rows = (data ?? []) as any[];
        const ids = rows.map((r) => String(r.id));
        const [enT, arT] = await Promise.all([
          ids.length ? fetchTranslations(t, "en", ids) : Promise.resolve([]),
          ids.length ? fetchTranslations(t, "ar", ids) : Promise.resolve([]),
        ]);
        const enMap = indexTranslations(enT);
        const arMap = indexTranslations(arT);

        let totalFields = 0,
          missingEn = 0,
          missingAr = 0;
        for (const r of rows) {
          for (const f of fields) {
            const fr = (r as any)[f];
            if (typeof fr !== "string" || !fr.trim()) continue;
            totalFields++;
            if (!enMap[String(r.id)]?.[f]?.trim()) missingEn++;
            if (!arMap[String(r.id)]?.[f]?.trim()) missingAr++;
          }
        }
        out[t as EntityKey] = { rows: rows.length, fields: totalFields, missingEn, missingAr };
      }

      // FAQs (own en/ar columns)
      {
        const { data } = await supabase.from("faqs").select("id,question_fr,answer_fr,question_en,answer_en,question_ar,answer_ar");
        const rows = (data ?? []) as any[];
        let totalFields = 0,
          missingEn = 0,
          missingAr = 0;
        for (const r of rows) {
          for (const f of ["question", "answer"]) {
            const fr = r[`${f}_fr`];
            if (!fr || !String(fr).trim()) continue;
            totalFields++;
            if (!r[`${f}_en`] || !String(r[`${f}_en`]).trim()) missingEn++;
            if (!r[`${f}_ar`] || !String(r[`${f}_ar`]).trim()) missingAr++;
          }
        }
        out.faqs = { rows: rows.length, fields: totalFields, missingEn, missingAr };
      }

      // Pages (jsonb i18n leaves)
      {
        const { data } = await supabase.from("pages").select("id,slug,content");
        const rows = (data ?? []) as any[];
        let totalFields = 0,
          missingEn = 0,
          missingAr = 0;
        for (const r of rows) {
          const full = collectAllI18nLeaves(r.content);
          for (const l of full) {
            if (!l.fr.trim()) continue;
            totalFields++;
            if (!l.en?.trim()) missingEn++;
            if (!l.ar?.trim()) missingAr++;
          }
        }
        out.pages = { rows: rows.length, fields: totalFields, missingEn, missingAr };
      }

      setStats(out);
    } finally {
      setLoading(false);
    }
  }

  async function translateEntity(entity: EntityKey, langs: TargetLang[] = ["en", "ar"]) {
    setRunning(entity);
    setProgress({ done: 0, total: 0 });
    try {
      let items: TranslateItem[] = [];

      if (entity === "faqs") {
        const { data } = await supabase.from("faqs").select("id,question_fr,answer_fr,question_en,answer_en,question_ar,answer_ar");
        const rows = (data ?? []) as any[];
        for (const r of rows) {
          for (const f of ["question", "answer"]) {
            const fr = r[`${f}_fr`];
            if (!fr || !String(fr).trim()) continue;
            for (const lg of langs) {
              if (!r[`${f}_${lg}`] || !String(r[`${f}_${lg}`]).trim()) {
                items.push({
                  table: "faqs_native",
                  rowId: `${r.id}:${f}:${lg}`,
                  field: `${f}_${lg}`,
                  sourceText: String(fr),
                  targetLang: lg,
                  persist: false,
                });
              }
            }
          }
        }
      } else if (entity === "pages") {
        const { data } = await supabase.from("pages").select("id,content");
        const rows = (data ?? []) as any[];
        for (const r of rows) {
          const leaves = collectAllI18nLeaves(r.content);
          let i = 0;
          for (const l of leaves) {
            if (!l.fr.trim()) continue;
            for (const lg of langs) {
              if (!l[lg]?.trim()) {
                items.push({
                  table: "pages_jsonb",
                  rowId: `${r.id}::${l.path.join(".")}::${lg}`,
                  field: lg,
                  sourceText: l.fr,
                  targetLang: lg,
                  persist: false,
                });
              }
            }
            i++;
          }
        }
      } else {
        const fields = ENTITY_FIELDS[entity];
        const { data } = await supabase.from(entity as any).select("id," + fields.join(","));
        const rows = (data ?? []) as any[];
        const ids = rows.map((r) => String(r.id));
        const [enT, arT] = await Promise.all([
          ids.length ? fetchTranslations(entity, "en", ids) : Promise.resolve([]),
          ids.length ? fetchTranslations(entity, "ar", ids) : Promise.resolve([]),
        ]);
        const maps = { en: indexTranslations(enT), ar: indexTranslations(arT) };
        for (const r of rows) {
          for (const f of fields) {
            const fr = (r as any)[f];
            if (typeof fr !== "string" || !fr.trim()) continue;
            for (const lg of langs) {
              if (!maps[lg][String(r.id)]?.[f]?.trim()) {
                items.push({
                  table: entity,
                  rowId: String(r.id),
                  field: f,
                  sourceText: fr,
                  targetLang: lg,
                  persist: true,
                });
              }
            }
          }
        }
      }

      if (!items.length) {
        toast.success(`Aucune traduction manquante pour « ${ENTITY_LABEL[entity]} ».`);
        return;
      }

      setProgress({ done: 0, total: items.length });
      const results = await bulkTranslate(items, (done, total) => setProgress({ done, total }));

      // Persist non-persisted entities (faqs, pages)
      if (entity === "faqs") {
        // group results by row id
        const updates: Record<string, any> = {};
        for (const r of results as any[]) {
          if (!r.ok || !r.value) continue;
          const [rowId, base, lg] = String(r.rowId).split(":");
          (updates[rowId] ||= {})[`${base}_${lg}`] = r.value;
        }
        for (const [rowId, patch] of Object.entries(updates)) {
          await supabase.from("faqs").update(patch).eq("id", rowId);
        }
      } else if (entity === "pages") {
        // group by page id, walk content and set leaves
        const { data } = await supabase.from("pages").select("id,content");
        const pages = (data ?? []) as any[];
        const byPage: Record<string, any[]> = {};
        for (const r of results as any[]) {
          if (!r.ok || !r.value) continue;
          const [pageId, pathStr, lg] = String(r.rowId).split("::");
          (byPage[pageId] ||= []).push({ path: pathStr.split("."), lg, val: r.value });
        }
        for (const p of pages) {
          const ups = byPage[p.id];
          if (!ups || !ups.length) continue;
          const content = JSON.parse(JSON.stringify(p.content));
          for (const u of ups) setAtPath(content, u.path, u.lg, u.val);
          await supabase.from("pages").update({ content }).eq("id", p.id);
        }
      }

      const failures = (results as any[]).filter((r) => !r.ok).length;
      toast.success(
        `${ENTITY_LABEL[entity]} : ${items.length - failures} traduction(s) générée(s)${failures ? `, ${failures} échec(s)` : ""}.`,
      );
      await loadStats();
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur de traduction");
    } finally {
      setRunning(null);
      setProgress({ done: 0, total: 0 });
    }
  }

  async function translateAll() {
    setRunning("all");
    try {
      for (const k of Object.keys(ENTITY_LABEL) as EntityKey[]) {
        await translateEntity(k);
      }
      toast.success("Backfill complet terminé.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <PageHeader
        title="Traductions multilingues"
        description="Génère et gère automatiquement les versions anglaise et arabe de tout le contenu du site."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={loadStats} disabled={loading || !!running}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Analyser
            </Button>
            <Button onClick={translateAll} disabled={!!running || loading}>
              <Sparkles className="w-4 h-4" />
              Tout traduire (EN + AR)
            </Button>
          </div>
        }
      />

      {running && progress.total > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Traduction en cours… ({progress.done}/{progress.total})</span>
              <span>{Math.round((progress.done / progress.total) * 100)}%</span>
            </div>
            <Progress value={(progress.done / progress.total) * 100} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Languages className="w-5 h-5" /> État des traductions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.keys(stats).length === 0 && !loading && (
            <p className="text-muted-foreground text-sm">Cliquez sur « Analyser » pour scanner le contenu existant.</p>
          )}
          {(Object.keys(ENTITY_LABEL) as EntityKey[]).map((k) => {
            const s = stats[k];
            return (
              <div key={k} className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 rounded-lg border bg-secondary/20">
                <div className="flex-1">
                  <div className="font-medium">{ENTITY_LABEL[k]}</div>
                  {s ? (
                    <div className="flex flex-wrap gap-2 mt-1 text-xs">
                      <Badge variant="secondary">{s.rows} ligne(s)</Badge>
                      <Badge variant="secondary">{s.fields} champ(s) FR</Badge>
                      <Badge className={s.missingEn > 0 ? "bg-orange-500" : "bg-emerald-600"}>
                        EN — {s.missingEn} manquant(s)
                      </Badge>
                      <Badge className={s.missingAr > 0 ? "bg-orange-500" : "bg-emerald-600"}>
                        AR — {s.missingAr} manquant(s)
                      </Badge>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground mt-1">Non analysé</div>
                  )}
                </div>
                <Button
                  size="sm"
                  onClick={() => translateEntity(k)}
                  disabled={!!running}
                  variant={s && s.missingEn + s.missingAr > 0 ? "default" : "outline"}
                >
                  {running === k ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Générer EN + AR
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 text-sm text-muted-foreground space-y-2">
          <p>
            <strong>Comment ça marche :</strong> chaque champ français est envoyé à l'IA pour produire une traduction
            en anglais et en arabe. Les traductions sont marquées « auto » (à vérifier) et restent éditables manuellement.
          </p>
          <p>
            <strong>Fallback :</strong> si une traduction est vide, le site affiche automatiquement la version française.
          </p>
          <p>
            <strong>Sécurité :</strong> aucune donnée FR existante n'est modifiée. Les slugs et le SEO français restent intacts.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/** Walk a JSONB pages.content collecting all i18n string leaves with their path. */
function collectAllI18nLeaves(value: any, path: string[] = []): { path: string[]; fr: string; en?: string; ar?: string }[] {
  const out: { path: string[]; fr: string; en?: string; ar?: string }[] = [];
  const isI18n = (v: any) =>
    !!v && typeof v === "object" && !Array.isArray(v) &&
    ("fr" in v || "en" in v || "ar" in v) &&
    Object.keys(v).every((k) => ["fr", "en", "ar"].includes(k));
  const walk = (v: any, p: string[]) => {
    if (isI18n(v)) {
      out.push({ path: p, fr: v.fr ?? "", en: v.en, ar: v.ar });
      return;
    }
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, String(i)]));
    else if (v && typeof v === "object") for (const k of Object.keys(v)) walk(v[k], [...p, k]);
  };
  walk(value, path);
  return out;
}