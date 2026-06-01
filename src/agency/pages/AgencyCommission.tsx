import { useEffect, useMemo, useState } from "react";
import { Loader2, Percent } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, CommissionRule, TripSummary } from "../agencyTypes";
import { cn } from "@/lib/utils";
import {
  commissionRuleColumns,
  estimateCommissionForBooking,
  formatCommissionRuleValue,
  getApplicableCommissionRule,
  getCommissionScopeLabel,
} from "../commissionEngine";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

const bookingColumns = "id,reference,contact_name,contact_email,contact_phone,status,total_amount_mad,paid_amount_mad,created_at,preferred_dates,trip_id,agency_organization_id,trips:trip_id(id,title,destination,base_price_mad)";

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
          <p className="font-semibold">{getCommissionScopeLabel(rule)}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {rule.scope === "trip_override"
              ? tripTitle || rule.trip_id || "Voyage non renseigné"
              : rule.notes || "Règle de référence"}
          </p>
        </div>
        <Badge variant="outline" className={cn(statusClass(rule.status))}>{rule.status}</Badge>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Commission</p>
          <p className="mt-1 font-semibold">{formatCommissionRuleValue(rule)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Type</p>
          <p className="mt-1 font-semibold">{rule.rule_type}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Portée</p>
          <p className="mt-1 font-semibold">{rule.scope}</p>
        </div>
      </div>
    </div>
  );
}

export default function AgencyCommission() {
  const { organization } = useAgencyContext();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [bookings, setBookings] = useState<AgencyBooking[]>([]);
  const [bookingCount, setBookingCount] = useState(0);
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!organization) return;
      setLoading(true);
      setError(null);

      const [{ data, error }, { data: bookingRows, error: bookingError, count }] = await Promise.all([
        db
          .from("commission_engine_rules")
          .select(commissionRuleColumns)
          .eq("organization_id", organization.id)
          .eq("status", "active")
          .order("status", { ascending: true }),
        db
          .from("bookings")
          .select(bookingColumns, { count: "exact" })
          .eq("agency_organization_id", organization.id)
          .order("created_at", { ascending: false })
          .limit(500),
      ]);

      if (error || bookingError) {
        setError(error?.message ?? bookingError?.message ?? "Impossible de charger les commissions.");
        setRules([]);
        setBookings([]);
        setBookingCount(0);
        setTrips([]);
        setLoading(false);
        return;
      }

      const loadedRules = (data ?? []) as CommissionRule[];
      setRules(loadedRules);
      setBookings((bookingRows ?? []) as AgencyBooking[]);
      setBookingCount(count ?? 0);

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
  const activeDefault = rules.find((rule) => rule.scope === "agency_default");
  const activeOverrides = rules.filter((rule) => rule.scope !== "agency_default");
  const estimatedEarnings = useMemo(
    () => bookings.reduce((sum, booking) => {
      const rule = getApplicableCommissionRule(rules, booking);
      return sum + estimateCommissionForBooking(booking, rule);
    }, 0),
    [bookings, rules]
  );

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

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Réservations</p>
          <p className="mt-2 text-3xl font-semibold">{loading ? "—" : bookingCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Gains estimés</p>
          <p className="mt-2 text-3xl font-semibold">{loading ? "—" : fmtMAD(estimatedEarnings)}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Règles actives</p>
          <p className="mt-2 text-3xl font-semibold">{loading ? "—" : rules.length}</p>
        </Card>
      </div>

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
              <Card className="p-6 text-sm text-muted-foreground">Aucune règle globale active.</Card>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl">Règles destination / produit actives</h2>
            {activeOverrides.length ? (
              <div className="grid gap-3">
                {activeOverrides.map((rule) => (
                  <RuleCard key={rule.id} rule={rule} tripTitle={tripById.get(rule.trip_id ?? "")} />
                ))}
              </div>
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">Aucune règle destination ou produit active.</Card>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-display text-xl">Aperçu estimatif par réservation</h2>
            {bookings.length ? (
              <div className="overflow-hidden rounded-lg border border-border bg-background">
                <div className="divide-y divide-border">
                  {bookings.slice(0, 20).map((booking) => {
                    const rule = getApplicableCommissionRule(rules, booking);
                    return (
                      <div key={booking.id} className="grid gap-2 p-4 text-sm md:grid-cols-[1fr_180px_160px] md:items-center">
                        <div>
                          <p className="font-semibold">{booking.reference}</p>
                          <p className="text-xs text-muted-foreground">{booking.trips?.title || booking.contact_name}</p>
                        </div>
                        <p className="text-muted-foreground">{rule ? getCommissionScopeLabel(rule) : "Aucune règle"}</p>
                        <p className="font-semibold">{fmtMAD(estimateCommissionForBooking(booking, rule))}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <Card className="p-6 text-sm text-muted-foreground">Aucune réservation attribuée.</Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
