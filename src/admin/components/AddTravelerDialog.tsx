import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { z } from "zod";
import { AlertTriangle, FileScan } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { PassportScannerDialog, type PassportOcrFields } from "./PassportScannerDialog";
import { checkPassportExpiry } from "@/lib/passport-mrz";

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

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/veuve" },
];

const schema = z.object({
  first_name: z.string().trim().min(1, "Prénom requis").max(80),
  last_name: z.string().trim().min(1, "Nom requis").max(80),
  email: z.string().trim().email("Email invalide").max(255).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  passport_no: z.string().trim().max(40).optional().or(z.literal("")),
});

export function AddTravelerDialog({ open, onOpenChange, bookingId, tripId, onSaved }: Props) {
  const { isAdmin } = useAuth();
  const [form, setForm] = useState<any>({
    first_name: "", last_name: "", sex: "", date_of_birth: "",
    profession: "", marital_status: "", address: "",
    nationality: "", passport_no: "", passport_issue_date: "", passport_expiry: "",
    passport_file_path: "", email: "", phone: "", relation: "self",
  });
  const [busy, setBusy] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const applyPassportFields = (fields: PassportOcrFields) => {
    setForm((current: any) => ({
      ...current,
      first_name: fields.first_name || current.first_name,
      last_name: fields.last_name || current.last_name,
      sex: fields.sex || current.sex,
      date_of_birth: fields.date_of_birth || current.date_of_birth,
      nationality: fields.nationality || current.nationality,
      passport_no: fields.passport_no || current.passport_no,
      passport_issue_date: fields.passport_issue_date || current.passport_issue_date,
      passport_expiry: fields.passport_expiry || current.passport_expiry,
    }));
  };

  const submit = async () => {
    const parsed = schema.safeParse(form);
    if (!parsed.success) { toast.error(parsed.error.errors[0].message); return; }
    setBusy(true);
    try {
      const fullName = `${form.first_name} ${form.last_name}`.trim();
      const { data: rpc, error: rpcErr } = await supabase.rpc("find_or_create_client_for_participant", {
        _full_name: fullName,
        _email: form.email || null,
        _phone: form.phone || null,
        _passport_no: form.passport_no || null,
      });
      if (rpcErr) throw rpcErr;
      const row: any = Array.isArray(rpc) ? rpc[0] : rpc;
      const clientId = row?.client_id ?? null;
      const wasExisting = !!row?.was_existing;

      if (wasExisting) {
        const { count } = await supabase
          .from("booking_participants")
          .select("id", { count: "exact", head: true })
          .eq("booking_id", bookingId)
          .eq("client_id", clientId);
        if ((count ?? 0) > 0) {
          toast.error("Ce client est déjà associé à cette réservation");
          setBusy(false);
          return;
        }
        if (!confirm("Ce client existe déjà dans le CRM. L'associer à cette réservation ?")) {
          setBusy(false);
          return;
        }
      }

      if (clientId) {
        await supabase.from("clients").update({
          birthdate: form.date_of_birth || null,
          nationality: form.nationality || null,
          sex: form.sex || null,
          profession: form.profession || null,
          marital_status: form.marital_status || null,
          address: form.address || null,
          passport_issue_date: form.passport_issue_date || null,
          passport_expiry: form.passport_expiry || null,
          passport_file_path: form.passport_file_path || null,
        } as any).eq("id", clientId);
      }

      const { error: insErr } = await supabase.from("booking_participants").insert({
        booking_id: bookingId,
        trip_id: tripId ?? null,
        client_id: clientId,
        first_name: form.first_name,
        last_name: form.last_name,
        sex: form.sex || null,
        date_of_birth: form.date_of_birth || null,
        profession: form.profession || null,
        marital_status: form.marital_status || null,
        address: form.address || null,
        nationality: form.nationality || null,
        passport_no: form.passport_no || null,
        passport_issue_date: form.passport_issue_date || null,
        passport_expiry: form.passport_expiry || null,
        passport_file_path: form.passport_file_path || null,
        email: form.email || null,
        phone: form.phone || null,
        relation: form.relation,
        is_lead: false,
      } as any);
      if (insErr) throw insErr;

      toast.success(wasExisting ? "Client existant associé" : "Voyageur ajouté");
      setForm({
        first_name: "", last_name: "", sex: "", date_of_birth: "",
        profession: "", marital_status: "", address: "",
        nationality: "", passport_no: "", passport_issue_date: "", passport_expiry: "",
        passport_file_path: "", email: "", phone: "", relation: "self",
      });
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
        <DialogHeader><DialogTitle>Ajouter un voyageur</DialogTitle></DialogHeader>
        {isAdmin && (
          <>
            <div className="rounded-xl border border-border bg-secondary/40 p-3 text-sm text-muted-foreground">
              Le scan passeport aide à pré-remplir la fiche. Vérifiez toujours les informations avant validation.
            </div>
            <Button type="button" variant="outline" className="h-11 w-full justify-center" onClick={() => setScannerOpen(true)}>
              <FileScan className="h-4 w-4" /> Scanner passeport
            </Button>
            <PassportScannerDialog
              open={scannerOpen}
              onOpenChange={setScannerOpen}
              currentPath={form.passport_file_path}
              onStoredPathChange={(path) => setF("passport_file_path", path ?? "")}
              onApply={applyPassportFields}
            />
          </>
        )}
        <div className="grid grid-cols-2 gap-3 py-2">
          <div><Label className="text-xs">Prénom *</Label><Input value={form.first_name} onChange={(e) => setF("first_name", e.target.value)} /></div>
          <div><Label className="text-xs">Nom *</Label><Input value={form.last_name} onChange={(e) => setF("last_name", e.target.value)} /></div>
          <div><Label className="text-xs">Sexe</Label>
            <Select value={form.sex || "none"} onValueChange={(v) => setF("sex", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="M">Masculin</SelectItem>
                <SelectItem value="F">Féminin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Date de naissance</Label><Input type="date" value={form.date_of_birth} onChange={(e) => setF("date_of_birth", e.target.value)} /></div>
          <div><Label className="text-xs">Profession</Label><Input value={form.profession} onChange={(e) => setF("profession", e.target.value)} /></div>
          <div><Label className="text-xs">État civil</Label>
            <Select value={form.marital_status || "none"} onValueChange={(v) => setF("marital_status", v === "none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {MARITAL_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">Nationalité</Label><Input value={form.nationality} onChange={(e) => setF("nationality", e.target.value)} /></div>
          <div><Label className="text-xs">Lien avec le responsable</Label>
            <Select value={form.relation} onValueChange={(v) => setF("relation", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{RELATIONS.map((r) => <SelectItem key={r.v} value={r.v}>{r.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label className="text-xs">Adresse</Label><Textarea rows={2} value={form.address} onChange={(e) => setF("address", e.target.value)} /></div>
          <div className="col-span-2 border-t border-border pt-3 mt-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Passeport</p>
          </div>
          <div><Label className="text-xs">N° passeport</Label><Input value={form.passport_no} onChange={(e) => setF("passport_no", e.target.value)} /></div>
          <div></div>
          <div><Label className="text-xs">Date d'émission</Label><Input type="date" value={form.passport_issue_date} onChange={(e) => setF("passport_issue_date", e.target.value)} /></div>
          <div><Label className="text-xs">Date d'expiration</Label><Input type="date" value={form.passport_expiry} onChange={(e) => setF("passport_expiry", e.target.value)} /></div>
          {checkPassportExpiry(form.passport_expiry).warning && (
            <div className="col-span-2 flex items-start gap-2 rounded-xl border border-orange-300 bg-orange-50 p-3 text-sm text-orange-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{checkPassportExpiry(form.passport_expiry).warning}</p>
            </div>
          )}
          <div className="col-span-2 border-t border-border pt-3 mt-1">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">Contact (optionnel)</p>
          </div>
          <div><Label className="text-xs">Email</Label><Input type="email" value={form.email} onChange={(e) => setF("email", e.target.value)} /></div>
          <div><Label className="text-xs">Téléphone</Label><Input value={form.phone} onChange={(e) => setF("phone", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Annuler</Button>
          <Button onClick={submit} disabled={busy}>{busy ? "Enregistrement…" : "Ajouter"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
