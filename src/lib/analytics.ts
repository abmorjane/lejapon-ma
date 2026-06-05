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

const SENSITIVE_KEY_PATTERN =
  /(passport|passeport|email|mail|phone|telephone|téléphone|full[_-]?name|first[_-]?name|last[_-]?name|client[_-]?name|contact[_-]?name|cin|national[_-]?id|document|visa[_-]?document|birth|address|adresse)/i;

let initialized = false;

const hasBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

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

export const initAnalytics = () => {
  if (!hasBrowser() || initialized) return;
  initialized = true;

  if (GA_MEASUREMENT_ID) {
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

  if (CLARITY_PROJECT_ID) {
    const safeProjectId = CLARITY_PROJECT_ID.replace(/[^a-zA-Z0-9_-]/g, "");
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

  if (CLARITY_PROJECT_ID && window.clarity) {
    window.clarity("set", "page_path", path);
    window.clarity("set", "page_title", pageTitle);
  }
};

export const trackEvent = (name: string, params: AnalyticsParams = {}) => {
  if (!hasBrowser() || !name) return;
  initAnalytics();
  const safeParams = sanitizeAnalyticsParams(params);

  if (GA_MEASUREMENT_ID && window.gtag) {
    window.gtag("event", name, safeParams);
  }

  if (CLARITY_PROJECT_ID && window.clarity) {
    window.clarity("event", name);
    Object.entries(safeParams).forEach(([key, value]) => {
      if (value !== null) window.clarity?.("set", key, String(value).slice(0, 120));
    });
  }
};
