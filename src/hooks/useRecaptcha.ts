import { useCallback, useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

export type RecaptchaVerificationResult = {
  ok: boolean;
  reason?: string;
  technical?: boolean;
};

export class RecaptchaTechnicalError extends Error {
  readonly code: string;

  constructor(code: string, cause?: unknown) {
    super(code, cause ? { cause } : undefined);
    this.name = "RecaptchaTechnicalError";
    this.code = code;
  }
}

let cachedSiteKey: string | null = null;
let scriptPromise: Promise<void> | null = null;
let bypassLogged = false;

const BYPASS_TOKEN = "__recaptcha_bypass_local__";
const SCRIPT_ATTEMPT_TIMEOUT_MS = 4_500;
const EXECUTE_TIMEOUT_MS = 9_000;
const RECAPTCHA_SCRIPT_ATTRIBUTE = "data-lejapon-recaptcha-script";
const RECAPTCHA_SCRIPT_BASES = [
  "https://www.google.com/recaptcha/api.js?render=",
  "https://www.recaptcha.net/recaptcha/api.js?render=",
] as const;

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => reject(new RecaptchaTechnicalError(code)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

function recaptchaMode() {
  const hostname = window.location.hostname;
  const isLocalhost = hostname === "localhost" || hostname === "127.0.0.1";
  const isProductionHost = hostname === "lejapon.ma" || hostname === "www.lejapon.ma";
  const envEnabled = import.meta.env.VITE_ENABLE_RECAPTCHA !== "false";
  const bypass = isLocalhost || (!isProductionHost && !envEnabled);

  if (bypass && isLocalhost && !bypassLogged) {
    console.info("reCAPTCHA bypass enabled for localhost");
    bypassLogged = true;
  }

  return {
    enabled: !bypass,
    bypass,
    isLocalhost,
    isProductionHost,
  };
}

const fetchSiteKey = async (): Promise<string> => {
  if (cachedSiteKey) return cachedSiteKey;
  try {
    const { data, error } = await supabase.functions.invoke("recaptcha", { method: "GET" });
    if (error) throw error;
    if (!data?.siteKey) throw new Error("missing_site_key");
    cachedSiteKey = data.siteKey as string;
    return cachedSiteKey;
  } catch (error) {
    throw new RecaptchaTechnicalError("recaptcha_site_key_unavailable", error);
  }
};

const removeBrokenScript = (script: HTMLScriptElement) => {
  script.onload = null;
  script.onerror = null;
  script.remove();
};

const waitUntilReady = (timeoutMs: number) => withTimeout(new Promise<void>((resolve, reject) => {
  if (!window.grecaptcha) {
    reject(new RecaptchaTechnicalError("recaptcha_global_unavailable"));
    return;
  }
  try {
    window.grecaptcha.ready(resolve);
  } catch (error) {
    reject(new RecaptchaTechnicalError("recaptcha_ready_failed", error));
  }
}), timeoutMs, "recaptcha_ready_timeout");

const loadScriptFrom = async (siteKey: string, baseUrl: string, timeoutMs: number) => {
  const script = document.createElement("script");
  script.src = `${baseUrl}${encodeURIComponent(siteKey)}`;
  script.async = true;
  script.defer = true;
  script.setAttribute(RECAPTCHA_SCRIPT_ATTRIBUTE, baseUrl.includes("recaptcha.net") ? "recaptcha.net" : "google.com");

  let loaded = false;
  try {
    await withTimeout(new Promise<void>((resolve, reject) => {
      script.onload = () => {
        if (!window.grecaptcha) {
          reject(new RecaptchaTechnicalError("recaptcha_global_unavailable"));
          return;
        }
        try {
          window.grecaptcha.ready(resolve);
        } catch (error) {
          reject(new RecaptchaTechnicalError("recaptcha_ready_failed", error));
        }
      };
      script.onerror = () => reject(new RecaptchaTechnicalError("recaptcha_script_failed"));
      document.head.appendChild(script);
    }), timeoutMs, "recaptcha_script_timeout");
    loaded = true;
  } finally {
    if (!loaded) {
      removeBrokenScript(script);
      window.grecaptcha = undefined;
    }
  }
};

export const loadRecaptchaScript = (siteKey: string, attemptTimeoutMs = SCRIPT_ATTEMPT_TIMEOUT_MS): Promise<void> => {
  if (scriptPromise) return scriptPromise;

  scriptPromise = (async () => {
    if (window.grecaptcha) {
      try {
        await waitUntilReady(attemptTimeoutMs);
        return;
      } catch {
        window.grecaptcha = undefined;
      }
    }

    let lastError: unknown;
    for (const baseUrl of RECAPTCHA_SCRIPT_BASES) {
      try {
        await loadScriptFrom(siteKey, baseUrl, attemptTimeoutMs);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new RecaptchaTechnicalError("recaptcha_script_unavailable", lastError);
  })().catch((error) => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
};

export const executeRecaptchaToken = async (
  siteKey: string,
  action: string,
  timeoutMs = EXECUTE_TIMEOUT_MS,
): Promise<string> => {
  if (!window.grecaptcha) await loadRecaptchaScript(siteKey);
  const grecaptcha = window.grecaptcha;
  if (!grecaptcha) throw new RecaptchaTechnicalError("recaptcha_global_unavailable");
  try {
    const token = await withTimeout(
      Promise.resolve(grecaptcha.execute(siteKey, { action })),
      timeoutMs,
      "recaptcha_execute_timeout",
    );
    if (!token) throw new RecaptchaTechnicalError("recaptcha_empty_token");
    return token;
  } catch (error) {
    if (error instanceof RecaptchaTechnicalError) throw error;
    throw new RecaptchaTechnicalError("recaptcha_execute_failed", error);
  }
};

export const isRecaptchaExplicitRejection = (reason?: string | null) =>
  reason === "invalid_token" || reason === "action_mismatch" || reason === "low_score";

const readHttpVerificationResult = async (error: FunctionsHttpError): Promise<RecaptchaVerificationResult | null> => {
  try {
    const payload = await error.context.json() as Partial<RecaptchaVerificationResult>;
    if (typeof payload.ok === "boolean" && typeof payload.reason === "string") {
      return { ok: payload.ok, reason: payload.reason };
    }
  } catch {
    // A malformed/non-JSON Edge response is a technical failure.
  }
  return null;
};

export const resetRecaptchaStateForTests = () => {
  cachedSiteKey = null;
  scriptPromise = null;
  document.querySelectorAll(`script[${RECAPTCHA_SCRIPT_ATTRIBUTE}]`).forEach((script) => script.remove());
  window.grecaptcha = undefined;
};

/**
 * Loads reCAPTCHA v3 lazily and exposes token execution plus server verification.
 * Script/load/network failures are identified as technical failures so login can
 * fail safely without weakening explicit anti-bot rejections.
 */
export function useRecaptcha(options: { active?: boolean } = {}) {
  const active = options.active ?? true;
  const mode = recaptchaMode();
  const [ready, setReady] = useState(!active || !mode.enabled);
  const [error, setError] = useState<string | null>(null);
  const siteKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!active || !mode.enabled) {
      setReady(true);
      return;
    }
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        const key = await fetchSiteKey();
        if (cancelled) return;
        siteKeyRef.current = key;
        await loadRecaptchaScript(key);
        if (!cancelled) setReady(true);
      } catch (caught) {
        if (!cancelled) {
          const code = caught instanceof RecaptchaTechnicalError ? caught.code : "recaptcha_init_failed";
          setError(code);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [active, mode.enabled]);

  const executeRecaptcha = useCallback(async (action: string): Promise<string> => {
    if (!recaptchaMode().enabled) return BYPASS_TOKEN;
    const key = siteKeyRef.current ?? (await fetchSiteKey());
    siteKeyRef.current = key;
    return executeRecaptchaToken(key, action);
  }, []);

  const verify = useCallback(async (token: string, action: string): Promise<RecaptchaVerificationResult> => {
    if (!recaptchaMode().enabled && token === BYPASS_TOKEN) {
      return { ok: true, reason: "local_bypass" };
    }
    try {
      const { data, error: invokeError } = await supabase.functions.invoke("recaptcha", {
        method: "POST",
        body: { token, action },
      });
      if (invokeError) {
        if (invokeError instanceof FunctionsHttpError) {
          const verification = await readHttpVerificationResult(invokeError);
          if (verification) return verification;
        }
        return { ok: false, reason: "network_error", technical: true };
      }
      if (!data || typeof data.ok !== "boolean") return { ok: false, reason: "invalid_response", technical: true };
      return data as RecaptchaVerificationResult;
    } catch {
      return { ok: false, reason: "network_error", technical: true };
    }
  }, []);

  return { ready, error, executeRecaptcha, verify, enabled: active && mode.enabled, bypass: mode.bypass };
}
