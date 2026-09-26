import { describe, expect, it } from "vitest";
import { normalizeHotelSlugForSave } from "./hotel-catalog";

describe("hotel slug normalization", () => {
  it("preserves an unchanged historical mixed-case slug", () => {
    expect(normalizeHotelSlugForSave("Hakone-Kowakien", "Hakone-Kowakien")).toBe("Hakone-Kowakien");
  });

  it("normalizes every new or changed slug to lowercase", () => {
    expect(normalizeHotelSlugForSave("New Hotel Kyoto")).toBe("new-hotel-kyoto");
    expect(normalizeHotelSlugForSave("Hakone New Name", "Hakone-Kowakien")).toBe("hakone-new-name");
  });
});
