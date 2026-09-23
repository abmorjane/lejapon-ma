import { describe, expect, it } from "vitest";
import {
  crmFullName,
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

  it("lets a unique passport win when an email is shared by a family", () => {
    const result = resolveCrmIdentity(
      { passport_no: "BB456", email: "family@example.com", phone: "0612345678" },
      [
        { id: "father", passport_no: "AA123", email: "family@example.com", phone: "0612345678" },
        { id: "daughter", passport_no: "BB456", email: "family@example.com", phone: "0612345678" },
      ],
    );
    expect(result).toEqual({
      kind: "match",
      clientId: "daughter",
      candidateIds: ["daughter"],
      matchedBy: "passport",
    });
  });

  it("keeps a father and daughter separate when their passports differ", () => {
    const family = [
      { id: "father", passport_no: "AA123", email: "family@example.com", phone: "+212612345678" },
    ];

    expect(resolveCrmIdentity(
      { passport_no: "BB456", email: "family@example.com", phone: "+212612345678" },
      family,
    )).toEqual({ kind: "none", candidateIds: [], matchedBy: null });
  });

  it("does not merge spouses because they use the same Auth account", () => {
    const accountUserId = "shared-auth-account";
    const husband = resolveCrmIdentity(
      { passport_no: "HUSBAND1", email: "family@example.com", user_id: accountUserId } as any,
      [],
    );
    const wife = resolveCrmIdentity(
      { passport_no: "WIFE0001", email: "family@example.com", user_id: accountUserId } as any,
      [{ id: "husband", passport_no: "HUSBAND1", email: "family@example.com" }],
    );

    expect(husband.kind).toBe("none");
    expect(wife).toEqual({ kind: "none", candidateIds: [], matchedBy: null });
  });

  it("reports a conflict when the same passport exists on two clients", () => {
    expect(resolveCrmIdentity(
      { passport_no: "DUP123" },
      [
        { id: "client-a", passport_no: "DUP123" },
        { id: "client-b", passport_number: "dup-123" },
      ],
    )).toEqual({
      kind: "ambiguous",
      candidateIds: ["client-a", "client-b"],
      matchedBy: "passport",
    });
  });

  it("does not resolve an incomplete visa identity", () => {
    expect(resolveCrmIdentity({ first_name: "Shanez", last_name: "Sadki" }, clients)).toEqual({
      kind: "none",
      candidateIds: [],
      matchedBy: null,
    });
  });

  it("builds the Visa CRM name from applicant given names and surname", () => {
    expect(crmFullName({ first_name: "Salwa", last_name: "Ait Bouazza" })).toBe("Salwa Ait Bouazza");
  });
});
