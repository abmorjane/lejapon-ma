export type AgencyOrganizationStatus = "active" | "suspended" | "archived";
export type AgencyMemberStatus = "active" | "suspended";
export type AgencyMemberRole = "owner" | "admin" | "manager" | "agent" | "sales_agent" | "finance" | "accountant" | "operations" | "viewer";

export type AgencyOrganization = {
  id: string;
  type: "agency";
  status: AgencyOrganizationStatus;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string | null;
  metadata?: Record<string, any> | null;
};

export type AgencyMembership = {
  id: string;
  organization_id: string;
  user_id: string;
  role: AgencyMemberRole;
  status: AgencyMemberStatus;
  created_at: string | null;
  organization: AgencyOrganization;
};

export type AgencyProfile = {
  organization_id: string;
  agency_code: string | null;
  commercial_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  market_country: string | null;
  preferred_language: string | null;
  billing_legal_name: string | null;
  billing_email: string | null;
  billing_phone: string | null;
  billing_address_line_1: string | null;
  billing_address_line_2: string | null;
  billing_city: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  tax_identifier: string | null;
};

export type AgencyBooking = {
  id: string;
  reference: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string | null;
  status: string;
  total_amount_mad: number | null;
  paid_amount_mad: number | null;
  created_at: string;
  preferred_dates: string | null;
  trip_id: string | null;
  agency_organization_id: string | null;
  agency_attributed_at?: string | null;
  assigned_to?: string | null;
  num_adults?: number | null;
  num_children?: number | null;
  trips?: TripSummary | null;
};

export type CommissionRule = {
  id: string;
  organization_id: string;
  scope: "agency_default" | "global" | "destination" | "product" | "trip_override";
  rule_type: "percentage" | "fixed_amount";
  value: number;
  currency: string;
  destination: string | null;
  product_type: string | null;
  trip_id: string | null;
  status: "active" | "inactive" | "archived";
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
};

export type TripSummary = {
  id: string;
  title: string;
  start_date?: string | null;
  end_date?: string | null;
  destination?: string | null;
  base_price_mad?: number | null;
};
