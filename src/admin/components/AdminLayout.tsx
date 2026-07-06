import { ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Plane, CalendarCheck, Sparkles, Users, FileText, Wallet, Banknote,
  Image as ImageIcon, Building2, BookOpen, LogOut, ShieldCheck, Mail, Stamp, ListChecks, Menu, Map, Type, Send, HelpCircle, Languages, Settings, Archive, Palette, Hotel,
  Bell, FileSignature,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import logo from "@/assets/logo-lejapon.png";
import { cn } from "@/lib/utils";
import { ModuleKey, ROLE_LABELS, Role } from "../lib/permissions";
import { PLATFORM_BADGE_LABEL } from "@/config/version";
import { ADMIN_THEMES, type AdminThemeId, isAdminThemeId, readAdminTheme } from "@/admin/theme";
import { AdminQuickActionBar } from "./AdminQuickActionBar";
import { registerAdminPushSubscription } from "@/admin/lib/push-notifications";
import { toast } from "sonner";
import { SUPPLIER_PORTAL_PATH } from "../lib/portal-access";

type NavSection = "Core" | "Sales" | "Content" | "Partners" | "System";
type AdminNavItem = { to: string; icon: any; label: string; end?: boolean; module: ModuleKey; section: NavSection };

const nav: AdminNavItem[] = [
  { to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true, module: "dashboard", section: "Core" },
  { to: "/admin/trips", icon: Plane, label: "Voyages", module: "trips", section: "Sales" },
  { to: "/admin/bookings", icon: CalendarCheck, label: "Réservations", module: "bookings", section: "Sales" },
  { to: "/admin/accounting", icon: Banknote, label: "Comptabilité", module: "accounting", section: "Sales" },
  { to: "/admin/travel-agreements", icon: FileSignature, label: "Accords de voyage", module: "travel_agreements", section: "Sales" },
  { to: "/admin/clients", icon: Users, label: "Clients (CRM)", module: "clients", section: "Sales" },
  { to: "/admin/extras", icon: Sparkles, label: "Extras", module: "extras", section: "Sales" },
  { to: "/admin/suppliers", icon: Building2, label: "Fournisseurs", module: "suppliers", section: "Sales" },
  { to: "/admin/supplier-costs", icon: Wallet, label: "Coûts fournisseurs", module: "supplier_costs", section: "Sales" },
  { to: "/admin/fit-quotes", icon: FileText, label: "Devis FIT", module: "fit_quotes", section: "Sales" },
  { to: "/sales/fit-quotes", icon: FileText, label: "Devis FIT", module: "partner_fit_quotes", section: "Sales" },
  { to: "/admin/international-payments", icon: Banknote, label: "Paiements internationaux", module: "international_payments", section: "Sales" },
  { to: "/admin/visa", icon: Stamp, label: "Demandes de visa", module: "visa", section: "Sales" },
  { to: "/admin/visa-checklists", icon: ListChecks, label: "Documents requis", module: "visa_checklists", section: "Sales" },
  { to: "/admin/visa-settings", icon: ShieldCheck, label: "Bureau Japon", module: "visa_settings", section: "Sales" },
  { to: "/admin/articles", icon: BookOpen, label: "Articles", module: "articles", section: "Content" },
  { to: "/admin/pages", icon: FileText, label: "Pages", module: "pages", section: "Content" },
  { to: "/admin/faqs", icon: HelpCircle, label: "FAQ", module: "faqs", section: "Content" },
  { to: "/admin/frontend", icon: Type, label: "Frontend (textes)", module: "frontend", section: "Content" },
  { to: "/admin/translations", icon: Languages, label: "Traductions", module: "translations", section: "Content" },
  { to: "/admin/programmes", icon: Map, label: "Programmes", module: "programmes", section: "Content" },
  { to: "/admin/hotels", icon: Hotel, label: "Hôtels", module: "hotels", section: "Content" },
  { to: "/admin/media", icon: ImageIcon, label: "Médias", module: "media", section: "Content" },
  { to: "/admin/partner-requests", icon: Building2, label: "Demandes partenaires", module: "partner_requests", section: "Partners" },
  { to: "/admin/agency-fit-requests", icon: FileText, label: "Agences · Demandes FIT", module: "agency_fit_requests", section: "Partners" },
  { to: "/admin/organizations", icon: Building2, label: "Organizations", module: "organizations", section: "Partners" },
  { to: "/admin/agency-settings", icon: Settings, label: "Informations agence", module: "agency_settings", section: "Partners" },
  { to: "/admin/marketing", icon: Send, label: "Emailing marketing", module: "marketing", section: "Partners" },
  { to: "/admin/users", icon: ShieldCheck, label: "Utilisateurs & Rôles", module: "users", section: "System" },
  { to: "/admin/email-settings", icon: Mail, label: "Paramètres email", module: "email_settings", section: "System" },
  { to: "/admin/email-templates", icon: FileText, label: "Templates email", module: "email_templates", section: "System" },
  { to: "/admin/email-logs", icon: Mail, label: "Email Logs", module: "email_logs", section: "System" },
  { to: "/admin/backups", icon: Archive, label: "System · Backups", module: "backups", section: "System" },
  { to: "/admin/theme", icon: Palette, label: "Thème", module: "theme", section: "System" },
];

const sectionOrder: NavSection[] = ["Core", "Sales", "Content", "Partners", "System"];

const PlatformVersionBadge = ({ compact = false }: { compact?: boolean }) => (
  <div
    className={cn(
      "flex items-center gap-2 rounded-md border border-amber-200/70 bg-gradient-to-r from-background via-amber-50/45 to-background text-[10px] font-medium tracking-[0.08em] uppercase text-stone-500 shadow-sm",
      compact ? "justify-center px-2 py-1" : "px-3 py-2"
    )}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b89b5e]" aria-hidden />
    <span className="truncate">{PLATFORM_BADGE_LABEL}</span>
  </div>
);

