type AgencyAddress = { city: string; line: string };

// Only Témara has been approved as a public agency address. A departure from
// Casablanca must not be presented as another office, even if legacy CMS
// content still contains it.
export function confirmedPublicAgencyAddresses<T extends AgencyAddress>(
  addresses: readonly T[] | null | undefined,
): T[] {
  return (addresses ?? []).filter(({ city, line }) => {
    const normalizedCity = city.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    return (normalizedCity === "temara" || normalizedCity === "تمارة") && line.trim().length > 0;
  });
}
