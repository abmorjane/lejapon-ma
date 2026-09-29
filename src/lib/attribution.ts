export const ATTRIBUTION_STORAGE_KEY = "lejapon.marketing_attribution.v1";

export type NormalizedTrafficSource =
  | "chatgpt_paid"
  | "instagram"
  | "facebook"
  | "google"
  | "direct"
  | "other";

export type MarketingTouch = {
  captured_at: string;
  source_original: string;
  source_normalized: NormalizedTrafficSource;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  fbclid?: string;
  gclid?: string;
  fbp?: string;
  fbc?: string;
  oppref?: string;
  click_id?: string;
  openai_click_ref?: string;
  chatgpt_campaign_id?: string;
  chatgpt_ad_group_id?: string;
  chatgpt_ad_account_id?: string;
  landing_path: string;
  referrer?: string;
};

export type MarketingAttribution = {
  version: 1;
  first_touch: MarketingTouch;
  last_touch: MarketingTouch;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

type CaptureAttributionInput = {
  url: string;
  referrer?: string;
  cookie?: string;
  now?: Date;
  storage?: StorageLike;
};

const browserStorage = (): Storage | undefined => {
  try { return typeof window === "undefined" ? undefined : window.localStorage; } catch { return undefined; }
};

const MAX_VALUE_LENGTH = 500;
const STANDARD_QUERY_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "chatgpt_campaign_id", "chatgpt_ad_group_id", "chatgpt_ad_account_id"] as const;
const OPAQUE_QUERY_KEYS = ["oppref", "click_id", "chatgpt_campaign_id", "chatgpt_ad_group_id", "chatgpt_ad_account_id"] as const;
const NORMALIZED_SOURCES = new Set<NormalizedTrafficSource>(["chatgpt_paid", "instagram", "facebook", "google", "direct", "other"]);

const safeValue = (value: string | null | undefined, maxLength = MAX_VALUE_LENGTH) => {
  if (!value) return undefined;
  return value.slice(0, maxLength);
};

const safeOpaqueValue = (value: string | undefined) => {
  if (!value || value.length > 2_000) return undefined;
  return value;
};

const rawQueryValue = (search: string, expectedKey: string) => {
  const query = search.startsWith("?") ? search.slice(1) : search;
  for (const entry of query.split("&")) {
    if (!entry) continue;
    const separator = entry.indexOf("=");
    const rawKey = separator >= 0 ? entry.slice(0, separator) : entry;
    let decodedKey = rawKey;
    try {
      decodedKey = decodeURIComponent(rawKey.replace(/\+/g, " "));
    } catch {
      // Invalid query encoding cannot be a trusted attribution key.
    }
    if (decodedKey === expectedKey) return separator >= 0 ? entry.slice(separator + 1) : "";
  }
  return undefined;
};

const cookieValue = (cookie: string, name: string) => {
  const prefix = `${name}=`;
  const match = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return safeValue(match?.slice(prefix.length));
};

const hostnameFromReferrer = (referrer?: string) => {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return "";
  }
};

const isInternalHostname = (hostname: string) => hostname === "lejapon.ma" || hostname === "www.lejapon.ma";

export const normalizeTrafficSource = (source: string): NormalizedTrafficSource => {
  const value = source.trim().toLowerCase();
  if (!value || value === "direct") return "direct";
  if (value === "chatgpt" || value === "openai" || value.includes("chatgpt.com") || value.includes("openai.com")) return "chatgpt_paid";
  if (value === "ig" || value === "instagram" || value.includes("instagram.com")) return "instagram";
  if (value === "facebook" || value === "fb" || value.includes("facebook.com")) return "facebook";
  if (value === "google" || /(^|\.)google\./.test(value)) return "google";
  return "other";
};

const sanitizeStoredTouch = (value: unknown): MarketingTouch | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const capturedAt = typeof raw.captured_at === "string" && raw.captured_at.length <= 40 ? raw.captured_at : "";
  const sourceOriginal = typeof raw.source_original === "string" ? safeValue(raw.source_original) : undefined;
  const sourceNormalized = typeof raw.source_normalized === "string" && NORMALIZED_SOURCES.has(raw.source_normalized as NormalizedTrafficSource)
    ? raw.source_normalized as NormalizedTrafficSource
    : null;
  const landingPath = typeof raw.landing_path === "string" && raw.landing_path.startsWith("/")
    ? safeValue(raw.landing_path, 1_000)
    : undefined;
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt)) || !sourceOriginal || !sourceNormalized || !landingPath) return null;

  const touch: MarketingTouch = {
    captured_at: capturedAt,
    source_original: sourceOriginal,
    source_normalized: sourceNormalized,
    landing_path: landingPath,
  };
  for (const key of STANDARD_QUERY_KEYS) {
    const item = typeof raw[key] === "string" ? safeValue(raw[key] as string) : undefined;
    if (item) Object.assign(touch, { [key]: item });
  }
  const oppref = typeof raw.oppref === "string" ? safeOpaqueValue(raw.oppref) : undefined;
  const clickId = typeof raw.click_id === "string" ? safeOpaqueValue(raw.click_id) : undefined;
  if (oppref) touch.oppref = oppref;
  if (clickId) touch.click_id = clickId;
  if (oppref || clickId) touch.openai_click_ref = oppref || clickId;
  for (const key of ["fbp", "fbc"] as const) {
    const item = typeof raw[key] === "string" ? safeValue(raw[key] as string) : undefined;
    if (item) touch[key] = item;
  }
  if (typeof raw.referrer === "string") touch.referrer = safeValue(raw.referrer, 1_000);
  return touch;
};

