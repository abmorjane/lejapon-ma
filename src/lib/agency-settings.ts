import { supabase } from "@/integrations/supabase/client";

export type AgencySettings = {
  id?: string;
  agency_display_name: string;
  legal_company_name: string;
  brand_name: string;
  address_line_1: string;
  address_line_2?: string | null;
  city: string;
  country: string;
  postal_code: string;
  ice: string;
  email: string;
  phone: string;
  website?: string | null;
  logo_url?: string | null;
  stamp_signature_url?: string | null;
  manager_name: string;
  manager_title?: string | null;
};

export const DEFAULT_AGENCY_SETTINGS: AgencySettings = {
  agency_display_name: "Moroccan Express Travel and Events / LeJapon.ma",
  legal_company_name: "Moroccan Express Travel and Events",
  brand_name: "LeJapon.ma",
  address_line_1: "Rue Annour, Hay El Wifaq",
  address_line_2: null,
  city: "Temara",
  country: "Morocco",
  postal_code: "12040",
  ice: "000045023000080",
  email: "info@lejapon.ma",
  phone: "+212 711 449 838",
  website: null,
  logo_url: null,
  stamp_signature_url: null,
  manager_name: "Abderrahman MORJANE",
  manager_title: null,
};

export function normalizeAgencySettings(row?: Partial<AgencySettings> | null): AgencySettings {
  return {
    ...DEFAULT_AGENCY_SETTINGS,
    ...(row ?? {}),
  };
}

export async function fetchAgencySettings(): Promise<AgencySettings> {
  const { data, error } = await supabase
    .from("agency_settings" as any)
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error || !data) return DEFAULT_AGENCY_SETTINGS;
  return normalizeAgencySettings(data as Partial<AgencySettings>);
}

export function agencyAddressLine(agency: Partial<AgencySettings>) {
  return [
    agency.address_line_1,
    agency.address_line_2,
    [agency.city, agency.country, agency.postal_code].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ");
}

export function agencyIceLine(agency: Partial<AgencySettings>) {
  return agency.ice ? `ICE: ${agency.ice}` : "";
}
