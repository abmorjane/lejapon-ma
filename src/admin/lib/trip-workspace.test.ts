import { describe, expect, it } from "vitest";
import {
  latestSupplierQuotes, normalizeTripWorkspaceTab, tripWorkspacePath,
  workspaceInternalCostMad, workspaceRevenue, workspaceSupplierCostJpy,
} from "./trip-workspace";

describe("trip workspace routing and financial summaries", () => {
  it("builds refresh-safe tab routes and rejects unknown tabs", () => {
    expect(tripWorkspacePath("trip/a", "visa")).toBe("/admin/trips/trip%2Fa/workspace/visa");
    expect(normalizeTripWorkspaceTab("documents")).toBe("documents");
    expect(normalizeTripWorkspaceTab("unknown")).toBe("overview");
  });

  it("selects one latest version per trip supplier without merging history", () => {
    const quotes = [
      { id: "a1", supplier_id: "a", version_number: 1 },
      { id: "a3", supplier_id: "a", version_number: 3 },
      { id: "b2", supplier_id: "b", version_number: 2 },
    ];
    expect(latestSupplierQuotes(quotes).map(quote => quote.id)).toEqual(["a3", "b2"]);
  });

  it("uses the existing canonical committed-revenue calculation", () => {
    expect(workspaceRevenue([
      { status: "confirmed", total_amount_mad: 1000, metadata: { quote_adjustments: [] } },
      { status: "lead", total_amount_mad: 9000 },
      { status: "cancelled", total_amount_mad: 8000 },
    ], undefined, 3)).toMatchObject({ state: "available", amountMad: 1000, bookingCount: 1 });
  });

  it("keeps unavailable revenue distinct from legitimate zero", () => {
    expect(workspaceRevenue(null)).toMatchObject({ state: "unavailable", amountMad: null });
    expect(workspaceRevenue([], undefined, 0)).toMatchObject({ state: "available", amountMad: 0 });
    expect(workspaceRevenue([], undefined, null)).toMatchObject({ state: "unavailable", amountMad: null });
  });

  it("does not turn missing supplier totals into zero or double-count historical versions", () => {
    expect(workspaceSupplierCostJpy([{ supplier_id: "a", version_number: 1, supplier_total_jpy: 10 }, { supplier_id: "a", version_number: 2, supplier_total_jpy: 25 }])).toBe(25);
    expect(workspaceInternalCostMad([{ supplier_id: "a", version_number: 2, final_total_mad: null }])).toBeNull();
    expect(workspaceSupplierCostJpy([])).toBeNull();
  });
});
