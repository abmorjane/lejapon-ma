import { supabase } from "@/integrations/supabase/client";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export type VisaPrefillResult =
  | { status: "none"; message: string }
  | { status: "multiple"; message: string }
  | { status: "error"; message: string }
  | { status: "matched"; source: "booking_participant" | "client"; sourceId: string; patch: Record<string, unknown>; sourceLabel: string };

export const normalizePassportNo = (value: unknown) =>
  String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");

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

const tripPatch = (trip: any | null) => {
  if (!trip) return {};
  const duration = Number(trip.duration_days || 0);
  return {
    document_trip_id: trip.id,
    intended_length_of_stay: duration > 0 ? `${duration} jours` : null,
    date_of_arrival: trip.visa_japan_arrival_date || trip.start_date || null,
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
    return { status: "none", message: "Aucune fiche passeport trouvée. Vous pouvez compléter le formulaire manuellement." };
  }

  const lastName = params.lastName.trim();
  const email = params.email.trim().toLowerCase();

  try {
    const { data: participants, error: participantError } = await db
      .from("booking_participants")
      .select("id,booking_id,trip_id,first_name,last_name,email,date_of_birth,nationality,sex,passport_no,passport_issue_date,passport_expiry")
      .eq("passport_no", passportNo)
      .limit(3);

    if (participantError) {
      return { status: "error", message: "Aucune fiche passeport trouvée. Vous pouvez compléter le formulaire manuellement." };
    }

    const safeParticipants = (participants ?? []).filter((participant: any) => isSafeParticipantMatch(participant, lastName, email));
    if ((participants ?? []).length > 1 || safeParticipants.length > 1) {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }

    if (safeParticipants.length === 1) {
      const participant = safeParticipants[0];
      const tripId = participant.trip_id;
      const { data: trip } = tripId
        ? await db
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", tripId)
            .maybeSingle()
        : { data: null };

      return {
        status: "matched",
        source: "booking_participant",
        sourceId: participant.id,
        sourceLabel: `Voyageur lié à une réservation${trip?.title ? ` · ${trip.title}` : ""}`,
        patch: {
          booking_id: participant.booking_id || null,
          surname: participant.last_name || lastName,
          given_names: participant.first_name || null,
          date_of_birth: participant.date_of_birth || null,
          nationality: participant.nationality || null,
          sex: participant.sex || null,
          passport_no: participant.passport_no || passportNo,
          passport_date_of_issue: participant.passport_issue_date || null,
          passport_date_of_expiry: participant.passport_expiry || null,
          ...tripPatch(trip),
        },
      };
    }

    const { data: clients, error: clientError } = await db
      .from("clients")
      .select("id,full_name,email,date_of_birth,birthdate,birth_date,nationality,sex,passport_no,passport_number,passport_issue_date,passport_expiry,last_trip_id")
      .or(`passport_number.eq.${passportNo},passport_no.eq.${passportNo}`)
      .limit(3);

    if (clientError) {
      return { status: "none", message: "Aucune fiche passeport trouvée. Vous pouvez compléter le formulaire manuellement." };
    }

    const safeClients = (clients ?? []).filter((client: any) => isSafeClientMatch(client, lastName, email));
    if ((clients ?? []).length > 1 || safeClients.length > 1) {
      return { status: "multiple", message: "Plusieurs dossiers correspondent. Merci de contacter l'agence." };
    }

    if (safeClients.length === 1) {
      const client = safeClients[0];
      const [givenNames, ...surnameParts] = String(client.full_name ?? "").trim().split(/\s+/);
      const tripId = client.last_trip_id;
      const { data: trip } = tripId
        ? await db
            .from("trips")
            .select("id,title,start_date,end_date,duration_days,visa_japan_arrival_date,visa_japan_departure_date,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_phone,visa_hotel_address")
            .eq("id", tripId)
            .maybeSingle()
        : { data: null };

      return {
        status: "matched",
        source: "client",
        sourceId: client.id,
        sourceLabel: `Fiche client${trip?.title ? ` · ${trip.title}` : ""}`,
        patch: {
          surname: lastName || surnameParts.join(" ") || null,
          given_names: givenNames || null,
          date_of_birth: client.date_of_birth || client.birthdate || client.birth_date || null,
          nationality: client.nationality || null,
          sex: client.sex || null,
          passport_no: client.passport_number || client.passport_no || passportNo,
          passport_date_of_issue: client.passport_issue_date || null,
          passport_date_of_expiry: client.passport_expiry || null,
          ...tripPatch(trip),
        },
      };
    }

    return { status: "none", message: "Aucune fiche passeport trouvée. Vous pouvez compléter le formulaire manuellement." };
  } catch {
    return { status: "error", message: "Aucune fiche passeport trouvée. Vous pouvez compléter le formulaire manuellement." };
  }
}

export const applyEmptyFieldPatch = (target: Record<string, unknown>, patch: Record<string, unknown>) =>
  Object.entries(patch).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (value !== undefined && value !== null && value !== "" && !target[key]) {
      acc[key] = value;
    }
    return acc;
  }, {});
