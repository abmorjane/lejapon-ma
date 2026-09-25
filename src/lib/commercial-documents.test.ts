import { describe, expect, it } from "vitest";
import { calculateCommercialDocumentTotals } from "./commercial-documents";

const extras = [
  { name_snapshot: "Tokyo Teamlab Planet", qty: 2, unit_price_mad: 350 },
  { name_snapshot: "Cérémonie de thé", qty: 2, unit_price_mad: 500 },
  { name_snapshot: "Carte SIM", qty: 1, unit_price_mad: 700 },
];

const discount = [{
  id: "discount-1",
  label: "Carte SIM offerte",
  type: "discount" as const,
  calculation_type: "fixed_amount" as const,
  amount: 800,
  visible_on_quote: true,
}];

describe("calculateCommercialDocumentTotals", () => {
  it("uses the explicit trip unit price, then adds extras and the discount", () => {
    const totals = calculateCommercialDocumentTotals({
      booking: {
        num_adults: 2,
        num_children: 0,
        total_amount_mad: 116_400,
        paid_amount_mad: 40_000,
        metadata: { trip_unit_price_per_person_mad: 58_200 },
      },
      extras,
      quoteAdjustments: discount,
      payments: [{ amount_mad: 40_000, status: "received" }],
    });

    expect(totals.tripTotal).toBe(116_400);
    expect(totals.extrasTotal).toBe(2_400);
    expect(totals.totalTTC).toBe(118_000);
    expect(totals.paidAmount).toBe(40_000);
    expect(totals.remainingAmount).toBe(78_000);
  });

  it("derives the historical trip portion before re-adding stored extras", () => {
    const totals = calculateCommercialDocumentTotals({
      booking: {
        num_adults: 2,
        num_children: 0,
        total_amount_mad: 118_800,
        paid_amount_mad: 0,
        metadata: {},
      },
      trip: { base_price_mad: 60_000 },
      extras,
      quoteAdjustments: [],
    });

    expect(totals.tripUnitPrice).toBe(58_200);
    expect(totals.tripTotal).toBe(116_400);
    expect(totals.totalTTC).toBe(118_800);
  });
});
