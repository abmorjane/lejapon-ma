import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const function_version = "lookup-visa-prefill-v1-service-role";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const normalizePassport = (value: unknown) =>
  String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");

const normalizeText = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

const passportOcr = (row: any) => asRecord(asRecord(row?.metadata).passport_ocr);

const passportCandidates = (row: any) => [
  row?.passport_number,
  row?.passport_no,
  row?.document_number,
  passportOcr(row).passport_number,
  passportOcr(row).passport_no,
  passportOcr(row).document_number,
].filter(Boolean);

const passportMatches = (row: any, expected: string) =>
  passportCandidates(row).some((candidate) => normalizePassport(candidate) === expected);

const nameMatches = (candidate: unknown, lastName: string) => {
  const needle = normalizeText(lastName);
  if (!needle) return false;
  return normalizeText(candidate).split(/\s+/).includes(needle);
};

const emailMatches = (candidate: unknown, email: string) =>
  Boolean(candidate && email && normalizeText(candidate) === normalizeText(email));

const isSafeClient = (client: any, lastName: string, email: string) =>
  nameMatches(client?.full_name, lastName) ||
  nameMatches(passportOcr(client).last_name, lastName) ||
  emailMatches(client?.email, email);

const isSafeParticipant = (participant: any, lastName: string, email: string) =>
  nameMatches(participant?.last_name, lastName) ||
  nameMatches(passportOcr(participant).last_name, lastName) ||
  emailMatches(participant?.email, email);

const isSafeVisaApplication = (application: any, lastName: string, email: string) =>
  nameMatches(application?.surname, lastName) ||
  emailMatches(application?.residential_email, email);

const normalizeSex = (value: unknown) => {
  const normalized = normalizeText(value);
  if (["m", "male", "homme", "masculin"].includes(normalized)) return "male";
  if (["f", "female", "femme", "feminin"].includes(normalized)) return "female";
  return value || null;
};

const splitFullName = (value: unknown) => {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { first_name: parts[0] ?? null, last_name: null };
  return { first_name: parts.slice(0, -1).join(" "), last_name: parts[parts.length - 1] };
};

const clientPrefill = (client: any, passportNo: string) => {
  const ocr = passportOcr(client);
  const split = splitFullName(client?.full_name);
  return {
    first_name: ocr.first_name || split.first_name || null,
    last_name: ocr.last_name || split.last_name || null,
    birthdate: client?.birthdate || client?.date_of_birth || client?.birth_date || ocr.birthdate || ocr.date_of_birth || null,
    nationality: client?.nationality || ocr.nationality || null,
    sex: normalizeSex(client?.sex || ocr.sex),
    place_of_birth: ocr.place_of_birth || null,
    birth_country: ocr.birth_country || null,
    national_id_number: ocr.national_id_number || ocr.cin || null,
    cin: ocr.cin || ocr.national_id_number || null,
    passport_no: client?.passport_number || client?.passport_no || ocr.passport_number || ocr.passport_no || passportNo,
    passport_number: client?.passport_number || ocr.passport_number || passportNo,
    passport_type: "ordinary",
    passport_issue_date: client?.passport_issue_date || ocr.passport_issue_date || null,
    passport_expiry: client?.passport_expiry || ocr.passport_expiry || ocr.passport_expiry_date || null,
    passport_expiry_date: client?.passport_expiry || ocr.passport_expiry || ocr.passport_expiry_date || null,
    passport_issue_place: ocr.passport_issue_place || ocr.passport_authority || null,
    passport_authority: ocr.passport_authority || null,
    residence_address: client?.address || ocr.residence_address || ocr.address || null,
    residence_city: client?.city || ocr.residence_city || ocr.city || null,
    residence_country: client?.country || ocr.residence_country || null,
    address: client?.address || ocr.address || ocr.residence_address || null,
    city: client?.city || ocr.city || ocr.residence_city || null,
    country: client?.country || ocr.residence_country || null,
    phone: client?.phone || null,
    email: client?.email || null,
    professional_situation: asRecord(client?.metadata).professional_situation || null,
    profession: client?.profession || asRecord(client?.metadata).profession || ocr.profession || null,
  };
};

