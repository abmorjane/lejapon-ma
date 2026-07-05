import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate, fmtDateTime, fmtMAD } from "@/lib/format";
import { downloadBytes, sanitizePdfText } from "@/lib/booking-pdfs";
import stampUrl from "@/assets/stamp-moroccan-express.png";
import logoLeJaponUrl from "@/assets/logo-lejapon.png";
import logoMoroccanExpressUrl from "@/assets/logo-moroccan-express.png";

type DbClient = { from: (table: string) => any };
const db = supabase as unknown as DbClient;

export type TravelAgreementStatus = "draft" | "sent" | "opened" | "accepted" | "declined" | "needs_review";

export type TravelAgreementSection = {
  key: string;
  title: string;
  body?: string;
  items?: string[];
};

export type TravelAgreementTemplateSection = Pick<TravelAgreementSection, "key" | "title" | "body">;

type AgreementTableRow = Record<string, string | number | null | undefined>;

export type TravelAgreementContent = {
  agreement_reference?: string;
  agreement_version?: string;
  generated_at: string;
  editable_fields?: {
    included_services?: string;
    luggage_transfer_policy?: string;
    specific_cancellation_conditions?: string;
    complementary_note?: string;
  };
  acceptance_evidence?: {
    accepted_full_name?: string;
    accepted_first_name?: string;
    accepted_last_name?: string;
    accepted_passport_number?: string;
    accepted_at?: string;
    agreement_version?: string;
    agreement_reference?: string;
    acceptance_statement?: string;
  };
  summary: {
    client_name: string;
    client_email?: string | null;
    passport_number?: string | null;
    booking_reference?: string | null;
    trip_title: string;
    trip_dates: string;
    travelers_count: number;
    payment_status: string;
    total_amount_mad?: number | null;
    paid_amount_mad?: number | null;
    remaining_balance_mad?: number | null;
  };
  details?: {
    flights?: AgreementTableRow[];
    hotels?: AgreementTableRow[];
    payments?: AgreementTableRow[];
  };
  sections: TravelAgreementSection[];
};

