import { getBookingPricingBreakdown } from "@/lib/booking-pricing";

export const adminSupplierQuotePath = (tripId: string, quoteId?: string) =>
  `/admin/supplier-costs/${encodeURIComponent(tripId)}${quoteId ? `/${encodeURIComponent(quoteId)}` : ""}`;

export function groupSupplierQuoteVersions(quotes: any[]) {
  const groups = new Map<string, any[]>();
  for (const quote of quotes) {
    const key = `${quote.trip_id}:${quote.supplier_id ?? "unassigned"}`;
    groups.set(key, [...(groups.get(key) ?? []), quote]);
  }
  return [...groups].map(([key, versions]) => {
    versions.sort((a, b) => Number(b.version_number ?? 1) - Number(a.version_number ?? 1)
      || String(b.created_at ?? "").localeCompare(String(a.created_at ?? ""))
      || String(b.id).localeCompare(String(a.id)));
    return { key, versions, current: versions.find(version => version.status !== "archived") ?? versions[0] };
  });
}

export function supplierReviewCounts(rows: Record<string, any[]>) {
  const counts = { approved: 0, pending: 0, rejected: 0, excluded: 0 };
  for (const row of Object.values(rows).flat()) {
    if (row.included_in_total === false) counts.excluded++;
    else if (row.review_status === "approved") counts.approved++;
    else if (row.review_status === "rejected") counts.rejected++;
    else counts.pending++;
  }
  return counts;
}

export type TripRevenue =
  | { state: "available"; amountMad: number; bookingCount: number }
  | { state: "loading" | "unavailable"; amountMad: null; reason?: string };

// Committed sales, not cash collections. Reuse negotiated booking pricing,
// including stored discounts/supplements; never estimate from catalogue prices.
export function organizedTripRevenue(bookings: any[] | null, error?: unknown, expectedCount?: number | null): TripRevenue {
  if (error || !Array.isArray(bookings)) return { state: "unavailable", amountMad: null };
  if (expectedCount !== undefined && (expectedCount === null || expectedCount !== bookings.length)) return { state: "unavailable", amountMad: null, reason: "Liste des réservations incomplète ; CA non disponible." };
  let amountMad = 0;
  let bookingCount = 0;
  for (const booking of bookings) {
    if (!["confirmed", "paid", "completed", "lead", "cancelled"].includes(booking.status)) return { state: "unavailable", amountMad: null };
    if (!["confirmed", "paid", "completed"].includes(booking.status)) continue;
    const base = booking.total_amount_mad;
    if ((typeof base !== "number" && typeof base !== "string") || String(base).trim() === "" || !Number.isFinite(Number(base)) || Number(base) < 0) return { state: "unavailable", amountMad: null };
    const finalTotal = getBookingPricingBreakdown({ booking }).enteredFinalTotal;
    if (!Number.isFinite(finalTotal)) return { state: "unavailable", amountMad: null };
    amountMad += finalTotal;
    bookingCount++;
  }
  return Number.isFinite(amountMad) ? { state: "available", amountMad, bookingCount } : { state: "unavailable", amountMad: null };
}

export function supplierProfitability(revenue: TripRevenue, supplierTotalJpy: number, internalTotalJpy: number, rate: number) {
  const conversionAvailable = Number.isFinite(rate) && rate > 0;
  const known = revenue.state === "available";
  const revenueMad = known ? revenue.amountMad : null;
  const revenueJpy = known && conversionAvailable ? revenue.amountMad / rate : null;
  const supplierCostKnown = Number.isFinite(supplierTotalJpy) && supplierTotalJpy >= 0;
  const internalCostKnown = Number.isFinite(internalTotalJpy) && internalTotalJpy >= 0;
  const grossMad = known && conversionAvailable && supplierCostKnown ? revenue.amountMad - supplierTotalJpy * rate : null;
  const netMad = known && conversionAvailable && internalCostKnown ? revenue.amountMad - internalTotalJpy * rate : null;
  return { revenueMad, revenueJpy, grossMad, netMad,
    grossJpy: revenueJpy === null || !supplierCostKnown ? null : revenueJpy - supplierTotalJpy,
    netJpy: revenueJpy === null || !internalCostKnown ? null : revenueJpy - internalTotalJpy,
    marginPercent: netMad !== null && revenueMad! > 0 ? netMad / revenueMad! * 100 : null,
  };
}
