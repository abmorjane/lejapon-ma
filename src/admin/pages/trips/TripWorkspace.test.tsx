import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TripWorkspace from "./TripWorkspace";

const mocks = vi.hoisted(() => ({ from: vi.fn(), signedUrl: vi.fn(), can: vi.fn(), archived: false, bookingError: null as any, allowed: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, storage: { from: () => ({ createSignedUrl: mocks.signedUrl }) } } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ can: mocks.can }) }));
vi.mock("./ops/OpsParticipants", () => ({ default: () => <p>Existing participants module</p> }));
vi.mock("./ops/OpsRooms", () => ({ default: () => <p>Existing rooms module</p> }));
vi.mock("./TripOperations", () => ({ default: () => <p>Existing operations module</p> }));
vi.mock("../FlightTickets", () => ({ default: ({ initialTripId }: any) => <p data-trip-id={initialTripId}>Existing flights module</p> }));
vi.mock("../supplier/SupplierTripCosts", () => ({ default: () => <p>Existing supplier quote engine</p> }));

const records: Record<string, any[]> = {
  trips: [{ id: "trip", title: "VOYAGE EN NOVEMBRE 2026", label: "Circuit", season: "Automne", start_date: "2026-11-01", end_date: "2026-11-14", status: "open", total_slots: 20, slots_left: 7, archived_at: null }],
  bookings: [{ id: "booking", trip_id: "trip", reference: "BK-1", contact_name: "Client A", status: "confirmed", num_adults: 1, num_children: 0, total_amount_mad: 1000, paid_amount_mad: 500, metadata: {} }],
  booking_participants: [{ id: "participant", booking_id: "booking", trip_id: "trip", first_name: "Aya", last_name: "Sato", passport_no: null }],
  supplier_trip_quotes: [{ id: "quote", trip_id: "trip", supplier_id: "supplier", status: "submitted", version_number: 3, supplier_execution_status: "to_book", supplier_total_jpy: 2000, final_total_mad: 300 }],
  trip_suppliers: [{ supplier_id: "supplier", status: "active", suppliers: { id: "supplier", name: "Tapis Volant" } }],
  trip_documents: [],
  operation_tasks: [{ id: "task", trip_id: "trip", title: "Relancer", status: "pending", deadline: "2020-01-01" }],
  trip_hotels: [], trip_rooms: [], room_assignments: [],
  visa_applications: [{ id: "visa", booking_id: "booking", reference: "VISA-1", status: "draft" }],
  booking_flight_reservations: [],
};

function renderPath(path: string) {
  return render(<MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><Routes><Route path="/admin/trips/:tripId/workspace/:tab?" element={<TripWorkspace />} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.archived = false; mocks.bookingError = null; mocks.allowed = true;
  mocks.can.mockImplementation(() => mocks.allowed);
  mocks.signedUrl.mockResolvedValue({ data: { signedUrl: "https://example.invalid/private-document" }, error: null });
  records.trip_documents = [];
  mocks.from.mockImplementation((table: string) => {
    const rows = table === "trips" ? records.trips.map(row => ({ ...row, archived_at: mocks.archived ? "2026-12-01T00:00:00Z" : null })) : records[table] ?? [];
    const error = table === "bookings" ? mocks.bookingError : null;
    const query: any = { count: error ? null : rows.length };
    for (const method of ["select", "eq", "neq", "not", "in", "is", "order", "limit"]) query[method] = vi.fn(() => query);
    query.maybeSingle = vi.fn(async () => ({ data: error ? null : rows[0] ?? null, error, count: error ? null : rows.length }));
    query.then = (resolve: (value: any) => unknown) => Promise.resolve({ data: error ? null : rows, error, count: error ? null : rows.length }).then(resolve);
    return query;
  });
});
afterEach(() => cleanup());

