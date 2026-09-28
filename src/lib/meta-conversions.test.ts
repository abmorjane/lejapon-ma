import { describe, expect, it, vi } from "vitest";
import { createBookingWithMeasurement, trackSuccessfulBookingLead } from "./meta-conversions";

describe("Meta conversion deduplication", () => {
  it("uses the same unique event ID for browser and server Lead", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await trackSuccessfulBookingLead({
      bookingId: "booking-1",
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: { trip_id: "trip-1" },
    }, { trackBrowser, sendServer, createEventId: () => "lead-unique-1", isAllowed: () => true });

    expect(trackBrowser).toHaveBeenCalledWith("booking_form_submitted", { trip_id: "trip-1" }, { eventId: "lead-unique-1" });
    expect(sendServer).toHaveBeenCalledWith(expect.objectContaining({ event_name: "Lead", event_id: "lead-unique-1", booking_id: "booking-1" }));
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
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await createBookingWithMeasurement({
      createBooking: async () => "booking-2",
      eventSourceUrl: "https://www.lejapon.ma/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, createEventId: () => "lead-unique-2", isAllowed: () => true });
    await Promise.resolve();
    expect(trackBrowser).toHaveBeenCalledTimes(1);
    expect(sendServer).toHaveBeenCalledTimes(1);
  });

  it("does not call browser or server tracking outside production", async () => {
    const trackBrowser = vi.fn();
    const sendServer = vi.fn();
    await expect(trackSuccessfulBookingLead({
      bookingId: "booking-1",
      eventSourceUrl: "http://localhost:4173/reserver",
      attribution: null,
      analyticsParams: {},
    }, { trackBrowser, sendServer, isAllowed: () => false })).resolves.toBeNull();
    expect(trackBrowser).not.toHaveBeenCalled();
    expect(sendServer).not.toHaveBeenCalled();
  });

  it("generates a distinct ID for each business event", async () => {
    let sequence = 0;
    const dependencies = {
      trackBrowser: vi.fn(),
      sendServer: vi.fn(),
      createEventId: () => `lead-${++sequence}`,
      isAllowed: () => true,
    };
    await trackSuccessfulBookingLead({ bookingId: "booking-1", eventSourceUrl: "https://www.lejapon.ma/reserver", attribution: null, analyticsParams: {} }, dependencies);
    await trackSuccessfulBookingLead({ bookingId: "booking-2", eventSourceUrl: "https://www.lejapon.ma/reserver", attribution: null, analyticsParams: {} }, dependencies);
    expect(dependencies.sendServer.mock.calls.map(([event]) => event.event_id)).toEqual(["lead-1", "lead-2"]);
  });
});
