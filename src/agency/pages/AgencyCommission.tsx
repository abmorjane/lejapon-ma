import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAgencyContext } from "../useAgencyContext";
import type { CommissionRule, TripSummary } from "../agencyTypes";
import { cn } from "@/lib/utils";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const ruleColumns = "id,organization_id,scope_type,trip_id,rule_name,commission_type,commission_value,currency,applies_to,status,priority";

const formatRuleValue = (rule: CommissionRule) =>
  rule.commission_type === "percentage"
    ? `${rule.commission_value}%`
    : `${rule.commission_value} ${rule.currency}`;

const statusClass = (status: string) =>
  status === "active"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : status === "inactive"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-stone-200 bg-stone-50 text-stone-600";

function RuleCard({ rule, tripTitle }: { rule: CommissionRule; tripTitle?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-semibold">{rule.scope_type === "agency_default" ? "Agency default" : "Trip override"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {rule.scope_type === "trip_override" ? tripTitle || rule.trip_id || "Voyage non renseigné" : rule.rule_name || "Règle générale agence"}
          </p>
        </div>
        <Badge variant="outline" className={cn(statusClass(rule.status))}>{rule.status}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Commission</p>
          <p className="mt-1 font-semibold">{formatRuleValue(rule)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
          <p className="mt-1 font-semibold">{rule.commission_type}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Appliquée à</p>
          <p className="mt-1 font-semibold">{rule.applies_to}</p>
        </div>
      </div>
    </div>
  );
}

export default function AgencyCommission() {
  const { organization } = useAgencyContext();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!organization) return;
      setLoading(true);
      setError(null);

      const { data, error } = await db
        .from("commission_rules")
        .select(ruleColumns)
        .eq("organization_id", organization.id)
        .order("status", { ascending: true })
        .order("priority", { ascending: true, nullsFirst: false });

      if (error) {
        setError(error.message);
        setRules([]);
        setTrips([]);
        setLoading(false);
        return;
      }

      const loadedRules = (data ?? []) as CommissionRule[];
      setRules(loadedRules);

      const tripIds = Array.from(new Set(loadedRules.map((rule) => rule.trip_id).filter(Boolean)));
      if (tripIds.length) {
        const { data: tripRows } = await db.from("trips").select("id,title").in("id", tripIds);
        setTrips((tripRows ?? []) as TripSummary[]);
      } else {
        setTrips([]);
      }

      setLoading(false);
    };
    load();
  }, [organization?.id]);

  const tripById = useMemo(() => new Map(trips.map((trip) => [trip.id, trip.title])), [trips]);
  const activeDefault = rules.find((rule) => rule.status === "active" && rule.scope_type === "agency_default");
  const activeOverrides = rules.filter((rule) => rule.status === "active" && rule.scope_type === "trip_override");
  const inactiveRules = rules.filter((rule) => rule.status !== "active");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-3xl">Commissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">{organization?.display_name}</p>
        </div>
        <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
          Lecture seule
        </div>
      </div>

      <Card className="p-5">
        <div className="flex gap-3">
          <Percent className="mt-0.5 h-5 w-5 shrink-0 text-accent" />
          <p className="text-sm leading-relaxed text-muted-foreground">
            Les commissions affichées sont des règles de référence. Les montants définitifs seront validés par Moroccan Express. Aucun calcul, paiement ou payout n'est disponible dans cette phase.
          </p>
        </div>
      </Card>

      {loading ? (
        <Card className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Chargement des règles…
        </Card>
      ) : error ? (
        <Card className="border-amber-200 bg-amber-50 p-5 text-amber-950">{error}</Card>
      ) : rules.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">Aucune règle de commission visible.</Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="font-display text-xl">Règle agence active</h2>
            {activeDefault ? (
              <RuleCard rule={activeDefault} />
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">Aucune règle agency_default active.</Card>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl">Trip overrides actifs</h2>
            {activeOverrides.length ? (
              <div className="grid gap-3">
                {activeOverrides.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} tripTitle={tripById.get(rule.trip_id ?? "")} />
                ))}
              </div>
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">Aucune règle trip_override active.</Card>
            )}
          </section>

          <details className="group rounded-lg border border-border bg-background">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 font-semibold">
              Règles inactives / archivées ({inactiveRules.length})
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <div className="space-y-3 border-t border-border p-4">
              {inactiveRules.length ? (
                inactiveRules.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} tripTitle={tripById.get(rule.trip_id ?? "")} />
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Aucune règle inactive ou archivée.</p>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
