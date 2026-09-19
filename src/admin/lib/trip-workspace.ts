import { organizedTripRevenue, type TripRevenue } from "./supplier-admin-review";

export const tripWorkspaceTabs = [
  "overview", "reservations", "participants", "finance", "visa",
  "flights", "hotels", "supplier", "operations", "documents",
] as const;

export type TripWorkspaceTab = typeof tripWorkspaceTabs[number];

export const tripWorkspacePath = (tripId: string, tab: TripWorkspaceTab = "overview") =>
  `/admin/trips/${encodeURIComponent(tripId)}/workspace/${tab}`;

export const normalizeTripWorkspaceTab = (value?: string): TripWorkspaceTab =>
  tripWorkspaceTabs.includes(value as TripWorkspaceTab) ? value as TripWorkspaceTab : "overview";

export const activeBookingStatuses = new Set(["confirmed", "paid", "completed"]);

export function latestSupplierQuotes(quotes: any[]) {
  const bySupplier = new Map<string, any>();
  for (const quote of quotes) {
    const key = String(quote.supplier_id ?? "unassigned");
    const current = bySupplier.get(key);
    if (!current || Number(quote.version_number ?? 1) > Number(current.version_number ?? 1)
      || (Number(quote.version_number ?? 1) === Number(current.version_number ?? 1)
        && String(quote.updated_at ?? quote.created_at ?? "") > String(current.updated_at ?? current.created_at ?? ""))) {
      bySupplier.set(key, quote);
    }
  }
  return [...bySupplier.values()];
}

export function workspaceRevenue(bookings: any[] | null, error?: unknown, expectedCount?: number | null): TripRevenue {
  return organizedTripRevenue(bookings, error, expectedCount);
}

export function workspaceInternalCostMad(quotes: any[] | null): number | null {
  if (!Array.isArray(quotes)) return null;
  const current = latestSupplierQuotes(quotes);
  if (current.length === 0) return null;
  let amount = 0;
  for (const quote of current) {
    if (quote.final_total_mad === null || quote.final_total_mad === undefined || quote.final_total_mad === "") return null;
    const value = Number(quote.final_total_mad);
    if (!Number.isFinite(value) || value < 0) return null;
    amount += value;
  }
  return amount;
}

export function workspaceSupplierCostJpy(quotes: any[] | null): number | null {
  if (!Array.isArray(quotes)) return null;
  const current = latestSupplierQuotes(quotes);
  if (current.length === 0) return null;
  let amount = 0;
  for (const quote of current) {
    if (quote.supplier_total_jpy === null || quote.supplier_total_jpy === undefined || quote.supplier_total_jpy === "") return null;
    const value = Number(quote.supplier_total_jpy);
    if (!Number.isFinite(value) || value < 0) return null;
    amount += value;
  }
  return amount;
}
