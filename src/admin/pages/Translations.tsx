import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Languages, Sparkles, Loader2, RefreshCw, Search, ShieldCheck } from "lucide-react";
import {
  bulkTranslate,
  fetchTranslations,
  indexTranslations,
  setAtPath,
  type TargetLang,
  type TranslateItem,
} from "@/lib/translations";

type ModuleKey =
  | "trips"
  | "trip_hotels"
  | "pricing_tiers"
  | "extras"
  | "faqs"
  | "articles"
  | "programmes"
  | "programme_days"
  | "pages"
  | "hotel_catalog"
  | "visa_document_checklists"
  | "email_templates";

type ModuleGroup = "Public" | "Agency" | "Visa" | "Booking" | "Marketing";
type TranslationMode = "content_translations" | "native_columns" | "pages_jsonb" | "checklist_jsonb";

type ModuleConfig = {
  key: ModuleKey;
  label: string;
  group: ModuleGroup;
  table: string;
  mode: TranslationMode;
  fields?: string[];
  nativeBases?: string[];
  select: string;
  publishedFilter?: (query: any) => any;
  notes: string;
};

type Stats = {
  rows: number;
  fields: number;
  missingEn: number;
  missingAr: number;
  status: "complete" | "partial" | "not_analyzed";
  error?: string;
};

type LoadedRows = Record<string, any[]>;

const MODULES: ModuleConfig[] = [
  {
    key: "trips",
    label: "Voyages / départs",
    group: "Public",
    table: "trips",
    mode: "content_translations",
    select: "id,title,season,short_description,long_description,label,cover_alt,destination,outbound_flight_text,return_flight_text,visa_hotel_name,visa_hotel_address,visa_arrival_port",
    fields: ["title", "season", "short_description", "long_description", "label", "cover_alt", "destination", "outbound_flight_text", "return_flight_text", "visa_hotel_name", "visa_hotel_address", "visa_arrival_port"],
    publishedFilter: (q) => q.in("status", ["open", "completed"]),
    notes: "Inclut les voyages publics et les départs actifs visibles côté site/agence.",
  },
  {
    key: "trip_hotels",
    label: "Hôtels liés aux voyages",
    group: "Agency",
    table: "trip_hotels",
    mode: "content_translations",
    select: "id,name,city,address",
    fields: ["name", "city", "address"],
    notes: "Hôtels opérationnels affichés dans les documents voyage et bibliothèques agence.",
  },
  {
    key: "pricing_tiers",
    label: "Formules / hébergements voyage",
    group: "Booking",
    table: "pricing_tiers",
    mode: "content_translations",
    select: "id,name,description",
    fields: ["name", "description"],
    notes: "Libellés de formules réutilisables, sans données réservation.",
  },
  {
    key: "extras",
    label: "Expériences / extras / activités",
    group: "Public",
    table: "extras",
    mode: "content_translations",
    select: "id,name,description,alt_text,category,city",
    fields: ["name", "description", "alt_text", "category", "city"],
    publishedFilter: (q) => q.eq("is_active", true),
    notes: "Contenu public et agence des activités/options.",
  },
  {
    key: "faqs",
    label: "FAQ",
    group: "Public",
    table: "faqs",
    mode: "native_columns",
    select: "id,question_fr,answer_fr,meta_title_fr,meta_description_fr,question_en,answer_en,meta_title_en,meta_description_en,question_ar,answer_ar,meta_title_ar,meta_description_ar",
    nativeBases: ["question", "answer", "meta_title", "meta_description"],
    publishedFilter: (q) => q.eq("is_published", true),
    notes: "Questions, réponses et SEO FAQ.",
  },
  {
    key: "articles",
    label: "Articles & blog",
    group: "Public",
    table: "articles",
    mode: "content_translations",
    select: "id,title,excerpt,body,meta_title,meta_description,category,cover_alt",
    fields: ["title", "excerpt", "body", "meta_title", "meta_description", "category", "cover_alt"],
    publishedFilter: (q) => q.eq("status", "published"),
    notes: "Articles, contenu éditorial et SEO. Slugs non modifiés.",
  },
  {
    key: "programmes",
    label: "Programmes",
    group: "Public",
    table: "programmes",
    mode: "content_translations",
    select: "id,title,subtitle,introduction,description,hero_alt,cta_label,meta_description,duration",
    fields: ["title", "subtitle", "introduction", "description", "hero_alt", "cta_label", "meta_description", "duration"],
    publishedFilter: (q) => q.eq("is_published", true),
    notes: "Programmes publics et bibliothèque agence.",
  },
  {
    key: "programme_days",
    label: "Programmes — jours",
    group: "Public",
    table: "programme_days",
    mode: "content_translations",
    select: "id,title,description,city,badge,special_note",
    fields: ["title", "description", "city", "badge", "special_note"],
    publishedFilter: (q) => q.eq("is_active", true),
    notes: "Détail jour par jour, PDF programme et affichage agence.",
  },
  {
    key: "pages",
    label: "Pages, homepage, navigation/footer DB",
    group: "Public",
    table: "pages",
    mode: "pages_jsonb",
    select: "id,slug,title,meta_description,status,content",
    publishedFilter: (q) => q.eq("status", "published"),
    notes: "Pages statiques JSONB, sections homepage, textes frontend stockés en base.",
  },
  {
    key: "hotel_catalog",
    label: "Catalogue hôtels",
    group: "Public",
    table: "hotel_catalog",
    mode: "native_columns",
    select: "id,name,city,category,short_description_fr,short_description_en,short_description_ar,full_description_fr,full_description_en,full_description_ar",
    nativeBases: ["short_description", "full_description"],
    publishedFilter: (q) => q.eq("is_active", true),
    notes: "Catalogue public et agence. Nom/adresse conservés tels quels.",
  },
  {
    key: "visa_document_checklists",
    label: "Visa — documents requis",
    group: "Visa",
    table: "visa_document_checklists",
    mode: "checklist_jsonb",
    select: "id,label,description,items,category,is_active",
    fields: ["label", "description"],
    publishedFilter: (q) => q.eq("is_active", true),
    notes: "Règles réutilisables de documents visa, sans dossiers clients.",
  },
  {
    key: "email_templates",
    label: "Templates email réutilisables",
    group: "Marketing",
    table: "email_templates",
    mode: "content_translations",
    select: "id,name,subject,preheader,html_body,cta_label,category,language",
    fields: ["name", "subject", "preheader", "html_body", "cta_label", "category"],
    publishedFilter: (q) => q.eq("language", "fr"),
    notes: "Templates métier réutilisables. Placeholders conservés.",
  },
];

