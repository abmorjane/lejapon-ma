import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fmtDateTime, fmtMAD } from "@/lib/format";
import { Search, Plus, ChevronDown } from "lucide-react";
import { LoyaltyBadge } from "../components/LoyaltyBadge";
import { Button } from "@/components/ui/button";
import { CreateBookingDialog } from "../components/CreateBookingDialog";
import { useAuth } from "@/hooks/useAuth";
import { hasAnyRole } from "../lib/permissions";
import { QuickActions } from "../components/QuickActions";
import { Card, CardContent } from "@/components/ui/card";
import { motion, useReducedMotion } from "framer-motion";

export default function Bookings() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const { roles } = useAuth();
  const canCreate = hasAnyRole(roles, ["super_admin", "admin", "manager"]);
  const reduceMotion = useReducedMotion();

  const load = async () => {
    let query = supabase
      .from("bookings")
      .select("id, reference, contact_name, contact_email, contact_phone, status, num_adults, num_children, total_amount_mad, paid_amount_mad, created_at, trips(title), clients(loyalty_tier, is_returning, trips_completed)")
      .order("created_at", { ascending: false })
      .limit(120);
    if (status !== "all") query = query.eq("status", status as any);
    const { data } = await query;
    let out = data ?? [];
    if (q) out = out.filter((b: any) =>
      b.contact_name?.toLowerCase().includes(q.toLowerCase()) ||
      b.contact_email?.toLowerCase().includes(q.toLowerCase()) ||
      b.reference?.toLowerCase().includes(q.toLowerCase())
    );
    setRows(out);
  };
  useEffect(() => { load(); }, [status]);
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [q]);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="space-y-4"
    >
      <PageHeader
        title="Réservations"
        description="Suivi rapide des demandes, statuts et paiements."
        action={canCreate ? (
          <Button className="min-h-11 w-full rounded-xl sm:w-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4" /> Nouvelle réservation
          </Button>
        ) : undefined}
      />
      <Card className="rounded-2xl shadow-sm">
        <CardContent className="p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input className="pl-9 min-h-11" type="search" enterKeyHint="search" placeholder="Nom, email ou référence…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-[180px] min-h-11"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Tous statuts</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="confirmed">Confirmé</SelectItem>
            <SelectItem value="paid">Payé</SelectItem>
            <SelectItem value="cancelled">Annulé</SelectItem>
            <SelectItem value="completed">Terminé</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{rows.length} réservation(s) affichée(s)</p>
        </CardContent>
      </Card>

      {canCreate && (
        <CreateBookingDialog open={createOpen} onOpenChange={setCreateOpen} />
      )}

      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground bg-background rounded-2xl border border-border">Aucune réservation.</p>}
        {rows.map((b, index) => {
          const remaining = Number(b.total_amount_mad || 0) - Number(b.paid_amount_mad || 0);
          return (
          <motion.details
            key={b.id}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(index, 8) * 0.025 }}
            className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
          >
            <summary className="list-none p-4 cursor-pointer min-h-[96px]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to={`/admin/bookings/${b.id}`} className="font-semibold text-accent" onClick={(e) => e.stopPropagation()}>{b.reference}</Link>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <p className="truncate font-medium">{b.contact_name}</p>
                    <LoyaltyBadge tier={b.clients?.loyalty_tier} isReturning={b.clients?.is_returning} trips={b.clients?.trips_completed} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{b.trips?.title ?? "—"}</p>
                </div>
                <div className="shrink-0 text-right">
                  <StatusBadge value={b.status} />
                  <ChevronDown className="w-4 h-4 ml-auto mt-2 text-muted-foreground transition-transform group-open:rotate-180" />
                </div>
              </div>
              <QuickActions phone={b.contact_phone} email={b.contact_email} compact className="mt-3" />
            </summary>
            <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-4 text-sm">
              <div><p className="text-xs text-muted-foreground">Pax</p><p className="font-medium">{b.num_adults}A {b.num_children > 0 && `+ ${b.num_children}E`}</p></div>
              <div><p className="text-xs text-muted-foreground">Reçu le</p><p className="font-medium">{fmtDateTime(b.created_at)}</p></div>
              <div><p className="text-xs text-muted-foreground">Total</p><p className="font-medium">{fmtMAD(b.total_amount_mad)}</p></div>
              <div><p className="text-xs text-muted-foreground">Payé</p><p className="font-medium">{fmtMAD(b.paid_amount_mad)}</p></div>
              <div className="col-span-2 rounded-xl bg-background p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Reste</span>
                  <span className="font-semibold text-foreground">{fmtMAD(Math.max(0, remaining))}</span>
                </div>
              </div>
              <Link to={`/admin/bookings/${b.id}`} className="col-span-2 inline-flex h-11 items-center justify-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-foreground">
                Ouvrir la réservation
              </Link>
            </div>
          </motion.details>
        );})}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border bg-background shadow-sm md:block">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-4 font-semibold">Réf</th>
              <th className="p-4 font-semibold">Client</th>
              <th className="p-4 font-semibold">Voyage</th>
              <th className="p-4 font-semibold">Pax</th>
              <th className="p-4 font-semibold">Total</th>
              <th className="p-4 font-semibold">Payé</th>
              <th className="p-4 font-semibold">Statut</th>
              <th className="p-4 font-semibold">Reçu le</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">Aucune réservation.</td></tr>}
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-secondary/30">
                <td className="p-4"><Link to={`/admin/bookings/${b.id}`} className="text-accent font-medium">{b.reference}</Link></td>
                <td className="p-4">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium">{b.contact_name}</p>
                    <LoyaltyBadge tier={b.clients?.loyalty_tier} isReturning={b.clients?.is_returning} trips={b.clients?.trips_completed} />
                  </div>
                  <p className="text-xs text-muted-foreground">{b.contact_email}</p>
                </td>
                <td className="p-4">{b.trips?.title ?? "—"}</td>
                <td className="p-4">{b.num_adults}A {b.num_children > 0 && `+ ${b.num_children}E`}</td>
                <td className="p-4">{fmtMAD(b.total_amount_mad)}</td>
                <td className="p-4">{fmtMAD(b.paid_amount_mad)}</td>
                <td className="p-4"><StatusBadge value={b.status} /></td>
                <td className="p-4 text-xs text-muted-foreground">{fmtDateTime(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.div>
  );
}
