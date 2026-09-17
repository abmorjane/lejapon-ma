import { describe, expect, it, vi } from "vitest";
import { loadSupplierQuoteSections, supplierQuoteSectionTables } from "./supplier-quote-section-loader";

const makeClient = (response: (table: string) => unknown) => {
  const filters: unknown[][] = [];
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn((column: string, id: string) => {
        filters.push([table, column, id]);
        return { order: vi.fn(() => response(table)) };
      }),
    })),
  }));
  return { from, filters };
};

describe("supplier quote section reads", () => {
  it.each(["existing-v1", "existing-v2", "existing-v3", "existing-v4"])("queries all five categories for exactly %s", async (quoteId) => {
    const client = makeClient((table) => Promise.resolve({ data: [{ id: `${table}-row`, quote_id: quoteId }], error: null }));
    const results = await loadSupplierQuoteSections(client, quoteId);
    expect(results).toHaveLength(5);
    expect(client.filters).toEqual(Object.values(supplierQuoteSectionTables).map((table) => [table, "quote_id", quoteId]));
    expect(results.every((result) => result.error === null && result.data?.length === 1)).toBe(true);
  });

  it("distinguishes permission failure from a successful zero-row result and preserves other categories", async () => {
    const permissionError = { code: "42501", message: "permission denied for function supplier_can_access_quote" };
    const client = makeClient((table) => Promise.resolve(table === supplierQuoteSectionTables.hotels
      ? { data: null, error: permissionError }
      : { data: [], error: null }));
    const results = await loadSupplierQuoteSections(client, "existing-v3");
    expect(results[0]).toEqual({ section: "hotels", data: null, error: permissionError });
    expect(results.slice(1).every((result) => result.error === null && result.data?.length === 0)).toBe(true);
  });

  it("preserves network failures and rejects missing data without pretending the section is empty", async () => {
    const networkError = new Error("Network unavailable");
    const client = makeClient((table) => table === supplierQuoteSectionTables.hotels
      ? Promise.reject(networkError) : Promise.resolve({ data: null, error: null }));
    const results = await loadSupplierQuoteSections(client, "existing-v3");
    expect(results[0].error).toBe(networkError);
    expect(results.every((result) => result.data === null && result.error !== null)).toBe(true);
  });
});
