import { describe, expect, it } from "vitest";
import { isLinkedToArchivedTrip, isTripArchived, tripsForArchiveView } from "./trip-archiving";

describe("trip archiving helpers", () => {
  const trips = [
    { id: "active", archived_at: null, status: "completed" },
    { id: "archived", archived_at: "2026-09-12T10:00:00Z", status: "completed" },
  ];

  it("keeps archive state independent from the business status", () => {
    expect(isTripArchived(trips[0])).toBe(false);
    expect(isTripArchived(trips[1])).toBe(true);
    expect(trips[0].status).toBe(trips[1].status);
  });

  it("separates active and archived lists without mutating source rows", () => {
    expect(tripsForArchiveView(trips, "active").map((trip) => trip.id)).toEqual(["active"]);
    expect(tripsForArchiveView(trips, "archived").map((trip) => trip.id)).toEqual(["archived"]);
    expect(trips).toHaveLength(2);
  });

  it("detects archived nested relations used by operational counters", () => {
    expect(isLinkedToArchivedTrip({ archived_at: "2026-09-12T10:00:00Z" })).toBe(true);
    expect(isLinkedToArchivedTrip({ archived_at: null })).toBe(false);
    expect(isLinkedToArchivedTrip(null)).toBe(false);
  });
});
