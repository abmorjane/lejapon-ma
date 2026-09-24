import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import {
  RecaptchaTechnicalError,
  executeRecaptchaToken,
  loadRecaptchaScript,
  resetRecaptchaStateForTests,
  useRecaptcha,
} from "./useRecaptcha";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}));

const recaptchaMock = (token = "captcha-token") => ({
  ready: (callback: () => void) => callback(),
  execute: vi.fn().mockResolvedValue(token),
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  resetRecaptchaStateForTests();
});

describe("reCAPTCHA resilient loading", () => {
  it("uses google.com when the primary script loads", async () => {
    const loading = loadRecaptchaScript("site-key", 100);
    const script = document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="google.com"]');
    expect(script?.src).toContain("www.google.com/recaptcha/api.js");
    window.grecaptcha = recaptchaMock();
    script?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();
  });

  it("falls back to recaptcha.net when google.com fails", async () => {
    const loading = loadRecaptchaScript("site-key", 100);
    document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="google.com"]')
      ?.dispatchEvent(new Event("error"));

    await waitFor(() => {
      expect(document.querySelector('script[data-lejapon-recaptcha-script="recaptcha.net"]')).toBeTruthy();
    });
    const fallback = document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="recaptcha.net"]');
    expect(fallback?.src).toContain("www.recaptcha.net/recaptcha/api.js");
    window.grecaptcha = recaptchaMock();
    fallback?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeUndefined();
  });

  it("clears the rejected cached promise so a later load can retry", async () => {
    const first = loadRecaptchaScript("site-key", 100);
    const firstRejected = expect(first).rejects.toMatchObject({ code: "recaptcha_script_unavailable" });
    document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="google.com"]')
      ?.dispatchEvent(new Event("error"));
    await waitFor(() => expect(document.querySelector('script[data-lejapon-recaptcha-script="recaptcha.net"]')).toBeTruthy());
    document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="recaptcha.net"]')
      ?.dispatchEvent(new Event("error"));
    await firstRejected;

    const retry = loadRecaptchaScript("site-key", 100);
    const retryScript = document.querySelector<HTMLScriptElement>('script[data-lejapon-recaptcha-script="google.com"]');
    expect(retryScript).toBeTruthy();
    window.grecaptcha = recaptchaMock("retry-token");
    retryScript?.dispatchEvent(new Event("load"));
    await expect(retry).resolves.toBeUndefined();
  });

  it("identifies execute timeouts as technical failures", async () => {
    vi.useFakeTimers();
    window.grecaptcha = {
      ready: (callback) => callback(),
      execute: vi.fn(() => new Promise<string>(() => undefined)),
    };
    const execution = executeRecaptchaToken("site-key", "login", 50);
    const timedOut = expect(execution).rejects.toEqual(expect.objectContaining<Partial<RecaptchaTechnicalError>>({
      code: "recaptcha_execute_timeout",
    }));
    await vi.advanceTimersByTimeAsync(51);
    await timedOut;
  });

  it.each(["invalid_token", "action_mismatch", "low_score"])(
    "preserves the explicit %s rejection returned as an HTTP error",
    async (reason) => {
      const response = new Response(JSON.stringify({ ok: false, reason }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
      mocks.invoke.mockResolvedValue({ data: null, error: new FunctionsHttpError(response) });
      const { result } = renderHook(() => useRecaptcha({ active: false }));

      await expect(result.current.verify("server-token", "login")).resolves.toEqual({ ok: false, reason });
    },
  );
});
