import { supabase } from "@/integrations/supabase/client";
import {
  crmSituationToVisaSituation,
  mapProfessionTextToCrmSituation,
} from "@/lib/visa-document-checklists";
import { visaTripDatesFromTrip } from "@/lib/visa-trip-dates";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export type VisaPrefillResult =
  | { status: "none"; message: string }
  | { status: "multiple"; message: string }
  | { status: "error"; message: string }
  | { status: "matched"; source: "booking_participant" | "client"; sourceId: string; patch: Record<string, unknown>; sourceLabel: string };

export const normalizePassportNo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");

const passportMatches = (candidate: unknown, expected: string) =>
  Boolean(expected && normalizePassportNo(candidate) === expected);

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const nameMatchesLastName = (fullOrLastName: unknown, lastName: string) => {
  const haystack = normalize(fullOrLastName);
  const needle = normalize(lastName);
  return Boolean(needle && haystack.split(/\s+/).includes(needle));
};

const emailMatches = (candidateEmail: unknown, email: string) =>
  Boolean(candidateEmail && email && normalize(candidateEmail) === normalize(email));

const isSafeParticipantMatch = (participant: any, lastName: string, email: string) =>
  nameMatchesLastName(participant.last_name, lastName) || emailMatches(participant.email, email);

const isSafeClientMatch = (client: any, lastName: string, email: string) =>
  nameMatchesLastName(client.full_name, lastName) || emailMatches(client.email, email);

const isSafeVisaApplicationMatch = (application: any, lastName: string, email: string) =>
  nameMatchesLastName(application.surname, lastName) ||
  nameMatchesLastName(application.last_name, lastName) ||
  emailMatches(application.residential_email, email);

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

const clientPassportOcr = (client: any) => asRecord(asRecord(client?.metadata).passport_ocr);
const passportOcrCandidates = (value: Record<string, any>) => [
  value.passport_number,
  value.passport_no,
  value.document_number,
  value.numero_passeport,
];

const clientPassportCandidates = (client: any) => [
  client?.passport_number,
  client?.passport_no,
  ...passportOcrCandidates(clientPassportOcr(client)),
];

const visaApplicationPassportCandidates = (application: any) => [
  application?.passport_no,
  application?.passport_number,
];

const clientProfessionalSituation = (client: any) => {
  const metadata = asRecord(client?.metadata);
  return crmSituationToVisaSituation(metadata.professional_situation || mapProfessionTextToCrmSituation(client?.profession || metadata.profession || metadata.ocr_profession_source));
};

const residenceText = (client: any, ocr: Record<string, any>) =>
  [client?.address || ocr.residence_address, client?.city || ocr.residence_city, client?.country || ocr.residence_country]
    .filter(Boolean)
    .join(", ") || null;

const normalizeVisaSex = (value: unknown) => {
  const normalized = normalize(value);
  if (["m", "male", "homme", "masculin"].includes(normalized)) return "male";
  if (["f", "female", "femme", "feminin"].includes(normalized)) return "female";
  return value || null;
};

const splitFullName = (value: unknown) => {
  const parts = String(value ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { givenNames: null, surname: null };
  if (parts.length === 1) return { givenNames: parts[0], surname: null };
  return { givenNames: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] };
};

const tripJapanStayDays = (trip: any) => {
  return visaTripDatesFromTrip(trip).japanStayDays;
};

const fieldScore = (patch: Record<string, unknown>) =>
  Object.values(patch).filter((value) => value !== undefined && value !== null && value !== "").length;

const bestClientMatch = (clients: any[]) => {
  if (!clients.length) return null;
  return [...clients].sort((a, b) => {
    const scoreA = fieldScore({
      ...a,
      ...clientPassportOcr(a),
      residential_address: residenceText(a, clientPassportOcr(a)),
    });
    const scoreB = fieldScore({
      ...b,
      ...clientPassportOcr(b),
      residential_address: residenceText(b, clientPassportOcr(b)),
    });
    return scoreB - scoreA;
  })[0];
};

