import { describe, expect, it, vi } from "vitest";
import { createBookingWithMeasurement, leadEventIdForBooking, trackSuccessfulBookingLead } from "./meta-conversions";

describe("Meta conversion deduplication", () => {
  it("uses the same deterministic booking event ID for browser and server Lead", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await trackSuccessfulBookingLead({
      bookingId: "booking-1",
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: { trip_id: "trip-1" },
    }, { trackBrowser, sendServer, isAllowed: () => true });

    expect(trackBrowser).toHaveBeenCalledWith("booking_form_submitted", { trip_id: "trip-1" }, { eventId: "lead-booking-1" });
    expect(sendServer).toHaveBeenCalledWith(expect.objectContaining({ event_name: "Lead", event_id: "lead-booking-1", booking_id: "booking-1" }));
  });

  it("does not throw when browser or server measurement fails", async () => {
    await expect(trackSuccessfulBookingLead({
      bookingId: "booking-1",
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: {},
    }, {
      trackBrowser: () => { throw new Error("pixel unavailable"); },
      sendServer: async () => { throw new Error("capi unavailable"); },
      isAllowed: () => true,
    })).resolves.toMatch(/^lead-/);
  });

  it("emits no Lead when booking creation fails", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await expect(createBookingWithMeasurement({
      createBooking: async () => { throw new Error("database failed"); },
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, isAllowed: () => true })).rejects.toThrow("database failed");
    expect(trackBrowser).not.toHaveBeenCalled();
    expect(sendServer).not.toHaveBeenCalled();
  });

  it("emits browser and server Lead only after booking creation succeeds", async () => {
    const order: string[] = [];
    const trackBrowser = vi.fn(() => { order.push("browser"); return true; });
    const sendServer = vi.fn(() => { order.push("server"); });
    await createBookingWithMeasurement({
      createBooking: async () => {
        order.push("booking");
        return "booking-2";
      },
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, isAllowed: () => true });
    await Promise.resolve();
    expect(trackBrowser.mock.invocationCallOrder[0]).toBeGreaterThan(0);
    expect(trackBrowser).toHaveBeenCalledTimes(1);
    expect(sendServer).toHaveBeenCalledTimes(1);
    expect(trackBrowser).toHaveBeenCalledWith("booking_form_submitted", {}, { eventId: "lead-booking-2" });
    expect(sendServer).toHaveBeenCalledWith(expect.objectContaining({ event_id: "lead-booking-2" }));
    expect(order).toEqual(["booking", "browser", "server"]);
  });

  it("still invokes the consent-gated browser emitter but never CAPI outside production", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await expect(trackSuccessfulBookingLead({
      bookingId: "booking-1",
      eventSourceUrl: "http://localhost:4173/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, isAllowed: () => false })).resolves.toBeNull();
    expect(trackBrowser).toHaveBeenCalledWith("booking_form_submitted", {}, { eventId: "lead-booking-1" });
    expect(sendServer).not.toHaveBeenCalled();
  });

  it("keeps booking successful and CAPI silent when marketing is denied", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    const id = await createBookingWithMeasurement({
      createBooking: async () => "booking-denied",
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, isAllowed: () => false });
    await Promise.resolve();
    expect(id).toBe("booking-denied");
    expect(trackBrowser).toHaveBeenCalledTimes(1);
    expect(sendServer).not.toHaveBeenCalled();
  });

  it("derives a stable, distinct ID from each booking ID", async () => {
    const dependencies = {
      trackBrowser: vi.fn(),
      sendServer: vi.fn(),
      isAllowed: () => true,
    };
    await trackSuccessfulBookingLead({ bookingId: "booking-1", eventSourceUrl: "https://www.lejapon.ma/reserver", attribution: null, analyticsParams: {} }, dependencies);
    await trackSuccessfulBookingLead({ bookingId: "booking-2", eventSourceUrl: "https://www.lejapon.ma/reserver", attribution: null, analyticsParams: {} }, dependencies);
    expect(dependencies.sendServer.mock.calls.map(([event]) => event.event_id)).toEqual(["lead-booking-1", "lead-booking-2"]);
    expect(leadEventIdForBooking("booking-1")).toBe("lead-booking-1");
  });
});
