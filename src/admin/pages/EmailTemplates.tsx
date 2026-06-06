import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Eye, Mail, Save, Search, Send, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  extractTemplateVariables,
  renderEmailTemplateString,
  REQUIRED_EMAIL_TEMPLATES,
  sampleVariablesForTemplate,
  type EmailTemplateDefinition,
} from "@/lib/email-templates";

type DbEmailTemplate = {
  id?: string;
  key?: string | null;
  name?: string | null;
  category?: string | null;
  language?: string | null;
  subject?: string | null;
  body_html?: string | null;
  body_text?: string | null;
  html_body?: string | null;
  preheader?: string | null;
  is_active?: boolean | null;
  is_system?: boolean | null;
  allowed_variables?: string[] | null;
  required_variables?: string[] | null;
  metadata?: Record<string, unknown> | null;
  updated_at?: string | null;
};

const categories = ["Toutes", "Réservations", "Paiements", "Visa", "Agences", "Fournisseurs", "Système"];
const languages = ["fr", "en", "ar"];

const templateIdentity = (row: DbEmailTemplate) => String(row.key || row.metadata?.key || row.name || "");
const htmlBody = (row: DbEmailTemplate | null | undefined, fallback: string) => row?.body_html ?? row?.html_body ?? fallback;
const textBody = (row: DbEmailTemplate | null | undefined, fallback: string) => row?.body_text ?? row?.preheader ?? fallback;

function variableWarnings(def: EmailTemplateDefinition, subject: string, body: string) {
  const used = extractTemplateVariables(`${subject}\n${body}`);
  const unknown = used.filter((variable) => !def.allowedVariables.includes(variable));
  const missing = def.requiredVariables.filter((variable) => !used.includes(variable));
  return { used, unknown, missing };
}

async function edgeFunctionErrorMessage(error: any, fallback = "Impossible d'envoyer l'email de test.") {
  const context = error?.context;
  if (context && typeof context.json === "function") {
    try {
      const json = await context.json();
      return [json.detail, json.error, json.message].filter(Boolean).join(" — ") || fallback;
    } catch {
      // Fall through to the text/body message below.
    }
  }
  if (context && typeof context.text === "function") {
    try {
      const text = await context.text();
      if (text) return text;
    } catch {
      // Fall through to the generic Supabase error.
    }
  }
  return error?.message ?? fallback;
}

