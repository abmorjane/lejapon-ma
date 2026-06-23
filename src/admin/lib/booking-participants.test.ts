import { describe, expect, it } from "vitest";
import { findMatchingParticipantForClient, getTravelerCounters } from "./booking-participants";

describe("booking participant association", () => {
  it("does not replace the lead participant when associating a different second traveler", () => {
    const lead = {
      id: "participant-a",
      client_id: "client-a",
      first_name: "Voyageur",
      last_name: "A",
      email: "a@example.com",
      phone: "+212600000001",
      passport_no: "A123",
    };

    const selectedSecondTraveler = {
      id: "client-b",
      full_name: "Voyageur B",
      email: "b@example.com",
      phone: "+212600000002",
      passport_number: "B456",
    };

    expect(findMatchingParticipantForClient([lead], selectedSecondTraveler)).toBeUndefined();
  });

  it("matches an existing participant by client identity fields to avoid duplicates", () => {
    const existing = {
      id: "participant-a",
      client_id: "client-a",
      first_name: "Voyageur",
      last_name: "A",
      email: "a@example.com",
      phone: "+212600000001",
      passport_no: "A123",
    };

    expect(findMatchingParticipantForClient([existing], {
      id: "client-a",
      full_name: "Voyageur A",
      email: "a@example.com",
      phone: "+212600000001",
      passport_number: "A123",
    })?.id).toBe("participant-a");
  });

  it("does not match by shared family phone or email alone", () => {
    const lead = {
      id: "participant-a",
      first_name: "Voyageur",
      last_name: "A",
      email: "family@example.com",
      phone: "+212600000001",
      passport_no: "A123",
    };

    expect(findMatchingParticipantForClient([lead], {
      id: "client-b",
      full_name: "Voyageur B",
      email: "family@example.com",
      phone: "+212600000001",
      passport_number: "B456",
    })).toBeUndefined();
  });

  it("computes traveler counters from the stored DB count", () => {
    expect(getTravelerCounters(2, 2, 2)).toEqual({
      expected: 2,
      visible: 2,
      stored: 2,
      remaining: 0,
      overflow: false,
    });

    expect(getTravelerCounters(2, 1, 1)).toMatchObject({ remaining: 1, overflow: false });
  });
});