describe("trip workspace shell", () => {
  it("loads the requested trip and links action alerts to refresh-safe tabs", async () => {
    renderPath("/admin/trips/trip/workspace/overview");
    expect(await screen.findByRole("heading", { name: "VOYAGE EN NOVEMBRE 2026" })).toBeInTheDocument();
    expect(screen.getByText("Tapis Volant")).toBeInTheDocument();
    expect(screen.getByText("Soumis · V3")).toBeInTheDocument();
    expect(screen.getByText("Réservations non soldées").closest("a")).toHaveAttribute("href", "/admin/trips/trip/workspace/reservations");
    expect(screen.getByText("Vols à réserver ou compléter").closest("a")).toHaveAttribute("href", "/admin/trips/trip/workspace/flights");
    expect(screen.getByText("Devis fournisseur à revoir").closest("a")).toHaveAttribute("href", "/admin/trips/trip/workspace/supplier");
  });

  it("shows scoped finance on a direct-tab refresh without treating unknown as zero", async () => {
    renderPath("/admin/trips/trip/workspace/finance");
    const heading = await screen.findByText("Chiffre d’affaires engagé");
    expect(heading.parentElement).toHaveTextContent("1 000 MAD");
    expect(screen.getByText("Marge prévisionnelle").parentElement).toHaveTextContent("700 MAD");
    cleanup();
    mocks.bookingError = { code: "42501", message: "permission denied" };
    renderPath("/admin/trips/trip/workspace/finance");
    expect((await screen.findByText("Chiffre d’affaires engagé")).parentElement).toHaveTextContent("CA non disponible");
    expect(screen.queryByText("-300 MAD")).not.toBeInTheDocument();
  });

  it("mounts existing heavy modules only for the selected tab", async () => {
    renderPath("/admin/trips/trip/workspace/supplier");
    expect(await screen.findByText("Existing supplier quote engine")).toBeInTheDocument();
    expect(screen.queryByText("Existing operations module")).not.toBeInTheDocument();
  });

  it.each([
    ["participants", "Existing participants module"], ["flights", "Existing flights module"],
    ["hotels", "Existing rooms module"], ["operations", "Existing operations module"],
  ])("supports a direct refresh on the %s tab", async (tab, expected) => {
    renderPath(`/admin/trips/trip/workspace/${tab}`);
    expect(await screen.findByText(expected)).toBeInTheDocument();
    if (tab === "flights") expect(screen.getByText(expected)).toHaveAttribute("data-trip-id", "trip");
  });

  it("opens private trip documents with the existing signed-storage path", async () => {
    records.trip_documents = [{ id: "document", title: "Voucher hôtel", file_name: "voucher.pdf", file_path: "trip/hotel/voucher.pdf", category: "hotel", version: 2 }];
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderPath("/admin/trips/trip/workspace/documents");
    await screen.findByText("Voucher hôtel");
    fireEvent.click(screen.getByRole("button", { name: "Ouvrir" }));
    await waitFor(() => expect(mocks.signedUrl).toHaveBeenCalledWith("trip/hotel/voucher.pdf", 3600));
    expect(open).toHaveBeenCalledWith("https://example.invalid/private-document", "_blank", "noopener,noreferrer");
  });

  it("keeps archived trips readable without mounting participant editing controls", async () => {
    mocks.archived = true;
    renderPath("/admin/trips/trip/workspace/participants");
    expect(await screen.findByText(/Voyage archivé/)).toBeInTheDocument();
    expect(screen.getByText("Participants archivés")).toBeInTheDocument();
    expect(screen.getByText("Aya Sato")).toBeInTheDocument();
    expect(screen.queryByText("Existing participants module")).not.toBeInTheDocument();
  });

  it("preserves module permissions inside the workspace", async () => {
    mocks.allowed = false;
    renderPath("/admin/trips/trip/workspace/finance");
    expect(await screen.findByText("Accès restreint")).toBeInTheDocument();
    expect(screen.queryByText("Chiffre d’affaires engagé")).not.toBeInTheDocument();
  });
});
