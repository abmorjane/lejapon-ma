import { useMemo, useState } from "react";
import { Check, RotateCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/admin/components/PageHeader";
import {
  ADMIN_THEMES,
  DEFAULT_ADMIN_THEME,
  type AdminThemeId,
  readAdminTheme,
  resetAdminTheme,
  saveAdminTheme,
} from "@/admin/theme";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export default function Theme() {
  const initialTheme = useMemo(() => readAdminTheme(), []);
  const [selectedTheme, setSelectedTheme] = useState<AdminThemeId>(initialTheme);
  const [savedTheme, setSavedTheme] = useState<AdminThemeId>(initialTheme);

  const handleSave = () => {
    saveAdminTheme(selectedTheme);
    setSavedTheme(selectedTheme);
    toast.success("Thème admin enregistré.");
  };

  const handleReset = () => {
    resetAdminTheme();
    setSelectedTheme(DEFAULT_ADMIN_THEME);
    setSavedTheme(DEFAULT_ADMIN_THEME);
    toast.success("Thème classique restauré.");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Thème admin"
        description="Choisissez l'apparence du back-office sans modifier les données ni les routes."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {Object.values(ADMIN_THEMES).map((theme) => {
          const selected = selectedTheme === theme.id;
          const active = savedTheme === theme.id;
          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => setSelectedTheme(theme.id)}
              className={cn(
                "text-left rounded-2xl border bg-card p-5 shadow-sm transition hover:border-accent/60",
                selected && "border-accent ring-2 ring-accent/15"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-display text-lg">{theme.name}</h2>
                    {active && <Badge variant="secondary">Actif</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{theme.description}</p>
                </div>
                {selected && <Check className="h-5 w-5 text-accent" />}
              </div>

              <div
                className="mt-5 overflow-hidden rounded-xl border"
                data-admin-theme={theme.id}
                aria-hidden
              >
                <div className="flex min-h-[180px] bg-[hsl(var(--admin-bg))] text-[hsl(var(--admin-text))]">
                  <div className="w-28 bg-[hsl(var(--admin-sidebar-bg))] p-3 text-[hsl(var(--admin-sidebar-text))]">
                    <div className="mb-4 h-4 w-16 rounded bg-current/20" />
                    <div className="space-y-2">
                      <div className="h-6 rounded bg-current/20" />
                      <div className="h-6 rounded bg-current/10" />
                      <div className="h-6 rounded bg-current/10" />
                    </div>
                  </div>
                  <div className="flex-1 p-4">
                    <div className="mb-4 h-8 rounded-[var(--admin-card-radius)] border border-[hsl(var(--admin-card-border))] bg-[hsl(var(--admin-card-bg))]" />
                    <div className="rounded-[var(--admin-card-radius)] border border-[hsl(var(--admin-card-border))] bg-[hsl(var(--admin-card-bg))] p-3 shadow-[var(--admin-card-shadow)]">
                      <div className="mb-3 h-4 w-28 rounded bg-foreground/10" />
                      <div className="space-y-2">
                        <div className="h-3 rounded bg-foreground/10" />
                        <div className="h-3 rounded bg-foreground/10" />
                        <div className="h-3 w-2/3 rounded bg-foreground/10" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aperçu et activation</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">
              Thème sélectionné: {ADMIN_THEMES[selectedTheme].name}
            </p>
            <p className="text-sm text-muted-foreground">
              Thème actif: {ADMIN_THEMES[savedTheme].name}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleReset}>
              <RotateCcw className="h-4 w-4" /> Réinitialiser
            </Button>
            <Button onClick={handleSave}>
              <Save className="h-4 w-4" /> Enregistrer le thème
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
