import { describe, expect, it } from "vitest";
import {
  missingCrmFieldsPatch,
  normalizeCrmPhone,
  resolveCrmIdentity,
  type CrmIdentityCandidate,
} from "./crm-identity";

const clients: CrmIdentityCandidate[] = [
  { id: "client-a", email: "client@example.com", phone: "+212612345678", passport_number: "AB-12 345" },
];

describe("CRM identity resolution", () => {
  it("reuses the existing client for the same normalized email", () => {
    expect(resolveCrmIdentity({ email: " Client@Example.COM " }, clients)).toMatchObject({
      kind: "match",
      clientId: "client-a",
      matchedBy: "email",
    });
  });

  it("normalizes Moroccan phone formats to the same identity", () => {
    expect(normalizeCrmPhone("06 12 34 56 78")).toBe("+212612345678");
    expect(resolveCrmIdentity({ phone: "00212 6 12 34 56 78" }, clients)).toMatchObject({
      kind: "match",
      clientId: "client-a",
      matchedBy: "phone",
    });
  });

  it("reuses the existing client for the same normalized passport", () => {
    expect(resolveCrmIdentity({ passport_no: "ab12345" }, clients)).toMatchObject({
      kind: "match",
      clientId: "client-a",
      matchedBy: "passport",
    });
  });

  it("never replaces populated CRM values with empty incoming values", () => {
    expect(missingCrmFieldsPatch(
      { full_name: "Aya Mori", email: "aya@example.com", phone: "+212600000000", city: null },
      { full_name: "", email: " ", phone: null, city: "Rabat" },
    )).toEqual({ city: "Rabat" });
  });

  it("does not auto-merge an ambiguous match", () => {
    const result = resolveCrmIdentity(
      { email: "duplicate@example.com" },
      [
        { id: "client-a", email: "duplicate@example.com" },
        { id: "client-b", email: "DUPLICATE@example.com" },
      ],
    );
    expect(result).toEqual({
      kind: "ambiguous",
      candidateIds: ["client-a", "client-b"],
      matchedBy: "email",
    });
  });

  it("flags conflicting identity fields instead of choosing one", () => {
    const result = resolveCrmIdentity(
      { passport_no: "AA123", email: "second@example.com" },
      [
        { id: "client-a", passport_no: "AA123" },
        { id: "client-b", email: "second@example.com" },
      ],
    );
    expect(result.kind).toBe("ambiguous");
  });
});
