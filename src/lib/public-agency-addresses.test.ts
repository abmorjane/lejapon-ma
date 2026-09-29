import { describe, expect, it } from "vitest";
import { confirmedPublicAgencyAddresses } from "./public-agency-addresses";

describe("confirmed public agency addresses", () => {
  it("keeps Témara but never turns a Casablanca departure into an agency address", () => {
    const addresses = [
      { city: "Temara", line: "Rue Annour, Hay El Wifaq 3, Temara" },
      { city: "Casablanca", line: "4 Rue de Vimy, Casablanca" },
    ];
    expect(confirmedPublicAgencyAddresses(addresses)).toEqual([addresses[0]]);
  });

  it("works with translated Témara labels and fails closed on missing addresses", () => {
    expect(confirmedPublicAgencyAddresses([{ city: "Témara", line: "Rue Annour" }])).toHaveLength(1);
    expect(confirmedPublicAgencyAddresses([{ city: "تمارة", line: "شارع النور" }])).toHaveLength(1);
    expect(confirmedPublicAgencyAddresses([{ city: "Settat", line: "unconfirmed" }])).toEqual([]);
    expect(confirmedPublicAgencyAddresses(null)).toEqual([]);
  });
});
