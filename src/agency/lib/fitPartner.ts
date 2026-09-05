export type PartnerMarginType = "percent" | "fixed";

export const PARTNER_FIT_SAFE_QUOTE_COLUMNS = [
  "id",
  "quote_number",
  "client_name",
  "travelers_count",
  "travel_start_date",
  "travel_end_date",
  "hotel_category",
  "room_type",
  "currency",
  "language",
  "status",
  "commercial_status",
  "production_status",
  "japan_request_status",
  "payment_status",
  "booking_status",
  "total_selling_price_mad",
  "accepted_amount_mad",
  "accepted_at",
  "sent_at",
  "public_last_viewed_at",
  "public_deposit_mad",
  "deposit_requested_at",
  "deposit_paid_at",
  "converted_booking_id",
  "price_per_person_mad",
  "payment_conditions",
  "cancellation_conditions",
  "booking_conditions",
  "inclusions",
  "exclusions",
  "valid_until",
  "client_notes",
  "share_token",
  "share_enabled",
  "quote_channel",
  "partner_organization_id",
  "partner_branding_mode",
  "partner_contact_name",
  "requires_lejapon_approval",
  "approval_reason",
  "production_public_note",
  "owner_user_id",
  "duplicated_from_id",
  "quote_group_id",
  "quote_family_reference",
  "version_number",
  "previous_version_id",
  "is_current_version",
  "version_created_at",
  "version_created_by",
  "archived_at",
  "archived_by",
  "created_by",
  "deleted_at",
  "deleted_by",
  "created_at",
  "updated_at",
].join(",");

export const PARTNER_FIT_DAY_COLUMNS = [
  "id",
  "quote_id",
  "template_id",
  "day_number",
  "sort_order",
  "date",
  "title",
  "city",
  "description_client",
  "client_summary",
  "sales_summary",
  "optimized_client_description",
  "client_highlights",
  "client_inclusions",
  "client_options",
  "visits",
  "optional_visits",
  "rhythm",
  "day_pace",
  "transport_type",
  "transport_modes",
  "meal_notes",
  "meals",
  "meal_plan",
  "selling_price_mad",
  "image_urls",
  "metadata",
].join(",");

export const PARTNER_TEMPLATE_COLUMNS = [
  "id",
  "source_template_id",
  "title",
  "city",
  "theme",
  "day_pace",
  "sales_summary",
  "description_client",
  "optimized_client_description",
  "client_highlights",
  "client_inclusions",
  "client_options",
  "transport_modes",
  "meal_plan",
  "image_urls",
  "partner_net_price_mad",
  "min_travelers",
  "max_travelers",
  "valid_from",
  "valid_until",
  "is_published",
].join(",");

export const PARTNER_COMPONENT_COLUMNS = [
  "id",
  "partner_template_id",
  "sort_order",
  "component_type",
  "title",
  "description_client",
  "category",
  "is_required",
  "can_partner_disable",
  "partner_visible",
  "affects_partner_net_price",
  "net_price_impact",
  "client_text_when_enabled",
  "client_text_when_disabled",
].join(",");

export const QUOTE_COMPONENT_COLUMNS = [
  "id",
  "quote_day_id",
  "source_component_id",
  "component_type",
  "title",
  "description_client",
  "category",
  "net_price_impact",
  "is_required",
  "can_partner_disable",
  "enabled",
  "partner_visible",
  "affects_partner_net_price",
  "client_text_when_enabled",
  "client_text_when_disabled",
].join(",");

export const partnerQuoteNumber = () => {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PFIT-${day}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
};

export const partnerShareToken = () => crypto.randomUUID().replaceAll("-", "").slice(0, 24);

export const numberValue = (value: unknown) => Number(value || 0) || 0;

export const listItems = (value: unknown) => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value ?? "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
};

export const uniqueList = (items: unknown[], max = 12) => {
  const seen = new Set<string>();
  const result: string[] = [];
  items.flatMap(listItems).forEach((item) => {
    const key = item.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result.slice(0, max);
};

export const calculateDayNet = (day: any, components: any[]) => {
  const base = numberValue(day?.metadata?.partner_base_net_price_mad ?? day?.selling_price_mad);
  const pricedComponents = components
    .filter((component) => component.quote_day_id === day.id)
    .filter((component) => component.partner_visible !== false && component.affects_partner_net_price !== false && numberValue(component.net_price_impact) > 0);

  if (!pricedComponents.length) return Math.max(0, Math.round(base));

  const enabledTotal = pricedComponents
    .filter((component) => component.enabled !== false)
    .reduce((sum, component) => sum + numberValue(component.net_price_impact), 0);
  return Math.max(0, Math.round(enabledTotal));
};

export const calculatePartnerPricing = ({
  days,
  components,
  travelers,
  marginType,
  marginValue,
  manualAdjustment = 0,
  minMarginValue = 0,
  requiresApprovalBelowMargin = true,
}: {
  days: any[];
  components: any[];
  travelers: number;
  marginType: PartnerMarginType;
  marginValue: number;
  manualAdjustment?: number;
  minMarginValue?: number;
  requiresApprovalBelowMargin?: boolean;
}) => {
  const netPartnerTotal = days.reduce((sum, day) => sum + calculateDayNet(day, components), 0);
  const partnerMarginTotal = marginType === "fixed"
    ? numberValue(marginValue)
    : Math.round((netPartnerTotal * numberValue(marginValue)) / 100);
  const clientSaleTotal = Math.max(0, Math.round(netPartnerTotal + partnerMarginTotal + numberValue(manualAdjustment)));
  const pax = Math.max(1, numberValue(travelers));
  const approvalRequired = partnerMarginTotal < numberValue(minMarginValue) && requiresApprovalBelowMargin;
  return {
    netPartnerTotal,
    partnerMarginTotal,
    clientSaleTotal,
    clientSalePerPerson: clientSaleTotal / pax,
    approvalRequired,
    approvalReason: approvalRequired ? "Marge partenaire inférieure au minimum autorisé" : null,
  };
};

export const clientListsFromComponents = (day: any, components: any[]) => {
  const dayComponents = components.filter((component) => component.quote_day_id === day.id && component.partner_visible !== false);
  const enabled = dayComponents.filter((component) => component.enabled !== false);
  const disabled = dayComponents.filter((component) => component.enabled === false);
  const disabledKeys = new Set(disabled.flatMap((component) => [
    component.title,
    component.client_text_when_enabled,
  ]).flatMap(listItems).map((item) => item.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean));
  const inclusions = uniqueList([
    ...listItems(day.client_inclusions),
    ...enabled.map((component) => component.client_text_when_enabled || component.title),
  ], 8).filter((item) => !disabledKeys.has(item.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()));
  const options = uniqueList([
    ...listItems(day.client_options),
    ...disabled.map((component) => component.client_text_when_disabled).filter(Boolean),
  ], 6);
  const transport = uniqueList(enabled.filter((component) => ["transport", "train", "shinkansen"].includes(component.component_type)).map((component) => component.title), 4);
  const meals = uniqueList(enabled.filter((component) => component.component_type === "meal").map((component) => component.title), 4);
  return {
    client_inclusions: inclusions,
    client_options: options,
    transport_modes: transport.length ? transport : day.transport_modes,
    meal_plan: meals.length ? meals : day.meal_plan,
  };
};
