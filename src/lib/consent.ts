export const CONSENT_STORAGE_KEY = "lejapon.consent.v1";
export const CONSENT_VERSION = 1;
export const CONSENT_OPEN_EVENT = "lejapon:open-consent-preferences";

export type ConsentPreferences = {
  version: 1;
  analytics: boolean;
  marketing: boolean;
  updated_at: string;
};

export type ConsentStatus = "unknown" | "granted" | "denied";
export type ConsentState = { status: ConsentStatus; preferences: ConsentPreferences | null };
export type BookingConsentSnapshot = {
  version: 1;
  analytics: boolean;
  marketing: boolean;
  captured_at: string;
};

const UNKNOWN: ConsentState = { status: "unknown", preferences: null };
const listeners = new Set<(state: ConsentState) => void>();
let storageUnavailable = false;

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const parseConsent = (raw: string | null): ConsentPreferences | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).sort().join(",") !== "analytics,marketing,updated_at,version") return null;
    if (item.version !== CONSENT_VERSION || typeof item.analytics !== "boolean" || typeof item.marketing !== "boolean") return null;
    if (typeof item.updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(item.updated_at)) return null;
    if (!Number.isFinite(Date.parse(item.updated_at))) return null;
    return item as ConsentPreferences;
  } catch {
    return null;
  }
};

export const getConsent = (): ConsentState => {
  if (storageUnavailable) return UNKNOWN;
  try {
    const preferences = parseConsent(storage()?.getItem(CONSENT_STORAGE_KEY) ?? null);
    if (!preferences) return UNKNOWN;
    return { status: preferences.analytics || preferences.marketing ? "granted" : "denied", preferences };
  } catch {
    storageUnavailable = true;
    return UNKNOWN;
  }
};

const notify = (state: ConsentState) => listeners.forEach((listener) => listener(state));

export const setConsent = (choices: Pick<ConsentPreferences, "analytics" | "marketing">): ConsentState => {
  if (typeof choices.analytics !== "boolean" || typeof choices.marketing !== "boolean") return UNKNOWN;
  const preferences: ConsentPreferences = {
    version: CONSENT_VERSION,
    analytics: choices.analytics,
    marketing: choices.marketing,
    updated_at: new Date().toISOString(),
  };
  try {
    const target = storage();
    if (!target) {
      storageUnavailable = true;
      notify(UNKNOWN);
      return UNKNOWN;
    }
    target.setItem(CONSENT_STORAGE_KEY, JSON.stringify(preferences));
    storageUnavailable = false;
    const state = getConsent();
    notify(state);
    return state;
  } catch {
    // A blocked store must never grant a transient tracking permission.
    storageUnavailable = true;
    notify(UNKNOWN);
    return UNKNOWN;
  }
};

export const acceptAll = () => setConsent({ analytics: true, marketing: true });
export const rejectAll = () => setConsent({ analytics: false, marketing: false });
export const updateConsentPreferences = setConsent;
export const hasAnalyticsConsent = () => getConsent().preferences?.analytics === true;
export const hasMarketingConsent = () => getConsent().preferences?.marketing === true;

export const clearConsent = () => {
  try {
    storage()?.removeItem(CONSENT_STORAGE_KEY);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
  }
  notify(UNKNOWN);
};

export const subscribeConsentChanges = (listener: (state: ConsentState) => void) => {
  listeners.add(listener);
  if (typeof window === "undefined") return () => listeners.delete(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_STORAGE_KEY || event.key === null) listener(getConsent());
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

export const consentSnapshotForBooking = (): BookingConsentSnapshot => {
  const preferences = getConsent().preferences;
  return {
    version: CONSENT_VERSION,
    analytics: preferences?.analytics === true,
    marketing: preferences?.marketing === true,
    captured_at: new Date().toISOString(),
  };
};

export const openConsentPreferences = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONSENT_OPEN_EVENT));
};
