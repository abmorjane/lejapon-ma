import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Trash2, Plus, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { ensureI18n, type I18nString } from "@/lib/i18n-content";

type ItemField = { key: string; label: string; noI18n?: boolean; rows?: number };
type Field =
  | { key: string; label: string; type: "text" | "textarea"; placeholder?: string; rows?: number; help?: string }
  | { key: string; label: string; type: "url" | "switch"; placeholder?: string; help?: string }
  | { key: string; label: string; type: "list"; itemFields: ItemField[]; help?: string };
type Group = { title: string; fields: Field[] };
type Section = {
  slug: string;
  title: string;
  shortTitle?: string;
  description: string;
  fields?: Field[];
  groups?: Group[];
};

const LANGS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
  { code: "ar", label: "العربية" },
] as const;

const SECTIONS: Section[] = [
  {
    slug: "site:home",
    title: "Page d'accueil",
    shortTitle: "Accueil",
    description: "Tous les textes affichés sur la page d'accueil du site.",
    groups: [
      {
        title: "Hero (en-tête principal)",
        fields: [
          { key: "hero_badge", label: "Badge (Sakura 2026 · 4 places…)", type: "text" },
          { key: "hero_title_l1", label: "Titre — ligne 1", type: "text" },
          { key: "hero_title_l2", label: "Titre — ligne 2 (en orange dégradé)", type: "text" },
          { key: "hero_subtitle", label: "Sous-titre", type: "textarea", rows: 3 },
          { key: "hero_cta_primary", label: "Bouton principal", type: "text" },
          { key: "hero_cta_secondary", label: "Bouton secondaire", type: "text" },
          { key: "hero_trust_count", label: "Bloc confiance — chiffre", type: "text" },
          { key: "hero_trust_text", label: "Bloc confiance — texte", type: "text" },
          { key: "hero_rating_value", label: "Note Google — valeur", type: "text" },
          { key: "hero_rating_text", label: "Note Google — texte", type: "text" },
          { key: "hero_scroll", label: "Texte « Découvrir »", type: "text" },
        ],
      },
      {
        title: "Barre de stats",
        fields: [
          { key: "stat1_v", label: "Stat 1 — valeur", type: "text" },
          { key: "stat1_k", label: "Stat 1 — libellé", type: "text" },
          { key: "stat2_v", label: "Stat 2 — valeur", type: "text" },
          { key: "stat2_k", label: "Stat 2 — libellé", type: "text" },
          { key: "stat3_v", label: "Stat 3 — valeur", type: "text" },
          { key: "stat3_k", label: "Stat 3 — libellé", type: "text" },
          { key: "stat4_v", label: "Stat 4 — valeur", type: "text" },
          { key: "stat4_k", label: "Stat 4 — libellé", type: "text" },
        ],
      },
      {
        title: "Nos prochains départs",
        fields: [
          { key: "trips_eyebrow", label: "Eyebrow", type: "text" },
          { key: "trips_title_main", label: "Titre — début", type: "text" },
          { key: "trips_title_accent", label: "Titre — partie en accent", type: "text" },
          { key: "trips_link", label: "Lien « Voir tous les voyages »", type: "text" },
          { key: "trips_empty", label: "Texte si aucun départ", type: "text" },
        ],
      },
      {
        title: "Pourquoi nous choisir",
        fields: [
          { key: "why_eyebrow", label: "Eyebrow", type: "text" },
          { key: "why_title_main", label: "Titre — début", type: "text" },
          { key: "why_title_accent", label: "Titre — partie en dégradé", type: "text" },
          { key: "why_intro", label: "Introduction", type: "textarea", rows: 2 },
          { key: "why1_t", label: "Carte 1 — titre", type: "text" },
          { key: "why1_d", label: "Carte 1 — description", type: "textarea", rows: 2 },
          { key: "why2_t", label: "Carte 2 — titre", type: "text" },
          { key: "why2_d", label: "Carte 2 — description", type: "textarea", rows: 2 },
          { key: "why3_t", label: "Carte 3 — titre", type: "text" },
          { key: "why3_d", label: "Carte 3 — description", type: "textarea", rows: 2 },
          { key: "why4_t", label: "Carte 4 — titre", type: "text" },
          { key: "why4_d", label: "Carte 4 — description", type: "textarea", rows: 2 },
        ],
      },
      {
        title: "Comment ça marche",
        fields: [
          { key: "how_eyebrow", label: "Eyebrow", type: "text" },
          { key: "how_title_main", label: "Titre — début", type: "text" },
          { key: "how_title_accent", label: "Titre — partie en dégradé", type: "text" },
          { key: "step1_t", label: "Étape 1 — titre", type: "text" },
          { key: "step1_d", label: "Étape 1 — description", type: "textarea", rows: 2 },
          { key: "step2_t", label: "Étape 2 — titre", type: "text" },
          { key: "step2_d", label: "Étape 2 — description", type: "textarea", rows: 2 },
          { key: "step3_t", label: "Étape 3 — titre", type: "text" },
          { key: "step3_d", label: "Étape 3 — description", type: "textarea", rows: 2 },
        ],
      },
      {
        title: "Plans extra (expériences)",
        fields: [
          { key: "exp_eyebrow", label: "Eyebrow", type: "text" },
          { key: "exp_title_l1", label: "Titre — ligne 1", type: "text" },
          { key: "exp_title_l2", label: "Titre — ligne 2", type: "text" },
          { key: "exp_link", label: "Lien « Voir toutes les expériences »", type: "text" },
          { key: "exp_empty", label: "Texte si aucune activité", type: "text" },
        ],
      },
      {
        title: "Témoignages",
        fields: [
          { key: "test_eyebrow", label: "Eyebrow", type: "text" },
          { key: "test_title_main", label: "Titre — début", type: "text" },
          { key: "test_title_accent", label: "Titre — partie en dégradé", type: "text" },
          {
            key: "testimonials",
            label: "Témoignages affichés",
            type: "list",
            itemFields: [
              { key: "name", label: "Nom", noI18n: true },
              { key: "city", label: "Ville", noI18n: true },
              { key: "quote", label: "Citation", rows: 3 },
            ],
          },
        ],
      },
      {
        title: "Transparence totale (garanties)",
        fields: [
          { key: "gua1_t", label: "Garantie 1 — titre", type: "text" },
          { key: "gua1_d", label: "Garantie 1 — description", type: "text" },
          { key: "gua2_t", label: "Garantie 2 — titre", type: "text" },
          { key: "gua2_d", label: "Garantie 2 — description", type: "text" },
          { key: "gua3_t", label: "Garantie 3 — titre", type: "text" },
          { key: "gua3_d", label: "Garantie 3 — description", type: "text" },
          { key: "gua4_t", label: "Garantie 4 — titre", type: "text" },
          { key: "gua4_d", label: "Garantie 4 — description", type: "text" },
        ],
      },
      {
        title: "Bloc final (CTA)",
        fields: [
          { key: "cta_badge", label: "Badge", type: "text" },
          { key: "cta_title", label: "Titre", type: "text" },
          { key: "cta_subtitle", label: "Sous-titre", type: "textarea", rows: 2 },
          { key: "cta_primary", label: "Bouton principal", type: "text" },
          { key: "cta_secondary", label: "Bouton secondaire", type: "text" },
        ],
      },
    ],
  },
  {
    slug: "site:promo-bar",
    title: "Bandeau promo (en-tête de toutes les pages)",
    shortTitle: "Bandeau promo",
    description: "La bande orange affichée tout en haut du site.",
    fields: [
      { key: "enabled", label: "Afficher le bandeau", type: "switch" },
      { key: "text", label: "Texte principal", type: "text", placeholder: "Sakura 2026 · 4 places restantes" },
      { key: "cta_label", label: "Texte du lien", type: "text", placeholder: "Réserver maintenant" },
      { key: "cta_url", label: "URL du lien", type: "url", placeholder: "/reserver" },
    ],
  },
  {
    slug: "site:contact",
    title: "Page Contact",
    shortTitle: "Contact",
    description: "Textes affichés sur /contact.",
    fields: [
      { key: "eyebrow", label: "Petit titre (eyebrow)", type: "text" },
      { key: "title_main", label: "Titre principal", type: "text" },
      { key: "title_accent", label: "Titre — partie en italique orange", type: "text" },
      { key: "intro", label: "Introduction", type: "textarea", rows: 3 },
      { key: "email", label: "Adresse email publique", type: "url" },
      { key: "agency_name", label: "Nom de l'agence", type: "text" },
      {
        key: "addresses",
        label: "Agences",
        type: "list",
        itemFields: [
          { key: "city", label: "Ville" },
          { key: "line", label: "Adresse complète" },
        ],
      },
      { key: "success_title", label: "Titre après envoi du formulaire", type: "text" },
      { key: "success_text", label: "Message après envoi", type: "textarea", rows: 2 },
    ],
  },
  {
    slug: "site:about",
    title: "Page À propos",
    shortTitle: "À propos",
    description: "Textes affichés sur /a-propos.",
    fields: [
      { key: "hero_eyebrow", label: "Hero — eyebrow", type: "text" },
      { key: "hero_title_main", label: "Hero — titre principal", type: "text" },
      { key: "hero_title_accent", label: "Hero — titre italique orange", type: "text" },
      { key: "hero_intro", label: "Hero — introduction", type: "textarea", rows: 3 },
      { key: "hero_card_label", label: "Hero — étiquette carte", type: "text" },
      { key: "hero_card_text", label: "Hero — texte carte", type: "text" },
      { key: "story_eyebrow", label: "Notre histoire — eyebrow", type: "text" },
      { key: "story_title_main", label: "Notre histoire — titre", type: "text" },
      { key: "story_title_accent", label: "Notre histoire — titre italique orange", type: "text" },
      { key: "story_p1", label: "Histoire — paragraphe 1", type: "textarea", rows: 4 },
      { key: "story_p2", label: "Histoire — paragraphe 2", type: "textarea", rows: 4 },
      { key: "story_p3", label: "Histoire — paragraphe 3", type: "textarea", rows: 4 },
      { key: "stat1_value", label: "Stat 1 — valeur", type: "text" },
      { key: "stat1_label", label: "Stat 1 — libellé", type: "text" },
      { key: "stat2_value", label: "Stat 2 — valeur", type: "text" },
      { key: "stat2_label", label: "Stat 2 — libellé", type: "text" },
      { key: "stat3_value", label: "Stat 3 — valeur", type: "text" },
      { key: "stat3_label", label: "Stat 3 — libellé", type: "text" },
      { key: "omotenashi_quote", label: "Omotenashi — citation", type: "textarea", rows: 4 },
      { key: "omotenashi_subtitle", label: "Omotenashi — sous-texte", type: "textarea", rows: 2 },
      { key: "conclusion_quote", label: "Conclusion — citation", type: "textarea", rows: 3 },
    ],
  },
];

