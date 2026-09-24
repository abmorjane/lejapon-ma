import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OVERLAY_HISTORY_STATE_KEY } from "@/hooks/useOverlayHistory";
import { BookingQuickViewSheet } from "./BookingQuickViewSheet";

const booking = {
  id: "booking-1",
  reference: "LJ-TEST",
  contact_name: "Client Test",
  status: "confirmed",
  num_adults: 2,
  num_children: 0,
  total_amount_mad: 30_000,
  paid_amount_mad: 10_000,
  formula: "modern_hotel",
  room_type: "double",
  trips: { title: "Japon test" },
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        eq: () => table === "bookings"
          ? { maybeSingle: async () => ({ data: booking, error: null }) }
          : Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

vi.mock("./EditBookingDialog", () => ({ EditBookingDialog: () => null }));
vi.mock("./AdminPaymentDialog", () => ({ AdminPaymentDialog: () => null }));

function Harness() {
  const [open, setOpen] = useState(true);
  return (
    <Routes>
      <Route
        path="/admin/bookings"
        element={(
          <>
            <span>Liste réservations</span>
            <BookingQuickViewSheet booking={booking} open={open} onOpenChange={setOpen} />
          </>
        )}
      />
      <Route path="/admin/bookings/:id" element={<span>Dossier réservation</span>} />
    </Routes>
  );
}

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
  window.history.replaceState({}, "", "/admin/bookings");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BookingQuickViewSheet", () => {
  it("affiche une fermeture tactile et se ferme sur popstate sans quitter la liste", async () => {
    render(<BrowserRouter><Harness /></BrowserRouter>);
    const close = await screen.findByRole("button", { name: "Fermer" });
    expect(close).toHaveClass("min-h-11");
    expect(screen.getByTestId("booking-quick-view-header")).toHaveClass("sticky", "top-0", "z-40");
    expect(screen.getByTestId("booking-quick-view-header").className).toContain("safe-area-inset-top");
    await waitFor(() => expect(window.history.state?.[OVERLAY_HISTORY_STATE_KEY]).toHaveLength(1));

    act(() => {
      window.history.replaceState({ [OVERLAY_HISTORY_STATE_KEY]: [] }, "", "/admin/bookings");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });

    await waitFor(() => expect(screen.queryByRole("button", { name: "Fermer" })).not.toBeInTheDocument());
    expect(window.location.pathname).toBe("/admin/bookings");
    expect(screen.getByText("Liste réservations")).toBeInTheDocument();
  });

  it("ferme le Quick View avant de naviguer vers le dossier", async () => {
    vi.spyOn(window.history, "back").mockImplementation(() => {
      window.history.replaceState({ [OVERLAY_HISTORY_STATE_KEY]: [] }, "", "/admin/bookings");
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    });
    render(<BrowserRouter><Harness /></BrowserRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /Ouvrir dossier/i }));

    expect(await screen.findByText("Dossier réservation")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/bookings/booking-1");
  });

  it("ferme immédiatement avec le bouton visible sans dépendre du retour navigateur", async () => {
    const back = vi.spyOn(window.history, "back").mockImplementation(() => undefined);
    render(<BrowserRouter><Harness /></BrowserRouter>);

    fireEvent.click(await screen.findByRole("button", { name: "Fermer" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Liste réservations")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/admin/bookings");
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });
});
