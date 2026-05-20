import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Download, Info, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const ADMIN_DISMISS_KEY = "lejapon:pwa-install-dismissed-until:admin:v2";
const PUBLIC_DISMISS_KEY = "lejapon:pwa-install-dismissed-until:public:v2";
const DEBUG_KEY = "lejapon:pwa-install-debug";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
const MOBILE_MAX_WIDTH = 1024;

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function readDismissedUntil(key: string) {
  const value = Number(window.localStorage.getItem(key) || 0);
  return Number.isFinite(value) ? value : 0;
}

export function PWAInstallPrompt() {
  const location = useLocation();
  const { isStaff } = useAuth();
  const isMobileViewport = useIsMobile();
  const isAdminArea = location.pathname.startsWith("/admin");
  const dismissKey = isAdminArea ? ADMIN_DISMISS_KEY : PUBLIC_DISMISS_KEY;
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissedUntil, setDismissedUntil] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [ready, setReady] = useState(false);
  const [promptSeen, setPromptSeen] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    const updateViewport = () => setViewportWidth(window.innerWidth);
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), isAdminArea ? 900 : 5000);
    return () => window.clearTimeout(timer);
  }, [isAdminArea]);

  useEffect(() => {
    setDismissedUntil(readDismissedUntil(dismissKey));
    setInstalled(isStandalone());
  }, [dismissKey]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setPromptSeen(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const env = useMemo(() => {
    if (typeof window === "undefined") return null;
    const ua = window.navigator.userAgent;
    const maxTouchPoints = window.navigator.maxTouchPoints || 0;
    const hasTouch = maxTouchPoints > 0 || "ontouchstart" in window;
    const isIPadOS = /macintosh/i.test(ua) && maxTouchPoints > 1;
    const isIOS = /iphone|ipad|ipod/i.test(ua) || isIPadOS;
    const isAndroid = /android/i.test(ua);
    const isSafari = /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
    const hasMobileViewport = viewportWidth > 0 && viewportWidth <= MOBILE_MAX_WIDTH + 1;
    const isMobileDevice = hasTouch && (isIOS || isAndroid || (hasMobileViewport && /mobile/i.test(ua)));

    return {
      isIOS,
      isAndroid,
      isSafari,
      isMobileDevice,
      isDesktop: !isMobileDevice,
      hasTouch,
      hasMobileViewport,
      viewportWidth,
      isStandalone: isStandalone(),
      isSecureContext: window.isSecureContext,
      beforeinstallpromptAvailable: Boolean(deferredPrompt),
      currentPath: location.pathname,
      dismissedUntil,
    };
  }, [deferredPrompt, dismissedUntil, location.pathname, viewportWidth]);

  const forceDebug = useMemo(() => {
    if (!import.meta.env.DEV || typeof window === "undefined" || !env?.isMobileDevice) return false;
    const params = new URLSearchParams(window.location.search);
    return params.get("pwaInstallDebug") === "1" || window.localStorage.getItem(DEBUG_KEY) === "1";
  }, [env?.isMobileDevice, location.search]);

  useEffect(() => {
    if (!import.meta.env.DEV || !env) return;
    console.info("[PWA install debug]", {
      isMobile: env.isMobileDevice,
      isMobileViewport,
      isDesktop: env.isDesktop,
      isIOS: env.isIOS,
      isAndroid: env.isAndroid,
      isSafari: env.isSafari,
      hasTouch: env.hasTouch,
      hasMobileViewport: env.hasMobileViewport,
      viewportWidth: env.viewportWidth,
      isStandalone: env.isStandalone,
      isSecureContext: env.isSecureContext,
      beforeinstallpromptAvailable: env.beforeinstallpromptAvailable,
      beforeinstallpromptSeenThisSession: promptSeen,
      dismissedUntil: env.dismissedUntil ? new Date(env.dismissedUntil).toISOString() : null,
      currentPath: env.currentPath,
      forceDebug,
      manifest: "/manifest.webmanifest",
      serviceWorker: "/sw.js",
      startUrl: "/admin",
    });
  }, [env, forceDebug, isMobileViewport, promptSeen]);

  const dismissed = !forceDebug && dismissedUntil > Date.now();
  const canShowFallback = Boolean(env && (env.isIOS || env.isAndroid));
  const shouldShow = Boolean(
    env?.isMobileDevice &&
    ready &&
    !installed &&
    !dismissed &&
    (Boolean(deferredPrompt) || canShowFallback || forceDebug)
  );
  const aggressiveAdmin = isAdminArea && isStaff;

  const instruction = useMemo(() => {
    if (!env) return "";
    if (deferredPrompt) return "Installation disponible sur cet appareil.";
    if (env.isIOS) return "iPhone/iPad : Partager, puis « Sur l'écran d'accueil ».";
    if (env.isAndroid) return "Ajouter à l'écran d'accueil depuis le menu navigateur.";
    return "Vous pouvez installer l'application depuis le menu de votre navigateur si l'option est disponible.";
  }, [deferredPrompt, env]);

  if (!shouldShow) return null;

  const dismiss = () => {
    const until = Date.now() + DISMISS_MS;
    window.localStorage.setItem(dismissKey, String(until));
    setDismissedUntil(until);
  };

  const install = async () => {
    if (!deferredPrompt) {
      toast.info(
        env?.isIOS
          ? "iPhone/iPad : touchez Partager puis Sur l'écran d'accueil."
          : "Android : ouvrez le menu Chrome puis Ajouter à l'écran d'accueil."
      );
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choice.outcome === "accepted") {
      setInstalled(true);
    } else {
      dismiss();
    }
  };

  if (aggressiveAdmin) {
    return (
      <aside className={cn(
        "fixed inset-x-4 bottom-[5.25rem] z-50 rounded-xl border border-stone-200/80 bg-white/95 p-3 text-stone-950 shadow-lg shadow-black/10 backdrop-blur lg:hidden",
        forceDebug && "ring-2 ring-[#E21B2D]/20"
      )}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E21B2D] text-white">
            <Smartphone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-5">Installer LeJapon Admin</p>
            {forceDebug && (
              <p className="mt-0.5 text-[10px] font-semibold uppercase text-[#E21B2D]">
                Debug mobile
              </p>
            )}
            <p className="mt-0.5 text-xs leading-4 text-stone-600">
              {instruction || "Accès rapide aux réservations, clients, visas et PDF."}
            </p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" className="h-8 flex-1 rounded-lg bg-stone-950 px-3 text-xs text-white hover:bg-stone-800" onClick={install}>
                {deferredPrompt ? <Download className="h-4 w-4" /> : <Info className="h-4 w-4" />}
                Installer
              </Button>
              <Button size="sm" variant="outline" className="h-8 rounded-lg px-3 text-xs" onClick={dismiss}>
                Plus tard
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-950"
            onClick={dismiss}
            aria-label="Masquer l'installation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "fixed right-3 z-50 flex items-center gap-1 rounded-full border border-stone-200/80 bg-white/95 p-1 shadow-lg shadow-black/10 backdrop-blur lg:hidden",
        isAdminArea ? "bottom-[5.25rem]" : "bottom-4"
      )}
    >
      <button
        type="button"
        className="flex h-9 items-center gap-2 rounded-full px-3 text-xs font-semibold text-stone-950"
        onClick={install}
      >
        <Smartphone className="h-4 w-4 text-[#E21B2D]" />
        Installer l'application
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 hover:text-stone-950"
        onClick={dismiss}
        aria-label="Masquer l'installation"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}

export const InstallPrompt = PWAInstallPrompt;
