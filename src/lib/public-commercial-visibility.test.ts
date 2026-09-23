import { describe, expect, it } from "vitest";
import { commercialDateKey, isPromotionCurrentlyVisible, isTripPubliclyAvailable } from "./public-commercial-visibility";

const now = new Date("2026-09-22T12:00:00.000Z");

describe("public trip commercial visibility", () => {
  it("shows a future open trip", () => {
    expect(isTripPubliclyAvailable({ status: "open", archived_at: null, end_date: "2026-10-15" }, now)).toBe(true);
  });

  it("shows an open trip through its final day", () => {
    expect(isTripPubliclyAvailable({ status: "open", archived_at: null, end_date: "2026-09-22" }, now)).toBe(true);
  });

  it("hides a trip whose end date was yesterday", () => {
    expect(isTripPubliclyAvailable({ status: "open", archived_at: null, end_date: "2026-09-21" }, now)).toBe(false);
  });

  it("hides archived and non-open trips", () => {
    expect(isTripPubliclyAvailable({ status: "open", archived_at: "2026-09-01T10:00:00Z", end_date: "2026-10-15" }, now)).toBe(false);
    expect(isTripPubliclyAvailable({ status: "closed", archived_at: null, end_date: "2026-10-15" }, now)).toBe(false);
    expect(isTripPubliclyAvailable({ status: "completed", archived_at: null, end_date: "2026-10-15" }, now)).toBe(false);
    expect(isTripPubliclyAvailable({ status: "draft", archived_at: null, end_date: "2026-10-15" }, now)).toBe(false);
  });

  it("uses the Morocco commercial date", () => {
    expect(commercialDateKey(new Date("2026-09-21T23:30:00.000Z"))).toBe("2026-09-22");
  });
});

describe("promotion schedule visibility", () => {
  const activeTrip = { status: "open", archived_at: null, end_date: "2026-10-15" };

  it("shows an enabled promotion during its configured period", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true, active_from: "2026-09-20T00:00:00Z", expires_at: "2026-09-23T00:00:00Z" }, null, now)).toBe(true);
  });

  it("preserves the legacy enabled behavior when dates and trip are empty", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true }, null, now)).toBe(true);
  });

  it("hides an expired promotion", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true, expires_at: "2026-09-22T11:59:59Z" }, null, now)).toBe(false);
  });

  it("hides a promotion before its activation date", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true, active_from: "2026-09-22T12:00:01Z" }, null, now)).toBe(false);
  });

  it("shows a promotion linked to a commercially available trip", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true, linked_trip_id: "trip-1" }, activeTrip, now)).toBe(true);
  });

  it("hides a promotion linked to an ended trip", () => {
    expect(isPromotionCurrentlyVisible(
      { enabled: true, linked_trip_id: "trip-1" },
      { ...activeTrip, end_date: "2026-09-21" },
      now,
    )).toBe(false);
  });

  it("fails closed for an invalid configured date", () => {
    expect(isPromotionCurrentlyVisible({ enabled: true, expires_at: "invalid" }, null, now)).toBe(false);
  });
});
