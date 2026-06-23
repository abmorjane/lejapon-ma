type AnalyticsParams = Record<string, unknown>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID as string | undefined;
const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID as string | undefined;
const CLARITY_ALLOWED_HOSTS = new Set(["lejapon.ma", "www.lejapon.ma"]);
const CLARITY_BLOCKED_HOST_PATTERN = /(^localhost$|^127\.|^0\.0\.0\.0$|(^|[-.])(preview|staging|dev|development|test|local)([-.]|$))/i;
const CLARITY_BLOCKED_PATH_PATTERN = /^\/(admin|agency|supplier|devis-fit|unsubscribe)(\/|$|\?|#)/i;

const SENSITIVE_KEY_PATTERN =
  /(passport|passeport|email|mail|phone|telephone|téléphone|full[_-]?name|first[_-]?name|last[_-]?name|client[_-]?name|contact[_-]?name|cin|national[_-]?id|document|visa[_-]?document|birth|address|adresse)/i;

let gaInitialized = false;
let clarityInitialized = false;

const hasBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

const getDeployEnv = () =>
  String(import.meta.env.VITE_APP_ENV || import.meta.env.VITE_DEPLOY_ENV || import.meta.env.MODE || "").toLowerCase();

export const isClarityAllowed = (
  path = hasBrowser() ? window.location.pathname : "/",
  hostname = hasBrowser() ? window.location.hostname : "",
) => {
  if (!CLARITY_PROJECT_ID || !import.meta.env.PROD) return false;
  const safeHostname = hostname.toLowerCase();
  if (CLARITY_BLOCKED_HOST_PATTERN.test(safeHostname)) return false;
  if (!CLARITY_ALLOWED_HOSTS.has(safeHostname)) return false;
  if (/(^|[-_])(dev|development|preview|staging|test|local)([-_]|$)/i.test(getDeployEnv())) return false;
  return !CLARITY_BLOCKED_PATH_PATTERN.test(path);
};

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

const sanitizeAnalyticsParams = (params: AnalyticsParams = {}) => {
  return Object.entries(params).reduce<Record<string, string | number | boolean | null>>((safe, [key, value]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) return safe;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      safe[key] = typeof value === "string" ? value.slice(0, 120) : value;
    }
    return safe;
  }, {});
};

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

export const initAnalytics = () => {
  if (!hasBrowser()) return;

  if (GA_MEASUREMENT_ID && !gaInitialized) {
    gaInitialized = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtagShim(...args: unknown[]) {
      window.dataLayer?.push(args);
    };
    appendScript(
      "lejapon-ga4-script",
      `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID)}`,
    );
    window.gtag("js", new Date());
    window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
  }

  if (isClarityAllowed() && !clarityInitialized) {
    const safeProjectId = CLARITY_PROJECT_ID.replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safeProjectId) return;
    clarityInitialized = true;
    appendInlineScript(
      "lejapon-clarity-script",
      `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${safeProjectId}");`,
    );
  }
};

export const trackPageView = (path: string, title?: string) => {
  if (!hasBrowser()) return;
  initAnalytics();
  const pageTitle = title || document.title || "LeJapon.ma";

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag("event", "page_view", {
      page_path: path,
      page_title: pageTitle,
      page_location: `${window.location.origin}${path}`,
    });
  }

  if (isClarityAllowed(path) && window.clarity) {
    window.clarity("set", "page_path", path);
    window.clarity("set", "page_title", pageTitle);
  }
};

export const trackNotFound = (path: string) => {
  if (!hasBrowser()) return;
  const safePath = path.slice(0, 180);
  trackEvent("not_found", {
    page_type: "404",
    requested_path: safePath,
  });

  if (isClarityAllowed(path) && window.clarity) {
    window.clarity("set", "page_type", "404");
    window.clarity("set", "not_found_path", safePath);
  }
};

export const trackEvent = (name: string, params: AnalyticsParams = {}) => {
  if (!hasBrowser() || !name) return;
  initAnalytics();
  const eventName = normalizeEventName(name, params);
  const safeParams = sanitizeAnalyticsParams(params);

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag("event", eventName, safeParams);
  }

  if (isClarityAllowed() && window.clarity) {
    window.clarity("event", eventName);
    Object.entries(safeParams).forEach(([key, value]) => {
      if (value !== null) window.clarity?.("set", key, String(value).slice(0, 120));
    });
  }
};
