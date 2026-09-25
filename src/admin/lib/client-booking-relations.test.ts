import { describe, expect, it } from "vitest";
import { mergeClientBookingRelations } from "./client-booking-relations";

describe("mergeClientBookingRelations", () => {
  it("includes bookings linked through booking participants", () => {
    expect(mergeClientBookingRelations([], [
      { id: "booking-1", reference: "LJ-9927EE", created_at: "2026-08-12" },
    ])).toEqual([
      expect.objectContaining({ id: "booking-1", crm_relationship: "voyageur" }),
    ]);
  });

  it("deduplicates a booking and keeps the owner relationship", () => {
    const rows = mergeClientBookingRelations(
      [{ id: "booking-1", created_at: "2026-08-12" }],
      [{ id: "booking-1", created_at: "2026-08-12" }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].crm_relationship).toBe("responsable");
  });
});
