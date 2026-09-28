import { publicRouteRegistry } from "@/config/publicRoutes";

export type AnalyticsParams = Record<string, unknown>;
export type AnalyticsEventOptions = { eventId?: string; onceKey?: string; context?: MarketingTrackingContext };
export type MarketingConsentPreference = "unmanaged" | "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[]; loaded?: boolean; version?: string; push?: (...args: unknown[]) => void };
    _fbq?: Window["fbq"];
    __LEJAPON_PRERENDER__?: boolean;
  }
}

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
const META_PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID as string | undefined;
const ALLOWED_HOSTS = new Set(["lejapon.ma", "www.lejapon.ma"]);
const BLOCKED_ENV_PATTERN = /(^|[-_])(dev|development|preview|staging|test|local)([-_]|$)/i;
const SENSITIVE_KEY_PATTERN =
  /(^|[_-])(passport|passeport|email|mail|phone|telephone|téléphone|name|nom|prenom|prénom|address|adresse|birth|naissance|cin|document|notes?|message|medical|visa_document|oppref|openai_click_ref|click_id|fbclid|gclid|fbp|fbc|referrer|landing_path|source_original|chatgpt_campaign_id|chatgpt_ad_group_id|chatgpt_ad_account_id)([_-]|$)/i;

const PUBLIC_STATIC_PATHS = new Set(publicRouteRegistry.staticRoutes.map((route) => route.path));
const BLOCKED_FAMILIES = publicRouteRegistry.excludedFamilies.map((route) => route.path);
const TRACKED_CONTENT_PATHS = [/^\/blog\/[^/]+\/?$/i, /^\/hotels\/[^/]+\/?$/i];
const META_VIEW_CONTENT_PATHS = [/^\/voyages\/?$/i, /^\/programme\/?$/i, /^\/experiences\/?$/i, /^\/hotels(?:\/[^/]+)?\/?$/i];
const SAFE_PAGE_QUERY_KEYS = new Set(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]);

let gaInitialized = false;
let clarityInitialized = false;
let metaInitialized = false;
let routeSuspended = false;
let providersSuspended = false;
let marketingConsentPreference: MarketingConsentPreference = "unmanaged";
let lastPageViewKey = "";
const sentOnceKeys = new Set<string>();
const activeGaMeasurementIds = new Set<string>();

const hasBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const getDeployEnv = () =>
  String(import.meta.env.VITE_APP_ENV || import.meta.env.VITE_DEPLOY_ENV || import.meta.env.MODE || "").toLowerCase();

