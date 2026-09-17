import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupplierTripCosts, { QuoteTable } from "./SupplierTripCosts";
import { supplierQuoteSectionTables } from "@/admin/lib/supplier-quote-section-loader";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), error: vi.fn(), functions:{invoke:vi.fn(async()=>({data:{ok:true},error:null}))} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "supplier-user" }, roles: ["supplier"], isInternalStaff: false }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn(), warning: vi.fn() } }));

const sections = Object.keys(supplierQuoteSectionTables) as (keyof typeof supplierQuoteSectionTables)[];
const props = {
  canEdit: false, canReview: false, isAdmin: false, comments: [],
  onRowsChange: vi.fn(), onAdd: vi.fn(), onReview: vi.fn(), onAddComment: vi.fn(),
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("quote table loading states", () => {
  it.each(sections)("shows a real permission error instead of an empty %s table", (section) => {
    render(<QuoteTable {...props} section={section} rows={[]} loadError="42501 · permission denied for function supplier_can_access_quote" />);
    expect(screen.getByRole("alert")).toHaveTextContent("42501");
    expect(screen.queryByText(/^0 ligne/)).not.toBeInTheDocument();
    expect(screen.queryByText("Aucune ligne.")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows zero rows only after a successful empty read", () => {
    render(<QuoteTable {...props} section="hotels" rows={[]} />);
    expect(screen.getByText(/^0 ligne/)).toBeInTheDocument();
    expect(screen.getByText("Aucune ligne.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("confirms reservations after approval without changing supplier prices",()=>{
    const onReservationStatusChange=vi.fn();
    const onRowsChange=vi.fn();
    render(<QuoteTable {...props} section="transport" rows={[{id:"row",local_id:"row",sort_order:0,status:"todo",description:"Bus",quantity:1,unit_price_jpy:100}]} canConfirmReservations onReservationStatusChange={onReservationStatusChange} onRowsChange={onRowsChange}/>);
    fireEvent.click(screen.getByRole("button",{name:"Confirmer les réservations"}));
    expect(onReservationStatusChange).toHaveBeenCalledWith(null,"confirmed");
    expect(onRowsChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("100")).toBeDisabled();
  });

  it("does not show a stale row count during loading", () => {
    render(<QuoteTable {...props} section="hotels" rows={[]} loading />);
    expect(screen.getByRole("status")).toHaveTextContent("Chargement");
    expect(screen.queryByText(/^0 ligne/)).not.toBeInTheDocument();
  });
});

describe("supplier quote page reads", () => {
  let failHotels: boolean;
  const quote = { id: "existing-v3", version_number: 3, status: "draft", trip_id: "trip", supplier_id: "supplier",supplier_handling_percentage:0,supplier_handling_categories:[] };
  // Synthetic fixtures test the read/render path; these are not production V3 data.
  const fixtureCounts = { hotels: 20, transport: 20, activities: 19, guides: 11, other: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    failHotels = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockImplementation(async (name: string, args: any) => {
      if(name === "supplier_save_trip_quote_v2") return {data:{...quote,status:args.p_status,supplier_handling_percentage:args.p_payload.supplier_handling_percentage,supplier_handling_categories:args.p_payload.supplier_handling_categories},error:null};
      if (name === "get_supplier_trip_workspace") return { data: { trip: { id: "trip", title: "Test trip", start_date: "2026-10-01", end_date: "2026-10-03", duration_days: 3 } }, error: null };
      if (name === "get_supplier_trip_quote" || name === "get_supplier_quote_version_v2") return { data: quote, error: null };
      if (name === "get_supplier_quote_versions_v2") return { data: [quote], error: null };
      return { data: [], error: null };
    });
    mocks.from.mockImplementation((table: string) => {
      const query: any = {};
      for (const method of ["select", "eq", "in", "is", "order"]) query[method] = vi.fn(() => query);
      query.then = (resolve: (value: unknown) => unknown) => {
        if (table === "supplier_members") return Promise.resolve({ data: [{ supplier_id: "supplier", suppliers: { name: "Test supplier" } }], error: null }).then(resolve);
        if (table === "trip_suppliers") return Promise.resolve({ data: [{ supplier_id: "supplier" }], error: null }).then(resolve);
        const section = sections.find((key) => supplierQuoteSectionTables[key] === table);
        if (section === "hotels" && failHotels) return Promise.resolve({ data: null, error: { code: "42501", message: "permission denied for function supplier_can_access_quote" } }).then(resolve);
        const data = section ? Array.from({ length: fixtureCounts[section] }, (_, i) => ({
          id: `${section}-${i}`, quote_id: quote.id, sort_order: i, status: "todo",
          unit_price_jpy:10,daily_price_jpy:10,quantity:1,participant_count:1,rooms_count:1,room_count:1,nights:1,guides_count:1,guide_count:1,
          hotel_name: `Hotel ${i}`, description: `Transport ${i}`, activity_name: `Activity ${i}`, guide_type: `Guide ${i}`, label: `Other ${i}`,
        })) : [];
        return Promise.resolve({ data, error: null }).then(resolve);
      };
      return query;
    });
  });

  const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/supplier/trips/trip"]}>
    <Routes><Route path="/supplier/trips/:tripId" element={<SupplierTripCosts />} /></Routes>
  </MemoryRouter>);

  it("keeps persisted rows visible but blocks supplier writes when handling schema is unavailable",async()=>{
    failHotels=false;
    const previousRpc=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name:string,args:any)=>{
      if(name==="get_supplier_trip_quote") return {data:{id:quote.id,version_number:3,status:"draft",trip_id:"trip",supplier_id:"supplier"},error:null};
      return previousRpc(name,args);
    });
    renderPage();
    await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("conditions de handling"));
    expect(screen.getAllByRole("table")).toHaveLength(5);
    expect(screen.getByRole("button",{name:"Enregistrer"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Soumettre"})).toBeDisabled();
    expect(screen.getByRole("button",{name:"Importer Excel"})).toBeDisabled();
    expect(mocks.rpc.mock.calls.some(call=>call[0]==="supplier_save_trip_quote_v2")).toBe(false);
  },15000);

  it("submits financial terms with incomplete operations and sends scope without a client-calculated handling amount", async()=>{
    failHotels=false;
    renderPage();
    await waitFor(()=>expect(screen.getByRole("button",{name:"Soumettre"})).toBeEnabled());
    expect(screen.queryByText("Suivi opérationnel du voyage")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pourcentage handling fournisseur"),{target:{value:"10"}});
    expect(screen.getByRole("alert")).toHaveTextContent("catégorie");
    fireEvent.click(screen.getByLabelText("Hôtels"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Handling fournisseur JPY").parentElement).toHaveTextContent("20");
    fireEvent.click(screen.getByRole("button",{name:"Soumettre"}));
    await waitFor(()=>expect(mocks.rpc).toHaveBeenCalledWith("supplier_save_trip_quote_v2",expect.objectContaining({p_status:"submitted",p_payload:expect.objectContaining({supplier_handling_percentage:10,supplier_handling_categories:["hotels"]})})));
    const saveArgs=mocks.rpc.mock.calls.find(call=>call[0]==="supplier_save_trip_quote_v2")![1];
    expect(saveArgs.p_payload).not.toHaveProperty("supplier_handling_amount_jpy");
    expect(saveArgs.p_rows.hotels.every((row:any)=>row.status==="todo")).toBe(true);
    expect(saveArgs.p_payload.validation_snapshot.allComplete).toBe(false);
    expect(mocks.rpc.mock.calls.some(call=>call[0]==="review_supplier_quote_v2")).toBe(false);
  },20000);

  it("blocks saves and import on a failed section, then displays all categories after retry", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("42501"));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Soumettre" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importer Excel" })).toBeDisabled();
    expect(screen.queryByText(/^0 ligne/)).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledWith("Supplier quote section load failed", expect.objectContaining({ quoteId: "existing-v3", table: "supplier_quote_hotel_rows" }));
    failHotels = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer le chargement des lignes" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getAllByRole("table")).toHaveLength(5);
    for (const count of [19,11,1]) expect(screen.getByText(new RegExp(`^${count} ligne`))).toBeInTheDocument();
    expect(screen.getAllByText(/^20 ligne/)).toHaveLength(2);
    expect(screen.getByDisplayValue("Hotel 0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Transport 0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Activity 0")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Other 0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeEnabled();
    expect(mocks.rpc).toHaveBeenCalledWith("get_supplier_quote_version_v2", { p_quote_id: "existing-v3" });
    expect(mocks.rpc.mock.calls.some(([name]) => /save|import|create/.test(name))).toBe(false);
  }, 20000);

  it("does not turn a failed quote header read into a new editable draft", async () => {
    const implementation = mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation((name: string, ...args: unknown[]) => name === "get_supplier_trip_quote"
      ? Promise.resolve({ data: null, error: { code: "42501", message: "supplier trip access denied" } })
      : implementation(name, ...args));
    renderPage();
    await waitFor(() => expect(screen.getByText(/Le devis n’a pas pu être chargé/)).toHaveTextContent("42501"));
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Importer Excel" })).toBeDisabled();
    expect(screen.queryByText(/^0 ligne/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("table")).toHaveLength(0);
  });
});
