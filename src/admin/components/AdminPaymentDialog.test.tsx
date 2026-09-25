import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AdminPaymentDialog } from "./AdminPaymentDialog";

const booking = {
  id: "booking-1",
  reference: "LJ-9927EE",
  contact_name: "MERIAM BANOUAR",
  client_id: "client-1",
  num_adults: 2,
  num_children: 0,
  total_amount_mad: 116_400,
  paid_amount_mad: 40_000,
  metadata: { trip_unit_price_per_person_mad: 58_200 },
  quote_adjustments: [{
    id: "discount-1",
    label: "Carte SIM offerte",
    type: "discount",
    calculation_type: "fixed_amount",
    amount: 800,
    visible_on_quote: true,
  }],
  trips: { title: "Voyage novembre 2026", base_price_mad: 58_200 },
  booking_extras: [
    { name_snapshot: "Tokyo Teamlab Planet", qty: 2, unit_price_mad: 350 },
    { name_snapshot: "Cérémonie de thé", qty: 2, unit_price_mad: 500 },
    { name_snapshot: "Carte SIM", qty: 1, unit_price_mad: 700 },
  ],
  payments: [{ amount_mad: 40_000, status: "received" }],
};

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "staff-1" } }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: async () => table === "bookings"
          ? { data: [booking], error: null }
          : { data: [], error: null },
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));

describe("AdminPaymentDialog commercial totals", () => {
  it("shows the same total, paid amount and balance as the booking dossier", async () => {
    render(
      <BrowserRouter>
        <AdminPaymentDialog open onOpenChange={() => undefined} bookingId="booking-1" />
      </BrowserRouter>,
    );

    expect(await screen.findByText(/118[\s\u202f]000 MAD/)).toBeInTheDocument();
    expect(screen.getByText(/40[\s\u202f]000 MAD/)).toBeInTheDocument();
    expect(screen.getByText(/78[\s\u202f]000 MAD/)).toBeInTheDocument();
  });
});