const normalizedPathname = (path: string) => {
  try {
    return new URL(path, "https://www.lejapon.ma").pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
};

export const sanitizePagePath = (path: string) => {
  try {
    const url = new URL(path, "https://www.lejapon.ma");
    for (const key of [...url.searchParams.keys()]) {
      if (!SAFE_PAGE_QUERY_KEYS.has(key)) url.searchParams.delete(key);
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return "/";
  }
};

export const isPublicMarketingPath = (path: string) => {
  const pathname = normalizedPathname(path);
  if (BLOCKED_FAMILIES.some((family) => pathname === family || pathname.startsWith(`${family}/`))) return false;
  if (PUBLIC_STATIC_PATHS.has(pathname)) return true;
  return TRACKED_CONTENT_PATHS.some((pattern) => pattern.test(pathname));
};

export type MarketingTrackingContext = {
  hostname?: string;
  isProduction?: boolean;
  deployEnv?: string;
  isPrerender?: boolean;
  gaMeasurementId?: string;
  clarityProjectId?: string;
  metaPixelId?: string;
};

export const isMarketingTrackingAllowed = (
  path = hasBrowser() ? window.location.pathname : "/",
  context: MarketingTrackingContext = {},
) => {
  const hostname = (context.hostname ?? (hasBrowser() ? window.location.hostname : "")).toLowerCase();
  const isProduction = context.isProduction ?? Boolean(import.meta.env.PROD);
  const deployEnv = (context.deployEnv ?? getDeployEnv()).toLowerCase();
  const isPrerender = context.isPrerender ?? (hasBrowser() && window.__LEJAPON_PRERENDER__ === true);
  if (!isProduction || isPrerender || !ALLOWED_HOSTS.has(hostname) || BLOCKED_ENV_PATTERN.test(deployEnv)) return false;
  return isPublicMarketingPath(path);
};

export const isClarityAllowed = isMarketingTrackingAllowed;

const appendScript = (id: string, src: string) => {
  if (!hasBrowser() || document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
};

const appendInlineScript = (id: string, code: string) => {
  if (!hasBrowser() || document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.text = code;
  document.head.appendChild(script);
};

export const sanitizeAnalyticsParams = (params: AnalyticsParams = {}) =>
  Object.entries(params).reduce<Record<string, string | number | boolean | null>>((safe, [key, value]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return safe;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = typeof value === "string" ? value.slice(0, 120) : value;
    }
    return safe;
  }, {});

const normalizeEventName = (name: string, params: AnalyticsParams = {}) => {
  if (name === "click_reservation_cta") return "reservation_cta_clicked";
  if (name === "booking_submitted") return "booking_form_submitted";
  if (name === "download_trip_pdf" || name === "download_programme_pdf") return "pdf_downloaded";
  if (name === "visa_signup_started") return "visa_form_started";
  if (name === "visa_application_submitted") return "visa_form_submitted";
  if (name === "booking_step_advanced") {
    const fromStep = Number(params.from_step);
    if (fromStep === 1) return "booking_step_1_completed";
    if (fromStep === 2) return "booking_step_2_completed";
  }
  return name;
};

const providerIds = (context: MarketingTrackingContext) => ({
  ga: context.gaMeasurementId ?? GA_MEASUREMENT_ID,
  clarity: context.clarityProjectId ?? CLARITY_PROJECT_ID,
  meta: context.metaPixelId ?? META_PIXEL_ID,
});

const initMetaPixel = (pixelId?: string) => {
  if (!pixelId || metaInitialized || !hasBrowser()) return;
  metaInitialized = true;
  const existing = window.fbq;
  if (!existing) {
    const fbq = function metaPixelQueue(...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue?.push(args);
    } as Window["fbq"];
    fbq.queue = [];
    fbq.loaded = true;
    fbq.version = "2.0";
    window.fbq = fbq;
    window._fbq = fbq;
  }
  appendScript("lejapon-meta-pixel-script", "https://connect.facebook.net/en_US/fbevents.js");
  window.fbq?.("init", pixelId);
};

export const initAnalytics = (path = hasBrowser() ? window.location.pathname : "/", context: MarketingTrackingContext = {}) => {
  if (
    !hasBrowser()
    || !isMarketingTrackingAllowed(path, context)
    || routeSuspended
    || providersSuspended
    || marketingConsentPreference === "denied"
  ) return false;
  const ids = providerIds(context);

  if (ids.ga && !gaInitialized) {
    gaInitialized = true;
    activeGaMeasurementIds.add(ids.ga);
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtagShim(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    appendScript("lejapon-ga4-script", `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga)}`);
    window.gtag("js", new Date());
    window.gtag("config", ids.ga, { send_page_view: false });
  }

  if (ids.clarity && !clarityInitialized) {
    const safeProjectId = ids.clarity.replace(/[^a-zA-Z0-9_-]/g, "");
    if (safeProjectId) {
      clarityInitialized = true;
      appendInlineScript(
        "lejapon-clarity-script",
        `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${safeProjectId}");`,
      );
    }
  }

  initMetaPixel(ids.meta);
  return true;
};

const applyProviderSuspension = (context: MarketingTrackingContext) => {
  const ids = providerIds(context);
  if (ids.ga) {
    activeGaMeasurementIds.add(ids.ga);
    (window as unknown as Record<string, unknown>)[`ga-disable-${ids.ga}`] = true;
  }
  if (metaInitialized) window.fbq?.("consent", "revoke");
  if (clarityInitialized) {
    window.clarity?.("consentv2", { ad_Storage: "denied", analytics_Storage: "denied" });
    window.clarity?.("consent", false);
  }
  providersSuspended = true;
};

const applyProviderResume = (context: MarketingTrackingContext) => {
  const ids = providerIds(context);
  if (ids.ga) {
    activeGaMeasurementIds.add(ids.ga);
    (window as unknown as Record<string, unknown>)[`ga-disable-${ids.ga}`] = false;
  }
  if (metaInitialized) window.fbq?.("consent", "grant");
  if (clarityInitialized) {
    window.clarity?.("consentv2", { ad_Storage: "granted", analytics_Storage: "granted" });
    window.clarity?.("consent", true);
  }
  providersSuspended = false;
};

export const suspendMarketingTracking = (path: string, context: MarketingTrackingContext = {}) => {
  if (!hasBrowser() || isPublicMarketingPath(path)) return;
  routeSuspended = true;
  lastPageViewKey = "";
  if (!providersSuspended) applyProviderSuspension(context);
};

export const resumeMarketingTracking = (path: string, context: MarketingTrackingContext = {}) => {
  if (!hasBrowser() || !isMarketingTrackingAllowed(path, context) || marketingConsentPreference === "denied") return false;
  routeSuspended = false;
  if (providersSuspended) applyProviderResume(context);
  return true;
};

/**
 * Integration point for a future CMP. "unmanaged" preserves the current V1
 * behavior; it is not a claim that the visitor granted legal consent.
 */
export const setMarketingConsentPreference = (
  preference: MarketingConsentPreference,
  path = hasBrowser() ? window.location.pathname : "/",
  context: MarketingTrackingContext = {},
) => {
  marketingConsentPreference = preference;
  if (!hasBrowser()) return;
  if (preference === "denied") {
    if (!providersSuspended) applyProviderSuspension(context);
    return;
  }
  if (isPublicMarketingPath(path)) resumeMarketingTracking(path, context);
};

const pageSemanticEvent = (pathname: string) => {
  if (pathname === "/voyages") return "view_trip";
  if (pathname === "/programme") return "view_programme";
  return null;
};

const metaEventFor = (name: string, params: AnalyticsParams) => {
  if (name === "booking_form_submitted") return "Lead";
  if ((name === "booking_step_1_completed" || name === "booking_step_2_completed") && params.checkout_intent === true) return "InitiateCheckout";
  return null;
};

export const createMarketingEventId = (prefix: string) => {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
};

export const trackPageView = (path: string, title?: string, context: MarketingTrackingContext = {}) => {
  if (!hasBrowser()) return false;
  if (!isMarketingTrackingAllowed(path, context)) {
    suspendMarketingTracking(path, context);
    return false;
  }
  if (!resumeMarketingTracking(path, context) || !initAnalytics(path, context)) {
    return false;
  }
  const pageTitle = title || document.title || "LeJapon.ma";
  const pathname = normalizedPathname(path);
  const safePagePath = sanitizePagePath(path);
  const ids = providerIds(context);
  const pageViewKey = `${pathname}${new URL(path, window.location.origin).search}`;
  if (pageViewKey === lastPageViewKey) return false;
  lastPageViewKey = pageViewKey;

  if (ids.ga && window.gtag) {
    window.gtag("event", "page_view", { page_path: safePagePath, page_title: pageTitle, page_location: `${window.location.origin}${safePagePath}` });
    const semanticEvent = pageSemanticEvent(pathname);
    if (semanticEvent) window.gtag("event", semanticEvent, { page_path: pathname });
    if (pathname === "/reserver") window.gtag("event", "booking_page_viewed", { page_path: pathname });
  }

  if (window.clarity && !providersSuspended) {
    window.clarity("set", "page_path", safePagePath);
    window.clarity("set", "page_title", pageTitle);
    if (pathname === "/reserver") window.clarity("event", "booking_page_viewed");
  }

  window.fbq?.("track", "PageView");
  if (META_VIEW_CONTENT_PATHS.some((pattern) => pattern.test(pathname))) {
    window.fbq?.("track", "ViewContent", { content_category: pathname.startsWith("/hotels") ? "hotel" : pathname.slice(1) });
  }
  return true;
};

export const trackNotFound = (path: string) => {
  const safePath = path.slice(0, 180);
  trackEvent("not_found", { page_type: "404", requested_path: safePath });
};

export const trackEvent = (name: string, params: AnalyticsParams = {}, options: AnalyticsEventOptions = {}) => {
  const context = options.context ?? {};
  if (!hasBrowser() || !name) return false;
  if (!isMarketingTrackingAllowed(window.location.pathname, context)) {
    suspendMarketingTracking(window.location.pathname, context);
    return false;
  }
  if (!resumeMarketingTracking(window.location.pathname, context) || !initAnalytics(window.location.pathname, context)) return false;
  if (options.onceKey && sentOnceKeys.has(options.onceKey)) return false;
  if (options.onceKey) sentOnceKeys.add(options.onceKey);
  const eventName = normalizeEventName(name, params);
  const safeParams = sanitizeAnalyticsParams(params);

  if (providerIds(context).ga && window.gtag) window.gtag("event", eventName, safeParams);
  if (window.clarity && !providersSuspended) {
    window.clarity("event", eventName);
    Object.entries(safeParams).forEach(([key, value]) => {
      if (value !== null) window.clarity?.("set", key, String(value).slice(0, 120));
    });
  }
  const metaEvent = metaEventFor(eventName, params);
  if (metaEvent) window.fbq?.("track", metaEvent, safeParams, options.eventId ? { eventID: options.eventId } : undefined);
  return true;
};

export const resetAnalyticsForTests = () => {
  if (hasBrowser()) {
    activeGaMeasurementIds.forEach((measurementId) => {
      delete (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`];
    });
  }
  gaInitialized = false;
  clarityInitialized = false;
  metaInitialized = false;
  routeSuspended = false;
  providersSuspended = false;
  marketingConsentPreference = "unmanaged";
  lastPageViewKey = "";
  activeGaMeasurementIds.clear();
  sentOnceKeys.clear();
};
