import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { invalidateRouteSlugs, type RouteSlug } from "@/hooks/useRouteSlugs";

const RESERVED = new Set(["admin", "supplier", "api", "auth", "blog", "lovable"]);
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function SiteSlugsEditor() {
  const [rows, setRows] = useState<RouteSlug[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("route_slugs")
      .select("*")
      .order("sort_order");
    setRows((data ?? []) as RouteSlug[]);
    const d: Record<string, string> = {};
    (data ?? []).forEach((r: any) => { d[r.route_key] = r.slug; });
    setDrafts(d);
  };

  useEffect(() => { load(); }, []);

  const save = async (row: RouteSlug) => {
    const next = (drafts[row.route_key] ?? "").trim().toLowerCase();
    if (!next) return toast.error("Le slug ne peut pas être vide.");
    if (!SLUG_RE.test(next)) return toast.error("Slug invalide (lettres minuscules, chiffres et tirets).");
    if (RESERVED.has(next)) return toast.error(`« ${next} » est un mot réservé.`);
    if (next === row.slug) return;
    // uniqueness
    const dup = rows.find((r) => r.route_key !== row.route_key && r.slug === next);
    if (dup) return toast.error(`Slug déjà utilisé par « ${dup.label} ».`);
    setSavingId(row.route_key);
    const { error } = await supabase
      .from("route_slugs")
      .update({ slug: next })
      .eq("route_key", row.route_key);
    setSavingId(null);
    if (error) return toast.error(error.message);
    toast.success(`Slug enregistré : /${next}`);
    invalidateRouteSlugs();
    load();
  };

  const reset = (row: RouteSlug) => {
    setDrafts((d) => ({ ...d, [row.route_key]: row.default_slug }));
  };

  return (
    <div className="bg-background rounded-2xl border border-border overflow-hidden mb-6">
      <div className="p-4 border-b border-border">
        <h2 className="font-semibold text-base">Slugs des pages du site</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Modifiez l'URL publique de chaque page. Les anciennes URL sont automatiquement redirigées vers les nouvelles.
        </p>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-secondary/50 text-left">
          <tr>
            <th className="p-4">Page</th>
            <th className="p-4">Slug (URL)</th>
            <th className="p-4">Aperçu</th>
            <th className="p-4 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const draft = drafts[r.route_key] ?? r.slug;
            const dirty = draft !== r.slug;
            return (
              <tr key={r.route_key} className="hover:bg-secondary/20">
                <td className="p-4 font-medium">
                  {r.label}
                  {r.slug !== r.default_slug && (
                    <span className="ml-2 text-[10px] text-muted-foreground">
                      (par défaut : /{r.default_slug})
                    </span>
                  )}
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-1">
                    <span className="text-muted-foreground">/</span>
                    <Input
                      value={draft}
                      onChange={(e) =>
                        setDrafts((d) => ({ ...d, [r.route_key]: e.target.value }))
                      }
                      className="max-w-xs h-9"
                    />
                  </div>
                </td>
                <td className="p-4 font-mono text-xs text-muted-foreground">/{draft}</td>
                <td className="p-4 text-right space-x-2">
                  {draft !== r.default_slug && (
                    <Button size="sm" variant="ghost" onClick={() => reset(r)} title="Réinitialiser au défaut">
                      <RotateCcw className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={!dirty || savingId === r.route_key}
                    onClick={() => save(r)}
                  >
                    <Save className="w-4 h-4" /> Enregistrer
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
