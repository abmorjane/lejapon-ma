import { SupplierLanguageProvider, SupplierLanguageSelector, useSupplierTranslation } from "@/i18n/supplier/SupplierLanguageProvider";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { ClipboardList, FileCheck2, LogOut, Plane } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo-lejapon.png";
import { hasAdminRole, hasSupplierRole } from "../lib/portal-access";

export const SupplierLayout = () => {
  const { user } = useAuth();
  return <SupplierLanguageProvider key={user?.id || "guest"} user={user}><SupplierLayoutContent /></SupplierLanguageProvider>;
};

const SupplierLayoutContent = () => {
  const { t } = useSupplierTranslation();
  const { user, roles, loading, signOut } = useAuth();
  const loc = useLocation();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">{t("Chargement…")}</div>;
  if (!user) return <Navigate to="/supplier/login" state={{ from: loc.pathname }} replace />;

  const isSupplier = hasSupplierRole(roles) || hasAdminRole(roles);
  if (!isSupplier) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-display text-2xl">{t("Accès refusé")}</h1>
        <p className="text-muted-foreground max-w-md">{t("Cette zone est réservée aux fournisseurs partenaires au Japon.")}</p>
        <Button variant="outline" onClick={signOut}>{t("Se déconnecter")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="bg-background border-b border-border sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <NavLink to="/supplier" className="flex items-center gap-2">
            <img src={logo} alt="lejapon.ma" className="h-8 w-auto" />
            <span className="text-xs text-muted-foreground font-medium">{t("/ Japan office")}</span>
          </NavLink>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <SupplierLanguageSelector />
            <NavLink to="/supplier" end className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
            }>
              <Plane className="w-4 h-4" /> {t("Vue d'ensemble")} </NavLink>
            <NavLink to="/supplier/trips" className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
            }>
              <ClipboardList className="w-4 h-4" /> {t("Voyages assignés")} </NavLink>
            <NavLink to="/supplier/fit-requests" className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
            }>
              <FileCheck2 className="w-4 h-4" /> {t("FIT assignés")} </NavLink>
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground leading-tight">{user.email}</p>
              <p className="text-[10px] text-accent leading-tight">{t("Fournisseur Japon")}</p>
            </div>
            <Button aria-label={t("Se déconnecter")} variant="outline" size="sm" onClick={signOut}><LogOut className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6 md:p-10">
        <Outlet />
      </main>
    </div>
  );
};
