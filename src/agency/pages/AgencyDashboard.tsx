import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Loader2, Percent, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { useAgencyContext } from "../useAgencyContext";
import type { AgencyBooking, CommissionRule } from "../agencyTypes";
import { AgencyStatusBadge } from "../components/AgencyStatusBadge";
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

export default function AgencyDashboard() {
  const { organization } = useAgencyContext();
  const [bookings, setBookings] = useState<AgencyBooking[]>([]);
  const [bookingCount, setBookingCount] = useState(0);
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      if (!organization) return;
      setLoading(true);
      const [{ data: bookingRows, count }, { data: ruleRows }] = await Promise.all([
        db
          .from("bookings")
          .select(bookingColumns, { count: "exact" })
          .eq("agency_organization_id", organization.id)
          .order("created_at", { ascending: false })
          .limit(500),
        db
          .from("commission_engine_rules")
          .select(commissionRuleColumns)
          .eq("organization_id", organization.id)
          .eq("status", "active")
          .limit(5),
      ]);
      setBookings((bookingRows ?? []) as AgencyBooking[]);
      setBookingCount(count ?? 0);
      setRules((ruleRows ?? []) as CommissionRule[]);
      setLoading(false);
    };
    load();
  }, [organization?.id]);

  const defaultRule = useMemo(() => rules.find((rule) => rule.scope === "agency_default"), [rules]);
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
          <h1 className="font-display text-3xl">Tableau de bord</h1>
          <p className="mt-1 text-sm text-muted-foreground">{organization?.display_name}</p>
        </div>
        <div className="rounded-full border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground">
          Lecture seule
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="p-5">
          <BookOpen className="h-5 w-5 text-accent" />
          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Réservations attribuées</p>
          <p className="mt-1 text-3xl font-semibold">{loading ? "—" : bookingCount}</p>
        </Card>
        <Card className="p-5">
          <Wallet className="h-5 w-5 text-accent" />
          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Gains estimés</p>
          <p className="mt-1 text-3xl font-semibold">{fmtMAD(estimatedEarnings)}</p>
        </Card>
        <Card className="p-5">
          <Percent className="h-5 w-5 text-accent" />
          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Règle active</p>
          <p className="mt-1 text-lg font-semibold">
            {defaultRule
              ? formatCommissionRuleValue(defaultRule)
              : "Non renseignée"}
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.8fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-4">
            <h2 className="font-display text-xl">Réservations récentes</h2>
            <Button asChild variant="outline" size="sm">
              <Link to="/agency/bookings">Voir tout</Link>
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement…
            </div>
          ) : bookings.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">Aucune réservation attribuée.</p>
          ) : (
            <div className="divide-y divide-border">
              {bookings.slice(0, 5).map((booking) => (
                <Link key={booking.id} to={`/agency/bookings/${booking.id}`} className="block p-4 transition hover:bg-secondary/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-accent">{booking.reference}</p>
                      <p className="text-sm">{booking.contact_name}</p>
                      <p className="text-xs text-muted-foreground">{fmtDateTime(booking.created_at)}</p>
                    </div>
                    <AgencyStatusBadge value={booking.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="font-display text-xl">Commission preview</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Les commissions affichées sont des règles de référence. Les montants définitifs seront validés par Moroccan Express.
          </p>
          <div className="mt-5 space-y-3">
            {rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucune règle active visible.</p>
            ) : (
              rules.map((rule) => (
                <div key={rule.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{getCommissionScopeLabel(rule)}</p>
                    <p className="text-sm font-semibold">
                      {formatCommissionRuleValue(rule)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{rule.notes || "Règle active visible"}</p>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
