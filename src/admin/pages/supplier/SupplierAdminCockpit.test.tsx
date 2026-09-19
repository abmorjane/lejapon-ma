import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupplierTripCosts from "./SupplierTripCosts";
import AdminSupplierQuote from "../AdminSupplierQuote";
import { supplierQuoteSectionTables } from "@/admin/lib/supplier-quote-section-loader";
import { SupplierQuoteVersionHistory } from "./SupplierQuoteVersionHistory";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), error: vi.fn(), staff: false, quote: {} as any, line: {} as any, trip: {} as any, revenueError: false,
  user: { id: "actor" }, functions: { invoke: vi.fn(async () => ({ data: { ok: true }, error: null })) } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mocks.user, roles: mocks.staff ? ["admin"] : ["supplier"], isInternalStaff: mocks.staff }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn(), warning: vi.fn() } }));
const Location = () => <output aria-label="Current route">{useLocation().pathname}</output>;
function openPage(staff: boolean, path = staff ? "/admin/supplier-costs/trip/q3" : "/supplier/trips/trip/quote") {
  cleanup(); mocks.staff = staff;
  render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Location /><Routes>
    <Route path="/supplier/trips/:tripId/quote" element={<SupplierTripCosts />} />
    <Route path="/admin/supplier-costs/:tripId/:quoteId" element={<AdminSupplierQuote />} />
  </Routes></MemoryRouter>);
}
beforeEach(() => {
  mocks.staff = false; mocks.revenueError = false; vi.clearAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
  mocks.trip = { id: "trip", title: "Existing Tokyo", start_date: "2026-10-01", end_date: "2026-10-03", duration_days: 3, archived_at: null };
  mocks.quote = { id: "q3", trip_id: "trip", supplier_id: "a", version_number: 3, status: "draft", supplier_handling_percentage: 10, supplier_handling_categories: ["transport"], supplier_execution_status: "to_book", commission_percentage: 10, exchange_rate_jpy_mad: 0.1, participant_count: 2 };
  mocks.line = { id: "bus", quote_id: "q3", sort_order: 0, status: "todo", description: "Supplier bus", quantity: 2, unit_price_jpy: 500, review_status: "pending", included_in_total: true };
  mocks.from.mockImplementation((table: string) => {
    const filters: Record<string, any> = {}; let single = false;
    const query: any = {};
    for (const method of ["select", "in", "is", "order", "limit", "neq"]) query[method] = vi.fn(() => query);
    query.eq = vi.fn((key: string, value: any) => { filters[key] = value; return query; });
    query.maybeSingle = vi.fn(() => { single = true; return query; });
    query.then = (resolve: (value: unknown) => unknown) => {
      const version = Number(String(filters.id ?? "q3").replace("q", ""));
      const records: Record<string, any[]> = {
        supplier_members: [{ supplier_id: "a", suppliers: { name: "Supplier A" } }],
        trip_suppliers: [{ supplier_id: "a", suppliers: { name: "Supplier A" } }],
        suppliers: [{ id: "a", name: "Supplier A", status: "active" }, { id: "b", name: "Supplier B", status: "active" }],
        trips: [mocks.trip], supplier_trip_quotes: [{ ...mocks.quote, id: filters.id ?? "q3", version_number: version }],
        bookings: [{ id: "booking", status: "confirmed", total_amount_mad: 2000, metadata: {}, num_adults: 2 }],
        supplier_quote_transport_rows: [{ ...mocks.line, quote_id: filters.quote_id ?? "q3" }],
      };
      let rows = records[table] ?? [];
      if (table === "supplier_trip_quotes" && filters.supplier_id && filters.supplier_id !== mocks.quote.supplier_id) rows = [];
      if (table === "suppliers" && filters.id) rows = rows.filter(row => row.id === filters.id);
      const error = table === "bookings" && mocks.revenueError ? { code: "42501", message: "bookings permission denied" } : null;
      return Promise.resolve({ data: error ? null : single ? rows[0] ?? null : rows, error, count: rows.length }).then(resolve);
    };
    return query;
  });
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === "get_supplier_trip_workspace") return { data: { trip: mocks.trip, participants: [], rooms: [], documents: [] }, error: null };
    if (name === "get_supplier_trip_quote" || name === "get_supplier_quote_version_v2") return { data: mocks.quote, error: null };
    if (name === "get_supplier_quote_versions_v2") return { data: [1, 2, 3, 4].map(version => ({ ...mocks.quote, id: `q${version}`, version_number: version })), error: null };
    if (name === "supplier_save_trip_quote_v2") {
      mocks.line = { ...mocks.line, ...args.p_rows.transport[0] };
      mocks.quote = { ...mocks.quote, status: args.p_status, admin_feedback: null };
      return { data: mocks.quote, error: null };
    }
    if (name === "review_supplier_quote_v2") { mocks.quote = { ...mocks.quote, status: args.p_action, admin_feedback: args.p_feedback }; return { data: mocks.quote, error: null }; }
    if (name === "review_supplier_quote_line_v2") { mocks.line = { ...mocks.line, included_in_total: args.p_included, review_status: args.p_review_status }; return { data: mocks.line, error: null }; }
    if (name.startsWith("get_")) return { data: [], error: null };
    throw new Error(`Unexpected write: ${name}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
async function quoteReady() { await waitFor(() => expect(screen.getByDisplayValue("Supplier bus")).toBeInTheDocument()); }
async function selectReview(label: string) {
  const table = screen.getByDisplayValue("Supplier bus").closest("table")!;
  const review = within(table).getAllByRole("combobox").at(-1)!;
  fireEvent.keyDown(review, { key: "ArrowDown" });
  const option = await screen.findByRole("option", { name: label });
  await act(async () => { fireEvent.keyDown(option, { key: "Enter" }); });
}

describe("existing supplier quotation lifecycle through the admin cockpit", () => {
  it("submits, requests revision, resubmits, reviews and approves without operational blockers or price overwrites", async () => {
    openPage(false); await quoteReady();
    expect(screen.getByDisplayValue("500")).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Approuver le devis commercial" })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Soumettre" })); });
    await waitFor(() => expect(mocks.quote.status).toBe("submitted"));
    await waitFor(() => expect(screen.getByDisplayValue("500")).toBeDisabled());

    openPage(true); await quoteReady();
    expect(screen.getByLabelText("Current route")).toHaveTextContent("/admin/supplier-costs/trip/q3");
    expect(screen.getByRole("link", { name: "Retour aux Coûts fournisseurs" })).toHaveAttribute("href", "/admin/supplier-costs?tripId=trip");
    expect(screen.getByDisplayValue("500")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText("Motif de correction ou note de validation…"), { target: { value: "Review bus arrangements" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Demander une correction" })); });
    await waitFor(() => expect(mocks.quote.status).toBe("revision_requested"));

    openPage(false); await quoteReady();
    expect(screen.getByDisplayValue("500")).toBeEnabled();
    expect(screen.getByText(/Review bus arrangements/)).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("500"), { target: { value: "600" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Soumettre" })); });
    await waitFor(() => expect(mocks.quote.status).toBe("submitted"));

    openPage(true); await quoteReady();
    await selectReview("Approuvée");
    await waitFor(() => expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeEnabled());
    expect(screen.getByText("Approuvées (incluses)").parentElement).toHaveTextContent("1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Approuver le devis commercial" })); });
    await waitFor(() => expect(mocks.quote.status).toBe("approved"));
    expect(mocks.line.unit_price_jpy).toBe(600);
    const reviewArgs = mocks.rpc.mock.calls.find(([name]) => name === "review_supplier_quote_line_v2")![1];
    expect(reviewArgs).not.toHaveProperty("unit_price_jpy");
    expect(mocks.rpc.mock.calls.some(([name]) => /create_supplier_quote_version|import_supplier_quote_excel/.test(name))).toBe(false);

    openPage(false); await screen.findByText("Devis approuvé par LeJapon.ma");
    await waitFor(() => expect(screen.getByRole("tab", { name: "Vue opérationnelle" })).toHaveAttribute("data-state", "active"));
    expect(screen.getByRole("button", { name: "Soumettre" })).toBeDisabled();
    expect(screen.queryByText("Commission interne office JPY")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Bilan financier" })).not.toBeInTheDocument();
  }, 20000);

  it("retains supplier prices when excluded, and separates exclusion from a rejected review", async () => {
    mocks.quote.status = "submitted";
    openPage(true); await quoteReady();
    await selectReview("Rejetée");
    expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeDisabled();
    const table = screen.getByDisplayValue("Supplier bus").closest("table")!;
    await act(async () => { fireEvent.click(within(table).getByRole("checkbox")); });
    await waitFor(() => expect(screen.getByText("Exclues du total").parentElement).toHaveTextContent("1"));
    expect(screen.getByDisplayValue("500")).toHaveValue(500);
    expect(mocks.line.unit_price_jpy).toBe(500);
    expect(screen.getByText("Total fournisseur JPY").parentElement).toHaveTextContent("0 JPY");
    expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeEnabled();
  });

  it("opens a supplier B historical quote instead of the first assigned supplier's quote", async () => {
    mocks.quote.supplier_id = "b"; mocks.quote.status = "approved";
    openPage(true, "/admin/supplier-costs/trip/q2"); await quoteReady();
    expect(screen.getAllByText(/Supplier B ·/)[0]).toBeInTheDocument();
    expect(mocks.rpc).toHaveBeenCalledWith("get_supplier_quote_versions_v2", { p_trip_id: "trip", p_supplier_id: "b" });
    expect(screen.queryByText("Fournisseur assigné au devis")).not.toBeInTheDocument();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "assign_supplier_trip_quote_v2")).toBe(false);
  });

  it("blocks final approval while a line-review write is still pending", async () => {
    mocks.quote.status = "submitted"; mocks.line.review_status = "approved";
    openPage(true); await quoteReady();
    const original = mocks.rpc.getMockImplementation()!;
    let finish!: (value: any) => void;
    mocks.rpc.mockImplementation((name: string, args: any) => name === "review_supplier_quote_line_v2" ? new Promise(resolve => { finish = resolve; }) : original(name, args));
    const table = screen.getByDisplayValue("Supplier bus").closest("table")!;
    fireEvent.click(within(table).getByRole("checkbox"));
    expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeDisabled();
    await act(async () => { finish({ data: {}, error: null }); });
    expect(screen.getByRole("button", { name: "Approuver le devis commercial" })).toBeEnabled();
    expect(mocks.rpc.mock.calls.some(([name]) => name === "review_supplier_quote_v2")).toBe(false);
  });

  it("version selection stays inside /admin and uses the requested version", async () => {
    mocks.quote.status = "submitted";
    openPage(true); await quoteReady();
    const card = screen.getByText("Versions du devis fournisseur").closest(".p-4")!;
    fireEvent.keyDown(within(card as HTMLElement).getByRole("combobox"), { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: /^V2 / }), { key: "Enter" });
    await waitFor(() => expect(screen.getByLabelText("Current route")).toHaveTextContent("/admin/supplier-costs/trip/q2"));
    await quoteReady();
    expect(screen.getAllByText("V2 · Soumis")[0]).toBeInTheDocument();
    expect(mocks.rpc.mock.calls.every(([name]) => name.startsWith("get_"))).toBe(true);
  });

  it("shows the bookings read error and unknown revenue rather than a fake loss", async () => {
    mocks.revenueError = true; vi.spyOn(console, "error").mockImplementation(() => {});
    openPage(true); await quoteReady();
    await act(async () => { fireEvent.mouseDown(screen.getByRole("tab", { name: "Bilan financier" }), { button: 0, ctrlKey: false }); });
    expect(await screen.findByRole("alert")).toHaveTextContent("bookings permission denied");
    expect(screen.getByText("CA MAD").parentElement).toHaveTextContent("CA non disponible");
    expect(screen.getByText("Marge brute MAD").parentElement).toHaveTextContent("Indisponible");
  });

  it("does not elevate a supplier by entering the admin route", async () => {
    openPage(false, "/admin/supplier-costs/trip/q3");
    expect(await screen.findByText("Accès réservé au personnel LeJapon.ma.")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("preserves archived supplier read-only operations and quotation controls", async () => {
    mocks.trip.archived_at = "2026-09-17"; mocks.quote.status = "revision_requested";
    openPage(false); await quoteReady();
    expect(screen.getByDisplayValue("500")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Soumettre" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Créer une nouvelle version" })).toBeDisabled();
  });
});

it("keeps complete history grouped including handling and collapsed by default", () => {
  render(<SupplierQuoteVersionHistory previousVersion={2} changes={[{ section: "hotels", kind: "added", detail: "Hotel A" }, { section: "handling", kind: "changed", detail: "Scope changed" }]} />);
  expect(screen.getByText(/1 ajout\(s\).*1 modification/)).toBeInTheDocument();
  expect(screen.getByText("Évolutions depuis V2").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText("Scope changed")).toBeInTheDocument();
  expect(screen.getByText("Scope changed").closest("details")).not.toHaveAttribute("open");
});
