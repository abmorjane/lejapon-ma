import type { AgencyBooking, CommissionRule } from "./agencyTypes";

export const commissionRuleColumns = [
  "id",
  "organization_id",
  "scope",
  "rule_type",
  "commission_type",
  "value",
  "commission_value",
  "currency",
  "destination",
  "product_type",
  "trip_id",
  "product_trip_id",
  "status",
  "starts_at",
  "effective_from",
  "ends_at",
  "effective_to",
  "notes",
  "sales_agent_commission_type",
  "sales_agent_commission_value",
  "gross_agency_commission_type",
  "gross_agency_commission_value",
].join(",");

export type DualCommissionInput = {
  eligibleSaleAmountMad: number;
  grossType?: "percentage" | "fixed_amount" | string | null;
  grossValue?: number | null;
  salesAgentId?: string | null;
  salesAgentType?: "percentage" | "fixed_amount" | string | null;
  salesAgentValue?: number | null;
  ruleSource?: string | null;
};

export type DualCommissionSnapshot = {
  eligible_sale_amount_mad: number;
  gross_agency_commission_type: "percentage" | "fixed_amount";
  gross_agency_commission_value: number;
  gross_agency_commission_amount_mad: number;
  sales_agent_commission_type: "percentage" | "fixed_amount";
  sales_agent_commission_value: number;
  sales_agent_commission_amount_mad: number;
  agency_net_commission_amount_mad: number;
  rule_source: string | null;
};

const normalizeRuleType = (value: unknown): "percentage" | "fixed_amount" =>
  value === "fixed" || value === "fixed_amount" ? "fixed_amount" : "percentage";

export const normalizeCommissionRule = (rule: any): CommissionRule & Record<string, any> => {
  const scope = rule.scope === "global" ? "agency_default" : rule.scope;
  return {
    ...rule,
    scope,
    rule_type: normalizeRuleType(rule.rule_type ?? rule.commission_type),
    value: Number(rule.value ?? rule.commission_value ?? 0),
    product_type: rule.product_type ?? rule.applies_to ?? null,
    trip_id: rule.trip_id ?? rule.product_trip_id ?? null,
    starts_at: rule.starts_at ?? rule.effective_from ?? null,
    ends_at: rule.ends_at ?? rule.effective_to ?? null,
  };
};

export const calculateDualCommissionSnapshot = ({
  eligibleSaleAmountMad,
  grossType,
  grossValue,
  salesAgentId,
  salesAgentType,
  salesAgentValue,
  ruleSource = null,
}: DualCommissionInput): DualCommissionSnapshot => {
  const basis = Math.max(Number(eligibleSaleAmountMad || 0), 0);
  const normalizedGrossType = normalizeRuleType(grossType);
  const normalizedAgentType = normalizeRuleType(salesAgentType);
  const grossBaseValue = Math.max(Number(grossValue || 0), 0);
  const agentBaseValue = Math.max(Number(salesAgentValue || 0), 0);
  const grossAmount = normalizedGrossType === "fixed_amount"
    ? grossBaseValue
    : Math.round((basis * grossBaseValue) / 100);
  const rawAgentAmount = !salesAgentId
    ? 0
    : normalizedAgentType === "fixed_amount"
      ? agentBaseValue
      : Math.round((basis * agentBaseValue) / 100);
  const agentAmount = Math.min(rawAgentAmount, grossAmount);

  return {
    eligible_sale_amount_mad: basis,
    gross_agency_commission_type: normalizedGrossType,
    gross_agency_commission_value: grossBaseValue,
    gross_agency_commission_amount_mad: grossAmount,
    sales_agent_commission_type: normalizedAgentType,
    sales_agent_commission_value: agentBaseValue,
    sales_agent_commission_amount_mad: agentAmount,
    agency_net_commission_amount_mad: Math.max(grossAmount - agentAmount, 0),
    rule_source: ruleSource,
  };
};

export const formatCommissionRuleValue = (rule: CommissionRule) =>
  rule.rule_type === "percentage"
    ? `${Number(rule.value || 0)}%`
    : `${Number(rule.value || 0).toLocaleString("fr-FR")} ${rule.currency || "MAD"}`;

export const getCommissionScopeLabel = (rule: CommissionRule) => {
  if (rule.scope === "agency_default" || rule.scope === "global") return "Commission globale";
  if (rule.scope === "destination") return `Destination: ${rule.destination || "—"}`;
  if (rule.scope === "product") return `Produit: ${rule.product_type || "—"}`;
  if (rule.scope === "trip_override") return "Voyage spécifique";
  return rule.scope;
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const isRuleEffectiveForBooking = (rule: CommissionRule, booking: AgencyBooking) => {
  const normalizedRule = normalizeCommissionRule(rule);
  const bookingDate = String(booking.created_at || "").slice(0, 10);
  if (normalizedRule.starts_at && bookingDate && bookingDate < normalizedRule.starts_at.slice(0, 10)) return false;
  if (normalizedRule.ends_at && bookingDate && bookingDate > normalizedRule.ends_at.slice(0, 10)) return false;
  if (normalizedRule.scope === "agency_default") return true;
  if (normalizedRule.scope === "trip_override") return Boolean(normalizedRule.trip_id && normalizedRule.trip_id === booking.trip_id);
  if (normalizedRule.scope === "product") {
    const target = normalize(normalizedRule.product_type);
    const bookingDestination = normalize(booking.trips?.destination || booking.preferred_dates);
    const tripTitle = normalize(booking.trips?.title);
    return Boolean(target && (bookingDestination.includes(target) || tripTitle.includes(target)));
  }
  if (normalizedRule.scope === "destination") {
    const target = normalize(normalizedRule.destination);
    const bookingDestination = normalize(booking.trips?.destination || booking.preferred_dates);
    const tripTitle = normalize(booking.trips?.title);
    return Boolean(target && (bookingDestination.includes(target) || tripTitle.includes(target)));
  }
  return false;
};

export const getApplicableCommissionRule = (rules: CommissionRule[], booking: AgencyBooking) => {
  const activeRules = rules
    .map(normalizeCommissionRule)
    .filter((rule) => rule.status === "active" && isRuleEffectiveForBooking(rule, booking))
    .sort((a, b) => {
      const scopeWeight = { trip_override: 0, product: 1, destination: 2, agency_default: 3 };
      const byScope = scopeWeight[a.scope] - scopeWeight[b.scope];
      return byScope;
    });

  return activeRules[0] ?? null;
};

export const estimateCommissionForBooking = (booking: AgencyBooking, rule: CommissionRule | null) => {
  if (!rule) return 0;
  const normalizedRule = normalizeCommissionRule(rule);
  const basis = Number(booking.total_amount_mad ?? 0);

  if (normalizedRule.rule_type === "fixed_amount") return Number(normalizedRule.value || 0);
  return Math.round((basis * Number(normalizedRule.value || 0)) / 100);
};
