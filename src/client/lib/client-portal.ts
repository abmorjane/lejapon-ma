import { supabase } from "@/integrations/supabase/client";

export type ClientBooking = {
  id: string;
  reference: string;
  trip_id: string | null;
  client_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  num_adults: number | null;
  num_children: number | null;
  formula: string | null;
  room_type: string | null;
  preferred_dates: string | null;
  total_amount_mad: number | null;
  paid_amount_mad: number | null;
  status: string | null;
  created_at: string | null;
  is_booking_owner?: boolean;
  trips?: ClientTrip | null;
};

export type ClientTrip = {
  id: string;
  title: string | null;
  season: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
  duration_days: number | null;
  total_trip_days?: number | null;
  japan_stay_days?: number | null;
  outbound_flight_text?: string | null;
  return_flight_text?: string | null;
  visa_arrival_flight_number?: string | null;
};

export type ClientParticipant = {
  id: string;
  booking_id: string;
  first_name: string | null;
  last_name: string | null;
  client_type: string | null;
  email?: string | null;
  room_type?: string | null;
  notes?: string | null;
};

export type ClientBookingExtra = {
  id: string;
  booking_id: string;
  extra_id: string | null;
  name_snapshot: string;
  qty: number;
  unit_price_mad: number;
  created_at?: string | null;
};

export type ClientBookingDocument = {
  id: string;
  booking_id: string;
  kind: string;
  document_type?: string | null;
  title?: string | null;
  file_name?: string | null;
  number?: string | null;
  storage_path: string;
  created_at: string;
  visible_to_client?: boolean | null;
  client_visible_at?: string | null;
  visibility_scope?: "booking_participants" | "booking_owner_only" | null;
};

export type ClientAgreement = {
  id: string;
  booking_id: string | null;
  status: string;
  secure_token: string | null;
  client_name: string | null;
  client_email: string | null;
  booking_reference: string | null;
  trip_title: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  content?: Record<string, any> | null;
};

export type ClientVisaApplication = {
  id: string;
  reference: string;
  status: string;
  document_trip_id?: string | null;
  booking_id?: string | null;
  created_at: string | null;
  submitted_at: string | null;
};

export const normalizeEmail = (email?: string | null) => (email ?? "").trim().toLowerCase();

function mapBookingRow(row: any): ClientBooking {
  return {
    id: row.id,
    reference: row.reference,
    trip_id: row.trip_id,
    client_id: null,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    num_adults: row.num_adults,
    num_children: row.num_children,
    formula: row.formula,
    room_type: row.room_type,
    preferred_dates: row.preferred_dates,
    total_amount_mad: row.total_amount_mad,
    paid_amount_mad: row.paid_amount_mad,
    status: row.status,
    created_at: row.created_at,
    is_booking_owner: row.is_booking_owner === true,
    trips: row.trip_id ? {
      id: row.trip_id,
      title: row.trip_title,
      season: row.trip_season,
      destination: row.trip_destination,
      start_date: row.trip_start_date,
      end_date: row.trip_end_date,
      duration_days: row.trip_duration_days,
      total_trip_days: row.trip_total_trip_days,
      japan_stay_days: row.trip_japan_stay_days,
      outbound_flight_text: row.outbound_flight_text,
      return_flight_text: row.return_flight_text,
      visa_arrival_flight_number: row.visa_arrival_flight_number,
    } : null,
  };
}

export async function loadClientBookings() {
  const { data, error } = await (supabase as any).rpc("client_portal_booking_rows");
  if (error) throw error;
  return ((data ?? []) as any[])
    .map(mapBookingRow)
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
}

export async function loadClientBooking(bookingId: string) {
  const bookings = await loadClientBookings();
  return bookings.find((booking) => booking.id === bookingId) ?? null;
}

export async function loadBookingParticipants(bookingId: string) {
  const { data, error } = await (supabase as any)
    .from("booking_participants")
    .select("id,booking_id,first_name,last_name,client_type,email,room_type,notes")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientParticipant[];
}

export async function loadBookingExtras(bookingId: string) {
  const { data, error } = await supabase
    .from("booking_extras")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as ClientBookingExtra[];
}

export async function loadClientDocuments(bookingIds: string[]) {
  if (!bookingIds.length) return [];
  const { data, error } = await (supabase as any)
    .from("booking_documents")
    .select("id,booking_id,kind,document_type,title,file_name,number,storage_path,created_at,visible_to_client,client_visible_at,visibility_scope")
    .in("booking_id", bookingIds)
    .eq("visible_to_client", true)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientBookingDocument[];
}

export async function signedBookingDocumentUrl(storagePath: string) {
  const { data, error } = await supabase.storage.from("booking-docs").createSignedUrl(storagePath, 120);
  if (error || !data?.signedUrl) throw error ?? new Error("Lien document indisponible.");
  return data.signedUrl;
}

export async function loadClientAgreements(bookingIds: string[]) {
  if (!bookingIds.length) return [];
  const { data, error } = await (supabase as any)
    .from("travel_agreements")
    .select("id,booking_id,status,secure_token,client_name,client_email,booking_reference,trip_title,sent_at,accepted_at,content")
    .in("booking_id", bookingIds)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientAgreement[];
}

export async function loadClientVisaApplications() {
  const { data, error } = await (supabase as any)
    .from("visa_applications")
    .select("id,reference,status,document_trip_id,booking_id,created_at,submitted_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientVisaApplication[];
}

export async function loadTripHotels(tripId: string | null | undefined) {
  if (!tripId) return [];
  const { data, error } = await (supabase as any)
    .from("trip_hotels")
    .select("id,trip_id,name,city,address,check_in,check_out,sort_order")
    .eq("trip_id", tripId)
    .order("check_in", { ascending: true, nullsFirst: false })
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addClientBookingExtra(input: { bookingId: string; extraId: string; quantity: number }) {
  const { data, error } = await (supabase as any).rpc("client_portal_add_booking_extra", {
    p_booking_id: input.bookingId,
    p_extra_id: input.extraId,
    p_qty: input.quantity,
  });
  if (error) throw error;
  return data;
}

export const bookingPax = (booking: Pick<ClientBooking, "num_adults" | "num_children"> | null | undefined) =>
  Number(booking?.num_adults || 0) + Number(booking?.num_children || 0);

export const bookingRemaining = (booking: Pick<ClientBooking, "total_amount_mad" | "paid_amount_mad"> | null | undefined) =>
  Math.max(0, Number(booking?.total_amount_mad || 0) - Number(booking?.paid_amount_mad || 0));
