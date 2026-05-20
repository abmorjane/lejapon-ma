import { describe, expect, it } from "vitest";
import { checkPassportExpiry, parsePassportMRZ } from "@/lib/passport-mrz";

describe("parsePassportMRZ", () => {
  it("extracts core passport fields from TD3 MRZ lines", () => {
    const fields = parsePassportMRZ(`
      P<MARDOE<<JOHN<<<<<<<<<<<<<<<<<<<<<<<<<<<<
      AB123456<7MAR9001011M3001019<<<<<<<<<<<<<<06
    `);

    expect(fields).toMatchObject({
      first_name: "JOHN",
      last_name: "DOE",
      full_name: "JOHN DOE",
      nationality: "MAR",
      sex: "M",
      date_of_birth: "1990-01-01",
      passport_no: "AB123456",
      passport_expiry: "2030-01-01",
    });
  });

  it("returns null when no MRZ is present", () => {
    expect(parsePassportMRZ("ordinary passport text")).toBeNull();
  });

  it("extracts fields when OCR returns MRZ as continuous text", () => {
    const fields = parsePassportMRZ("scan text P<MARDOE<<JANE<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<AB765432<7MAR9202022F3103038<<<<<<<<<<<<<<08");

    expect(fields).toMatchObject({
      first_name: "JANE",
      last_name: "DOE",
      nationality: "MAR",
      sex: "F",
      date_of_birth: "1992-02-02",
      passport_no: "AB765432",
      passport_expiry: "2031-03-03",
    });
  });
});

describe("checkPassportExpiry", () => {
  it("returns a warning for a passport expiring within 12 months", () => {
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 6);
    const iso = soon.toISOString().slice(0, 10);

    const result = checkPassportExpiry(iso);
    expect(result.expiresWithin12Months).toBe(true);
    expect(result.warning).toContain("moins d'un an");
  });

  it("does not warn for a passport expiring after more than 12 months", () => {
    const later = new Date();
    later.setMonth(later.getMonth() + 18);
    const iso = later.toISOString().slice(0, 10);

    const result = checkPassportExpiry(iso);
    expect(result.expiresWithin12Months).toBe(false);
    expect(result.warning).toBeUndefined();
  });
});
