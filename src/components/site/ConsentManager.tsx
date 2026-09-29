import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { isPublicConsentPath } from "@/lib/analytics";
import {
  acceptAll, CONSENT_OPEN_EVENT, getConsent, rejectAll, setConsent,
  subscribeConsentChanges, type ConsentState,
} from "@/lib/consent";

// COPY_REQUIRES_HUMAN_VALIDATION: wording in the central i18n catalog is provisional.
export const ConsentManager = () => {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);
  const [consent, setCurrentConsent] = useState<ConsentState>(() => getConsent());
  const [open, setOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const isPublic = isPublicConsentPath(pathname);
  const isArabic = i18n.language === "ar";

  useEffect(() => {
    if (window.__LEJAPON_PRERENDER__) return;
    setReady(true);
    setCurrentConsent(getConsent());
    const unsubscribe = subscribeConsentChanges(setCurrentConsent);
    const openPreferences = () => setOpen(true);
    window.addEventListener(CONSENT_OPEN_EVENT, openPreferences);
    return () => {
      unsubscribe();
      window.removeEventListener(CONSENT_OPEN_EVENT, openPreferences);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setAnalytics(consent.preferences?.analytics === true);
    setMarketing(consent.preferences?.marketing === true);
  }, [open, consent.preferences?.analytics, consent.preferences?.marketing]);

  useEffect(() => {
    if (!isPublic) setOpen(false);
  }, [isPublic]);

  if (!ready || !isPublic) return null;

  const save = () => {
    const result = setConsent({ analytics, marketing });
    if (result.status !== "unknown") setOpen(false);
  };

  return (
    <>
      {consent.status === "unknown" && !open && (
        <aside
          aria-label={t("cmp.title")}
          dir={isArabic ? "rtl" : "ltr"}
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-4xl rounded-2xl border border-border bg-background p-4 text-foreground shadow-2xl sm:inset-x-6 sm:p-6"
        >
          <p className="text-base font-semibold sm:text-lg">{t("cmp.title")}</p>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("cmp.description")}</p>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button className="cursor-pointer focus-visible:ring-2" onClick={() => acceptAll()}>{t("cmp.acceptAll")}</Button>
            <Button className="cursor-pointer focus-visible:ring-2" onClick={() => rejectAll()}>{t("cmp.rejectAll")}</Button>
            <Button variant="outline" className="cursor-pointer focus-visible:ring-2" onClick={() => setOpen(true)}>{t("cmp.customize")}</Button>
          </div>
        </aside>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent dir={isArabic ? "rtl" : "ltr"} aria-label={t("cmp.title")} className="max-w-xl rounded-xl">
          <DialogHeader>
            <DialogTitle>{t("cmp.title")}</DialogTitle>
            <DialogDescription>{t("cmp.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div><p className="font-medium">{t("cmp.necessary")}</p><p className="text-sm text-muted-foreground">{t("cmp.alwaysOn")}</p></div>
              <Switch checked disabled aria-label={`${t("cmp.necessary")} — ${t("cmp.alwaysOn")}`} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div><label htmlFor="cmp-analytics" className="cursor-pointer font-medium">{t("cmp.analytics")}</label><p className="text-sm text-muted-foreground">{t("cmp.analyticsDescription")}</p></div>
              <Switch id="cmp-analytics" checked={analytics} onCheckedChange={setAnalytics} aria-label={t("cmp.analytics")} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div><label htmlFor="cmp-marketing" className="cursor-pointer font-medium">{t("cmp.marketing")}</label><p className="text-sm text-muted-foreground">{t("cmp.marketingDescription")}</p></div>
              <Switch id="cmp-marketing" checked={marketing} onCheckedChange={setMarketing} aria-label={t("cmp.marketing")} />
            </div>
          </div>
          <Button className="w-full cursor-pointer focus-visible:ring-2" onClick={save}>{t("cmp.save")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
