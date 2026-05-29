import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Plus, Pencil, Trash2, ArrowUp, ArrowDown, Upload, Star, X, Copy } from "lucide-react";
import { fmtDate, fmtMAD, slugify } from "@/lib/format";
import { toast } from "sonner";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "@/hooks/useAuth";

type Trip = any;

const empty: Trip = {
  title: "", slug: "", season: "", destination: "", start_date: "", end_date: "",
  duration_days: 14, base_price_mad: 0, total_slots: 12, slots_left: 12,
  short_description: "", long_description: "", status: "draft", is_featured: false,
  label: "", badge_type: "", badge_text: "", destinations: [] as string[],
  program_link: "", promo_percent: null, sort_order: 0, cover_url: "",
  visa_japan_arrival_date: "", visa_japan_departure_date: "", visa_arrival_port: "",
  visa_arrival_flight_number: "", visa_hotel_name: "", visa_hotel_address: "",
  visa_hotel_phone: "", programme_id: null, outbound_flight_text: "", return_flight_text: "",
};

export default function TripsCatalog() {
  const { roles } = useAuth();
  const [rows, setRows] = useState<Trip[]>([]);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<Trip>(empty);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [destInput, setDestInput] = useState("");
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [tripHotels, setTripHotels] = useState<any[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const reduceMotion = useReducedMotion();
  const isManagerOnly = roles.includes("manager") && !roles.some((r) => ["super_admin", "admin"].includes(r));
  const publicFieldDisabled = isManagerOnly;
  const canCreateTrips = !isManagerOnly;
  const canDeleteTrips = !isManagerOnly;
  const canChangePublicPresentation = !isManagerOnly;
  const canReorderTrips = !isManagerOnly;

  const load = async () => {
    const { data } = await supabase
      .from("trips")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    setRows(data ?? []);
  };
  useEffect(() => {
    load();
    supabase
      .from("programmes")
      .select("id,title,duration")
      .order("sort_order")
      .then(({ data }) => setProgrammes(data ?? []));
  }, []);

  const resetDialogState = () => {
    setEdit(empty);
    setDestInput("");
    setTripHotels([]);
  };

  const openTrip = async (trip: Trip) => {
    setEdit({ ...empty, ...trip, destinations: trip.destinations ?? [] });
    setOpen(true);
    const { data, error } = await supabase
      .from("trip_hotels")
      .select("*")
      .eq("trip_id", trip.id)
      .order("sort_order", { ascending: true })
      .order("check_in", { ascending: true });
    if (error) toast.error(error.message);
    setTripHotels(data ?? []);
  };

  const addTripHotel = () => {
    setTripHotels((items) => [
      ...items,
      {
        id: `new-${Date.now()}`,
        name: "",
        city: "",
        check_in: "",
        check_out: "",
        address: "",
        phone: "",
        sort_order: items.length,
        isNew: true,
      },
    ]);
  };

  const updateTripHotel = (id: string, patch: any) => {
    setTripHotels((items) => items.map((hotel) => (hotel.id === id ? { ...hotel, ...patch } : hotel)));
  };

  const removeTripHotel = async (hotel: any) => {
    if (hotel.isNew) {
      setTripHotels((items) => items.filter((item) => item.id !== hotel.id));
      return;
    }
    if (!confirm("Supprimer cet hôtel du voyage ?")) return;
    const { error } = await supabase.from("trip_hotels").delete().eq("id", hotel.id);
    if (error) return toast.error(error.message);
    setTripHotels((items) => items.filter((item) => item.id !== hotel.id));
  };

  const saveTripHotels = async (tripId: string) => {
    for (const [index, hotel] of tripHotels.entries()) {
      const hasContent = [hotel.name, hotel.city, hotel.check_in, hotel.check_out, hotel.address, hotel.phone].some((value) =>
        String(value ?? "").trim()
      );
      if (!hasContent) continue;
      const payload = {
        trip_id: tripId,
        name: hotel.name?.trim() || "Hôtel",
        city: hotel.city?.trim() || null,
        check_in: hotel.check_in || null,
        check_out: hotel.check_out || null,
        address: hotel.address?.trim() || null,
        phone: hotel.phone?.trim() || null,
        sort_order: index,
      };
      const { error } = hotel.isNew
        ? await supabase.from("trip_hotels").insert(payload)
        : await supabase.from("trip_hotels").update(payload).eq("id", hotel.id);
      if (error) throw error;
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const visaDefaultsPayload = {
        programme_id: edit.programme_id || null,
        visa_japan_arrival_date: edit.visa_japan_arrival_date || null,
        visa_japan_departure_date: edit.visa_japan_departure_date || null,
        visa_arrival_port: edit.visa_arrival_port || null,
        visa_arrival_flight_number: edit.visa_arrival_flight_number || null,
        visa_hotel_name: edit.visa_hotel_name || null,
        visa_hotel_address: edit.visa_hotel_address || null,
        visa_hotel_phone: edit.visa_hotel_phone || null,
        outbound_flight_text: edit.outbound_flight_text || null,
        return_flight_text: edit.return_flight_text || null,
      };
      const payload: any = isManagerOnly
        ? visaDefaultsPayload
        : {
            ...edit,
            slug: edit.slug || slugify(edit.title),
            destinations: edit.destinations ?? [],
            promo_percent: edit.promo_percent === "" || edit.promo_percent == null ? null : Number(edit.promo_percent),
            ...visaDefaultsPayload,
          };
      if (edit.id) {
        const { error } = await supabase.from("trips").update(payload).eq("id", edit.id);
        if (error) throw error;
        await saveTripHotels(edit.id);
      } else if (isManagerOnly) {
        throw new Error("Les Sales Managers ne peuvent pas créer de voyage.");
      } else {
        const { data, error } = await supabase.from("trips").insert(payload).select("id").single();
        if (error) throw error;
        if (data?.id) await saveTripHotels(data.id);
      }
      toast.success(isManagerOnly ? "Valeurs visa enregistrées" : "Voyage enregistré");
      setOpen(false);
      resetDialogState();
      load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Supprimer ce voyage ?")) return;
    const { error } = await supabase.from("trips").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Supprimé");
    load();
  };

  const duplicateTrip = async (trip: Trip) => {
    const copyTitle = `${trip.title} (copie)`;
    const copyPayload = {
      ...trip,
      id: undefined,
      created_at: undefined,
      updated_at: undefined,
      created_by: undefined,
      title: copyTitle,
      slug: `${slugify(copyTitle)}-${Date.now().toString().slice(-6)}`,
      status: "draft",
      is_featured: false,
      sort_order: rows.length,
      destinations: [...(trip.destinations ?? [])],
    };

    const { error } = await supabase.from("trips").insert(copyPayload);
    if (error) return toast.error(error.message);
    toast.success("Voyage dupliqué");
    load();
  };

  const moveRow = async (id: string, dir: -1 | 1) => {
    const idx = rows.findIndex((r) => r.id === id);
    const swap = rows[idx + dir];
    if (!swap) return;
    const a = rows[idx];
    const aOrder = a.sort_order ?? idx;
    const bOrder = swap.sort_order ?? idx + dir;
    await supabase.from("trips").update({ sort_order: bOrder }).eq("id", a.id);
    await supabase.from("trips").update({ sort_order: aOrder }).eq("id", swap.id);
    load();
  };

  const toggleFeatured = async (t: Trip) => {
    await supabase.from("trips").update({ is_featured: !t.is_featured }).eq("id", t.id);
    load();
  };

  const uploadCover = async (file: File) => {
    setUploading(true);
    try {
      const { optimizeImage } = await import("@/lib/image-upload");
      const optimized = await optimizeImage(file);
      const ext = optimized.name.split(".").pop() || "webp";
      const path = `trips/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("media")
        .upload(path, optimized, { upsert: true, contentType: optimized.type });
      if (error) throw error;
      const url = supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
      setEdit({ ...edit, cover_url: url });
      toast.success("Image téléchargée");
    } catch (e: any) { toast.error(e.message); } finally { setUploading(false); }
  };

  const addDestination = () => {
    const v = destInput.trim();
    if (!v) return;
    setEdit({ ...edit, destinations: [...(edit.destinations ?? []), v] });
    setDestInput("");
  };
  const removeDestination = (i: number) => {
    const arr = [...(edit.destinations ?? [])];
    arr.splice(i, 1);
    setEdit({ ...edit, destinations: arr });
  };

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <PageHeader title="Voyages" description="Gérez vos départs, vignettes, badges et tarifs."
        action={
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetDialogState(); }}>
            {canCreateTrips && (
              <DialogTrigger asChild><Button className="min-h-11 w-full rounded-xl sm:w-auto"><Plus className="w-4 h-4" /> Nouveau voyage</Button></DialogTrigger>
            )}
            <DialogContent className="max-h-[92dvh] overflow-y-auto rounded-2xl sm:max-w-3xl">
              <DialogHeader><DialogTitle>{isManagerOnly ? "Valeurs visa du voyage" : `${edit.id ? "Modifier" : "Nouveau"} voyage`}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="col-span-2"><Label>Titre</Label><Input disabled={publicFieldDisabled} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>
                <div><Label>Slug</Label><Input disabled={publicFieldDisabled} value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} placeholder="auto" /></div>
                <div><Label>Label (ex: SAKURA)</Label><Input disabled={publicFieldDisabled} value={edit.label ?? ""} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="SAKURA, MOMIJI…" /></div>
                <div><Label>Saison</Label><Input disabled={publicFieldDisabled} value={edit.season ?? ""} onChange={(e) => setEdit({ ...edit, season: e.target.value })} placeholder="Printemps, Été…" /></div>
                <div><Label>Statut</Label>
                  <Select disabled={publicFieldDisabled} value={edit.status} onValueChange={(v) => setEdit({ ...edit, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">Brouillon</SelectItem>
                      <SelectItem value="open">Ouvert</SelectItem>
                      <SelectItem value="closed">Fermé</SelectItem>
                      <SelectItem value="completed">Terminé</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Type de badge</Label>
                  <Select disabled={publicFieldDisabled} value={edit.badge_type || "none"} onValueChange={(v) => setEdit({ ...edit, badge_type: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Aucun" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Aucun</SelectItem>
                      <SelectItem value="popular">Plus populaire</SelectItem>
                      <SelectItem value="new">Nouveau</SelectItem>
                      <SelectItem value="bestseller">Bestseller</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Texte du badge (optionnel)</Label><Input disabled={publicFieldDisabled} value={edit.badge_text ?? ""} onChange={(e) => setEdit({ ...edit, badge_text: e.target.value })} placeholder="Auto si vide" /></div>
                <div><Label>Date début</Label><Input disabled={publicFieldDisabled} type="date" value={edit.start_date ?? ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></div>
                <div><Label>Date fin</Label><Input disabled={publicFieldDisabled} type="date" value={edit.end_date ?? ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value })} /></div>
                <div><Label>Durée (jours)</Label><Input disabled={publicFieldDisabled} type="number" value={edit.duration_days ?? 14} onChange={(e) => setEdit({ ...edit, duration_days: +e.target.value })} /></div>
                <div><Label>Prix base (MAD)</Label><Input disabled={publicFieldDisabled} type="number" value={edit.base_price_mad} onChange={(e) => setEdit({ ...edit, base_price_mad: +e.target.value })} /></div>
                <div><Label>Places totales</Label><Input disabled={publicFieldDisabled} type="number" value={edit.total_slots} onChange={(e) => setEdit({ ...edit, total_slots: +e.target.value })} /></div>
                <div><Label>Places restantes</Label><Input disabled={publicFieldDisabled} type="number" value={edit.slots_left} onChange={(e) => setEdit({ ...edit, slots_left: +e.target.value })} /></div>
                <div><Label>Promotion (%)</Label><Input disabled={publicFieldDisabled} type="number" value={edit.promo_percent ?? ""} onChange={(e) => setEdit({ ...edit, promo_percent: e.target.value === "" ? null : +e.target.value })} placeholder="ex: 10" /></div>
                <div><Label>Lien programme</Label><Input disabled={publicFieldDisabled} value={edit.program_link ?? ""} onChange={(e) => setEdit({ ...edit, program_link: e.target.value })} placeholder="/programme?trip=…" /></div>
                <div className="col-span-2 rounded-xl border border-border bg-secondary/30 p-4">
                  <h3 className="mb-1 text-sm font-semibold">Valeurs visa automatiques</h3>
                  <p className="mb-4 text-xs text-muted-foreground">
                    Ces informations remplissent les champs cachés du formulaire visa et restent modifiables par l'admin avant génération des PDF.
                  </p>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Programme sélectionné</Label>
                      <Select value={edit.programme_id || "none"} onValueChange={(v) => setEdit({ ...edit, programme_id: v === "none" ? null : v })}>
                        <SelectTrigger><SelectValue placeholder="Aucun programme" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Aucun programme</SelectItem>
                          {programmes.map((p) => (
                            <SelectItem key={p.id} value={p.id}>{p.title}{p.duration ? ` · ${p.duration}` : ""}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div><Label>Aéroport / port d'arrivée</Label><Input value={edit.visa_arrival_port ?? ""} onChange={(e) => setEdit({ ...edit, visa_arrival_port: e.target.value })} placeholder="Ex. Narita, Haneda, Kansai…" /></div>
                    <div><Label>Date d'arrivée au Japon</Label><Input type="date" value={edit.visa_japan_arrival_date ?? ""} onChange={(e) => setEdit({ ...edit, visa_japan_arrival_date: e.target.value })} /></div>
                    <div><Label>Date de départ du Japon</Label><Input type="date" value={edit.visa_japan_departure_date ?? ""} onChange={(e) => setEdit({ ...edit, visa_japan_departure_date: e.target.value })} /></div>
                    <div><Label>N° vol arrivée</Label><Input value={edit.visa_arrival_flight_number ?? ""} onChange={(e) => setEdit({ ...edit, visa_arrival_flight_number: e.target.value })} placeholder="Ex. EK318" /></div>
                    <div className="sm:col-span-2">
                      <Label>Vol aller - lignes complètes réservation</Label>
                      <Textarea
                        rows={3}
                        className="font-mono text-xs"
                        value={edit.outbound_flight_text ?? ""}
                        onChange={(e) => setEdit({ ...edit, outbound_flight_text: e.target.value })}
                        placeholder={"EY 612 G 01 AVRIL 6 CMNAUH HK20 2  0915 1935   *1A/E*\nEY 878 G 01 AVRIL 6 AUHNRT HK20 A  2155 1300+1 *1A/E*"}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label>Vol retour - lignes complètes réservation</Label>
                      <Textarea
                        rows={3}
                        className="font-mono text-xs"
                        value={edit.return_flight_text ?? ""}
                        onChange={(e) => setEdit({ ...edit, return_flight_text: e.target.value })}
                        placeholder={"EY 871 G 19 AVRIL 7 NRTAUH HK20 1  1730 0005+1 *1A/E*\nEY 613 G 20 AVRIL 1 AUHCMN HK20 A  0225 0740   *1A/E*"}
                      />
                    </div>
                    <div><Label>Hôtel principal</Label><Input value={edit.visa_hotel_name ?? ""} onChange={(e) => setEdit({ ...edit, visa_hotel_name: e.target.value })} /></div>
                    <div><Label>Téléphone hôtel</Label><Input value={edit.visa_hotel_phone ?? ""} onChange={(e) => setEdit({ ...edit, visa_hotel_phone: e.target.value })} /></div>
                    <div className="sm:col-span-2"><Label>Adresse hôtel</Label><Input value={edit.visa_hotel_address ?? ""} onChange={(e) => setEdit({ ...edit, visa_hotel_address: e.target.value })} /></div>
                  </div>
                </div>

                <div className="col-span-2 rounded-xl border border-border bg-background p-4">
                  <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Hôtels du séjour</h3>
                      <p className="text-xs text-muted-foreground">Utilisés dans la confirmation de voyage et le programme jour par jour.</p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={addTripHotel}>
                      <Plus className="h-4 w-4" /> Ajouter un hôtel
                    </Button>
                  </div>
                  {tripHotels.length === 0 && (
                    <p className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                      Aucun hôtel détaillé. Le PDF utilisera l'hôtel principal comme fallback.
                    </p>
                  )}
                  <div className="space-y-3">
                    {tripHotels.map((hotel, index) => (
                      <div key={hotel.id} className="rounded-xl border border-border bg-secondary/20 p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hôtel {index + 1}</p>
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeTripHotel(hotel)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div><Label>Ville</Label><Input value={hotel.city ?? ""} onChange={(e) => updateTripHotel(hotel.id, { city: e.target.value })} placeholder="Tokyo" /></div>
                          <div><Label>Nom hôtel</Label><Input value={hotel.name ?? ""} onChange={(e) => updateTripHotel(hotel.id, { name: e.target.value })} placeholder="Shinagawa Prince Hotel" /></div>
                          <div><Label>Check-in</Label><Input type="date" value={hotel.check_in ?? ""} onChange={(e) => updateTripHotel(hotel.id, { check_in: e.target.value })} /></div>
                          <div><Label>Check-out</Label><Input type="date" value={hotel.check_out ?? ""} onChange={(e) => updateTripHotel(hotel.id, { check_out: e.target.value })} /></div>
                          <div className="sm:col-span-2"><Label>Adresse</Label><Input value={hotel.address ?? ""} onChange={(e) => updateTripHotel(hotel.id, { address: e.target.value })} /></div>
                          <div className="sm:col-span-2"><Label>Téléphone</Label><Input value={hotel.phone ?? ""} onChange={(e) => updateTripHotel(hotel.id, { phone: e.target.value })} /></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="col-span-2">
                  <Label>Image de couverture</Label>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start mt-1.5">
                      {edit.cover_url && (
                        <img src={edit.cover_url} alt="cover" className="w-32 h-40 object-cover rounded-lg border border-border" />
                      )}
                    <div className="flex-1 space-y-2">
                      <Input disabled={publicFieldDisabled} value={edit.cover_url ?? ""} onChange={(e) => setEdit({ ...edit, cover_url: e.target.value })} placeholder="URL de l'image" />
                      <Input disabled={publicFieldDisabled} value={edit.cover_alt ?? ""} onChange={(e) => setEdit({ ...edit, cover_alt: e.target.value })} placeholder="Texte alternatif (ALT) — décrit l'image pour le SEO" />
                      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadCover(f); }} />
                      <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading || publicFieldDisabled}>
                        <Upload className="w-4 h-4" /> {uploading ? "Téléchargement…" : "Téléverser une image"}
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="col-span-2">
                  <Label>Destinations (tags)</Label>
                  <div className="flex gap-2 mt-1.5">
                    <Input disabled={publicFieldDisabled} value={destInput} onChange={(e) => setDestInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addDestination(); } }} placeholder="Tokyo, Kyoto, Osaka…" />
                    <Button type="button" variant="outline" onClick={addDestination} disabled={publicFieldDisabled}>Ajouter</Button>
                  </div>
                  {edit.destinations && edit.destinations.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {edit.destinations.map((d: string, i: number) => (
                        <Badge key={i} variant="secondary" className="gap-1">
                          {d}
                          {!publicFieldDisabled && <button type="button" onClick={() => removeDestination(i)} className="hover:text-destructive"><X className="w-3 h-3" /></button>}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>

                <div className="col-span-2"><Label>Description courte</Label><Textarea disabled={publicFieldDisabled} rows={2} value={edit.short_description ?? ""} onChange={(e) => setEdit({ ...edit, short_description: e.target.value })} /></div>
                <div className="col-span-2"><Label>Description longue</Label><Textarea disabled={publicFieldDisabled} rows={5} value={edit.long_description ?? ""} onChange={(e) => setEdit({ ...edit, long_description: e.target.value })} /></div>

                <div className="col-span-2 flex items-center gap-3 pt-2 border-t border-border">
                  <Switch disabled={publicFieldDisabled} checked={!!edit.is_featured} onCheckedChange={(v) => setEdit({ ...edit, is_featured: v })} />
                  <div>
                    <Label className="cursor-pointer">Afficher sur la page d'accueil</Label>
                    <p className="text-xs text-muted-foreground">Le voyage apparaîtra dans "Nos prochains départs"</p>
                  </div>
                </div>
              </div>
              <DialogFooter><Button onClick={save} disabled={busy || !edit.title}>{busy ? "…" : isManagerOnly ? "Enregistrer les valeurs visa" : "Enregistrer"}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <div className="space-y-3 md:hidden">
        {rows.length === 0 && <p className="rounded-2xl border border-border bg-background p-6 text-center text-sm text-muted-foreground">Aucun voyage. Créez-en un.</p>}
        {rows.map((t, idx) => (
          <motion.div
            key={t.id}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: Math.min(idx, 8) * 0.025 }}
            className="overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
          >
            {t.cover_url && <img src={t.cover_url} alt={t.title} className="h-32 w-full object-cover" />}
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {t.label && <span className="text-xs font-bold uppercase tracking-wider text-accent">{t.label}</span>}
                    <StatusBadge value={t.status} />
                  </div>
                  <h3 className="truncate font-display text-lg">{t.title}</h3>
                  <p className="truncate text-xs text-muted-foreground">{t.slug}</p>
                </div>
                <Button size="icon" variant="ghost" disabled={!canChangePublicPresentation} className={t.is_featured ? "h-11 w-11 text-accent" : "h-11 w-11 text-muted-foreground"} onClick={() => toggleFeatured(t)}>
                  <Star className={`w-4 h-4 ${t.is_featured ? "fill-current" : ""}`} />
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-muted-foreground">Dates</p><p className="font-medium">{fmtDate(t.start_date)}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-muted-foreground">Places</p><p className="font-medium">{t.slots_left} / {t.total_slots}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-muted-foreground">Prix</p><p className="font-medium">{fmtMAD(t.base_price_mad)}</p></div>
                <div className="rounded-xl bg-muted/50 p-3"><p className="text-muted-foreground">Saison</p><p className="truncate font-medium">{t.season ?? "—"}</p></div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button size="sm" variant="outline" className="min-h-11" disabled={!canReorderTrips || idx === 0} onClick={() => moveRow(t.id, -1)}><ArrowUp className="w-4 h-4" /></Button>
                <Button size="sm" variant="outline" className="min-h-11" disabled={!canReorderTrips || idx === rows.length - 1} onClick={() => moveRow(t.id, 1)}><ArrowDown className="w-4 h-4" /></Button>
                <Button size="sm" className="min-h-11" onClick={() => openTrip(t)}><Pencil className="w-4 h-4" /></Button>
              </div>
              {(canCreateTrips || canDeleteTrips) && (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {canCreateTrips && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => duplicateTrip(t)}><Copy className="w-4 h-4" /> Copier</Button>}
                  {canDeleteTrips && <Button size="sm" variant="ghost" className="min-h-11 text-destructive" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4" /> Supprimer</Button>}
                </div>
              )}
            </div>
          </motion.div>
        ))}
      </div>

      <div className="hidden overflow-hidden rounded-2xl border border-border bg-background shadow-sm md:block">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-secondary/50">
            <tr className="text-left">
              <th className="p-4 font-semibold w-20">Ordre</th>
              <th className="p-4 font-semibold">Voyage</th>
              <th className="p-4 font-semibold">Label / Saison</th>
              <th className="p-4 font-semibold">Dates</th>
              <th className="p-4 font-semibold">Prix</th>
              <th className="p-4 font-semibold">Places</th>
              <th className="p-4 font-semibold">Home</th>
              <th className="p-4 font-semibold">Statut</th>
              <th className="p-4"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">Aucun voyage. Créez-en un.</td></tr>}
            {rows.map((t, idx) => (
              <tr key={t.id} className="hover:bg-secondary/30">
                <td className="p-4">
                  <div className="flex flex-col gap-0.5">
                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!canReorderTrips || idx === 0} onClick={() => moveRow(t.id, -1)}><ArrowUp className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" disabled={!canReorderTrips || idx === rows.length - 1} onClick={() => moveRow(t.id, 1)}><ArrowDown className="w-3 h-3" /></Button>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex gap-3 items-center">
                    {t.cover_url && <img src={t.cover_url} alt={t.title} className="w-12 h-12 rounded-lg object-cover" />}
                    <div>
                      <p className="font-medium">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.slug}</p>
                    </div>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex flex-col gap-0.5">
                    {t.label && <span className="text-xs font-semibold uppercase tracking-wider">{t.label}</span>}
                    <span className="text-xs text-muted-foreground">{t.season ?? "—"}</span>
                  </div>
                </td>
                <td className="p-4">{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</td>
                <td className="p-4">{fmtMAD(t.base_price_mad)}</td>
                <td className="p-4">{t.slots_left} / {t.total_slots}</td>
                <td className="p-4">
                  <Button size="icon" variant="ghost" disabled={!canChangePublicPresentation} onClick={() => toggleFeatured(t)} className={t.is_featured ? "text-accent" : "text-muted-foreground"}>
                    <Star className={`w-4 h-4 ${t.is_featured ? "fill-current" : ""}`} />
                  </Button>
                </td>
                <td className="p-4"><StatusBadge value={t.status} /></td>
                <td className="p-4 text-right whitespace-nowrap">
                  <Button size="sm" variant="ghost" onClick={() => openTrip(t)}><Pencil className="w-4 h-4" /></Button>
                  {canCreateTrips && <Button size="sm" variant="ghost" onClick={() => duplicateTrip(t)}><Copy className="w-4 h-4" /></Button>}
                  {canDeleteTrips && <Button size="sm" variant="ghost" onClick={() => remove(t.id)}><Trash2 className="w-4 h-4" /></Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
    </motion.div>
  );
}
