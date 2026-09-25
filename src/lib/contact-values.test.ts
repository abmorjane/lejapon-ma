import { describe, expect, it } from "vitest";
import { displayableEmail } from "./contact-values";

describe("displayableEmail", () => {
  it.each([null, undefined, "", "   ", ",", "...", " , ; "])(
    "treats %j as an empty email",
    (value) => expect(displayableEmail(value)).toBeNull(),
  );

  it("keeps a valid email", () => {
    expect(displayableEmail("  client@example.com ")).toBe("client@example.com");
  });
});
