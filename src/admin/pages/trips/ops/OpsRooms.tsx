import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Copy, Plus, Trash2, Download, Building2 } from "lucide-react";
import { exportCsv } from "@/admin/lib/export-csv";
import { toast } from "sonner";

const DEFAULT_HOTELS = [
  "Tokyo 1er séjour", "Kamakura", "Hakone", "Kyoto", "Osaka", "Tokyo 2ème séjour",
];
const ROOM_TYPES = ["Single", "Twin", "Double", "Triple"];
const roomLabel = (room: any) => String(room?.room_number ?? room?.room_name ?? "").trim();
const roomNumberValue = (room: any) => {
  const match = roomLabel(room).match(/\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : Number.POSITIVE_INFINITY;
};
const compareRoomsNaturally = (a: any, b: any) => {
  const numericDiff = roomNumberValue(a) - roomNumberValue(b);
  if (numericDiff !== 0 && Number.isFinite(numericDiff)) return numericDiff;
  return roomLabel(a).localeCompare(roomLabel(b), "fr", { numeric: true, sensitivity: "base" })
    || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""))
    || String(a.id ?? "").localeCompare(String(b.id ?? ""));
};
const sortRoomsNaturally = (roomList: any[]) => [...roomList].sort(compareRoomsNaturally);

