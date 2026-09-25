import {
  adjustmentAmount,
  quoteAdjustmentsFromBooking,
  type QuoteAdjustment,
} from "@/lib/quote-adjustments";
import { bookingExtrasTotal, bookingMetadata, bookingPaxCount, resolveBookingTripUnitPrice } from "@/lib/booking-pricing";

export type DepositType = "fixed" | "percentage";
export type InvoiceType = "proforma" | "deposit" | "final";

export type CommercialLine = {
  kind: "trip" | "extra" | "adjustment";
  label: string;
  qty: number | string;
  unitAmount: number;
  totalAmount: number;
  adjustment?: QuoteAdjustment;
};

export type CommercialParticipantInput = {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  client_type?: string | null;
  traveler_type?: string | null;
  room_type?: string | null;
  room_label?: string | null;
  relation?: string | null;
};

export type CommercialParticipant = {
  name: string;
  details: string[];
  label: string;
};

export type CommercialDocumentTotals = {
  lines: CommercialLine[];
  pax: number;
  tripUnitPrice: number;
  tripTotal: number;
  extrasTotal: number;
  adjustmentsTotal: number;
  supplementsTotal: number;
  discountsTotal: number;
  subtotalBeforeAdjustments: number;
  totalHT: number;
  totalTTC: number;
  paidAmount: number;
  remainingAmount: number;
  depositType: DepositType;
  depositValue: number;
  depositIsPerPerson: boolean;
  depositAmount: number;
  depositLabel: string;
  invoiceType: InvoiceType;
};

const numberOrZero = (value: unknown) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
};

const readDepositConfig = (booking: any, pax: number) => {
  const metadata = bookingMetadata(booking);
  const rawType = metadata.deposit_type ?? booking?.deposit_type;
  const depositType: DepositType = rawType === "percentage" ? "percentage" : "fixed";
  const rawValue = metadata.deposit_value ?? booking?.deposit_value;
  const hasValue = rawValue !== null && rawValue !== undefined && rawValue !== "";
  const depositValue = Math.max(0, hasValue ? numberOrZero(rawValue) : (depositType === "percentage" ? 0 : 25000));
  const depositIsPerPerson = depositType === "percentage"
    ? false
    : (metadata.deposit_is_per_person ?? metadata.deposit_per_person ?? booking?.deposit_is_per_person ?? true);
  return {
    depositType,
    depositValue: depositValue || (depositType === "fixed" ? 25000 : 0),
    depositIsPerPerson: Boolean(depositIsPerPerson),
    pax,
  };
};

export const receivedPaymentsTotal = (payments?: Array<{ amount_mad?: number | string | null; status?: string | null }> | null) => {
  if (!Array.isArray(payments)) return null;
  return payments
    .filter((payment) => ["received", "paid", "completed"].includes(String(payment.status ?? "").toLowerCase()))
    .reduce((sum, payment) => sum + numberOrZero(payment.amount_mad), 0);
};

export const resolveInvoiceType = (paidAmount: number, totalAmount: number): InvoiceType => {
  if (paidAmount <= 0) return "proforma";
  if (paidAmount < totalAmount) return "deposit";
  return "final";
};

export const invoiceTypeLabel = (type: InvoiceType) => {
  if (type === "proforma") return "Facture proforma";
  if (type === "deposit") return "Facture d'acompte";
  return "Facture";
};

const titleCase = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\p{L}/gu, (letter) => letter.toLocaleUpperCase("fr-FR"));

const travelerTypeLabel = (value?: string | null) => {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (["adult", "adulte"].includes(normalized)) return "adulte";
  if (["child", "children", "enfant"].includes(normalized)) return "enfant";
  if (["baby", "infant", "bebe", "bébé"].includes(normalized)) return "bébé";
  if (normalized === "lead") return "responsable";
  return titleCase(normalized);
};

export const normalizeCommercialParticipants = (participants?: CommercialParticipantInput[] | null): CommercialParticipant[] =>
  (participants ?? [])
    .map((participant) => {
      const name = String(
        participant.full_name ||
        participant.name ||
        [participant.first_name, participant.last_name].filter(Boolean).join(" ")
      ).replace(/\s+/g, " ").trim();
      if (!name) return null;
      const type = travelerTypeLabel(participant.client_type ?? participant.traveler_type ?? participant.relation);
      const room = String(participant.room_type ?? participant.room_label ?? "").trim();
      const details = [type, room].filter(Boolean);
      return {
        name,
        details,
        label: details.length ? `${name} (${details.join(" · ")})` : name,
      };
    })
    .filter((participant): participant is CommercialParticipant => Boolean(participant));

