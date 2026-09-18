import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SupplierTripCosts from "./SupplierTripCosts";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), rpc: vi.fn(), error: vi.fn(), warning: vi.fn(),
  upsert: vi.fn(), signedUrl: vi.fn(), remove: vi.fn(), upload: vi.fn(),
  storage: { from: vi.fn() }, archived: false,
  errors: {} as Record<string, any>, mutationResult: { data: { id: "document" }, error: null } as any,
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "supplier-user" }, roles: ["supplier"], isInternalStaff: false }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn(), warning: mocks.warning } }));

const quote = { id: "existing-v3", version_number: 3, trip_id: "trip", supplier_id: "supplier", status: "draft", supplier_handling_percentage: 0, supplier_handling_categories: [] };
const records: Record<string, any[]> = {
  supplier_members: [{ supplier_id: "supplier", suppliers: { name: "Supplier A" } }],
  trip_suppliers: [{ supplier_id: "supplier" }],
  trip_messages: [{ id: "message", trip_id: "trip", body: "Existing trip message", message_type: "general", sender_id: "staff-user", created_at: "2026-09-18T00:00:00Z" }],
  trip_message_attachments: [{ id: "attachment", message_id: "message", file_name: "plan.pdf", file_path: "trip/message/plan.pdf" }],
  trip_message_reads: [],
  trip_documents: [{ id: "document", trip_id: "trip", category: "other", title: "Existing trip document", file_name: "document.pdf", file_path: "trip/other/document.pdf", uploaded_by: "supplier-user", uploaded_at: "2026-09-18T00:00:00Z", version: 1 }],
};
const openTab = async (name: RegExp) => fireEvent.mouseDown(await screen.findByRole("tab", { name }), { button: 0, ctrlKey: false });
const renderPage = () => render(<MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={["/supplier/trips/trip"]}>
  <Routes><Route path="/supplier/trips/:tripId" element={<SupplierTripCosts />} /></Routes>
</MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.archived = false;
  mocks.errors = {};
  mocks.mutationResult = { data: { id: "document" }, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.upsert.mockResolvedValue({ data: [], error: null });
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: "https://example.invalid/signed-file" }, error: null });
  mocks.remove.mockResolvedValue({ data: [], error: null });
  mocks.upload.mockResolvedValue({ data: {}, error: null });
  mocks.storage.from.mockReturnValue({ createSignedUrl: mocks.signedUrl, remove: mocks.remove, upload: mocks.upload });
  mocks.rpc.mockImplementation(async (name: string) => {
    if (name === "get_supplier_trip_workspace") return { data: { trip: { id: "trip", title: "Audit trip", archived_at: mocks.archived ? "2026-09-18T00:00:00Z" : null } }, error: null };
    if (["get_supplier_trip_quote", "get_supplier_quote_version_v2"].includes(name)) return { data: quote, error: null };
    if (name === "get_supplier_quote_versions_v2") return { data: [quote], error: null };
    return { data: [], error: null };
  });
  mocks.from.mockImplementation((table: string) => {
    let mutation = false;
    const result = () => mutation ? mocks.mutationResult : { data: mocks.errors[table] ? null : records[table] ?? [], error: mocks.errors[table] ?? null };
    const query: any = {};
    for (const method of ["select", "eq", "in", "is", "order"]) query[method] = vi.fn(() => query);
    query.update = vi.fn(() => { mutation = true; return query; });
    query.upsert = mocks.upsert;
    query.maybeSingle = vi.fn(async () => result());
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return query;
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("existing Messages/Documents backend integration", () => {
  it.each(["trip_messages", "trip_message_attachments", "trip_message_reads", "trip_documents"])("surfaces %s query errors without displaying a false empty result", async (table) => {
    mocks.errors[table] = { code: "42501", message: `permission denied for ${table}` };
    renderPage();
    await openTab(table === "trip_documents" ? /Documents/ : /Messages/);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("42501"));
    expect(screen.getByRole("alert")).toHaveTextContent(table);
    expect(screen.queryByText(/^Aucun (message|document)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 (message|document)/)).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalled();
  });

  it("clears the missing-migration warning naturally after a successful document retry", async () => {
    mocks.errors.trip_documents = { code: "42P01", message: "relation trip_documents does not exist" };
    renderPage();
    await openTab(/Documents/);
    await waitFor(() => expect(screen.getByText(/Migration SQL du centre documents/)).toBeInTheDocument());
    delete mocks.errors.trip_documents;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer les documents" }));
    await waitFor(() => expect(screen.getByText("Existing trip document")).toBeInTheDocument());
    expect(screen.queryByText(/Migration SQL du centre documents/)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces private-file signing errors instead of silently dropping file access", async () => {
    mocks.signedUrl.mockResolvedValue({ data: null, error: { code: "403", message: "private-file permission denied" } });
    renderPage();
    await openTab(/Documents/);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("private-file permission denied"));
    expect(screen.queryByText(/^Aucun document/)).not.toBeInTheDocument();
  });

  it("loads archived messages and files without attempting supplier read-receipt writes", async () => {
    mocks.archived = true;
    renderPage();
    await openTab(/Messages/);
    await waitFor(() => expect(screen.getByText("Existing trip message")).toBeInTheDocument());
    expect(screen.getByText("plan.pdf").closest("a")).toHaveAttribute("href", "https://example.invalid/signed-file");
    expect(screen.getByRole("button", { name: "Envoyer le message" })).toBeDisabled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("marks active messages read and displays a real receipt error if that write fails", async () => {
    mocks.upsert.mockResolvedValue({ data: null, error: { code: "42501", message: "receipt permission denied" } });
    renderPage();
    await openTab(/Messages/);
    await waitFor(() => expect(screen.getByText("Existing trip message")).toBeInTheDocument());
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    expect(screen.getByRole("alert")).toHaveTextContent("receipt permission denied");
  });

  it("does not delete a file when an RLS-filtered document update affects no rows", async () => {
    mocks.mutationResult = { data: null, error: null };
    renderPage();
    await openTab(/Documents/);
    await waitFor(() => expect(screen.getByText("Existing trip document")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Supprimer le document" }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("Document non supprimé")));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("preserves the old file when document replacement metadata is rejected", async () => {
    mocks.mutationResult = { data: null, error: { code: "42501", message: "replacement permission denied" } };
    renderPage();
    await openTab(/Documents/);
    await waitFor(() => expect(screen.getByText("Existing trip document")).toBeInTheDocument());
    const fileInput = screen.getByText("Remplacer").querySelector("input")!;
    fireEvent.change(fileInput, { target: { files: [new File(["synthetic"], "new.pdf", { type: "application/pdf" })] } });
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("replacement permission denied")));
    expect(mocks.upload).toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(screen.getByText("Existing trip document")).toBeInTheDocument();
  });
});