const clientIdentityPatch = (client: any, fallbackLastName: string, fallbackPassportNo: string) => {
  const ocr = clientPassportOcr(client);
  const split = splitFullName(client?.full_name);
  return {
    surname: ocr.last_name || fallbackLastName || split.surname || null,
    given_names: ocr.first_name || split.givenNames || null,
    date_of_birth: client?.date_of_birth || client?.birthdate || client?.birth_date || ocr.birthdate || null,
    nationality: client?.nationality || ocr.nationality || null,
    sex: normalizeVisaSex(client?.sex || ocr.sex),
    place_of_birth_city: ocr.place_of_birth || null,
    place_of_birth_country: ocr.birth_country || null,
    national_id_no: ocr.national_id_number || ocr.cin || null,
    passport_no: client?.passport_number || client?.passport_no || ocr.passport_number || ocr.passport_no || fallbackPassportNo,
    passport_type: "ordinary",
    passport_date_of_issue: client?.passport_issue_date || ocr.passport_issue_date || null,
    passport_date_of_expiry: client?.passport_expiry || ocr.passport_expiry_date || null,
    passport_place_of_issue: ocr.passport_issue_place || ocr.passport_authority || null,
    passport_issuing_authority: ocr.passport_authority || null,
    residential_address: residenceText(client, ocr),
    residential_mobile: client?.phone || null,
    residential_email: client?.email || null,
    category: clientProfessionalSituation(client) || null,
    profession: client?.profession || asRecord(client?.metadata).profession || asRecord(client?.metadata).ocr_profession_source || null,
  };
};

const visaApplicationPatch = (application: any, linkedClient: any, fallbackPassportNo: string) => ({
  ...(linkedClient ? clientIdentityPatch(linkedClient, application?.surname ?? "", fallbackPassportNo) : {}),
  surname: application?.surname || null,
  given_names: application?.given_names || null,
  date_of_birth: application?.date_of_birth || linkedClient?.birthdate || null,
  place_of_birth_city: application?.place_of_birth_city || null,
  place_of_birth_state: application?.place_of_birth_state || null,
  place_of_birth_country: application?.place_of_birth_country || null,
  sex: normalizeVisaSex(application?.sex || linkedClient?.sex),
  marital_status: application?.marital_status || linkedClient?.marital_status || null,
  nationality: application?.nationality || linkedClient?.nationality || null,
  former_nationality: application?.former_nationality || null,
  national_id_no: application?.national_id_no || null,
  passport_no: application?.passport_no || linkedClient?.passport_number || fallbackPassportNo,
  passport_type: application?.passport_type || "ordinary",
  passport_date_of_issue: application?.passport_date_of_issue || linkedClient?.passport_issue_date || null,
  passport_date_of_expiry: application?.passport_date_of_expiry || linkedClient?.passport_expiry || null,
  passport_place_of_issue: application?.passport_place_of_issue || null,
  passport_issuing_authority: application?.passport_issuing_authority || null,
  residential_address: application?.residential_address || linkedClient?.address || null,
  residential_tel: application?.residential_tel || null,
  residential_mobile: application?.residential_mobile || linkedClient?.phone || null,
  residential_email: application?.residential_email || linkedClient?.email || null,
  category: application?.category || clientProfessionalSituation(linkedClient) || null,
  profession: application?.profession || linkedClient?.profession || null,
  employer_name: application?.employer_name || null,
  employer_tel: application?.employer_tel || null,
  employer_address: application?.employer_address || null,
  document_trip_id: application?.document_trip_id || null,
  purpose_of_visit: application?.purpose_of_visit || "Tourisme",
  intended_length_of_stay: application?.intended_length_of_stay || null,
  date_of_arrival: application?.date_of_arrival || null,
  port_of_entry: application?.port_of_entry || null,
  airline_or_ship: application?.airline_or_ship || null,
  hotel_name: application?.hotel_name || null,
  hotel_tel: application?.hotel_tel || null,
  hotel_address: application?.hotel_address || null,
});

