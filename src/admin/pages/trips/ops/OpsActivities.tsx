import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, Edit3, Loader2, RefreshCw, Wand2, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { fmtMAD } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { exportCsv } from "@/admin/lib/export-csv";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Trip = {
  id: string;
  title?: string | null;
};

type Extra = {
  id: string;
  name: string;
  price_mad?: number | null;
  is_active?: boolean | null;
  sort_order?: number | null;
};

type Booking = {
  id: string;
  reference?: string | null;
  contact_name?: string | null;
  status?: string | null;
  total_amount_mad?: number | null;
};

type BookingExtra = {
  id: string;
  booking_id: string;
  extra_id?: string | null;
  name_snapshot?: string | null;
  activity_match_status?: string | null;
  qty?: number | null;
  unit_price_mad?: number | null;
};

type Participant = {
  id: string;
  booking_id: string;
  first_name?: string | null;
  last_name?: string | null;
  client_type?: string | null;
  created_at?: string | null;
};

type ParticipantSelection = {
  id: string;
  participant_id: string;
  extra_id: string;
  is_selected: boolean | null;
  booking_id?: string | null;
  booking_extra_id?: string | null;
  source?: string | null;
  created_at?: string | null;
  assigned_at?: string | null;
  assigned_by?: string | null;
  removed_at?: string | null;
  removed_by?: string | null;
};

type ReconcileResult = {
  ok?: boolean;
  safe_exact?: number;
  ambiguous?: number;
  applied?: number;
  items?: Array<{
    booking_reference?: string | null;
    name_snapshot?: string | null;
    activity_name?: string | null;
    qty?: number | null;
    active_participants?: number | null;
    existing_assignments?: number | null;
    status?: string | null;
  }>;
};

type ActivityRpcClient = {
  rpc: (
    fn:
      | "admin_set_booking_participant_activity"
      | "admin_reconcile_trip_activity_assignments"
      | "admin_link_booking_extra_to_activity"
      | "admin_repair_booking_activity_assignments"
      | "admin_remove_inconsistent_booking_activity_assignment",
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: SupabaseActivityError | null }>;
};

const activityRpcClient = supabase as unknown as ActivityRpcClient;

type SupabaseActivityError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
};

const normalizeActivityName = (value: unknown) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();

const toNumber = (value: unknown) => Number(value ?? 0) || 0;

const logActivityMutationError = (context: string, error: unknown) => {
  if (!import.meta.env.DEV) return;
  const supabaseError = error as SupabaseActivityError;
  console.warn("[ops-activities]", context, {
    code: supabaseError?.code ?? null,
    message: supabaseError?.message ?? (error instanceof Error ? error.message : null),
    details: supabaseError?.details ?? null,
    hint: supabaseError?.hint ?? null,
  });
};

const activityMutationErrorMessage = (error: unknown) => {
  const supabaseError = error as SupabaseActivityError;
  const code = String(supabaseError?.code ?? "");
  const message = String(supabaseError?.message ?? (error instanceof Error ? error.message : "")).trim();

  if (code === "PGRST202" || /function .* not found|could not find.*function|schema cache/i.test(message)) {
    return "La migration de réparation des activités n’est pas encore appliquée.";
  }
  if (code === "42501" || /admin_required|not_allowed|permission|rls/i.test(message)) {
    return "Vous n’avez pas l’autorisation de corriger cette affectation.";
  }
  if (/booking_extra_not_found_for_financial_reduction/i.test(message)) {
    return "Cette ancienne affectation n’a aucune unité achetée à diminuer. Utilisez la correction d’affectation incohérente.";
  }
  if (/assignment_not_inconsistent/i.test(message)) {
    return "Cette affectation n’est plus incohérente. Actualisez la matrice avant de réessayer.";
  }
  if (/booking_extra_required_for_activity_assignment|booking_extra_mismatch|activity_extra_capacity_exceeded/i.test(message)) {
    return "Le serveur a refusé la modification pour protéger l’intégrité des activités.";
  }
  return message || "Modification impossible.";
};

const participantName = (participant: Participant) =>
  [participant.first_name, participant.last_name].filter(Boolean).join(" ").trim() || "Participant";

