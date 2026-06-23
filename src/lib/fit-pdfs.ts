import { PDFDocument, StandardFonts, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import logoUrl from "@/assets/logo-lejapon.png";
import heroFallback from "@/assets/hero-fuji.jpg";
import kyotoFallback from "@/assets/kyoto-alley.jpg";
import shibuyaFallback from "@/assets/tokyo-shibuya.jpg";
import toriiFallback from "@/assets/torii.jpg";
import teaFallback from "@/assets/tea-ceremony.jpg";
import disneyFallback from "@/assets/exp-disneyland.jpg";
import universalFallback from "@/assets/exp-universal.jpg";
import teamlabFallback from "@/assets/exp-teamlab.jpg";

const BLACK = rgb(0.08, 0.07, 0.06);
const GREY = rgb(0.42, 0.39, 0.36);
const ORANGE = rgb(0.92, 0.34, 0.08);
const ORANGE_SOFT = rgb(1, 0.91, 0.86);
const LIGHT = rgb(0.97, 0.95, 0.92);
const PAPER = rgb(0.99, 0.985, 0.97);
const WHITE = rgb(1, 1, 1);
const BORDER = rgb(0.86, 0.82, 0.78);
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 42;

export type FitPdfBranding = {
  logoUrl?: string | null;
  agencyName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  footerText?: string | null;
  brandingMode?: "white_label" | "co_branded" | "lejapon_primary" | string | null;
  primaryColor?: string | null;
};

const brandingName = (branding?: FitPdfBranding) =>
  branding?.agencyName || (branding?.brandingMode === "white_label" ? "Votre agence" : "LeJapon.ma");

const brandingContact = (branding?: FitPdfBranding) =>
  [branding?.contactEmail || "info@lejapon.ma", branding?.contactPhone || "+212 711 449 838", branding?.website].filter(Boolean).join(" · ");

const poweredByLabel = (branding?: FitPdfBranding) => {
  if (!branding || !branding.brandingMode || branding.brandingMode === "lejapon_primary") return "LeJapon.ma / Moroccan Express Travel and Events";
  if (branding.brandingMode === "white_label") return brandingName(branding);
  return `${brandingName(branding)} · Opéré avec LeJapon.ma`;
};

const reassuranceLabel = (branding?: FitPdfBranding) =>
  branding?.brandingMode === "white_label"
    ? "La validation finale se fait toujours après confirmation avec votre conseiller."
    : "La validation finale se fait toujours après confirmation avec votre conseiller LeJapon.ma.";

const sanitizePdfText = (input: unknown) =>
  String(input ?? "")
    .replace(/\u202F|\u00A0|\u2009/g, " ")
    .replace(/\u200B/g, "")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/\u2026/g, ".")
    .replace(/[ōŌ]/g, (match) => match === "Ō" ? "O" : "o")
    .replace(/★/g, "*")
    .replace(/[^\x00-\xFF\u0152\u0153]/g, "");

const fmtMad = (value: unknown) =>
  `${new Intl.NumberFormat("fr-FR").format(Math.round(Number(value || 0)))} MAD`.replace(/\u202F|\u00A0/g, " ");

