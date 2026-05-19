import { NavLink, Outlet } from "react-router-dom";
import { LayoutDashboard, Users, Filter, Send, FileText, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

const tabs = [
  { to: "/admin/marketing", end: true, icon: LayoutDashboard, label: "Tableau de bord", module: "marketing" as const },
  { to: "/admin/marketing/campaigns", icon: Send, label: "Campagnes", module: "marketing" as const },
  { to: "/admin/marketing/contacts", icon: Users, label: "Contacts", module: "marketing" as const },
  { to: "/admin/marketing/segments", icon: Filter, label: "Segments", module: "marketing" as const },
  { to: "/admin/marketing/templates", icon: FileText, label: "Templates", module: "marketing" as const },
  { to: "/admin/marketing/settings", icon: Settings, label: "Paramètres", module: "marketing_settings" as const },
];

export default function MarketingLayout() {
  const { can } = useAuth();
  return (
    <div className="space-y-6">
      <nav className="flex flex-wrap gap-1 border-b border-border -mx-4 px-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        {tabs.filter((t) => can(t.module)).map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              cn(
                "inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors",
                isActive
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              )
            }
          >
            <t.icon className="w-4 h-4" /> {t.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}