export default function EmailTemplates() {
  const { user } = useAuth();
  const [dbRows, setDbRows] = useState<DbEmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Toutes");
  const [language, setLanguage] = useState("fr");
  const [selectedKey, setSelectedKey] = useState(REQUIRED_EMAIL_TEMPLATES[0].key);
  const [draft, setDraft] = useState({
    name: "",
    subject: "",
    bodyHtml: "",
    bodyText: "",
    active: true,
    language: "fr",
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [testEmail, setTestEmail] = useState(user?.email ?? "");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("email_templates").select("*").order("updated_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setDbRows([]);
    } else {
      setDbRows((data ?? []) as DbEmailTemplate[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!testEmail && user?.email) setTestEmail(user.email);
  }, [user?.email, testEmail]);

  const selectedDef = useMemo(
    () => REQUIRED_EMAIL_TEMPLATES.find((template) => template.key === selectedKey) ?? REQUIRED_EMAIL_TEMPLATES[0],
    [selectedKey]
  );

  const selectedRow = useMemo(
    () => dbRows.find((row) => templateIdentity(row) === selectedDef.key && (row.language ?? "fr") === language) ?? null,
    [dbRows, language, selectedDef.key]
  );

  useEffect(() => {
    setDraft({
      name: selectedRow?.name && selectedRow.name !== selectedDef.key ? selectedRow.name : selectedDef.name,
      subject: selectedRow?.subject ?? selectedDef.subject,
      bodyHtml: htmlBody(selectedRow, selectedDef.bodyHtml),
      bodyText: textBody(selectedRow, selectedDef.bodyText),
      active: selectedRow?.is_active ?? selectedRow?.is_system ?? true,
      language,
    });
  }, [language, selectedDef, selectedRow]);

  const filteredDefinitions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return REQUIRED_EMAIL_TEMPLATES.filter((template) => {
      const matchesCategory = category === "Toutes" || template.category === category;
      const haystack = `${template.key} ${template.name} ${template.subject} ${template.category}`.toLowerCase();
      return matchesCategory && (!needle || haystack.includes(needle));
    });
  }, [category, query]);

  const warnings = variableWarnings(selectedDef, draft.subject, `${draft.bodyHtml}\n${draft.bodyText}`);
  const sample = sampleVariablesForTemplate(selectedDef);
  const previewSubject = renderEmailTemplateString(draft.subject, sample);
  const previewHtml = renderEmailTemplateString(draft.bodyHtml, sample);

  const save = async () => {
    setSaving(true);
    try {
      const existingId = selectedRow?.id;
      const payload: Record<string, unknown> = {
        key: selectedDef.key,
        name: draft.name || selectedDef.name,
        category: selectedDef.category,
        language: draft.language,
        subject: draft.subject,
        body_html: draft.bodyHtml,
        html_body: draft.bodyHtml,
        body_text: draft.bodyText,
        preheader: draft.bodyText,
        allowed_variables: selectedDef.allowedVariables,
        required_variables: selectedDef.requiredVariables,
        is_active: draft.active,
        is_system: draft.active,
        metadata: {
          ...(selectedRow?.metadata ?? {}),
          key: selectedDef.key,
          display_name: draft.name || selectedDef.name,
          variable_warnings: {
            unknown: warnings.unknown,
            missing: warnings.missing,
          },
        },
        updated_at: new Date().toISOString(),
      };

      const result = existingId
        ? await supabase.from("email_templates").update(payload as any).eq("id", existingId)
        : await supabase.from("email_templates").insert(payload as any);

      if (result.error) throw result.error;
      toast.success(warnings.unknown.length || warnings.missing.length
        ? "Template enregistré avec avertissements de variables."
        : "Template enregistré.");
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer le template.");
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testEmail.trim()) return toast.error("Renseignez un email de test.");
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-admin-notification", {
        body: {
          type: "test_template",
          payload: {
            recipient: testEmail.trim(),
            subject: previewSubject,
            html: previewHtml,
            text: renderEmailTemplateString(draft.bodyText, sample),
            template_key: selectedDef.key,
          },
        },
      });
      if (error) throw new Error(await edgeFunctionErrorMessage(error));
      if (data?.ok === false) throw new Error(data.detail || data.error || "Test email échoué.");
      toast.success("Email de test envoyé.");
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'envoyer l'email de test.");
    } finally {
      setSending(false);
    }
  };

  const savedCount = REQUIRED_EMAIL_TEMPLATES.filter((template) => dbRows.some((row) => templateIdentity(row) === template.key)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Templates email"
        description="Modèles transactionnels utilisés par les réservations, paiements, visas, agences, fournisseurs et notifications système."
      />

      <Alert>
        <TriangleAlert className="h-4 w-4" />
        <AlertTitle>Schéma actuel partiellement compatible</AlertTitle>
        <AlertDescription>
          La table existante permet d'éditer le sujet et le HTML. Les colonnes métier recommandées
          (`key`, `body_text`, `allowed_variables`, `required_variables`, `is_active`, `metadata`) doivent être ajoutées par migration SQL pour une gestion complète.
        </AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle>Templates</CardTitle>
                <p className="text-sm text-muted-foreground">{savedCount}/{REQUIRED_EMAIL_TEMPLATES.length} templates présents en base</p>
              </div>
              <Badge variant={loading ? "secondary" : "outline"}>{loading ? "Chargement" : "V2"}</Badge>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un template" className="pl-9" />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent>
            </Select>
          </CardHeader>
          <CardContent className="space-y-2">
            {filteredDefinitions.map((template) => {
              const saved = dbRows.find((row) => templateIdentity(row) === template.key);
              const active = saved?.is_active ?? saved?.is_system ?? true;
              return (
                <button
                  key={template.key}
                  type="button"
                  onClick={() => setSelectedKey(template.key)}
                  className={`w-full rounded-lg border p-3 text-left transition hover:bg-muted ${template.key === selectedKey ? "border-primary bg-primary/5" : "border-border"}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{template.name}</p>
                    <Badge variant={saved ? active ? "default" : "secondary" : "outline"}>{saved ? active ? "Actif" : "Inactif" : "À créer"}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{template.key}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{template.subject}</p>
                </button>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedDef.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{selectedDef.key} · {selectedDef.category}</p>
              </div>
              <div className="flex gap-2">
                <Select value={language} onValueChange={setLanguage}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>{languages.map((item) => <SelectItem key={item} value={item}>{item.toUpperCase()}</SelectItem>)}</SelectContent>
                </Select>
                <Button variant="outline" onClick={() => setPreviewOpen(true)}><Eye className="h-4 w-4" /> Preview</Button>
                <Button onClick={save} disabled={saving}><Save className="h-4 w-4" /> {saving ? "Enregistrement..." : "Enregistrer"}</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Nom du template</Label>
                <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
              </div>
              <div>
                <Label>Statut</Label>
                <Select value={draft.active ? "active" : "inactive"} onValueChange={(value) => setDraft((current) => ({ ...current, active: value === "active" }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Actif</SelectItem>
                    <SelectItem value="inactive">Inactif</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={draft.subject} onChange={(event) => setDraft((current) => ({ ...current, subject: event.target.value }))} />
            </div>
            <div>
              <Label>HTML / body</Label>
              <Textarea value={draft.bodyHtml} onChange={(event) => setDraft((current) => ({ ...current, bodyHtml: event.target.value }))} rows={16} className="font-mono text-xs" />
            </div>
            <div>
              <Label>Plain text fallback</Label>
              <Textarea value={draft.bodyText} onChange={(event) => setDraft((current) => ({ ...current, bodyText: event.target.value }))} rows={7} />
            </div>

            <div className="rounded-lg border bg-muted/30 p-4">
              <p className="font-medium">Variables disponibles</p>
              <p className="text-sm text-muted-foreground">Ne modifiez pas les variables entre {"{{ }}"}.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {selectedDef.allowedVariables.map((variable) => <Badge key={variable} variant="secondary">{"{{"}{variable}{"}}"}</Badge>)}
              </div>
              {(warnings.unknown.length > 0 || warnings.missing.length > 0) && (
                <div className="mt-4 space-y-2 text-sm">
                  {warnings.unknown.length > 0 && <p className="text-amber-700">Variables inconnues: {warnings.unknown.join(", ")}</p>}
                  {warnings.missing.length > 0 && <p className="text-amber-700">Variables requises absentes: {warnings.missing.join(", ")}</p>}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
              <div className="min-w-64 flex-1">
                <Label>Email de test</Label>
                <Input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="admin@lejapon.ma" />
              </div>
              <Button variant="outline" onClick={sendTest} disabled={sending}><Send className="h-4 w-4" /> {sending ? "Envoi..." : "Envoyer test"}</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> Preview — {previewSubject}</DialogTitle></DialogHeader>
          <div className="max-h-[70vh] overflow-auto rounded-lg border bg-white p-4">
            <iframe title="Email preview" srcDoc={previewHtml} className="h-[560px] w-full rounded border" />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
