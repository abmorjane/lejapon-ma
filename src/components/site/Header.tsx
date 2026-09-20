import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, X, Globe, Sparkles } from "lucide-react";
import logo from "@/assets/logo-lejapon.png";
import { setLang } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSiteContent } from "@/hooks/useSiteContent";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";
import { trackEvent } from "@/lib/analytics";

const langs = [{ c: "fr", l: "FR" }, { c: "en", l: "EN" }, { c: "ar", l: "ع" }] as const;

export const Header = () => {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  const slugs = useRouteSlugs();
  const promo = useSiteContent("site:promo-bar", {
    enabled: true,
    text: "Sakura 2026 · 4 places restantes",
    cta_label: "Réserver maintenant",
    cta_url: "/reserver",
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => setOpen(false), [loc.pathname]);

  const links = [
    { to: pathFor(slugs, "trips"), label: t("nav.price") },
    { to: pathFor(slugs, "programme"), label: t("nav.programme") },
    { to: pathFor(slugs, "blog"), label: t("nav.blog") },
    { to: pathFor(slugs, "visa"), label: "Visa" },
    { to: pathFor(slugs, "contact"), label: t("nav.contact") },
  ];

  return (
    <>
      {/* Promo bar */}
      {promo.enabled && (
        <div className="flex min-h-8 items-center justify-center bg-gradient-vermillion px-2 py-1.5 text-center text-[11px] font-medium leading-tight text-accent-foreground sm:min-h-9 sm:px-4 sm:py-2 sm:text-xs md:text-sm">
          <div className="flex max-w-full items-center justify-center gap-1.5 sm:gap-2">
            <Sparkles className="hidden h-3.5 w-3.5 shrink-0 sm:block" aria-hidden="true" />
            <span>{promo.text}</span>
            {promo.cta_label && promo.cta_url && (
              <Link
                to={promo.cta_url}
                className="inline-flex min-h-7 shrink-0 items-center whitespace-nowrap font-semibold underline underline-offset-2 sm:min-h-8"
                onClick={() => trackEvent("reservation_cta_clicked", { placement: "promo_bar" })}
              >
                {promo.cta_label}
              </Link>
            )}
          </div>
        </div>
      )}
      <header className={cn(
        "sticky inset-x-0 top-0 z-50 h-16 transition-[background-color,box-shadow,border-color,backdrop-filter] duration-300 md:h-[76px]",
        scrolled ? "bg-background/85 backdrop-blur-xl border-b border-border shadow-soft" : "bg-background"
      )}>
        <div className="container-app flex h-full items-center justify-between gap-3 md:gap-6">
          <Link to="/" className="flex items-center group" aria-label="lejapon.ma">
            <span className="inline-flex h-10 w-[106px] items-center sm:w-[114px] md:h-11 md:w-[132px]">
              <img src={logo} alt="LeJapon.ma" className="h-9 w-full object-contain md:h-11" width={220} height={88} />
            </span>
          </Link>

          <nav className="hidden lg:flex items-center gap-8">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className={cn(
                "text-sm font-medium hover:text-accent transition-colors",
                loc.pathname === l.to && "text-accent"
              )}>{l.label}</Link>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden min-h-10 items-center gap-1 rounded-full bg-secondary px-1 py-1 md:flex">
              <Globe className="w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
              {langs.map((l) => (
                <button key={l.c} onClick={() => setLang(l.c as "fr"|"en"|"ar")}
                  className={cn(
                    "h-8 min-w-8 rounded-full px-2.5 text-xs font-medium transition-colors",
                    i18n.language === l.c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}>{l.l}</button>
              ))}
            </div>
            <Link
              to="/reserver"
              className="hidden md:inline-flex btn-primary !min-h-10 !py-2.5 !px-5 text-sm"
              onClick={() => trackEvent("reservation_cta_clicked", { placement: "header" })}
            >
              {t("nav.booking")}
            </Link>
            <button
              className="tap-target -mr-2 inline-flex h-11 w-11 items-center justify-center rounded-full p-2 transition-colors hover:bg-secondary lg:hidden"
              onClick={() => setOpen(!open)}
              aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
              aria-expanded={open}
            >
              {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-border bg-background lg:hidden">
            <div className="container-app flex flex-col gap-2 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:py-6">
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="text-base py-3 border-b border-border/50 font-medium">{l.label}</Link>
              ))}
              <Link to="/reserver" className="btn-primary mt-4" onClick={() => trackEvent("reservation_cta_clicked", { placement: "mobile_menu" })}>{t("nav.booking")}</Link>
              <div className="flex gap-2 justify-center pt-3">
                {langs.map((l) => (
                  <button key={l.c} onClick={() => setLang(l.c as "fr"|"en"|"ar")}
                    className={cn("text-sm px-4 py-1.5 rounded-full border border-border font-medium",
                      i18n.language === l.c && "bg-foreground text-background border-foreground")}>{l.l}</button>
                ))}
              </div>
            </div>
          </div>
        )}
      </header>
    </>
  );
};
