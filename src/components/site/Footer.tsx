import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Instagram, Facebook, Twitter, Mail, MapPin, Phone } from "lucide-react";
import logo from "@/assets/logo-lejapon.png";
import { SITE_VERSION, SITE_BUILD_DATE } from "@/config/version";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAgencySettings } from "@/hooks/useAgencySettings";
import { agencyAddressLine } from "@/lib/agency-settings";

export const Footer = () => {
  const { t, i18n } = useTranslation();
  const agency = useAgencySettings();
  const faqUrl = i18n.language === "en" ? "/en/faq" : i18n.language === "ar" ? "/ar/faq" : "/mon-voyage-questions-reponses";
  const phoneHref = `tel:${String(agency.phone).replace(/[^+\d]/g, "")}`;
  return (
    <footer className="bg-foreground text-background mt-32">
      <div className="container-app py-20 grid md:grid-cols-12 gap-12">
        <div className="md:col-span-5">
          <div className="mb-6 inline-block bg-background rounded-2xl p-3">
            <img src={logo} alt="LeJapon.ma" className="h-12 w-auto object-contain" width={220} height={88} loading="lazy" />
          </div>
          <p className="text-background/70 max-w-sm leading-relaxed mb-6">{t("footer.tagline")}</p>
          <div className="flex gap-3">
            <a href="https://www.instagram.com/lejapon.ma/" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="w-10 h-10 rounded-full bg-background/10 flex items-center justify-center hover:bg-accent transition-all"><Instagram className="w-4 h-4" /></a>
            <a href="https://www.facebook.com/lejaponma" target="_blank" rel="noopener noreferrer" aria-label="Facebook" className="w-10 h-10 rounded-full bg-background/10 flex items-center justify-center hover:bg-accent transition-all"><Facebook className="w-4 h-4" /></a>
            <a href="https://www.twitter.com/lejapon.ma" target="_blank" rel="noopener noreferrer" aria-label="Twitter" className="w-10 h-10 rounded-full bg-background/10 flex items-center justify-center hover:bg-accent transition-all"><Twitter className="w-4 h-4" /></a>
          </div>
        </div>
        <div className="md:col-span-3">
          <p className="eyebrow !text-background/50 mb-4">Navigation</p>
          <ul className="space-y-3 text-background/80">
            <li><Link to="/voyages" className="hover:text-accent transition-colors">{t("nav.trips")}</Link></li>
            <li><Link to="/experiences" className="hover:text-accent transition-colors">{t("nav.experiences")}</Link></li>
            <li><Link to="/a-propos" className="hover:text-accent transition-colors">{t("nav.about")}</Link></li>
            <li><Link to="/blog" className="hover:text-accent transition-colors">Blog</Link></li>
            <li><Link to={faqUrl} className="hover:text-accent transition-colors">FAQ</Link></li>
            <li><Link to="/devenir-partenaire" className="hover:text-accent transition-colors">Devenir partenaire</Link></li>
          </ul>
        </div>
        <div className="md:col-span-4">
          <p className="eyebrow !text-background/50 mb-4">Contact</p>
          <ul className="space-y-3 text-background/80 text-sm">
            <li className="flex items-center gap-3">
              <Mail className="w-4 h-4 text-accent shrink-0" />
              <a href={`mailto:${agency.email}`} className="hover:text-accent transition-colors">{agency.email}</a>
            </li>
            <li className="flex items-center gap-3">
              <Phone className="w-4 h-4 text-accent shrink-0" />
              <a href={phoneHref} className="hover:text-accent transition-colors">{agency.phone}</a>
            </li>
            <li className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-accent shrink-0 mt-0.5" />
              <span>
                <span className="block font-medium text-background/90">{agency.legal_company_name}</span>
                <span className="block text-background/70">{agencyAddressLine(agency)}</span>
                {agency.ice && <span className="block text-background/70">ICE: {agency.ice}</span>}
              </span>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-background/10">
        <div className="container-app py-6 flex flex-col md:flex-row justify-between items-center gap-3 text-xs text-background/50">
          <p>© {new Date().getFullYear()} LeJapon.ma — {t("footer.rights")}</p>
          <p>Voyages premium au Japon depuis le Maroc</p>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="tabular-nums tracking-wide cursor-default select-none"
                style={{ color: "#9ca3af", fontSize: "13px", opacity: 1 }}
              >
                Version {SITE_VERSION || "V2.001"}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              Current deployed version — {SITE_VERSION || "V2.001"} · {SITE_BUILD_DATE}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      {/* Always-visible version banner — guaranteed to render in production */}
      <div
        className="w-full text-center py-2 border-t border-background/10"
        style={{ color: "#9ca3af", fontSize: "12px", opacity: 1 }}
      >
        V2 recovery build active · Version {SITE_VERSION || "V2.001"} · {SITE_BUILD_DATE}
      </div>
      <div className="hidden">
        <div>
        </div>
      </div>
    </footer>
  );
};
