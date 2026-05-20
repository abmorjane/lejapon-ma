import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type ExportScope = "selected" | "filtered" | "all" | "travelers";
type PassportFilter = "all" | "with_passport" | "expiring";
type ExportFormat = "csv" | "xlsx";

const CLIENT_SELECT = "id, full_name, email, phone, city, country, source, passport_number, passport_expiry, birthdate, nationality, sex, passport_issue_date, passport_file_path, profession, marital_status, address, last_trip_label, loyalty_tier, is_returning, trips_completed, rewards_used, created_at";

const MARITAL_STATUS_LABELS: Record<string, string> = {
  celibataire: "Célibataire",
  marie: "Marié(e)",
  divorce: "Divorcé(e)",
  veuf: "Veuf/veuve",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fmtDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("fr-FR");
}

function checkPassportExpiry(expiryDate?: string | null) {
  if (!expiryDate) return { isExpired: false, expiresWithin12Months: false };
  const expiry = new Date(`${expiryDate}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return { isExpired: false, expiresWithin12Months: false };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const threshold = new Date(today);
  threshold.setFullYear(threshold.getFullYear() + 1);
  return { isExpired: expiry < today, expiresWithin12Months: expiry >= today && expiry <= threshold };
}

function passportNeedsRenewal(expiry?: string | null) {
  const check = checkPassportExpiry(expiry);
  return check.isExpired || check.expiresWithin12Months;
}

function hasPassportData(row: any) {
  return Boolean(row?.passport_number || row?.passport_no || row?.passport_expiry || row?.passport_issue_date || row?.passport_file_path);
}

function maritalStatusLabel(value?: string | null) {
  return value ? MARITAL_STATUS_LABELS[value] ?? value : "";
}

function applyPassportFilter(items: any[], filter: PassportFilter) {
  if (filter === "with_passport") return items.filter(hasPassportData);
  if (filter === "expiring") return items.filter((item) => passportNeedsRenewal(item.passport_expiry));
  return items;
}

function scrubPassport(row: Record<string, unknown>, includePassportData: boolean) {
  if (includePassportData) return row;
  return {
    ...row,
    nationality: "",
    sex: "",
    birthdate: row.birthdate ?? "",
    passport_number: "",
    passport_issue_date: "",
    passport_expiry: "",
    passport_expires_soon: "",
    passport_to_renew: "",
    passport_file_path: "",
  };
}

async function logExport(admin: any, input: {
  userId?: string | null;
  userEmail?: string | null;
  ip?: string | null;
  exportedCount?: number;
  exportType: "CSV" | "XLSX";
  scope?: string;
  includePassportData?: boolean;
  filters?: Record<string, unknown>;
  status?: "completed" | "denied" | "failed";
  errorMessage?: string | null;
}) {
  const { data, error } = await admin
    .from("crm_export_logs")
    .insert({
      user_id: input.userId ?? null,
      user_email: input.userEmail ?? null,
      ip_address: input.ip ?? null,
      exported_count: input.exportedCount ?? 0,
      export_type: input.exportType,
      scope: input.scope ?? null,
      include_passport_data: input.includePassportData ?? false,
      filters: input.filters ?? {},
      status: input.status ?? "completed",
      error_message: input.errorMessage ?? null,
    })
    .select("id")
    .single();

  if (error) console.error("[crm-export] log insert failed", error);
  return data?.id as string | undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRole);
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || null;

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const format = (body.format === "xlsx" ? "xlsx" : "csv") as ExportFormat;
  const exportType = format.toUpperCase() as "CSV" | "XLSX";
  const scope = (body.scope || "filtered") as ExportScope;
  const passportFilter = (body.passportFilter || "all") as PassportFilter;
  const includePassportData = body.includePassportData === true;
  const filters = {
    ...(body.filters && typeof body.filters === "object" ? body.filters : {}),
    scope,
    passportFilter,
    includePassportData,
    selectedCount: Array.isArray(body.selectedIds) ? body.selectedIds.length : 0,
    filteredCount: Array.isArray(body.filteredIds) ? body.filteredIds.length : 0,
  };

  let userId: string | null = null;
  let userEmail: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) {
      await logExport(admin, { ip, exportType, scope, includePassportData, filters, status: "denied", errorMessage: "missing_auth" });
      return json({ ok: false, error: "Unauthorized" }, 403);
    }
    userId = userData.user.id;
    userEmail = userData.user.email ?? null;

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const isSuperAdmin = (roles ?? []).some((role: any) => role.role === "super_admin");
    if (!isSuperAdmin) {
      await logExport(admin, { userId, userEmail, ip, exportType, scope, includePassportData, filters, status: "denied", errorMessage: "role_not_super_admin" });
      return json({ ok: false, error: "Unauthorized" }, 403);
    }

    const exportDate = new Date().toISOString();
    const watermark = {
      exported_by: userEmail ?? userId,
      export_date: exportDate,
      watermark: "LeJapon.ma CRM",
    };

    const buildClientRows = async (clients: any[]) => {
      const filteredClients = applyPassportFilter(clients, passportFilter);
      if (!filteredClients.length) return [];
      const ids = filteredClients.map((client) => client.id).filter(Boolean);
      const [{ data: bookings, error: bookingsError }, { data: clientNotes, error: notesError }] = await Promise.all([
        admin
          .from("bookings")
          .select("id, client_id, status, total_amount_mad, paid_amount_mad, created_at, trips:trip_id(title, season, start_date)")
          .in("client_id", ids)
          .order("created_at", { ascending: false }),
        admin
          .from("client_notes")
          .select("client_id, body, created_at")
          .in("client_id", ids)
          .order("created_at", { ascending: false }),
      ]);
      if (bookingsError) throw bookingsError;
      if (notesError) throw notesError;

      const latestBookingByClient = new Map<string, any>();
      (bookings ?? []).forEach((booking: any) => {
        if (!latestBookingByClient.has(booking.client_id)) latestBookingByClient.set(booking.client_id, booking);
      });
      const notesByClient = new Map<string, string[]>();
      (clientNotes ?? []).forEach((note: any) => {
        const list = notesByClient.get(note.client_id) ?? [];
        if (list.length < 3 && note.body) list.push(note.body);
        notesByClient.set(note.client_id, list);
      });

      return filteredClients.map((client) => {
        const booking = latestBookingByClient.get(client.id);
        const trip = booking?.trips;
        const total = Number(booking?.total_amount_mad ?? 0);
        const paid = Number(booking?.paid_amount_mad ?? 0);
        const expiryCheck = checkPassportExpiry(client.passport_expiry);
        const toRenew = expiryCheck.isExpired || expiryCheck.expiresWithin12Months;
        return scrubPassport({
          full_name: client.full_name ?? "",
          email: client.email ?? "",
          phone: client.phone ?? "",
          city: client.city ?? "",
          profession: client.profession ?? "",
          marital_status: maritalStatusLabel(client.marital_status),
          address: client.address ?? "",
          nationality: client.nationality ?? "",
          sex: client.sex ?? "",
          birthdate: client.birthdate ?? "",
          passport_number: client.passport_number ?? client.passport_no ?? "",
          passport_issue_date: client.passport_issue_date ?? "",
          passport_expiry: client.passport_expiry ?? "",
          passport_expires_soon: expiryCheck.expiresWithin12Months ? "TRUE" : "FALSE",
          passport_to_renew: toRenew ? "TRUE" : "FALSE",
          passport_file_path: client.passport_file_path ?? "",
          trip: trip?.season || trip?.title || client.last_trip_label || "",
          departure_date: trip?.start_date ? fmtDate(trip.start_date) : "",
          status: booking?.status || client.loyalty_tier || "",
          trips_completed: client.trips_completed ?? 0,
          paid_amount_mad: paid || "",
          remaining_amount_mad: total ? Math.max(total - paid, 0) : "",
          notes: (notesByClient.get(client.id) ?? []).join(" | "),
          created_at: client.created_at ? fmtDate(client.created_at) : "",
          ...watermark,
        }, includePassportData);
      });
    };

    const buildTravelerRows = async () => {
      let query = admin
        .from("booking_participants")
        .select("id, booking_id, client_id, trip_id, first_name, last_name, email, phone, sex, date_of_birth, nationality, profession, marital_status, address, passport_no, passport_issue_date, passport_expiry, passport_file_path, relation, is_lead, notes, created_at")
        .order("created_at", { ascending: false })
        .limit(20000);
      const { data: participants, error } = await query;
      if (error) throw error;
      const travelerRows = applyPassportFilter(participants ?? [], passportFilter);
      if (!travelerRows.length) return [];

      const bookingIds = Array.from(new Set(travelerRows.map((p: any) => p.booking_id).filter(Boolean)));
      const tripIds = Array.from(new Set(travelerRows.map((p: any) => p.trip_id).filter(Boolean)));
      const clientIds = Array.from(new Set(travelerRows.map((p: any) => p.client_id).filter(Boolean)));

      const [{ data: bookings }, { data: trips }, { data: clients }] = await Promise.all([
        bookingIds.length ? admin.from("bookings").select("id, status, total_amount_mad, paid_amount_mad, created_at, reference").in("id", bookingIds) : Promise.resolve({ data: [] }),
        tripIds.length ? admin.from("trips").select("id, title, season, start_date").in("id", tripIds) : Promise.resolve({ data: [] }),
        clientIds.length ? admin.from("clients").select("id, full_name, city, profession, marital_status, address, trips_completed, passport_file_path").in("id", clientIds) : Promise.resolve({ data: [] }),
      ]);

      const bookingById = new Map(((bookings as any[]) ?? []).map((booking) => [booking.id, booking]));
      const tripById = new Map(((trips as any[]) ?? []).map((trip) => [trip.id, trip]));
      const clientById = new Map(((clients as any[]) ?? []).map((client) => [client.id, client]));

      return travelerRows.map((participant: any) => {
        const booking = bookingById.get(participant.booking_id);
        const trip = tripById.get(participant.trip_id);
        const client = clientById.get(participant.client_id);
        const total = Number(booking?.total_amount_mad ?? 0);
        const paid = Number(booking?.paid_amount_mad ?? 0);
        const expiryCheck = checkPassportExpiry(participant.passport_expiry);
        const toRenew = expiryCheck.isExpired || expiryCheck.expiresWithin12Months;
        return scrubPassport({
          full_name: `${participant.first_name ?? ""} ${participant.last_name ?? ""}`.trim(),
          email: participant.email ?? "",
          phone: participant.phone ?? "",
          city: client?.city ?? "",
          profession: participant.profession ?? client?.profession ?? "",
          marital_status: maritalStatusLabel(participant.marital_status ?? client?.marital_status),
          address: participant.address ?? client?.address ?? "",
          nationality: participant.nationality ?? "",
          sex: participant.sex ?? "",
          birthdate: participant.date_of_birth ?? "",
          passport_number: participant.passport_no ?? "",
          passport_issue_date: participant.passport_issue_date ?? "",
          passport_expiry: participant.passport_expiry ?? "",
          passport_expires_soon: expiryCheck.expiresWithin12Months ? "TRUE" : "FALSE",
          passport_to_renew: toRenew ? "TRUE" : "FALSE",
          passport_file_path: participant.passport_file_path ?? client?.passport_file_path ?? "",
          trip: trip?.season || trip?.title || "",
          departure_date: trip?.start_date ? fmtDate(trip.start_date) : "",
          status: booking?.status ?? "",
          trips_completed: client?.trips_completed ?? "",
          paid_amount_mad: paid || "",
          remaining_amount_mad: total ? Math.max(total - paid, 0) : "",
          notes: participant.notes ?? "",
          created_at: participant.created_at ? fmtDate(participant.created_at) : "",
          ...watermark,
        }, includePassportData);
      });
    };

    let rows: Record<string, unknown>[] = [];
    if (scope === "travelers") {
      rows = await buildTravelerRows();
    } else {
      let query = admin.from("clients").select(CLIENT_SELECT).order("created_at", { ascending: false }).limit(20000);
      const ids = scope === "selected" ? body.selectedIds : scope === "filtered" ? body.filteredIds : null;
      if (Array.isArray(ids) && ids.length > 0) query = query.in("id", ids);
      if ((scope === "selected" || scope === "filtered") && (!Array.isArray(ids) || ids.length === 0)) {
        rows = [];
      } else {
        const { data: clients, error } = await query;
        if (error) throw error;
        rows = await buildClientRows(clients ?? []);
      }
    }

    const logId = await logExport(admin, {
      userId,
      userEmail,
      ip,
      exportedCount: rows.length,
      exportType,
      scope,
      includePassportData,
      filters,
      status: "completed",
    });

    return json({ ok: true, rows, count: rows.length, log_id: logId, exported_by: watermark.exported_by, export_date: exportDate });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logExport(admin, { userId, userEmail, ip, exportType, scope, includePassportData, filters, status: "failed", errorMessage: message });
    return json({ ok: false, error: message }, 500);
  }
});
