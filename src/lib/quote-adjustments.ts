export type QuoteAdjustmentType = "discount" | "supplement";
export type QuoteAdjustmentCalculationType = "fixed_amount" | "percentage";

export type QuoteAdjustment = {
  id: string;
  label: string;
  type: QuoteAdjustmentType;
  calculation_type: QuoteAdjustmentCalculationType;
  amount: number;
  reason?: string | null;
  created_at?: string | null;
  created_by?: string | null;
  visible_on_quote?: boolean;
  source?: string | null;
};

export type QuoteAdjustmentDraft = {
  label: string;
  type: QuoteAdjustmentType;
  calculation_type: QuoteAdjustmentCalculationType;
  amount: string;
  reason: string;
  visible_on_quote: boolean;
};

export const emptyQuoteAdjustmentDraft = (): QuoteAdjustmentDraft => ({
  label: "",
  type: "discount",
  calculation_type: "fixed_amount",
  amount: "",
  reason: "",
  visible_on_quote: true,
});

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const normalizeQuoteAdjustments = (value: unknown): QuoteAdjustment[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!isRecord(item)) return null;
      const label = String(item.label ?? "").trim();
      const amount = Number(item.amount ?? 0);
      if (!label || !Number.isFinite(amount) || amount <= 0) return null;
      const type = item.type === "supplement" ? "supplement" : "discount";
      const calculationType = item.calculation_type === "percentage" || item.type === "percentage" ? "percentage" : "fixed_amount";
      return {
        id: String(item.id ?? crypto.randomUUID()),
        label,
        type,
        calculation_type: calculationType,
        amount,
        reason: item.reason ? String(item.reason) : null,
        created_at: item.created_at ? String(item.created_at) : null,
        created_by: item.created_by ? String(item.created_by) : null,
        visible_on_quote: item.visible_on_quote !== false,
        source: item.source ? String(item.source) : null,
      } satisfies QuoteAdjustment;
    })
    .filter((item): item is QuoteAdjustment => Boolean(item));
};

export const legacyDiscountToAdjustment = (value: unknown): QuoteAdjustment[] => {
  if (!isRecord(value)) return [];
  const amount = Number(value.amount ?? 0);
  const label = String(value.label ?? "").trim();
  if (!Number.isFinite(amount) || amount <= 0 || !label) return [];
  return [{
    id: String(value.id ?? "legacy-quote-discount"),
    label,
    type: "discount",
    calculation_type: value.type === "percentage" ? "percentage" : "fixed_amount",
    amount,
    reason: value.reason ? String(value.reason) : null,
    created_at: value.updated_at ? String(value.updated_at) : null,
    created_by: value.created_by ? String(value.created_by) : null,
    visible_on_quote: true,
    source: "legacy",
  }];
};

export const quoteAdjustmentsFromBooking = (booking: any): QuoteAdjustment[] => {
  const direct = normalizeQuoteAdjustments(booking?.quote_adjustments);
  if (direct.length > 0) return direct;
  const metadata = normalizeQuoteAdjustments(booking?.metadata?.quote_adjustments);
  if (metadata.length > 0) return metadata;
  return legacyDiscountToAdjustment(booking?.quote_discount);
};

export const quoteAdjustmentsFromRequestMetadata = (metadata: any): QuoteAdjustment[] =>
  normalizeQuoteAdjustments(metadata?.quote_adjustments);

export const makeQuoteAdjustment = (
  draft: QuoteAdjustmentDraft,
  userId?: string | null,
  source?: string | null,
  existing?: QuoteAdjustment | null,
): QuoteAdjustment => ({
  id: existing?.id ?? crypto.randomUUID(),
  label: draft.label.trim(),
  type: draft.type,
  calculation_type: draft.calculation_type,
  amount: Number(draft.amount || 0),
  reason: draft.reason.trim() || null,
  created_at: existing?.created_at ?? new Date().toISOString(),
  created_by: existing?.created_by ?? userId ?? null,
  visible_on_quote: draft.visible_on_quote,
  source: existing?.source ?? source ?? null,
});

export const draftFromQuoteAdjustment = (adjustment: QuoteAdjustment): QuoteAdjustmentDraft => ({
  label: adjustment.label,
  type: adjustment.type,
  calculation_type: adjustment.calculation_type,
  amount: String(adjustment.amount ?? ""),
  reason: adjustment.reason ?? "",
  visible_on_quote: adjustment.visible_on_quote !== false,
});

export const adjustmentAmount = (adjustment: QuoteAdjustment, baseTotal: number): number => {
  const amount = Number(adjustment.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (adjustment.calculation_type === "percentage") {
    return Math.round(Number(baseTotal || 0) * amount / 100);
  }
  return amount;
};

export const summarizeQuoteAdjustments = (adjustments: QuoteAdjustment[], baseTotal: number) => {
  return adjustments.reduce(
    (summary, adjustment) => {
      const value = adjustmentAmount(adjustment, baseTotal);
      if (adjustment.type === "supplement") {
        summary.supplementsTotal += value;
      } else {
        summary.discountsTotal += value;
      }
      summary.finalTotal = Math.max(0, baseTotal + summary.supplementsTotal - summary.discountsTotal);
      return summary;
    },
    { discountsTotal: 0, supplementsTotal: 0, finalTotal: Math.max(0, Number(baseTotal || 0)) },
  );
};

export const quoteTotalWithAdjustments = (baseTotal: number, adjustments: QuoteAdjustment[]) =>
  summarizeQuoteAdjustments(adjustments, baseTotal).finalTotal;

export const adjustmentDisplayAmount = (adjustment: QuoteAdjustment, baseTotal: number) => {
  const value = adjustmentAmount(adjustment, baseTotal);
  return adjustment.type === "discount" ? -value : value;
};
