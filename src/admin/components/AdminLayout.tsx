import { ReactNode, useState } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  LayoutDashboard, Plane, CalendarCheck, Sparkles, Users, FileText, Wallet,
  Image as ImageIcon, Building2, BookOpen, LogOut, ShieldCheck, Mail, Stamp, ListChecks, Menu, Map, Type, Send, HelpCircle, Languages,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import logo from "@/assets/logo-lejapon.png";
import { cn } from "@/lib/utils";
import { ModuleKey, ROLE_LABELS, Role } from "../lib/permissions";

const nav: { to: string; icon: any; label: string; end?: boolean; module: ModuleKey }[] = [
  { to: "/admin", icon: LayoutDashboard, label: "Vue d'ensemble", end: true, module: "dashboard" },
  { to: "/admin/trips", icon: Plane, label: "Voyages", module: "trips" },
  { to: "/admin/bookings", icon: CalendarCheck, label: "Réservations", module: "bookings" },
  { to: "/admin/clients", icon: Users, label: "Clients (CRM)", module: "clients" },
  { to: "/admin/marketing", icon: Send, label: "Emailing marketing", module: "marketing" },
  { to: "/admin/extras", icon: Sparkles, label: "Extras", module: "extras" },
  { to: "/admin/suppliers", icon: Building2, label: "Fournisseurs", module: "suppliers" },
  { to: "/admin/supplier-costs", icon: Wallet, label: "Coûts fournisseurs", module: "supplier_costs" },
  { to: "/admin/articles", icon: BookOpen, label: "Articles", module: "articles" },
  { to: "/admin/pages", icon: FileText, label: "Pages", module: "pages" },
  { to: "/admin/faqs", icon: HelpCircle, label: "FAQ", module: "faqs" },
  { to: "/admin/frontend", icon: Type, label: "Frontend (textes)", module: "frontend" },
  { to: "/admin/translations", icon: Languages, label: "Traductions", module: "translations" },
  { to: "/admin/programmes", icon: Map, label: "Programmes", module: "programmes" },
  { to: "/admin/media", icon: ImageIcon, label: "Médias", module: "media" },
  { to: "/admin/users", icon: ShieldCheck, label: "Utilisateurs & Rôles", module: "users" },
  { to: "/admin/email-settings", icon: Mail, label: "Paramètres email", module: "email_settings" },
  { to: "/admin/visa", icon: Stamp, label: "Demandes de visa", module: "visa" },
  { to: "/admin/visa-checklists", icon: ListChecks, label: "Documents requis", module: "visa_checklists" },
  { to: "/admin/visa-settings", icon: ShieldCheck, label: "Paramètres visa", module: "visa_settings" },
];

export const AdminLayout = ({ children }: { children?: ReactNode }) => {
  const { user, isStaff, loading, signOut, roles, can } = useAuth();
  const loc = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement…</div>;
  if (!user) return <Navigate to="/admin/login" state={{ from: loc.pathname }} replace />;
  if (!isStaff) return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="font-display text-2xl">Accès refusé</h1>
      <p className="text-muted-foreground max-w-md">Votre compte n'a pas de rôle staff. Demandez à un administrateur de vous attribuer un rôle.</p>
      <Button variant="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  );

  const SidebarBody = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="p-5 border-b border-border">
        <NavLink to="/" className="flex items-center gap-2" onClick={onNavigate}>
          <img src={logo} alt="lejapon.ma" className="h-8 w-auto" />
          <span className="text-xs text-muted-foreground font-medium">/ admin</span>
        </NavLink>
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {nav.filter((n) => can(n.module)).map((n) => {
          const Icon = n.icon;
          return (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  isActive ? "bg-accent text-accent-foreground" : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                )
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{n.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="p-3 border-t border-border">
        <div className="px-3 py-2 mb-2">
          <p className="text-xs text-muted-foreground">Connecté</p>
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

  const bottomNav = nav.filter((n) => can(n.module)).filter((n) =>
    ["/admin", "/admin/bookings", "/admin/clients", "/admin/visa", "/admin/trips", "/admin/programmes"].includes(n.to)
  );

  return (
    <div className="admin-mobile-shell min-h-screen flex bg-secondary/30">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-64 bg-background border-r border-border flex-col sticky top-0 h-screen">
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 flex flex-col">
          <SidebarBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between gap-3 bg-background/95 backdrop-blur border-b border-border px-4 h-14">
          <Button variant="ghost" size="icon" aria-label="Ouvrir le menu" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </Button>
          <NavLink to="/admin" className="flex items-center gap-2">
            <img src={logo} alt="lejapon.ma" className="h-7 w-auto" />
            <span className="text-xs text-muted-foreground font-medium">/ admin</span>
          </NavLink>
          <div className="w-9" aria-hidden />
        </header>

        <div className="p-4 pb-24 sm:p-6 lg:p-10 max-w-7xl w-full mx-auto">
          {children ?? <Outlet />}
        </div>
      </main>

      <nav className="lg:hidden fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 pb-[env(safe-area-inset-bottom)]">
        <div className="grid h-16" style={{ gridTemplateColumns: `repeat(${bottomNav.length}, minmax(0, 1fr))` }}>
          {bottomNav.map((n) => {
            const Icon = n.icon;
            return (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition-colors",
                    isActive ? "text-accent" : "text-muted-foreground"
                  )
                }
              >
                <Icon className="h-5 w-5 shrink-0" />
                <span className="w-full truncate text-center">{n.label.replace("Demandes de visa", "Visa").replace("Vue d'ensemble", "Accueil").replace("Clients (CRM)", "Clients")}</span>
              </NavLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
