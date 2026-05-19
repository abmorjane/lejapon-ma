import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plane, CalendarCheck, Users, Wallet, ArrowRight } from "lucide-react";
import { fmtMAD, fmtDateTime } from "@/lib/format";

type Stats = { trips: number; openTrips: number; leads: number; confirmed: number; paid: number; clients: number; revenue: number };

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [tripsAll, tripsOpen, leads, confirmed, paid, clients, payments, recentBookings] = await Promise.all([
        supabase.from("trips").select("id", { count: "exact", head: true }),
        supabase.from("trips").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "lead"),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
        supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "paid"),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("payments").select("amount_mad").eq("status", "received"),
        supabase.from("bookings").select("id, reference, contact_name, contact_email, status, total_amount_mad, created_at").order("created_at", { ascending: false }).limit(8),
      ]);
      setS({
        trips: tripsAll.count ?? 0,
        openTrips: tripsOpen.count ?? 0,
        leads: leads.count ?? 0,
        confirmed: confirmed.count ?? 0,
        paid: paid.count ?? 0,
        clients: clients.count ?? 0,
        revenue: (payments.data ?? []).reduce((acc, p: any) => acc + Number(p.amount_mad || 0), 0),
      });
      setRecent(recentBookings.data ?? []);
    })();
  }, []);

  const cards = [
    { label: "Voyages ouverts", value: s ? `${s.openTrips} / ${s.trips}` : "—", icon: Plane, color: "bg-accent/15 text-accent" },
    { label: "Leads", value: s?.leads ?? "—", icon: CalendarCheck, color: "bg-indigo/15 text-indigo" },
    { label: "Confirmés / Payés", value: s ? `${s.confirmed} / ${s.paid}` : "—", icon: CalendarCheck, color: "bg-gold/20 text-foreground" },
    { label: "Clients", value: s?.clients ?? "—", icon: Users, color: "bg-secondary text-foreground" },
    { label: "CA encaissé", value: s ? fmtMAD(s.revenue) : "—", icon: Wallet, color: "bg-accent/15 text-accent", wide: true },
  ];

  const statusColor: Record<string, string> = {
    lead: "bg-indigo/15 text-indigo",
    confirmed: "bg-gold/20 text-foreground",
    paid: "bg-success/15 text-success",
    cancelled: "bg-destructive/15 text-destructive",
    completed: "bg-secondary text-foreground/70",
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="font-display text-3xl">Vue d'ensemble</h1>
        <p className="text-muted-foreground mt-1">Suivi en temps réel de l'activité</p>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} className={`bg-background rounded-2xl border border-border p-5 ${c.wide ? "col-span-2" : ""}`}>
              <div className={`w-10 h-10 rounded-xl ${c.color} flex items-center justify-center mb-3`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="text-xs text-muted-foreground">{c.label}</p>
              <p className="font-display text-2xl mt-1">{c.value}</p>
            </div>
          );
        })}
      </section>

      <section className="bg-background rounded-2xl border border-border">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-display text-lg">Dernières réservations</h2>
          <Link to="/admin/bookings" className="text-sm text-accent font-medium inline-flex items-center gap-1">
            Voir tout <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 && <p className="p-6 text-center text-muted-foreground text-sm">Aucune réservation pour le moment.</p>}
          {recent.map((b) => (
            <Link to={`/admin/bookings/${b.id}`} key={b.id} className="flex items-center justify-between gap-4 p-4 hover:bg-secondary/50 transition-colors">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{b.contact_name}</p>
                <p className="text-xs text-muted-foreground truncate">{b.reference} · {b.contact_email}</p>
              </div>
              <div className="text-right">
                <span className={`badge-pill ${statusColor[b.status] ?? "bg-secondary"}`}>{b.status}</span>
                <p className="text-xs text-muted-foreground mt-1">{fmtDateTime(b.created_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