export function calculateCommercialDocumentTotals({
  booking,
  trip,
  extras,
  quoteAdjustments,
  payments,
}: {
  booking: any;
  trip?: any;
  extras?: Array<{ name_snapshot?: string | null; qty?: number | null; unit_price_mad?: number | null }>;
  quoteAdjustments?: QuoteAdjustment[] | null;
  payments?: Array<{ amount_mad?: number | string | null; status?: string | null }> | null;
}): CommercialDocumentTotals {
  const pax = Math.max(bookingPaxCount(booking), 1);
  const extraRows = extras ?? [];
  const extrasTotal = bookingExtrasTotal(extraRows);
  const resolvedUnit = resolveBookingTripUnitPrice({ booking, trip, extras: extraRows });
  const tripUnitPrice = resolvedUnit;
  const tripTotal = Math.max(0, Math.round(tripUnitPrice * pax));

  const baseLines: CommercialLine[] = [
    {
      kind: "trip",
      label: trip?.title ?? "Voyage",
      qty: pax,
      unitAmount: tripUnitPrice,
      totalAmount: tripTotal,
    },
    ...extraRows.map((extra) => ({
      kind: "extra" as const,
      label: extra.name_snapshot || "Extra",
      qty: Number(extra.qty || 0),
      unitAmount: numberOrZero(extra.unit_price_mad),
      totalAmount: Number(extra.qty || 0) * numberOrZero(extra.unit_price_mad),
    })),
  ];

  const subtotalBeforeAdjustments = baseLines.reduce((sum, line) => sum + line.totalAmount, 0);
  const adjustments = quoteAdjustments ?? quoteAdjustmentsFromBooking(booking);
  const adjustmentLines = adjustments
    .filter((adjustment) => adjustment.visible_on_quote !== false)
    .map((adjustment): CommercialLine => {
      const value = adjustmentAmount(adjustment, subtotalBeforeAdjustments);
      const signedValue = adjustment.type === "discount" ? -value : value;
      return {
        kind: "adjustment",
        label: adjustment.label,
        qty: adjustment.calculation_type === "percentage" ? `${Number(adjustment.amount || 0)}%` : 1,
        unitAmount: signedValue,
        totalAmount: signedValue,
        adjustment,
      };
    });

  const supplementsTotal = adjustmentLines
    .filter((line) => line.totalAmount > 0)
    .reduce((sum, line) => sum + line.totalAmount, 0);
  const discountsTotal = Math.abs(adjustmentLines
    .filter((line) => line.totalAmount < 0)
    .reduce((sum, line) => sum + line.totalAmount, 0));
  const totalTTC = Math.max(0, Math.round(subtotalBeforeAdjustments + supplementsTotal - discountsTotal));
  const paidFromPayments = receivedPaymentsTotal(payments);
  const paidAmount = paidFromPayments ?? numberOrZero(booking?.paid_amount_mad);
  const remainingAmount = Math.max(0, totalTTC - paidAmount);
  const depositConfig = readDepositConfig(booking, pax);
  const rawDeposit = depositConfig.depositType === "percentage"
    ? Math.round(totalTTC * depositConfig.depositValue / 100)
    : Math.round(depositConfig.depositValue * (depositConfig.depositIsPerPerson ? pax : 1));
  const depositAmount = Math.min(totalTTC, Math.max(0, rawDeposit));
  const depositLabel = depositConfig.depositType === "percentage"
    ? `Acompte demandé : ${depositConfig.depositValue}% du total`
    : depositConfig.depositIsPerPerson
      ? `Acompte demandé : ${depositConfig.depositValue.toLocaleString("fr-FR")} MAD × ${pax} pers.`
      : "Acompte demandé : montant global";

  return {
    lines: [...baseLines, ...adjustmentLines],
    pax,
    tripUnitPrice,
    tripTotal,
    extrasTotal,
    adjustmentsTotal: supplementsTotal - discountsTotal,
    supplementsTotal,
    discountsTotal,
    subtotalBeforeAdjustments,
    totalHT: totalTTC,
    totalTTC,
    paidAmount,
    remainingAmount,
    depositType: depositConfig.depositType,
    depositValue: depositConfig.depositValue,
    depositIsPerPerson: depositConfig.depositIsPerPerson,
    depositAmount,
    depositLabel,
    invoiceType: resolveInvoiceType(paidAmount, totalTTC),
  };
}