const rpcPrefillPatch = (prefill: Record<string, any>, fallbackPassportNo: string) => ({
  surname: prefill.last_name || prefill.surname || null,
  given_names: prefill.first_name || prefill.given_names || prefill.given_name || null,
  date_of_birth: prefill.birthdate || prefill.date_of_birth || null,
  nationality: prefill.nationality || null,
  sex: normalizeVisaSex(prefill.sex),
  place_of_birth_city: prefill.place_of_birth || prefill.birth_city || null,
  place_of_birth_country: prefill.birth_country || null,
  national_id_no: prefill.national_id_number || prefill.cin || null,
  passport_no: prefill.passport_no || prefill.passport_number || fallbackPassportNo,
  passport_type: prefill.passport_type || "ordinary",
  passport_date_of_issue: prefill.passport_issue_date || null,
  passport_date_of_expiry: prefill.passport_expiry || prefill.passport_expiry_date || null,
  passport_place_of_issue: prefill.passport_issue_place || prefill.passport_authority || null,
  passport_issuing_authority: prefill.passport_authority || null,
  residential_address: [prefill.residence_address || prefill.address, prefill.residence_city || prefill.city, prefill.residence_country || prefill.country]
    .filter(Boolean)
    .join(", ") || null,
  residential_mobile: prefill.phone || null,
  residential_email: prefill.email || null,
  category: crmSituationToVisaSituation(String(prefill.professional_situation ?? "")) || null,
  profession: prefill.profession || null,
  document_trip_id: prefill.trip_id || null,
  date_of_arrival: prefill.arrival_date || null,
  intended_length_of_stay: prefill.japan_stay_days || prefill.duration_days ? `${prefill.japan_stay_days || prefill.duration_days} jours` : null,
  hotel_name: prefill.hotel_name || prefill.hotel?.name || null,
  hotel_tel: prefill.hotel_phone || prefill.hotel?.phone || null,
  hotel_address: prefill.hotel_address || prefill.hotel?.address || null,
  airline_or_ship: prefill.flight_text || null,
});

const tryRpcPrefill = async (passportNo: string, lastName: string, email: string): Promise<VisaPrefillResult | null> => {
  try {
    const { data, error } = await (supabase as any).rpc("lookup_visa_prefill_by_passport", {
      p_passport_no: passportNo,
      p_last_name: lastName || null,
      p_email: email || null,
    });
    if (error) return null;
    if (data?.status === "multiple_matches") {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }
    if (data?.status === "not_found") return null;
    if (data?.status === "found" && data.prefill) {
      return {
        status: "matched",
        source: data.participant_id ? "booking_participant" : "client",
        sourceId: data.participant_id || data.client_id || "rpc",
        sourceLabel: data.source || "Dossier passeport",
        patch: rpcPrefillPatch(asRecord(data.prefill), passportNo),
      };
    }
    return null;
  } catch {
    return null;
  }
};

