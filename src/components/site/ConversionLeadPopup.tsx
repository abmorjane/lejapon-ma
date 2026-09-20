import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { useSiteContent } from "@/hooks/useSiteContent";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/lib/analytics";

type PopupConfig = {
  enabled: boolean;
  frequency: "session" | "day";
  items: Array<{
    id: string;
    title: string;
    message: string;
    cta_label: string;
    active: boolean | string;
    priority: number | string;
    pages: Array<"homepage" | "trip_pages" | "all_public"> | string;
    delay_seconds: number | string;
  }>;
};

const DEFAULT_POPUPS: PopupConfig = {
  enabled: true,
  frequency: "session",
  items: [
    {
      id: "lejapon-advantages",
      title: "Pourquoi réserver avec LeJapon.ma ?",
      message: "Un conseiller peut vous rappeler pour vous expliquer l'accompagnement depuis Casablanca, l'assistance au Japon et les prochaines places disponibles.",
      cta_label: "Être rappelé",
      active: true,
      priority: 1,
      pages: ["homepage", "trip_pages"],
      delay_seconds: 9,
    },
  ],
};

const storageKeyFor = (id: string, frequency: PopupConfig["frequency"]) => {
  if (frequency === "day") return `lejapon-popup-${id}-${new Date().toISOString().slice(0, 10)}`;
  return `lejapon-popup-${id}-session`;
};

const normalizePages = (pages: PopupConfig["items"][number]["pages"]) =>
  (Array.isArray(pages) ? pages : String(pages ?? "all_public").split(","))
    .map((page) => String(page).trim())
    .filter(Boolean);

const isActive = (value: boolean | string) => value === true || ["true", "1", "oui", "yes", "active"].includes(String(value).trim().toLowerCase());

const pageMatches = (pages: PopupConfig["items"][number]["pages"], pathname: string) => {
  const normalizedPages = normalizePages(pages);
  if (normalizedPages.includes("all_public")) return true;
  if (normalizedPages.includes("homepage") && pathname === "/") return true;
  if (normalizedPages.includes("trip_pages") && (pathname.startsWith("/voyages") || pathname.startsWith("/programme"))) return true;
  return false;
};

type LeadFormProps = {
  idPrefix: string;
  name: string;
  phone: string;
  preferredDate: string;
  saving: boolean;
  ctaLabel: string;
  onNameChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onPreferredDateChange: (value: string) => void;
  onSubmit: () => void;
  mobile?: boolean;
};

function LeadForm({
  idPrefix,
  name,
  phone,
  preferredDate,
  saving,
  ctaLabel,
  onNameChange,
  onPhoneChange,
  onPreferredDateChange,
  onSubmit,
  mobile = false,
}: LeadFormProps) {
  return (
    <form
      className={mobile ? "grid gap-3 px-4 pb-[max(1rem,env(safe-area-inset-bottom))]" : "mt-4 grid gap-2"}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="sr-only" htmlFor={`${idPrefix}-name`}>Nom</label>
      <Input id={`${idPrefix}-name`} value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Nom (optionnel)" autoComplete="name" />
      <label className="sr-only" htmlFor={`${idPrefix}-phone`}>Téléphone</label>
      <Input id={`${idPrefix}-phone`} value={phone} onChange={(event) => onPhoneChange(event.target.value)} placeholder="Téléphone *" inputMode="tel" autoComplete="tel" autoFocus={mobile} />
      <label className="sr-only" htmlFor={`${idPrefix}-date`}>Date de voyage souhaitée</label>
      <Input id={`${idPrefix}-date`} value={preferredDate} onChange={(event) => onPreferredDateChange(event.target.value)} placeholder="Date de voyage souhaitée (optionnel)" />
      <div className={mobile ? "sticky bottom-0 -mx-1 bg-background px-1 pb-1 pt-1" : ""}>
        <Button type="submit" disabled={saving} className="mt-1 w-full">
          <Phone className="h-4 w-4" />
          {saving ? "Envoi..." : ctaLabel}
        </Button>
      </div>
    </form>
  );
}

