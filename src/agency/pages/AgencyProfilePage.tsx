import { useEffect, useRef, useState } from "react";
import { Building2, ImageUp, KeyRound, Loader2, Save, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyProfile } from "../agencyTypes";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;
const LOGO_ORG_COLUMNS = "id,metadata";

const profileColumns = [
  "organization_id",
  "agency_code",
  "commercial_name",
  "contact_name",
  "contact_email",
  "contact_phone",
  "market_country",
  "preferred_language",
  "billing_legal_name",
  "billing_email",
  "billing_phone",
  "billing_address_line_1",
  "billing_address_line_2",
  "billing_city",
  "billing_postal_code",
  "billing_country",
  "tax_identifier",
].join(",");

const Field = ({ label, value }: { label: string; value: unknown }) => (
  <div>
    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
    <p className="mt-1 break-words font-medium">{value ? String(value) : "—"}</p>
  </div>
);

export default function AgencyProfilePage() {
  const { user } = useAuth();
  const { organization, currentMembership, reload } = useAgencyContext();
  const [profile, setProfile] = useState<AgencyProfile | null>(null);
  const [account, setAccount] = useState({
    full_name: "",
    phone: "",
    secondary_phone: "",
    secondary_email: "",
    position_title: "",
    point_of_sale: "",
  });
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingAccount, setSavingAccount] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberProfileRow, setMemberProfileRow] = useState<Record<string, any> | null>(null);
  const [logoMetadataOverride, setLogoMetadataOverride] = useState<Record<string, any> | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const loadMemberProfile = async () => {
    if (!user || !organization || !currentMembership?.id) return null;

    const profileResult = await db
      .from("organization_member_profiles")
      .select("id,organization_member_id,user_id,organization_id,full_name,email,phone,secondary_phone,secondary_email,position_title,point_of_sale,notes")
      .eq("organization_member_id", currentMembership.id)
      .maybeSingle();

    const row = profileResult.error ? null : profileResult.data ?? null;
    setMemberProfileRow(row);
    return row;
  };

  useEffect(() => {
    const load = async () => {
      if (!organization) return;
      setLoading(true);
      setError(null);
      const { data, error } = await db
        .from("agency_profiles")
        .select(profileColumns)
        .eq("organization_id", organization.id)
        .maybeSingle();
      if (error) setError(error.message);
      else setProfile((data ?? null) as AgencyProfile | null);

      if (user) {
        const memberProfile = await loadMemberProfile();
        const authMetadata = user.user_metadata ?? {};
        setAccount({
          full_name: memberProfile?.full_name ?? authMetadata.full_name ?? authMetadata.name ?? "",
          phone: memberProfile?.phone ?? authMetadata.phone ?? "",
          secondary_phone: memberProfile?.secondary_phone ?? "",
          secondary_email: memberProfile?.secondary_email ?? "",
          position_title: memberProfile?.position_title ?? "",
          point_of_sale: memberProfile?.point_of_sale ?? "",
        });
      }
      setLoading(false);
    };
    load();
  }, [organization?.id, currentMembership?.id, user?.id]);

  useEffect(() => {
    setLogoMetadataOverride(null);
  }, [organization?.id, organization?.metadata?.agency_logo_url, organization?.metadata?.agency_logo_path]);

  const saveAccount = async () => {
    if (!user || !organization || !currentMembership?.id) {
      toast.error("Membre organisation introuvable.");
      return;
    }
    setSavingAccount(true);

    const stablePayload = {
      organization_member_id: currentMembership.id,
      user_id: user.id,
      organization_id: organization.id,
      full_name: account.full_name || null,
      email: user.email ?? null,
      phone: account.phone || null,
      secondary_phone: account.secondary_phone || null,
      secondary_email: account.secondary_email || null,
      position_title: account.position_title || null,
      point_of_sale: account.point_of_sale || null,
    };

    const stableRequest = memberProfileRow?.id
      ? db
          .from("organization_member_profiles")
          .update(stablePayload)
          .eq("id", memberProfileRow.id)
          .select("id,organization_member_id,user_id,organization_id,full_name,email,phone,secondary_phone,secondary_email,position_title,point_of_sale,notes")
          .maybeSingle()
      : db
          .from("organization_member_profiles")
          .upsert(stablePayload, { onConflict: "organization_member_id" })
          .select("id,organization_member_id,user_id,organization_id,full_name,email,phone,secondary_phone,secondary_email,position_title,point_of_sale,notes")
          .maybeSingle();

    const { error: stableError } = await stableRequest;
    if (stableError) {
      toast.error(stableError.message);
      setSavingAccount(false);
      return;
    }

    const { error: profileError } = await db.from("profiles").upsert({
      id: user.id,
      full_name: account.full_name || null,
      phone: account.phone || null,
    });
    if (profileError) toast.warning(`Profil legacy non mis à jour: ${profileError.message}`);

    const { error: authError } = await supabase.auth.updateUser({
      data: {
        full_name: account.full_name,
        name: account.full_name,
        phone: account.phone,
      },
    });
    if (authError) toast.warning(`Profil Auth non mis à jour: ${authError.message}`);

    const refreshed = await loadMemberProfile();
    if (refreshed) {
      setAccount({
        full_name: refreshed.full_name ?? "",
        phone: refreshed.phone ?? "",
        secondary_phone: refreshed.secondary_phone ?? "",
        secondary_email: refreshed.secondary_email ?? "",
        position_title: refreshed.position_title ?? "",
        point_of_sale: refreshed.point_of_sale ?? "",
      });
    }
    toast.success("Profil enregistré.");
    setSavingAccount(false);
  };

  const changePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setSavingAccount(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setSavingAccount(false);
    if (error) return toast.error(error.message);
    setNewPassword("");
    toast.success("Mot de passe mis à jour.");
  };

  const effectiveLogoMetadata = logoMetadataOverride ?? organization?.metadata ?? {};
  const agencyLogoUrl = typeof effectiveLogoMetadata.agency_logo_url === "string"
    ? effectiveLogoMetadata.agency_logo_url
    : "";
  const agencyLogoPath = typeof effectiveLogoMetadata.agency_logo_path === "string"
    ? effectiveLogoMetadata.agency_logo_path
    : "";
  const agencyLogoFilename = typeof effectiveLogoMetadata.agency_logo_filename === "string"
    ? effectiveLogoMetadata.agency_logo_filename
    : agencyLogoPath.split("/").pop() || "";
  const agencyLogoUpdatedAt = typeof effectiveLogoMetadata.agency_logo_updated_at === "string"
    ? effectiveLogoMetadata.agency_logo_updated_at
    : "";

  const saveAgencyLogoMetadata = async (logo: { url: string | null; path?: string | null; filename?: string | null }) => {
    if (!organization) throw new Error("Organisation agence introuvable.");
    const metadata = {
      ...(organization.metadata ?? {}),
      agency_logo_url: logo.url,
      agency_logo_path: logo.path ?? null,
      agency_logo_filename: logo.filename ?? null,
      agency_logo_updated_at: logo.url ? new Date().toISOString() : null,
    };
    const { data, error } = await db
      .from("organizations")
      .update({ metadata })
      .eq("id", organization.id)
      .select(LOGO_ORG_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error("Aucune organisation mise à jour. Vérifiez les droits RLS sur organizations.metadata.");
    }
    const savedMetadata = data.metadata && typeof data.metadata === "object" ? data.metadata : metadata;
    setLogoMetadataOverride(savedMetadata);
    await reload();
    return savedMetadata;
  };

  const uploadAgencyLogo = async (file: File | undefined) => {
    if (!file || !organization) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Choisissez une image JPG, PNG ou WebP.");
      return;
    }
    setUploadingLogo(true);
    try {
      const safeName = file.name.replace(/[^\w.-]+/g, "_");
      const path = `${organization.id}/branding/${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("media").upload(path, file, {
        contentType: file.type,
        upsert: true,
      });
      if (error) throw error;
      const savedFileName = path.split("/").pop() || safeName;
      const listResult = await supabase.storage.from("media").list(`${organization.id}/branding`, {
        search: savedFileName,
      });
      if (listResult.error) {
        console.warn("[agency-logo] storage verification list failed", listResult.error);
      } else if (!listResult.data?.some((item) => item.name === savedFileName)) {
        throw new Error("Upload logo non vérifié dans le bucket media.");
      }
      const { data } = supabase.storage.from("media").getPublicUrl(path);
      const savedMetadata = await saveAgencyLogoMetadata({ url: data.publicUrl, path, filename: file.name });
      if (!savedMetadata?.agency_logo_url) {
        throw new Error("Logo uploadé mais URL non persistée dans organizations.metadata.");
      }
      toast.success("Logo agence enregistré.");
    } catch (error: any) {
      toast.error(error?.message ?? "Upload impossible. Vérifiez le bucket media.");
    } finally {
      setUploadingLogo(false);
    }
  };

  const deleteAgencyLogo = async () => {
    if (!organization) return;
    setUploadingLogo(true);
    try {
      await saveAgencyLogoMetadata({ url: null, path: null, filename: null });
      if (agencyLogoPath) {
        const { error: removeError } = await supabase.storage.from("media").remove([agencyLogoPath]);
        if (removeError) console.warn("[agency-logo] remove failed", removeError);
      }
      toast.success("Logo agence supprimé.");
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de supprimer le logo.");
    } finally {
      setUploadingLogo(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Profil agence</h1>
          <p className="mt-1 text-sm text-muted-foreground">Informations en lecture seule.</p>
        </div>
        <Badge variant="outline">Votre rôle: {currentMembership?.role}</Badge>
      </div>

      <Card className="p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-accent/10">
              {agencyLogoUrl ? (
                <img src={agencyLogoUrl} alt="Logo agence enregistré" className="h-full w-full object-contain p-2" />
              ) : (
                <Building2 className="h-6 w-6 text-accent" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-2xl">{organization?.display_name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pour modifier les informations légales, contactez Moroccan Express Travel & Events / LeJapon.ma.
              </p>
              <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
                <p className="font-medium">{agencyLogoUrl ? "Logo enregistré" : "Aucun logo enregistré"}</p>
                {agencyLogoUrl ? (
                  <>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{agencyLogoFilename || "Fichier logo agence"}</p>
                    {agencyLogoUpdatedAt && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Uploadé le {new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(new Date(agencyLogoUpdatedAt))}
                      </p>
                    )}
                    <a href={agencyLogoUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent underline-offset-2 hover:underline">
                      Voir le logo sauvegardé
                    </a>
                  </>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">Le devis et les reçus afficheront seulement LeJapon.ma tant qu'aucun logo n'est enregistré.</p>
                )}
              </div>
            </div>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void uploadAgencyLogo(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploadingLogo} onClick={() => logoInputRef.current?.click()}>
                {uploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : agencyLogoUrl ? <ImageUp className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                {agencyLogoUrl ? "Remplacer le logo" : "Uploader logo"}
              </Button>
              {agencyLogoUrl && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={uploadingLogo} onClick={deleteAgencyLogo}>
                  <Trash2 className="h-4 w-4" /> Supprimer le logo
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5 lg:col-span-2">
          <div className="flex flex-col gap-1">
            <h2 className="font-display text-xl">Mon compte</h2>
            <p className="text-sm text-muted-foreground">Vous pouvez modifier vos coordonnées. Votre rôle organisation reste géré par Moroccan Express Travel & Events / LeJapon.ma.</p>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label>Nom complet</Label>
              <Input value={account.full_name} onChange={(event) => setAccount((current) => ({ ...current, full_name: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone</Label>
              <Input value={account.phone} onChange={(event) => setAccount((current) => ({ ...current, phone: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Téléphone secondaire</Label>
              <Input value={account.secondary_phone} onChange={(event) => setAccount((current) => ({ ...current, secondary_phone: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Email secondaire</Label>
              <Input type="email" value={account.secondary_email} onChange={(event) => setAccount((current) => ({ ...current, secondary_email: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Fonction / titre</Label>
              <Input value={account.position_title} onChange={(event) => setAccount((current) => ({ ...current, position_title: event.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Point de vente</Label>
              <Input value={account.point_of_sale} onChange={(event) => setAccount((current) => ({ ...current, point_of_sale: event.target.value }))} />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <Button onClick={saveAccount} disabled={savingAccount}>
              {savingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer mon profil
            </Button>
            <div className="flex flex-1 gap-2">
              <Input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Nouveau mot de passe"
              />
              <Button variant="outline" onClick={changePassword} disabled={savingAccount || !newPassword}>
                <KeyRound className="h-4 w-4" />
                Changer
              </Button>
            </div>
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Organisation</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Nom affiché" value={organization?.display_name} />
            <Field label="Raison sociale" value={organization?.legal_name} />
            <Field label="Email" value={organization?.email} />
            <Field label="Téléphone" value={organization?.phone} />
            <Field label="Site web" value={organization?.website} />
            <Field label="Statut" value={organization?.status} />
            <Field label="Adresse" value={[organization?.address_line_1, organization?.address_line_2].filter(Boolean).join(", ")} />
            <Field label="Ville / pays" value={[organization?.city, organization?.country].filter(Boolean).join(", ")} />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Profil commercial</h2>
          {loading ? (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : error ? (
            <p className="mt-5 text-sm text-amber-700">Profil indisponible: {error}</p>
          ) : !profile ? (
            <p className="mt-5 text-sm text-muted-foreground">Profil agence incomplet.</p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Code agence" value={profile.agency_code} />
              <Field label="Nom commercial" value={profile.commercial_name} />
              <Field label="Contact" value={profile.contact_name} />
              <Field label="Email contact" value={profile.contact_email} />
              <Field label="Téléphone contact" value={profile.contact_phone} />
              <Field label="Marché" value={profile.market_country} />
              <Field label="Langue préférée" value={profile.preferred_language} />
            </div>
          )}
        </Card>
      </div>

      {profile && (
        <Card className="p-5">
          <h2 className="font-display text-xl">Facturation</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Raison sociale" value={profile.billing_legal_name} />
            <Field label="Email facturation" value={profile.billing_email} />
            <Field label="Téléphone facturation" value={profile.billing_phone} />
            <Field label="Adresse" value={[profile.billing_address_line_1, profile.billing_address_line_2].filter(Boolean).join(", ")} />
            <Field label="Ville / pays" value={[profile.billing_city, profile.billing_country].filter(Boolean).join(", ")} />
            <Field label="Identifiant fiscal" value={profile.tax_identifier} />
          </div>
        </Card>
      )}

    </div>
  );
}