export const AdminLayout = ({ children }: { children?: ReactNode }) => {
  const { user, isStaff, isSupplierOnly, loading, signOut, roles, can } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [theme, setTheme] = useState<AdminThemeId>(() => readAdminTheme());
  const [pushBusy, setPushBusy] = useState(false);

  useEffect(() => {
    const syncTheme = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      setTheme(isAdminThemeId(detail) ? detail : readAdminTheme());
    };
    window.addEventListener("storage", syncTheme);
    window.addEventListener("admin-theme-change", syncTheme);
    return () => {
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener("admin-theme-change", syncTheme);
    };
  }, []);

  const visibleNav = useMemo(() => nav.filter((n) => can(n.module)), [can]);
  const isPremium = theme === "premium-dashboard";

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement…</div>;
  if (!user) return <Navigate to="/admin/login" state={{ from: loc.pathname }} replace />;
  if (isSupplierOnly) return <Navigate to={SUPPLIER_PORTAL_PATH} replace />;
  if (!isStaff) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-2xl">Accès refusé</h1>
      <p className="text-muted-foreground max-w-md">Votre compte n'a pas de rôle staff. Demandez à un administrateur de vous attribuer un rôle.</p>
      <Button variant="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  );

  const NavLinkItem = ({ item, onNavigate }: { item: AdminNavItem; onNavigate?: () => void }) => {
    const Icon = item.icon;
    return (
      <NavLink
        key={item.to}
        to={item.to}
        end={item.end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            "admin-sidebar-link flex items-center gap-3 rounded-lg text-sm font-medium transition-colors",
            isActive ? "admin-sidebar-link-active" : "admin-sidebar-link-idle"
          )
        }
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="truncate">{item.label}</span>
      </NavLink>
    );
  };

  const SidebarBody = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="admin-sidebar-header p-5 border-b">
        <NavLink to="/" className="flex items-center gap-2" onClick={onNavigate}>
          <img src={logo} alt="lejapon.ma" className="h-8 w-auto" />
          <span className="admin-sidebar-kicker text-xs font-medium">/ admin</span>
        </NavLink>
      </div>
      <nav className="flex-1 overflow-y-auto p-3">
        {isPremium ? (
          <div className="space-y-5">
            {sectionOrder.map((section) => {
              const items = visibleNav.filter((item) => item.section === section);
              if (!items.length) return null;
              return (
                <div key={section} className="space-y-1">
                  <p className="admin-sidebar-section px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                    {section}
                  </p>
                  {items.map((item) => <NavLinkItem key={item.to} item={item} onNavigate={onNavigate} />)}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-1">
            {visibleNav.map((item) => <NavLinkItem key={item.to} item={item} onNavigate={onNavigate} />)}
          </div>
        )}
      </nav>
      <div className="admin-sidebar-footer p-3 border-t">
        <PlatformVersionBadge />
        <div className="px-3 py-2 mb-2">
          <p className="admin-sidebar-kicker text-xs">Connecté</p>
          <p className="text-sm font-medium truncate">{user.email}</p>
          <p className="text-xs text-accent mt-0.5 truncate">
            {roles.map((r) => ROLE_LABELS[r as Role] ?? r).join(", ") || "—"}
          </p>
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={signOut}>
          <LogOut className="w-3.5 h-3.5" /> Déconnexion
        </Button>
      </div>
    </>
  );

  const bottomNav = visibleNav.filter((n) =>
    ["/admin", "/admin/bookings", "/admin/clients", "/admin/visa", "/admin/trips", "/admin/programmes"].includes(n.to)
  );
  const mobileNavLabel: Record<string, string> = {
    "/admin": "Accueil",
    "/admin/trips": "Voy.",
    "/admin/bookings": "Résas",
    "/admin/clients": "Clients",
    "/admin/programmes": "Prog.",
    "/admin/visa": "Visa",
  };
  const current = nav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname === n.to || loc.pathname.startsWith(`${n.to}/`)));
  const enablePushNotifications = async () => {
    setPushBusy(true);
    try {
      await registerAdminPushSubscription(user.id);
      toast.success("Notifications admin activées.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Impossible d'activer les notifications.");
    } finally {
      setPushBusy(false);
    }
  };

  return (
    <div className="admin-mobile-shell admin-shell min-h-screen flex" data-admin-theme={theme}>
      {/* Desktop sidebar */}
      <aside className="admin-sidebar hidden lg:flex w-64 border-r flex-col sticky top-0 h-screen">
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="admin-sidebar p-0 w-72 flex flex-col" data-admin-theme={theme}>
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 flex flex-col">
        <header className={cn("admin-topbar sticky top-0 z-20 items-center justify-between gap-4 border-b px-6 py-3 backdrop-blur", isPremium ? "hidden lg:flex" : "hidden")}>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Admin</p>
            <p className="truncate text-sm font-semibold">{current?.label ?? "Vue d'ensemble"}</p>
          </div>
          <NavLink
            to="/admin/theme"
            className="inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
          >
            <Palette className="h-3.5 w-3.5" />
            {ADMIN_THEMES[theme].name}
          </NavLink>
          <Button variant="outline" size="sm" onClick={enablePushNotifications} disabled={pushBusy}>
            <Bell className="h-3.5 w-3.5" />
            {pushBusy ? "Activation..." : "Activer les notifications"}
          </Button>
        </header>

        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-background/95 backdrop-blur border-b border-border px-3 h-14 shadow-sm">
          <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <NavLink to="/admin" className="inline-flex max-w-full items-center justify-center gap-2">
              <img src={logo} alt="lejapon.ma" className="h-6 w-auto shrink-0" />
              <span className="truncate text-sm font-semibold text-foreground">{mobileNavLabel[current?.to ?? ""] ?? current?.label ?? "Admin"}</span>
            </NavLink>
          </div>
          <Button variant="ghost" size="icon" aria-label="Activer les notifications" onClick={enablePushNotifications} disabled={pushBusy}>
            <Bell className="w-5 h-5" />
          </Button>
        </header>

        <div className={cn("admin-content w-full max-w-7xl mx-auto px-3 py-4 pb-28 sm:p-6", isPremium ? "lg:p-8" : "lg:p-10")}>
          <AdminQuickActionBar />
          {children ?? <Outlet />}
        </div>
      </main>

      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 pb-[env(safe-area-inset-bottom)] shadow-[0_-10px_30px_rgba(15,23,42,0.08)]">
        <div className="px-3 pt-2">
          <PlatformVersionBadge compact />
        </div>
        <div className="grid h-[4.65rem]" style={{ gridTemplateColumns: `repeat(${bottomNav.length}, minmax(0, 1fr))` }}>
          {bottomNav.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "flex min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[10px] font-semibold transition-colors",
                    isActive ? "text-accent" : "text-muted-foreground hover:text-foreground"
                  )
                }
              >
                <span className={cn(
                  "flex h-8 w-10 items-center justify-center rounded-full transition-colors",
                  loc.pathname === n.to || (!n.end && loc.pathname.startsWith(`${n.to}/`)) ? "bg-accent/10" : ""
                )}>
                  <Icon className="h-5 w-5 shrink-0" />
                </span>
                <span className="w-full text-center leading-tight">{mobileNavLabel[n.to] ?? n.label}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
