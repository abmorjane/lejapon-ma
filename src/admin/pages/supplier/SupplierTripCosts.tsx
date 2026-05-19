import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PageHeader } from "../../components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Save, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

type DayCost = {
  id?: string;
  trip_id: string;
  supplier_id: string;
  day_number: number;
  city: string;
  nights: number;
  hotel_cost: number;
  transport_cost: number;
  guide_cost: number;
  activities_cost: number;
  meals_cost: number;
  currency: string;
  services: string;
  notes: string;
};

const COST_FIELDS: { key: keyof DayCost; label: string }[] = [
  { key: "hotel_cost", label: "Hôtel" },
  { key: "transport_cost", label: "Transport" },
  { key: "guide_cost", label: "Guide" },
  { key: "activities_cost", label: "Activités" },
  { key: "meals_cost", label: "Repas" },
];

export default function SupplierTripCosts() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [supplierId, setSupplierId] = useState<string>("");
  const [supplierName, setSupplierName] = useState<string>("");
  const [days, setDays] = useState<DayCost[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      if (!user || !tripId) return;
      const { data: members } = await supabase
        .from("supplier_members").select("supplier_id, suppliers(name)")
        .eq("user_id", user.id).limit(1);
      const sId = members?.[0]?.supplier_id;
      const sName = (members?.[0] as any)?.suppliers?.name ?? "";
      if (!sId) { toast.error("Aucun fournisseur lié à votre compte."); return; }
      setSupplierId(sId); setSupplierName(sName);

      const { data: tripRow } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
      setTrip(tripRow);

      const { data: existing } = await supabase
        .from("supplier_day_costs").select("*")
        .eq("trip_id", tripId).eq("supplier_id", sId).order("day_number");

      const total = tripRow?.duration_days ?? existing?.length ?? 1;
      const byDay = new Map<number, any>();
      (existing ?? []).forEach((r: any) => byDay.set(r.day_number, r));

      const list: DayCost[] = [];
      for (let i = 1; i <= Math.max(total, existing?.length ?? 0); i++) {
        const r = byDay.get(i);
        list.push({
          id: r?.id,
          trip_id: tripId,
          supplier_id: sId,
          day_number: i,
          city: r?.city ?? "",
          nights: r?.nights ?? 0,
          hotel_cost: Number(r?.hotel_cost ?? 0),
          transport_cost: Number(r?.transport_cost ?? 0),
          guide_cost: Number(r?.guide_cost ?? 0),
          activities_cost: Number(r?.activities_cost ?? 0),
          meals_cost: Number(r?.meals_cost ?? 0),
          currency: r?.currency ?? "JPY",
          services: r?.services ?? "",
          notes: r?.notes ?? "",
        });
      }
      setDays(list);
    })();
  }, [user, tripId]);

  const update = (idx: number, patch: Partial<DayCost>) => {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const addDay = () => {
    setDays((prev) => [
      ...prev,
      {
        trip_id: tripId!, supplier_id: supplierId, day_number: prev.length + 1,
        city: "", nights: 0,
        hotel_cost: 0, transport_cost: 0, guide_cost: 0, activities_cost: 0, meals_cost: 0,
        currency: "JPY", services: "", notes: "",
      },
    ]);
  };

  const removeDay = async (idx: number) => {
    const d = days[idx];
    if (d.id) {
      const { error } = await supabase.from("supplier_day_costs").delete().eq("id", d.id);
      if (error) return toast.error(error.message);
    }
    setDays((prev) => prev.filter((_, i) => i !== idx).map((d, i) => ({ ...d, day_number: i + 1 })));
    toast.success("Jour supprimé");
  };

  const dayTotal = (d: DayCost) =>
    Number(d.hotel_cost) + Number(d.transport_cost) + Number(d.guide_cost) + Number(d.activities_cost) + Number(d.meals_cost);

  const totals = useMemo(() => {
    const t = { hotel: 0, transport: 0, guide: 0, activities: 0, meals: 0, all: 0, nights: 0 };
    days.forEach((d) => {
      t.hotel += +d.hotel_cost; t.transport += +d.transport_cost; t.guide += +d.guide_cost;
      t.activities += +d.activities_cost; t.meals += +d.meals_cost; t.nights += +d.nights;
      t.all += dayTotal(d);
    });
    return t;
  }, [days]);

  const currency = days[0]?.currency ?? "JPY";
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " " + currency;

  const saveAll = async () => {
    if (!supplierId || !tripId) return;
    setBusy(true);
    try {
      const payload = days.map((d) => ({
        ...(d.id ? { id: d.id } : {}),
        trip_id: tripId,
        supplier_id: supplierId,
        day_number: d.day_number,
        city: d.city || null,
        nights: d.nights,
        hotel_cost: d.hotel_cost,
        transport_cost: d.transport_cost,
        guide_cost: d.guide_cost,
        activities_cost: d.activities_cost,
        meals_cost: d.meals_cost,
        currency: d.currency,
        services: d.services || null,
        notes: d.notes || null,
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("supplier_day_costs")
        .upsert(payload, { onConflict: "trip_id,supplier_id,day_number" });
      if (error) throw error;
      toast.success("Coûts enregistrés");
      // Reload to pick up new IDs
      const { data: refreshed } = await supabase.from("supplier_day_costs")
        .select("*").eq("trip_id", tripId).eq("supplier_id", supplierId).order("day_number");
      setDays(days.map((d) => {
        const r = refreshed?.find((x: any) => x.day_number === d.day_number);
        return r ? { ...d, id: r.id } : d;
      }));
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  if (!trip) return <p className="text-muted-foreground">Chargement…</p>;

  return (
    <div>
      <Link to="/supplier" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="w-4 h-4" /> Mes voyages
      </Link>
      <PageHeader
        title={trip.title}
        description={`${supplierName} • ${trip.duration_days ?? "?"} jours • Saisissez les coûts par journée.`}
        action={<Button onClick={saveAll} disabled={busy}><Save className="w-4 h-4" /> {busy ? "…" : "Enregistrer"}</Button>}
      />

      {/* Summary card */}
      <Card className="mb-6">
        <CardHeader className="pb-3"><CardTitle className="text-base">Récapitulatif</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 md:grid-cols-7 gap-3 text-sm">
          <Stat label="Jours" value={String(days.length)} />
          <Stat label="Nuits" value={String(totals.nights)} />
          <Stat label="Hôtel" value={fmt(totals.hotel)} />
          <Stat label="Transport" value={fmt(totals.transport)} />
          <Stat label="Guide" value={fmt(totals.guide)} />
          <Stat label="Activités" value={fmt(totals.activities)} />
          <Stat label="Repas" value={fmt(totals.meals)} />
          <div className="col-span-2 md:col-span-7 pt-3 border-t border-border flex items-center justify-between">
            <span className="text-muted-foreground">Total général</span>
            <span className="font-display text-2xl text-primary">{fmt(totals.all)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Day cards */}
      <div className="space-y-4">
        {days.map((d, idx) => (
          <Card key={idx}>
            <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Jour {d.day_number}</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">Sous-total :</span>
                <span className="font-semibold">{fmt(dayTotal(d))}</span>
                <Button size="sm" variant="ghost" onClick={() => removeDay(idx)}><Trash2 className="w-4 h-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="col-span-2"><Label>Ville</Label>
                <Input value={d.city} onChange={(e) => update(idx, { city: e.target.value })} placeholder="Tokyo, Kyoto…" /></div>
              <div><Label>Nuits</Label>
                <Input type="number" min={0} value={d.nights} onChange={(e) => update(idx, { nights: +e.target.value })} /></div>
              <div><Label>Devise</Label>
                <Select value={d.currency} onValueChange={(v) => update(idx, { currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="JPY">JPY ¥</SelectItem>
                    <SelectItem value="USD">USD $</SelectItem>
                    <SelectItem value="EUR">EUR €</SelectItem>
                    <SelectItem value="MAD">MAD</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {COST_FIELDS.map((f) => (
                <div key={f.key as string}>
                  <Label>{f.label} ({d.currency})</Label>
                  <Input type="number" min={0} value={(d as any)[f.key]}
                    onChange={(e) => update(idx, { [f.key]: +e.target.value } as any)} />
                </div>
              ))}
              <div className="col-span-2 md:col-span-4"><Label>Services prévus</Label>
                <Input value={d.services} onChange={(e) => update(idx, { services: e.target.value })}
                  placeholder="Transfert aéroport, dîner kaiseki, guide francophone…" />
              </div>
              <div className="col-span-2 md:col-span-4"><Label>Notes internes</Label>
                <Textarea rows={2} value={d.notes} onChange={(e) => update(idx, { notes: e.target.value })} />
              </div>
            </CardContent>
          </Card>
        ))}

        <Button variant="outline" onClick={addDay}><Plus className="w-4 h-4" /> Ajouter un jour</Button>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="font-semibold mt-0.5">{value}</p>
  </div>
);