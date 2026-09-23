export const COMMERCIAL_TIME_ZONE = "Africa/Casablanca";

export type PublicTripAvailability = {
  archived_at?: string | null;
  end_date?: string | null;
  status?: string | null;
};

export type PromotionSchedule = {
  enabled?: boolean | null;
  active_from?: string | null;
  expires_at?: string | null;
  linked_trip_id?: string | null;
};

export function commercialDateKey(
  now: Date = new Date(),
  timeZone = COMMERCIAL_TIME_ZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function isTripPubliclyAvailable(
  trip: PublicTripAvailability | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!trip || trip.archived_at || trip.status !== "open" || !trip.end_date) return false;
  return trip.end_date >= commercialDateKey(now);
}

function parseConfiguredTimestamp(value: string | null | undefined): number | null {
  if (!value?.trim()) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

export function isPromotionCurrentlyVisible(
  promotion: PromotionSchedule,
  linkedTrip: PublicTripAvailability | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!promotion.enabled) return false;

  const nowTimestamp = now.getTime();
  const activeFrom = parseConfiguredTimestamp(promotion.active_from);
  const expiresAt = parseConfiguredTimestamp(promotion.expires_at);

  if (Number.isNaN(activeFrom) || Number.isNaN(expiresAt)) return false;
  if (activeFrom !== null && activeFrom > nowTimestamp) return false;
  if (expiresAt !== null && expiresAt < nowTimestamp) return false;

  if (promotion.linked_trip_id?.trim()) {
    return isTripPubliclyAvailable(linkedTrip, now);
  }

  return true;
}
