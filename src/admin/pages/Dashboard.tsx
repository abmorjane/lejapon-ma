import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Plane, CalendarCheck, Users, Wallet, ArrowRight } from "lucide-react";
import { fmtMAD, fmtDateTime } from "@/lib/format";
import { motion, useReducedMotion } from "framer-motion";

type Stats = { trips: number; openTrips: number; leads: number; confirmed: number; paid: number; clients: number; revenue: number };

export default function Dashboard() {
  const [s, setS] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const reduceMotion = useReducedMotion();

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
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-5 sm:space-y-8"
    >
      <header className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">Admin mobile</p>
        <h1 className="font-display text-2xl sm:text-3xl">Vue d'ensemble</h1>
        <p className="mt-1 text-sm text-muted-foreground">Suivi rapide de l'activité</p>
      </header>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {cards.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={i}
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: i * 0.03 }}
              className={`min-w-0 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5 ${c.wide ? "col-span-2" : ""}`}
            >
              <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${c.color}`}>
                <Icon className="w-4 h-4" />
              </div>
              <p className="truncate text-xs text-muted-foreground">{c.label}</p>
              <p className="mt-1 truncate font-display text-xl sm:text-2xl">{c.value}</p>
            </motion.div>
          );
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4 sm:p-5">
          <h2 className="font-display text-lg">Dernières réservations</h2>
          <Link to="/admin/bookings" className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-semibold text-accent">
            Voir tout <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        <div className="divide-y divide-border">
          {recent.length === 0 && <p className="p-6 text-center text-muted-foreground text-sm">Aucune réservation pour le moment.</p>}
          {recent.map((b) => (
            <Link to={`/admin/bookings/${b.id}`} key={b.id} className="flex min-h-[76px] items-center justify-between gap-3 p-4 transition-colors hover:bg-secondary/50">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm truncate">{b.contact_name}</p>
                <p className="text-xs text-muted-foreground truncate">{b.reference} · {b.contact_email}</p>
              </div>
              <div className="shrink-0 text-right">
                <span className={`badge-pill ${statusColor[b.status] ?? "bg-secondary"}`}>{b.status}</span>
                <p className="text-xs text-muted-foreground mt-1">{fmtDateTime(b.created_at)}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </motion.div>
  );
}
