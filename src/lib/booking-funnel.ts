import type { AnalyticsParams } from "./analytics";

export type BookingFailureCategory =
  | "recaptcha_failed"
  | "validation_failed"
  | "database_failed"
  | "network_failed"
  | "unknown";

export type BookingFunnelEmitter = (name: string, params?: AnalyticsParams) => void;

export type BookingFunnel = ReturnType<typeof createBookingFunnel>;

export const createBookingFunnel = (emit: BookingFunnelEmitter) => {
  const emitted = new Set<string>();
  let checkoutStarted = false;

  const once = (key: string, name: string, params: AnalyticsParams = {}) => {
    if (emitted.has(key)) return false;
    emitted.add(key);
    emit(name, params);
    return true;
  };

  const progression = (step: 1 | 2, params: AnalyticsParams = {}) => {
    const checkoutIntent = !checkoutStarted;
    const didEmit = once(`step-${step}`, `booking_step_${step}_completed`, {
      ...params,
      step,
      checkout_intent: checkoutIntent,
    });
    if (didEmit && checkoutIntent) checkoutStarted = true;
    return didEmit;
  };

  return {
    tripSelected(params: AnalyticsParams) {
      once("form-started", "booking_form_started", { source: "trip_selection" });
      return once(`trip-${String(params.trip_id || "unknown")}`, "trip_selected", params);
    },
    stepCompleted: progression,
    contactStepViewed(params: AnalyticsParams = {}) {
      return once("contact-step", "booking_contact_step_viewed", { ...params, step: 3 });
    },
    submitAttempted(params: AnalyticsParams = {}) {
      emit("booking_submit_attempted", params);
    },
    submitFailed(errorCategory: BookingFailureCategory, params: AnalyticsParams = {}) {
      emit("booking_submit_failed", { ...params, error_category: errorCategory });
    },
  };
};

export const classifyBookingFailure = (
  error: unknown,
  stage: "recaptcha" | "validation" | "database" | "unknown",
): BookingFailureCategory => {
  if (stage === "recaptcha") return "recaptcha_failed";
  if (stage === "validation") return "validation_failed";
  if (stage === "database") {
    if (error instanceof TypeError || (error instanceof Error && /network|fetch|offline/i.test(error.message))) return "network_failed";
    return "database_failed";
  }
  return "unknown";
};
