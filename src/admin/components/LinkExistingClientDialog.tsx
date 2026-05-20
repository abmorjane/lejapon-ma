import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Search } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  bookingId: string;
  tripId?: string | null;
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

export function LinkExistingClientDialog({ open, onOpenChange, bookingId, tripId, onSaved }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [relation, setRelation] = useState("family");
  const [busy, setBusy] = useState(false);

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
      const { count } = await supabase
        .from("booking_participants")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId)
        .eq("client_id", selected.id);
      if ((count ?? 0) > 0) { toast.error("Ce client est déjà associé à la réservation"); setBusy(false); return; }

      const parts = (selected.full_name || "").trim().split(/\s+/);
      const first = parts[0] || "";
      const last = parts.slice(1).join(" ") || "";

      const { error } = await supabase.from("booking_participants").insert({
        booking_id: bookingId,
        trip_id: tripId ?? null,
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
        is_lead: false,
      } as any);
      if (error) throw error;
      toast.success("Voyageur associé");
      onOpenChange(false);
      onSaved?.();
    } catch (e: any) {
      toast.error(e.message ?? "Erreur");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button onClick={associate} disabled={busy || !selected}>{busy ? "…" : "Associer"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
