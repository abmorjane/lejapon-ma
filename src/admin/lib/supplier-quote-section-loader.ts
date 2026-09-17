export const supplierQuoteSectionTables = {
  hotels: "supplier_quote_hotel_rows",
  transport: "supplier_quote_transport_rows",
  activities: "supplier_quote_activity_rows",
  guides: "supplier_quote_guide_rows",
  other: "supplier_quote_other_rows",
} as const;

export type SupplierQuoteSection = keyof typeof supplierQuoteSectionTables;

export type SupplierQuoteSectionResult = {
  section: SupplierQuoteSection;
} & (
  | { data: Record<string, unknown>[]; error: null }
  | { data: null; error: unknown }
);

// Preserve the difference between a successful empty result and a failed read.
// Catch rejected requests as well as PostgREST error responses so one failed
// section does not hide the successful reads from the other four sections.
export async function loadSupplierQuoteSections(client: { from: (table: string) => any }, quoteId: string): Promise<SupplierQuoteSectionResult[]> {
  return Promise.all((Object.keys(supplierQuoteSectionTables) as SupplierQuoteSection[]).map(async (section) => {
    try {
      const { data, error } = await client.from(supplierQuoteSectionTables[section])
        .select("*").eq("quote_id", quoteId).order("sort_order", { ascending: true });
      if (error) return { section, data: null, error };
      if (!Array.isArray(data)) return { section, data: null, error: new Error("Réponse de lignes invalide : aucune liste reçue.") };
      return { section, data, error: null };
    } catch (error) {
      return { section, data: null, error };
    }
  }));
}
