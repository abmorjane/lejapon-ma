import { useEffect, useState } from "react";
import { DEFAULT_AGENCY_SETTINGS, fetchAgencySettings, type AgencySettings } from "@/lib/agency-settings";

export function useAgencySettings() {
  const [agency, setAgency] = useState<AgencySettings>(DEFAULT_AGENCY_SETTINGS);

  useEffect(() => {
    let cancelled = false;
    fetchAgencySettings().then((settings) => {
      if (!cancelled) setAgency(settings);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return agency;
}
