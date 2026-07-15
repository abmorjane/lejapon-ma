import { supabase } from "@/integrations/supabase/client";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export type TripDateContext = {
  id: string;
  start_date?: string | null;
};

export type AccommodationTemplate = {
  id: string;
  name: string;
  description?: string | null;
  duration_days?: number | null;
  is_active?: boolean | null;
};

export type AccommodationTemplateRow = {
  id: string;
  template_id: string;
  hotel_catalog_id?: string | null;
  hotel_name: string;
  city?: string | null;
  arrival_day: number;
  departure_day: number;
  address?: string | null;
  phone?: string | null;
  notes?: string | null;
  sort_order?: number | null;
};

export const parseDateOnly = (value?: string | null) => {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
};

export const formatDateOnly = (time: number) => new Date(time).toISOString().slice(0, 10);

export const daysBetween = (from?: string | null, to?: string | null) => {
  const fromTime = parseDateOnly(from);
  const toTime = parseDateOnly(to);
  if (fromTime == null || toTime == null) return null;
  return Math.round((toTime - fromTime) / 86400000);
};

export const addDays = (date?: string | null, offset = 0) => {
  const time = parseDateOnly(date);
  if (time == null) return null;
  return formatDateOnly(time + offset * 86400000);
};

export const nightsBetween = (checkIn?: string | null, checkOut?: string | null) => {
  const nights = daysBetween(checkIn, checkOut);
  return nights != null ? Math.max(0, nights) : null;
};

export const dateFromTripDay = (tripStartDate?: string | null, dayNumber?: number | null) => {
  const day = Number(dayNumber ?? 0);
  if (!tripStartDate || !Number.isFinite(day) || day <= 0) return null;
  return addDays(tripStartDate, day - 1);
};

const shiftedDate = (sourceDate: string | null | undefined, sourceTrip: TripDateContext, targetTrip: TripDateContext) => {
  const offset = daysBetween(sourceTrip.start_date, sourceDate);
  if (offset == null || !targetTrip.start_date) return sourceDate ?? null;
  return addDays(targetTrip.start_date, offset);
};

export async function duplicateTripHotels(sourceTrip: TripDateContext, targetTrip: TripDateContext) {
  const { data: sourceHotels, error: hotelsError } = await db
    .from("trip_hotels")
    .select("*")
    .eq("trip_id", sourceTrip.id)
    .order("sort_order", { ascending: true })
    .order("check_in", { ascending: true });

  if (hotelsError) throw hotelsError;
  const hotels = sourceHotels ?? [];
  if (hotels.length === 0) return { hotelCount: 0, roomCount: 0 };

  const hotelIdMap = new Map<string, string>();
  for (const [index, hotel] of hotels.entries()) {
    const payload = {
      trip_id: targetTrip.id,
      name: hotel.name,
      city: hotel.city ?? null,
      address: hotel.address ?? null,
      phone: hotel.phone ?? null,
      sort_order: hotel.sort_order ?? index,
      check_in: shiftedDate(hotel.check_in, sourceTrip, targetTrip),
      check_out: shiftedDate(hotel.check_out, sourceTrip, targetTrip),
    };

    const { data: insertedHotel, error } = await db
      .from("trip_hotels")
      .insert(payload)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (insertedHotel?.id) hotelIdMap.set(hotel.id, insertedHotel.id);
  }

  const sourceHotelIds = hotels.map((hotel: any) => hotel.id).filter(Boolean);
  if (sourceHotelIds.length === 0 || hotelIdMap.size === 0) return { hotelCount: hotelIdMap.size, roomCount: 0 };

  const { data: sourceRooms, error: roomsError } = await db
    .from("trip_rooms")
    .select("*")
    .in("trip_hotel_id", sourceHotelIds);
  if (roomsError) throw roomsError;

  const roomPayloads = (sourceRooms ?? [])
    .map((room: any) => {
      const targetHotelId = hotelIdMap.get(room.trip_hotel_id);
      if (!targetHotelId) return null;
      return {
        trip_hotel_id: targetHotelId,
        room_number: room.room_number ?? null,
        room_type: room.room_type ?? "Twin",
        capacity: Number(room.capacity ?? 2) || 2,
        client_type: room.client_type ?? null,
        notes: room.notes ?? null,
      };
    })
    .filter(Boolean);

  if (roomPayloads.length > 0) {
    const { error } = await db.from("trip_rooms").insert(roomPayloads);
    if (error) throw error;
  }

  return { hotelCount: hotelIdMap.size, roomCount: roomPayloads.length };
}

export async function loadAccommodationTemplates() {
  const { data, error } = await db
    .from("accommodation_templates")
    .select("*")
    .eq("is_active", true)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccommodationTemplate[];
}

export async function loadAccommodationTemplateRows(templateId: string) {
  const { data, error } = await db
    .from("accommodation_template_rows")
    .select("*")
    .eq("template_id", templateId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data ?? []) as AccommodationTemplateRow[];
}

export async function applyAccommodationTemplateToTrip(params: {
  tripId: string;
  tripStartDate?: string | null;
  templateId: string;
  mode: "replace" | "append";
}) {
  const rows = await loadAccommodationTemplateRows(params.templateId);
  if (rows.length === 0) return { hotelCount: 0 };

  if (params.mode === "replace") {
    const { error } = await db.from("trip_hotels").delete().eq("trip_id", params.tripId);
    if (error) throw error;
  }

  let baseOrder = 0;
  if (params.mode === "append") {
    const { data: existing, error } = await db
      .from("trip_hotels")
      .select("sort_order")
      .eq("trip_id", params.tripId)
      .order("sort_order", { ascending: false })
      .limit(1);
    if (error) throw error;
    baseOrder = Number(existing?.[0]?.sort_order ?? -1) + 1;
  }

  const payloads = rows.map((row, index) => ({
    trip_id: params.tripId,
    name: row.hotel_name,
    city: row.city ?? null,
    address: row.address ?? null,
    phone: row.phone ?? null,
    check_in: dateFromTripDay(params.tripStartDate, row.arrival_day),
    check_out: dateFromTripDay(params.tripStartDate, row.departure_day),
    sort_order: baseOrder + index,
  }));

  const { error } = await db.from("trip_hotels").insert(payloads);
  if (error) throw error;
  return { hotelCount: payloads.length };
}
