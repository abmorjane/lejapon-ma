import { afterEach, describe, expect, it, vi } from "vitest";
import {
  handleMetaConversionRequest,
  META_LEAD_MAX_AGE_MS,
  type MetaConversionDependencies,
  type MetaLeadBooking,
} from "./handler";

const bookingId = "f3630d7f-d83b-4f26-a010-91915be0f8c6";
const now = Date.parse("2026-09-28T12:00:00.000Z");
const booking: MetaLeadBooking = {
  id: bookingId,
  created_at: new Date(now - 60_000).toISOString(),
  source: "website",
  status: "lead",
  contact_email: "private@example.com",
  contact_phone: "+212600000000",
  measurement_consent: { version: 1, analytics: false, marketing: true, captured_at: "2026-09-28T11:59:00.000Z" },
};

const request = (overrides: Record<string, unknown> = {}, origin = "https://www.lejapon.ma") => new Request(
  "https://project.supabase.co/functions/v1/meta-conversion",
  {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      event_name: "Lead",
      event_id: `lead-${bookingId}`,
      booking_id: bookingId,
      event_source_url: "https://www.lejapon.ma/reserver?utm_source=test",
      ...overrides,
    }),
  },
);

const dependencies = (bookingResult: MetaLeadBooking | null = booking): MetaConversionDependencies => ({
  loadBooking: vi.fn().mockResolvedValue(bookingResult),
  deliverLead: vi.fn().mockResolvedValue(undefined),
  now: () => now,
});

const json = (response: Response) => response.json() as Promise<{ ok: boolean; error?: string; event_id?: string }>;

describe("Meta conversion Lead policy", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a valid recent website Lead and strips query parameters from its source URL", async () => {
    const deps = dependencies();
    const response = await handleMetaConversionRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ ok: true, event_id: `lead-${bookingId}` });
    expect(deps.deliverLead).toHaveBeenCalledWith(expect.objectContaining({
      booking,
      sourceUrl: "https://www.lejapon.ma/reserver",
    }));
  });

  it("refuses Purchase in the public V1 endpoint", async () => {
    const deps = dependencies();
    const response = await handleMetaConversionRequest(request({ event_name: "Purchase" }), deps);
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ ok: false, error: "event_not_allowed" });
    expect(deps.loadBooking).not.toHaveBeenCalled();
  });

  it("refuses a Lead when the booking snapshot is absent or denies marketing", async () => {
    for (const measurement_consent of [null, { version: 1, analytics: true, marketing: false }]) {
      const deps = dependencies({ ...booking, measurement_consent });
      const result = await handleMetaConversionRequest(request(), deps);
      expect(result.status).toBe(403);
      expect(await json(result)).toEqual({ ok: false, error: "marketing_consent_required" });
      expect(deps.deliverLead).not.toHaveBeenCalled();
    }
  });

  it("refuses a booking that does not exist", async () => {
    const deps = dependencies(null);
    const response = await handleMetaConversionRequest(request(), deps);
    expect(response.status).toBe(404);
    expect(await json(response)).toEqual({ ok: false, error: "booking_not_found" });
    expect(deps.deliverLead).not.toHaveBeenCalled();
  });

  it("refuses an event ID that is not derived from the booking ID", async () => {
    const deps = dependencies();
    const response = await handleMetaConversionRequest(request({ event_id: "lead-arbitrary-id" }), deps);
    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ ok: false, error: "invalid_event_id" });
    expect(deps.deliverLead).not.toHaveBeenCalled();
  });

  it("refuses a booking older than the 24-hour browser Lead window", async () => {
    const deps = dependencies({
      ...booking,
      created_at: new Date(now - META_LEAD_MAX_AGE_MS - 1).toISOString(),
    });
    const response = await handleMetaConversionRequest(request(), deps);
    expect(response.status).toBe(409);
    expect(await json(response)).toEqual({ ok: false, error: "booking_not_recent" });
    expect(deps.deliverLead).not.toHaveBeenCalled();
  });

  it("refuses a booking whose populated source is not the public website", async () => {
    const deps = dependencies({ ...booking, source: "admin" });
    const response = await handleMetaConversionRequest(request(), deps);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ ok: false, error: "booking_source_not_allowed" });
    expect(deps.deliverLead).not.toHaveBeenCalled();
  });

  it("refuses a foreign browser Origin before reading the booking", async () => {
    const deps = dependencies();
    const response = await handleMetaConversionRequest(request({}, "https://attacker.example"), deps);
    expect(response.status).toBe(403);
    expect(await json(response)).toEqual({ ok: false, error: "origin_not_allowed" });
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(deps.loadBooking).not.toHaveBeenCalled();
  });

  it("supports CORS preflight without reading a booking", async () => {
    const deps = dependencies();
    const response = await handleMetaConversionRequest(new Request(
      "https://project.supabase.co/functions/v1/meta-conversion",
      { method: "OPTIONS", headers: { Origin: "https://lejapon.ma" } },
    ), deps);
    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://lejapon.ma");
    expect(deps.loadBooking).not.toHaveBeenCalled();
  });

  it("does not log booking PII when delivery fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const deps = dependencies();
    deps.deliverLead = vi.fn().mockRejectedValue(new Error("provider unavailable"));

    const response = await handleMetaConversionRequest(request(), deps);
    expect(response.status).toBe(502);
    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });
});
