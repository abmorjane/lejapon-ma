import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { findMatchingParticipantForClient } from "@/admin/lib/booking-participants";
import { useOverlayHistory } from "@/hooks/useOverlayHistory";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookingId: string;
  tripId?: string | null;
  expectedTravelers?: number;
  onSaved?: () => void;
};

const RELATIONS = [
  { v: "self", l: "Lui-même" },
  { v: "spouse", l: "Conjoint(e)" },
  { v: "child", l: "Enfant" },
  { v: "friend", l: "Ami(e)" },
  { v: "family", l: "Famille" },
  { v: "other", l: "Autre" },
];

export function LinkExistingClientDialog({ open, onOpenChange, bookingId, tripId, expectedTravelers = 0, onSaved }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [relation, setRelation] = useState("family");
  const [busy, setBusy] = useState(false);
  const overlay = useOverlayHistory(open, () => onOpenChange(false), `link-booking-client-${bookingId}`);

  useEffect(() => { if (!open) { setQ(""); setResults([]); setSelected(null); setRelation("family"); } }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const term = q.trim();
      if (term.length < 2) { setResults([]); return; }
      const like = `%${term}%`;
      const { data } = await supabase
        .from("clients")
        .select("id, full_name, email, phone, city, passport_number, passport_issue_date, passport_expiry, passport_file_path, birthdate, nationality, sex, profession, marital_status, address")
        .or(`full_name.ilike.${like},email.ilike.${like},phone.ilike.${like},passport_number.ilike.${like}`)
        .limit(20);
      setResults(data ?? []);
    }, 300);
    return () => clearTimeout(t);
  }, [q, open]);

  const associate = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { count: alreadyLinkedCount } = await supabase
        .from("booking_participants")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId)
        .eq("client_id", selected.id);

      if ((alreadyLinkedCount ?? 0) > 0) {
        toast.error("Ce voyageur est déjà associé à cette réservation.");
        overlay.requestClose(onSaved);
        setBusy(false);
        return;
      }

      const { data: existingParticipants } = await supabase
        .from("booking_participants")
        .select("*")
        .eq("booking_id", bookingId)
        .order("is_lead", { ascending: false })
        .order("created_at", { ascending: true });

      const matchingParticipant = findMatchingParticipantForClient(existingParticipants ?? [], selected);

      const participantCount = existingParticipants?.length ?? 0;
      if (!matchingParticipant?.id && expectedTravelers > 0 && participantCount >= expectedTravelers) {
        toast.error("Le nombre de voyageurs prévus est déjà atteint.");
        setBusy(false);
        return;
      }

      const parts = (selected.full_name || "").trim().split(/\s+/);
      const first = parts[0] || "";
      const last = parts.slice(1).join(" ") || "";
      const payload = {
        client_id: selected.id,
        first_name: first,
        last_name: last,
        email: selected.email,
        phone: selected.phone,
        sex: selected.sex || null,
        date_of_birth: selected.birthdate || null,
        nationality: selected.nationality || null,
        profession: selected.profession || null,
        marital_status: selected.marital_status || null,
        address: selected.address || null,
        passport_no: selected.passport_number,
        passport_issue_date: selected.passport_issue_date || null,
        passport_expiry: selected.passport_expiry || null,
        passport_file_path: selected.passport_file_path || null,
        relation,
        is_lead: matchingParticipant?.is_lead ?? false,
      } as any;

      const { error } = matchingParticipant?.id
        ? await supabase.from("booking_participants").update(payload).eq("id", matchingParticipant.id)
        : await supabase.from("booking_participants").insert({
            ...payload,
            booking_id: bookingId,
            trip_id: tripId ?? null,
          });
      if (error) throw error;
      toast.success("Voyageur associé");
      overlay.requestClose(onSaved);
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={overlay.handleOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-2xl overflow-y-auto rounded-2xl p-4 sm:p-6">
        <DialogHeader><DialogTitle>Associer un client existant</DialogTitle></DialogHeader>
        <div className="space-y-3 py-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-9" placeholder="Nom, email, téléphone ou n° passeport…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="border border-border rounded-lg divide-y divide-border max-h-72 overflow-auto">
            {q.trim().length < 2 && <p className="p-3 text-xs text-muted-foreground">Tapez au moins 2 caractères.</p>}
            {q.trim().length >= 2 && results.length === 0 && <p className="p-3 text-xs text-muted-foreground">Aucun client trouvé.</p>}
            {results.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelected(c)}
                className={`w-full text-left p-3 hover:bg-secondary text-sm ${selected?.id === c.id ? "bg-secondary" : ""}`}
              >
                <p className="font-medium">{c.full_name}</p>
                <p className="text-xs text-muted-foreground">{c.email || "—"} · {c.phone || "—"} · {c.city || "—"}</p>
                {c.passport_number && <p className="text-[10px] text-muted-foreground font-mono">PP: {c.passport_number}</p>}
              </button>
            ))}
          </div>
          {selected && (
            <div>
              <Label className="text-xs">Lien avec le responsable</Label>
              <Select value={relation} onValueChange={setRelation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{RELATIONS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter className="sticky bottom-0 -mx-4 border-t bg-background px-4 pb-[env(safe-area-inset-bottom)] pt-3 sm:-mx-6 sm:px-6">
          <Button className="min-h-11" variant="outline" onClick={() => overlay.requestClose()} disabled={busy}>Annuler</Button>
          <Button className="min-h-11" onClick={associate} disabled={busy || !selected}>{busy ? "…" : "Associer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
