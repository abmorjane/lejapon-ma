import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupplierCosts from "./SupplierCosts";
import { FinancialDashboard } from "./supplier/SupplierTripCosts";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), failRows: false, legacyHandling: false }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff" }, isInternalStaff: true, roles: ["admin"] }) }));
const versions = [1, 2, 3, 4, 5].map(version => ({ id: `a${version}`, trip_id: "trip", supplier_id: "a", version_number: version, status: version === 5 ? "submitted" : "archived", participant_count: 19, supplier_handling_percentage: 10, supplier_handling_categories: ["hotels", "transport"], commission_percentage: 10, exchange_rate_jpy_mad: 0.1 }));

beforeEach(() => {
  mocks.failRows = false; mocks.legacyHandling = false;
  mocks.from.mockImplementation((table: string) => {
    const records: Record<string, any[]> = {
      trips: [{ id: "trip", title: "Tokyo", archived_at: null }], suppliers: [{ id: "a", name: "Tapis Volant LLC" }, { id: "b", name: "Supplier B" }],
      supplier_trip_quotes: [...versions.map(quote => mocks.legacyHandling ? { ...quote, supplier_handling_percentage: 0, supplier_handling_categories: [], validation_metadata: { excel_import: { financial_summary: { supplierHandlingPercentage: 10 } } } } : quote), { id: "b1", trip_id: "trip", supplier_id: "b", version_number: 1, status: "draft" }],
      supplier_quote_hotel_rows: [{ id: "hotel", quote_id: "a5", person_count: 1, nights: 1, price_per_person_per_night_jpy: 7000000 }],
      supplier_quote_transport_rows: [{ id: "bus", quote_id: "a5", quantity: 1, unit_price_jpy: 2827000 }],
      supplier_quote_activity_rows: [{ id: "excluded", quote_id: "a5", participant_count: 1, unit_price_jpy: 900000, included_in_total: false }],
      supplier_quote_other_rows: mocks.legacyHandling ? [{ id: "handling", quote_id: "a5", quantity: 1, unit_price_jpy: 982700, label: "Tapis volant Handling" }] : [],
      supplier_day_costs: [{ id: "legacy", supplier_id: "a", day_number: 1, hotel_cost: 100, total_cost: 100 }],
    };
    const query: any = {};
    for (const method of ["select", "eq", "in", "order"]) query[method] = vi.fn(() => query);
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.failRows && table === "supplier_quote_hotel_rows" ? { data: null, error: { code: "42501", message: "permission denied" } } : { data: records[table] ?? [], error: null, count: (records[table] ?? []).length }).then(resolve);
    return query;
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("admin supplier costs dossiers", () => {
  it("shows one card per supplier, every version link and the current scoped financial model", async () => {
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/admin/supplier-costs?tripId=trip"]}><SupplierCosts /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Lignes devis")[0].parentElement).toHaveTextContent("3"));
    expect(screen.getAllByTestId("supplier-dossier")).toHaveLength(2);
    expect(screen.getAllByText("Tapis Volant LLC")).toHaveLength(1);
    const card = screen.getByText("Tapis Volant LLC").closest('[data-testid="supplier-dossier"]') as HTMLElement;
    expect(within(card).getByText("V5 · Soumis")).toBeInTheDocument();
    const metric = (label: string) => within(card).getByText(label).parentElement!.textContent!.replace(/[\s\u202f]/g, "");
    expect(metric("Sous-total services fournisseur")).toContain("9827000JPY");
    expect(metric("Montant handling fournisseur")).toContain("982700JPY");
    expect(metric("Total fournisseur")).toContain("10809700JPY");
    expect(metric("Commission interne office")).toContain("1080970JPY");
    expect(metric("Coût total interne JPY")).toContain("11890670JPY");
    expect(within(card).getByRole("link", { name: "Ouvrir ce devis" })).toHaveAttribute("href", "/admin/supplier-costs/trip/a5");
    for (const version of [1, 2, 3, 4, 5]) expect(within(card).getByRole("link", { name: `V${version}` })).toHaveAttribute("href", `/admin/supplier-costs/trip/a${version}`);
    expect(within(card).getByText("Anciennes saisies par jour (1)").parentElement).not.toHaveAttribute("open");
    expect(screen.queryByRole("link", { name: "Ouvrir quote engine" })).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("distinguishes historical Excel handling without double-counting or assigning a new scope", async () => {
    mocks.legacyHandling = true;
    render(<MemoryRouter initialEntries={["/admin/supplier-costs?tripId=trip"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><SupplierCosts /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText("Lignes devis")[0].parentElement).toHaveTextContent("4"));
    const card = screen.getByText("Tapis Volant LLC").closest('[data-testid="supplier-dossier"]') as HTMLElement;
    expect(within(card).getByText("Handling fournisseur (%)").parentElement).toHaveTextContent("10 % · historique");
    const normalized = (label: string) => within(card).getByText(label).parentElement!.textContent!.replace(/\s/g, "");
    expect(normalized("Sous-total services fournisseur")).toContain("9827000JPY");
    expect(normalized("Total fournisseur")).toContain("10809700JPY");
    expect(normalized("Montant handling fournisseur")).toContain("982700JPY");
    expect(within(card).getByText(/sans recalculer ni présumer le périmètre historique/)).toBeInTheDocument();
  });
  it("does not replace failed row reads with zero amounts/counts", async () => {
    mocks.failRows = true;
    render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/admin/supplier-costs?tripId=trip"]}><SupplierCosts /></MemoryRouter>);
    expect(await screen.findByRole("alert")).toHaveTextContent("42501");
    expect(screen.getAllByText("Lignes devis")[0].parentElement).toHaveTextContent("Indisponible");
    expect(screen.getAllByText("Total fournisseur")[0].parentElement).toHaveTextContent("Indisponible");
    expect(screen.queryByText("Aucun coût saisi pour ce voyage.")).not.toBeInTheDocument();
  });
});

const rows = { hotels: [], transport: [], activities: [], guides: [], other: [] };
const totals = { grandTotalJpy: 1000, legacyHandlingIncludedJpy: 0, handlingAmountJpy: 100, supplierTotalJpy: 1100, commissionAmountJpy: 110, finalTotalJpy: 1210, finalTotalMad: 121, costPerPersonMad: 121, costPerPersonJpy: 1210 };
describe("admin financial dashboard", () => {
  it("shows available revenue and the supplier/internal cost hierarchy separately", () => {
    render(<FinancialDashboard rows={rows} totals={totals} bookings={[]} participants={[]} exchangeRate={0.1} revenue={{ state: "available", amountMad: 1000, bookingCount: 1 }} />);
    expect(screen.getByText("CA MAD").parentElement).toHaveTextContent("1 000 MAD");
    expect(screen.getByText("Marge brute MAD").parentElement).toHaveTextContent("890 MAD");
    expect(screen.getByText("Résultat net prévisionnel").parentElement).toHaveTextContent("879 MAD");
    expect(screen.getByText("Handling fournisseur").parentElement).toHaveTextContent("100 JPY");
    expect(screen.getByText("Commission interne office").parentElement).toHaveTextContent("110 JPY");
  });
  it("shows unavailable revenue and neutral unavailable margins instead of an artificial loss", () => {
    render(<FinancialDashboard rows={rows} totals={totals} bookings={[]} participants={[]} exchangeRate={0.1} revenue={{ state: "unavailable", amountMad: null, reason: "42501 · permission denied" }} />);
    expect(screen.getByRole("alert")).toHaveTextContent("42501");
    expect(screen.getByText("Coût interne / participant").parentElement).toHaveTextContent("Indisponible");
    expect(screen.getByText("CA MAD").parentElement).toHaveTextContent("CA non disponible");
    const card = screen.getByText("Rentabilité prévisionnelle").closest('.p-4')!;
    expect(card.querySelectorAll('.text-red-700')).toHaveLength(0);
    expect(within(card as HTMLElement).getByText("Marge brute MAD").parentElement).toHaveTextContent("Indisponible");
  });
  it("keeps a genuine zero revenue distinct and shows the actual projected loss", () => {
    render(<FinancialDashboard rows={rows} totals={totals} bookings={[]} participants={[]} exchangeRate={0.1} revenue={{ state: "available", amountMad: 0, bookingCount: 0 }} />);
    expect(screen.getByText("CA MAD").parentElement).toHaveTextContent("0 MAD");
    expect(screen.getByText("Marge brute MAD").parentElement).toHaveTextContent("-110 MAD");
    expect(screen.getByText("Marge nette (%)").parentElement).toHaveTextContent("Indisponible");
  });
});
