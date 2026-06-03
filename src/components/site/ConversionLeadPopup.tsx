import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { MessageCircle, Phone, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSiteContent } from "@/hooks/useSiteContent";
import { supabase } from "@/integrations/supabase/client";

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

export function ConversionLeadPopup() {
  const location = useLocation();
  const config = useSiteContent<PopupConfig>("site:conversion-popups", DEFAULT_POPUPS);
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [saving, setSaving] = useState(false);

  const activePopup = useMemo(() => {
    if (!config.enabled) return null;
    return [...(config.items ?? [])]
      .filter((item) => isActive(item.active) && pageMatches(item.pages ?? ["all_public"], location.pathname))
      .sort((a, b) => Number(a.priority ?? 99) - Number(b.priority ?? 99))[0] ?? null;
  }, [config, location.pathname]);

  useEffect(() => {
    setVisible(false);
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
      toast.success("Merci, un conseiller vous recontactera.");
      close();
    } catch (error: any) {
      toast.error(error?.message ?? "Impossible d'enregistrer votre demande de rappel.");
    } finally {
      setSaving(false);
    }
  };

  if (!activePopup || !visible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[70] p-3 sm:bottom-5 sm:left-auto sm:right-5 sm:max-w-sm">
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
        <div className="mt-4 grid gap-2">
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nom (optionnel)" />
          <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Téléphone *" inputMode="tel" />
          <Input value={preferredDate} onChange={(event) => setPreferredDate(event.target.value)} placeholder="Date de voyage souhaitée (optionnel)" />
          <Button type="button" onClick={submit} disabled={saving} className="mt-1">
            <Phone className="h-4 w-4" />
            {saving ? "Envoi..." : activePopup.cta_label || "Être rappelé"}
          </Button>
        </div>
      </div>
    </div>
  );
}
