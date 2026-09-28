import { supabase } from "@/integrations/supabase/client";
import { attributionMetaIdentifiers, type MarketingAttribution } from "./attribution";
import { createMarketingEventId, isMarketingTrackingAllowed, trackEvent, type AnalyticsParams } from "./analytics";

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
  createEventId?: () => string;
  isAllowed?: (path: string) => boolean;
};

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
    eventId?: string;
  },
  dependencies: BookingLeadDependencies = {},
) => {
  const sourceUrl = new URL(input.eventSourceUrl, "https://www.lejapon.ma");
  const isAllowed = dependencies.isAllowed ?? isMarketingTrackingAllowed;
  if (!isAllowed(sourceUrl.pathname)) return null;
  const eventId = input.eventId ?? dependencies.createEventId?.() ?? createMarketingEventId("lead");
  const trackBrowser = dependencies.trackBrowser ?? trackEvent;
  const sendServer = dependencies.sendServer ?? sendMetaServerEvent;
  const identifiers = attributionMetaIdentifiers(input.attribution);

  try {
    trackBrowser("booking_form_submitted", input.analyticsParams, { eventId });
  } catch {
    // Measurement is best-effort and must never change booking success.
  }
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
  const eventId = dependencies.createEventId?.() ?? createMarketingEventId("lead");
  const bookingId = await input.createBooking();
  void trackSuccessfulBookingLead({
    bookingId,
    eventSourceUrl: input.eventSourceUrl,
    attribution: input.attribution,
    analyticsParams: input.analyticsParams,
    eventId,
  }, dependencies);
  return bookingId;
};
