import { describe, expect, it } from "vitest";
import { adminSupplierQuotePath, groupSupplierQuoteVersions, organizedTripRevenue, supplierProfitability, supplierReviewCounts } from "./supplier-admin-review";

describe("supplier admin dossiers", () => {
  it("groups by trip and supplier, preserves every version and ignores historical update order", () => {
    const quotes = [
      { id: "a1", trip_id: "trip", supplier_id: "a", version_number: 1, status: "archived", updated_at: "2099" },
      { id: "a5", trip_id: "trip", supplier_id: "a", version_number: 5, status: "submitted" },
      { id: "a4", trip_id: "trip", supplier_id: "a", version_number: 4, status: "approved" },
      { id: "b1", trip_id: "trip", supplier_id: "b", version_number: 1, status: "draft" },
      { id: "other", trip_id: "other-trip", supplier_id: "a", version_number: 1, status: "draft" },
    ];
    const original = structuredClone(quotes);
    const groups = groupSupplierQuoteVersions(quotes);
    expect(groups).toHaveLength(3);
    expect(groups[0].current.id).toBe("a5");
    expect(groups[0].versions.map(quote => quote.id)).toEqual(["a5", "a4", "a1"]);
    expect(groups.flatMap(group => group.versions)).toHaveLength(quotes.length);
    expect(quotes).toEqual(original);
    expect(adminSupplierQuotePath("trip", "a4")).toBe("/admin/supplier-costs/trip/a4");
  });
  it("keeps an entirely superseded dossier readable", () => {
    expect(groupSupplierQuoteVersions([{ id: "old", trip_id: "trip", supplier_id: "a", status: "archived", version_number: 3 }])[0].current.id).toBe("old");
  });
  it("counts included decisions separately from exclusions; missing decisions require review", () => {
    expect(supplierReviewCounts({ hotels: [{ review_status: "approved" }, {}], other: [{ review_status: "rejected" }, { review_status: "pending", included_in_total: false }, { review_status: "approved", included_in_total: false }] })).toEqual({ approved: 1, pending: 1, rejected: 1, excluded: 2 });
  });
});

describe("organized-trip committed revenue", () => {
  it("reuses negotiated booking totals and adjustments, excluding leads/cancellations and cash payments", () => {
    const revenue = organizedTripRevenue([
      { status: "confirmed", total_amount_mad: 10000, paid_amount_mad: 1, metadata: { quote_adjustments: [{ id: "discount", label: "Negotiated", type: "discount", calculation_type: "percentage", amount: 10 }, { id: "supplement", label: "Extra", type: "supplement", calculation_type: "fixed_amount", amount: 200 }] } },
      { status: "paid", total_amount_mad: "5000" }, { status: "completed", total_amount_mad: 2000 },
      { status: "lead", total_amount_mad: 999999 }, { status: "cancelled", total_amount_mad: 999999 },
    ]);
    expect(revenue).toEqual({ state: "available", amountMad: 16200, bookingCount: 3 });
  });
  it("includes legacy negotiated discounts", () => {
    expect(organizedTripRevenue([{ status: "confirmed", total_amount_mad: 1000, quote_discount: { label: "Discount", type: "fixed_amount", amount: 100 } }])).toMatchObject({ state: "available", amountMad: 900 });
  });
  it.each([null, undefined, "", "bad", -1])("does not turn an unavailable committed amount %s into zero", amount => {
    expect(organizedTripRevenue([{ status: "confirmed", total_amount_mad: amount }])).toMatchObject({ state: "unavailable", amountMad: null });
  });
  it("distinguishes an empty successful result and a real zero from a query error", () => {
    expect(organizedTripRevenue([])).toMatchObject({ state: "available", amountMad: 0 });
    expect(organizedTripRevenue([{ status: "confirmed", total_amount_mad: 0 }])).toMatchObject({ state: "available", amountMad: 0 });
    expect(organizedTripRevenue([], { code: "42501" })).toMatchObject({ state: "unavailable", amountMad: null });
    expect(organizedTripRevenue(null)).toMatchObject({ state: "unavailable", amountMad: null });
    expect(organizedTripRevenue([{ status: "unrecognized", total_amount_mad: 100 }])).toMatchObject({ state: "unavailable" });
  });
  it("does not publish partial revenue when PostgREST truncates the bookings response", () => {
    expect(organizedTripRevenue([{ status: "confirmed", total_amount_mad: 100 }], null, 2)).toMatchObject({ state: "unavailable", amountMad: null });
    expect(organizedTripRevenue([], null, null)).toMatchObject({ state: "unavailable" });
    expect(organizedTripRevenue([], null, 0)).toMatchObject({ state: "available", amountMad: 0 });
  });
  it("calculates known margins while leaving unknown profitability unavailable", () => {
    const known = supplierProfitability({ state: "available", amountMad: 20000, bookingCount: 1 }, 100000, 110000, 0.1);
    expect(known).toMatchObject({ revenueJpy: 200000, grossMad: 10000, grossJpy: 100000, netMad: 9000, netJpy: 90000, marginPercent: 45 });
    expect(supplierProfitability({ state: "unavailable", amountMad: null }, 100000, 110000, 0.1)).toEqual({ revenueMad: null, revenueJpy: null, grossMad: null, grossJpy: null, netMad: null, netJpy: null, marginPercent: null });
    expect(supplierProfitability({ state: "available", amountMad: 0, bookingCount: 0 }, 100000, 110000, 0.1)).toMatchObject({ grossMad: -10000, netMad: -11000, marginPercent: null });
  });
  it("does not invent a conversion or profit when exchange rate/costs are unavailable", () => {
    expect(supplierProfitability({ state: "available", amountMad: 100, bookingCount: 1 }, 1000, 1100, 0)).toMatchObject({ revenueMad: 100, revenueJpy: null, netMad: null });
    expect(supplierProfitability({ state: "available", amountMad: 100, bookingCount: 1 }, NaN, NaN, 0.1)).toMatchObject({ revenueJpy: 1000, grossMad: null, netMad: null });
  });
});