const participantPrefill = (participant: any, linkedClient: any, passportNo: string) => {
  const base = linkedClient ? clientPrefill(linkedClient, passportNo) : {};
  const ocr = passportOcr(participant);
  return {
    ...base,
    first_name: participant?.first_name || ocr.first_name || (base as any).first_name || null,
    last_name: participant?.last_name || ocr.last_name || (base as any).last_name || null,
    birthdate: participant?.date_of_birth || participant?.birthdate || ocr.birthdate || ocr.date_of_birth || (base as any).birthdate || null,
    nationality: participant?.nationality || ocr.nationality || (base as any).nationality || null,
    sex: normalizeSex(participant?.sex || ocr.sex || (base as any).sex),
    passport_no: participant?.passport_no || participant?.passport_number || ocr.passport_no || ocr.passport_number || (base as any).passport_no || passportNo,
    passport_number: participant?.passport_no || participant?.passport_number || ocr.passport_number || passportNo,
    passport_issue_date: participant?.passport_issue_date || ocr.passport_issue_date || (base as any).passport_issue_date || null,
    passport_expiry: participant?.passport_expiry || ocr.passport_expiry || ocr.passport_expiry_date || (base as any).passport_expiry || null,
  };
};

const visaApplicationPrefill = (application: any, linkedClient: any, passportNo: string) => ({
  ...(linkedClient ? clientPrefill(linkedClient, passportNo) : {}),
  first_name: application?.given_names || null,
  last_name: application?.surname || null,
  birthdate: application?.date_of_birth || linkedClient?.birthdate || null,
  nationality: application?.nationality || linkedClient?.nationality || null,
  sex: normalizeSex(application?.sex || linkedClient?.sex),
  place_of_birth: application?.place_of_birth_city || null,
  birth_country: application?.place_of_birth_country || null,
  national_id_number: application?.national_id_no || null,
  cin: application?.national_id_no || null,
  passport_no: application?.passport_no || linkedClient?.passport_number || passportNo,
  passport_number: application?.passport_no || linkedClient?.passport_number || passportNo,
  passport_type: application?.passport_type || "ordinary",
  passport_issue_date: application?.passport_date_of_issue || linkedClient?.passport_issue_date || null,
  passport_expiry: application?.passport_date_of_expiry || linkedClient?.passport_expiry || null,
  passport_expiry_date: application?.passport_date_of_expiry || linkedClient?.passport_expiry || null,
  passport_issue_place: application?.passport_place_of_issue || application?.passport_issuing_authority || null,
  passport_authority: application?.passport_issuing_authority || null,
  residence_address: application?.residential_address || linkedClient?.address || null,
  phone: application?.residential_mobile || application?.residential_tel || linkedClient?.phone || null,
  email: application?.residential_email || linkedClient?.email || null,
  professional_situation: application?.category || null,
  profession: application?.profession || linkedClient?.profession || null,
});

