import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, UserPlus, Trash2, Pencil, Save, X, ExternalLink, AlertTriangle, ChevronDown, UserCheck } from "lucide-react";
import { AddTravelerDialog } from "./AddTravelerDialog";
import { LinkExistingClientDialog } from "./LinkExistingClientDialog";
import { QuickActions } from "./QuickActions";

const RELATIONS: Record<string, string> = {
  self: "Lui-même", spouse: "Conjoint(e)", child: "Enfant",
  friend: "Ami(e)", family: "Famille", other: "Autre",
};

const MARITAL_STATUS_OPTIONS = [
  { value: "celibataire", label: "Célibataire" },
  { value: "marie", label: "Marié(e)" },
  { value: "divorce", label: "Divorcé(e)" },
  { value: "veuf", label: "Veuf/veuve" },
];

const maritalStatusLabel = (value?: string | null) =>
  MARITAL_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value ?? "—";

type Props = {
  bookingId: string;
  tripId?: string | null;
  expectedTravelers: number;
  onChanged?: () => void;
};

export function BookingParticipantsSection({ bookingId, tripId, expectedTravelers, onChanged }: Props) {
  const [list, setList] = useState<any[]>([]);
  const [booking, setBooking] = useState<any>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [openAdd, setOpenAdd] = useState(false);
  const [openLink, setOpenLink] = useState(false);
  const [choosingResponsible, setChoosingResponsible] = useState(false);

  const load = async () => {
    const bookingWithMetadata = await (supabase as any)
      .from("bookings")
      .select("id,client_id,contact_name,contact_email,contact_phone,trip_id,metadata")
      .eq("id", bookingId)
      .maybeSingle();
    if (bookingWithMetadata.error && /metadata/i.test(bookingWithMetadata.error.message ?? "")) {
      const { data } = await supabase
        .from("bookings")
        .select("id,client_id,contact_name,contact_email,contact_phone,trip_id")
        .eq("id", bookingId)
        .maybeSingle();
      setBooking(data ?? null);
    } else {
      setBooking(bookingWithMetadata.data ?? null);
    }
    const { data } = await supabase
      .from("booking_participants")
      .select("*")
      .eq("booking_id", bookingId)
      .order("is_lead", { ascending: false })
      .order("created_at", { ascending: true });
    setList(data ?? []);
  };
  useEffect(() => { load(); }, [bookingId]);
  useEffect(() => {
    if (!editing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [editing]);

  const normalizePassport = (value?: string | null) => String(value ?? "").replace(/[\s-]+/g, "").toUpperCase();
  const normalizeText = (value?: string | null) => String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");
  const normalizeName = (p: any) => normalizeText(`${p.first_name ?? ""} ${p.last_name ?? ""}`);
  const normalizeEmail = (value?: string | null) => String(value ?? "").trim().toLowerCase();
  const normalizePhone = (value?: string | null) => String(value ?? "").replace(/[^\d+]/g, "");
  const splitContactName = (name?: string | null) => {
    const parts = String(name ?? "").trim().split(/\s+/).filter(Boolean);
    return { first_name: parts[0] ?? "", last_name: parts.slice(1).join(" ") };
  };
  const bookingMetadata = (booking?.metadata && typeof booking.metadata === "object") ? booking.metadata : {};
  const responsibleDeleted = bookingMetadata.responsible_traveller_deleted === true;
  const participantMatchesBookingContact = (participant: any) => {
    if (!booking) return false;
    const sameClient = Boolean(booking.client_id && participant.client_id === booking.client_id);
    const sameEmail = Boolean(normalizeEmail(booking.contact_email) && normalizeEmail(participant.email) === normalizeEmail(booking.contact_email));
    const samePhone = Boolean(normalizePhone(booking.contact_phone) && normalizePhone(participant.phone) === normalizePhone(booking.contact_phone));
    const sameName = Boolean(normalizeText(booking.contact_name) && normalizeName(participant) === normalizeText(booking.contact_name));
    return sameClient || sameEmail || samePhone || sameName;
  };
  const hasResponsibleEquivalent = (excludeId?: string) =>
    list.some((participant) => participant.id !== excludeId && participantMatchesBookingContact(participant));
  const updateBookingMetadata = async (patch: Record<string, unknown>) => {
    const nextMetadata = { ...bookingMetadata, ...patch };
    const { data, error } = await (supabase as any)
      .from("bookings")
      .update({ metadata: nextMetadata })
      .eq("id", bookingId)
      .select("id,client_id,contact_name,contact_email,contact_phone,trip_id,metadata")
      .maybeSingle();
    if (error) {
      toast.error(/metadata/i.test(error.message ?? "") ? "Migration SQL requise : bookings.metadata est absent." : error.message);
      return false;
    }
    setBooking(data ?? { ...booking, metadata: nextMetadata });
    return true;
  };

  const leadCount = list.filter((participant) => participant.is_lead).length;
  const hasResponsible = leadCount > 0;
  const duplicateWarnings = useMemo(() => {
    const warnings: string[] = [];
    const seen = new Map<string, any>();
    const check = (key: string, label: string, participant: any) => {
      if (!key) return;
      const previous = seen.get(`${label}:${key}`);
      if (previous) warnings.push(`${label}: ${[participant.first_name, participant.last_name].filter(Boolean).join(" ")} ressemble à ${[previous.first_name, previous.last_name].filter(Boolean).join(" ")}`);
      else seen.set(`${label}:${key}`, participant);
    };
    list.forEach((participant) => {
      check(normalizePassport(participant.passport_no), "Passeport identique", participant);
      check(participant.client_id ?? "", "Même fiche CRM", participant);
      if (normalizeName(participant) && participant.date_of_birth) check(`${normalizeName(participant)}|${participant.date_of_birth}`, "Même nom + naissance", participant);
    });
    if (leadCount > 1) warnings.push(`${leadCount} responsables détectés`);
    return warnings;
  }, [list, leadCount]);

  const startEdit = (p: any) => { setEditing(p.id); setDraft({ ...p }); };
  const cancelEdit = () => { setEditing(null); setDraft({}); };
  const saveEdit = async () => {
    const { id, created_at, updated_at, booking_id, ...patch } = draft;
    const clean: any = {};
    Object.keys(patch).forEach((k) => { clean[k] = patch[k] === "" ? null : patch[k]; });
    const { error } = await supabase.from("booking_participants").update(clean).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Voyageur mis à jour");
    setEditing(null);
    load();
    onChanged?.();
  };

  const remove = async (p: any) => {
    if (p.is_lead && !confirm("Ce voyageur est le responsable de réservation. Supprimer quand même ?")) return;
    if (!p.is_lead && !confirm("Supprimer ce voyageur de la réservation ?")) return;
    await supabase.from("room_assignments").delete().eq("participant_id", p.id);
    await supabase.from("booking_participant_activities").delete().eq("participant_id", p.id);
    const { error } = await supabase.from("booking_participants").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    if (p.is_lead) {
      await updateBookingMetadata({ responsible_traveller_deleted: true, responsible_traveller_deleted_at: new Date().toISOString() });
    }
    if (p.client_id) {
      const { count } = await supabase
        .from("booking_participants")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", bookingId)
        .eq("client_id", p.client_id);
      const { data: booking } = await supabase.from("bookings").select("client_id").eq("id", bookingId).maybeSingle();
      if ((count ?? 0) === 0 && booking?.client_id === p.client_id) {
        await supabase.from("bookings").update({ client_id: null } as any).eq("id", bookingId);
      }
    }
    const { count: stillExists } = await supabase
      .from("booking_participants")
      .select("id", { count: "exact", head: true })
      .eq("id", p.id);
    if ((stillExists ?? 0) > 0) return toast.error("La suppression n'a pas été persistée.");
    toast.success("Voyageur retiré");
    load();
    onChanged?.();
  };

  const restoreResponsible = async () => {
    if (!booking) return toast.error("Réservation introuvable.");
    if (hasResponsibleEquivalent()) {
      await updateBookingMetadata({ responsible_traveller_deleted: false, responsible_traveller_restored_at: new Date().toISOString() });
      toast.info("Le responsable est déjà représenté par un voyageur existant.");
      load();
      onChanged?.();
      return;
    }
    const name = splitContactName(booking.contact_name);
    const { error } = await supabase.from("booking_participants").insert({
      booking_id: bookingId,
      trip_id: tripId || booking.trip_id || null,
      first_name: name.first_name,
      last_name: name.last_name,
      email: booking.contact_email || null,
      phone: booking.contact_phone || null,
      client_id: booking.client_id || null,
      relation: "self",
      is_lead: true,
    } as any);
    if (error) return toast.error(error.message);
    await updateBookingMetadata({ responsible_traveller_deleted: false, responsible_traveller_restored_at: new Date().toISOString() });
    toast.success("Responsable restauré.");
    load();
    onChanged?.();
  };

  const setAsResponsible = async (participant: any) => {
    if (!participant?.id) return;
    const fullName = [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim();
    const patch: any = {};
    const hasEmptyContactField = !booking?.contact_name || !booking?.contact_email || !booking?.contact_phone;
    const contactIsDifferent =
      (fullName && fullName !== booking?.contact_name) ||
      (participant.email && participant.email !== booking?.contact_email) ||
      (participant.phone && participant.phone !== booking?.contact_phone);

    if (hasEmptyContactField || (contactIsDifferent && confirm("Mettre à jour le contact de réservation avec ce voyageur ?"))) {
      if (!booking?.contact_name || contactIsDifferent) patch.contact_name = fullName || booking?.contact_name;
      if ((!booking?.contact_email || contactIsDifferent) && participant.email) patch.contact_email = participant.email;
      if ((!booking?.contact_phone || contactIsDifferent) && participant.phone) patch.contact_phone = participant.phone;
    }
    if (participant.client_id && !booking?.client_id) patch.client_id = participant.client_id;

    const { error: unsetError } = await supabase
      .from("booking_participants")
      .update({ is_lead: false } as any)
      .eq("booking_id", bookingId)
      .neq("id", participant.id);
    if (unsetError) return toast.error(unsetError.message);

    const { error: setError } = await supabase
      .from("booking_participants")
      .update({ is_lead: true, relation: participant.relation || "self" } as any)
      .eq("id", participant.id);
    if (setError) return toast.error(setError.message);

    const nextMetadata = {
      ...bookingMetadata,
      responsible_traveller_deleted: false,
      responsible_traveller_selected_at: new Date().toISOString(),
      responsible_traveller_participant_id: participant.id,
    };
    const bookingPatch = { ...patch, metadata: nextMetadata };
    const { data, error: bookingError } = await (supabase as any)
      .from("bookings")
      .update(bookingPatch)
      .eq("id", bookingId)
      .select("id,client_id,contact_name,contact_email,contact_phone,trip_id,metadata")
      .maybeSingle();
    if (bookingError) return toast.error(bookingError.message);

    setBooking(data ?? { ...booking, ...bookingPatch });
    setChoosingResponsible(false);
    toast.success("Responsable défini.");
    load();
    onChanged?.();
  };

  const repairDuplicates = async () => {
    if (!confirm("Nettoyer les doublons de voyageurs pour cette réservation ?")) return;
    const grouped = new Map<string, any[]>();
    list.forEach((participant) => {
      const keys = [
        normalizePassport(participant.passport_no) ? `passport:${normalizePassport(participant.passport_no)}` : "",
        participant.client_id ? `client:${participant.client_id}` : "",
        normalizeName(participant) && participant.date_of_birth ? `name_birth:${normalizeName(participant)}|${participant.date_of_birth}` : "",
      ].filter(Boolean);
      keys.forEach((key) => grouped.set(key, [...(grouped.get(key) ?? []), participant]));
    });
    const duplicates = new Set<string>();
    grouped.forEach((participants) => {
      if (participants.length < 2) return;
      const keep = [...participants].sort((a, b) => {
        const score = (item: any) => (item.client_id ? 8 : 0) + (item.passport_no ? 2 : 0) + (item.is_lead ? 1 : 0);
        const scoreDiff = score(b) - score(a);
        if (scoreDiff) return scoreDiff;
        return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
      })[0];
      participants.forEach((participant) => {
        if (participant.id !== keep.id) duplicates.add(participant.id);
      });
    });
    if (duplicates.size === 0) {
      toast.info("Aucun doublon détecté.");
      return;
    }
    const ids = Array.from(duplicates);
    const deletedLeadFallback = list.some((participant) => ids.includes(participant.id) && participant.is_lead);
    await supabase.from("room_assignments").delete().in("participant_id", ids);
    await supabase.from("booking_participant_activities").delete().in("participant_id", ids);
    const { error } = await supabase.from("booking_participants").delete().in("id", ids);
    if (error) return toast.error(error.message);
    if (deletedLeadFallback) {
      await updateBookingMetadata({ responsible_traveller_deleted: true, responsible_traveller_deleted_at: new Date().toISOString() });
    }
    toast.success(`${ids.length} doublon(s) supprimé(s).`);
    load();
    onChanged?.();
  };

  const filled = list.length;
  const remaining = Math.max(0, expectedTravelers - filled);
  const overflow = filled > expectedTravelers;

  return (
    <section className="rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg">Voyageurs associés</h2>
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs sm:flex sm:flex-wrap">
            <Badge variant="outline">Prévus : {expectedTravelers}</Badge>
            <Badge variant="outline">Renseignés : {filled}</Badge>
            <Badge variant="outline">Stockés DB : {list.length}</Badge>
            <Badge variant={remaining === 0 ? "default" : "secondary"}>Restant : {remaining}</Badge>
            {overflow && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Dépassement</Badge>
            )}
            {duplicateWarnings.length > 0 && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Doublons possibles</Badge>
            )}
            {responsibleDeleted && list.length === 0 && (
              <Badge variant="secondary">Responsable supprimé</Badge>
            )}
            {!hasResponsible && list.length > 0 && (
              <Badge variant="destructive" className="gap-1"><AlertTriangle className="w-3 h-3" /> Aucun responsable</Badge>
            )}
          </div>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto sm:flex">
          {!hasResponsible && list.length > 0 && (
            <Button size="sm" variant="outline" className="min-h-11" onClick={() => setChoosingResponsible(true)}>
              <UserCheck className="w-4 h-4" /> Choisir un responsable
            </Button>
          )}
          {responsibleDeleted && list.length === 0 && <Button size="sm" variant="outline" className="min-h-11" onClick={restoreResponsible}>Restaurer responsable</Button>}
          <Button size="sm" variant="outline" className="min-h-11" onClick={repairDuplicates}>Nettoyer les doublons</Button>
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setOpenLink(true)}><UserPlus className="w-4 h-4" /> Associer</Button>
          <Button size="sm" className="min-h-11" onClick={() => setOpenAdd(true)}><Plus className="w-4 h-4" /> Nouveau</Button>
        </div>
      </div>

      {editing && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          Modifications non enregistrées. Utilisez “Enregistrer les modifications” avant de quitter.
        </div>
      )}

      {!hasResponsible && list.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">Aucun responsable défini</p>
          <p className="mt-1">Choisissez le voyageur qui doit servir de contact principal pour cette réservation.</p>
        </div>
      )}

      {duplicateWarnings.length > 0 && (
        <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">Diagnostics intégrité</p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {duplicateWarnings.slice(0, 4).map((warning, index) => <li key={index}>{warning}</li>)}
          </ul>
        </div>
      )}

      {list.length === 0 && <p className="text-sm text-muted-foreground">Aucun voyageur renseigné.</p>}

      <div className="space-y-2">
        {list.map((p) => {
          const isEdit = editing === p.id;
          if (isEdit) {
            return (
              <div key={p.id} className="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 text-sm sm:grid-cols-2 md:grid-cols-4">
                <Input placeholder="Prénom" value={draft.first_name ?? ""} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
                <Input placeholder="Nom" value={draft.last_name ?? ""} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
                <Select value={draft.sex ?? "none"} onValueChange={(v) => setDraft({ ...draft, sex: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Sexe" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    <SelectItem value="M">M</SelectItem>
                    <SelectItem value="F">F</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="date" value={draft.date_of_birth ?? ""} onChange={(e) => setDraft({ ...draft, date_of_birth: e.target.value })} />
                <Input placeholder="Profession" value={draft.profession ?? ""} onChange={(e) => setDraft({ ...draft, profession: e.target.value })} />
                <Select value={draft.marital_status ?? "none"} onValueChange={(v) => setDraft({ ...draft, marital_status: v === "none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="État civil" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {MARITAL_STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input placeholder="Nationalité" value={draft.nationality ?? ""} onChange={(e) => setDraft({ ...draft, nationality: e.target.value })} />
                <Input placeholder="N° passeport" value={draft.passport_no ?? ""} onChange={(e) => setDraft({ ...draft, passport_no: e.target.value })} />
                <Input type="date" placeholder="Émission" value={draft.passport_issue_date ?? ""} onChange={(e) => setDraft({ ...draft, passport_issue_date: e.target.value })} />
                <Input type="date" placeholder="Expiration" value={draft.passport_expiry ?? ""} onChange={(e) => setDraft({ ...draft, passport_expiry: e.target.value })} />
                <Input placeholder="Email" value={draft.email ?? ""} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
                <Input placeholder="Téléphone" value={draft.phone ?? ""} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
                <Select value={draft.relation ?? "other"} onValueChange={(v) => setDraft({ ...draft, relation: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(RELATIONS).map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
                </Select>
                <Textarea className="sm:col-span-2 md:col-span-4" placeholder="Adresse complète" value={draft.address ?? ""} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                <div className="flex gap-1 justify-end sm:col-span-2 md:col-span-4">
                  <Button size="sm" variant="outline" className="min-h-11" onClick={cancelEdit}><X className="w-4 h-4" /></Button>
                  <Button size="sm" className="min-h-11" onClick={saveEdit}><Save className="w-4 h-4" /> Enregistrer les modifications</Button>
                </div>
              </div>
            );
          }
          return (
            <div key={p.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="truncate font-medium">{p.first_name} {p.last_name}</p>
                  {p.is_lead && <Badge variant="default" className="text-[10px]">Responsable</Badge>}
                  {p.relation && <Badge variant="outline" className="text-[10px]">{RELATIONS[p.relation] ?? p.relation}</Badge>}
                  {p.client_id && (
                    <Link to={`/admin/clients/${p.client_id}`} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      CRM <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {p.sex || "—"} · {p.date_of_birth ?? "—"} · {p.nationality || "—"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {p.profession || "—"} · {maritalStatusLabel(p.marital_status)}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                {!p.is_lead && (
                  <Button
                    size="sm"
                    variant={choosingResponsible ? "default" : "outline"}
                    className="min-h-11"
                    onClick={() => setAsResponsible(p)}
                  >
                    <UserCheck className="w-4 h-4" /> Définir comme responsable
                  </Button>
                )}
                <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => startEdit(p)}><Pencil className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" className="h-11 w-11" onClick={() => remove(p)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
              </div>
              <QuickActions phone={p.phone} email={p.email} passport={p.passport_no} compact className="mt-3" />
              <details className="group mt-3 rounded-lg bg-muted/40">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold text-muted-foreground">
                  Passeport & détails
                  <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                </summary>
                <div className="grid grid-cols-2 gap-3 px-3 pb-3 text-xs">
                  <div><p className="text-muted-foreground">Passeport</p><p className="font-medium text-foreground">{p.passport_no || "—"}</p></div>
                  <div><p className="text-muted-foreground">Expiration</p><p className="font-medium text-foreground">{p.passport_expiry || "—"}</p></div>
                  <div><p className="text-muted-foreground">Émission</p><p className="font-medium text-foreground">{p.passport_issue_date || "—"}</p></div>
                  <div><p className="text-muted-foreground">Contact</p><p className="truncate font-medium text-foreground">{p.email || p.phone || "—"}</p></div>
                  {p.address && <div className="col-span-2"><p className="text-muted-foreground">Adresse</p><p className="break-words font-medium text-foreground">{p.address}</p></div>}
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <AddTravelerDialog open={openAdd} onOpenChange={setOpenAdd} bookingId={bookingId} tripId={tripId} onSaved={() => { load(); onChanged?.(); }} />
      <LinkExistingClientDialog open={openLink} onOpenChange={setOpenLink} bookingId={bookingId} tripId={tripId} onSaved={() => { load(); onChanged?.(); }} />
    </section>
  );
}
