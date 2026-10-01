export type FitFeeDay = {
  japan_agency_fee_rate_override?: number | null | "";
  japan_agency_fee_exemption_reason?: string | null;
  japan_agency_fee_exempted_at?: string | null;
  japan_agency_fee_exempted_by?: string | null;
  calculated_ground_cost?: number | null;
  japan_fee_eligible_base_mad?: number | null;
  calculated_japan_agency_fee?: number | null;
};

export type FitFeeQuote = {
  calculation_mode?: string | null;
  japan_agency_fee_rate?: number | null;
  lejapon_margin_rate?: number | null;
  rounding_rule?: string | null;
  japan_agency_fee_total_mad?: number | null;
  project_cost_total_mad?: number | null;
  total_selling_price_mad?: number | null;
  additional_japan_managed_base_mad?: number | null;
};

export type FitCostOwner = "japan_supplier_managed" | "lejapon_direct";
export type FitFinancialComponent = {
  owner: FitCostOwner | null;
  source: "day" | "other" | "hotel" | "flight";
  dayKey?: string;
  estimatedMad: number;
  quotedMad?: number | null;
  confirmedMad?: number | null;
  finalMad?: number | null;
  included?: boolean;
};
export type FitGlobalSupplierQuote = {
  quotedAmount: number;
  currency: "MAD" | "JPY" | "USD" | "EUR";
  exchangeRateToMad: number;
  handlingMode: "included" | "separate";
  handlingRate?: number | null;
  confirmedAmount?: number | null;
  finalAmount?: number | null;
  confirmedExchangeRateToMad?: number | null;
  finalExchangeRateToMad?: number | null;
};
export type FitFinancialStage = {
  projectCostMad: number;
  supplierCostMad: number;
  directCostMad: number;
  markupRate: number;
  markupReferenceMad: number;
  sellingReferenceMad: number;
  clientSellingPriceMad: number;
  grossProfitMad: number;
  marginOnSellingPricePercent: number;
  complete: boolean;
  completedCosts: number;
  requiredCosts: number;
};

