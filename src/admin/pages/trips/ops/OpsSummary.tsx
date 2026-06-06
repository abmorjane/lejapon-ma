import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";

const db = supabase as any;

export default function OpsSummary({ trip }: { trip: any }) {
  const [stats, setStats] = useState({ regs: 0, sales: 0, paid: 0, supplierTotal: 0, sentJapan: 0 });

  useEffect(() => {
    (async () => {
      const [{ data: bks }, { data: parts }, { data: costs }, { data: jp }] = await Promise.all([
        supabase.from("bookings").select("id,total_amount_mad,paid_amount_mad").eq("trip_id", trip.id),
        supabase.from("booking_participants").select("id").eq("trip_id", trip.id),
        db.from("supplier_trip_quotes").select("final_total_mad,grand_total_jpy,exchange_rate_jpy_mad").eq("trip_id", trip.id),
        supabase.from("trip_japan_payments").select("amount_mad").eq("trip_id", trip.id),
      ]);
      const supplierTotal = (costs ?? []).reduce((s: number, c: any) => {
        const mad = Number(c.final_total_mad || 0);
        if (mad > 0) return s + mad;
        return s + Number(c.grand_total_jpy || 0) * Number(c.exchange_rate_jpy_mad || 0);
      }, 0);
      setStats({
        regs: parts?.length ?? 0,
        sales: (bks ?? []).reduce((s, b) => s + Number(b.total_amount_mad || 0), 0),
        paid: (bks ?? []).reduce((s, b) => s + Number(b.paid_amount_mad || 0), 0),
        supplierTotal,
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
