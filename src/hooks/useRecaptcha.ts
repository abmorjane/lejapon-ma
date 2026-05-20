import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

declare global {
  interface Window {
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  }
}

let cachedSiteKey: string | null = null;
let scriptPromise: Promise<void> | null = null;
let bypassLogged = false;

const BYPASS_TOKEN = "__recaptcha_bypass_local__";

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
  const { data, error } = await supabase.functions.invoke("recaptcha", { method: "GET" });
  if (error) throw error;
  if (!data?.siteKey) throw new Error("recaptcha_site_key_unavailable");
  cachedSiteKey = data.siteKey as string;
  return cachedSiteKey;
};

const loadScript = (siteKey: string): Promise<void> => {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.grecaptcha) return resolve();
    const s = document.createElement("script");
    s.src = `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(siteKey)}`;
    s.async = true;
    s.defer = true;
    s.onload = () => window.grecaptcha?.ready(() => resolve());
    s.onerror = () => reject(new Error("recaptcha_script_failed"));
    document.head.appendChild(s);
  });
  return scriptPromise;
};

/**
 * Loads Google reCAPTCHA v3 lazily and exposes:
 *  - executeRecaptcha(action) → returns a token to send to the backend
 *  - verify(token, action) → calls our edge function to validate the token server-side
 */
export function useRecaptcha() {
  const mode = recaptchaMode();
  const [ready, setReady] = useState(!mode.enabled);
  const [error, setError] = useState<string | null>(null);
  const siteKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!mode.enabled) {
      setReady(true);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const key = await fetchSiteKey();
        if (cancelled) return;
        siteKeyRef.current = key;
        await loadScript(key);
        if (!cancelled) setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "recaptcha_init_failed");
      }
    })();
    return () => { cancelled = true; };
  }, [mode.enabled]);

  const executeRecaptcha = useCallback(async (action: string): Promise<string> => {
    if (!recaptchaMode().enabled) return BYPASS_TOKEN;
    const key = siteKeyRef.current ?? (await fetchSiteKey());
    siteKeyRef.current = key;
    if (!window.grecaptcha) await loadScript(key);
    return await window.grecaptcha!.execute(key, { action });
  }, []);

  const verify = useCallback(async (token: string, action: string) => {
    if (!recaptchaMode().enabled && token === BYPASS_TOKEN) {
      return { ok: true as const, reason: "local_bypass" };
    }
    const { data, error } = await supabase.functions.invoke("recaptcha", {
      method: "POST",
      body: { token, action },
    });
    if (error) return { ok: false as const, reason: "network_error" };
    return data as { ok: boolean; reason?: string };
  }, []);

  return { ready, error, executeRecaptcha, verify, enabled: mode.enabled, bypass: mode.bypass };
}