const tryEdgePrefill = async (passportNo: string, lastName: string, email: string): Promise<VisaPrefillResult | null> => {
  try {
    const payload = {
      passport_no: passportNo,
      last_name: lastName || null,
      email: email || null,
    };
    const { data, error } = await supabase.functions.invoke("lookup-visa-prefill", {
      body: payload,
    });
    if (error) return null;
    if (data?.status === "multiple_matches") {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }
    if (data?.status === "needs_verification") {
      return { status: "none", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
    }
    if (data?.status === "not_found") return null;
    if (data?.status === "found" && data.prefill) {
      return {
        status: "matched",
        source: data.participant_id ? "booking_participant" : "client",
        sourceId: data.participant_id || data.client_id || "lookup-visa-prefill",
        sourceLabel: data.source || "Dossier passeport",
        patch: rpcPrefillPatch(asRecord(data.prefill), passportNo),
      };
    }
    return null;
  } catch {
    return null;
  }
};

const participantIdentityPatch = (participant: any, linkedClient: any, fallbackLastName: string, fallbackPassportNo: string) => {
  const clientPatch = linkedClient ? clientIdentityPatch(linkedClient, fallbackLastName, fallbackPassportNo) : {};
  const ocr = clientPassportOcr(linkedClient);
  return {
    ...clientPatch,
    booking_id: participant.booking_id || null,
    surname: participant.last_name || (clientPatch as any).surname || fallbackLastName,
    given_names: participant.first_name || (clientPatch as any).given_names || null,
    date_of_birth: participant.date_of_birth || (clientPatch as any).date_of_birth || ocr.birthdate || null,
    nationality: participant.nationality || (clientPatch as any).nationality || ocr.nationality || null,
    sex: normalizeVisaSex(participant.sex || (clientPatch as any).sex || ocr.sex),
    passport_no: participant.passport_no || (clientPatch as any).passport_no || fallbackPassportNo,
    passport_date_of_issue: participant.passport_issue_date || (clientPatch as any).passport_date_of_issue || null,
    passport_date_of_expiry: participant.passport_expiry || (clientPatch as any).passport_date_of_expiry || null,
  };
};

const tripPatch = (trip: any | null) => {
  if (!trip) return {};
  const tripDates = visaTripDatesFromTrip(trip);
  const durationDays = Number(tripDates.japanStayDays || 0);
  return {
    document_trip_id: trip.id,
    intended_length_of_stay: durationDays > 0 ? `${durationDays} jours` : null,
    date_of_arrival: tripDates.japanArrivalDate || null,
    port_of_entry: trip.visa_arrival_port || null,
    airline_or_ship: trip.visa_arrival_flight_number || null,
    hotel_name: trip.visa_hotel_name || null,
    hotel_tel: trip.visa_hotel_phone || null,
    hotel_address: trip.visa_hotel_address || null,
  };
};

export async function lookupVisaPrefillByPassport(params: {
  passportNo: string;
  lastName: string;
  email: string;
}): Promise<VisaPrefillResult> {
  const passportNo = normalizePassportNo(params.passportNo);
  if (!passportNo) {
    return { status: "none", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
  }

  const lastName = params.lastName.trim();
  const email = params.email.trim().toLowerCase();
  const searchFragment = passportNo.slice(0, Math.min(2, passportNo.length));

  try {
    const edgeResult = await tryEdgePrefill(passportNo, lastName, email);
    if (edgeResult?.status === "matched" || edgeResult?.status === "multiple") return edgeResult;

    const rpcResult = await tryRpcPrefill(passportNo, lastName, email);
    if (rpcResult?.status === "matched" || rpcResult?.status === "multiple") return rpcResult;

    const [{ data: participants, error: participantError }, { data: directClients, error: directClientError }, { data: metadataClients, error: metadataClientError }, { data: visaApplications, error: visaApplicationError }] = await Promise.all([
      db
        .from("booking_participants")
        .select("id,booking_id,client_id,trip_id,first_name,last_name,email,date_of_birth,nationality,sex,passport_no,passport_issue_date,passport_expiry")
        .ilike("passport_no", `%${searchFragment}%`)
        .limit(50),
      db
        .from("clients")
        .select("id,full_name,email,phone,date_of_birth,birthdate,birth_date,nationality,sex,passport_no,passport_number,passport_issue_date,passport_expiry,address,city,country,profession,metadata,last_trip_id")
        .or(`passport_number.ilike.%${searchFragment}%,passport_no.ilike.%${searchFragment}%`)
        .limit(50),
      db
        .from("clients")
        .select("id,full_name,email,phone,date_of_birth,birthdate,birth_date,nationality,sex,passport_no,passport_number,passport_issue_date,passport_expiry,address,city,country,profession,metadata,last_trip_id")
        .or(`metadata->passport_ocr->>passport_number.ilike.%${searchFragment}%,metadata->passport_ocr->>passport_no.ilike.%${searchFragment}%`)
        .limit(50),
      db
        .from("visa_applications")
        .select("id,client_id,user_id,category,surname,given_names,date_of_birth,place_of_birth_city,place_of_birth_state,place_of_birth_country,sex,marital_status,nationality,former_nationality,national_id_no,passport_type,passport_no,passport_place_of_issue,passport_date_of_issue,passport_issuing_authority,passport_date_of_expiry,residential_address,residential_tel,residential_mobile,residential_email,profession,employer_name,employer_tel,employer_address,document_trip_id,purpose_of_visit,intended_length_of_stay,date_of_arrival,port_of_entry,airline_or_ship,hotel_name,hotel_tel,hotel_address,created_at")
        .ilike("passport_no", `%${searchFragment}%`)
        .limit(50),
    ]);
    const clientsById = new Map<string, any>();
    for (const client of [...(directClients ?? []), ...(metadataClients ?? [])]) {
      if (client?.id) clientsById.set(client.id, client);
    }
    const clients = Array.from(clientsById.values());

    if (participantError && directClientError && metadataClientError && visaApplicationError) {
      return { status: "error", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
    }

    const matchingParticipants = (participants ?? []).filter((participant: any) => passportMatches(participant.passport_no, passportNo));
    const matchingClients = (clients ?? []).filter((client: any) =>
      clientPassportCandidates(client).some((candidate) => passportMatches(candidate, passportNo))
    );
    const matchingVisaApplications = (visaApplications ?? []).filter((application: any) =>
      visaApplicationPassportCandidates(application).some((candidate) => passportMatches(candidate, passportNo))
    );
    const safeParticipants = matchingParticipants.filter((participant: any) => isSafeParticipantMatch(participant, lastName, email));
    const safeClients = matchingClients.filter((client: any) => isSafeClientMatch(client, lastName, email));
    const safeVisaApplications = matchingVisaApplications.filter((application: any) => isSafeVisaApplicationMatch(application, lastName, email));
    const effectiveParticipants = safeParticipants.length ? safeParticipants : matchingParticipants.length === 1 ? matchingParticipants : [];
    const effectiveClients = safeClients.length ? safeClients : matchingClients.length === 1 ? matchingClients : [];
    const effectiveVisaApplications = safeVisaApplications.length ? safeVisaApplications : matchingVisaApplications.length === 1 ? matchingVisaApplications : [];

    if (
      (matchingParticipants.length > 1 && !safeParticipants.length) ||
      (matchingClients.length > 1 && !safeClients.length) ||
      (matchingVisaApplications.length > 1 && !safeVisaApplications.length)
    ) {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }

    if (effectiveParticipants.length === 1) {
      const participant = effectiveParticipants[0];
      const tripId = participant.trip_id;
      const bestClient = bestClientMatch([
        ...safeClients,
        ...(participant.client_id ? [] : []),
      ]);
      const [{ data: trip }, { data: linkedClient }] = await Promise.all([
        tripId
          ? db
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", tripId)
            .maybeSingle()
          : Promise.resolve({ data: null }),
        participant.client_id
          ? db
            .from("clients")
            .select("id,full_name,email,phone,date_of_birth,birthdate,birth_date,nationality,sex,passport_no,passport_number,passport_issue_date,passport_expiry,address,city,country,profession,metadata,last_trip_id")
            .eq("id", participant.client_id)
            .maybeSingle()
          : Promise.resolve({ data: bestClient }),
      ]);
      const enrichedClient = linkedClient || bestClient;

      return {
        status: "matched",
        source: "booking_participant",
        sourceId: participant.id,
        sourceLabel: `Voyageur lié à une réservation${trip?.title ? ` · ${trip.title}` : ""}`,
        patch: {
          ...participantIdentityPatch(participant, enrichedClient, lastName, passportNo),
          ...tripPatch(trip),
        },
      };
    }

    if (effectiveVisaApplications.length === 1) {
      const visaApplication = effectiveVisaApplications[0];
      const [{ data: linkedClient }, { data: trip }] = await Promise.all([
        visaApplication.client_id
          ? db
            .from("clients")
            .select("id,full_name,email,phone,date_of_birth,birthdate,birth_date,nationality,sex,passport_no,passport_number,passport_issue_date,passport_expiry,address,city,country,profession,marital_status,metadata,last_trip_id")
            .eq("id", visaApplication.client_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
        visaApplication.document_trip_id
          ? db
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", visaApplication.document_trip_id)
            .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      return {
        status: "matched",
        source: "client",
        sourceId: linkedClient?.id || visaApplication.id,
        sourceLabel: `Ancienne demande visa${trip?.title ? ` · ${trip.title}` : ""}`,
        patch: {
          ...visaApplicationPatch(visaApplication, linkedClient, passportNo),
          ...tripPatch(trip),
        },
      };
    }

    if (directClientError && metadataClientError) {
      return { status: "none", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
    }

    const distinctClientNames = Array.from(new Set(effectiveClients.map((client: any) => normalize(client.full_name)).filter(Boolean)));
    const distinctClientEmails = Array.from(new Set(effectiveClients.map((client: any) => normalize(client.email)).filter(Boolean)));
    if (effectiveClients.length > 1 && (distinctClientNames.length > 1 || distinctClientEmails.length > 1)) {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }

    const client = bestClientMatch(effectiveClients);
    if (client) {
      const tripId = client.last_trip_id;
      const { data: trip } = tripId
        ? await db
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,total_trip_days,japan_stay_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", tripId)
            .maybeSingle()
        : { data: null };

      return {
        status: "matched",
        source: "client",
        sourceId: client.id,
        sourceLabel: `Fiche client${trip?.title ? ` · ${trip.title}` : ""}`,
        patch: {
          ...clientIdentityPatch(client, lastName, passportNo),
          ...tripPatch(trip),
        },
      };
    }

    return { status: "none", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
  } catch {
    return { status: "error", message: "Nous n’avons pas trouvé de fiche client avec ce numéro de passeport. Vérifiez le numéro ou complétez le formulaire manuellement." };
  }
}

export const applyEmptyFieldPatch = (target: Record<string, unknown>, patch: Record<string, unknown>) =>
  Object.entries(patch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== "" && !target[key]) {
      acc[key] = value;
    }
    return acc;
  }, {});