const fmtDate = (value: unknown) => {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const arrayText = (value: unknown) => {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
};

const listItems = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeTextKey = (value: unknown) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const uniqueList = (items: unknown[], max = 12) => {
  const seen = new Set<string>();
  const result: string[] = [];
  items.flatMap(listItems).forEach((item) => {
    const label = cleanPublicText(item);
    const key = normalizeTextKey(label)
      .replace(/\bbus privee?\b/g, "bus prive")
      .replace(/\bmetro jr\b/g, "metro jr")
      .replace(/\buniversal studios?(?: japan)?\b/g, "universal studios japan")
      .replace(/\bpetit dejeuner inclus\b/g, "petit dejeuner inclus");
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(label);
  });
  return result.slice(0, max);
};
const listHasSimilar = (items: string[], candidate: string) => {
  const key = normalizeTextKey(candidate);
  if (!key) return false;
  return items.some((item) => {
    const itemKey = normalizeTextKey(item);
    return itemKey === key || (key.length > 4 && itemKey.includes(key)) || (itemKey.length > 4 && key.includes(itemKey));
  });
};
const withoutSimilar = (items: string[], reference: string[]) => uniqueList(items.filter((item) => !listHasSimilar(reference, item)));

const cleanPublicText = (value: unknown) =>
  String(value ?? "")
    .replace(/\btransfer\b/gi, "transfert")
    .replace(/\b(Tokyo|Kyoto|Osaka|Nara|Hakone|Hiroshima)\s*\/\s*(Tokyo|Kyoto|Osaka|Nara|Hakone|Hiroshima)\b/gi, "$1 vers $2")
    .replace(/\bShinkansen\s*\/\s*TGV\b/gi, "Shinkansen")
    .replace(/\bShinkansen\/TGV\b/gi, "Shinkansen")
    .replace(/\bmetro\b/gi, "Métro")
    .replace(/\bmétro\s*\/?\s*jr\b/gi, "Métro / JR")
    .replace(/\bbus\s+priv[ée]e?\b/gi, "Bus privé")
    .replace(/\bbus\s+privé\b/g, "Bus privé")
    .replace(/\bmonterey\s+le\s+frere\b/gi, "Hôtel Monterey Le Frère Osaka")
    .replace(/\bd['’]osaka\b/gi, "d'Osaka")
    .replace(/\bHotel\b/g, "Hôtel")
    .replace(/\bHotels\b/g, "Hôtels")
    .replace(/\bUne\s+triple\s*\/\s*2\s+Quintuple\b/gi, "1 triple + 2 chambres quintuples")
    .replace(/\bune\s+triple\s*\/\s*2\s+quintuple\b/gi, "1 triple + 2 chambres quintuples")
    .replace(/\b(\d+)\s*Quintuple\b/gi, "$1 chambres quintuples")
    .replace(/\bbaggages?\b/gi, "bagages")
    .replace(/\bluggage\b/gi, "bagages")
    .replace(/transfert\s+bagages/gi, "envoi des bagages entre les hôtels")
    .replace(/envoies?\s+des\s+bagages\s+entres?\s+les\s+h[ôo]tels/gi, "Envoi des bagages entre les hôtels")
    .replace(/envoie\s+des\s+bagages\s+entre\s+les\s+h[ôo]tels/gi, "Envoi des bagages entre les hôtels")
    .replace(/\bTeam\s*Lab\b/g, "teamLab Planets")
    .replace(/\bdontonburi\b/gi, "Dotonbori")
    .replace(/\buniversal\s+studio\s+japan\b/gi, "Universal Studios Japan")
    .replace(/\buniversal\s+studio\b/gi, "Universal Studios Japan")
    .replace(/\buniversal\s+studios\b(?!\s+japan)/gi, "Universal Studios Japan")
    .replace(/\bsensoji\b/gi, "Senso-ji")
    .replace(/\bsensouji\b/gi, "Senso-ji")
    .replace(/temple\s+todaiji/gi, "Temple Tōdai-ji")
    .replace(/\btodaiji\b/gi, "Tōdai-ji")
    .replace(/\bville\s+de\s+nara\b/gi, "Nara")
    .replace(/\ba\s+Statue de la Liberté\b/g, "la Statue de la Liberté")
    .replace(/\bcur\b/gi, "cœur")
    .replace(/\bRythme modere\b/g, "Rythme modéré")
    .replace(/\bVsversa\b/gi, "aller-retour")
    .replace(/\bassistance\s+LeJapon\.?ma\.?/gi, "Assistance LeJapon.ma")
    .replace(/\.{3,}/g, ".")
    .trim();

const ensureFinalPunctuation = (value: string) => {
  const clean = value.replace(/\s+/g, " ").replace(/\.{2,}$/g, "").trim();
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
};

const sentenceParts = (value: unknown) =>
  cleanPublicText(value)
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

const summarizeCleanly = (value: unknown, maxWords = 82, fallback = "") => {
  const source = cleanPublicText(value) || cleanPublicText(fallback);
  if (!source) return "";
  const sentences = sentenceParts(source);
  const selected: string[] = [];
  let words = 0;
  for (const sentence of sentences.length ? sentences : [source]) {
    const count = sentence.split(/\s+/).filter(Boolean).length;
    if (selected.length && words + count > maxWords) break;
    selected.push(sentence);
    words += count;
    if (words >= 55) break;
  }
  if (selected.length) return ensureFinalPunctuation(selected.join(" "));
  return ensureFinalPunctuation(source.split(/\s+/).slice(0, maxWords).join(" "));
};

const sourceTextForDay = (day: any) => cleanPublicText([
  day?.source_description,
  day?.optimized_client_description,
  day?.description_client,
  day?.description,
  day?.sales_summary,
  day?.client_summary,
  day?.title,
].map(arrayText).filter(Boolean).join(". "));

const GENERIC_PUBLIC_KEYS = new Set([
  "prestations concretes selon descriptif du programme",
  "organisation adaptee a la journee",
  "repas selon descriptif du programme",
  "programme a confirmer avec votre conseiller",
  "programme a confirmer",
  "programme selon descriptif",
  "programme selon descriptif du programme",
  "a confirmer avec votre conseiller",
]);

const isGenericPublicText = (value: unknown) => {
  const key = normalizeTextKey(cleanPublicText(value));
  if (!key) return true;
  if (GENERIC_PUBLIC_KEYS.has(key)) return true;
  return /^(prestations?|organisation|repas|programme)\s+(selon|a confirmer)/.test(key);
};

const meaningfulList = (items: unknown[], max = 12) =>
  uniqueList(items, max).filter((item) => !isGenericPublicText(item));

const daySearchText = (day: any) => normalizeTextKey([
  day?.city,
  day?.title,
  day?.sales_summary,
  day?.client_summary,
  day?.optimized_client_description,
  day?.description_client,
  day?.description,
  day?.source_description,
  day?.visits,
  day?.included_visits,
  day?.client_highlights,
  day?.transport_type,
  day?.transport_modes,
  day?.day_pace,
  day?.rhythm,
].map(arrayText).join(" "));

const hotelCategoryLabel = (value: unknown) => {
  const label = cleanPublicText(value);
  if (!label) return "";
  const normalized = label
    .replace(/h[ôo]tel\s+(\d)\s*\/\s*(\d)\s*(?:\*|★|etoiles?|étoiles?)?/gi, "Hôtels $1*/$2*")
    .replace(/(\d)\s*(?:\*|★|etoiles?|étoiles?)/gi, "$1*");
  if (/3\*.*4\*|4\*.*3\*/.test(normalized)) return "Hôtels 3*/4*";
  return normalized;
};

const roomTypeLabel = (value: unknown) => {
  const key = normalizeTextKey(value);
  if (!key) return "";
  if (/double|twin/.test(key) && /triple/.test(key) && /quintuple/.test(key)) {
    return "chambres twin, triples et quintuple";
  }
  if (/1 triple 2 chambres quintuple/.test(key)) return "1 triple + 2 chambres quintuples";
  return cleanPublicText(value).replace(/\bdouble\b/gi, "chambre double").replace(/\btriple\b/gi, "chambre triple");
};

const durationDays = (quote: any, days: any[]) => {
  if (days.length) return days.length;
  if (!quote?.travel_start_date || !quote?.travel_end_date) return 0;
  const start = new Date(quote.travel_start_date);
  const end = new Date(quote.travel_end_date);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
};

const hasIncludedFlights = (flightLines: any[], quote?: any) =>
  flightLines.some((flight) => (flight.status || "included") === "included") ||
  /\b(vols?|billets?\s+d['’]?avion|flights?)\b.*\b(inclus|included)\b/i.test(String(quote?.inclusions ?? ""));

const flightPriceLabel = (flightLines: any[], quote?: any) =>
  hasIncludedFlights(flightLines, quote) ? "Vols internationaux inclus" : "Prix terrestre hors vols internationaux";

const filteredExclusions = (quote: any, flightLines: any[]) => {
  const items = listItems(quote.exclusions || "Dépenses personnelles\nRepas non mentionnés\nOptions non confirmées\nAssurances si non précisées");
  const filtered = hasIncludedFlights(flightLines, quote) ? items.filter((item) => !/vol|flight|billet/i.test(item)) : items;
  if (!hasIncludedFlights(flightLines, quote) && !filtered.some((item) => /vol|flight|billet/i.test(item))) {
    return ["Vols internationaux si non mentionnés comme inclus", ...filtered];
  }
  return filtered;
};

const isTokyoFreeDay = (day: any) => {
  const textValue = daySearchText(day);
  return /tokyo|shibuya|ginza|ueno|asakusa|akihabara/.test(textValue) && /libre|repos|free day|free_day|shopping/.test(textValue);
};

const isBadTokyoFallbackImage = (url: unknown, day: any) =>
  isTokyoFreeDay(day) && /panda|zoo|ueno-zoo|animal|bear/i.test(String(url ?? ""));

const fallbackImageForDay = (day: any) => {
  const textValue = daySearchText(day);
  if (/transfert|transfer|train|shinkansen|aeroport|airport|gare/.test(textValue)) return heroFallback;
  if (/libre|repos|free_day/.test(textValue)) {
    if (/kyoto|gion|arashiyama|fushimi|temple|sanctuaire|torii/.test(textValue)) return kyotoFallback;
    if (/osaka|dotonbori|namba|universal|usj/.test(textValue)) return universalFallback;
    return shibuyaFallback;
  }
  if (/disney|land/.test(textValue)) return disneyFallback;
  if (/universal|usj/.test(textValue)) return universalFallback;
  if (/team\s*lab|teamlab/.test(textValue)) return teamlabFallback;
  if (/kyoto|gion|arashiyama|fushimi|temple|sanctuaire|torii/.test(textValue)) return /fushimi|torii|sanctuaire/.test(textValue) ? toriiFallback : kyotoFallback;
  if (/osaka|dotonbori|namba/.test(textValue)) return shibuyaFallback;
  if (/nara|daim/.test(textValue)) return toriiFallback;
  if (/tokyo|shibuya|ginza|asakusa|ueno|akihabara|shopping/.test(textValue)) return shibuyaFallback;
  if (/ceremonie|the|tea|matcha/.test(textValue)) return teaFallback;
  return heroFallback;
};

const KNOWN_HIGHLIGHTS: Array<[RegExp, string]> = [
  [/fushimi\s+inari/, "Fushimi Inari"],
  [/kiyomizu(?:\s|-)?dera/, "Kiyomizu-dera"],
  [/\bgion\b/, "Gion"],
  [/arashiyama/, "Arashiyama"],
  [/senso\s?ji|sensouji/, "Senso-ji"],
  [/asakusa/, "Asakusa"],
  [/shibuya/, "Shibuya"],
  [/harajuku/, "Harajuku"],
  [/ginza/, "Ginza"],
  [/ueno/, "Ueno"],
  [/akihabara/, "Akihabara"],
  [/team\s*lab|teamlab/, "teamLab Planets"],
  [/dotonbori/, "Dotonbori"],
  [/namba/, "Namba"],
  [/universal\s+studio|usj/, "Universal Studios Japan"],
  [/disney/, "Tokyo Disneyland"],
  [/todaiji|todai\s?ji/, "Temple Tōdai-ji"],
  [/nara/, "Nara"],
  [/ch[âa]teau\s+d['’]?osaka|osaka\s+castle/, "Château d'Osaka"],
];

const extractKnownHighlights = (day: any) => {
  const source = daySearchText(day);
  return KNOWN_HIGHLIGHTS.filter(([pattern]) => pattern.test(source)).map(([, label]) => label);
};

const extractInclusionsFromSource = (day: any, visibleLines: any[]) => {
  const source = daySearchText(day);
  const lineText = visibleLines.map((line) => `${line.category || ""} ${line.label || ""}`).join(" ");
  const combined = `${source} ${normalizeTextKey(lineText)}`;
  return [
    /guide|francophone/.test(combined) ? "Guide francophone" : null,
    /shinkansen|billet train|train rapide/.test(combined) ? "Billet Shinkansen" : null,
    /transfert prive|private transfer/.test(combined) ? "Transfert privé" : null,
    /transfert bagages|bagage/.test(combined) ? "Envoi des bagages entre les hôtels" : null,
    /entree|billet|ticket|teamlab|disney|universal|temple|musee/.test(combined) ? "Entrées ou billets selon programme" : null,
    /assistance/.test(combined) ? "Assistance LeJapon.ma" : null,
  ].filter(Boolean) as string[];
};

const extractTransportFromSource = (day: any) => {
  const source = daySearchText(day);
  return [
    /shinkansen/.test(source) ? "Shinkansen" : null,
    /metro|jr/.test(source) ? "Métro / JR" : null,
    /bus prive|bus/.test(source) ? "Bus privé" : null,
    /train/.test(source) && !/shinkansen/.test(source) ? "Train" : null,
    /taxi/.test(source) ? "Taxi" : null,
    /transfert prive|private transfer/.test(source) ? "Transfert privé" : null,
    /a pied|marche|walking/.test(source) ? "À pied" : null,
    /tokyo.*kyoto|kyoto.*tokyo/.test(source) ? "Tokyo vers Kyoto" : null,
  ].filter(Boolean) as string[];
};

const extractMealsFromSource = (day: any) => {
  const source = daySearchText(day);
  return [
    /petit dejeuner inclus|breakfast/.test(source) ? "Petit-déjeuner inclus" : null,
    /dejeuner inclus/.test(source) ? "Déjeuner inclus" : null,
    /diner inclus|diner special/.test(source) ? "Dîner inclus" : null,
    /dejeuner libre/.test(source) ? "Déjeuner libre" : null,
    /diner libre/.test(source) ? "Dîner libre" : null,
    /repas libres?/.test(source) ? "Repas libres" : null,
  ].filter(Boolean) as string[];
};

const extractOptionsFromSource = (day: any) => {
  const source = daySearchText(day);
  return [
    /disney/.test(source) ? "Tokyo Disneyland" : null,
    /universal|usj/.test(source) ? "Universal Studios Japan" : null,
    /kimono/.test(source) ? "Expérience kimono" : null,
    /sushi/.test(source) ? "Atelier sushi" : null,
    /diner special|dîner spécial/.test(source) ? "Dîner spécial" : null,
  ].filter(Boolean) as string[];
};

const correctedDayTitle = (day: any) => {
  const source = daySearchText(day);
  if (/tokyo.*kyoto|kyoto.*tokyo|shinkansen.*kyoto|fushimi|kiyomizu|gion/.test(source) && /shinkansen|tokyo.*kyoto|kyoto.*tokyo/.test(source)) {
    return "Tokyo vers Kyoto en Shinkansen & premières découvertes";
  }
  return neutralizeAirportText(day?.title || "Journée au Japon", day);
};

const shortSummary = (value: unknown, maxLength = 230) => {
  const valueText = cleanPublicText(value);
  if (valueText.length <= maxLength) return valueText;
  const sentence = valueText.match(/^(.{80,}?[.!?])\s/);
  if (sentence?.[1] && sentence[1].length <= maxLength) return sentence[1];
  return summarizeCleanly(valueText, Math.max(14, Math.round(maxLength / 7)));
};

const firstWordsKey = (value: unknown, count = 8) => normalizeTextKey(cleanPublicText(value)).split(/\s+/).slice(0, count).join(" ");
const shortDescription = (summary: unknown, description: unknown) => {
  const cleanSummary = cleanPublicText(summary);
  const cleanDescription = cleanPublicText(description);
  if (!cleanDescription || cleanDescription === cleanSummary) return "";
  if (firstWordsKey(cleanSummary) && firstWordsKey(cleanSummary) === firstWordsKey(cleanDescription)) {
    const withoutFirstSentence = cleanDescription.replace(/^(.{35,}?[.!?])\s+/, "").trim();
    return shortSummary(withoutFirstSentence || cleanDescription, 260);
  }
  return shortSummary(cleanDescription, 280);
};

const neutralizeAirportText = (value: unknown, day: any) => {
  const textValue = cleanPublicText(value);
  const city = normalizeTextKey(day?.city);
  const source = daySearchText(day);
  const transferDay = /transfer|transfert|aeroport|airport|gare/.test(source);
  const mentionsTokyoAirport = /\b(Narita|Haneda)\b|a[ée]roport\s+de\s+Tokyo|Tokyo\s+(?:Narita|Haneda|airport|a[ée]roport)/i.test(textValue);
  if (transferDay && city && city !== "tokyo" && mentionsTokyoAirport && !/\b(Kansai|Itami|KIX|Osaka)\b/i.test(textValue)) {
    return "Transfert vers l'aéroport selon votre plan de vol.";
  }
  if (transferDay && /transfert\s+(a[ée]roport|airport)$/i.test(textValue)) return "Transfert vers l'aéroport selon votre plan de vol.";
  return textValue;
};

const explicitRhythmLabel = (value: unknown) => ({
  light: "Rythme léger",
  moderate: "Rythme modéré",
  intense: "Rythme soutenu",
  sustained: "Rythme soutenu",
  free_day: "Rythme libre",
  transfer: "Journée de transfert",
}[String(value || "")]);

const rhythmLabel = (value: unknown, day?: any) => {
  const explicit = explicitRhythmLabel(value);
  if (explicit && explicit !== "Rythme équilibré") return explicit;
  const source = daySearchText(day);
  if (/libre|repos|free_day|free day/.test(source)) return "Rythme libre";
  if (/arrivee|arrivée|depart|départ|aeroport|airport/.test(source) && !/visite|fushimi|kiyomizu|gion|shibuya|asakusa/.test(source)) return "Journée de transfert";
  const visitScore = [
    /fushimi/.test(source),
    /kiyomizu/.test(source),
    /gion/.test(source),
    /nara/.test(source),
    /arashiyama/.test(source),
    /teamlab/.test(source),
    /disney|universal/.test(source),
    /chateau|castle|temple|sanctuaire|visite|guide/.test(source),
  ].filter(Boolean).length;
  if (visitScore >= 3 || /journee complete|journée complète|soutenu|intense/.test(source)) return "Rythme soutenu";
  if (/tokyo|kyoto|osaka|nara|shibuya|ginza|ueno|asakusa|dotonbori|gion|urbain|shopping|ville/.test(source)) return "Rythme modéré";
  return "Rythme équilibré";
};

const hotelClientNote = (hotel: any) => {
  const note = cleanPublicText(hotel?.public_notes || "");
  const looksLikeBookingCopy = /booking|équipements?|equipements?|horaires?|services?|réception|reception|wifi|parking|buffet|check-?in|check-?out|détails?|details?/i.test(note);
  if (note && !isGenericPublicText(note) && !looksLikeBookingCopy) return shortSummary(note, 150);
  const city = cleanPublicText(hotel?.city || "la ville");
  return `Hébergement sélectionné pour son confort, son emplacement pratique à ${city} et sa cohérence avec le rythme du programme.`;
};

function buildClientInclusions(quote: any, flights: any[], days: any[], hotels: any[]) {
  const base = meaningfulList(listItems(quote?.inclusions || ""));
  const transportModes = days.flatMap((day) => [...listItems(day.transport_modes), day.transport_type].filter(Boolean)).join(" ");
  const lineText = days
    .flatMap((day) => day.cost_lines ?? [])
    .filter((line: any) => line.is_client_visible)
    .map((line: any) => `${line.category || ""} ${line.label || ""}`)
    .join(" ");
  const hotelCategory = hotelCategoryLabel(quote?.hotel_category) || "4*";
  const hotelInclusion = /^h[ôo]tels?\b/i.test(hotelCategory)
    ? `${hotelCategory} selon programme`
    : `Hôtels ${hotelCategory} selon programme`;
  const extras = [
    hasIncludedFlights(flights, quote) ? "Vols internationaux inclus" : null,
    hotels.length || quote?.hotel_category ? hotelInclusion : null,
    "Assistance avant départ",
    "Assistance pendant le voyage",
    /guide|francophone/i.test(lineText) ? "Guides francophones selon les journées indiquées" : null,
    /shinkansen|train|jr/i.test(transportModes + lineText) ? "Shinkansen / trains selon programme" : null,
    /transfer|transfert|private_transfer|airport|aeroport/i.test(transportModes + lineText) ? "Transferts privés ou assistés selon programme" : null,
    /visit|visite|activity|activite|ticket|entree/i.test(lineText) ? "Entrées et activités visibles dans le programme" : null,
    /bagage|luggage/i.test(lineText) ? "Transfert bagages selon programme" : null,
    "Support WhatsApp / conseiller LeJapon.ma",
  ].filter(Boolean) as string[];
  const result: string[] = [];
  meaningfulList([...extras, ...base]).forEach((item) => {
    if (!listHasSimilar(result, item)) result.push(item);
  });
  const hasDetailedAssistance = result.some((item) => /assistance avant|assistance pendant|support whatsapp|conseiller lejapon/i.test(normalizeTextKey(item)));
  return result.filter((item) => !(hasDetailedAssistance && normalizeTextKey(item) === "assistance lejapon ma"));
}

async function loadImage(pdf: PDFDocument, url: string) {
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

async function loadExternalImage(pdf: PDFDocument, url?: string | null) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    const buf = new Uint8Array(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("jpeg") || contentType.includes("jpg") || /\.jpe?g($|\?)/i.test(url)) return await pdf.embedJpg(buf);
    return await pdf.embedPng(buf);
  } catch {
    return null;
  }
}

function wrap(text: unknown, font: PDFFont, size: number, maxWidth: number) {
  const words = sanitizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) current = next;
    else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function text(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, size = 10, color = BLACK) {
  page.drawText(sanitizePdfText(value), { x, y, font, size, color });
}

function drawWrapped(page: PDFPage, value: unknown, x: number, y: number, width: number, font: PDFFont, size = 9, color = BLACK, lineHeight = 12, maxLines = 6) {
  const lines = wrap(value, font, size, width).slice(0, maxLines);
  lines.forEach((line, index) => text(page, line, x, y - index * lineHeight, font, size, color));
  return y - lines.length * lineHeight;
}

function drawBulletList(page: PDFPage, items: unknown[], x: number, y: number, width: number, font: PDFFont, bold: PDFFont, maxItems = 8, size = 8.5, lineHeight = 11) {
  let yy = y;
  items
    .map(cleanPublicText)
    .filter((item) => sanitizePdfText(item).trim())
    .slice(0, maxItems)
    .forEach((item) => {
      page.drawCircle({ x: x + 3, y: yy + 3, size: 2.4, color: ORANGE });
      yy = drawWrapped(page, item, x + 12, yy + 6, width - 12, font, size, BLACK, lineHeight, 2) - 4;
    });
  return yy;
}

function drawInfoCard(page: PDFPage, label: string, value: unknown, x: number, y: number, w: number, h: number, font: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x, y: y - h, width: w, height: h, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  text(page, label, x + 10, y - 18, font, 7.5, GREY);
  drawWrapped(page, value, x + 10, y - 34, w - 20, bold, 9, BLACK, 11, 2);
}

function drawLogo(page: PDFPage, logo: any, x: number, y: number, width = 92) {
  if (!logo) return;
  const ratio = logo.width / logo.height;
  const height = width / ratio;
  page.drawRectangle({ x: x - 8, y: y - height - 7, width: width + 16, height: height + 14, color: WHITE, opacity: 0.94 });
  page.drawImage(logo, { x, y: y - height, width, height });
}

function drawPill(page: PDFPage, value: unknown, x: number, y: number, font: PDFFont, bold: PDFFont, opts: { color?: any; textColor?: any; width?: number } = {}) {
  const label = sanitizePdfText(value);
  const width = opts.width ?? Math.max(72, bold.widthOfTextAtSize(label, 8) + 24);
  page.drawRectangle({ x, y: y - 21, width, height: 21, color: opts.color ?? ORANGE_SOFT, borderColor: opts.color ?? ORANGE_SOFT, borderWidth: 0.5 });
  text(page, label, x + 12, y - 14, bold, 8, opts.textColor ?? ORANGE);
  return width;
}

function drawSectionTitle(page: PDFPage, eyebrow: string, title: string, x: number, y: number, font: PDFFont, bold: PDFFont) {
  text(page, eyebrow.toUpperCase(), x, y, bold, 8, ORANGE);
  drawWrapped(page, title, x, y - 22, 500, bold, 20, BLACK, 24, 2);
}

function drawCard(page: PDFPage, x: number, y: number, w: number, h: number, title: string, items: unknown[], font: PDFFont, bold: PDFFont, opts: { maxItems?: number; empty?: string; bulletSize?: number; lineHeight?: number; titleSize?: number } = {}) {
  page.drawRectangle({ x, y: y - h, width: w, height: h, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  text(page, title, x + 12, y - 18, bold, opts.titleSize ?? 9.5, BLACK);
  const list = items.map(cleanPublicText).filter(Boolean);
  return drawBulletList(page, uniqueList(list.length ? list : [opts.empty || "À confirmer avec votre conseiller."], opts.maxItems ?? 4), x + 12, y - 38, w - 24, font, bold, opts.maxItems ?? 4, opts.bulletSize ?? 8.5, opts.lineHeight ?? 11);
}

function drawFeatureCard(page: PDFPage, title: string, body: string, x: number, y: number, w: number, h: number, font: PDFFont, bold: PDFFont) {
  page.drawRectangle({ x, y: y - h, width: w, height: h, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  page.drawRectangle({ x: x + 12, y: y - 28, width: 18, height: 18, color: ORANGE_SOFT, borderColor: ORANGE_SOFT, borderWidth: 0.5 });
  page.drawCircle({ x: x + 21, y: y - 19, size: 3, color: ORANGE });
  text(page, title, x + 40, y - 19, bold, 10.5, BLACK);
  drawWrapped(page, body, x + 40, y - 38, w - 52, font, 8.8, GREY, 11, 4);
}

function drawCoverImage(page: PDFPage, image: any, x: number, y: number, w: number, h: number) {
  if (!image) return;
  const ratio = image.width / image.height;
  const boxRatio = w / h;
  let drawW = w;
  let drawH = h;
  if (ratio > boxRatio) drawW = h * ratio;
  else drawH = w / ratio;
  page.pushOperators(pushGraphicsState(), rectangle(x, y - h, w, h), clip(), endPath());
  page.drawImage(image, { x: x - (drawW - w) / 2, y: y - h - (drawH - h) / 2, width: drawW, height: drawH });
  page.pushOperators(popGraphicsState());
}

const compactCitySequence = (days: any[]) => {
  const sequence: string[] = [];
  days.forEach((day) => {
    const candidates = cleanPublicText(day?.city || "")
      .split(/\s*(?:\/|->|vers|→)\s*/i)
      .map((item) => cleanPublicText(item))
      .filter(Boolean);
    (candidates.length ? candidates : [cleanPublicText(day?.city)]).forEach((city) => {
      if (city && sequence[sequence.length - 1] !== city) sequence.push(city);
    });
  });
  return sequence.filter((city, index) => index === 0 || city !== sequence[index - 1]);
};

function drawRoutePath(page: PDFPage, cities: string[], x: number, y: number, width: number, font: PDFFont, bold: PDFFont) {
  if (!cities.length) return drawWrapped(page, "Japon", x, y, width, bold, 16, BLACK, 20, 2);
  const maxCities = cities.slice(0, 7);
  const gap = maxCities.length > 1 ? width / (maxCities.length - 1) : 0;
  maxCities.forEach((city, index) => {
    const cx = maxCities.length === 1 ? x + width / 2 : x + index * gap;
    if (index > 0) {
      const prevX = maxCities.length === 1 ? x + width / 2 : x + (index - 1) * gap;
      page.drawLine({ start: { x: prevX + 25, y: y - 12 }, end: { x: cx - 25, y: y - 12 }, thickness: 1.2, color: ORANGE });
      page.drawCircle({ x: cx - 25, y: y - 12, size: 2.2, color: ORANGE });
    }
    page.drawCircle({ x: cx, y: y - 12, size: 6, color: ORANGE });
    drawWrapped(page, city, cx - 38, y - 32, 76, bold, 8.5, BLACK, 10, 2);
  });
  return y - 56;
}

function drawDayGallery(page: PDFPage, images: any[], topY: number, imageCount: number, simpleVisual: boolean) {
  const available = images.filter(Boolean);
  if (!available.length) return topY;
  if (imageCount >= 4 && available.length >= 4) {
    drawCoverImage(page, available[0], MARGIN, topY, 300, 210);
    drawCoverImage(page, available[1], 350, topY, 98, 101);
    drawCoverImage(page, available[2], 455, topY, 98, 101);
    drawCoverImage(page, available[3], 350, topY - 109, 203, 101);
    return topY - 240;
  }
  if (imageCount >= 2 && available.length >= 2 && !simpleVisual) {
    drawCoverImage(page, available[0], MARGIN, topY, 330, 190);
    if (available[2]) {
      drawCoverImage(page, available[1], 386, topY, 167, 90);
      drawCoverImage(page, available[2], 386, topY - 100, 167, 90);
    } else {
      drawCoverImage(page, available[1], 386, topY, 167, 190);
    }
    return topY - 220;
  }
  const imageHeight = simpleVisual ? 226 : 205;
  drawCoverImage(page, available[0], MARGIN, topY, 511, imageHeight);
  return topY - imageHeight - 32;
}

function newPage(pdf: PDFDocument) {
  const page = pdf.addPage();
  page.setSize(PAGE_W, PAGE_H);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });
  return page;
}

function header(page: PDFPage, logo: any, title: string, subtitle: string, font: PDFFont, bold: PDFFont) {
  drawLogo(page, logo, MARGIN, 804, 78);
  const titleBottom = drawWrapped(page, title, MARGIN, 754, 360, bold, 15.5, BLACK, 18, 2);
  const subtitleY = Math.min(730, titleBottom - 3);
  text(page, subtitle, MARGIN, subtitleY, font, 9, GREY);
  page.drawLine({ start: { x: MARGIN, y: subtitleY - 20 }, end: { x: PAGE_W - MARGIN, y: subtitleY - 20 }, thickness: 0.8, color: BORDER });
}

function footer(page: PDFPage, font: PDFFont, pageNumber: number, branding?: FitPdfBranding) {
  page.drawLine({ start: { x: MARGIN, y: 48 }, end: { x: PAGE_W - MARGIN, y: 48 }, thickness: 0.5, color: BORDER });
  text(page, branding?.footerText || `${poweredByLabel(branding)} · ${brandingContact(branding)}`, MARGIN, 30, font, 7.5, GREY);
  text(page, String(pageNumber), PAGE_W - MARGIN - 8, 30, font, 7.5, GREY);
}

function drawTotalBox(page: PDFPage, quote: any, font: PDFFont, bold: PDFFont, x = 42, y = 600, clientFacing = false, flightLines: any[] = []) {
  page.drawRectangle({ x, y: y - 118, width: 511, height: 118, color: LIGHT, borderColor: BORDER, borderWidth: 1 });
  text(page, "Synthèse prix", x + 16, y - 24, bold, 13, BLACK);
  const rows: Array<[string, unknown]> = clientFacing ? [
    ["Prix de vente", fmtMad(quote.total_selling_price_mad)],
    ["Nombre de voyageurs", quote.travelers_count || 1],
    ["Prix par personne", `${fmtMad(quote.price_per_person_mad)} ${hasIncludedFlights(flightLines, quote) ? "vols inclus" : "hors vols intl."}`],
    ["Validité", fmtDate(quote.valid_until)],
  ] : [
    ["Total coût", fmtMad(quote.total_cost_mad)],
    ["Prix de vente", fmtMad(quote.total_selling_price_mad)],
    ["Marge", `${fmtMad(quote.margin_amount_mad)} (${Number(quote.margin_percent || 0).toFixed(1)}%)`],
    ["Prix par personne", fmtMad(quote.price_per_person_mad)],
  ];
  rows.forEach(([label, value], index) => {
    const yy = y - 48 - index * 17;
    text(page, label, x + 16, yy, font, 9, GREY);
    text(page, value, x + 300, yy, bold, 9, index === 3 ? ORANGE : BLACK);
  });
}

export async function generateFitClientPdf({ quote, days, costLines = [], hotelLines = [], flightLines = [], branding }: { quote: any; days: any[]; costLines?: any[]; hotelLines?: any[]; flightLines?: any[]; branding?: FitPdfBranding }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadExternalImage(pdf, branding?.logoUrl || logoUrl) || await loadImage(pdf, logoUrl);
  const brandName = brandingName(branding);
  const itineraryCities = compactCitySequence(days);
  const cities = itineraryCities.length ? itineraryCities : Array.from(new Set(days.map((day) => day.city).filter(Boolean)));
  const tripDays = durationDays(quote, days);
  const firstImageUrl = days
    .flatMap((day) => listItems(day.image_urls).filter((url) => !isBadTokyoFallbackImage(url, day)))
    [0] || fallbackImageForDay(days[0] ?? {});
  const coverImage = await loadExternalImage(pdf, firstImageUrl) || await loadExternalImage(pdf, heroFallback);
  const includedFlights = hasIncludedFlights(flightLines, quote);

  let page = newPage(pdf);
  drawCoverImage(page, coverImage, 0, PAGE_H, PAGE_W, PAGE_H);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: BLACK, opacity: 0.34 });
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 310, color: BLACK, opacity: 0.26 });
  drawLogo(page, logo, MARGIN, 804, 104);
  drawPill(page, "Programme privé sur mesure", MARGIN, 690, font, bold, { color: ORANGE, textColor: WHITE, width: 172 });
  drawWrapped(page, "Votre voyage privé au Japon", MARGIN, 640, 440, bold, 34, WHITE, 39, 2);
  drawWrapped(page, `${quote.client_name || "Client FIT"} · ${quote.travelers_count || 1} voyageur(s) · ${fmtDate(quote.travel_start_date)} - ${fmtDate(quote.travel_end_date)}`, MARGIN, 558, 430, font, 12, WHITE, 16, 2);
  text(page, `Référence ${quote.quote_number || "Devis FIT"}`, MARGIN, 518, font, 10, WHITE);
  page.drawRectangle({ x: MARGIN, y: 120, width: 511, height: 160, color: WHITE, opacity: 0.94, borderColor: BORDER, borderWidth: 0.8 });
  text(page, "Proposition tarifaire", MARGIN + 18, 252, bold, 12, BLACK);
  text(page, fmtMad(quote.total_selling_price_mad), MARGIN + 18, 215, bold, 29, ORANGE);
  drawWrapped(page, `${fmtMad(quote.price_per_person_mad)} / personne · ${includedFlights ? "vols internationaux inclus" : "hors vols internationaux"}`, MARGIN + 18, 187, 300, bold, 10, BLACK, 13, 2);
  drawPill(page, flightPriceLabel(flightLines, quote), 374, 246, font, bold, { width: 156 });
  drawWrapped(page, `Validité : ${fmtDate(quote.valid_until)} · Contact : ${brandingContact(branding)}`, MARGIN + 18, 154, 470, font, 8.8, GREY, 12, 2);
  drawWrapped(page, reassuranceLabel(branding), MARGIN, 78, 500, bold, 9, WHITE, 12, 2);

  let pageNumber = 2;
  page = newPage(pdf);
  header(page, logo, "Synthèse du voyage", quote.quote_number || "Devis FIT Japon", font, bold);
  drawSectionTitle(page, "Aperçu", "Un itinéraire privé, clair et accompagné", MARGIN, 676, font, bold);
  drawInfoCard(page, "Durée", tripDays ? `${tripDays} jours` : "À confirmer", MARGIN, 605, 118, 58, font, bold);
  drawInfoCard(page, "Villes", cities.join(", ") || "À confirmer", 172, 605, 166, 58, font, bold);
  drawInfoCard(page, "Hôtels", [hotelCategoryLabel(quote.hotel_category), roomTypeLabel(quote.room_type)].filter(Boolean).join(" · ") || "À confirmer", 350, 605, 160, 58, font, bold);
  drawInfoCard(page, "Voyageurs", quote.travelers_count || 1, MARGIN, 532, 118, 58, font, bold);
  drawInfoCard(page, "Vols", flightPriceLabel(flightLines, quote), 172, 532, 166, 58, font, bold);
  drawInfoCard(page, "Assistance", "Avant et pendant le voyage", 350, 532, 160, 58, font, bold);
  text(page, "Parcours", MARGIN, 436, bold, 12, ORANGE);
  drawRoutePath(page, cities.map(cleanPublicText), MARGIN + 16, 410, 470, font, bold);
  text(page, "Mini timeline", MARGIN, 350, bold, 12, ORANGE);
  let timelineY = 322;
  const timelineDays = days.slice(0, 12);
  timelineDays.forEach((day, index) => {
    page.drawCircle({ x: MARGIN + 9, y: timelineY + 4, size: 8, color: ORANGE });
    text(page, String(index + 1), MARGIN + 6, timelineY + 1, bold, 7, WHITE);
    drawWrapped(page, `Jour ${index + 1} · ${cleanPublicText(day.city || "Japon")} · ${correctedDayTitle(day)}`, MARGIN + 28, timelineY + 8, 455, font, 9, BLACK, 11, 2);
    timelineY -= 22;
  });
  if (days.length > timelineDays.length) drawWrapped(page, `+ ${days.length - timelineDays.length} journée(s) détaillée(s) dans le programme complet`, MARGIN + 28, timelineY + 8, 455, font, 8.5, GREY, 11, 2);
  footer(page, font, pageNumber++, branding);

  page = newPage(pdf);
  header(page, logo, `Pourquoi voyager avec ${brandName}`, "Une proposition claire, accompagnée et personnalisable", font, bold);
  drawSectionTitle(page, "Notre accompagnement", "Un voyage privé construit avec méthode", MARGIN, 676, font, bold);
  const features = [
    ["Spécialiste du Japon", "Une vraie connaissance du terrain pour construire un itinéraire fluide et réaliste."],
    ["Assistance continue", "Un suivi avant départ et pendant le voyage, avec un conseiller identifié."],
    ["Voyageurs francophones", "Des programmes pensés pour les attentes des voyageurs marocains et francophones."],
    ["Expériences sélectionnées", "Des visites, activités et prestations choisies pour leur cohérence avec votre rythme."],
    ["Suivi personnalisé", "Une proposition ajustable avant validation finale avec votre conseiller."],
    ["Transparence", "Des inclusions et non-inclusions lisibles, sans mauvaise surprise sur les vols."],
  ];
  features.forEach(([title, body], index) => {
    const x = index % 2 === 0 ? MARGIN : 306;
    const y = 600 - Math.floor(index / 2) * 112;
    drawFeatureCard(page, title, body, x, y, 247, 92, font, bold);
  });
  page.drawRectangle({ x: MARGIN, y: 112, width: 511, height: 78, color: ORANGE_SOFT, borderColor: BORDER, borderWidth: 0.8 });
  text(page, "Prochaines étapes", MARGIN + 16, 166, bold, 12, ORANGE);
  drawWrapped(page, `Valider le programme · Confirmer les prestations · Préparer le départ · Bénéficier de l'assistance ${brandName} jusqu'au retour`, MARGIN + 16, 144, 470, font, 9.5, BLACK, 13, 3);
  footer(page, font, pageNumber++, branding);

  for (const day of days) {
    page = newPage(pdf);
    const dayNumber = day.day_number || Number(day.sort_order || 0) + 1;
    const displayTitle = correctedDayTitle(day);
    header(page, logo, `Jour ${dayNumber} · ${displayTitle}`, [cleanPublicText(day.city), fmtDate(day.date)].filter(Boolean).join(" · "), font, bold);
    drawPill(page, rhythmLabel(day.day_pace || day.rhythm, day), 430, 756, font, bold, { width: 123 });
    let y = 670;
    const dayPrice = Math.round(Number(day.selling_price_mad || 0) / Math.max(1, Number(quote.travelers_count || 1)));
    const isFreeDay = dayPrice <= 0 || (day.day_pace || day.rhythm) === "free_day";
    const dayImages = listItems(day.image_urls).filter((url) => !isBadTokyoFallbackImage(url, day));
    const imageUrls = dayImages.length ? dayImages : [fallbackImageForDay(day)];
    const images = await Promise.all(imageUrls.slice(0, 4).map((url) => loadExternalImage(pdf, url)));
    if (images[0]) {
      const simpleVisual = isFreeDay || imageUrls.length === 1;
      y = drawDayGallery(page, images, 682, imageUrls.length, simpleVisual);
    }
    const sourceText = sourceTextForDay(day);
    const rawSummary = summarizeCleanly(day.sales_summary || day.client_summary || sourceText || displayTitle, 24, displayTitle);
    const summaryText = isGenericPublicText(rawSummary)
      ? isFreeDay
        ? "Journée libre incluse dans votre programme, avec du temps pour explorer à votre rythme."
        : summarizeCleanly(sourceText || displayTitle, 24, displayTitle)
      : neutralizeAirportText(rawSummary, day);
    y = drawWrapped(page, summaryText, MARGIN, y, 500, bold, 11, BLACK, 14, 3);
    const rawDescription = day.optimized_client_description || day.description_client || sourceText;
    const optimizedDescription = neutralizeAirportText(
      summarizeCleanly(shortDescription(summaryText, rawDescription) || rawDescription || sourceText, 82, summaryText),
      day,
    );
    if (optimizedDescription && !isGenericPublicText(optimizedDescription)) {
      y = drawWrapped(page, optimizedDescription, MARGIN, y - 6, 500, font, 9, GREY, 12, 6);
    }
    y -= 12;
    page.drawRectangle({ x: MARGIN, y: y - 38, width: 511, height: 38, color: ORANGE_SOFT, borderColor: BORDER, borderWidth: 0.8 });
    text(page, isFreeDay ? "Journée libre incluse dans votre programme" : `Budget programme du jour : ${fmtMad(dayPrice)} / personne`, MARGIN + 14, y - 23, bold, 10.3, ORANGE);
    y -= 56;
    const highlights = meaningfulList([
      ...(listItems(day.client_highlights).length ? listItems(day.client_highlights) : listItems(day.visits ?? day.included_visits)),
      ...extractKnownHighlights(day),
    ], 5);
    const visibleLines = (day.cost_lines ?? []).filter((line: any) => line.is_client_visible);
    const rawInclusions = listItems(day.client_inclusions).length ? listItems(day.client_inclusions) : visibleLines.filter((line: any) => !line.is_optional).map((line: any) => line.label).filter(Boolean);
    const inclusions = meaningfulList(withoutSimilar([...rawInclusions, ...extractInclusionsFromSource(day, visibleLines)], highlights), 5);
    const options = meaningfulList([...listItems(day.client_options), ...visibleLines.filter((line: any) => line.is_optional).map((line: any) => line.label).filter(Boolean), ...listItems(day.optional_visits), ...extractOptionsFromSource(day)], 5);
    const transport = meaningfulList([...listItems(day.transport_modes), ...extractTransportFromSource(day)], 4);
    const meals = meaningfulList([...(listItems(day.meal_plan).length ? listItems(day.meal_plan) : [...listItems(day.meals), day.meal_notes].filter(Boolean)), ...extractMealsFromSource(day)], 4);
    const freeSuggestions = isFreeDay && !options.length ? ["Shopping ou promenade en ville", "Quartiers libres selon vos envies", "Assistance LeJapon.ma disponible"] : options;
    const blocks = [
      ["Temps forts", highlights, 4],
      ["Prestations incluses", inclusions, 4],
      ["Transport", transport, 3],
      ["Repas", meals, 3],
      ["Options possibles à confirmer avec votre conseiller", options.length || isFreeDay ? freeSuggestions : [], 4],
    ].filter(([, items]) => Array.isArray(items) && items.length) as Array<[string, string[], number]>;
    blocks.forEach(([title, items, maxItems], index) => {
      const isWide = title.startsWith("Options") && blocks.length % 2 === 1;
      const x = isWide ? MARGIN : (index % 2 === 0 ? MARGIN : 306);
      const cardY = y - Math.floor(index / 2) * 92;
      drawCard(page, x, cardY, isWide ? 511 : 247, 76, title, items, font, bold, { maxItems, bulletSize: 8.6, lineHeight: 11.2 });
    });
    footer(page, font, pageNumber++, branding);
  }

  page = newPage(pdf);
  header(page, logo, "Hôtels prévus", "Sélection indicative selon disponibilités au moment de la confirmation", font, bold);
  let hotelY = 660;
  const hotelRows = hotelLines.length ? hotelLines : [{ city: cities.join(", "), hotel_name: "Hôtels selon programme", category: quote.hotel_category, room_type: quote.room_type, nights: tripDays ? Math.max(1, tripDays - 1) : "", public_notes: "Adresses définitives confirmées avec votre conseiller." }];
  for (const hotel of hotelRows) {
    if (hotelY < 170) {
      footer(page, font, pageNumber++, branding);
      page = newPage(pdf);
      header(page, logo, "Hôtels prévus", "Suite", font, bold);
      hotelY = 660;
    }
    page.drawRectangle({ x: MARGIN, y: hotelY - 112, width: 511, height: 112, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
    const hotelImage = await loadExternalImage(pdf, hotel.image_url);
    if (hotelImage) drawCoverImage(page, hotelImage, MARGIN + 10, hotelY - 12, 118, 88);
    else page.drawRectangle({ x: MARGIN + 10, y: hotelY - 100, width: 118, height: 88, color: LIGHT, borderColor: BORDER, borderWidth: 0.5 });
    text(page, hotel.city || "Ville à confirmer", MARGIN + 146, hotelY - 24, bold, 9, ORANGE);
    text(page, cleanPublicText(hotel.hotel_name || "Hôtel à confirmer"), MARGIN + 146, hotelY - 45, bold, 13, BLACK);
    drawWrapped(page, [hotelCategoryLabel(hotel.category || quote.hotel_category), hotel.nights ? `${hotel.nights} nuit(s)` : null, roomTypeLabel(hotel.room_type || quote.room_type)].filter(Boolean).join(" · "), MARGIN + 146, hotelY - 66, 340, font, 9, GREY, 12, 2);
    drawWrapped(page, hotelClientNote(hotel), MARGIN + 146, hotelY - 90, 340, font, 8.5, BLACK, 11, 2);
    hotelY -= 132;
  }
  footer(page, font, pageNumber++, branding);

  page = newPage(pdf);
  header(page, logo, "Inclus et non inclus", flightPriceLabel(flightLines, quote), font, bold);
  drawSectionTitle(page, "Prestations", "Ce que votre proposition couvre clairement", MARGIN, 676, font, bold);
  drawCard(page, MARGIN, 606, 247, 252, "Ce qui est inclus", buildClientInclusions(quote, flightLines, days, hotelRows), font, bold, { maxItems: 10, bulletSize: 9.2, lineHeight: 12.2, titleSize: 11 });
  drawCard(page, 306, 606, 247, 252, "Ce qui n'est pas inclus", filteredExclusions(quote, flightLines), font, bold, { maxItems: 10, bulletSize: 9.2, lineHeight: 12.2, titleSize: 11 });
  page.drawRectangle({ x: MARGIN, y: 232, width: 511, height: 82, color: includedFlights ? WHITE : ORANGE_SOFT, borderColor: BORDER, borderWidth: 0.8 });
  text(page, includedFlights ? "Vols internationaux inclus" : "Prix terrestre hors vols internationaux", MARGIN + 16, 284, bold, 13, includedFlights ? BLACK : ORANGE);
  drawWrapped(page, includedFlights ? "Les vols indiqués comme inclus restent soumis aux disponibilités et conditions de la compagnie au moment de la confirmation." : "Les vols internationaux ne sont pas intégrés au prix de vente affiché dans ce devis.", MARGIN + 16, 262, 470, font, 9.4, BLACK, 12.5, 3);
  footer(page, font, pageNumber++, branding);

  page = newPage(pdf);
  header(page, logo, "Conditions de réservation et d’annulation", "Proposition sous réserve de disponibilité", font, bold);
  drawSectionTitle(page, "Avant confirmation", "Aucune réservation ferme n’est effectuée avant validation finale", MARGIN, 676, font, bold);
  page.drawRectangle({ x: MARGIN, y: 108, width: 511, height: 512, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  drawWrapped(
    page,
    quote.cancellation_conditions || "Cette proposition est établie sous réserve de disponibilité au moment de la confirmation. Aucune réservation ferme n’est effectuée avant validation finale, réception de l’acompte demandé et confirmation des prestataires.",
    MARGIN + 18,
    588,
    474,
    font,
    8.8,
    BLACK,
    11.8,
    36,
  );
  footer(page, font, pageNumber++, branding);

  page = newPage(pdf);
  header(page, logo, "Prix et conditions", quote.quote_number || "Devis", font, bold);
  drawSectionTitle(page, "Conclusion", "Votre proposition est prête à être validée avec votre conseiller", MARGIN, 676, font, bold);
  drawTotalBox(page, quote, font, bold, MARGIN, 612, true, flightLines);
  page.drawRectangle({ x: MARGIN, y: 330, width: 247, height: 128, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  text(page, "Conditions de paiement", MARGIN + 14, 434, bold, 12, ORANGE);
  drawWrapped(page, quote.payment_conditions || "Confirmation après acompte. Solde selon échéancier communiqué.", MARGIN + 14, 410, 220, font, 9.2, BLACK, 12, 6);
  page.drawRectangle({ x: 306, y: 330, width: 247, height: 128, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  text(page, "Étapes de validation", 320, 434, bold, 12, ORANGE);
  drawBulletList(page, ["Validation avec votre conseiller", "Confirmation des disponibilités", "Acompte de confirmation", "Carnet de voyage et assistance"], 320, 409, 215, font, bold, 4, 8.8, 11.8);
  page.drawRectangle({ x: MARGIN, y: 184, width: 511, height: 96, color: ORANGE_SOFT, borderColor: BORDER, borderWidth: 0.8 });
  text(page, "Valider avec votre conseiller", MARGIN + 18, 250, bold, 15, ORANGE);
  drawWrapped(page, `${reassuranceLabel(branding)} Nous vérifions les disponibilités, les conditions et les derniers ajustements avant engagement.`, MARGIN + 18, 224, 470, font, 9.5, BLACK, 13, 4);
  page.drawRectangle({ x: MARGIN, y: 108, width: 511, height: 46, color: WHITE, borderColor: BORDER, borderWidth: 0.8 });
  drawWrapped(page, `Contact conseiller : ${brandingContact(branding)}`, MARGIN + 16, 136, 470, bold, 10, BLACK, 13, 2);
  footer(page, font, pageNumber, branding);
  return await pdf.save();
}

function drawCostTable(page: PDFPage, title: string, lines: any[], y: number, font: PDFFont, bold: PDFFont) {
  text(page, title, 42, y, bold, 12, ORANGE);
  y -= 18;
  text(page, "Categorie", 48, y, bold, 7.5, GREY);
  text(page, "Contents", 120, y, bold, 7.5, GREY);
  text(page, "Price", 300, y, bold, 7.5, GREY);
  text(page, "No", 355, y, bold, 7.5, GREY);
  text(page, "Times", 395, y, bold, 7.5, GREY);
  text(page, "Subtotal", 445, y, bold, 7.5, GREY);
  y -= 12;
  lines.slice(0, 16).forEach((line) => {
    text(page, line.category || "-", 48, y, font, 7.5, BLACK);
    text(page, line.label || line.hotel_name || line.route || "-", 120, y, font, 7.5, BLACK);
    text(page, fmtMad(line.price_mad ?? line.unit_cost_mad ?? line.price_per_room_night_mad ?? line.fare_per_person_mad), 300, y, font, 7.5, BLACK);
    text(page, line.quantity ?? line.rooms_count ?? line.passengers_count ?? "-", 355, y, font, 7.5, BLACK);
    text(page, line.times ?? line.nights ?? 1, 395, y, font, 7.5, BLACK);
    text(page, fmtMad(line.subtotal_mad ?? line.total_mad), 445, y, bold, 7.5, BLACK);
    y -= 12;
  });
  return y - 8;
}

export async function generateFitInternalPdf({ quote, days, costLines = [], hotelLines = [], flightLines = [] }: { quote: any; days: any[]; costLines?: any[]; hotelLines?: any[]; flightLines?: any[] }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await loadImage(pdf, logoUrl);
  let page = newPage(pdf);
  header(page, logo, `Interne · ${quote.quote_number || "Devis FIT"}`, "Coûts, marge et notes opérationnelles", font, bold);
  drawTotalBox(page, quote, font, bold, 42, 675);
  let y = 520;
  text(page, "Ventilation", 42, y, bold, 12, ORANGE);
  const totals: Array<[string, unknown]> = [
    ["Hôtel", quote.hotel_total_mad],
    ["Vols", quote.flight_cost_mad],
    ["Transport", quote.transport_total_mad],
    ["Guide", quote.guide_total_mad],
    ["Activités", quote.activities_total_mad],
    ["Autres", quote.other_total_mad],
    ["Ajustement manuel", quote.manual_adjustment_mad],
    ["Remise", quote.discount_mad],
  ];
  totals.forEach(([label, value], index) => {
    const yy = y - 22 - index * 16;
    text(page, label, 52, yy, font, 9, GREY);
    text(page, fmtMad(value), 250, yy, bold, 9, BLACK);
  });
  y = drawCostTable(page, "Hôtels", hotelLines, 360, font, bold);
  y = drawCostTable(page, "Vols", flightLines, y, font, bold);
  drawCostTable(page, "Lignes spéciales", costLines, y, font, bold);
  footer(page, font, 1);

  let pageNumber = 2;
  for (const day of days) {
    page = newPage(pdf);
    header(page, logo, `Jour ${day.day_number || day.sort_order + 1} · ${day.title || "Journée"}`, "Notes internes", font, bold);
    let yy = 680;
    text(page, "Coût", 42, yy, bold, 10, GREY);
    text(page, fmtMad(day.cost_mad), 120, yy, bold, 10, BLACK);
    text(page, "Vente", 220, yy, bold, 10, GREY);
    text(page, fmtMad(day.selling_price_mad), 300, yy, bold, 10, BLACK);
    yy -= 30;
    text(page, "Notes opérationnelles", 42, yy, bold, 12, ORANGE);
    yy = drawWrapped(page, day.internal_notes || day.notes || "-", 42, yy - 18, 500, font, 9, BLACK, 12, 16);
    yy -= 18;
    yy = drawCostTable(page, "Table coûts journée", day.cost_lines ?? [], yy, font, bold);
    if (yy < 140) {
      footer(page, font, pageNumber++);
      page = newPage(pdf);
      header(page, logo, `Jour ${day.day_number || day.sort_order + 1} · ${day.title || "Journée"}`, "Suite coûts", font, bold);
      yy = 680;
    }
    text(page, "Transport / guide / repas", 42, yy, bold, 12, ORANGE);
    drawWrapped(page, [day.transport_type, day.guide_required ? "Guide requis" : "Sans guide", day.meal_notes].filter(Boolean).join(" · ") || "-", 42, yy - 18, 500, font, 9, BLACK, 12, 8);
    footer(page, font, pageNumber++);
  }

  return await pdf.save();
}

export function downloadFitPdf(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
