import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dashboard from "./Dashboard";

const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

const rows: Record<string, any[]> = {
  trips: [{ id: "trip-1", title: "Japon novembre", start_date: tomorrow, end_date: tomorrow, status: "open", archived_at: null }],
  bookings: [{
    id: "booking-1", reference: "LJ-100", contact_name: "Sofia Amane", status: "lead",
    total_amount_mad: 30_000, paid_amount_mad: 10_000, quote_adjustments: [], num_adults: 2,
    num_children: 0, created_at: new Date().toISOString(), trip_id: "trip-1",
    trips: { id: "trip-1", title: "Japon novembre", start_date: tomorrow, end_date: tomorrow, archived_at: null },
  }, {
    id: "booking-2", reference: "LJ-200", contact_name: "Solde Confirmé", status: "confirmed",
    total_amount_mad: 40_000, paid_amount_mad: 5_000, quote_adjustments: [], num_adults: 1,
    num_children: 0, created_at: new Date(Date.now() - 3_600_000).toISOString(), trip_id: "trip-1",
    trips: { id: "trip-1", title: "Japon novembre", start_date: tomorrow, end_date: tomorrow, archived_at: null },
  }],
  payments: [{ id: "payment-1", booking_id: "booking-1", amount_mad: 10_000, status: "received" }],
  operation_tasks: [{
    id: "task-1", title: "Relancer le client", priority: "critical", status: "todo",
    booking_id: "booking-1", deadline: yesterday,
  }],
  operation_checklist_items: [],
  booking_flight_reservations: [{ id: "flight-1", booking_id: "booking-1", status: "pending_booking" }],
  visa_applications: [{ id: "visa-1", reference: "VISA-1", status: "submitted", given_names: "Sofia", surname: "Amane", passport_no: null, booking_id: "booking-1" }],
};
const failingModules = new Set<string>();

const queryFor = (table: string) => {
  const response = table === "clients"
    ? { data: null, error: null, count: 12 }
    : { data: failingModules.has(table) ? null : rows[table] ?? [], error: failingModules.has(table) ? { message: "Erreur simulée" } : null, count: null };
  const query: any = {
    select: () => query, is: () => query, order: () => query, limit: () => query,
    eq: () => query, neq: () => query, not: () => query,
    then: (resolve: (value: any) => void) => Promise.resolve(response).then(resolve),
  };
  return query;
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => queryFor(table) },
}));

afterEach(() => failingModules.clear());
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ isSupplierOnly: false }) }));
vi.mock("@/admin/components/BookingQuickViewSheet", () => ({
  BookingQuickViewSheet: ({ booking, open }: any) => open ? <div role="dialog">Aperçu {booking.contact_name}</div> : null,
}));

describe("Dashboard centre de commande", () => {
  it("affiche les actions métier, les prochains départs et ouvre le Quick View réservation", async () => {
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Tableau de bord" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("Relancer le client").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Japon novembre").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Passeport manquant").length).toBeGreaterThan(0);
    expect(screen.queryByText("Flights to reserve")).not.toBeInTheDocument();

    const priorityActions = screen.getAllByTestId("priority-action");
    expect(priorityActions).toHaveLength(4);
    expect(priorityActions.map((row) => row.getAttribute("data-action-type"))).toEqual(["task", "flight", "visa", "booking"]);
    expect(priorityActions.some((row) => row.textContent?.includes("Solde Confirmé"))).toBe(false);
    expect(screen.getByText("Solde Confirmé")).toBeInTheDocument();

    const bookingButtons = screen.getAllByRole("button", { name: /Sofia Amane/i });
    fireEvent.click(bookingButtons[bookingButtons.length - 1]);
    expect(screen.getByRole("dialog")).toHaveTextContent("Aperçu Sofia Amane");
  });

  it("laisse le reste du Dashboard utilisable lorsqu’un module échoue", async () => {
    failingModules.add("visa_applications");
    render(<MemoryRouter><Dashboard /></MemoryRouter>);

    expect(await screen.findByText(/Certaines données sont momentanément indisponibles/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Prochains départs" })).toBeInTheDocument();
    expect(screen.getAllByText("Japon novembre").length).toBeGreaterThan(0);
    expect(screen.getByText("Les dossiers visa ne peuvent pas être chargés.")).toBeInTheDocument();
  });
});
