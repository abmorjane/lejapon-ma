import { describe, expect, it } from "vitest";
import { calculateFitFinancialStages, calculateFitMarkup, effectiveJapanFeeRate, financialDraftFingerprint, inspectFitFeeIntegrity } from "./fit-financial-integrity";

const quote = { calculation_mode: "automatic_v2", japan_agency_fee_rate: 10, lejapon_margin_rate: 20, rounding_rule: "unit", japan_agency_fee_total_mad: 5000, project_cost_total_mad: 55000, total_selling_price_mad: 66000 };
const day = { calculated_ground_cost: 50000, japan_fee_eligible_base_mad: 50000, calculated_japan_agency_fee: 5000 };

describe("FIT Japan supplier fee integrity", () => {
  it("inherits 10% when override is null or absent", () => {
    expect(effectiveJapanFeeRate({ japan_agency_fee_rate_override: null }, 10)).toBe(10);
    expect(effectiveJapanFeeRate({}, 10)).toBe(10);
    expect(inspectFitFeeIntegrity(quote, [day]).expectedFee).toBe(5000);
    expect(inspectFitFeeIntegrity(quote, [day]).blocked).toBe(false);
  });
  it("treats explicit zero as exemption only with an audited reason", () => {
    const exempt = { ...day, japan_agency_fee_rate_override: 0, japan_agency_fee_exemption_reason: "Service acheté directement", japan_agency_fee_exempted_at: "2026-09-29T00:00:00Z", japan_agency_fee_exempted_by: "user-id" };
    expect(effectiveJapanFeeRate(exempt, 10)).toBe(0);
    expect(inspectFitFeeIntegrity({ ...quote, japan_agency_fee_total_mad: 0 }, [exempt]).blocked).toBe(false);
    expect(inspectFitFeeIntegrity({ ...quote, japan_agency_fee_total_mad: 0 }, [{ ...day, japan_agency_fee_rate_override: 0 }]).blocked).toBe(true);
  });
  it("allows a 15% override and blocks mismatched fee", () => {
    const higher = { ...day, japan_agency_fee_rate_override: 15 };
    expect(effectiveJapanFeeRate(higher, 10)).toBe(15);
    expect(inspectFitFeeIntegrity({ ...quote, japan_agency_fee_total_mad: 7500 }, [higher]).blocked).toBe(false);
    expect(inspectFitFeeIntegrity({ ...quote, japan_agency_fee_total_mad: 0 }, [higher]).blocked).toBe(true);
  });
  it("blocks a global 10% quote with a positive eligible base and a zero fee", () => {
    const result = inspectFitFeeIntegrity({ ...quote, japan_agency_fee_total_mad: 0 }, [day]);
    expect(result.expectedFee).toBe(5000);
    expect(result.blocked).toBe(true);
    expect(result.issues).toContain("FINANCIAL INTEGRITY ERROR : frais fournisseur Japon non appliqués");
  });
  it("applies LeJapon markup after Japan fee and distinguishes gross margin", () => {
    const result = inspectFitFeeIntegrity(quote, [day]);
    expect(result.projectCost).toBe(55000);
    expect(calculateFitMarkup(result.projectCost, 20)).toBe(11000);
    expect(result.projectCost + calculateFitMarkup(result.projectCost, 20)).toBe(66000);
    expect(result.markupRate).toBe(20);
    expect(result.grossMarginRate).toBeCloseTo(16.6667, 3);
  });
  it("does not reprice historical quote data", () => {
    const historical = Object.freeze({ ...day, japan_agency_fee_rate_override: 0 });
    const storedQuote = Object.freeze({ ...quote, japan_agency_fee_total_mad: 0 });
    inspectFitFeeIntegrity(storedQuote, [historical]);
    expect(historical.japan_agency_fee_rate_override).toBe(0);
    expect(storedQuote.japan_agency_fee_total_mad).toBe(0);
  });
  it("detects unsaved financial changes without treating share-state changes as pricing edits", () => {
    const form = { japan_agency_fee_rate: 10, lejapon_margin_rate: 20, status: "draft" };
    const saved = financialDraftFingerprint(form, [day], [], [], []);
    expect(financialDraftFingerprint({ ...form, status: "sent" }, [day], [], [], [])).toBe(saved);
    expect(financialDraftFingerprint({ ...form, japan_agency_fee_rate: 15 }, [day], [], [], [])).not.toBe(saved);
    expect(financialDraftFingerprint(form, [{ ...day, calculated_ground_cost: 60000 }], [], [], [])).not.toBe(saved);
  });
});