const isParticipantActive = (participant: Participant) => {
  const status = normalizeActivityName(participant.client_type);
  return !["cancelled", "canceled", "deleted", "archived", "removed"].includes(status);
};

export default function OpsActivities({ trip }: { trip: Trip }) {
  const { isAdmin, isSuperAdmin } = useAuth();
  const [extras, setExtras] = useState<Extra[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingExtras, setBookingExtras] = useState<BookingExtra[]>([]);
  const [selections, setSelections] = useState<ParticipantSelection[]>([]);
  const [filterExtra, setFilterExtra] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [savingCell, setSavingCell] = useState<string | null>(null);
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  const [linkingBookingExtra, setLinkingBookingExtra] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [repairingBookingId, setRepairingBookingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const canAdjustFinancials = isAdmin || isSuperAdmin;

  const extraById = useMemo(() => new Map(extras.map((extra) => [extra.id, extra])), [extras]);
  const bookingById = useMemo(() => new Map(bookings.map((booking) => [booking.id, booking])), [bookings]);
  const bookingExtraById = useMemo(() => new Map(bookingExtras.map((bookingExtra) => [bookingExtra.id, bookingExtra])), [bookingExtras]);
  const participantsByBooking = useMemo(() => {
    const map = new Map<string, Participant[]>();
    for (const participant of participants) {
      if (!isParticipantActive(participant)) continue;
      const list = map.get(participant.booking_id) ?? [];
      list.push(participant);
      map.set(participant.booking_id, list);
    }
    return map;
  }, [participants]);

  const load = useCallback(async () => {
    if (!trip?.id) return;
    setLoading(true);
    setLoadError(null);

    try {
      const { data: ex, error: extrasError } = await supabase
        .from("extras")
        .select("id,name,price_mad,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (extrasError) throw extrasError;
      setExtras((ex ?? []) as Extra[]);

      const { data: bks, error: bookingsError } = await supabase
        .from("bookings")
        .select("id,reference,contact_name,status,total_amount_mad")
        .eq("trip_id", trip.id)
        .order("reference");
      if (bookingsError) throw bookingsError;
      const loadedBookings = (bks ?? []) as Booking[];
      setBookings(loadedBookings);

      const bookingIds = loadedBookings.map((booking) => booking.id);
      if (!bookingIds.length) {
        setParticipants([]);
        setSelections([]);
        setBookingExtras([]);
        return;
      }

      const { data: bookingExtraRows, error: bookingExtrasError } = await supabase
        .from("booking_extras")
        .select("id,booking_id,extra_id,name_snapshot,activity_match_status,qty,unit_price_mad")
        .in("booking_id", bookingIds);
      if (bookingExtrasError) throw bookingExtrasError;
      setBookingExtras((bookingExtraRows ?? []) as BookingExtra[]);

      const { data: parts, error: participantsError } = await supabase
        .from("booking_participants")
        .select("id,booking_id,first_name,last_name,client_type,created_at")
        .in("booking_id", bookingIds)
        .order("created_at");
      if (participantsError) throw participantsError;
      const loadedParticipants = (parts ?? []) as Participant[];
      setParticipants(loadedParticipants);

      const participantIds = loadedParticipants.map((participant) => participant.id);
      if (!participantIds.length) {
        setSelections([]);
        return;
      }

      const { data: sel, error: selectionsError } = await supabase
        .from("booking_participant_activities")
        .select("id,participant_id,extra_id,is_selected,booking_id,booking_extra_id,source,created_at,assigned_at,assigned_by,removed_at,removed_by")
        .in("participant_id", participantIds);
      if (selectionsError) throw selectionsError;
      setSelections((sel ?? []) as ParticipantSelection[]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Impossible de charger les activités.";
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [trip?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedKey = (participantId: string, extraId: string) => `${participantId}:${extraId}`;

  const selectionFor = useCallback((participantId: string, extraId: string) =>
    selections.find((selection) => selection.participant_id === participantId && selection.extra_id === extraId),
  [selections]);

  const isStableBookingExtra = useCallback((bookingExtra: BookingExtra) => {
    if (!bookingExtra.extra_id) return false;
    const extra = extraById.get(bookingExtra.extra_id);
    if (!extra) return false;
    return bookingExtra.activity_match_status === "manual"
      || normalizeActivityName(bookingExtra.name_snapshot) === normalizeActivityName(extra.name);
  }, [extraById]);

  const stableBookingExtras = useMemo(
    () => bookingExtras.filter(isStableBookingExtra),
    [bookingExtras, isStableBookingExtra],
  );

  const ambiguousBookingExtras = useMemo(() => bookingExtras.filter((bookingExtra) => !isStableBookingExtra(bookingExtra)), [bookingExtras, isStableBookingExtra]);

  const purchasedCount = useCallback((bookingId: string, extraId: string) =>
    stableBookingExtras
      .filter((bookingExtra) => bookingExtra.booking_id === bookingId && bookingExtra.extra_id === extraId)
      .reduce((sum, bookingExtra) => sum + toNumber(bookingExtra.qty), 0),
  [stableBookingExtras]);

  const selectionHealth = useMemo(() => {
    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    const grouped = new Map<string, ParticipantSelection[]>();

    for (const selection of selections) {
      if (!selection.is_selected) continue;
      const participant = participantById.get(selection.participant_id);
      if (!participant || !isParticipantActive(participant)) continue;
      const bookingId = selection.booking_id || participant.booking_id;
      const key = `${bookingId}:${selection.extra_id}`;
      const list = grouped.get(key) ?? [];
      list.push(selection);
      grouped.set(key, list);
    }

    const health = new Map<string, { status: "valid" | "inconsistent"; reason?: string; purchased: number; index: number }>();

    for (const [key, list] of grouped.entries()) {
      const [bookingId, extraId] = key.split(":");
      const purchased = purchasedCount(bookingId, extraId);
      const ordered = [...list].sort((a, b) =>
        String(a.assigned_at || a.created_at || "").localeCompare(String(b.assigned_at || b.created_at || "")) ||
        a.id.localeCompare(b.id),
      );

      ordered.forEach((selection, index) => {
        const linkedBookingExtra = selection.booking_extra_id ? bookingExtraById.get(selection.booking_extra_id) : null;
        const linkedMismatch = Boolean(
          selection.booking_extra_id
          && (
            !linkedBookingExtra
            || linkedBookingExtra.booking_id !== bookingId
            || linkedBookingExtra.extra_id !== extraId
            || !isStableBookingExtra(linkedBookingExtra)
          ),
        );
        if (linkedMismatch) {
          health.set(selection.id, { status: "inconsistent", reason: "Mauvais extra lié", purchased, index });
        } else if (purchased <= 0) {
          health.set(selection.id, { status: "inconsistent", reason: "Affectation sans unité achetée", purchased, index });
        } else if (index >= purchased) {
          health.set(selection.id, { status: "inconsistent", reason: "Quantité affectée supérieure à la quantité achetée", purchased, index });
        } else {
          health.set(selection.id, { status: "valid", purchased, index });
        }
      });
    }

    return health;
  }, [bookingExtraById, isStableBookingExtra, participants, purchasedCount, selections]);

  const assignedCount = useCallback((bookingId: string, extraId: string) => {
    const participantIds = new Set((participantsByBooking.get(bookingId) ?? []).map((participant) => participant.id));
    return selections.filter((selection) => (
      selection.extra_id === extraId
      && selection.is_selected
      && participantIds.has(selection.participant_id)
      && selectionHealth.get(selection.id)?.status === "valid"
    )).length;
  }, [participantsByBooking, selections, selectionHealth]);

  const inconsistentSelections = useMemo(() => selections.filter((selection) => (
    selection.is_selected && selectionHealth.get(selection.id)?.status === "inconsistent"
  )), [selections, selectionHealth]);

  const repairableBookings = useMemo(() => {
    const participantById = new Map(participants.map((participant) => [participant.id, participant]));
    const ids = new Set<string>();
    for (const selection of inconsistentSelections) {
      const participant = participantById.get(selection.participant_id);
      const bookingId = selection.booking_id || participant?.booking_id;
      if (bookingId) ids.add(bookingId);
    }
    return Array.from(ids).map((bookingId) => bookingById.get(bookingId)).filter(Boolean) as Booking[];
  }, [bookingById, inconsistentSelections, participants]);

  const inconsistentCount = useCallback((bookingId: string, extraId: string) => {
    const participantIds = new Set((participantsByBooking.get(bookingId) ?? []).map((participant) => participant.id));
    return inconsistentSelections.filter((selection) => (
      selection.extra_id === extraId && participantIds.has(selection.participant_id)
    )).length;
  }, [inconsistentSelections, participantsByBooking]);

  const extraSummary = useMemo(() => extras.map((extra) => {
    const purchased = bookings.reduce((sum, booking) => sum + purchasedCount(booking.id, extra.id), 0);
    const assigned = bookings.reduce((sum, booking) => sum + assignedCount(booking.id, extra.id), 0);
    const invalid = bookings.reduce((sum, booking) => sum + inconsistentCount(booking.id, extra.id), 0);
    return {
      extra,
      purchased,
      assigned,
      remaining: purchased - assigned,
      inconsistent: invalid > 0 || assigned > purchased,
    };
  }), [assignedCount, bookings, extras, inconsistentCount, purchasedCount]);

  const visibleExtras = useMemo(
    () => filterExtra === "all" ? extras : extras.filter((extra) => extra.id === filterExtra),
    [extras, filterExtra],
  );

  const callSetActivity = async (
    participant: Participant,
    extra: Extra,
    checked: boolean,
    adjustBookingExtra: boolean,
    reduceBookingExtra: boolean,
    reason: string,
  ) => {
    const { error } = await activityRpcClient.rpc("admin_set_booking_participant_activity", {
      p_participant_id: participant.id,
      p_extra_id: extra.id,
      p_is_selected: checked,
      p_adjust_booking_extra: adjustBookingExtra,
      p_reduce_booking_extra: reduceBookingExtra,
      p_reason: reason,
    });
    if (error) throw error;
  };

  const removeInconsistentAssignment = async (selection: ParticipantSelection) => {
    const { error } = await activityRpcClient.rpc("admin_remove_inconsistent_booking_activity_assignment", {
      p_assignment_id: selection.id,
      p_reason: "inconsistent_assignment_removed_from_operations_matrix",
    });
    if (error) throw error;
  };

  const toggle = async (participant: Participant, extra: Extra, checked: boolean) => {
    if (!editMode) return;
    const cellKey = selectedKey(participant.id, extra.id);
    const booking = bookingById.get(participant.booking_id);
    if (!booking) {
      toast.error("Réservation introuvable pour ce participant.");
      return;
    }

    const availableUnits = purchasedCount(participant.booking_id, extra.id) - assignedCount(participant.booking_id, extra.id);
    const explicit = selectionFor(participant.id, extra.id);
    const health = explicit ? selectionHealth.get(explicit.id) : null;
    let adjustBookingExtra = false;
    let reduceBookingExtra = false;

    if (checked && availableUnits <= 0) {
      if (!canAdjustFinancials) {
        toast.error("Aucune unité achetée disponible. Seul un administrateur peut ajouter une activité payante.");
        return;
      }

      const confirmed = window.confirm(
        `Ajouter ${extra.name} à ${participantName(participant)} pour ${fmtMAD(extra.price_mad)} ?\n\nCette action augmentera le total de la réservation ${booking.reference ?? ""}.`,
      );
      if (!confirmed) return;
      adjustBookingExtra = true;
    }

    if (!checked) {
      const confirmed = window.confirm(
        `Retirer l'affectation ${extra.name} pour ${participantName(participant)} ?\n\nLe commentaire d'historique sera conservé.`,
      );
      if (!confirmed) return;

      if (health?.status === "inconsistent") {
        reduceBookingExtra = false;
      } else if (canAdjustFinancials) {
        reduceBookingExtra = window.confirm(
          "Diminuer aussi la quantité achetée et le total de la réservation ?\n\nAnnuler ici conserve l'unité achetée comme non affectée.",
        );
      }
    }

    setSavingCell(cellKey);
    try {
      if (!checked && explicit && health?.status === "inconsistent") {
        await removeInconsistentAssignment(explicit);
        toast.success("Affectation incorrecte retirée. Aucun montant de la réservation n’a été modifié.");
      } else {
        await callSetActivity(
          participant,
          extra,
          checked,
          adjustBookingExtra,
          reduceBookingExtra,
          checked ? "assignment_from_operations_matrix" : "removal_from_operations_matrix",
        );
        toast.success(checked ? "Activité affectée au participant." : "Affectation retirée.");
      }
      await load();
    } catch (error) {
      logActivityMutationError("toggle_failed", error);
      toast.error(activityMutationErrorMessage(error));
    } finally {
      setSavingCell(null);
    }
  };

  const reconcileSafeAssignments = async () => {
    if (!window.confirm("Affecter automatiquement uniquement les extras dont le nom, l'activité, la quantité et les participants correspondent exactement ?")) return;
    setReconciling(true);
    try {
      const { data, error } = await activityRpcClient.rpc("admin_reconcile_trip_activity_assignments", {
        p_trip_id: trip.id,
        p_apply: true,
      });
      if (error) throw error;
      const result = (data ?? {}) as ReconcileResult;
      toast.success(`${result.applied ?? 0} ligne(s) sûre(s) rapprochée(s). ${result.ambiguous ?? 0} ambiguë(s) ignorée(s).`);
      await load();
    } catch (error) {
      logActivityMutationError("reconcile_failed", error);
      toast.error(activityMutationErrorMessage(error) || "Rapprochement impossible.");
    } finally {
      setReconciling(false);
    }
  };

  const linkBookingExtraToActivity = async (bookingExtra: BookingExtra) => {
    const extraId = linkTargets[bookingExtra.id] || bookingExtra.extra_id || "";
    if (!extraId) {
      toast.error("Sélectionnez l'activité exacte à associer.");
      return;
    }

    const extra = extraById.get(extraId);
    const confirmed = window.confirm(
      `Associer la ligne "${bookingExtra.name_snapshot ?? "Extra"}" à l'activité "${extra?.name ?? extraId}" ?\n\nCette action ne modifie pas le prix ni la quantité. Elle rend seulement la relation activité explicite.`,
    );
    if (!confirmed) return;

    setLinkingBookingExtra(bookingExtra.id);
    try {
      const { error } = await activityRpcClient.rpc("admin_link_booking_extra_to_activity", {
        p_booking_extra_id: bookingExtra.id,
        p_extra_id: extraId,
        p_reason: "manual_activity_mapping_from_operations_matrix",
      });
      if (error) throw error;
      toast.success("Extra associé à l'activité.");
      setLinkTargets((current) => {
        const next = { ...current };
        delete next[bookingExtra.id];
        return next;
      });
      await load();
    } catch (error) {
      logActivityMutationError("link_extra_failed", error);
      toast.error(activityMutationErrorMessage(error) || "Association impossible.");
    } finally {
      setLinkingBookingExtra(null);
    }
  };

  const repairBookingAssignments = async (booking: Booking) => {
    if (!canAdjustFinancials) return;
    setRepairingBookingId(booking.id);
    try {
      const previewResponse = await activityRpcClient.rpc("admin_repair_booking_activity_assignments", {
        p_booking_id: booking.id,
        p_apply: false,
        p_reason: "activity_integrity_repair_preview",
      });
      if (previewResponse.error) throw previewResponse.error;
      const preview = (previewResponse.data ?? {}) as {
        removals?: Array<{ participant_name?: string | null; activity_name?: string | null; reason?: string | null }>;
        assignments?: Array<{ participant_name?: string | null; activity_name?: string | null }>;
        ambiguous?: Array<{ name_snapshot?: string | null; activity_name?: string | null; qty?: number | null }>;
      };
      const removals = preview.removals ?? [];
      const assignments = preview.assignments ?? [];
      const ambiguous = preview.ambiguous ?? [];
      const lines = [
        `Réservation ${booking.reference ?? booking.id}`,
        "",
        "Affectations à retirer:",
        ...(removals.length ? removals.map((item) => `- ${item.participant_name} → ${item.activity_name} (${item.reason})`) : ["- Aucune"]),
        "",
        "Unités à affecter:",
        ...(assignments.length ? assignments.map((item) => `- ${item.activity_name} → ${item.participant_name}`) : ["- Aucune"]),
        "",
        "Extras à valider manuellement:",
        ...(ambiguous.length ? ambiguous.map((item) => `- ${item.name_snapshot} × ${item.qty ?? 0}${item.activity_name ? ` → ${item.activity_name}` : ""}`) : ["- Aucun"]),
        "",
        "Appliquer cette correction transactionnelle ?",
      ];
      const confirmed = window.confirm(lines.join("\n"));
      if (!confirmed) return;

      const applyResponse = await activityRpcClient.rpc("admin_repair_booking_activity_assignments", {
        p_booking_id: booking.id,
        p_apply: true,
        p_reason: "activity_integrity_repair_confirmed_from_operations_matrix",
      });
      if (applyResponse.error) throw applyResponse.error;
      toast.success("Affectations corrigées.");
      await load();
    } catch (error) {
      logActivityMutationError("repair_booking_failed", error);
      toast.error(activityMutationErrorMessage(error) || "Correction impossible.");
    } finally {
      setRepairingBookingId(null);
    }
  };

  const doExport = () => {
    exportCsv(`activites-${trip.title ?? trip.id}`, participants.map((participant) => {
      const booking = bookingById.get(participant.booking_id);
      const row: Record<string, string> = {
        prenom: participant.first_name ?? "",
        nom: participant.last_name ?? "",
        reservation: booking?.reference ?? "",
      };
      for (const extra of extras) {
        const explicit = selectionFor(participant.id, extra.id);
        const health = explicit ? selectionHealth.get(explicit.id) : null;
        row[extra.name] = health?.status === "valid" ? "X" : health?.status === "inconsistent" ? "INCOHÉRENT" : "";
      }
      return row;
    }));
  };

  if (loading) {
    return (
      <div className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
        Chargement des inscriptions aux activités...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Chargement impossible</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filterExtra} onValueChange={setFilterExtra}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les activités</SelectItem>
            {extras.map((extra) => (
              <SelectItem key={extra.id} value={extra.id}>
                {extra.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={doExport}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" />
          Actualiser
        </Button>
        <Button variant={editMode ? "default" : "outline"} onClick={() => setEditMode((value) => !value)}>
          <Edit3 className="h-4 w-4" />
          {editMode ? "Quitter le mode modification" : "Modifier les inscriptions"}
        </Button>
        <Button variant="outline" onClick={() => void reconcileSafeAssignments()} disabled={reconciling}>
          {reconciling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          Affecter les cas sûrs
        </Button>
      </div>

      {repairableBookings.length > 0 && (
        <Alert className="border-orange-300 bg-orange-50 text-orange-950">
          <AlertTriangle className="h-4 w-4 text-orange-700" />
          <AlertTitle>Affectations incohérentes détectées</AlertTitle>
          <AlertDescription>
            <div className="space-y-3">
              <p>
                Certaines coches existent dans la table d'affectation, mais aucune unité correspondante n'est achetée dans la réservation.
                Elles ne sont pas comptées comme inscriptions valides ni exportées comme telles.
              </p>
              {canAdjustFinancials && (
                <div className="flex flex-wrap gap-2">
                  {repairableBookings.map((booking) => (
                    <Button
                      key={booking.id}
                      size="sm"
                      variant="outline"
                      className="bg-background"
                      disabled={repairingBookingId === booking.id}
                      onClick={() => void repairBookingAssignments(booking)}
                    >
                      {repairingBookingId === booking.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                      Corriger {booking.reference ?? "la réservation"}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {extraSummary.map(({ extra, purchased, assigned, remaining, inconsistent }) => (
          <div key={extra.id} className="rounded-lg border bg-background p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium leading-tight">{extra.name}</p>
              {inconsistent ? (
                <Badge variant="destructive">Écart</Badge>
              ) : remaining > 0 ? (
                <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">À affecter</Badge>
              ) : (
                <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">OK</Badge>
              )}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {purchased} achetée(s) · {assigned} affectée(s) · {Math.max(0, remaining)} restante(s)
            </p>
          </div>
        ))}
      </div>

      {ambiguousBookingExtras.length > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>Extras non associés automatiquement</AlertTitle>
          <AlertDescription>
            <div className="space-y-2">
              <p>
                Ces lignes commerciales ne sont pas transformées en coches tant qu'elles ne correspondent pas exactement à une activité.
              </p>
              <div className="grid gap-2">
                {ambiguousBookingExtras.map((bookingExtra) => {
                  const booking = bookingById.get(bookingExtra.booking_id);
                  const linkedExtra = bookingExtra.extra_id ? extraById.get(bookingExtra.extra_id) : null;
                  return (
                    <div key={bookingExtra.id} className="grid gap-2 rounded-md border bg-amber-50/70 p-2 text-xs text-amber-900 md:grid-cols-[1fr_260px_auto] md:items-center">
                      <div>
                        <span className="font-medium">{booking?.reference ?? "Réservation"}</span>
                        {" · "}
                        {bookingExtra.name_snapshot || "Extra sans nom"} × {toNumber(bookingExtra.qty)}
                        {" · "}
                        {linkedExtra ? `Activité liée incohérente : ${linkedExtra.name}` : "Activité non associée"}
                      </div>
                      <Select
                        value={linkTargets[bookingExtra.id] || bookingExtra.extra_id || ""}
                        onValueChange={(value) => setLinkTargets((current) => ({ ...current, [bookingExtra.id]: value }))}
                      >
                        <SelectTrigger className="h-8 bg-background text-xs">
                          <SelectValue placeholder="Choisir l'activité" />
                        </SelectTrigger>
                        <SelectContent>
                          {extras.map((extra) => (
                            <SelectItem key={extra.id} value={extra.id}>
                              {extra.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 bg-background"
                        disabled={linkingBookingExtra === bookingExtra.id}
                        onClick={() => void linkBookingExtraToActivity(bookingExtra)}
                      >
                        {linkingBookingExtra === bookingExtra.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Associer"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[820px] table-auto text-sm">
          <thead className="bg-secondary/50 text-left">
            <tr>
              <th className="sticky left-0 z-10 min-w-[190px] bg-secondary/50 p-3 whitespace-normal">Participant</th>
              <th className="min-w-[130px] p-3 whitespace-normal">Réservation</th>
              {visibleExtras.map((extra) => (
                <th key={extra.id} className="min-w-[160px] p-3 text-center align-bottom leading-snug whitespace-normal">
                  {extra.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {participants.length === 0 && (
              <tr>
                <td colSpan={visibleExtras.length + 2} className="p-6 text-center text-muted-foreground">
                  Aucun participant.
                </td>
              </tr>
            )}
            {participants.map((participant) => {
              const booking = bookingById.get(participant.booking_id);
              return (
                <tr key={participant.id} className="hover:bg-secondary/30">
                  <td className="sticky left-0 z-10 bg-background p-3 font-medium whitespace-normal">
                    {participantName(participant)}
                  </td>
                  <td className="p-3 text-xs whitespace-nowrap">{booking?.reference}</td>
                  {visibleExtras.map((extra) => {
                    const explicit = selectionFor(participant.id, extra.id);
                    const health = explicit ? selectionHealth.get(explicit.id) : null;
                    const checked = Boolean(explicit?.is_selected);
                    const validChecked = health?.status === "valid";
                    const inconsistent = health?.status === "inconsistent";
                    const available = purchasedCount(participant.booking_id, extra.id) - assignedCount(participant.booking_id, extra.id);
                    const cellKey = selectedKey(participant.id, extra.id);
                    const saving = savingCell === cellKey;
                    return (
                      <td key={extra.id} className="p-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <Checkbox
                            checked={checked}
                            disabled={!editMode || saving}
                            onCheckedChange={(value) => void toggle(participant, extra, Boolean(value))}
                            aria-label={`${checked ? "Retirer" : "Affecter"} ${extra.name} pour ${participantName(participant)}`}
                          />
                          {saving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                          ) : inconsistent ? (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700"
                              title="Ce participant est affecté à cette activité, mais aucune unité correspondante n'existe dans sa réservation."
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Affectation incohérente
                            </span>
                          ) : validChecked ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                              <CheckCircle2 className="h-3 w-3" />
                              Affecté
                            </span>
                          ) : available > 0 ? (
                            <span className="text-[11px] font-medium text-amber-700" title="Quantité achetée disponible mais participant non affecté">
                              Unité dispo
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <XCircle className="h-3 w-3" />
                              Non affecté
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!editMode && (
        <p className="text-xs text-muted-foreground">
          Lecture sûre : les coches proviennent uniquement des affectations participant-activité enregistrées. Les quantités achetées servent au contrôle financier.
        </p>
      )}
    </div>
  );
}
