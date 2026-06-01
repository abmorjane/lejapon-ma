import type { AgencyBooking, CommissionRule } from "./agencyTypes";

export const commissionRuleColumns = [
  "id",
  "organization_id",
  "scope",
  "destination",
  "product_trip_id",
  "rule_name",
  "commission_type",
  "commission_value",
  "currency",
  "applies_to",
  "effective_from",
  "effective_to",
  "status",
  "priority",
].join(",");

export const formatCommissionRuleValue = (rule: CommissionRule) =>
  rule.commission_type === "percentage"
    ? `${Number(rule.commission_value || 0)}%`
    : `${Number(rule.commission_value || 0).toLocaleString("fr-FR")} ${rule.currency || "MAD"}`;

export const getCommissionScopeLabel = (rule: CommissionRule) => {
  if (rule.scope === "global") return "Globale";
  if (rule.scope === "destination") return `Destination · ${rule.destination || "—"}`;
  return "Produit";
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const isRuleEffectiveForBooking = (rule: CommissionRule, booking: AgencyBooking) => {
  const bookingDate = String(booking.created_at || "").slice(0, 10);
  if (rule.effective_from && bookingDate && bookingDate < rule.effective_from) return false;
  if (rule.effective_to && bookingDate && bookingDate > rule.effective_to) return false;
  if (rule.scope === "global") return true;
  if (rule.scope === "product") return Boolean(rule.product_trip_id && rule.product_trip_id === booking.trip_id);
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
      const scopeWeight = { product: 0, destination: 1, global: 2 };
      const byScope = scopeWeight[a.scope] - scopeWeight[b.scope];
      if (byScope !== 0) return byScope;
      return Number(a.priority ?? 100) - Number(b.priority ?? 100);
    });

  return activeRules[0] ?? null;
};

export const estimateCommissionForBooking = (booking: AgencyBooking, rule: CommissionRule | null) => {
  if (!rule) return 0;
  const basis = rule.applies_to === "base_trip_price"
    ? Number(booking.trips?.base_price_mad ?? booking.total_amount_mad ?? 0)
    : Number(booking.total_amount_mad ?? 0);

  if (rule.commission_type === "fixed_amount") return Number(rule.commission_value || 0);
  return Math.round((basis * Number(rule.commission_value || 0)) / 100);
};
