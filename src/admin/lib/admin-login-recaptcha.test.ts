import { describe, expect, it, vi } from "vitest";
import { evaluateAdminRecaptcha } from "./admin-login-recaptcha";

describe("admin login reCAPTCHA gate", () => {
  it("allows password login when reCAPTCHA is technically unavailable", async () => {
    const result = await evaluateAdminRecaptcha({
      mode: "login",
      enabled: true,
      initializationError: "recaptcha_script_unavailable",
      execute: vi.fn(),
      verify: vi.fn(),
    });
    expect(result).toMatchObject({ allowed: true, technicalUnavailable: true });
  });

  it.each(["low_score", "invalid_token", "action_mismatch"])("blocks password login after explicit %s rejection", async (reason) => {
    const result = await evaluateAdminRecaptcha({
      mode: "login",
      enabled: true,
      execute: vi.fn().mockResolvedValue("token"),
      verify: vi.fn().mockResolvedValue({ ok: false, reason }),
    });
    expect(result).toEqual({ allowed: false, technicalUnavailable: false, reason });
  });

  it("keeps admin signup blocked when reCAPTCHA is technically unavailable", async () => {
    const result = await evaluateAdminRecaptcha({
      mode: "signup",
      enabled: true,
      execute: vi.fn().mockRejectedValue(new Error("offline")),
      verify: vi.fn(),
    });
    expect(result).toMatchObject({ allowed: false, technicalUnavailable: true });
  });
});
