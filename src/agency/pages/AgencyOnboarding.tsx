import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAgencyContext } from "../useAgencyContext";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime } from "@/lib/format";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

type OnboardingCase = {
  id: string;
  organization_id: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export default function AgencyOnboarding() {
  const { organization } = useAgencyContext();
  const [caseRow, setCaseRow] = useState<OnboardingCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!organization) return;
      setLoading(true);
      setError(null);
      const { data, error } = await db
        .from("partner_onboarding_cases")
        .select("id,organization_id,status,created_at,updated_at")
        .eq("organization_id", organization.id)
        .order("created_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle();
      if (error) setError(error.message);
      else setCaseRow((data ?? null) as OnboardingCase | null);
      setLoading(false);
    };
    load();
  }, [organization?.id]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Onboarding partenaire</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Veuillez compléter votre dossier partenaire.
        </p>
      </div>
      <Card className="p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
            <Building2 className="h-6 w-6 text-accent" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-xl">{organization?.display_name}</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="outline">Organisation: {organization?.status}</Badge>
              {loading && <Badge variant="secondary"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Chargement</Badge>}
              {caseRow && <Badge>Dossier: {caseRow.status}</Badge>}
            </div>
            {error && <p className="mt-3 text-sm text-amber-700">Dossier onboarding indisponible: {error}</p>}
            {!loading && !caseRow && !error && (
              <p className="mt-3 text-sm text-muted-foreground">
                Aucun dossier onboarding visible pour le moment. Contactez Moroccan Express / LeJapon.ma.
              </p>
            )}
            {caseRow && (
              <p className="mt-3 text-sm text-muted-foreground">
                Dossier créé le {fmtDateTime(caseRow.created_at)}. Les formulaires, uploads et signature seront activés dans une prochaine étape.
              </p>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
