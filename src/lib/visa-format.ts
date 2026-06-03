export const RETIRED_NOT_APPLICABLE = "Non applicable pour un retraité";
export const PDF_NOT_APPLICABLE = "-";

export type DateParts = { d: string; m: string; y: string };

export type PreviousJapanStay = {
  hasPrevious: "yes" | "no" | "";
  lastStayDate: string;
  stayCount: string;
};

const pad2 = (value: number | string) => String(value).padStart(2, "0");

export function parseVisaDateParts(value?: string | null): DateParts | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { d: pad2(iso[3]), m: pad2(iso[2]), y: iso[1] };

  const fr = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fr) return { d: pad2(fr[1]), m: pad2(fr[2]), y: fr[3] };

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return {
    d: pad2(date.getDate()),
    m: pad2(date.getMonth() + 1),
    y: String(date.getFullYear()),
  };
}

export function formatVisaDate(value?: string | null, fallback = "") {
  const parts = parseVisaDateParts(value);
  return parts ? `${parts.d}/${parts.m}/${parts.y}` : fallback;
}

export function isRetiredVisaCategory(value?: string | null) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "retraite" || normalized === "retired" || normalized === "retraité";
}

export function cleanVisaText(value: unknown, fallback = "") {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return fallback;
  const text = String(value).trim();
  if (!text || text === "null" || text === "undefined") return fallback;
  return text;
}

export function parsePreviousJapanStay(value?: string | null): PreviousJapanStay {
  const raw = cleanVisaText(value);
  if (!raw) return { hasPrevious: "", lastStayDate: "", stayCount: "" };

  const normalized = raw
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

  if (normalized === "non" || normalized.startsWith("non\n")) {
    return { hasPrevious: "no", lastStayDate: "", stayCount: "" };
  }

  if (normalized.startsWith("oui")) {
    const lastStayDate =
      raw.match(/dernier\s+s[ée]jour\s*:?\s*([0-9]{4}-[0-9]{1,2}-[0-9]{1,2}|[0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i)?.[1] ?? "";
    const stayCount = raw.match(/nombre\s+de\s+s[ée]jours\s*:?\s*(\d+)/i)?.[1] ?? "";
    return { hasPrevious: "yes", lastStayDate, stayCount };
  }

  return { hasPrevious: "yes", lastStayDate: "", stayCount: "" };
}

export function buildPreviousJapanStayValue(stay: PreviousJapanStay) {
  if (stay.hasPrevious === "no") return "Non";
  if (stay.hasPrevious !== "yes") return "";
  const lines = ["Oui"];
  if (stay.lastStayDate) lines.push(`Dernier séjour: ${stay.lastStayDate}`);
  if (stay.stayCount) lines.push(`Nombre de séjours: ${stay.stayCount}`);
  return lines.join("\n");
}

export function formatPreviousJapanStayForDisplay(value?: string | null) {
  const stay = parsePreviousJapanStay(value);
  if (stay.hasPrevious === "no") return "Non";
  if (stay.hasPrevious !== "yes") return "";
  const lines = ["Oui"];
  if (stay.lastStayDate) lines.push(`Dernier séjour : ${formatVisaDate(stay.lastStayDate, stay.lastStayDate)}`);
  if (stay.stayCount) lines.push(`Nombre de séjours : ${stay.stayCount}`);
  return lines.join("\n");
}
