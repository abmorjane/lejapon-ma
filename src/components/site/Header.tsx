import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Menu, X, Globe, Sparkles } from "lucide-react";
import logo from "@/assets/logo-lejapon.png";
import { setLang } from "@/i18n";
import { cn } from "@/lib/utils";
import { useSiteContent } from "@/hooks/useSiteContent";
import { useRouteSlugs, pathFor } from "@/hooks/useRouteSlugs";

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
        <div className="bg-gradient-vermillion text-accent-foreground text-center text-xs md:text-sm py-2 px-4 font-medium">
          <Sparkles className="w-3.5 h-3.5 inline mr-2" />
          {promo.text}
          {promo.cta_label && promo.cta_url && (
            <>
              {" — "}
              <Link to={promo.cta_url} className="underline underline-offset-2 font-semibold">
                {promo.cta_label}
              </Link>
            </>
          )}
        </div>
      )}
      <header className={cn(
        "sticky top-0 inset-x-0 z-50 transition-all duration-300",
        scrolled ? "bg-background/85 backdrop-blur-xl border-b border-border shadow-soft py-3" : "bg-background py-4"
      )}>
        <div className="container-app flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center group" aria-label="lejapon.ma">
            <img src={logo} alt="lejapon.ma" className="h-10 md:h-11 w-auto" width={220} height={88} />
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
            <div className="hidden md:flex items-center gap-1 bg-secondary rounded-full px-1 py-1">
              <Globe className="w-3.5 h-3.5 mx-1.5 text-muted-foreground" />
              {langs.map((l) => (
                <button key={l.c} onClick={() => setLang(l.c as "fr"|"en"|"ar")}
                  className={cn(
                    "text-xs px-2.5 py-1 rounded-full font-medium transition-all",
                    i18n.language === l.c ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
                  )}>{l.l}</button>
              ))}
            </div>
            <Link to="/reserver" className="hidden md:inline-flex btn-primary !py-2.5 !px-5 text-sm">
              {t("nav.booking")}
            </Link>
            <button className="lg:hidden p-2 -mr-2" onClick={() => setOpen(!open)} aria-label="menu">
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {open && (
          <div className="lg:hidden bg-background border-t border-border mt-3">
            <div className="container-app py-6 flex flex-col gap-2">
              {links.map((l) => (
                <Link key={l.to} to={l.to} className="text-base py-3 border-b border-border/50 font-medium">{l.label}</Link>
              ))}
              <Link to="/reserver" className="btn-primary mt-4">{t("nav.booking")}</Link>
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
