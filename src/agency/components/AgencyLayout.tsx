import { NavLink, Outlet, useLocation } from "react-router-dom";
import { BarChart3, BookOpen, Building2, LogOut, Menu, Percent, UserCircle } from "lucide-react";
import { useState } from "react";
import logo from "@/assets/logo-lejapon.png";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useAgencyContext } from "../useAgencyContext";

const navItems = [
  { to: "/agency", label: "Tableau de bord", icon: BarChart3, end: true, activeOnly: true },
  { to: "/agency/bookings", label: "Réservations", icon: BookOpen, activeOnly: true },
  { to: "/agency/commission", label: "Commissions", icon: Percent, activeOnly: true },
  { to: "/agency/profile", label: "Profil agence", icon: UserCircle, activeOnly: true },
  { to: "/agency/onboarding", label: "Onboarding", icon: Building2, activeOnly: false },
];

export default function AgencyLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, signOut } = useAuth();
  const agency = useAgencyContext();
  const location = useLocation();

  const visibleNav = navItems.filter((item) => !item.activeOnly || agency.isActiveAgency);

  const NavBody = ({ onNavigate }: { onNavigate?: () => void }) => (
    <>
      <div className="border-b border-border p-5">
        <NavLink to="/agency" className="flex items-center gap-2" onClick={onNavigate}>
          <img src={logo} alt="LeJapon.ma" className="h-8 w-auto" />
          <span className="text-xs font-medium text-muted-foreground">/ agency</span>
        </NavLink>
      </div>
      <div className="border-b border-border p-4">
        <p className="truncate font-semibold">{agency.organization?.display_name ?? "Agence"}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{agency.currentMembership?.role ?? "member"}</Badge>
          <Badge variant={agency.organization?.status === "active" ? "default" : "secondary"}>
            {agency.organization?.status === "active" ? "active" : "onboarding"}
          </Badge>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-accent text-accent-foreground" : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>
      <div className="border-t border-border p-4">
        <p className="text-xs text-muted-foreground">Connecté</p>
        <p className="truncate text-sm font-medium">{user?.email}</p>
        <Button variant="outline" size="sm" className="mt-3 w-full" onClick={signOut}>
          <LogOut className="h-3.5 w-3.5" />
          Déconnexion
        </Button>
      </div>
    </>
  );

  const title = visibleNav.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to))?.label ?? "Espace partenaire";

  return (
    <div className="min-h-screen bg-secondary/25 lg:flex">
      <aside className="hidden h-screen w-72 shrink-0 flex-col border-r border-border bg-background lg:sticky lg:top-0 lg:flex">
        <NavBody />
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="flex w-72 flex-col p-0">
          <NavBody onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-border bg-background/95 px-3 backdrop-blur lg:hidden">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)} aria-label="Menu">
            <Menu className="h-5 w-5" />
          </Button>
          <span className="truncate text-sm font-semibold">{title}</span>
          <div className="w-9" />
        </header>
        <div className="mx-auto w-full max-w-7xl p-4 pb-24 sm:p-6 lg:p-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
