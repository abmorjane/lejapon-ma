import { describe, expect, it } from "vitest";
import { getFlightTicketStatus, missingFlightReservationRequirements } from "./flight-tickets";

describe("admin flight reservation essentials", () => {
  it("keeps an incomplete draft saveable as pending", () => {
    expect(getFlightTicketStatus({ status: "pending_booking", booking_platform: "APG" })).toBe("pending_booking");
    expect(missingFlightReservationRequirements({ booking_platform: "APG" }, 0)).toEqual([
      "PNR",
      "Prix total",
      "Devise",
      "Voyageurs",
    ]);
  });

  it("allows reserved status from essential fields without a ticket PDF", () => {
    const flight = {
      status: "reserved",
      booking_platform: "APG",
      pnr: "ABC123",
      fare_amount: 24000,
      fare_currency: "MAD",
      linked_traveler_count: 2,
      ticket_document_id: null,
      ticket_storage_path: null,
    };
    expect(missingFlightReservationRequirements(flight)).toEqual([]);
    expect(getFlightTicketStatus(flight)).toBe("reserved");
  });
});