export const readStoredAttribution = (storage?: StorageLike): MarketingAttribution | null => {
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(ATTRIBUTION_STORAGE_KEY) || "null") as MarketingAttribution | null;
    if (parsed?.version !== 1 || !parsed.first_touch || !parsed.last_touch) return null;
    const firstTouch = sanitizeStoredTouch(parsed.first_touch);
    const lastTouch = sanitizeStoredTouch(parsed.last_touch);
    if (!firstTouch || !lastTouch) return null;
    return { version: 1, first_touch: firstTouch, last_touch: lastTouch };
  } catch {
    return null;
  }
};

const buildTouch = ({ url, referrer = "", cookie = "", now = new Date() }: CaptureAttributionInput) => {
  const landing = new URL(url);
  const params = landing.searchParams;
  const standard = Object.fromEntries(STANDARD_QUERY_KEYS.map((key) => [key, safeValue(params.get(key))])) as Record<(typeof STANDARD_QUERY_KEYS)[number], string | undefined>;
  // oppref and click_id are opaque. Read their raw query representation and
  // never decode, trim, hash, shorten or reconstruct it.
  const oppref = safeOpaqueValue(rawQueryValue(landing.search, "oppref"));
  const clickId = safeOpaqueValue(rawQueryValue(landing.search, "click_id"));
  const referrerHostname = hostnameFromReferrer(referrer);
  const hasQuerySignal = STANDARD_QUERY_KEYS.some((key) => Boolean(standard[key])) || oppref !== undefined || clickId !== undefined;
  const hasExternalReferrer = Boolean(referrerHostname && !isInternalHostname(referrerHostname));
  const hasOpenAiSignal = Boolean(oppref || clickId || standard.chatgpt_campaign_id || standard.chatgpt_ad_group_id || standard.chatgpt_ad_account_id);
  const sourceOriginal = standard.utm_source
    || (hasOpenAiSignal ? "chatgpt" : undefined)
    || (standard.fbclid ? "facebook" : undefined)
    || (standard.gclid ? "google" : undefined)
    || (hasExternalReferrer ? referrerHostname : "direct");

  const touch: MarketingTouch = {
    captured_at: now.toISOString(),
    source_original: sourceOriginal,
    source_normalized: normalizeTrafficSource(sourceOriginal),
    landing_path: landing.pathname || "/",
  };

  for (const key of STANDARD_QUERY_KEYS) {
    const value = standard[key];
    if (value) Object.assign(touch, { [key]: value });
  }
  if (oppref !== undefined) touch.oppref = oppref;
  if (clickId !== undefined) touch.click_id = clickId;
  if (oppref !== undefined || clickId !== undefined) touch.openai_click_ref = oppref !== undefined ? oppref : clickId;
  const fbp = cookieValue(cookie, "_fbp");
  const fbc = cookieValue(cookie, "_fbc");
  if (fbp) touch.fbp = fbp;
  if (fbc) touch.fbc = fbc;
  if (hasExternalReferrer) touch.referrer = safeValue(referrer, 1_000);

  return { touch, hasAcquisitionSignal: hasQuerySignal || hasExternalReferrer, isDirect: !hasQuerySignal && !hasExternalReferrer };
};

export const captureAttribution = (input: CaptureAttributionInput): MarketingAttribution => {
  const storage = input.storage ?? browserStorage();
  const existing = readStoredAttribution(storage);
  const { touch, hasAcquisitionSignal, isDirect } = buildTouch(input);

  if (existing && isDirect) return existing;
  if (existing && !hasAcquisitionSignal) return existing;

  const next: MarketingAttribution = existing
    ? { ...existing, last_touch: touch }
    : { version: 1, first_touch: touch, last_touch: touch };
  try {
    storage?.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage restrictions must never affect the user journey.
  }
  return next;
};

export const captureCurrentAttribution = () => {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  const storage = browserStorage();
  if (!storage) return null;
  captureAttribution({ url: window.location.href, referrer: document.referrer, cookie: document.cookie, storage });
  return readStoredAttribution(storage);
};

export const stripOpaqueAttributionFromCurrentUrl = () => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of OPAQUE_QUERY_KEYS) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

export const getCurrentAttribution = () => {
  if (typeof window === "undefined") return null;
  return readStoredAttribution(browserStorage());
};

export const attributionAnalyticsParams = (attribution: MarketingAttribution | null) => {
  const touch = attribution?.last_touch;
  if (!touch) return {};
  return {
    traffic_source_normalized: touch.source_normalized,
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    utm_content: touch.utm_content,
  };
};

export const attributionMetaIdentifiers = (attribution: MarketingAttribution | null) => {
  const last = attribution?.last_touch;
  const first = attribution?.first_touch;
  return {
    fbp: last?.fbp || first?.fbp,
    fbc: last?.fbc || first?.fbc,
  };
};
