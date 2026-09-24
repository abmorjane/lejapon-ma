import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OperationsCenter from "./OperationsCenter";

const today = new Date().toISOString();
const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const updates: Array<{ table: string; patch: any; ids: string[] }> = [];
let rows: Record<string, any[]>;

const baseRows = () => ({
  operation_tasks: [
    { id: "task-1", title: "Préparer les documents", description: "Dossier final", category: "final_documents", priority: "critical", status: "todo", assigned_to: "staff-1", booking_id: "booking-1", trip_id: "trip-1", deadline: today, trips: { id: "trip-1", title: "Japon novembre", archived_at: null } },
    { id: "task-1", title: "Préparer les documents", description: "Dossier final", category: "final_documents", priority: "critical", status: "todo", assigned_to: "staff-1", booking_id: "booking-1", trip_id: "trip-1", deadline: today, trips: { id: "trip-1", title: "Japon novembre", archived_at: null } },
    { id: "task-archived", title: "Ancienne tâche archivée", category: "general", priority: "high", status: "todo", trip_id: "trip-old", deadline: today, trips: { id: "trip-old", title: "Voyage archivé", archived_at: "2026-01-01" } },
  ],
  operation_checklist_items: [
    { id: "check-1", title: "Contrôler le passeport", category: "passport", priority: "high", status: "todo", assigned_to: null, deadline: today, operation_checklists: { id: "list-1", title: "Checklist LJ-100", booking_id: "booking-1", trip_id: "trip-1", trips: { id: "trip-1", title: "Japon novembre", archived_at: null } } },
  ],
  booking_flight_reservations: [{ id: "flight-1", booking_id: "booking-1", status: "not_booked", pnr: null, booking_platform: null, fare_amount: null, fare_currency: null, linked_traveler_count: 0, required_traveler_count: 1, ticket_sent_to_customer: false }],
  visa_applications: [], booking_participants: [], supplier_trip_quotes: [],
  supplier_quote_hotel_rows: [], supplier_quote_guide_rows: [], supplier_quote_transport_rows: [], agency_fit_requests: [],
  trips: [{ id: "trip-1", title: "Japon novembre", start_date: tomorrow, archived_at: null }],
  user_roles: [{ user_id: "staff-1", role: "admin" }], profiles: [{ id: "staff-1", full_name: "Équipe Test" }],
  bookings: [{ id: "booking-1", reference: "LJ-100", contact_name: "Client Test", trip_id: "trip-1", trips: { id: "trip-1", title: "Japon novembre", archived_at: null } }],
  operation_task_history: [], operation_checklist_history: [], operation_task_history_insert: [],
});

function queryFor(table: string) {
  let mode: "read" | "update" | "insert" = "read";
  let patch: any = null;
  const query: any = {
    select: () => query, not: () => query, order: () => query, limit: () => query,
    neq: () => query, is: () => query, gte: () => query, eq: () => query,
    in: (_column: string, ids: string[]) => { if (mode === "update") updates.push({ table, patch, ids }); return query; },
    update: (value: any) => { mode = "update"; patch = value; return query; },
    insert: () => { mode = "insert"; return query; },
    then: (resolve: (value: any) => void) => Promise.resolve({ data: mode === "read" ? rows[table] ?? [] : null, error: null }).then(resolve),
  };
  return query;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (table: string) => queryFor(table) } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff-1", email: "staff@test.local" } }) }));
vi.mock("@/admin/components/BookingQuickViewSheet", () => ({ BookingQuickViewSheet: () => null }));

beforeEach(() => { rows = baseRows(); updates.length = 0; });

describe("Operations Center task inbox", () => {
  it("affiche une seule fois chaque tâche, exclut les voyages archivés et utilise des libellés français", async () => {
    render(<MemoryRouter><OperationsCenter /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Operations Center" })).toBeInTheDocument();
    expect(await screen.findAllByText("Préparer les documents")).toHaveLength(1);
    expect(screen.getAllByText("Contrôler le passeport")).toHaveLength(1);
    expect(screen.queryByText("Ancienne tâche archivée")).not.toBeInTheDocument();
    expect(screen.queryByText("Flights to reserve")).not.toBeInTheDocument();
    expect(screen.queryByText("Critical alerts")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aujourd’hui 2" })).toBeInTheDocument();
    expect(screen.getByText("Prochains départs")).toBeInTheDocument();
  });

  it("sépare les actions de masse par table source", async () => {
    render(<MemoryRouter><OperationsCenter /></MemoryRouter>);
    await screen.findByText("Préparer les documents");
    fireEvent.click(screen.getByLabelText("Sélectionner Préparer les documents"));
    fireEvent.click(screen.getByLabelText("Sélectionner Contrôler le passeport"));
    const completeButtons = screen.getAllByRole("button", { name: /Terminer/i });
    fireEvent.click(completeButtons[completeButtons.length - 1]);
    await waitFor(() => expect(updates).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "operation_tasks", ids: ["task-1"] }),
      expect.objectContaining({ table: "operation_checklist_items", ids: ["check-1"] }),
    ])));
  });

  it("affiche un état vide propre", async () => {
    rows.operation_tasks = [];
    rows.operation_checklist_items = [];
    render(<MemoryRouter><OperationsCenter /></MemoryRouter>);
    expect(await screen.findByText("Aucune tâche active")).toBeInTheDocument();
  });
});
