import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptAll, clearConsent, CONSENT_STORAGE_KEY, consentSnapshotForBooking,
  getConsent, hasAnalyticsConsent, hasMarketingConsent, rejectAll,
  setConsent, subscribeConsentChanges,
} from "./consent";

describe("CMP V1 storage and fail-closed behavior", () => {
  beforeEach(() => { localStorage.clear(); clearConsent(); });
  afterEach(() => vi.restoreAllMocks());

  it("starts unknown and grants no category", () => {
    expect(getConsent()).toEqual({ status: "unknown", preferences: null });
    expect(hasAnalyticsConsent()).toBe(false);
    expect(hasMarketingConsent()).toBe(false);
  });

  it("persists only the four allowed non-PII fields", () => {
    const state = acceptAll();
    expect(state.status).toBe("granted");
    expect(hasAnalyticsConsent()).toBe(true);
    expect(hasMarketingConsent()).toBe(true);
    expect(Object.keys(JSON.parse(localStorage.getItem(CONSENT_STORAGE_KEY)!)).sort())
      .toEqual(["analytics", "marketing", "updated_at", "version"]);
    expect(JSON.stringify(consentSnapshotForBooking())).not.toMatch(/email|phone|name|oppref|click_id/);
  });

  it("supports independent categories and an explicit all-denied choice", () => {
    setConsent({ analytics: true, marketing: false });
    expect(hasAnalyticsConsent()).toBe(true);
    expect(hasMarketingConsent()).toBe(false);
    setConsent({ analytics: false, marketing: true });
    expect(hasAnalyticsConsent()).toBe(false);
    expect(hasMarketingConsent()).toBe(true);
    expect(rejectAll().status).toBe("denied");
    expect(hasAnalyticsConsent()).toBe(false);
    expect(hasMarketingConsent()).toBe(false);
  });

  it("treats corrupt, extra-key and old-version values as unknown", () => {
    for (const value of ["{broken", JSON.stringify({ version: 0, analytics: true, marketing: true, updated_at: new Date().toISOString() }),
      JSON.stringify({ version: 1, analytics: true, marketing: true, updated_at: new Date().toISOString(), email: "private" })]) {
      localStorage.setItem(CONSENT_STORAGE_KEY, value);
      expect(getConsent().status).toBe("unknown");
      expect(hasMarketingConsent()).toBe(false);
    }
  });

  it("fails closed when localStorage reads or writes are blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(getConsent().status).toBe("unknown");
    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(acceptAll().status).toBe("unknown");
    expect(hasMarketingConsent()).toBe(false);
  });

  it("notifies changes, and clearing returns to unknown", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeConsentChanges(listener);
    rejectAll();
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ status: "denied" }));
    clearConsent();
    expect(listener).toHaveBeenLastCalledWith({ status: "unknown", preferences: null });
    unsubscribe();
  });

  it("snapshots unknown as false/false at booking time", () => {
    expect(consentSnapshotForBooking()).toEqual({
      version: 1, analytics: false, marketing: false, captured_at: expect.any(String),
    });
  });
});
