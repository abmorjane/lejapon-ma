import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download } from "lucide-react";
import { exportCsv } from "@/admin/lib/export-csv";

export default function OpsActivities({ trip }: { trip: any }) {
  const [extras, setExtras] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [bookingExtras, setBookingExtras] = useState<any[]>([]);
  const [selections, setSelections] = useState<any[]>([]);
  const [filterExtra, setFilterExtra] = useState<string>("all");

  const load = async () => {
    const { data: ex } = await supabase.from("extras").select("*").eq("is_active", true).order("sort_order");
    setExtras(ex ?? []);
    const { data: bks } = await supabase.from("bookings").select("id,reference,contact_name").eq("trip_id", trip.id);
    setBookings(bks ?? []);
    const ids = (bks ?? []).map((b) => b.id);
    if (!ids.length) { setParticipants([]); setSelections([]); setBookingExtras([]); return; }
    const { data: bookingExtraRows } = await supabase.from("booking_extras").select("*").in("booking_id", ids);
    setBookingExtras(bookingExtraRows ?? []);
    const { data: parts } = await supabase.from("booking_participants").select("*").in("booking_id", ids);
    setParticipants(parts ?? []);
    const pids = (parts ?? []).map((p) => p.id);
    if (pids.length) {
      const { data: sel } = await supabase.from("booking_participant_activities").select("*").in("participant_id", pids);
      setSelections(sel ?? []);
    } else setSelections([]);
  };
  useEffect(() => { load(); }, [trip.id]);

  const toggle = async (participantId: string, extraId: string, on: boolean) => {
    if (on) {
      await supabase.from("booking_participant_activities").upsert({ participant_id: participantId, extra_id: extraId, is_selected: true }, { onConflict: "participant_id,extra_id" });
    } else {
      await supabase.from("booking_participant_activities").upsert({ participant_id: participantId, extra_id: extraId, is_selected: false }, { onConflict: "participant_id,extra_id" });
    }
    load();
  };

  const isSelected = (participant: any, eid: string) => {
    const explicit = selections.find((s) => s.participant_id === participant.id && s.extra_id === eid);
    if (explicit) return Boolean(explicit.is_selected);
    return bookingExtras.some((extra) => extra.booking_id === participant.booking_id && extra.extra_id === eid);
  };

  const visibleExtras = filterExtra === "all" ? extras : extras.filter((e) => e.id === filterExtra);

  const doExport = () => {
    exportCsv(`activites-${trip.title}`, participants.map((p) => {
      const b = bookings.find((x) => x.id === p.booking_id);
      const row: any = { prenom: p.first_name, nom: p.last_name, reservation: b?.reference };
      for (const e of extras) row[e.name] = isSelected(p, e.id) ? "X" : "";
      return row;
    }));
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <Select value={filterExtra} onValueChange={setFilterExtra}>
          <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les activités</SelectItem>
            {extras.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={doExport}><Download className="w-4 h-4" /> Export CSV</Button>
      </div>

      <div className="bg-background rounded-2xl border border-border overflow-x-auto">
        <table className="w-full min-w-[760px] table-auto text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="p-3 sticky left-0 z-10 min-w-[180px] whitespace-normal bg-secondary/50">Participant</th>
              <th className="p-3 min-w-[120px] whitespace-normal">Réservation</th>
              {visibleExtras.map((e) => <th key={e.id} className="min-w-[140px] whitespace-normal p-3 text-center align-bottom leading-snug">{e.name}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {participants.length === 0 && <tr><td colSpan={visibleExtras.length + 2} className="p-6 text-center text-muted-foreground">Aucun participant.</td></tr>}
            {participants.map((p) => {
              const b = bookings.find((x) => x.id === p.booking_id);
              return (
                <tr key={p.id} className="hover:bg-secondary/30">
                  <td className="p-3 sticky left-0 z-10 bg-background font-medium whitespace-normal">{p.first_name} {p.last_name}</td>
                  <td className="p-3 text-xs whitespace-nowrap">{b?.reference}</td>
                  {visibleExtras.map((e) => (
                    <td key={e.id} className="p-3 text-center">
                      <Checkbox checked={isSelected(p, e.id)} onCheckedChange={(v) => toggle(p.id, e.id, !!v)} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
