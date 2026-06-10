import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useRef, useState } from "react";
import { Plus, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/admin/components/PageHeader";
import type { JapanSupplier } from "@/lib/international-payments";

const db = supabase as any;
const bucket = "international-payments";

const emptySupplier: JapanSupplier = {
  name: "",
  category: "other",
  address: "",
  email: "",
  phone: "",
  website: "",
  notes: "",
  bank_name: "",
  branch_name: "",
  bank_code: "",
  branch_code: "",
  account_type: "",
  account_number: "",
  account_holder: "",
  status: "active",
};

const supplierCategoryLabels: Record<string, string> = {
  main_partner: "Bureau Japon principal",
  hotel: "Hôtel",
  bus: "Bus company",
  transport: "Transport",
  guide: "Guide company",
  activity: "Activity provider",
  restaurant: "Restaurant partner",
  other: "Other supplier",
};

const fileNameSafe = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "fichier";

export default function VisaSettings() {
  const [s, setS] = useState<any | null>(null);
  const [suppliers, setSuppliers] = useState<JapanSupplier[]>([]);
  const [supplierDraft, setSupplierDraft] = useState<JapanSupplier>(emptySupplier);
  const [busy, setBusy] = useState<string | null>(null);
  const [supplierSqlMissing, setSupplierSqlMissing] = useState(false);

  useEffect(() => {
    void loadVisaSettings();
    void loadSuppliers();
  }, []);

  const loadVisaSettings = async () => {
    const { data, error } = await supabase.from("visa_settings").select("*").limit(1).maybeSingle();
    if (error) toast.error(error.message);
    else setS(data);
  };

  const loadSuppliers = async () => {
    const { data, error } = await db.from("japan_suppliers").select("*").order("category").order("name");
    if (error) {
      setSupplierSqlMissing(true);
      setSuppliers([]);
      return;
    }
    setSupplierSqlMissing(false);
    const rows = data ?? [];
    setSuppliers(rows);
    const main = rows.find((supplier: JapanSupplier) => supplier.category === "main_partner") ?? rows[0];
    setSupplierDraft(main ?? { ...emptySupplier, category: "main_partner", name: "Tapis Volant LLC" });
  };

  const upd = (p: any) => setS((x: any) => ({ ...x, ...p }));

  const saveVisa = async () => {
    if (!s) return;
    setBusy("visa");
    const { id, created_at, updated_at, ...payload } = s;
    const { error } = await supabase.from("visa_settings").update(payload).eq("id", s.id);
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Paramètres visa enregistrés");
  };

  const saveSupplier = async () => {
    if (!supplierDraft.name?.trim()) return toast.error("Nom fournisseur requis.");
    setBusy("supplier");
    const payload = {
      ...supplierDraft,
      status: supplierDraft.status || "active",
      category: supplierDraft.category || "other",
    };
    const request = supplierDraft.id
      ? db.from("japan_suppliers").update(payload).eq("id", supplierDraft.id).select("*").single()
      : db.from("japan_suppliers").insert(payload).select("*").single();
    const { data, error } = await request;
    setBusy(null);
    if (error) return toast.error(error.message);
    setSupplierDraft(data);
    await loadSuppliers();
    toast.success("Fournisseur Japon enregistré.");
  };

  const uploadSupplierAsset = async (file: File, field: "logo" | "stamp" | "contract" | "invoice_template") => {
    setBusy(`upload-${field}`);
    const folder = field === "contract" ? "contracts" : field === "invoice_template" ? "invoice-templates" : "supplier-assets";
    const path = `${folder}/${supplierDraft.id || "pending"}/${Date.now()}-${fileNameSafe(file.name)}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    setBusy(null);
    if (error) return toast.error(error.message);
    setSupplierDraft((current) => ({
      ...current,
      [`${field}_path`]: path,
      [`${field}_url`]: path,
    }));
    toast.success("Fichier ajouté. Enregistrez le fournisseur pour confirmer.");
  };

  const selectSupplier = (supplierId: string) => {
    const supplier = suppliers.find((item) => item.id === supplierId);
    if (supplier) setSupplierDraft(supplier);
  };

  if (!s) return <p className="text-muted-foreground">Chargement…</p>;

  const F = (k: string, label: string) => (
    <div><Label className="text-xs">{label}</Label><Input value={s[k] ?? ""} onChange={(e) => upd({ [k]: e.target.value })} /></div>
  );

  return (
    <div>
      <PageHeader title="Bureau Japon" description="Paramètres visa, bureau principal et fournisseurs Japon pour les dossiers opérationnels et bancaires." />

      <Tabs defaultValue="visa" className="space-y-6">
        <TabsList className="flex h-auto flex-wrap justify-start">
          <TabsTrigger value="visa">Paramètres Visa</TabsTrigger>
          <TabsTrigger value="main">Bureau Japon Principal</TabsTrigger>
          <TabsTrigger value="suppliers">Fournisseurs Japon</TabsTrigger>
        </TabsList>

        <TabsContent value="visa" className="space-y-4">
          <Card className="p-6">
            <h2 className="font-display text-lg mb-4">Garant / référent au Japon</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {F("guarantor_name", "Nom")}
              {F("guarantor_tel", "Téléphone")}
              <div className="md:col-span-2">{F("guarantor_address", "Adresse")}</div>
              {F("guarantor_dob", "Date de naissance (JJ/MM/AAAA)")}
              {F("guarantor_sex", "Sexe (Male/Female)")}
              {F("guarantor_relationship", "Relation avec le demandeur")}
              {F("guarantor_profession", "Profession")}
              {F("guarantor_nationality", "Nationalité / statut migratoire")}
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg">Inviteur au Japon</h2>
              <div className="flex items-center gap-2">
                <Switch checked={!!s.inviter_same_as_guarantor} onCheckedChange={(v) => upd({ inviter_same_as_guarantor: v })} />
                <Label className="text-sm">Identique au garant</Label>
              </div>
            </div>
            {!s.inviter_same_as_guarantor && (
              <div className="grid md:grid-cols-2 gap-4">
                {F("inviter_name", "Nom")}
                {F("inviter_tel", "Téléphone")}
                <div className="md:col-span-2">{F("inviter_address", "Adresse")}</div>
                {F("inviter_dob", "Date de naissance")}
                {F("inviter_sex", "Sexe")}
                {F("inviter_relationship", "Relation")}
                {F("inviter_profession", "Profession")}
                {F("inviter_nationality", "Nationalité")}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button onClick={saveVisa} disabled={busy === "visa"}><Save className="w-4 h-4" /> Enregistrer</Button>
          </div>
        </TabsContent>

        <TabsContent value="main">
          {supplierSqlMissing ? (
            <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Migration SQL Bureau Japon fournisseurs requise.</Card>
          ) : (
            <SupplierEditor
              title="Bureau Japon Principal"
              suppliers={suppliers.filter((supplier) => supplier.category === "main_partner")}
              draft={supplierDraft.category === "main_partner" ? supplierDraft : { ...emptySupplier, category: "main_partner", name: "Tapis Volant LLC" }}
              setDraft={setSupplierDraft}
              onSelect={selectSupplier}
              onNew={() => setSupplierDraft({ ...emptySupplier, category: "main_partner", name: "Tapis Volant LLC" })}
              onSave={saveSupplier}
              onUpload={uploadSupplierAsset}
              busy={busy}
            />
          )}
        </TabsContent>

        <TabsContent value="suppliers">
          {supplierSqlMissing ? (
            <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">Migration SQL Bureau Japon fournisseurs requise.</Card>
          ) : (
            <SupplierEditor
              title="Fournisseurs Japon"
              suppliers={suppliers.filter((supplier) => supplier.category !== "main_partner")}
              draft={supplierDraft.category !== "main_partner" ? supplierDraft : emptySupplier}
              setDraft={setSupplierDraft}
              onSelect={selectSupplier}
              onNew={() => setSupplierDraft(emptySupplier)}
              onSave={saveSupplier}
              onUpload={uploadSupplierAsset}
              busy={busy}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SupplierEditor({
  title,
  suppliers,
  draft,
  setDraft,
  onSelect,
  onNew,
  onSave,
  onUpload,
  busy,
}: {
  title: string;
  suppliers: JapanSupplier[];
  draft: JapanSupplier;
  setDraft: Dispatch<SetStateAction<JapanSupplier>>;
  onSelect: (supplierId: string) => void;
  onNew: () => void;
  onSave: () => void;
  onUpload: (file: File, field: "logo" | "stamp" | "contract" | "invoice_template") => void;
  busy: string | null;
}) {
  const update = (key: keyof JapanSupplier, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_1fr]">
      <Card className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-lg">{title}</h2>
          <Button variant="outline" size="sm" onClick={onNew}><Plus className="h-4 w-4" /> Nouveau</Button>
        </div>
        <div className="space-y-2">
          {suppliers.length === 0 && <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">Aucun fournisseur.</p>}
          {suppliers.map((supplier) => (
            <button
              key={supplier.id}
              type="button"
              onClick={() => onSelect(supplier.id!)}
              className={`w-full rounded-lg border p-3 text-left text-sm transition hover:border-accent ${draft.id === supplier.id ? "border-accent bg-accent/5" : "border-border"}`}
            >
              <p className="font-medium">{supplier.name}</p>
              <p className="text-xs text-muted-foreground">{supplierCategoryLabels[String(supplier.category || "other")] ?? supplier.category} · {supplier.status === "inactive" ? "Inactif" : "Actif"}</p>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Nom" className="md:col-span-2"><Input value={draft.name ?? ""} onChange={(event) => update("name", event.target.value)} /></Field>
          <Field label="Statut">
            <Select value={draft.status ?? "active"} onValueChange={(value) => update("status", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Actif</SelectItem>
                <SelectItem value="inactive">Inactif</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Catégorie">
            <Select value={draft.category ?? "other"} onValueChange={(value) => update("category", value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(supplierCategoryLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Email"><Input value={draft.email ?? ""} onChange={(event) => update("email", event.target.value)} /></Field>
          <Field label="Téléphone"><Input value={draft.phone ?? ""} onChange={(event) => update("phone", event.target.value)} /></Field>
          <Field label="Site web"><Input value={draft.website ?? ""} onChange={(event) => update("website", event.target.value)} /></Field>
          <Field label="Adresse" className="md:col-span-3"><Textarea rows={3} value={draft.address ?? ""} onChange={(event) => update("address", event.target.value)} /></Field>
          <Field label="Notes" className="md:col-span-3"><Textarea rows={3} value={draft.notes ?? ""} onChange={(event) => update("notes", event.target.value)} /></Field>
        </div>

        <h3 className="mt-8 mb-3 font-semibold">Informations bancaires</h3>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Banque"><Input value={draft.bank_name ?? ""} onChange={(event) => update("bank_name", event.target.value)} /></Field>
          <Field label="Agence"><Input value={draft.branch_name ?? ""} onChange={(event) => update("branch_name", event.target.value)} /></Field>
          <Field label="Code banque"><Input value={draft.bank_code ?? ""} onChange={(event) => update("bank_code", event.target.value)} /></Field>
          <Field label="Code agence"><Input value={draft.branch_code ?? ""} onChange={(event) => update("branch_code", event.target.value)} /></Field>
          <Field label="Type compte"><Input value={draft.account_type ?? ""} onChange={(event) => update("account_type", event.target.value)} /></Field>
          <Field label="N° compte"><Input value={draft.account_number ?? ""} onChange={(event) => update("account_number", event.target.value)} /></Field>
          <Field label="Titulaire du compte" className="md:col-span-3"><Input value={draft.account_holder ?? ""} onChange={(event) => update("account_holder", event.target.value)} /></Field>
        </div>

        <h3 className="mt-8 mb-3 font-semibold">Documents</h3>
        <div className="grid gap-3 md:grid-cols-4">
          <SupplierUpload label="Logo" onFile={(file) => onUpload(file, "logo")} />
          <SupplierUpload label="Cachet" onFile={(file) => onUpload(file, "stamp")} />
          <SupplierUpload label="Contrat PDF" onFile={(file) => onUpload(file, "contract")} />
          <SupplierUpload label="Modèle facture PDF" onFile={(file) => onUpload(file, "invoice_template")} />
        </div>
        <div className="mt-4 grid gap-2 rounded-lg border border-border p-4 text-sm text-muted-foreground md:grid-cols-2">
          <p>Logo: {draft.logo_path || "Non renseigné"}</p>
          <p>Cachet: {draft.stamp_path || "Non renseigné"}</p>
          <p>Contrat: {draft.contract_path || "Non renseigné"}</p>
          <p>Modèle facture: {draft.invoice_template_path || "Non renseigné"}</p>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={onSave} disabled={busy === "supplier"}><Save className="h-4 w-4" /> Enregistrer fournisseur</Button>
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label>{label}</Label><div className="mt-1.5">{children}</div></div>;
}

function SupplierUpload({ label, onFile }: { label: string; onFile: (file: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) onFile(file); }} />
      <Button type="button" variant="outline" onClick={() => ref.current?.click()}><Upload className="h-4 w-4" /> {label}</Button>
    </>
  );
}
