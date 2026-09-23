import { describe, expect, it } from "vitest";
import {
  bookingOptionChangeImpact,
  normalizePublicHotelKey,
  normalizePublicRoomKey,
  publicHotelKeyOrNull,
  publicRoomKeyOrNull,
} from "./booking-options";

describe("booking option admin changes", () => {
  it("charges only the room delta already priced by the public booking", () => {
    const changedOptions = { hotel: "modern", room: "single" } as const;
    expect(bookingOptionChangeImpact(
      { hotel: "modern", room: "double" },
      changedOptions,
      2,
    )).toEqual({ perPerson: 15000, total: 30000 });

    // Once the saved options become the new pricing baseline, reopening and
    // saving the dialog must not charge the same supplement a second time.
    expect(bookingOptionChangeImpact(changedOptions, changedOptions, 2)).toEqual({ perPerson: 0, total: 0 });
  });

  it("combines accommodation and room deltas without re-adding the previous option", () => {
    expect(bookingOptionChangeImpact(
      { hotel: "ryokan", room: "single" },
      { hotel: "modern", room: "triple" },
      2,
    )).toEqual({ perPerson: -18500, total: -37000 });
  });

  it("normalizes legacy labels to the public option keys", () => {
    expect(normalizePublicHotelKey("Ryokan traditionnel")).toBe("ryokan");
    expect(normalizePublicRoomKey("Chambre individuelle")).toBe("single");
  });

  it("does not invent an option for an empty historical reservation", () => {
    expect(publicHotelKeyOrNull(null)).toBeNull();
    expect(publicRoomKeyOrNull("")).toBeNull();
  });
});