export function ConversionLeadPopup() {
  const location = useLocation();
  const config = useSiteContent<PopupConfig>("site:conversion-popups", DEFAULT_POPUPS);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileFormOpen, setMobileFormOpen] = useState(false);

  const activePopup = useMemo(() => {
    if (!config.enabled) return null;
    return [...(config.items ?? [])]
      .filter((item) => isActive(item.active) && pageMatches(item.pages ?? ["all_public"], location.pathname))
      .sort((a, b) => Number(a.priority ?? 99) - Number(b.priority ?? 99))[0] ?? null;
  }, [config, location.pathname]);

  useEffect(() => {
    setVisible(false);
    setMobileFormOpen(false);
    if (!activePopup) return;
    const key = storageKeyFor(activePopup.id, config.frequency ?? "session");
    const store = (config.frequency ?? "session") === "day" ? window.localStorage : window.sessionStorage;
    if (store.getItem(key)) return;
    const timer = window.setTimeout(() => setVisible(true), Math.max(0, Number(activePopup.delay_seconds ?? 8)) * 1000);
    return () => window.clearTimeout(timer);
  }, [activePopup?.id, config.frequency, location.pathname]);

  const close = () => {
    if (activePopup) {
      const key = storageKeyFor(activePopup.id, config.frequency ?? "session");
      const store = (config.frequency ?? "session") === "day" ? window.localStorage : window.sessionStorage;
      store.setItem(key, "1");
    }
    setMobileFormOpen(false);
    setVisible(false);
  };

  const submit = async () => {
    const cleanedPhone = phone.trim();
    if (!cleanedPhone) {
      toast.error("Le téléphone est obligatoire pour être rappelé.");
      return;
    }
    setSaving(true);
    try {
      const { data: clientId } = await supabase.rpc("upsert_client_from_booking" as any, {
        _name: name.trim() || "Lead popup LeJapon.ma",
        _email: "",
        _phone: cleanedPhone,
        _city: "",
      });
      if (clientId) {
        const { data: current } = await supabase.from("clients").select("metadata").eq("id", clientId as string).maybeSingle();
        const metadata = current?.metadata && typeof current.metadata === "object" ? current.metadata as Record<string, unknown> : {};
        await supabase
          .from("clients")
          .update({
            source: "popup_lejapon_advantages",
            metadata: {
              ...metadata,
              popup_lead: {
                popup_id: activePopup?.id ?? null,
                preferred_travel_date: preferredDate || null,
                page: location.pathname,
                captured_at: new Date().toISOString(),
              },
            },
          })
          .eq("id", clientId as string);
      }
      trackEvent("popup_lead_submitted", {
        popup_id: activePopup?.id ?? null,
        page: location.pathname,
        has_preferred_date: Boolean(preferredDate),
      });
      toast.success("Merci, un conseiller vous recontactera.");
      close();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer votre demande de rappel.");
    } finally {
      setSaving(false);
    }
  };

  if (!activePopup || !visible) return null;

  const ctaLabel = activePopup.cta_label || "Être rappelé";

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[70] px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] xl:hidden">
        <div className="mx-auto flex max-w-sm items-center gap-2 rounded-2xl border border-border bg-background/95 p-2 shadow-2xl backdrop-blur-lg">
          <button
            type="button"
            onClick={() => setMobileFormOpen(true)}
            className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl px-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-haspopup="dialog"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <MessageCircle className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">Parler à un conseiller</span>
              <span className="block truncate text-xs text-muted-foreground">{ctaLabel}</span>
            </span>
          </button>
          <button type="button" onClick={close} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Masquer la demande de rappel">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <Drawer open={mobileFormOpen} onOpenChange={setMobileFormOpen} shouldScaleBackground={false}>
        <DrawerContent
          className="z-[80] max-h-[calc(100dvh-.5rem)] overflow-hidden rounded-t-3xl"
          overlayClassName="z-[79] bg-black/45 backdrop-blur-[1px]"
        >
          <div className="mx-auto flex w-full max-w-lg flex-col overflow-y-auto overscroll-contain">
            <DrawerHeader className="relative px-4 pb-3 pt-4 text-left">
              <div className="flex items-start gap-3 pr-10">
                <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                  <MessageCircle className="h-5 w-5" />
                </div>
                <div>
                  <DrawerTitle className="font-display text-xl leading-tight">{activePopup.title}</DrawerTitle>
                  <DrawerDescription className="mt-1.5 leading-relaxed">{activePopup.message}</DrawerDescription>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileFormOpen(false)}
                className="absolute right-3 top-3 inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Fermer le formulaire"
              >
                <X className="h-5 w-5" />
              </button>
            </DrawerHeader>
            <LeadForm
              idPrefix="mobile-callback"
              name={name}
              phone={phone}
              preferredDate={preferredDate}
              saving={saving}
              ctaLabel={ctaLabel}
              onNameChange={setName}
              onPhoneChange={setPhone}
              onPreferredDateChange={setPreferredDate}
              onSubmit={submit}
              mobile
            />
          </div>
        </DrawerContent>
      </Drawer>

      <div className="fixed bottom-5 right-5 z-[70] hidden max-w-sm xl:block">
        <div className="rounded-2xl border border-border bg-background p-4 shadow-2xl">
          <div className="flex items-start justify-between gap-3">
            <div className="flex gap-3">
              <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-xl leading-tight">{activePopup.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{activePopup.message}</p>
              </div>
            </div>
            <button type="button" onClick={close} className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Fermer">
              <X className="h-4 w-4" />
            </button>
          </div>
          <LeadForm
            idPrefix="desktop-callback"
            name={name}
            phone={phone}
            preferredDate={preferredDate}
            saving={saving}
            ctaLabel={ctaLabel}
            onNameChange={setName}
            onPhoneChange={setPhone}
            onPreferredDateChange={setPreferredDate}
            onSubmit={submit}
          />
        </div>
      </div>
    </>
  );
}
