import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initAnalytics,
  isAnalyticsTrackingAllowed,
  isMarketingTrackingAllowed,
  resetAnalyticsForTests,
  sanitizePagePath,
  sanitizeAnalyticsParams,
  trackEvent,
  trackPageView,
} from "./analytics";

const productionContext = {
  hostname: "www.lejapon.ma",
  isProduction: true,
  deployEnv: "production",
  isPrerender: false,
  marketingTrackingEnabled: true,
  gaMeasurementId: "G-TEST",
  clarityProjectId: "clarity-test",
  metaPixelId: "pixel-test",
  consent: { analytics: true, marketing: true },
};

describe("marketing analytics safeguards", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    window.dataLayer = [];
    window.gtag = vi.fn();
    window.clarity = vi.fn();
    window.fbq = vi.fn();
    window.__LEJAPON_PRERENDER__ = false;
    resetAnalyticsForTests();
  });

  it("allows only production public marketing routes on canonical hosts", () => {
    expect(isMarketingTrackingAllowed("/voyages", productionContext)).toBe(true);
    expect(isMarketingTrackingAllowed("/blog/article", productionContext)).toBe(true);
    expect(isMarketingTrackingAllowed("/admin", productionContext)).toBe(false);
    expect(isMarketingTrackingAllowed("/accord-voyage/private-token", productionContext)).toBe(false);
    expect(isMarketingTrackingAllowed("/formulaire-visa/applications", productionContext)).toBe(false);
    expect(isMarketingTrackingAllowed("/voyages", { ...productionContext, hostname: "localhost" })).toBe(false);
    expect(isMarketingTrackingAllowed("/voyages", { ...productionContext, deployEnv: "preview" })).toBe(false);
    expect(isMarketingTrackingAllowed("/voyages", { ...productionContext, isProduction: false })).toBe(false);
    expect(isMarketingTrackingAllowed("/voyages", { ...productionContext, isPrerender: true })).toBe(false);
  });

  it("allows tracking when the activation flag is enabled on a public production route", () => {
    expect(isMarketingTrackingAllowed("/voyages", productionContext)).toBe(true);
  });

  it("loads no provider and emits no event when the activation flag is disabled", () => {
    window.history.replaceState({}, "", "/voyages");
    const disabledContext = { ...productionContext, marketingTrackingEnabled: false };

    expect(isMarketingTrackingAllowed("/voyages", disabledContext)).toBe(false);
    expect(trackPageView("/voyages", "Voyages", disabledContext)).toBe(false);
    expect(trackEvent("reservation_cta_clicked", { placement: "hero" }, { context: disabledContext })).toBe(false);

    expect(document.querySelector("#lejapon-ga4-script")).toBeNull();
    expect(document.querySelector("#lejapon-meta-pixel-script")).toBeNull();
    expect(document.querySelector("#lejapon-clarity-script")).toBeNull();
    expect(window.gtag).not.toHaveBeenCalled();
    expect(window.fbq).not.toHaveBeenCalled();
    expect(window.clarity).not.toHaveBeenCalled();
  });

  it("initializes each configured provider only once", () => {
    initAnalytics("/voyages", productionContext);
    initAnalytics("/programme", productionContext);
    expect(document.querySelectorAll("#lejapon-ga4-script")).toHaveLength(1);
    expect(document.querySelectorAll("#lejapon-clarity-script")).toHaveLength(1);
    expect(document.querySelectorAll("#lejapon-meta-pixel-script")).toHaveLength(1);
  });

  it("deduplicates SPA page views while keeping one GA and Meta page view", () => {
    trackPageView("/voyages", "Voyages", productionContext);
    trackPageView("/voyages", "Voyages", productionContext);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "page_view")).toHaveLength(1);
    expect(vi.mocked(window.fbq!).mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
  });

  it("counts /reserver as a page view, never as a form start", () => {
    trackPageView("/reserver", "Réserver", productionContext);
    const gaEvents = vi.mocked(window.gtag!).mock.calls
      .filter((call) => call[0] === "event")
      .map((call) => call[1]);
    expect(gaEvents).toContain("booking_page_viewed");
    expect(gaEvents).not.toContain("booking_form_started");
  });

  it("does not initialize or emit during prerender", () => {
    const context = { ...productionContext, isPrerender: true };
    expect(trackPageView("/voyages", "Voyages", context)).toBe(false);
    expect(document.querySelector("#lejapon-ga4-script")).toBeNull();
    expect(window.gtag).not.toHaveBeenCalled();
    expect(window.fbq).not.toHaveBeenCalled();
    expect(window.clarity).not.toHaveBeenCalled();
  });

  it("suspends GA, Meta and Clarity on private routes, then resumes on a public route", () => {
    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(true);
    expect(trackPageView("/admin", "Admin", productionContext)).toBe(false);

    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST"]).toBe(true);
    expect(window.fbq).toHaveBeenCalledWith("consent", "revoke");
    expect(window.clarity).toHaveBeenCalledWith("consentv2", {
      ad_Storage: "denied",
      analytics_Storage: "denied",
    });
    expect(window.clarity).toHaveBeenCalledWith("consent", false);

    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(true);
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST"]).toBe(false);
    expect(window.fbq).toHaveBeenCalledWith("consent", "grant");
    expect(window.clarity).toHaveBeenCalledWith("consentv2", {
      ad_Storage: "denied",
      analytics_Storage: "granted",
    });
    expect(window.clarity).not.toHaveBeenCalledWith("consent", true);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "page_view")).toHaveLength(2);
  });

  it("does not resume after the CMP revokes both categories", () => {
    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(true);
    const denied = { ...productionContext, consent: { analytics: false, marketing: false } };
    expect(trackPageView("/voyages", "Voyages", denied)).toBe(false);
    vi.mocked(window.fbq!).mockClear();
    vi.mocked(window.clarity!).mockClear();

    expect(trackPageView("/admin", "Admin", denied)).toBe(false);
    expect(trackPageView("/voyages", "Voyages", denied)).toBe(false);

    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST"]).toBe(true);
    expect(window.fbq).not.toHaveBeenCalledWith("consent", "grant");
    expect(window.clarity).not.toHaveBeenCalledWith("consentv2", {
      ad_Storage: "granted",
      analytics_Storage: "granted",
    });
    expect(window.clarity).not.toHaveBeenCalledWith("consent", true);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "page_view")).toHaveLength(1);
  });

  it("keeps all providers off with unknown consent even when the flag is on", () => {
    const unknown = { ...productionContext, consent: null };
    expect(trackPageView("/voyages", "Voyages", unknown)).toBe(false);
    expect(document.querySelector("#lejapon-ga4-script")).toBeNull();
    expect(document.querySelector("#lejapon-clarity-script")).toBeNull();
    expect(document.querySelector("#lejapon-meta-pixel-script")).toBeNull();
  });

  it("starts only GA and Clarity with analytics consent", () => {
    const analyticsOnly = { ...productionContext, consent: { analytics: true, marketing: false } };
    expect(isAnalyticsTrackingAllowed("/voyages", analyticsOnly)).toBe(true);
    expect(isMarketingTrackingAllowed("/voyages", analyticsOnly)).toBe(false);
    expect(trackPageView("/voyages", "Voyages", analyticsOnly)).toBe(true);
    expect(document.querySelector("#lejapon-ga4-script")).not.toBeNull();
    expect(document.querySelector("#lejapon-clarity-script")).not.toBeNull();
    expect(document.querySelector("#lejapon-meta-pixel-script")).toBeNull();
    expect(window.gtag).toHaveBeenCalledWith("consent", "default", expect.objectContaining({
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }));
    expect(window.gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({
      analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    }));
    expect(window.clarity).toHaveBeenCalledWith("consentv2", { analytics_Storage: "granted", ad_Storage: "denied" });
    expect(window.fbq).not.toHaveBeenCalledWith("track", "PageView");
  });

  it("starts only Meta with marketing consent", () => {
    const marketingOnly = { ...productionContext, consent: { analytics: false, marketing: true } };
    expect(trackPageView("/voyages", "Voyages", marketingOnly)).toBe(true);
    expect(document.querySelector("#lejapon-meta-pixel-script")).not.toBeNull();
    expect(document.querySelector("#lejapon-ga4-script")).toBeNull();
    expect(document.querySelector("#lejapon-clarity-script")).toBeNull();
    expect(window.fbq).toHaveBeenCalledWith("track", "PageView");
  });

  it("sends one current page view on late consent and resumes without double init", () => {
    const unknown = { ...productionContext, consent: null };
    const denied = { ...productionContext, consent: { analytics: false, marketing: false } };
    expect(trackPageView("/voyages", "Voyages", unknown)).toBe(false);
    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(true);
    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(false);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "page_view")).toHaveLength(1);
    expect(vi.mocked(window.fbq!).mock.calls.filter((call) => call[1] === "PageView")).toHaveLength(1);
    expect(trackPageView("/voyages", "Voyages", denied)).toBe(false);
    expect((window as unknown as Record<string, unknown>)["ga-disable-G-TEST"]).toBe(true);
    expect(window.gtag).toHaveBeenCalledWith("consent", "update", expect.objectContaining({ analytics_storage: "denied" }));
    expect(trackEvent("reservation_cta_clicked", {}, { context: denied })).toBe(false);
    expect(trackPageView("/voyages", "Voyages", productionContext)).toBe(true);
    expect(document.querySelectorAll("#lejapon-ga4-script")).toHaveLength(1);
    expect(document.querySelectorAll("#lejapon-meta-pixel-script")).toHaveLength(1);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "page_view")).toHaveLength(2);
  });

  it("removes PII and opaque click identifiers from browser analytics", () => {
    expect(sanitizeAnalyticsParams({
      trip_id: "trip-1",
      contact_email: "person@example.com",
      phone: "+212600000000",
      full_name: "Private Person",
      notes: "private",
      oppref: "opaque-secret-reference",
      click_id: "opaque-click",
    })).toEqual({ trip_id: "trip-1" });
    expect(sanitizePagePath("/reserver?utm_source=chatgpt&oppref=opaque%2Fsecret&email=private@example.com"))
      .toBe("/reserver?utm_source=chatgpt");
  });

  it("maps successful bookings to one Meta Lead with its event ID", () => {
    window.history.replaceState({}, "", "/reserver");
    trackEvent("booking_form_submitted", {
      trip_id: "trip-1",
      email: "private@example.com",
    }, { eventId: "lead-1", context: productionContext });
    expect(window.fbq).toHaveBeenCalledWith("track", "Lead", { trip_id: "trip-1" }, { eventID: "lead-1" });
  });

  it("maps only intentional booking progression to Meta InitiateCheckout", () => {
    window.history.replaceState({}, "", "/reserver");
    trackEvent("booking_step_1_completed", { trip_id: "trip-1", checkout_intent: true }, { context: productionContext });
    trackEvent("booking_step_2_completed", { trip_id: "trip-1", checkout_intent: false }, { context: productionContext });
    expect(vi.mocked(window.fbq!).mock.calls.filter((call) => call[1] === "InitiateCheckout")).toHaveLength(1);
    expect(vi.mocked(window.fbq!).mock.calls.filter((call) => call[1] === "Purchase")).toHaveLength(0);
  });

  it("emits an idempotent event only once", () => {
    window.history.replaceState({}, "", "/reserver");
    expect(trackEvent("booking_contact_step_viewed", { step: 3 }, { onceKey: "contact", context: productionContext })).toBe(true);
    expect(trackEvent("booking_contact_step_viewed", { step: 3 }, { onceKey: "contact", context: productionContext })).toBe(false);
    expect(vi.mocked(window.gtag!).mock.calls.filter((call) => call[1] === "booking_contact_step_viewed")).toHaveLength(1);
  });
});