const EXCLUDED_MODULES = [
  "clients, passports, OCR metadata",
  "visa_applications et visa_documents de dossiers clients",
  "bookings, booking_participants, payments, notes internes",
  "organization_member_profiles et données personnelles agence",
  "commission_engine_rules: règles privées; libellés calculés côté frontend",
  "room_assignments/trip_rooms: opérations internes non publiques",
];

const moduleByKey = MODULES.reduce<Record<ModuleKey, ModuleConfig>>((acc, module) => {
  acc[module.key] = module;
  return acc;
}, {} as Record<ModuleKey, ModuleConfig>);

const allModuleKeys = MODULES.map((module) => module.key);

export default function AdminTranslations() {
  const [stats, setStats] = useState<Partial<Record<ModuleKey, Stats>>>({});
  const [rowsByModule, setRowsByModule] = useState<LoadedRows>({});
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState<ModuleKey | "all" | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [moduleFilter, setModuleFilter] = useState<ModuleKey | "all">("all");
  const [missingFilter, setMissingFilter] = useState<"all" | TargetLang>("all");
  const [publishedOnly, setPublishedOnly] = useState(true);

  const visibleModules = useMemo(() => {
    return MODULES.filter((module) => {
      if (moduleFilter !== "all" && module.key !== moduleFilter) return false;
      const moduleStats = stats[module.key];
      if (missingFilter === "en" && moduleStats && moduleStats.missingEn === 0) return false;
      if (missingFilter === "ar" && moduleStats && moduleStats.missingAr === 0) return false;
      return true;
    });
  }, [moduleFilter, missingFilter, stats]);

  async function fetchRows(config: ModuleConfig) {
    let query = supabase.from(config.table as any).select(config.select);
    if (publishedOnly && config.publishedFilter) query = config.publishedFilter(query);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as any[];
  }

  async function analyzeModule(key: ModuleKey) {
    const config = moduleByKey[key];
    try {
      const rows = await fetchRows(config);
      setRowsByModule((current) => ({ ...current, [key]: rows }));
      const nextStats = await computeStats(config, rows);
      setStats((current) => ({ ...current, [key]: nextStats }));
      return nextStats;
    } catch (error: any) {
      const failed: Stats = {
        rows: 0,
        fields: 0,
        missingEn: 0,
        missingAr: 0,
        status: "not_analyzed",
        error: error?.message ?? "Analyse impossible",
      };
      setStats((current) => ({ ...current, [key]: failed }));
      return failed;
    }
  }

  async function analyzeAll() {
    setLoading(true);
    try {
      for (const key of allModuleKeys) await analyzeModule(key);
      toast.success("Analyse des contenus V2 terminée.");
    } finally {
      setLoading(false);
    }
  }

  async function computeStats(config: ModuleConfig, rows: any[]): Promise<Stats> {
    if (config.mode === "native_columns") return nativeStats(config, rows);
    if (config.mode === "pages_jsonb") return pagesStats(config, rows);
    if (config.mode === "checklist_jsonb") return checklistStats(config, rows);
    return contentTranslationStats(config, rows);
  }

  async function contentTranslationStats(config: ModuleConfig, rows: any[]): Promise<Stats> {
    const fields = config.fields ?? [];
    const ids = rows.map((row) => String(row.id));
    const [enT, arT] = await Promise.all([
      ids.length ? fetchTranslations(config.table, "en", ids) : Promise.resolve([]),
      ids.length ? fetchTranslations(config.table, "ar", ids) : Promise.resolve([]),
    ]);
    const enMap = indexTranslations(enT);
    const arMap = indexTranslations(arT);
    let totalFields = 0;
    let missingEn = 0;
    let missingAr = 0;
    for (const row of rows) {
      for (const field of fields) {
        const source = row[field];
        if (!isTranslatableString(source)) continue;
        totalFields += 1;
        if (!enMap[String(row.id)]?.[field]?.trim()) missingEn += 1;
        if (!arMap[String(row.id)]?.[field]?.trim()) missingAr += 1;
      }
    }
    return makeStats(rows.length, totalFields, missingEn, missingAr);
  }

  function nativeStats(config: ModuleConfig, rows: any[]): Stats {
    let totalFields = 0;
    let missingEn = 0;
    let missingAr = 0;
    for (const row of rows) {
      for (const base of config.nativeBases ?? []) {
        const source = row[`${base}_fr`];
        if (!isTranslatableString(source)) continue;
        totalFields += 1;
        if (!String(row[`${base}_en`] ?? "").trim()) missingEn += 1;
        if (!String(row[`${base}_ar`] ?? "").trim()) missingAr += 1;
      }
    }
    return makeStats(rows.length, totalFields, missingEn, missingAr);
  }

  async function pagesStats(config: ModuleConfig, rows: any[]): Promise<Stats> {
    const baseStats = await contentTranslationStats({ ...config, mode: "content_translations", fields: ["title", "meta_description"] }, rows);
    let totalFields = 0;
    let missingEn = 0;
    let missingAr = 0;
    for (const row of rows) {
      const leaves = collectAllI18nLeaves(row.content);
      for (const leaf of leaves) {
        if (!leaf.fr.trim()) continue;
        totalFields += 1;
        if (!leaf.en?.trim()) missingEn += 1;
        if (!leaf.ar?.trim()) missingAr += 1;
      }
    }
    return makeStats(rows.length, baseStats.fields + totalFields, baseStats.missingEn + missingEn, baseStats.missingAr + missingAr);
  }

  async function checklistStats(config: ModuleConfig, rows: any[]): Promise<Stats> {
    const contentStats = await contentTranslationStats(config, rows);
    let jsonFields = 0;
    let missingEn = 0;
    let missingAr = 0;
    for (const row of rows) {
      for (const leaf of collectChecklistLeaves(row.items)) {
        jsonFields += 1;
        if (!leaf.en?.trim()) missingEn += 1;
        if (!leaf.ar?.trim()) missingAr += 1;
      }
    }
    return makeStats(
      rows.length,
      contentStats.fields + jsonFields,
      contentStats.missingEn + missingEn,
      contentStats.missingAr + missingAr,
    );
  }

  async function translateModule(key: ModuleKey, langs: TargetLang[] = ["en", "ar"]) {
    const config = moduleByKey[key];
    setRunning(key);
    setProgress({ done: 0, total: 0 });
    try {
      const rows = rowsByModule[key] ?? await fetchRows(config);
      const items = await buildTranslateItems(config, rows, langs);
      if (!items.length) {
        toast.success(`Aucune traduction manquante pour « ${config.label} ».`);
        await analyzeModule(key);
        return;
      }

      setProgress({ done: 0, total: items.length });
      const results = await bulkTranslate(items, (done, total) => setProgress({ done, total }));
      await persistGenerated(config, rows, results);

      const failures = (results as any[]).filter((item) => !item.ok).length;
      toast.success(`${config.label} : ${items.length - failures} traduction(s) générée(s)${failures ? `, ${failures} échec(s)` : ""}.`);
      await analyzeModule(key);
    } catch (error: any) {
      toast.error(error?.message ?? "Erreur de traduction");
    } finally {
      setRunning(null);
      setProgress({ done: 0, total: 0 });
    }
  }

  async function buildTranslateItems(config: ModuleConfig, rows: any[], langs: TargetLang[]) {
    if (config.mode === "native_columns") return nativeItems(config, rows, langs);
    if (config.mode === "pages_jsonb") return pagesItems(config, rows, langs);
    if (config.mode === "checklist_jsonb") return checklistItems(config, rows, langs);
    return contentTranslationItems(config, rows, langs);
  }

  async function contentTranslationItems(config: ModuleConfig, rows: any[], langs: TargetLang[]) {
    const ids = rows.map((row) => String(row.id));
    const [enT, arT] = await Promise.all([
      ids.length ? fetchTranslations(config.table, "en", ids) : Promise.resolve([]),
      ids.length ? fetchTranslations(config.table, "ar", ids) : Promise.resolve([]),
    ]);
    const maps = { en: indexTranslations(enT), ar: indexTranslations(arT) };
    const items: TranslateItem[] = [];
    for (const row of rows) {
      for (const field of config.fields ?? []) {
        const source = row[field];
        if (!isTranslatableString(source)) continue;
        for (const lang of langs) {
          if (!maps[lang][String(row.id)]?.[field]?.trim()) {
            items.push({
              table: config.table,
              rowId: String(row.id),
              field,
              sourceText: String(source),
              targetLang: lang,
              persist: true,
            });
          }
        }
      }
    }
    return items;
  }

  function nativeItems(config: ModuleConfig, rows: any[], langs: TargetLang[]) {
    const items: TranslateItem[] = [];
    for (const row of rows) {
      for (const base of config.nativeBases ?? []) {
        const source = row[`${base}_fr`];
        if (!isTranslatableString(source)) continue;
        for (const lang of langs) {
          if (!String(row[`${base}_${lang}`] ?? "").trim()) {
            items.push({
              table: `${config.table}_native`,
              rowId: `${row.id}:${base}:${lang}`,
              field: `${base}_${lang}`,
              sourceText: String(source),
              targetLang: lang,
              persist: false,
            });
          }
        }
      }
    }
    return items;
  }

  async function pagesItems(config: ModuleConfig, rows: any[], langs: TargetLang[]) {
    const items: TranslateItem[] = await contentTranslationItems({ ...config, mode: "content_translations", fields: ["title", "meta_description"] }, rows, langs);
    for (const row of rows) {
      for (const leaf of collectAllI18nLeaves(row.content)) {
        if (!leaf.fr.trim()) continue;
        for (const lang of langs) {
          if (!leaf[lang]?.trim()) {
            items.push({
              table: "pages_jsonb",
              rowId: `${row.id}::${leaf.path.join(".")}::${lang}`,
              field: lang,
              sourceText: leaf.fr,
              targetLang: lang,
              persist: false,
            });
          }
        }
      }
    }
    return items;
  }

  async function checklistItems(config: ModuleConfig, rows: any[], langs: TargetLang[]) {
    const baseItems = await contentTranslationItems(config, rows, langs);
    const jsonItems: TranslateItem[] = [];
    for (const row of rows) {
      for (const leaf of collectChecklistLeaves(row.items)) {
        if (!leaf.fr.trim()) continue;
        for (const lang of langs) {
          if (!leaf[lang]?.trim()) {
            jsonItems.push({
              table: "visa_checklist_jsonb",
              rowId: `${row.id}::${leaf.path.join(".")}::${lang}`,
              field: lang,
              sourceText: leaf.fr,
              targetLang: lang,
              persist: false,
            });
          }
        }
      }
    }
    return [...baseItems, ...jsonItems];
  }

  async function persistGenerated(config: ModuleConfig, rows: any[], results: any[]) {
    if (config.mode === "native_columns") {
      const updates: Record<string, any> = {};
      for (const result of results) {
        if (!result.ok || !result.value) continue;
        const [rowId, base, lang] = String(result.rowId).split(":");
        (updates[rowId] ||= {})[`${base}_${lang}`] = result.value;
      }
      for (const [rowId, patch] of Object.entries(updates)) await supabase.from(config.table as any).update(patch).eq("id", rowId);
      return;
    }

    if (config.mode === "pages_jsonb") {
      const byPage: Record<string, any[]> = {};
      for (const result of results) {
        if (!result.ok || !result.value) continue;
        const [pageId, pathStr, lang] = String(result.rowId).split("::");
        (byPage[pageId] ||= []).push({ path: pathStr.split("."), lang, value: result.value });
      }
      for (const page of rows) {
        const updates = byPage[page.id];
        if (!updates?.length) continue;
        const content = JSON.parse(JSON.stringify(page.content));
        for (const update of updates) setAtPath(content, update.path, update.lang, update.value);
        await supabase.from("pages").update({ content }).eq("id", page.id);
      }
      return;
    }

    if (config.mode === "checklist_jsonb") {
      const byChecklist: Record<string, any[]> = {};
      for (const result of results) {
        if (!result.ok || !result.value || String(result.table) !== "visa_checklist_jsonb") continue;
        const [rowId, pathStr, lang] = String(result.rowId).split("::");
        (byChecklist[rowId] ||= []).push({ path: pathStr.split("."), lang, value: result.value });
      }
      for (const row of rows) {
        const updates = byChecklist[row.id];
        if (!updates?.length) continue;
        const items = JSON.parse(JSON.stringify(row.items ?? []));
        for (const update of updates) setChecklistAtPath(items, update.path, update.lang, update.value);
        await supabase.from("visa_document_checklists").update({ items }).eq("id", row.id);
      }
    }
  }

  async function generateAllMissing() {
    setRunning("all");
    try {
      for (const key of visibleModules.map((module) => module.key)) await translateModule(key);
      toast.success("Génération des traductions manquantes terminée.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Traductions multilingues"
        description="Analyse et génère les traductions EN + AR du contenu V2 réutilisable, sans données personnelles."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={analyzeAll} disabled={loading || !!running}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Analyze all
            </Button>
            <Button onClick={generateAllMissing} disabled={!!running || loading}>
              <Sparkles className="w-4 h-4" />
              Generate all missing
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="flex flex-col gap-4 pt-4 md:flex-row md:items-end">
          <div className="min-w-56">
            <Label>Module</Label>
            <Select value={moduleFilter} onValueChange={(value) => setModuleFilter(value as ModuleKey | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les modules</SelectItem>
                {MODULES.map((module) => <SelectItem key={module.key} value={module.key}>{module.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label>Langue manquante</Label>
            <Select value={missingFilter} onValueChange={(value) => setMissingFilter(value as "all" | TargetLang)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Toutes</SelectItem>
                <SelectItem value="en">Anglais</SelectItem>
                <SelectItem value="ar">Arabe</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
            <Switch checked={publishedOnly} onCheckedChange={setPublishedOnly} id="published-only" />
            <Label htmlFor="published-only" className="cursor-pointer">Publié/actif uniquement</Label>
          </div>
        </CardContent>
      </Card>

      {running && progress.total > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span>Traduction en cours... ({progress.done}/{progress.total})</span>
              <span>{Math.round((progress.done / progress.total) * 100)}%</span>
            </div>
            <Progress value={(progress.done / progress.total) * 100} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {visibleModules.map((module) => {
          const moduleStats = stats[module.key];
          return (
            <Card key={module.key}>
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-lg">
                      <Languages className="w-5 h-5" />
                      {module.label}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{module.group} · {module.notes}</p>
                  </div>
                  <StatusBadge stats={moduleStats} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {moduleStats?.error ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{moduleStats.error}</p>
                ) : moduleStats ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <Badge variant="secondary">{moduleStats.rows} record(s)</Badge>
                    <Badge variant="secondary">{moduleStats.fields} champ(s) source</Badge>
                    <Badge className={moduleStats.missingEn > 0 ? "bg-orange-500" : "bg-emerald-600"}>
                      EN {moduleStats.missingEn}
                    </Badge>
                    <Badge className={moduleStats.missingAr > 0 ? "bg-orange-500" : "bg-emerald-600"}>
                      AR {moduleStats.missingAr}
                    </Badge>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Not analyzed</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => analyzeModule(module.key)} disabled={loading || !!running}>
                    <RefreshCw className="w-3.5 h-3.5" />
                    Analyze
                  </Button>
                  <Button size="sm" onClick={() => translateModule(module.key)} disabled={!!running || loading}>
                    {running === module.key ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                    Generate EN + AR
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="w-5 h-5" />
            Périmètre de sécurité
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Inclus: contenus publics, contenus agence visibles, règles de documents visa réutilisables, templates email métier et textes statiques stockés en base.
          </p>
          <p>
            Les traductions automatiques n’écrasent pas les traductions existantes. Les slugs ne sont pas traduits automatiquement.
            Les placeholders comme {"{{client_name}}"}, {"{{booking_ref}}"}, {"{{date}}"} et {"{{amount}}"} sont préservés par le prompt de traduction.
          </p>
          <div>
            <p className="font-medium text-foreground">Exclus volontairement:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {EXCLUDED_MODULES.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ stats }: { stats?: Stats }) {
  if (!stats) return <Badge variant="secondary">not analyzed</Badge>;
  if (stats.error) return <Badge variant="destructive">not analyzed</Badge>;
  if (stats.status === "complete") return <Badge className="bg-emerald-600">complete</Badge>;
  return <Badge className="bg-orange-500">partial</Badge>;
}

function makeStats(rows: number, fields: number, missingEn: number, missingAr: number): Stats {
  return {
    rows,
    fields,
    missingEn,
    missingAr,
    status: missingEn + missingAr === 0 ? "complete" : "partial",
  };
}

function isTranslatableString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

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
    if (Array.isArray(v)) v.forEach((x, index) => walk(x, [...p, String(index)]));
    else if (v && typeof v === "object") for (const key of Object.keys(v)) walk(v[key], [...p, key]);
  };
  walk(value, path);
  return out;
}

function collectChecklistLeaves(value: any, path: string[] = []): { path: string[]; fr: string; en?: string; ar?: string }[] {
  const out: { path: string[]; fr: string; en?: string; ar?: string }[] = [];
  const walk = (v: any, p: string[]) => {
    if (!v) return;
    if (typeof v === "object" && !Array.isArray(v)) {
      for (const base of ["title", "description", "notes"]) {
        const fr = v[`${base}_fr`] ?? v[base];
        if (isTranslatableString(fr)) {
          out.push({
            path: [...p, base],
            fr: String(fr),
            en: v[`${base}_en`],
            ar: v[`${base}_ar`],
          });
        }
      }
      for (const key of Object.keys(v)) {
        if (["title", "description", "notes", "title_fr", "description_fr", "notes_fr", "title_en", "description_en", "notes_en", "title_ar", "description_ar", "notes_ar"].includes(key)) continue;
        walk(v[key], [...p, key]);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach((item, index) => walk(item, [...p, String(index)]));
  };
  walk(value, path);
  return out;
}

function setChecklistAtPath(obj: any, path: string[], leafKey: "en" | "ar", val: string) {
  const base = path[path.length - 1];
  const parentPath = path.slice(0, -1);
  let cur = obj;
  for (const key of parentPath) cur = cur[key];
  if (!cur || typeof cur !== "object") return;
  cur[`${base}_${leafKey}`] = val;
}
