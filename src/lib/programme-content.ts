type PlainRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is PlainRecord =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const cleanText = (value: unknown) => String(value ?? "").trim();

export const formatProgrammeContentItem = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return cleanText(value);
  if (Array.isArray(value)) return value.map(formatProgrammeContentItem).filter(Boolean).join(" · ");

  if (isRecord(value)) {
    const time = cleanText(value.time || value.hour || value.start_time);
    const title = cleanText(value.title || value.name || value.label);
    const description = cleanText(value.description || value.details || value.text);
    const city = cleanText(value.city || value.location);
    const transport = cleanText(value.transport);
    const hotel = cleanText(value.hotel);

    const headline = [time, title].filter(Boolean).join(" - ");
    const body = [description, city && `Ville: ${city}`, transport && `Transport: ${transport}`, hotel && `Hôtel: ${hotel}`]
      .filter(Boolean)
      .join(" · ");
    return [headline, body].filter(Boolean).join(" — ");
  }

  return "";
};

export const normalizeProgrammeContentList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(formatProgrammeContentItem).filter(Boolean);
  const item = formatProgrammeContentItem(value);
  return item ? [item] : [];
};

export const compactProgrammeSummary = (value: unknown, maxItems = 3) => {
  const items = normalizeProgrammeContentList(value);
  if (items.length === 0) return "À compléter";
  return items.slice(0, maxItems).join(" · ");
};
