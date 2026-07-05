import {
  quoteAdjustmentsFromBooking,
  summarizeQuoteAdjustments,
  type QuoteAdjustment,
} from "@/lib/quote-adjustments";

const asRecord = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

const numberOrNull = (value: unknown): number | null => {
  const next = Number(value);
  return Number.isFinite(next) ? next : null;
};

export const bookingPaxCount = (booking: any) =>
  Math.max(0, Number(booking?.num_adults || 0) + Number(booking?.num_children || 0));

export const bookingExtrasTotal = (extras?: Array<{ qty?: number | null; unit_price_mad?: number | null }>) =>
  (extras ?? []).reduce((sum, extra) => sum + Number(extra.qty || 0) * Number(extra.unit_price_mad || 0), 0);

export const bookingMetadata = (booking: any) => asRecord(booking?.metadata);

export const resolveBookingTripUnitPrice = ({
  booking,
  trip,
  extras,
}: {
  booking: any;
  trip?: any;
  extras?: Array<{ qty?: number | null; unit_price_mad?: number | null }>;
}) => {
  const metadata = bookingMetadata(booking);
  const stored = numberOrNull(metadata.trip_unit_price_per_person_mad);
  if (stored !== null && stored >= 0) return stored;

  const catalogPrice = numberOrNull(trip?.base_price_mad);
  if (catalogPrice !== null && catalogPrice >= 0) return catalogPrice;

  const pax = bookingPaxCount(booking);
  if (pax > 0) {
    const derived = (Number(booking?.total_amount_mad || 0) - bookingExtrasTotal(extras)) / pax;
    if (Number.isFinite(derived) && derived >= 0) return derived;
  }

  return 0;
};

export const getBookingPricingBreakdown = ({
  booking,
  trip,
  extras,
  quoteAdjustments,
}: {
  booking: any;
  trip?: any;
  extras?: Array<{ qty?: number | null; unit_price_mad?: number | null }>;
  quoteAdjustments?: QuoteAdjustment[] | null;
}) => {
  const pax = bookingPaxCount(booking);
  const tripUnitPrice = resolveBookingTripUnitPrice({ booking, trip, extras });
  const tripTotal = tripUnitPrice * pax;
  const extrasTotal = bookingExtrasTotal(extras);
  const calculatedBaseTotal = tripTotal + extrasTotal;
  const enteredBaseTotal = Number(booking?.total_amount_mad || 0);
  const adjustments = quoteAdjustments ?? quoteAdjustmentsFromBooking(booking);
  const calculatedAdjustmentSummary = summarizeQuoteAdjustments(adjustments, calculatedBaseTotal);
  const enteredAdjustmentSummary = summarizeQuoteAdjustments(adjustments, enteredBaseTotal);
  const paidAmount = Number(booking?.paid_amount_mad || 0);

  return {
    pax,
    tripUnitPrice,
    tripTotal,
    extrasTotal,
    calculatedBaseTotal,
    calculatedFinalTotal: calculatedAdjustmentSummary.finalTotal,
    enteredBaseTotal,
    enteredFinalTotal: enteredAdjustmentSummary.finalTotal,
    paidAmount,
    remainingAmount: Math.max(0, enteredAdjustmentSummary.finalTotal - paidAmount),
    calculatedAdjustmentSummary,
    enteredAdjustmentSummary,
  };
};
