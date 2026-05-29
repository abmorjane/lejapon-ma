import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/admin/components/PageHeader";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_AGENCY_SETTINGS, normalizeAgencySettings, type AgencySettings } from "@/lib/agency-settings";
import { Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";

const editableFields: Array<{ key: keyof AgencySettings; label: string; textarea?: boolean }> = [
  { key: "agency_display_name", label: "Nom affiché agence" },
  { key: "legal_company_name", label: "Raison sociale" },
  { key: "brand_name", label: "Marque" },
  { key: "address_line_1", label: "Adresse ligne 1" },
  { key: "address_line_2", label: "Adresse ligne 2" },
  { key: "city", label: "Ville" },
  { key: "country", label: "Pays" },
  { key: "postal_code", label: "Code postal" },
  { key: "ice", label: "ICE" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Téléphone" },
  { key: "website", label: "Site web" },
  { key: "manager_name", label: "Nom du manager" },
  { key: "manager_title", label: "Titre du manager" },
];

export default function AgencySettingsPage() {
  const { user, roles } = useAuth();
  const [settings, setSettings] = useState<AgencySettings>(DEFAULT_AGENCY_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<null | "logo_url" | "stamp_signature_url">(null);
  const logoRef = useRef<HTMLInputElement>(null);
  const stampRef = useRef<HTMLInputElement>(null);
  const canEdit = roles.some((role) => ["super_admin", "admin"].includes(role));

  useEffect(() => {
    supabase
      .from("agency_settings" as any)
      .select("*")
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        setSettings(normalizeAgencySettings(data as Partial<AgencySettings> | null));
      });
  }, []);

  const update = (key: keyof AgencySettings, value: string) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const uploadAsset = async (field: "logo_url" | "stamp_signature_url", file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Utilisez une image PNG ou JPEG pour garantir l'intégration dans les PDF.");
      return;
    }
    setUploading(field);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const path = `agency/${field}-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("media").upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (error) throw error;
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      await supabase.from("media").insert({
        storage_path: path,
        url,
        mime_type: file.type,
        size_bytes: file.size,
        uploaded_by: user?.id,
        alt: field === "logo_url" ? "Logo agence" : "Cachet et signature agence",
      } as any);
      update(field, url);
      toast.success("Image ajoutée");
    } catch (e: any) {
      toast.error(e.message ?? "Upload impossible");
    } finally {
      setUploading(null);
      if (logoRef.current) logoRef.current.value = "";
      if (stampRef.current) stampRef.current.value = "";
    }
  };

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    try {
      const { id, ...payload } = settings as any;
      const normalized = Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [key, typeof value === "string" && value.trim() === "" ? null : value])
      );
      const query = id
        ? supabase.from("agency_settings" as any).update(normalized).eq("id", id)
        : supabase.from("agency_settings" as any).insert(normalized).select("*").single();
      const { data, error } = await query;
      if (error) throw error;
      if (data) setSettings(normalizeAgencySettings(data as Partial<AgencySettings>));
      toast.success("Informations agence enregistrées");
    } catch (e: any) {
      toast.error(e.message ?? "Enregistrement impossible");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Informations agence"
        description="Coordonnées légales, branding, logo et cachet utilisés par les documents de voyage."
      />

      <Card className="mb-4 p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Identité & coordonnées</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {editableFields.map(({ key, label, textarea }) => (
            <div key={key} className={["address_line_1", "address_line_2", "agency_display_name"].includes(String(key)) ? "sm:col-span-2" : ""}>
              <Label>{label}</Label>
              {textarea ? (
                <Textarea disabled={!canEdit} value={String(settings[key] ?? "")} onChange={(e) => update(key, e.target.value)} />
              ) : (
                <Input disabled={!canEdit} value={String(settings[key] ?? "")} onChange={(e) => update(key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-4 p-5 sm:p-6">
        <h2 className="mb-4 font-display text-lg">Logo, cachet & signature</h2>
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-lg border border-border p-4">
            <Label>Logo agence</Label>
            <Input className="mt-2" disabled={!canEdit} value={settings.logo_url ?? ""} onChange={(e) => update("logo_url", e.target.value)} placeholder="URL du logo" />
            {settings.logo_url && <img src={settings.logo_url} alt="Logo agence" className="mt-3 max-h-24 max-w-full rounded border border-border object-contain p-2" />}
            <input ref={logoRef} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => uploadAsset("logo_url", e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!canEdit || uploading === "logo_url"} onClick={() => logoRef.current?.click()}>
              <Upload className="h-4 w-4" /> {uploading === "logo_url" ? "Upload…" : "Uploader un logo"}
            </Button>
          </div>

          <div className="rounded-lg border border-border p-4">
            <Label>Cachet / signature</Label>
            <Input className="mt-2" disabled={!canEdit} value={settings.stamp_signature_url ?? ""} onChange={(e) => update("stamp_signature_url", e.target.value)} placeholder="URL cachet / signature" />
            {settings.stamp_signature_url && <img src={settings.stamp_signature_url} alt="Cachet et signature" className="mt-3 max-h-28 max-w-full rounded border border-border object-contain p-2" />}
            <input ref={stampRef} hidden type="file" accept="image/png,image/jpeg" onChange={(e) => uploadAsset("stamp_signature_url", e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" className="mt-3" disabled={!canEdit || uploading === "stamp_signature_url"} onClick={() => stampRef.current?.click()}>
              <Upload className="h-4 w-4" /> {uploading === "stamp_signature_url" ? "Upload…" : "Uploader cachet/signature"}
            </Button>
          </div>
        </div>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={busy || !canEdit}>
          <Save className="h-4 w-4" /> {busy ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </div>
  );
}