export function calculateFitFinancialStages(input: {
  components: FitFinancialComponent[];
  globalRate: number;
  dayRateOverrides?: Record<string, number | null>;
  roundingRule?: string | null;
  markupRate: number;
  clientSellingPriceMad: number;
  supplierQuote?: FitGlobalSupplierQuote | null;
}) {
  const components = input.components.filter((item) => item.included !== false);
  const unclassifiedCosts = components.filter((item) => !item.owner && item.estimatedMad > 0).length;
  if (components.some((item) => item.estimatedMad < 0)) throw new Error("negative_fit_cost");
  const managed = components.filter((item) => item.owner === "japan_supplier_managed");
  const direct = components.filter((item) => item.owner === "lejapon_direct");
  const managedBase = managed.reduce((sum, item) => sum + item.estimatedMad, 0);
  const dayBases = new Map<string, number>();
  let otherManagedBase = 0;
  for (const item of managed) {
    if (item.source === "day" && item.dayKey) dayBases.set(item.dayKey, (dayBases.get(item.dayKey) ?? 0) + item.estimatedMad);
    else otherManagedBase += item.estimatedMad;
  }
  const estimatedHandling = [...dayBases].reduce((sum, [key, base]) =>
    sum + roundForQuote(base * (input.dayRateOverrides?.[key] ?? input.globalRate) / 100, input.roundingRule), 0)
    + roundForQuote(otherManagedBase * input.globalRate / 100, input.roundingRule);
  const estimatedSupplierTotal = managedBase + estimatedHandling;
  const directAt = (level: "estimated" | "quoted" | "confirmed" | "final") => direct.reduce((sum, item) => {
    if (level === "final") return sum + (item.finalMad ?? item.confirmedMad ?? item.quotedMad ?? item.estimatedMad);
    if (level === "confirmed") return sum + (item.confirmedMad ?? item.quotedMad ?? item.estimatedMad);
    if (level === "quoted") return sum + (item.quotedMad ?? item.estimatedMad);
    return sum + item.estimatedMad;
  }, 0);
  const supplierQuote = input.supplierQuote;
  if (supplierQuote && (supplierQuote.exchangeRateToMad <= 0 || supplierQuote.quotedAmount < 0
      || (supplierQuote.handlingMode === "separate" && (supplierQuote.handlingRate == null || supplierQuote.handlingRate < 0)))) {
    throw new Error("invalid_global_supplier_quote");
  }
  const supplierAt = (value: number | null | undefined, exchangeRateToMad = supplierQuote?.exchangeRateToMad) => {
    if (!supplierQuote || value == null) return null;
    const base = value * Number(exchangeRateToMad);
    return base + (supplierQuote.handlingMode === "separate"
      ? roundForQuote(base * Number(supplierQuote.handlingRate) / 100, input.roundingRule) : 0);
  };
  const quotedSupplier = supplierAt(supplierQuote?.quotedAmount) ?? estimatedSupplierTotal;
  const confirmedSupplier = supplierAt(supplierQuote?.confirmedAmount,
    supplierQuote?.confirmedExchangeRateToMad ?? supplierQuote?.exchangeRateToMad) ?? quotedSupplier;
  const finalSupplier = supplierAt(supplierQuote?.finalAmount,
    supplierQuote?.finalExchangeRateToMad ?? supplierQuote?.exchangeRateToMad) ?? confirmedSupplier;
  const stage = (supplierCostMad: number, directCostMad: number, completedCosts: number, requiredCosts: number): FitFinancialStage => {
    const projectCostMad = supplierCostMad + directCostMad;
    const markupReferenceMad = calculateFitMarkup(projectCostMad, input.markupRate, input.roundingRule);
    const grossProfitMad = input.clientSellingPriceMad - projectCostMad;
    return {
      projectCostMad, supplierCostMad, directCostMad, markupRate: input.markupRate,
      markupReferenceMad, sellingReferenceMad: projectCostMad + markupReferenceMad,
      clientSellingPriceMad: input.clientSellingPriceMad, grossProfitMad,
      marginOnSellingPricePercent: input.clientSellingPriceMad > 0 ? grossProfitMad / input.clientSellingPriceMad * 100 : 0,
      complete: completedCosts === requiredCosts && unclassifiedCosts === 0,
      completedCosts, requiredCosts,
    };
  };
  const supplierRequired = managedBase > 0 ? 1 : 0;
  const requiredCosts = direct.length + supplierRequired;
  const quotedCompleted = direct.filter((item) => item.quotedMad != null).length + (supplierRequired && supplierQuote ? 1 : 0);
  const confirmedSupplierReady = supplierQuote?.confirmedAmount != null
    && (supplierQuote.currency === "MAD" || supplierQuote.confirmedExchangeRateToMad != null);
  const finalSupplierReady = supplierQuote?.finalAmount != null
    && (supplierQuote.currency === "MAD" || supplierQuote.finalExchangeRateToMad != null);
  const confirmedCompleted = direct.filter((item) => item.confirmedMad != null).length + (supplierRequired && confirmedSupplierReady ? 1 : 0);
  const finalCompleted = direct.filter((item) => item.finalMad != null).length + (supplierRequired && finalSupplierReady ? 1 : 0);
  const estimated = stage(estimatedSupplierTotal, directAt("estimated"), requiredCosts, requiredCosts);
  const quoted = stage(quotedSupplier, directAt("quoted"), quotedCompleted, requiredCosts);
  const confirmed = stage(confirmedSupplier, directAt("confirmed"), confirmedCompleted, requiredCosts);
  const final = stage(finalSupplier, directAt("final"), finalCompleted, requiredCosts);
  const differenceMad = supplierQuote ? quotedSupplier - estimatedSupplierTotal : null;
  return {
    estimated, quoted, confirmed, final,
    quotedComplete: quoted.complete, confirmedComplete: confirmed.complete, finalComplete: final.complete,
    unclassifiedCosts, estimatedSupplierBaseMad: managedBase, estimatedJapanHandlingMad: estimatedHandling,
    estimatedSupplierTotalMad: estimatedSupplierTotal,
    supplierDifferenceMad: differenceMad,
    supplierDifferencePercent: differenceMad != null && estimatedSupplierTotal > 0 ? differenceMad / estimatedSupplierTotal * 100 : null,
    significantSupplierVariance: differenceMad != null
      && (Math.abs(differenceMad) >= 1000 || (estimatedSupplierTotal > 0 && Math.abs(differenceMad / estimatedSupplierTotal) >= 0.05)),
  };
}

