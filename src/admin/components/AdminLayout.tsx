import { ReactNode, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Plane, CalendarCheck, Sparkles, Users, FileText, Wallet, Banknote,
  Image as ImageIcon, Building2, BookOpen, LogOut, ShieldCheck, Mail, Stamp, ListChecks, Menu, Map, Type, Send, HelpCircle, Languages, Settings, Archive, Palette, Hotel,
  Bell, FileSignature, ChevronDown, BriefcaseBusiness, CircleDollarSign, FolderKanban, UserCog, TicketCheck, ClipboardList,
  type LucideIcon,
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

type NavGroupId = "dashboard" | "sales" | "visa" | "operations" | "partners" | "finance" | "marketing" | "administration";
type AdminNavItem = { to: string; icon: LucideIcon; label: string; end?: boolean; module: ModuleKey };
type AdminNavGroup = { id: NavGroupId; label: string; icon: LucideIcon; items: AdminNavItem[] };

const ADMIN_NAV_STATE_KEY = "lejapon.admin.nav.openGroups";
const ADMIN_LAST_PAGE_KEY = "lejapon.admin.lastPage";

const navGroups: AdminNavGroup[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    items: [
      { to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true, module: "dashboard" },
      { to: "/admin/fit-control-tower", icon: FolderKanban, label: "FIT Control Tower", module: "fit_control_tower" },
    ],
  },
  {
    id: "sales",
    label: "Sales",
    icon: BriefcaseBusiness,
    items: [
      { to: "/admin/bookings", icon: CalendarCheck, label: "Réservations", module: "bookings" },
      { to: "/admin/fit-quotes", icon: FileText, label: "Devis FIT", module: "fit_quotes" },
      { to: "/sales/fit-quotes", icon: FileText, label: "Devis FIT sales", module: "partner_fit_quotes" },
      { to: "/admin/travel-agreements", icon: FileSignature, label: "Accords de voyage", module: "travel_agreements" },
      { to: "/admin/clients", icon: Users, label: "Clients CRM", module: "clients" },
    ],
  },
  {
    id: "visa",
    label: "Visa Center",
    icon: Stamp,
    items: [
      { to: "/admin/visa", icon: Stamp, label: "Demandes de visa", module: "visa" },
      { to: "/admin/visa-group-submissions", icon: ClipboardList, label: "Dépôts groupés", module: "visa_group_submissions" },
      { to: "/admin/visa-checklists", icon: ListChecks, label: "Documents visa", module: "visa_checklists" },
      { to: "/admin/visa-settings", icon: ShieldCheck, label: "Suivi & Bureau Japon", module: "visa_settings" },
      { to: "/admin/email-logs", icon: Mail, label: "Historique emails visa", module: "email_logs" },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    icon: Plane,
    items: [
      { to: "/admin/trips", icon: Plane, label: "Voyages", module: "trips" },
      { to: "/admin/operations-center", icon: ListChecks, label: "Operations Center", module: "operations_center" },
      { to: "/admin/flight-tickets", icon: TicketCheck, label: "Billets d’avion", module: "flight_tickets" },
      { to: "/admin/programmes", icon: Map, label: "Programmes opérationnels", module: "programmes" },
      { to: "/admin/hotels", icon: Hotel, label: "Hôtels", module: "hotels" },
      { to: "/admin/extras", icon: Sparkles, label: "Activités & extras", module: "extras" },
      { to: "/admin/suppliers", icon: Building2, label: "Fournisseurs Japon", module: "suppliers" },
      { to: "/admin/supplier-costs", icon: Wallet, label: "Coûts fournisseurs", module: "supplier_costs" },
      { to: "/admin/fit-supplier-control", icon: ClipboardList, label: "FIT Supplier Control", module: "supplier_costs" },
      { to: "/admin/international-payments", icon: Banknote, label: "Paiements Japon", module: "international_payments" },
    ],
  },
  {
    id: "partners",
    label: "Partner Agencies",
    icon: Building2,
    items: [
      { to: "/admin/organizations", icon: Building2, label: "Organisations", module: "organizations" },
      { to: "/admin/partner-requests", icon: Users, label: "Demandes partenaires", module: "partner_requests" },
      { to: "/admin/agency-fit-requests", icon: FolderKanban, label: "Agency FIT", module: "agency_fit_requests" },
      { to: "/admin/agency-settings", icon: Settings, label: "Paramètres agence", module: "agency_settings" },
    ],
  },
  {
    id: "finance",
    label: "Finance",
    icon: CircleDollarSign,
    items: [
      { to: "/admin/accounting", icon: Banknote, label: "Comptabilité", module: "accounting" },
      { to: "/admin/international-payments", icon: Wallet, label: "Paiements", module: "international_payments" },
      { to: "/admin/supplier-costs", icon: CircleDollarSign, label: "Commissions & coûts", module: "supplier_costs" },
    ],
  },
  {
    id: "marketing",
    label: "Marketing",
    icon: Send,
    items: [
      { to: "/admin/marketing", icon: Send, label: "Marketing dashboard", module: "marketing" },
      { to: "/admin/articles", icon: BookOpen, label: "Blog & articles", module: "articles" },
      { to: "/admin/pages", icon: FileText, label: "Pages éditoriales", module: "pages" },
      { to: "/admin/media", icon: ImageIcon, label: "Media library", module: "media" },
      { to: "/admin/email-templates", icon: FileText, label: "Email templates", module: "email_templates" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    icon: UserCog,
    items: [
      { to: "/admin/users", icon: ShieldCheck, label: "Users, rôles & permissions", module: "users" },
      { to: "/admin/operation-task-templates", icon: ListChecks, label: "Tâches standards", module: "operation_task_templates" },
      { to: "/admin/user-guide", icon: HelpCircle, label: "FAQ & User Guide", module: "faqs" },
      { to: "/admin/faqs", icon: HelpCircle, label: "FAQ publique", module: "faqs" },
      { to: "/admin/email-settings", icon: Mail, label: "Paramètres email", module: "email_settings" },
      { to: "/admin/email-logs", icon: Mail, label: "Logs emails", module: "email_logs" },
      { to: "/admin/translations", icon: Languages, label: "Traductions", module: "translations" },
      { to: "/admin/frontend", icon: Type, label: "Textes interface", module: "frontend" },
      { to: "/admin/backups", icon: Archive, label: "Backups", module: "backups" },
      { to: "/admin/theme", icon: Palette, label: "Design system", module: "theme" },
    ],
  },
];

const flatNav = navGroups.flatMap((group) => group.items);

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
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") {
      return { dashboard: true, sales: true, visa: true, operations: true };
    }
    try {
      const stored = window.localStorage.getItem(ADMIN_NAV_STATE_KEY);
      if (stored) return JSON.parse(stored);
    } catch {
      // Keep default groups open when localStorage is unavailable or corrupted.
    }
    return { dashboard: true, sales: true, visa: true, operations: true };
  });

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

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_LAST_PAGE_KEY, loc.pathname);
    } catch {
      // Non-critical convenience only.
    }
  }, [loc.pathname]);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_NAV_STATE_KEY, JSON.stringify(openGroups));
    } catch {
      // Non-critical navigation preference only.
    }
  }, [openGroups]);

  const visibleGroups = useMemo(() => navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => can(item.module)) }))
    .filter((group) => group.items.length > 0),
  [can]);
  const visibleNav = useMemo(() => visibleGroups.flatMap((group) => group.items), [visibleGroups]);
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

  const isItemActive = (item: AdminNavItem) =>
    item.end ? loc.pathname === item.to : loc.pathname === item.to || loc.pathname.startsWith(`${item.to}/`);

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
            "admin-sidebar-link group relative flex items-center gap-3 rounded-md border-l-2 px-3 py-2.5 text-[14px] font-medium transition-all duration-200 ease-out",
            isActive
              ? "admin-sidebar-link-active border-l-orange-500 bg-sky-50 text-slate-950 font-semibold"
              : "admin-sidebar-link-idle border-l-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          )
        }
      >
        <Icon className="h-5 w-5 shrink-0 stroke-[2]" />
        <span className="truncate">{item.label}</span>
      </NavLink>
    );
  };

  const toggleGroup = (id: NavGroupId) => {
    setOpenGroups((current) => ({ ...current, [id]: !current[id] }));
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
        <div className="space-y-3">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const active = group.items.some(isItemActive);
            const isOpen = openGroups[group.id] ?? active;
            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  className={cn(
                    "admin-sidebar-section flex w-full items-center gap-3 rounded-md px-3 py-3 text-left text-[15px] font-bold tracking-normal transition-colors duration-200 ease-out",
                    isOpen || active
                      ? "bg-slate-100 text-slate-950"
                      : "text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                  )}
                  aria-expanded={isOpen}
                  onClick={() => toggleGroup(group.id)}
                >
                  <GroupIcon className="h-5 w-5 shrink-0 stroke-[2] text-slate-900" />
                  <span className="min-w-0 flex-1 truncate">{group.label}</span>
                  <ChevronDown className={cn("h-5 w-5 shrink-0 text-slate-500 transition-transform duration-200 ease-out", isOpen ? "rotate-180" : "")} />
                </button>
                {isOpen && (
                  <div className="ml-5 space-y-1 rounded-l border-l-2 border-[#D1D5DB] pl-3">
                    {group.items.map((item) => <NavLinkItem key={`${group.id}-${item.to}`} item={item} onNavigate={onNavigate} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
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
  const current = flatNav.find((n) => (n.end ? loc.pathname === n.to : loc.pathname === n.to || loc.pathname.startsWith(`${n.to}/`)));
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
