import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyProfile } from "../agencyTypes";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

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
  const { organization, currentMembership } = useAgencyContext();
  const [profile, setProfile] = useState<AgencyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      setLoading(false);
    };
    load();
  }, [organization?.id]);

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
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
            <Building2 className="h-6 w-6 text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-2xl">{organization?.display_name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pour modifier ces informations, contactez Moroccan Express / LeJapon.ma.
            </p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
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