export default function OpsRooms({ trip }: { trip: any }) {
  const [hotels, setHotels] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [participants, setParticipants] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [activeHotel, setActiveHotel] = useState<string>("");
  const [hotelDialog, setHotelDialog] = useState(false);
  const [newHotel, setNewHotel] = useState({ name: "", city: "" });
  const [roomDialog, setRoomDialog] = useState(false);
  const [newRoom, setNewRoom] = useState<any>({ room_number: "", room_type: "Twin", capacity: 2 });
  const [copyDialog, setCopyDialog] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyForm, setCopyForm] = useState({
    sourceHotelId: "",
    targetHotelId: "",
    includeAssignments: true,
    replaceExisting: false,
  });

  const load = async () => {
    const [{ data: h }, { data: bks }] = await Promise.all([
      supabase.from("trip_hotels").select("*").eq("trip_id", trip.id).order("sort_order"),
      supabase.from("bookings").select("id,reference,contact_name").eq("trip_id", trip.id),
    ]);
    let hotelList = h ?? [];
    if (hotelList.length === 0) {
      // seed defaults
      const seeded = DEFAULT_HOTELS.map((name, i) => ({ trip_id: trip.id, name, sort_order: i }));
      const { data: ins } = await supabase.from("trip_hotels").insert(seeded).select();
      hotelList = ins ?? [];
    }
    setHotels(hotelList);
    setBookings(bks ?? []);
    if (!activeHotel && hotelList[0]) setActiveHotel(hotelList[0].id);

    const hotelIds = hotelList.map((x) => x.id);
    if (hotelIds.length) {
      const { data: rms } = await supabase.from("trip_rooms").select("*").in("trip_hotel_id", hotelIds);
      setRooms(rms ?? []);
      const roomIds = (rms ?? []).map((r) => r.id);
      if (roomIds.length) {
        const { data: ass } = await supabase.from("room_assignments").select("*").in("room_id", roomIds);
        setAssignments(ass ?? []);
      } else { setAssignments([]); }
    }

    const bookingIds = (bks ?? []).map((b) => b.id);
    if (bookingIds.length) {
      const { data: parts } = await supabase.from("booking_participants").select("*").in("booking_id", bookingIds);
      setParticipants(parts ?? []);
    } else setParticipants([]);
  };

  useEffect(() => { load(); }, [trip.id]);

  const addHotel = async () => {
    if (!newHotel.name) return;
    await supabase.from("trip_hotels").insert({ trip_id: trip.id, name: newHotel.name, city: newHotel.city, sort_order: hotels.length });
    setHotelDialog(false); setNewHotel({ name: "", city: "" }); load();
  };
  const removeHotel = async (id: string) => {
    if (!confirm("Supprimer cet hôtel et toutes ses chambres ?")) return;
    await supabase.from("trip_hotels").delete().eq("id", id); load();
  };

  const addRoom = async () => {
    if (!activeHotel) return;
    await supabase.from("trip_rooms").insert({ ...newRoom, trip_hotel_id: activeHotel });
    setRoomDialog(false); setNewRoom({ room_number: "", room_type: "Twin", capacity: 2 }); load();
  };
  const removeRoom = async (id: string) => {
    if (!confirm("Supprimer cette chambre ?")) return;
    await supabase.from("trip_rooms").delete().eq("id", id); load();
  };

  const assignParticipant = async (roomId: string, participantId: string) => {
    if (!participantId) return;
    const room = rooms.find((r) => r.id === roomId);
    const sameHotelRoomIds = rooms.filter((r) => r.trip_hotel_id === room?.trip_hotel_id).map((r) => r.id);
    if (sameHotelRoomIds.length) {
      await supabase.from("room_assignments").delete().eq("participant_id", participantId).in("room_id", sameHotelRoomIds);
    }
    await supabase.from("room_assignments").insert({ room_id: roomId, participant_id: participantId });
    load();
  };
  const unassign = async (assignmentId: string) => {
    await supabase.from("room_assignments").delete().eq("id", assignmentId);
    load();
  };

  const hotelRooms = sortRoomsNaturally(rooms.filter((r) => r.trip_hotel_id === activeHotel));
  const getHotelRooms = (hotelId: string) => sortRoomsNaturally(rooms.filter((r) => r.trip_hotel_id === hotelId));
  const openCopyRooms = (sourceHotelId = activeHotel) => {
    const fallbackTarget = hotels.find((hotel) => hotel.id !== sourceHotelId)?.id ?? "";
    setCopyForm({
      sourceHotelId,
      targetHotelId: fallbackTarget,
      includeAssignments: true,
      replaceExisting: false,
    });
    setCopyDialog(true);
  };

  const partInfo = (id: string) => {
    const p = participants.find((x) => x.id === id);
    if (!p) return null;
    const b = bookings.find((x) => x.id === p.booking_id);
    return { p, b };
  };

  const doExportHotel = () => {
    const hotel = hotels.find((h) => h.id === activeHotel);
    const out: any[] = [];
    for (const r of hotelRooms) {
      const ass = assignments.filter((a) => a.room_id === r.id);
      if (ass.length === 0) {
        out.push({ chambre: r.room_number, type: r.room_type });
      } else {
        for (const a of ass) {
          const info = partInfo(a.participant_id); if (!info) continue;
          out.push({
            reservation_par: info.b?.contact_name, chambre: r.room_number, type_chambre: r.room_type,
            type_client: info.p.client_type, prenom: info.p.first_name, nom: info.p.last_name,
            sexe: info.p.sex, naissance: info.p.date_of_birth, passeport: info.p.passport_no,
            emission: info.p.passport_issue_date, expiration: info.p.passport_expiry,
          });
        }
      }
    }
    exportCsv(`chambres-${trip.title}-${hotel?.name}`, out);
  };

  const doExportAll = () => {
    const out: any[] = [];
    for (const h of hotels) {
      const hr = getHotelRooms(h.id);
      for (const r of hr) {
        const ass = assignments.filter((a) => a.room_id === r.id);
        for (const a of ass) {
          const info = partInfo(a.participant_id); if (!info) continue;
          out.push({
            hotel: h.name, chambre: r.room_number, type_chambre: r.room_type,
            type_client: info.p.client_type, prenom: info.p.first_name, nom: info.p.last_name,
            passeport: info.p.passport_no,
          });
        }
      }
    }
    exportCsv(`chambres-${trip.title}-global`, out);
  };

  const copyRooms = async () => {
    const { sourceHotelId, targetHotelId, includeAssignments, replaceExisting } = copyForm;
    if (!sourceHotelId || !targetHotelId) return toast.error("Sélectionnez un hôtel source et un hôtel cible.");
    if (sourceHotelId === targetHotelId) return toast.error("La source et la cible doivent être deux hôtels différents.");

    const sourceRooms = getHotelRooms(sourceHotelId);
    const targetRooms = getHotelRooms(targetHotelId);
    if (sourceRooms.length === 0) return toast.error("Aucune chambre à copier dans l'hôtel source.");

    if (targetRooms.length > 0 && replaceExisting) {
      const targetHotel = hotels.find((hotel) => hotel.id === targetHotelId);
      if (!confirm(`Remplacer les ${targetRooms.length} chambre(s) existante(s) de ${targetHotel?.name ?? "l'hôtel cible"} ?`)) return;
    }

    setCopyBusy(true);
    try {
      const targetRoomIds = targetRooms.map((room) => room.id);
      if (replaceExisting && targetRoomIds.length > 0) {
        const { error: assignmentDeleteError } = await supabase.from("room_assignments").delete().in("room_id", targetRoomIds);
        if (assignmentDeleteError) throw assignmentDeleteError;
        const { error: roomDeleteError } = await supabase.from("trip_rooms").delete().in("id", targetRoomIds);
        if (roomDeleteError) throw roomDeleteError;
      }

      const roomMap = new Map<string, string>();
      for (const room of sourceRooms) {
        const roomPayload = {
          trip_hotel_id: targetHotelId,
          room_number: room.room_number ?? null,
          room_type: room.room_type ?? "Twin",
          capacity: Number(room.capacity ?? 2) || 2,
          client_type: room.client_type ?? null,
          notes: room.notes ?? null,
        };
        const { data: insertedRoom, error: insertRoomError } = await supabase
          .from("trip_rooms")
          .insert(roomPayload)
          .select("id")
          .maybeSingle();
        if (insertRoomError) throw insertRoomError;
        if (!insertedRoom?.id) throw new Error("Chambre copiée sans identifiant retourné.");
        roomMap.set(room.id, insertedRoom.id);
      }

      let skippedAssignments = 0;
      if (includeAssignments && roomMap.size > 0) {
        const sourceRoomIds = new Set(sourceRooms.map((room) => room.id));
        const existingTargetAssignments = replaceExisting
          ? []
          : assignments.filter((assignment) => targetRoomIds.includes(assignment.room_id));
        const targetParticipantIds = new Set(existingTargetAssignments.map((assignment) => assignment.participant_id));
        const assignmentPayloads: Array<{ room_id: string; participant_id: string }> = [];

        for (const assignment of assignments.filter((item) => sourceRoomIds.has(item.room_id))) {
          const newRoomId = roomMap.get(assignment.room_id);
          if (!newRoomId || !assignment.participant_id) continue;
          if (targetParticipantIds.has(assignment.participant_id)) {
            skippedAssignments += 1;
            continue;
          }
          targetParticipantIds.add(assignment.participant_id);
          assignmentPayloads.push({ room_id: newRoomId, participant_id: assignment.participant_id });
        }

        if (assignmentPayloads.length > 0) {
          const { error: insertAssignmentsError } = await supabase.from("room_assignments").insert(assignmentPayloads);
          if (insertAssignmentsError) throw insertAssignmentsError;
        }
      }

      setCopyDialog(false);
      setActiveHotel(targetHotelId);
      toast.success("Chambres copiées avec succès.");
      if (skippedAssignments > 0) {
        toast.warning(`${skippedAssignments} affectation(s) ignorée(s) pour éviter des doublons dans l'hôtel cible.`);
      }
      await load();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible de copier les chambres.");
    } finally {
      setCopyBusy(false);
    }
  };

  const activeHotelRoomIds = getHotelRooms(activeHotel).map((r) => r.id);
  const unassignedParticipants = participants.filter((p) => !assignments.some((a) => a.participant_id === p.id && activeHotelRoomIds.includes(a.room_id)));

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <Dialog open={hotelDialog} onOpenChange={setHotelDialog}>
          <DialogTrigger asChild><Button variant="outline" size="sm"><Building2 className="w-4 h-4" /> Ajouter hôtel</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nouvel hôtel/séjour</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Nom</Label><Input value={newHotel.name} onChange={(e) => setNewHotel({ ...newHotel, name: e.target.value })} /></div>
              <div><Label>Ville</Label><Input value={newHotel.city} onChange={(e) => setNewHotel({ ...newHotel, city: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={addHotel}>Ajouter</Button></DialogFooter>
          </DialogContent>
        </Dialog>
        <Button variant="outline" size="sm" onClick={doExportHotel}><Download className="w-4 h-4" /> Export hôtel</Button>
        <Button variant="outline" size="sm" onClick={doExportAll}><Download className="w-4 h-4" /> Export global</Button>
      </div>

      <Dialog open={copyDialog} onOpenChange={setCopyDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Copier chambres</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Hôtel source</Label>
                <Select
                  value={copyForm.sourceHotelId}
                  onValueChange={(value) => {
                    const nextTarget = copyForm.targetHotelId && copyForm.targetHotelId !== value
                      ? copyForm.targetHotelId
                      : hotels.find((hotel) => hotel.id !== value)?.id ?? "";
                    setCopyForm({ ...copyForm, sourceHotelId: value, targetHotelId: nextTarget });
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    {hotels.map((hotel) => (
                      <SelectItem key={hotel.id} value={hotel.id}>{hotel.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Hôtel cible</Label>
                <Select
                  value={copyForm.targetHotelId}
                  onValueChange={(value) => setCopyForm({ ...copyForm, targetHotelId: value })}
                >
                  <SelectTrigger><SelectValue placeholder="Cible" /></SelectTrigger>
                  <SelectContent>
                    {hotels.filter((hotel) => hotel.id !== copyForm.sourceHotelId).map((hotel) => (
                      <SelectItem key={hotel.id} value={hotel.id}>{hotel.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-secondary/30 p-3 text-sm">
              <p className="font-medium">Options</p>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={copyForm.includeAssignments}
                  onChange={(event) => setCopyForm({ ...copyForm, includeAssignments: event.target.checked })}
                />
                <span>Copier la structure des chambres + affectations participants</span>
              </label>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                Décochez pour copier uniquement les chambres, types, capacités et notes.
              </p>
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={copyForm.replaceExisting}
                  onChange={(event) => setCopyForm({ ...copyForm, replaceExisting: event.target.checked })}
                />
                <span>Remplacer les chambres existantes de l'hôtel cible</span>
              </label>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                Si non coché, les chambres copiées sont ajoutées à la liste existante.
              </p>
            </div>

            {copyForm.targetHotelId && getHotelRooms(copyForm.targetHotelId).length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                L'hôtel cible contient déjà {getHotelRooms(copyForm.targetHotelId).length} chambre(s).
                {copyForm.replaceExisting
                  ? " Une confirmation sera demandée avant remplacement."
                  : " La copie sera fusionnée et les affectations en double seront ignorées."}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCopyDialog(false)} disabled={copyBusy}>Annuler</Button>
            <Button onClick={copyRooms} disabled={copyBusy || !copyForm.sourceHotelId || !copyForm.targetHotelId}>
              {copyBusy ? "Copie…" : "Copier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {hotels.length === 0 ? (
        <div className="bg-background rounded-2xl border border-border p-8 text-center text-muted-foreground">Aucun hôtel.</div>
      ) : (
        <Tabs value={activeHotel} onValueChange={setActiveHotel}>
          <TabsList className="flex-wrap h-auto mb-4">
            {hotels.map((h) => <TabsTrigger key={h.id} value={h.id}>{h.name}</TabsTrigger>)}
          </TabsList>
          {hotels.map((h) => {
            const currentHotelRooms = getHotelRooms(h.id);
            return (
            <TabsContent key={h.id} value={h.id}>
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="font-display text-lg">{h.name}</h3>
                  {h.city && <p className="text-xs text-muted-foreground">{h.city}</p>}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => openCopyRooms(h.id)} disabled={hotels.length < 2}>
                    <Copy className="w-4 h-4" /> Copier chambres
                  </Button>
                  <Dialog open={roomDialog} onOpenChange={setRoomDialog}>
                    <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4" /> Ajouter chambre</Button></DialogTrigger>
                    <DialogContent>
                      <DialogHeader><DialogTitle>Nouvelle chambre</DialogTitle></DialogHeader>
                      <div className="grid grid-cols-2 gap-3">
                        <div><Label>N° chambre</Label><Input value={newRoom.room_number} onChange={(e) => setNewRoom({ ...newRoom, room_number: e.target.value })} /></div>
                        <div>
                          <Label>Type</Label>
                          <Select value={newRoom.room_type} onValueChange={(v) => setNewRoom({ ...newRoom, room_type: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                        </div>
                        <div><Label>Capacité</Label><Input type="number" value={newRoom.capacity} onChange={(e) => setNewRoom({ ...newRoom, capacity: +e.target.value })} /></div>
                      </div>
                      <DialogFooter><Button onClick={addRoom}>Ajouter</Button></DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Button size="sm" variant="ghost" onClick={() => removeHotel(h.id)}><Trash2 className="w-4 h-4" /></Button>
                </div>
              </div>

              <div className="space-y-3">
                {currentHotelRooms.length === 0 && <p className="text-sm text-muted-foreground">Aucune chambre dans cet hôtel.</p>}
                {currentHotelRooms.map((r) => {
                  const ass = assignments.filter((a) => a.room_id === r.id);
                  return (
                    <div key={r.id} className="bg-background border border-border rounded-xl p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-3">
                          <span className="font-semibold">Ch. {r.room_number || "—"}</span>
                          <Select value={r.room_type} onValueChange={async (v) => { await supabase.from("trip_rooms").update({ room_type: v }).eq("id", r.id); load(); }}>
                            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                            <SelectContent>{ROOM_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                          </Select>
                          <span className="text-xs text-muted-foreground">{ass.length}/{r.capacity}</span>
                        </div>
                        <Button size="sm" variant="ghost" onClick={() => removeRoom(r.id)}><Trash2 className="w-4 h-4" /></Button>
                      </div>
                      <div className="space-y-2">
                        {ass.map((a) => {
                          const info = partInfo(a.participant_id);
                          if (!info) return null;
                          return (
                            <div key={a.id} className="flex items-center justify-between text-sm bg-secondary/40 px-3 py-2 rounded">
                              <span>{info.p.first_name} {info.p.last_name} <span className="text-xs text-muted-foreground">— {info.b?.contact_name} ({info.b?.reference})</span></span>
                              <Button size="sm" variant="ghost" onClick={() => unassign(a.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                          );
                        })}
                        {ass.length < r.capacity && unassignedParticipants.length > 0 && (
                          <Select value="" onValueChange={(v) => assignParticipant(r.id, v)}>
                            <SelectTrigger className="text-xs"><SelectValue placeholder="+ Affecter un participant" /></SelectTrigger>
                            <SelectContent>
                              {unassignedParticipants.map((p) => {
                                const b = bookings.find((x) => x.id === p.booking_id);
                                return <SelectItem key={p.id} value={p.id}>{p.first_name} {p.last_name} — {b?.reference}</SelectItem>;
                              })}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          );
          })}
        </Tabs>
      )}
    </div>
  );
}
