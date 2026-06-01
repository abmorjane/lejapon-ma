import type { AgencyBooking, CommissionRule } from "./agencyTypes";

export const commissionRuleColumns = [
  "id",
  "organization_id",
  "scope",
  "rule_type",
  "value",
  "currency",
  "destination",
  "product_type",
  "trip_id",
  "status",
  "notes",
].join(",");

export const formatCommissionRuleValue = (rule: CommissionRule) =>
  rule.rule_type === "percentage"
    ? `${Number(rule.value || 0)}%`
    : `${Number(rule.value || 0).toLocaleString("fr-FR")} ${rule.currency || "MAD"}`;

export const getCommissionScopeLabel = (rule: CommissionRule) => {
  if (rule.scope === "agency_default") return "Commission globale";
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
  if (rule.scope === "agency_default") return true;
  if (rule.scope === "trip_override") return Boolean(rule.trip_id && rule.trip_id === booking.trip_id);
  if (rule.scope === "product") {
    const target = normalize(rule.product_type);
    const bookingDestination = normalize(booking.trips?.destination || booking.preferred_dates);
    const tripTitle = normalize(booking.trips?.title);
    return Boolean(target && (bookingDestination.includes(target) || tripTitle.includes(target)));
  }
  if (rule.scope === "destination") {
    const target = normalize(rule.destination);
    const bookingDestination = normalize(booking.trips?.destination || booking.preferred_dates);
    const tripTitle = normalize(booking.trips?.title);
    return Boolean(target && (bookingDestination.includes(target) || tripTitle.includes(target)));
  }
  return false;
};

export const getApplicableCommissionRule = (rules: CommissionRule[], booking: AgencyBooking) => {
  const activeRules = rules
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
  const basis = Number(booking.total_amount_mad ?? 0);

  if (rule.rule_type === "fixed_amount") return Number(rule.value || 0);
  return Math.round((basis * Number(rule.value || 0)) / 100);
};
