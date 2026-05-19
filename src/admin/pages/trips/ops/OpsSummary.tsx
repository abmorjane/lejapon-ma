import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";

export default function OpsSummary({ trip }: { trip: any }) {
  const [stats, setStats] = useState({ regs: 0, sales: 0, paid: 0, supplierTotal: 0, sentJapan: 0 });

  useEffect(() => {
    (async () => {
      const [{ data: bks }, { data: parts }, { data: costs }, { data: jp }] = await Promise.all([
        supabase.from("bookings").select("id,total_amount_mad,paid_amount_mad").eq("trip_id", trip.id),
        supabase.from("booking_participants").select("id").eq("trip_id", trip.id),
        supabase.from("supplier_day_costs").select("total_cost").eq("trip_id", trip.id),
        supabase.from("trip_japan_payments").select("amount_mad").eq("trip_id", trip.id),
      ]);
      setStats({
        regs: parts?.length ?? 0,
        sales: (bks ?? []).reduce((s, b) => s + Number(b.total_amount_mad || 0), 0),
        paid: (bks ?? []).reduce((s, b) => s + Number(b.paid_amount_mad || 0), 0),
        supplierTotal: (costs ?? []).reduce((s, c) => s + Number(c.total_cost || 0), 0),
        sentJapan: (jp ?? []).reduce((s, p) => s + Number(p.amount_mad || 0), 0),
      });
    })();
  }, [trip.id]);

  const left = stats.sales - stats.paid;
  const leftJp = stats.supplierTotal - stats.sentJapan;
  const margin = stats.sales - stats.supplierTotal;

  const card = (label: string, value: string, tone?: string) => (
    <div className="bg-background border border-border rounded-xl p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl mt-2 ${tone ?? ""}`}>{value}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {card("Inscrits", String(stats.regs))}
      {card("Total ventes", fmtMAD(stats.sales))}
      {card("Total encaissé", fmtMAD(stats.paid), "text-emerald-600")}
      {card("Reste à encaisser", fmtMAD(left), "text-amber-600")}
      {card("Coût Japon estimé", fmtMAD(stats.supplierTotal))}
      {card("Envoyé au Japon", fmtMAD(stats.sentJapan), "text-emerald-600")}
      {card("Reste à envoyer", fmtMAD(leftJp), "text-amber-600")}
      {card("Marge estimée", fmtMAD(margin), margin >= 0 ? "text-emerald-600" : "text-red-600")}
    </div>
  );
}
