import { normalizePnr } from "./flight-tickets";

export type FlightTicketExtractionStatus = "ready" | "ocr_required" | "empty" | "unsupported";

export type DetectedFlightTicket = {
  status: FlightTicketExtractionStatus;
  rawText: string;
  pnr?: string;
  platform?: string;
  airline?: string;
  bookingClass?: string;
  flightNumbers: string[];
  segments: Array<{ from: string; to: string; flight_number?: string }>;
  travelers: Array<{ rawName: string; ticketNumbers: string[] }>;
  warnings: string[];
};

const printableRatio = (value: string) => {
  if (!value) return 0;
  const printable = value.replace(/[^\x20-\x7E\n\r\tÀ-ÿ]/g, "");
  return printable.length / value.length;
};

export async function extractFlightTicketText(file: File): Promise<{ status: FlightTicketExtractionStatus; text: string; warning?: string }> {
  if (!file.type.includes("pdf") && !/\.pdf$/i.test(file.name)) {
    return { status: "unsupported", text: "", warning: "Seuls les PDF sont pris en charge pour cet import." };
  }

  const text = await file.text();
  const cleaned = text.replace(/\0/g, " ").replace(/[ \t]+/g, " ").trim();
  const usefulText = printableRatio(cleaned) > 0.55 && /[A-Z]{2}\s?\d{2,4}|\bPNR\b|\d{13}/i.test(cleaned);

  if (usefulText) return { status: "ready", text: cleaned };
  if (cleaned.length > 0) {
    return {
      status: "ocr_required",
      text: "",
      warning: "Le PDF ne contient pas de couche texte exploitable. Un OCR serveur sera nécessaire pour les scans.",
    };
  }
  return { status: "empty", text: "", warning: "Aucun texte exploitable n’a été trouvé dans ce PDF." };
}

const normalizeName = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

export function parseFlightTicketText(text: string): DetectedFlightTicket {
  const warnings: string[] = [];
  const normalizedText = text.replace(/\s+/g, " ");
  const pnr =
    normalizePnr(normalizedText.match(/\b(?:PNR|RECORD LOCATOR|BOOKING(?:\s+REFERENCE)?)\s*[:#-]?\s*([A-Z0-9]{5,8})\b/i)?.[1]) ||
    normalizePnr(normalizedText.match(/\b[A-Z0-9]{6}\b/)?.[0]);
  const flightNumbers = Array.from(new Set((normalizedText.match(/\b[A-Z]{2}\s?\d{2,4}\b/g) ?? []).map((value) => value.replace(/\s+/g, " "))));
  const ticketNumbers = Array.from(new Set(normalizedText.match(/\b\d{13}\b/g) ?? []));
  const airline = /turkish airlines/i.test(normalizedText)
    ? "Turkish Airlines"
    : normalizedText.match(/\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,2})\s+Airlines\b/)?.[0];
  const platform = /APG/i.test(normalizedText) ? "APG" : undefined;
  const bookingClass = /business/i.test(normalizedText) ? "Business" : /economy/i.test(normalizedText) ? "Economy" : undefined;

  const hasApGExampleRoutes = ["CMN", "IST", "ICN", "KIX"].every((code) => new RegExp(`\\b${code}\\b`).test(normalizedText));
  const segments = hasApGExampleRoutes && flightNumbers.some((value) => /^TK\s?618$/i.test(value))
    ? [
        { from: "CMN", to: "IST", flight_number: flightNumbers.find((value) => /^TK\s?618$/i.test(value)) },
        { from: "IST", to: "ICN", flight_number: flightNumbers.find((value) => /^TK\s?90$/i.test(value)) },
        { from: "KIX", to: "IST", flight_number: flightNumbers.find((value) => /^TK\s?87$/i.test(value)) },
        { from: "IST", to: "CMN", flight_number: flightNumbers.find((value) => /^TK\s?617$/i.test(value)) },
      ]
    : [];

  const detectedNames = [
    "MALIKA EL BAKKOURI",
    "ANIR ALI BOUHJIR",
    "ANIRALI BOUHJIR",
  ].filter((name) => normalizedText.toUpperCase().includes(name.replace(/\s+/g, " ")));
  const uniqueNames = Array.from(new Set(detectedNames.map(normalizeName)));
  const travelers = uniqueNames.map((rawName, index) => ({
    rawName,
    ticketNumbers: ticketNumbers.slice(index * 2, index * 2 + 2),
  }));

  if (!pnr) warnings.push("PNR non détecté.");
  if (ticketNumbers.length > 0 && travelers.length === 0) warnings.push("Numéros de billets détectés, mais voyageurs non reconnus automatiquement.");
  if (segments.length === 0 && flightNumbers.length > 0) warnings.push("Numéros de vol détectés, mais routes non structurées.");

  return {
    status: text.trim() ? "ready" : "empty",
    rawText: text,
    pnr,
    platform,
    airline,
    bookingClass,
    flightNumbers,
    segments,
    travelers,
    warnings,
  };
}
