declare global {
  interface Window {
    webkit?: {
      messageHandlers?: Record<string, { postMessage?: (payload: unknown) => void } | undefined>;
    };
  }
}

const hasBrowser = () => typeof window !== "undefined" && typeof navigator !== "undefined";
let webViewGuardsInstalled = false;

const isSocialWebView = () => {
  if (!hasBrowser()) return false;
  const ua = navigator.userAgent || "";
  return /\b(FBAN|FBAV|FB_IAB|Instagram|FB4A|FBIOS)\b/i.test(ua);
};

const isKnownWebViewNoise = (value: unknown) => {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return /script error|postmessage|webkit.*messagehandlers|messagehandlers.*webkit/i.test(text);
};

export const installWebViewGuards = () => {
  if (!hasBrowser() || !isSocialWebView()) return;
  if (webViewGuardsInstalled) return;
  webViewGuardsInstalled = true;

  window.addEventListener(
    "error",
    (event) => {
      const crossOriginScriptError = event.message === "Script error." && !event.filename;
      if (crossOriginScriptError || isKnownWebViewNoise(event.message)) {
        event.preventDefault();
      }
    },
    true,
  );

  window.addEventListener("unhandledrejection", (event) => {
    if (isKnownWebViewNoise(event.reason)) {
      event.preventDefault();
    }
  });
};

export const safeWebkitPostMessage = (handlerName: string, payload: unknown) => {
  if (!hasBrowser()) return false;
  const handler = window.webkit?.messageHandlers?.[handlerName];
  if (typeof handler?.postMessage !== "function") return false;
  try {
    handler.postMessage(payload);
    return true;
  } catch {
    return false;
  }
};
