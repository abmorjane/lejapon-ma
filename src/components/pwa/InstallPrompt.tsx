import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Download, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

const ADMIN_DISMISS_KEY = "lejapon:pwa-install-dismissed:admin:v1";
const PUBLIC_DISMISS_KEY = "lejapon:pwa-install-dismissed:public:v1";

function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function InstallPrompt() {
  const location = useLocation();
  const { isStaff } = useAuth();
  const isMobile = useIsMobile();
  const isAdminArea = location.pathname.startsWith("/admin");
  const dismissKey = isAdminArea ? ADMIN_DISMISS_KEY : PUBLIC_DISMISS_KEY;
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), isAdminArea ? 900 : 5000);
    return () => window.clearTimeout(timer);
  }, [isAdminArea]);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(dismissKey) === "1");
    setInstalled(isStandalone());
  }, [dismissKey]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
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

  const installSupported = useMemo(() => {
    if (typeof window === "undefined") return false;
    return Boolean(deferredPrompt) || isIos();
  }, [deferredPrompt]);

  const shouldShow = isMobile && ready && !installed && !dismissed && installSupported;
  const aggressiveAdmin = isAdminArea && isStaff;

  if (!shouldShow) return null;

  const dismiss = () => {
    window.localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  };

  const install = async () => {
    if (!deferredPrompt) {
      toast.info("Sur iPhone, utilisez Partager puis Ajouter à l'écran d'accueil.");
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    setDeferredPrompt(null);

    if (choice.outcome === "accepted") {
      setInstalled(true);
    }
  };

  if (aggressiveAdmin) {
    return (
      <aside className="fixed inset-x-3 bottom-[5.25rem] z-50 rounded-2xl border border-accent/25 bg-background/95 p-3 shadow-card backdrop-blur lg:hidden">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Smartphone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Installer LeJapon Admin</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              Acces rapide aux reservations, clients, visas et PDF.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" className="h-10 flex-1 rounded-xl" onClick={install}>
                <Download className="h-4 w-4" /> Installer
              </Button>
              <Button size="sm" variant="outline" className="h-10 rounded-xl px-3" onClick={dismiss}>
                Plus tard
              </Button>
            </div>
          </div>
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
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
        "fixed right-3 z-50 flex items-center gap-2 rounded-full border border-border bg-background/95 p-1.5 shadow-card backdrop-blur lg:hidden",
        isAdminArea ? "bottom-[5.25rem]" : "bottom-4"
      )}
    >
      <button
        type="button"
        className="flex h-10 items-center gap-2 rounded-full px-3 text-xs font-semibold"
        onClick={install}
      >
        <Smartphone className="h-4 w-4 text-accent" />
        Installer
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
        onClick={dismiss}
        aria-label="Masquer l'installation"
      >
        <X className="h-4 w-4" />
      </button>
    </aside>
  );
}