const isoDateOnly = (value?: string | null) => {
  const match = String(value ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
};

const addCalendarDays = (value: string | null | undefined, offset: number) => {
  const iso = isoDateOnly(value);
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

const inclusiveDaysBetween = (start?: string | null, end?: string | null) => {
  const startIso = isoDateOnly(start);
  const endIso = isoDateOnly(end);
  if (!startIso || !endIso) return null;
  const [startYear, startMonth, startDay] = startIso.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIso.split("-").map(Number);
  const startTime = Date.UTC(startYear, startMonth - 1, startDay);
  const endTime = Date.UTC(endYear, endMonth - 1, endDay);
  if (endTime < startTime) return null;
  return Math.floor((endTime - startTime) / 86400000) + 1;
};

const visaTripDatesFromTrip = (trip: any) => {
  const arrivalDate = addCalendarDays(trip?.start_date, 1) || isoDateOnly(trip?.visa_japan_arrival_date);
  const departureDate = addCalendarDays(trip?.end_date, -1) || isoDateOnly(trip?.visa_japan_departure_date);
  const configured = Number(trip?.japan_stay_days || 0);
  return {
    arrivalDate,
    departureDate,
    japanStayDays: configured > 0 ? configured : inclusiveDaysBetween(arrivalDate, departureDate),
  };
};

const japanStayDaysFromTrip = (trip: any) => {
  return visaTripDatesFromTrip(trip).japanStayDays;
};

const tripPrefill = (trip: any) => {
  if (!trip) return {};
  const tripDates = visaTripDatesFromTrip(trip);
  return {
    trip_id: trip.id,
    trip_title: trip.title || null,
    arrival_date: tripDates.arrivalDate,
    departure_date: tripDates.departureDate,
    duration_days: tripDates.japanStayDays,
    japan_stay_days: trip.japan_stay_days || null,
    total_trip_days: trip.total_trip_days || trip.duration_days || null,
    flight_text: trip.visa_arrival_flight_number || null,
    hotel_name: trip.visa_hotel_name || null,
    hotel_phone: trip.visa_hotel_phone || null,
    hotel_address: trip.visa_hotel_address || null,
  };
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    const { data: userData, error: userError } = await admin.auth.getUser(jwt);
    if (userError || !userData.user) throw new Error("Unauthorized");

    const passportNo = normalizePassport(body.passport_no ?? body.passport_number ?? body.p_passport_no);
    const lastName = String(body.last_name ?? body.p_last_name ?? userData.user.user_metadata?.last_name ?? "").trim();
    const email = String(body.email ?? body.p_email ?? userData.user.email ?? "").trim().toLowerCase();

    if (!passportNo) {
      return new Response(JSON.stringify({ status: "not_found", function_version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!lastName && !email) {
      return new Response(JSON.stringify({ status: "needs_verification", function_version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const searchFragment = passportNo.slice(0, Math.min(3, passportNo.length));

    const { data: clientRows, error: clientsError } = await admin
      .from("clients")
      .select("id,full_name,email,phone,birthdate,nationality,sex,passport_number,passport_no,passport_issue_date,passport_expiry,address,city,country,profession,metadata")
      .or(`passport_number.ilike.%${searchFragment}%,passport_no.ilike.%${searchFragment}%,metadata->passport_ocr->>passport_number.ilike.%${searchFragment}%,metadata->passport_ocr->>passport_no.ilike.%${searchFragment}%`)
      .limit(20);

    if (clientsError) console.warn("[lookup-visa-prefill] clients query failed", { function_version, error: clientsError.message });

    let participantRows: any[] = [];
    let participantsErrorMessage: string | null = null;
    const participantSelect = "id,booking_id,client_id,trip_id,first_name,last_name,email,date_of_birth,nationality,sex,passport_no,passport_issue_date,passport_expiry,metadata";
    const participantResult = await admin
      .from("booking_participants")
      .select(participantSelect)
      .ilike("passport_no", `%${searchFragment}%`)
      .limit(20);
    if (participantResult.error) {
      participantsErrorMessage = participantResult.error.message;
      console.warn("[lookup-visa-prefill] participants query failed", { function_version, error: participantsErrorMessage });
    } else {
      participantRows = participantResult.data ?? [];
    }

    let visaApplicationRows: any[] = [];
    let visaApplicationsErrorMessage: string | null = null;
    const visaApplicationResult = await admin
      .from("visa_applications")
      .select("id,client_id,user_id,category,surname,given_names,date_of_birth,place_of_birth_city,place_of_birth_country,sex,marital_status,nationality,national_id_no,passport_type,passport_no,passport_place_of_issue,passport_date_of_issue,passport_issuing_authority,passport_date_of_expiry,residential_address,residential_tel,residential_mobile,residential_email,profession,document_trip_id,created_at")
      .ilike("passport_no", `%${searchFragment}%`)
      .limit(20);
    if (visaApplicationResult.error) {
      visaApplicationsErrorMessage = visaApplicationResult.error.message;
      console.warn("[lookup-visa-prefill] visa applications query failed", { function_version, error: visaApplicationsErrorMessage });
    } else {
      visaApplicationRows = visaApplicationResult.data ?? [];
    }

    const matchingClients = (clientRows ?? []).filter((client: any) => passportMatches(client, passportNo));
    const matchingParticipants = participantRows.filter((participant: any) => passportMatches(participant, passportNo));
    const matchingVisaApplications = visaApplicationRows.filter((application: any) => normalizePassport(application?.passport_no) === passportNo);
    const safeClients = matchingClients.filter((client: any) => isSafeClient(client, lastName, email));
    const safeParticipants = matchingParticipants.filter((participant: any) => isSafeParticipant(participant, lastName, email));
    const safeVisaApplications = matchingVisaApplications.filter((application: any) => isSafeVisaApplication(application, lastName, email));

    if (
      (matchingClients.length > 1 && safeClients.length !== 1) ||
      (matchingParticipants.length > 1 && safeParticipants.length !== 1) ||
      (matchingVisaApplications.length > 1 && safeVisaApplications.length !== 1)
    ) {
      return new Response(JSON.stringify({ status: "multiple_matches", function_version }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const participant = safeParticipants[0] ?? (matchingParticipants.length === 1 && (lastName || email) ? matchingParticipants[0] : null);
    if (participant) {
      const [{ data: linkedClient }, { data: trip }] = await Promise.all([
        participant.client_id
          ? admin
            .from("clients")
            .select("id,full_name,email,phone,birthdate,nationality,sex,passport_number,passport_no,passport_issue_date,passport_expiry,address,city,country,profession,metadata")
            .eq("id", participant.client_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
        participant.trip_id
          ? admin
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", participant.trip_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return new Response(JSON.stringify({
        status: "found",
        source: "booking_participant",
        participant_id: participant.id,
        client_id: linkedClient?.id ?? null,
        trip_id: trip?.id ?? participant.trip_id ?? null,
        booking_id: participant.booking_id ?? null,
        prefill: {
          ...participantPrefill(participant, linkedClient, passportNo),
          ...tripPrefill(trip),
        },
        function_version,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const visaApplication = safeVisaApplications[0] ?? (matchingVisaApplications.length === 1 && (lastName || email) ? matchingVisaApplications[0] : null);
    if (visaApplication) {
      const [{ data: linkedClient }, { data: trip }] = await Promise.all([
        visaApplication.client_id
          ? admin
            .from("clients")
            .select("id,full_name,email,phone,birthdate,nationality,sex,passport_number,passport_no,passport_issue_date,passport_expiry,address,city,country,profession,metadata")
            .eq("id", visaApplication.client_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
        visaApplication.document_trip_id
          ? admin
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", visaApplication.document_trip_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      return new Response(JSON.stringify({
        status: "found",
        source: "visa_application",
        client_id: linkedClient?.id ?? visaApplication.client_id ?? null,
        participant_id: null,
        visa_application_id: visaApplication.id,
        trip_id: trip?.id ?? visaApplication.document_trip_id ?? null,
        booking_id: null,
        prefill: {
          ...visaApplicationPrefill(visaApplication, linkedClient, passportNo),
          ...tripPrefill(trip),
        },
        function_version,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const client = safeClients[0] ?? (matchingClients.length === 1 && (lastName || email) ? matchingClients[0] : null);
    if (client) {
      return new Response(JSON.stringify({
        status: "found",
        source: "client",
        client_id: client.id,
        participant_id: null,
        trip_id: null,
        booking_id: null,
        prefill: clientPrefill(client, passportNo),
        function_version,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ status: "not_found", function_version }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message === "Unauthorized" ? 401 : 500;
    console.warn("[lookup-visa-prefill] failed", { function_version, error_code: message });
    return new Response(JSON.stringify({
      status: "error",
      error_code: message,
      message: "lookup_failed",
      function_version,
    }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