export type TravelAgreement = {
  id: string;
  booking_id: string | null;
  trip_id: string | null;
  status: TravelAgreementStatus;
  secure_token: string;
  client_name: string | null;
  client_email: string | null;
  booking_reference: string | null;
  trip_title: string | null;
  trip_start_date: string | null;
  trip_end_date: string | null;
  content: TravelAgreementContent;
  sent_at: string | null;
  opened_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TravelAgreementAcceptance = {
  id?: string;
  agreement_id?: string;
  booking_id?: string | null;
  client_email?: string | null;
  typed_name: string;
  accepted_first_name?: string | null;
  accepted_last_name?: string | null;
  accepted_passport_number?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  status?: "accepted" | "declined" | "needs_review";
  message?: string | null;
  accepted_at: string;
};

const SITE_URL = "https://www.lejapon.ma";
const RED = rgb(0.82, 0.08, 0.12);
const BLACK = rgb(0.08, 0.07, 0.06);
const GREY = rgb(0.42, 0.39, 0.36);
const LIGHT = rgb(0.97, 0.95, 0.92);
const WARM = rgb(1, 0.97, 0.93);
const ORANGE = rgb(0.94, 0.34, 0.12);
const BORDER = rgb(0.87, 0.81, 0.74);
export const TRAVEL_AGREEMENT_VERSION = "TRAVEL-AGREEMENT-FR-V2.0";
export const ACCEPTANCE_STATEMENT = "J'ai lu et compris le présent accord de voyage. J'en accepte les conditions et je m'engage à respecter les règles d'organisation du voyage.";

export const DEFAULT_STANDARD_AGREEMENT_SECTIONS: TravelAgreementTemplateSection[] = [
  {
    key: "object",
    title: "Objet de l’accord",
    body: "Le Participant confirme sa participation au voyage organisé par l'Agence et reconnaît avoir pris connaissance des informations relatives au séjour, aux prestations prévues et aux règles nécessaires au bon déroulement du voyage.\n\nLe présent accord complète les informations, programmes et documents de voyage communiqués au Participant.",
  },
  {
    key: "organization_rules",
    title: "Organisation et règles du voyage",
    body: "Le Participant s'engage à contribuer au bon déroulement du voyage et à adopter un comportement respectueux envers les autres participants, les accompagnateurs, les guides et les prestataires.\n\nIl s'engage à respecter les horaires et lieux de rendez-vous communiqués, les temps prévus pour les visites et activités, les consignes opérationnelles et de sécurité, ainsi que les lois et règlements du pays visité.\n\nTout transport ou service manqué en raison d'un retard personnel peut entraîner des frais supplémentaires qui restent à la charge du Participant.",
  },
  {
    key: "luggage",
    title: "Bagages et transferts de bagages",
    body: "Lorsque le programme prévoit l'envoi des bagages séparément lors d'un déplacement entre deux villes, le Participant s'engage à préparer ses bagages dans les délais communiqués par l'accompagnateur.\n\nLe délai de livraison dépend du transporteur utilisé et peut nécessiter une livraison le jour suivant.",
  },
  {
    key: "extras",
    title: "Activités et prestations supplémentaires",
    body: "Les activités supplémentaires ou options réservées en dehors des prestations incluses peuvent être soumises aux conditions d'annulation des prestataires concernés.\n\nLes frais de transport, repas, billets ou dépenses liés à une activité personnelle ou réalisée indépendamment du programme restent à la charge du Participant, sauf indication écrite contraire de l'Agence.",
  },
  {
    key: "food",
    title: "Alimentation",
    body: "Le Participant demeure responsable de ses choix alimentaires.\n\nL'Agence et ses accompagnateurs peuvent orienter le Participant vers des restaurants ou options alimentaires correspondant, dans la mesure du possible, à ses préférences ou contraintes. Toute allergie alimentaire connue ou contrainte importante doit être signalée à l'Agence avant le départ.",
  },
  {
    key: "health_insurance",
    title: "Santé et assurance",
    body: "Le Participant s'engage à informer l'Agence, avant le départ, de toute situation particulière susceptible d'avoir un impact significatif sur l'organisation ou sa participation aux activités prévues.\n\nLe Participant est responsable de prévoir les médicaments et traitements personnels nécessaires pendant le séjour. L'Agence recommande fortement la souscription d'une assurance voyage adaptée couvrant notamment les frais médicaux, l'assistance, le rapatriement, les bagages et, lorsque disponible, l'annulation.",
  },
  {
    key: "payment_cancellation",
    title: "Paiement et annulation",
    body: "Le montant du voyage et les paiements enregistrés sont indiqués dans le présent accord.\n\nLe Participant s'engage à respecter l'échéancier et les modalités de paiement communiqués par l'Agence. En cas d'annulation à son initiative, les sommes pouvant être retenues correspondent notamment aux frais et engagements déjà supportés par l'Agence auprès des compagnies aériennes, hôtels, transporteurs et autres prestataires.",
  },
  {
    key: "agency_commitments",
    title: "Engagements de l'Agence",
    body: "L'Agence s'engage à organiser et coordonner les prestations prévues conformément au programme et aux réservations confirmées.\n\nElle assure la coordination des prestations réservées, la transmission des informations nécessaires au voyage et une assistance avant et pendant le voyage dans le cadre des prestations organisées.",
  },
  {
    key: "independent_circumstances",
    title: "Circonstances indépendantes de l'Agence",
    body: "Certaines circonstances indépendantes de la volonté de l'Agence peuvent affecter le voyage, notamment les conditions météorologiques, décisions des autorités, perturbations aériennes ou ferroviaires, grèves, contraintes administratives, événements de sécurité ou autres circonstances exceptionnelles.\n\nLorsque ces événements surviennent, l'Agence met en œuvre les démarches raisonnablement possibles pour assister les Participants et adapter l'organisation.",
  },
  {
    key: "programme_changes",
    title: "Modification du programme",
    body: "L'Agence peut adapter l'ordre des visites, horaires, transports ou certaines prestations lorsque des contraintes opérationnelles, de sécurité ou des circonstances indépendantes de sa volonté le nécessitent.\n\nDans la mesure du possible, l'Agence privilégiera une solution ou prestation équivalente. Toute modification substantielle sera communiquée aux Participants dès que raisonnablement possible.",
  },
  {
    key: "acceptance",
    title: "Acceptation électronique",
    body: "En acceptant électroniquement le présent accord, le Participant confirme avoir lu l'intégralité du document, vérifié les informations relatives à son voyage, compris les prestations incluses et les éventuelles prestations supplémentaires, accepté les règles d'organisation du voyage et s'engage à respecter les présentes dispositions.",
  },
];

const AGENCY_FOOTER_LINES = [
  "MOROCCAN EXPRESS TRAVEL AND EVENTS TEMARA · RC 87017 · IF 3343064 · ICE 000045023000080",
  "Résidence Youssef, Rue Annour, Hay El Wifaq, Témara, Maroc · Succursale: Appt n°2, 1er étage, Imm. 64, Rue des Martyrs, Settat",
  "+212 711 44 98 38 · info@lejapon.ma · moroccan.express · Capital: 1.000.000 DH · Patente: 865910 · CNSS: 8852552",
];

const clean = (value: unknown, fallback = "—") => {
  const text = String(value ?? "").trim();
  return text || fallback;
};

const fullName = (participant: any) =>
  [participant?.first_name, participant?.last_name].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ").trim();

const tripDateRange = (start?: string | null, end?: string | null) => {
  if (start && end) return `${fmtDate(start)} au ${fmtDate(end)}`;
  if (start) return `Départ ${fmtDate(start)}`;
  if (end) return `Retour ${fmtDate(end)}`;
  return "Dates à confirmer";
};

const paymentStatusLabel = (booking?: any | null) => {
  if (!booking) return "À confirmer";
  const total = Number(booking.total_amount_mad || 0);
  const paid = Number(booking.paid_amount_mad || 0);
  if (total > 0 && paid >= total) return `Payé (${fmtMAD(paid)})`;
  if (paid > 0) return `Partiellement payé : ${fmtMAD(paid)} / ${fmtMAD(total)}`;
  return total > 0 ? `En attente de paiement : ${fmtMAD(total)}` : "Montant à confirmer";
};

export const agreementPublicUrl = (token: string) => {
  const origin = typeof window !== "undefined" ? window.location.origin : SITE_URL;
  return `${origin.replace(/\/$/, "")}/accord-voyage/${token}`;
};

export async function loadAgreementSource(input: {
  bookingId?: string;
  tripId?: string;
  clientId?: string;
  clientName?: string;
  clientEmail?: string;
}) {
  let booking: any = null;
  let trip: any = null;
  let client: any = null;
  let extras: any[] = [];
  let participants: any[] = [];
  let hotels: any[] = [];
  let itinerary: any[] = [];

  if (input.bookingId) {
    const { data, error } = await supabase
      .from("bookings")
      .select("*, trips(id,title,season,destination,start_date,end_date,duration_days,outbound_flight_text,return_flight_text,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_address,visa_hotel_phone)")
      .eq("id", input.bookingId)
      .single();
    if (error) throw error;
    booking = data;
    trip = data?.trips ?? null;
    const [{ data: extraRows }, { data: participantRows }] = await Promise.all([
      db.from("booking_extras").select("*").eq("booking_id", input.bookingId),
      db.from("booking_participants").select("*").eq("booking_id", input.bookingId).order("created_at", { ascending: true }),
    ]);
    extras = extraRows ?? [];
    participants = participantRows ?? [];
    if (booking?.client_id) {
      const { data: clientRow } = await db
        .from("clients")
        .select("id,first_name,last_name,full_name,email,phone,passport_no,passport_number")
        .eq("id", booking.client_id)
        .maybeSingle();
      client = clientRow ?? null;
    }
  } else {
    if (input.clientId) {
      const { data: clientRow, error: clientError } = await db
        .from("clients")
        .select("id,first_name,last_name,full_name,email,phone,passport_no,passport_number")
        .eq("id", input.clientId)
        .single();
      if (clientError) throw clientError;
      client = clientRow;
    }
    if (input.tripId) {
      const { data, error } = await supabase
        .from("trips")
        .select("id,title,season,destination,start_date,end_date,duration_days,outbound_flight_text,return_flight_text,visa_arrival_port,visa_arrival_flight_number,visa_hotel_name,visa_hotel_address,visa_hotel_phone")
        .eq("id", input.tripId)
        .single();
      if (error) throw error;
      trip = data;
    }
  }

  const tripId = booking?.trip_id ?? input.tripId ?? trip?.id;
  if (tripId) {
    const [{ data: hotelRows }, { data: dayRows }] = await Promise.all([
      db.from("trip_hotels").select("*").eq("trip_id", tripId).order("sort_order", { ascending: true }),
      db.from("itinerary_days").select("*").eq("trip_id", tripId).order("day_number", { ascending: true }),
    ]);
    hotels = hotelRows ?? [];
    itinerary = dayRows ?? [];
  }

  return {
    booking,
    trip,
    client,
    extras,
    participants,
    hotels,
    itinerary,
    clientName: input.clientName || booking?.contact_name || client?.full_name || [client?.first_name, client?.last_name].filter(Boolean).join(" ") || "",
    clientEmail: input.clientEmail || booking?.contact_email || client?.email || "",
  };
}

export function buildAgreementContent(source: {
  booking?: any | null;
  trip?: any | null;
  client?: any | null;
  extras?: any[];
  participants?: any[];
  hotels?: any[];
  itinerary?: any[];
  clientName?: string;
  clientEmail?: string;
  editableFields?: TravelAgreementContent["editable_fields"];
  standardSections?: TravelAgreementTemplateSection[];
}): TravelAgreementContent {
  const booking = source.booking ?? null;
  const trip = source.trip ?? null;
  const client = source.client ?? null;
  const extras = source.extras ?? [];
  const participants = source.participants ?? [];
  const hotels = source.hotels ?? [];
  const itinerary = source.itinerary ?? [];
  const travelersCount = Math.max(1, Number(booking?.num_adults || 0) + Number(booking?.num_children || 0), participants.length || 0);
  const clientName = clean(source.clientName || booking?.contact_name, "Client à confirmer");
  const tripTitle = clean(trip?.title || booking?.trips?.title, "Voyage à confirmer");
  const dates = tripDateRange(trip?.start_date, trip?.end_date);
  const total = Number(booking?.total_amount_mad || 0);
  const paid = Number(booking?.paid_amount_mad || 0);
  const remaining = total > 0 ? Math.max(0, total - paid) : null;
  const leadParticipant = participants.find((participant) => participant.is_lead) ?? participants[0] ?? null;
  const passportNumber = leadParticipant?.passport_no || client?.passport_no || client?.passport_number || null;
  const participantNames = participants.map((participant) => {
    const name = fullName(participant);
    const passport = participant?.passport_no ? ` · Passeport : ${participant.passport_no}` : "";
    return name ? `${name}${passport}` : "";
  }).filter(Boolean);
  const agreementReference = `AV-${booking?.reference || new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
  const editableFields = source.editableFields ?? {};
  const includedServices = editableFields.included_services?.trim()
    || [
      trip?.outbound_flight_text || trip?.return_flight_text ? "Transport aérien international lorsqu'il est inclus dans la réservation confirmée." : "",
      "Hébergements prévus au programme ou aux réservations confirmées.",
      "Transports, transferts, accompagnement, guides, repas et activités expressément mentionnés dans le programme ou la réservation.",
    ].filter(Boolean).join("\n");
  const hotelRows = hotels.length
    ? hotels.map((hotel) => {
      const nights = hotel.check_in && hotel.check_out
        ? Math.max(1, Math.round((new Date(hotel.check_out).getTime() - new Date(hotel.check_in).getTime()) / 86400000))
        : hotel.nights || null;
      return [
        `${clean(hotel.city, "Ville à confirmer")} — ${clean(hotel.name || hotel.hotel_name, "Hôtel à confirmer")}`,
        hotel.check_in || hotel.check_out ? `Du ${fmtDate(hotel.check_in)} au ${fmtDate(hotel.check_out)}` : "Dates à confirmer",
        nights ? `${nights} nuit(s)` : "",
      ].filter(Boolean).join(" — ");
    })
    : trip?.visa_hotel_name
      ? [[
        clean(trip.visa_arrival_port || trip.destination, "Ville à confirmer"),
        clean(trip.visa_hotel_name, "Hôtel à confirmer"),
        trip.visa_hotel_address ? `Adresse : ${trip.visa_hotel_address}` : "",
        trip.visa_hotel_phone ? `Tél : ${trip.visa_hotel_phone}` : "",
      ].filter(Boolean).join(" — ")]
    : [];
  const hotelTableRows = hotels.length
    ? hotels.map((hotel) => {
      const nights = hotel.check_in && hotel.check_out
        ? Math.max(1, Math.round((new Date(hotel.check_out).getTime() - new Date(hotel.check_in).getTime()) / 86400000))
        : hotel.nights || null;
      return {
        city: clean(hotel.city, "Ville à confirmer"),
        hotel: clean(hotel.name || hotel.hotel_name, "Hôtel à confirmer"),
        dates: hotel.check_in || hotel.check_out ? `${fmtDate(hotel.check_in)} - ${fmtDate(hotel.check_out)}` : "Dates à confirmer",
        nights: nights ? `${nights}` : "—",
      };
    })
    : trip?.visa_hotel_name
      ? [{
        city: clean(trip.visa_arrival_port || trip.destination, "Ville à confirmer"),
        hotel: clean(trip.visa_hotel_name, "Hôtel à confirmer"),
        dates: "À confirmer",
        nights: "—",
      }]
      : [];
  const visaFlightSummary = trip?.visa_arrival_flight_number
    ? `VOL ALLER\nVol : ${trip.visa_arrival_flight_number}${trip.visa_arrival_port ? `\nArrivée : ${trip.visa_arrival_port}` : ""}`
    : "";
  const flightItems = [
    trip?.outbound_flight_text ? `VOL ALLER\n${trip.outbound_flight_text}` : "",
    trip?.return_flight_text ? `VOL RETOUR\n${trip.return_flight_text}` : "",
    !trip?.outbound_flight_text && !trip?.return_flight_text && visaFlightSummary ? visaFlightSummary : "",
    !trip?.outbound_flight_text && !trip?.return_flight_text && !visaFlightSummary
      ? "Les informations aériennes définitives seront communiquées au Participant dès leur confirmation."
      : "",
  ].filter(Boolean);
  const flightTableRows = [
    trip?.outbound_flight_text ? { type: "Aller", details: trip.outbound_flight_text } : null,
    trip?.return_flight_text ? { type: "Retour", details: trip.return_flight_text } : null,
    !trip?.outbound_flight_text && !trip?.return_flight_text && visaFlightSummary ? { type: "Aller", details: visaFlightSummary.replace(/\n+/g, " · ") } : null,
  ].filter(Boolean) as AgreementTableRow[];
  const bookingStatus = clean(booking?.status, "À confirmer");
  const destination = clean(trip?.destination, "Japon");
  const standardSections = source.standardSections?.length ? source.standardSections : DEFAULT_STANDARD_AGREEMENT_SECTIONS;
  const standardByKey = new Map(standardSections.map((section) => [section.key, section]));
  const standard = (key: string) => standardByKey.get(key) ?? DEFAULT_STANDARD_AGREEMENT_SECTIONS.find((section) => section.key === key);
  const standardSection = (key: string, extrasForSection?: Partial<TravelAgreementSection>): TravelAgreementSection => {
    const base = standard(key);
    return {
      key,
      title: extrasForSection?.title || base?.title || key,
      body: [base?.body, extrasForSection?.body].filter(Boolean).join("\n\n"),
      items: extrasForSection?.items,
    };
  };

  return {
    agreement_reference: agreementReference,
    agreement_version: TRAVEL_AGREEMENT_VERSION,
    generated_at: new Date().toISOString(),
    editable_fields: {
      included_services: includedServices,
      luggage_transfer_policy: editableFields.luggage_transfer_policy ?? "",
      specific_cancellation_conditions: editableFields.specific_cancellation_conditions ?? "",
      complementary_note: editableFields.complementary_note ?? "",
    },
    summary: {
      client_name: clientName,
      client_email: source.clientEmail || booking?.contact_email || null,
      passport_number: passportNumber,
      booking_reference: booking?.reference ?? null,
      trip_title: tripTitle,
      trip_dates: dates,
      travelers_count: travelersCount,
      payment_status: paymentStatusLabel(booking),
      total_amount_mad: total || null,
      paid_amount_mad: paid || null,
      remaining_balance_mad: remaining,
    },
    details: {
      flights: flightTableRows.length ? flightTableRows : [{ type: "À confirmer", details: "Les informations aériennes définitives seront communiquées dès confirmation." }],
      hotels: hotelTableRows.length ? hotelTableRows : [{ city: "À confirmer", hotel: "Hébergement à confirmer", dates: "À confirmer", nights: "—" }],
      payments: [
        { label: "Montant total", value: total ? fmtMAD(total) : "À confirmer" },
        { label: "Montant réglé", value: fmtMAD(paid) },
        { label: "Solde restant", value: remaining !== null ? fmtMAD(remaining) : "À confirmer" },
        { label: "Statut", value: paymentStatusLabel(booking) },
      ],
    },
    sections: [
      {
        key: "identification",
        title: "Accord de voyage",
        items: [
          `Référence de l'accord : ${agreementReference}`,
          "Entre Moroccan Express Travel and Events, opérant notamment sous la marque LeJapon.ma, ci-après désignée « l'Agence »,",
          `et ${clientName}, titulaire du passeport n° ${passportNumber || "à compléter"}, ci-après désigné « le Participant ».`,
          "Le présent accord a pour objet de préciser les principales prestations, modalités d'organisation et engagements applicables au voyage décrit ci-dessous.",
        ],
      },
      {
        key: "object",
        title: standard("object")?.title || "Objet de l’accord",
        body: standard("object")?.body,
      },
      {
        key: "trip_information",
        title: "Informations du voyage",
        items: [
          `Voyage : ${tripTitle}`,
          `Destination : ${destination}`,
          `Date de départ : ${fmtDate(trip?.start_date)}`,
          `Date de retour : ${fmtDate(trip?.end_date)}`,
          `Durée : ${trip?.duration_days || "à confirmer"} jours`,
          `Référence de réservation : ${booking?.reference || "à confirmer"}`,
          `Participant : ${clientName}`,
          `Statut de la réservation : ${bookingStatus}`,
          `Montant total de la réservation : ${total ? fmtMAD(total) : "à confirmer"}`,
          `Montant déjà réglé : ${fmtMAD(paid)}`,
          `Solde restant : ${remaining !== null ? fmtMAD(remaining) : "à confirmer"}`,
        ],
      },
      {
        key: "flights",
        title: "Transport aérien",
        items: flightItems.concat([
          "Les horaires, appareils, itinéraires et numéros de vol peuvent être modifiés par les compagnies aériennes.",
          "Les billets d'avion sont soumis aux conditions tarifaires de la compagnie aérienne. Selon le tarif réservé, ils peuvent être non modifiables ou non remboursables après émission.",
          "Les billets sont personnels et non cessibles.",
          "Le Participant s'engage à se présenter à l'aéroport au minimum trois heures avant l'heure prévue du départ, sauf indication contraire communiquée par l'Agence.",
          "En cas de modification, retard, annulation ou perturbation décidée par la compagnie aérienne, l'Agence accompagne le Participant dans les démarches et la recherche de solutions, dans les limites des conditions imposées par le transporteur.",
        ]),
      },
      {
        key: "hotels",
        title: "Hébergements",
        items: (hotelRows.length ? hotelRows : ["Les informations d'hébergement définitives seront communiquées dès leur confirmation."]).concat([
          "Les hébergements indiqués correspondent aux réservations ou prévisions disponibles au moment de l'établissement du présent accord.",
          "En cas d'indisponibilité, de modification imposée par l'établissement ou de contrainte opérationnelle indépendante de l'Agence, un hébergement de catégorie ou de niveau de confort comparable pourra être proposé, sous réserve des disponibilités.",
          "Les horaires de check-in et de check-out sont ceux appliqués par chaque établissement.",
        ]),
      },
      {
        key: "included_services",
        title: "Prestations incluses",
        body: "Sont incluses dans le voyage les prestations indiquées dans le programme et la réservation du Participant, notamment :",
        items: includedServices.split(/\n+/).map((line) => line.trim()).filter(Boolean).concat([
          "Toute prestation qui n'est pas expressément mentionnée comme incluse doit être considérée comme non incluse.",
        ]),
      },
      {
        key: "organization_rules",
        title: standard("organization_rules")?.title || "Organisation et règles du voyage",
        body: standard("organization_rules")?.body,
      },
      standardSection("luggage", { body: editableFields.luggage_transfer_policy?.trim() || "" }),
      standardSection("extras", {
        items: extras.length ? extras.map((extra) => `${clean(extra.name_snapshot)} × ${Number(extra.qty || 1)} — ${fmtMAD(Number(extra.qty || 1) * Number(extra.unit_price_mad || 0))}`) : undefined,
      }),
      standardSection("food"),
      standardSection("health_insurance"),
      standardSection("payment_cancellation", {
        body: editableFields.specific_cancellation_conditions?.trim() ? `CONDITIONS PARTICULIÈRES D'ANNULATION\n${editableFields.specific_cancellation_conditions.trim()}` : "",
      }),
      standardSection("agency_commitments"),
      standardSection("independent_circumstances"),
      standardSection("programme_changes"),
      {
        key: "itinerary",
        title: "Itinéraire du voyage",
        items: itinerary.length
          ? itinerary.map((day) => `Jour ${day.day_number} — ${clean(day.city, "Japon")} : ${clean(day.title)}`)
          : ["Itinéraire détaillé selon le programme confirmé et les documents transmis avant le départ."],
      },
      {
        key: "acceptance",
        title: standard("acceptance")?.title || "Acceptation électronique",
        body: standard("acceptance")?.body,
        items: participantNames.length ? participantNames.map((name) => `Participant : ${name}`) : undefined,
      },
      ...(editableFields.complementary_note?.trim() ? [{
        key: "complementary_note",
        title: "Note complémentaire",
        body: editableFields.complementary_note.trim(),
      }] : []),
    ],
  };
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawText(page: PDFPage, text: string, x: number, y: number, font: PDFFont, size: number, color = BLACK) {
  page.drawText(sanitizePdfText(text), { x, y, font, size, color });
}

