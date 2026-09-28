import { describe, expect, it, vi } from "vitest";
import { classifyBookingFailure, createBookingFunnel } from "./booking-funnel";

describe("booking funnel", () => {
  it("does not count a page view as a form start and deduplicates progression", () => {
    const emit = vi.fn();
    const funnel = createBookingFunnel(emit);
    expect(emit).not.toHaveBeenCalled();

    funnel.tripSelected({ trip_id: "trip-1" });
    funnel.tripSelected({ trip_id: "trip-1" });
    funnel.stepCompleted(1, { trip_id: "trip-1" });
    funnel.stepCompleted(1, { trip_id: "trip-1" });
    funnel.stepCompleted(2, { trip_id: "trip-1" });
    funnel.stepCompleted(2, { trip_id: "trip-1" });
    funnel.contactStepViewed();
    funnel.contactStepViewed();

    expect(emit.mock.calls.map(([name]) => name)).toEqual([
      "booking_form_started",
      "trip_selected",
      "booking_step_1_completed",
      "booking_step_2_completed",
      "booking_contact_step_viewed",
    ]);
    expect(emit.mock.calls[2][1]).toMatchObject({ checkout_intent: true });
    expect(emit.mock.calls[3][1]).toMatchObject({ checkout_intent: false });
  });

  it("records every submit attempt and only allowlisted failure categories", () => {
    const emit = vi.fn();
    const funnel = createBookingFunnel(emit);
    funnel.submitAttempted({ trip_id: "trip-1" });
    funnel.submitFailed("database_failed", { trip_id: "trip-1" });
    expect(emit).toHaveBeenNthCalledWith(1, "booking_submit_attempted", { trip_id: "trip-1" });
    expect(emit).toHaveBeenNthCalledWith(2, "booking_submit_failed", { trip_id: "trip-1", error_category: "database_failed" });
  });

  it("classifies errors without exposing their raw messages", () => {
    expect(classifyBookingFailure(new Error("private details"), "recaptcha")).toBe("recaptcha_failed");
    expect(classifyBookingFailure(new TypeError("Failed to fetch"), "database")).toBe("network_failed");
    expect(classifyBookingFailure(new Error("constraint details"), "database")).toBe("database_failed");
  });
});