export default function Frontend() {
  const [data, setData] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase
        .from("pages")
        .select("slug,content")
        .in("slug", SECTIONS.map((s) => s.slug));
      const d: Record<string, any> = {};
      (rows ?? []).forEach((r) => (d[r.slug] = r.content ?? {}));
      setData(d);
      setLoading(false);
    })();
  }, []);

  const update = (slug: string, key: string, value: any) =>
    setData((d) => ({ ...d, [slug]: { ...(d[slug] ?? {}), [key]: value } }));

  const save = async (slug: string) => {
    setSaving(slug);
    const { error } = await supabase.from("pages").update({ content: data[slug] ?? {} }).eq("slug", slug);
    setSaving(null);
    if (error) return toast.error("Erreur : " + error.message);
    toast.success("Modifications enregistrées — visibles immédiatement sur le site.");
  };

  if (loading) return <div className="p-8 text-muted-foreground">Chargement…</div>;

  return (
    <div>
      <PageHeader
        title="Frontend — textes du site"
        description="Modifiez les textes affichés sur le site sans toucher au code. Les changements sont publiés immédiatement."
      />
      <Tabs defaultValue={SECTIONS[0].slug} className="w-full">
        <TabsList className="mb-6 flex flex-wrap h-auto gap-1 bg-muted/60 p-1">
          {SECTIONS.map((s) => (
            <TabsTrigger key={s.slug} value={s.slug} className="text-xs sm:text-sm">
              {s.shortTitle ?? s.title.split(" (")[0]}
            </TabsTrigger>
          ))}
        </TabsList>
        {SECTIONS.map((section) => {
          const v = data[section.slug] ?? {};
          const renderField = (f: Field) => (
            <FieldEditor
              key={f.key}
              field={f}
              value={v[f.key]}
              onChange={(val) => update(section.slug, f.key, val)}
            />
          );
          return (
            <TabsContent key={section.slug} value={section.slug}>
              <div className="space-y-5">
                <div className="bg-background border border-border rounded-2xl p-6 md:p-8">
                  <h2 className="font-display text-xl mb-1">{section.title}</h2>
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Pour chaque texte, renseignez les versions <strong>FR</strong>, <strong>EN</strong> et <strong>AR</strong>.
                    Si une traduction est vide, le français sera affiché par défaut.
                  </p>
                </div>

                {section.groups ? (
                  section.groups.map((g) => (
                    <details key={g.title} open className="bg-background border border-border rounded-2xl overflow-hidden">
                      <summary className="cursor-pointer px-6 py-4 font-display text-lg hover:bg-muted/40 transition-colors select-none">
                        {g.title}
                      </summary>
                      <div className="p-6 grid gap-5 border-t border-border">{g.fields.map(renderField)}</div>
                    </details>
                  ))
                ) : (
                  <div className="bg-background border border-border rounded-2xl p-6 md:p-8">
                    <div className="grid gap-5">{(section.fields ?? []).map(renderField)}</div>
                  </div>
                )}

                <div className="sticky bottom-4 z-10 flex justify-end">
                  <Button
                    onClick={() => save(section.slug)}
                    disabled={saving === section.slug}
                    size="lg"
                    className="shadow-lg"
                  >
                    {saving === section.slug ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Enregistrer cette section
                  </Button>
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

function FieldEditor({ field, value, onChange }: { field: Field; value: any; onChange: (v: any) => void }) {
  if (field.type === "switch") {
    return (
      <div className="flex items-center justify-between gap-4 p-4 border border-border rounded-xl">
        <Label className="text-sm font-medium">{field.label}</Label>
        <Switch checked={!!value} onCheckedChange={onChange} />
      </div>
    );
  }
  if (field.type === "url") {
    return (
      <div>
        <Label className="text-sm font-medium mb-2 block">{field.label}</Label>
        <Input value={value ?? ""} placeholder={(field as any).placeholder} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }
  if (field.type === "list") {
    const items: any[] = Array.isArray(value) ? value : [];
    return (
      <div>
        <Label className="text-sm font-medium mb-2 block">{field.label}</Label>
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="space-y-3 p-4 border border-border rounded-xl relative bg-muted/20">
              {field.itemFields.map((sub) =>
                sub.noI18n ? (
                  <div key={sub.key}>
                    <Label className="text-xs text-muted-foreground mb-1 block">{sub.label}</Label>
                    <Input
                      value={item?.[sub.key] ?? ""}
                      onChange={(e) => {
                        const next = [...items];
                        next[idx] = { ...next[idx], [sub.key]: e.target.value };
                        onChange(next);
                      }}
                    />
                  </div>
                ) : (
                  <I18nEditor
                    key={sub.key}
                    label={sub.label}
                    rows={sub.rows}
                    value={item?.[sub.key]}
                    onChange={(v) => {
                      const next = [...items];
                      next[idx] = { ...next[idx], [sub.key]: v };
                      onChange(next);
                    }}
                  />
                ),
              )}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                className="absolute -top-2 -right-2 bg-background border border-border rounded-full p-1 text-destructive hover:bg-destructive hover:text-destructive-foreground"
                aria-label="Supprimer"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange([
                ...items,
                Object.fromEntries(field.itemFields.map((s) => [s.key, s.noI18n ? "" : { fr: "", en: "", ar: "" }])),
              ])
            }
          >
            <Plus className="w-4 h-4" /> Ajouter
          </Button>
        </div>
      </div>
    );
  }
  // text / textarea → i18n editor
  return (
    <I18nEditor
      label={field.label}
      rows={field.type === "textarea" ? (field as any).rows ?? 3 : undefined}
      value={value}
      placeholder={(field as any).placeholder}
      onChange={onChange}
    />
  );
}

function I18nEditor({
  label,
  value,
  onChange,
  rows,
  placeholder,
}: {
  label: string;
  value: any;
  onChange: (v: I18nString) => void;
  rows?: number;
  placeholder?: string;
}) {
  const v = ensureI18n(value);
  const set = (lang: keyof I18nString, txt: string) => onChange({ ...v, [lang]: txt });

  return (
    <div>
      <Label className="text-sm font-medium mb-2 block">{label}</Label>
      <Tabs defaultValue="fr" className="w-full">
        <TabsList className="mb-2 h-8">
          {LANGS.map((l) => (
            <TabsTrigger key={l.code} value={l.code} className="text-xs px-3 py-1 h-7">
              {l.label}
              {!v[l.code as keyof I18nString] && l.code !== "fr" && (
                <span className="ml-1.5 text-[10px] text-muted-foreground">(vide)</span>
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {LANGS.map((l) => (
          <TabsContent key={l.code} value={l.code} className="mt-0">
            {rows ? (
              <Textarea
                rows={rows}
                value={v[l.code as keyof I18nString] ?? ""}
                placeholder={l.code === "fr" ? placeholder : `Traduction ${l.label.toLowerCase()}…`}
                dir={l.code === "ar" ? "rtl" : "ltr"}
                onChange={(e) => set(l.code as keyof I18nString, e.target.value)}
              />
            ) : (
              <Input
                value={v[l.code as keyof I18nString] ?? ""}
                placeholder={l.code === "fr" ? placeholder : `Traduction ${l.label.toLowerCase()}…`}
                dir={l.code === "ar" ? "rtl" : "ltr"}
                onChange={(e) => set(l.code as keyof I18nString, e.target.value)}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}