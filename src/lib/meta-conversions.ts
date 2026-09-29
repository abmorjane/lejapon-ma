import { supabase } from "@/integrations/supabase/client";
import { attributionMetaIdentifiers, type MarketingAttribution } from "./attribution";
import { isMarketingTrackingAllowed, trackEvent, type AnalyticsParams } from "./analytics";

export type MetaServerEvent = {
  event_name: "Lead";
  event_id: string;
  booking_id: string;
  event_source_url: string;
  fbp?: string;
  fbc?: string;
};

type BookingLeadDependencies = {
  trackBrowser?: typeof trackEvent;
  sendServer?: (event: MetaServerEvent) => Promise<unknown> | void;
  isAllowed?: (path: string) => boolean;
};

export const leadEventIdForBooking = (bookingId: string) => `lead-${bookingId}`;

export const sendMetaServerEvent = async (event: MetaServerEvent) => {
  const { error } = await supabase.functions.invoke("meta-conversion", { body: event });
  if (error) throw error;
};

export const trackSuccessfulBookingLead = async (
  input: {
    bookingId: string;
    eventSourceUrl: string;
    attribution: MarketingAttribution | null;
    analyticsParams: AnalyticsParams;
  },
  dependencies: BookingLeadDependencies = {},
) => {
  const sourceUrl = new URL(input.eventSourceUrl, "https://www.lejapon.ma");
  const isAllowed = dependencies.isAllowed ?? isMarketingTrackingAllowed;
  const eventId = leadEventIdForBooking(input.bookingId);
  const trackBrowser = dependencies.trackBrowser ?? trackEvent;
  const sendServer = dependencies.sendServer ?? sendMetaServerEvent;
  const identifiers = attributionMetaIdentifiers(input.attribution);

  try {
    trackBrowser("booking_form_submitted", input.analyticsParams, { eventId });
  } catch {
    // Measurement is best-effort and must never change booking success.
  }
  // GA may receive the booking event with analytics consent even when Meta is denied.
  // trackEvent applies provider-specific consent to the browser Pixel.
  if (!isAllowed(sourceUrl.pathname)) return null;
  try {
    await sendServer({
      event_name: "Lead",
      event_id: eventId,
      booking_id: input.bookingId,
      event_source_url: sourceUrl.toString(),
      ...identifiers,
    });
  } catch {
    // The booking remains the source of truth even if Meta is unavailable.
  }
  return eventId;
};

export const createBookingWithMeasurement = async (
  input: {
    createBooking: () => Promise<string>;
    eventSourceUrl: string;
    attribution: MarketingAttribution | null;
    analyticsParams: AnalyticsParams;
  },
  dependencies: BookingLeadDependencies = {},
) => {
  const bookingId = await input.createBooking();
  void trackSuccessfulBookingLead({
    bookingId,
    eventSourceUrl: input.eventSourceUrl,
    attribution: input.attribution,
    analyticsParams: input.analyticsParams,
  }, dependencies);
  return bookingId;
};