describe("FIT four-stage supplier model", () => {
  const inputs = {
    components: [
      { owner: "japan_supplier_managed" as const, source: "day" as const, dayKey: "day-1", estimatedMad: 100000 },
      { owner: "lejapon_direct" as const, source: "hotel" as const, estimatedMad: 20000, quotedMad: 22000 },
    ],
    globalRate: 10, markupRate: 20, clientSellingPriceMad: 156000, roundingRule: "unit",
  };
  it("matches the staging acceptance figures for estimation and included/separate handling", () => {
    const scenario = {
      components: [
        { owner: "japan_supplier_managed" as const, source: "day" as const, dayKey: "test-day", estimatedMad: 100000 },
        { owner: "lejapon_direct" as const, source: "other" as const, estimatedMad: 20000, quotedMad: 20000 },
      ],
      globalRate: 10, markupRate: 20, clientSellingPriceMad: 156000,
    };
    const estimated = calculateFitFinancialStages(scenario);
    expect(estimated.estimatedSupplierBaseMad).toBe(100000);
    expect(estimated.estimatedJapanHandlingMad).toBe(10000);
    expect(estimated.estimatedSupplierTotalMad).toBe(110000);
    expect(estimated.estimated.projectCostMad).toBe(130000);
    expect(estimated.estimated.sellingReferenceMad).toBe(156000);
    expect(estimated.estimated.grossProfitMad).toBe(26000);
    expect(estimated.estimated.marginOnSellingPricePercent).toBeCloseTo(16.6667, 3);

    const included = calculateFitFinancialStages({ ...scenario, supplierQuote: {
      quotedAmount: 108000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "included",
    } });
    expect(included.quoted.supplierCostMad).toBe(108000);
    expect(included.quoted.projectCostMad).toBe(128000);
    expect(included.supplierDifferenceMad).toBe(-2000);
    expect(included.supplierDifferencePercent).toBeCloseTo(-1.81818, 4);

    const separate = calculateFitFinancialStages({ ...scenario, supplierQuote: {
      quotedAmount: 100000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "separate", handlingRate: 10,
    } });
    expect(separate.quoted.supplierCostMad).toBe(110000);
    expect(separate.quoted.projectCostMad).toBe(130000);
  });
  it("excludes additional direct hotel and flight costs from Japan handling", () => {
    const model = calculateFitFinancialStages({
      components: [
        { owner: "japan_supplier_managed", source: "day", dayKey: "day", estimatedMad: 100000 },
        { owner: "lejapon_direct", source: "hotel", estimatedMad: 15000 },
        { owner: "lejapon_direct", source: "flight", estimatedMad: 25000 },
      ],
      globalRate: 10, markupRate: 20, clientSellingPriceMad: 180000,
    });
    expect(model.estimatedJapanHandlingMad).toBe(10000);
    expect(model.estimated.directCostMad).toBe(40000);
    expect(model.estimated.projectCostMad).toBe(150000);
  });
  it("charges estimated handling only on Japan-managed costs", () => {
    const model = calculateFitFinancialStages(inputs);
    expect(model.estimatedSupplierBaseMad).toBe(100000);
    expect(model.estimatedJapanHandlingMad).toBe(10000);
    expect(model.estimated.projectCostMad).toBe(130000);
  });
  it("honors an explicit justified zero in the day rate without touching direct costs", () => {
    const model = calculateFitFinancialStages({ ...inputs, dayRateOverrides: { "day-1": 0 } });
    expect(model.estimatedJapanHandlingMad).toBe(0);
    expect(model.estimated.projectCostMad).toBe(120000);
  });
  it("uses an included global supplier quote once, without adding the estimated 10%", () => {
    const model = calculateFitFinancialStages({ ...inputs, supplierQuote: {
      quotedAmount: 112000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "included",
    } });
    expect(model.quoted.supplierCostMad).toBe(112000);
    expect(model.quoted.projectCostMad).toBe(134000);
    expect(model.supplierDifferenceMad).toBe(2000);
    expect(model.supplierDifferencePercent).toBeCloseTo(1.818, 2);
    expect(model.quoted.complete).toBe(true);
    expect(model.significantSupplierVariance).toBe(true);
  });
  it("alerts on a 5% supplier variance even below 1,000 MAD", () => {
    const model = calculateFitFinancialStages({
      components: [{ owner: "japan_supplier_managed", source: "day", dayKey: "d", estimatedMad: 10000 }],
      globalRate: 0, markupRate: 20, clientSellingPriceMad: 12000,
      supplierQuote: { quotedAmount: 10500, currency: "MAD", exchangeRateToMad: 1, handlingMode: "included" },
    });
    expect(model.supplierDifferenceMad).toBe(500);
    expect(model.significantSupplierVariance).toBe(true);
  });
  it("adds handling only when the global quote explicitly says separate", () => {
    const model = calculateFitFinancialStages({ ...inputs, supplierQuote: {
      quotedAmount: 112000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "separate", handlingRate: 10,
    } });
    expect(model.quoted.supplierCostMad).toBe(123200);
  });
  it("keeps confirmed and final margins partial until every required actual cost exists", () => {
    const model = calculateFitFinancialStages({ ...inputs, supplierQuote: {
      quotedAmount: 112000, confirmedAmount: 113000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "included",
    } });
    expect(model.confirmed.complete).toBe(false);
    expect(model.confirmed.completedCosts).toBe(1);
    expect(model.confirmed.requiredCosts).toBe(2);
    expect(model.final.complete).toBe(false);
    expect(model.quoted.grossProfitMad).toBe(22000);
    expect(model.quoted.marginOnSellingPricePercent).toBeCloseTo(14.10256, 4);
  });
  it("marks FINAL complete only after the global supplier amount and every direct cost are final", () => {
    const model = calculateFitFinancialStages({ ...inputs,
      components: [inputs.components[0], { ...inputs.components[1], confirmedMad: 23000, finalMad: 24000 }],
      supplierQuote: { quotedAmount: 112000, confirmedAmount: 113000, finalAmount: 114000,
        currency: "MAD", exchangeRateToMad: 1, handlingMode: "included" },
    });
    expect(model.confirmedComplete).toBe(true);
    expect(model.finalComplete).toBe(true);
    expect(model.final.projectCostMad).toBe(138000);
    expect(model.final.grossProfitMad).toBe(18000);
  });
  it("matches Imane's estimate and does not double count a real quote", () => {
    const model = calculateFitFinancialStages({
      components: [{ owner: "japan_supplier_managed", source: "day", dayKey: "imane", estimatedMad: 210560 }],
      globalRate: 10, markupRate: 20, clientSellingPriceMad: 280000, roundingRule: "ten",
      supplierQuote: { quotedAmount: 230000, currency: "MAD", exchangeRateToMad: 1, handlingMode: "included" },
    });
    expect(model.estimatedJapanHandlingMad).toBe(21060);
    expect(model.estimatedSupplierTotalMad).toBe(231620);
    expect(model.quoted.supplierCostMad).toBe(230000);
    expect(model.supplierDifferenceMad).toBe(-1620);
  });
  it("keeps Chakib's supplier final amount unchanged when handling is included", () => {
    const model = calculateFitFinancialStages({
      components: [{ owner: "lejapon_direct", source: "hotel", estimatedMad: 22893 }],
      globalRate: 10, markupRate: 20, clientSellingPriceMad: 158400,
      supplierQuote: { quotedAmount: 1688885, currency: "JPY", exchangeRateToMad: 0.06, handlingMode: "included" },
    });
    expect(model.quoted.supplierCostMad).toBeCloseTo(101333.1);
    expect(model.quoted.projectCostMad).toBeCloseTo(124226.1);
  });
  it("does not call a foreign-currency final margin complete without the paid FX rate", () => {
    const input = {
      components: [{ owner: "japan_supplier_managed" as const, source: "day" as const, dayKey: "d", estimatedMad: 10000 }],
      globalRate: 10, markupRate: 20, clientSellingPriceMad: 15000,
      supplierQuote: { quotedAmount: 100000, confirmedAmount: 101000, finalAmount: 102000,
        currency: "JPY" as const, exchangeRateToMad: 0.06, handlingMode: "included" as const },
    };
    expect(calculateFitFinancialStages(input).finalComplete).toBe(false);
    expect(calculateFitFinancialStages({ ...input, supplierQuote: { ...input.supplierQuote,
      confirmedExchangeRateToMad: 0.061, finalExchangeRateToMad: 0.062 } }).finalComplete).toBe(true);
  });
  it("marks unclassified historical components incomplete", () => {
    const model = calculateFitFinancialStages({ ...inputs, components: [{ owner: null, source: "day", estimatedMad: 1000 }] });
    expect(model.unclassifiedCosts).toBe(1);
    expect(model.estimated.complete).toBe(false);
  });
});