const amount = (value: number | null | undefined) => Number(value ?? 0);

export function financialDraftFingerprint(
  form: Record<string, unknown>,
  days: unknown[],
  lines: unknown[],
  hotels: unknown[],
  flights: unknown[],
  supplierQuote?: unknown,
): string {
  return JSON.stringify({
    form: {
      travelers_count: form.travelers_count,
      calculation_mode: form.calculation_mode,
      japan_agency_fee_rate: form.japan_agency_fee_rate,
      lejapon_margin_rate: form.lejapon_margin_rate,
      margin_scope: form.margin_scope,
      rounding_rule: form.rounding_rule,
      manual_adjustment_mad: form.manual_adjustment_mad,
      discount_mad: form.discount_mad,
    },
    days, lines, hotels, flights, supplierQuote,
  });
}

const roundForQuote = (value: number, rule?: string | null) => {
  const step = rule === "hundred" ? 100 : rule === "ten" ? 10 : 1;
  return Math.round(value / step) * step;
};

export function effectiveJapanFeeRate(day: FitFeeDay, globalRate: number): number {
  return day.japan_agency_fee_rate_override == null || day.japan_agency_fee_rate_override === ""
    ? globalRate
    : Number(day.japan_agency_fee_rate_override);
}

export function calculateFitMarkup(markupBaseAfterJapanFee: number, markupRate: number, roundingRule?: string | null): number {
  return roundForQuote(markupBaseAfterJapanFee * markupRate / 100, roundingRule);
}

export function inspectFitFeeIntegrity(quote: FitFeeQuote, days: FitFeeDay[]) {
  const configuredRate = amount(quote.japan_agency_fee_rate ?? 10);
  const additionalBase = amount(quote.additional_japan_managed_base_mad);
  const feeBase = additionalBase + days.reduce((sum, day) => sum + amount(day.japan_fee_eligible_base_mad), 0);
  const expectedFee = roundForQuote(additionalBase * configuredRate / 100, quote.rounding_rule) + days.reduce((sum, day) => sum + roundForQuote(
    amount(day.japan_fee_eligible_base_mad) * effectiveJapanFeeRate(day, configuredRate) / 100,
    quote.rounding_rule,
  ), 0);
  const actualFee = amount(quote.japan_agency_fee_total_mad);
  const unreasonedExemptions = days.filter((day) =>
    day.japan_agency_fee_rate_override === 0
    && amount(day.japan_fee_eligible_base_mad) > 0
    && (!day.japan_agency_fee_exemption_reason?.trim()
      || !day.japan_agency_fee_exempted_at
      || !day.japan_agency_fee_exempted_by),
  ).length;
  const weightedEffectiveRate = feeBase > 0
    ? (additionalBase * configuredRate + days.reduce((sum, day) => sum + amount(day.japan_fee_eligible_base_mad) * effectiveJapanFeeRate(day, configuredRate), 0)) / feeBase
    : configuredRate;
  const sellingPrice = amount(quote.total_selling_price_mad);
  const projectCost = amount(quote.project_cost_total_mad);
  const issues: string[] = [];
  if (quote.calculation_mode === "automatic_v2") {
    if (unreasonedExemptions) issues.push(`${unreasonedExemptions} journée(s) à 0 % sans justification auditée`);
    if (Math.abs(expectedFee - actualFee) > 0.01) issues.push("Frais Japon calculés différents du taux effectif");
    if (configuredRate > 0 && feeBase > 0 && actualFee === 0 && expectedFee > 0) {
      issues.push("FINANCIAL INTEGRITY ERROR : frais fournisseur Japon non appliqués");
    }
  }
  return {
    configuredRate,
    weightedEffectiveRate,
    feeBase,
    expectedFee,
    actualFee,
    unreasonedExemptions,
    projectCost,
    markupRate: amount(quote.lejapon_margin_rate),
    grossMarginRate: sellingPrice > 0 ? (sellingPrice - projectCost) / sellingPrice * 100 : 0,
    issues,
    blocked: issues.length > 0,
  };
}