async function loadPng(pdf: PDFDocument, url: string) {
  try {
    const res = await fetch(url);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(bytes);
  } catch {
    return null;
  }
}

async function loadStamp(pdf: PDFDocument) {
  return loadPng(pdf, stampUrl);
}

async function drawAgencyStamp(pdf: PDFDocument, page: PDFPage, x: number, y: number) {
  const stamp = await loadStamp(pdf);
  if (!stamp) return;
  const maxW = 150;
  const maxH = 90;
  const ratio = stamp.width / stamp.height;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  page.drawImage(stamp, { x, y, width: w, height: h, opacity: 0.85 });
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number, pageCount: number) {
  const width = page.getWidth();
  page.drawRectangle({ x: 42, y: 56, width: width - 84, height: 0.5, color: rgb(0.82, 0.78, 0.72) });
  let y = 43;
  AGENCY_FOOTER_LINES.forEach((line) => {
    drawText(page, line, 42, y, font, 6.2, GREY);
    y -= 9;
  });
  const label = `Page ${pageNumber} / ${pageCount}`;
  const textWidth = font.widthOfTextAtSize(label, 7);
  drawText(page, label, width - 42 - textWidth, 22, font, 7, GREY);
}

function splitParagraphs(value: string) {
  return String(value || "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
}

function rowValue(row: AgreementTableRow, key: string) {
  return clean(row[key], "—");
}

export async function generateTravelAgreementPdf(input: {
  agreement: Pick<TravelAgreement, "client_name" | "booking_reference" | "trip_title" | "trip_start_date" | "trip_end_date" | "content" | "accepted_at">;
  acceptance?: TravelAgreementAcceptance | null;
}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontB = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logoLeJapon = await loadPng(pdf, logoLeJaponUrl);
  const logoMoroccan = await loadPng(pdf, logoMoroccanExpressUrl);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 790;
  const margin = 44;
  const contentWidth = 507;

  const addPageIfNeeded = (needed = 90) => {
    if (y - needed > 78) return;
    page = pdf.addPage([595.28, 841.89]);
    y = 790;
  };

  const addParagraph = (text: string, size = 9.1, left = margin, width = contentWidth, color = BLACK) => {
    splitParagraphs(text).forEach((paragraph) => {
      wrapText(paragraph, font, size, width).forEach((line) => {
        addPageIfNeeded(56);
        drawText(page, line, left, y, font, size, color);
        y -= size + 3.4;
      });
      y -= 5;
    });
  };

  const addSectionTitle = (title: string) => {
    addPageIfNeeded(72);
    page.drawRectangle({ x: margin, y: y - 2, width: 4, height: 18, color: ORANGE });
    drawText(page, title.toUpperCase(), margin + 12, y + 1, fontB, 11.2, BLACK);
    y -= 24;
  };

  const drawInfoCard = (x: number, yy: number, w: number, h: number, label: string, value: string, accent = false) => {
    page.drawRectangle({ x, y: yy, width: w, height: h, color: accent ? WARM : rgb(1, 1, 1), borderColor: BORDER, borderWidth: 0.5 });
    drawText(page, label.toUpperCase(), x + 10, yy + h - 15, fontB, 6.7, accent ? RED : GREY);
    wrapText(value, fontB, 9.2, w - 20).slice(0, 2).forEach((line, index) => {
      drawText(page, line, x + 10, yy + h - 31 - index * 12, fontB, 9.2, BLACK);
    });
  };

  const drawTable = (title: string, columns: Array<{ key: string; label: string; width: number }>, rows: AgreementTableRow[]) => {
    addSectionTitle(title);
    if (!rows.length) rows = [{ info: "À confirmer" }];
    const rowHeight = 31;
    const tableHeight = 24 + rowHeight * rows.length;
    addPageIfNeeded(tableHeight + 20);
    page.drawRectangle({ x: margin, y: y - 22, width: contentWidth, height: 22, color: BLACK });
    let x = margin;
    columns.forEach((column) => {
      drawText(page, column.label.toUpperCase(), x + 8, y - 14, fontB, 6.8, rgb(1, 1, 1));
      x += column.width;
    });
    y -= 22;
    rows.forEach((row, rowIndex) => {
      page.drawRectangle({
        x: margin,
        y: y - rowHeight,
        width: contentWidth,
        height: rowHeight,
        color: rowIndex % 2 === 0 ? rgb(1, 1, 1) : WARM,
        borderColor: BORDER,
        borderWidth: 0.35,
      });
      let colX = margin;
      columns.forEach((column) => {
        const lines = wrapText(rowValue(row, column.key), font, 7.9, column.width - 14).slice(0, 2);
        lines.forEach((line, lineIndex) => drawText(page, line, colX + 8, y - 12 - lineIndex * 10, font, 7.9, BLACK));
        colX += column.width;
      });
      y -= rowHeight;
    });
    y -= 15;
  };

  page.drawRectangle({ x: 0, y: 770, width: 595.28, height: 72, color: WARM });
  page.drawRectangle({ x: 0, y: 767, width: 595.28, height: 3, color: RED });
  if (logoLeJapon) page.drawImage(logoLeJapon, { x: margin, y: 788, width: 118, height: 38 });
  else drawText(page, "LeJapon.ma", margin, 808, fontB, 18, RED);
  if (logoMoroccan) page.drawImage(logoMoroccan, { x: 178, y: 791, width: 88, height: 31, opacity: 0.95 });
  drawText(page, "ACCORD DE VOYAGE", 342, 813, fontB, 18, BLACK);
  drawText(page, input.agreement.content.agreement_version || TRAVEL_AGREEMENT_VERSION, 342, 796, font, 7.8, GREY);
  drawText(page, `Référence : ${input.agreement.content.agreement_reference || input.agreement.booking_reference || "—"}`, 342, 783, fontB, 8.5, RED);
  y = 742;

  const summary = input.agreement.content?.summary;
  drawText(page, "Résumé du dossier", margin, y, fontB, 13, BLACK);
  y -= 15;
  drawInfoCard(margin, y - 54, 159, 48, "Client", clean(input.agreement.client_name || summary?.client_name));
  drawInfoCard(margin + 174, y - 54, 159, 48, "Réservation", clean(input.agreement.booking_reference || summary?.booking_reference));
  drawInfoCard(margin + 348, y - 54, 159, 48, "Voyage", clean(input.agreement.trip_title || summary?.trip_title), true);
  y -= 67;
  drawInfoCard(margin, y - 54, 159, 48, "Dates", clean(summary?.trip_dates || tripDateRange(input.agreement.trip_start_date, input.agreement.trip_end_date)));
  drawInfoCard(margin + 174, y - 54, 159, 48, "Participants", `${summary?.travelers_count || 1}`);
  drawInfoCard(margin + 348, y - 54, 159, 48, "Paiement", clean(summary?.payment_status), true);
  y -= 76;

  drawTable("Résumé financier", [
    { key: "label", label: "Élément", width: 170 },
    { key: "value", label: "Valeur", width: 337 },
  ], input.agreement.content.details?.payments ?? []);

  drawTable("Transport aérien", [
    { key: "type", label: "Vol", width: 92 },
    { key: "details", label: "Détails", width: 415 },
  ], input.agreement.content.details?.flights ?? []);

  drawTable("Logement détaillé", [
    { key: "city", label: "Ville", width: 100 },
    { key: "hotel", label: "Hôtel", width: 205 },
    { key: "dates", label: "Dates", width: 142 },
    { key: "nights", label: "Nuits", width: 60 },
  ], input.agreement.content.details?.hotels ?? []);

  const hiddenInBody = new Set(["identification", "trip_information", "flights", "hotels"]);
  input.agreement.content.sections.filter((section) => !hiddenInBody.has(section.key)).forEach((section) => {
    addSectionTitle(section.title);
    if (section.body) {
      addParagraph(section.body, 8.9, margin + 12, contentWidth - 12, BLACK);
    }
    (section.items ?? []).forEach((item) => {
      addPageIfNeeded(46);
      const lines = wrapText(item, font, 8.7, contentWidth - 30);
      page.drawCircle({ x: margin + 9, y: y + 3, size: 2.2, color: ORANGE });
      lines.forEach((line, lineIndex) => {
        drawText(page, line, margin + 20, y - lineIndex * 11.5, font, 8.7, BLACK);
      });
      y -= Math.max(13, lines.length * 11.5 + 3);
    });
    y -= 10;
  });

  addPageIfNeeded(178);
  page.drawRectangle({ x: margin, y: y - 144, width: contentWidth, height: 144, color: WARM, borderColor: BORDER, borderWidth: 0.6 });
  page.drawRectangle({ x: margin, y: y - 4, width: contentWidth, height: 4, color: RED });
  drawText(page, "ACCEPTATION ÉLECTRONIQUE", margin + 16, y - 24, fontB, 11.5, BLACK);
  if (input.acceptance) {
    const evidence = input.agreement.content.acceptance_evidence ?? {};
    wrapText(`Mention d'acceptation : "${evidence.acceptance_statement || ACCEPTANCE_STATEMENT}"`, font, 7.2, 315).slice(0, 3).forEach((line, index) => {
      drawText(page, line, margin + 16, y - 42 - index * 9, font, 7.2, BLACK);
    });
    drawText(page, `Nom et prénom : ${evidence.accepted_full_name || input.acceptance.typed_name}`, margin + 16, y - 77, fontB, 8.8, BLACK);
    drawText(page, `Passeport : ${evidence.accepted_passport_number || clean(summary?.passport_number)}`, margin + 16, y - 94, font, 8.5, BLACK);
    drawText(page, `Accepté le : ${fmtDateTime(evidence.accepted_at || input.acceptance.accepted_at)}`, margin + 16, y - 111, font, 8.5, BLACK);
    drawText(page, `Version : ${input.agreement.content.agreement_version || TRAVEL_AGREEMENT_VERSION}`, margin + 16, y - 128, font, 7.5, GREY);
  } else {
    drawText(page, "Document non encore accepté par le client.", margin + 16, y - 44, font, 9.5, GREY);
  }
  drawText(page, "Signature et cachet de l'agence", margin + 360, y - 43, fontB, 8, GREY);
  await drawAgencyStamp(pdf, page, margin + 350, y - 126);

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => drawFooter(pdfPage, font, index + 1, pages.length));
  return pdf.save();
}

export function downloadTravelAgreementPdf(bytes: Uint8Array, filename: string) {
  downloadBytes(bytes, filename);
}
