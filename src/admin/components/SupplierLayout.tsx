import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { LogOut, Plane } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import logo from "@/assets/logo-lejapon.png";

export const SupplierLayout = () => {
  const { user, roles, loading, signOut } = useAuth();
  const loc = useLocation();

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Chargement…</div>;
  if (!user) return <Navigate to="/admin/login" state={{ from: loc.pathname }} replace />;

  const isSupplier = roles.includes("supplier") || roles.includes("super_admin") || roles.includes("admin");
  if (!isSupplier) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <h1 className="font-display text-2xl">Accès refusé</h1>
        <p className="text-muted-foreground max-w-md">Cette zone est réservée aux fournisseurs partenaires au Japon.</p>
        <Button variant="outline" onClick={signOut}>Se déconnecter</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary/30">
      <header className="bg-background border-b border-border sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <NavLink to="/supplier" className="flex items-center gap-2">
            <img src={logo} alt="lejapon.ma" className="h-8 w-auto" />
            <span className="text-xs text-muted-foreground font-medium">/ partenaire</span>
          </NavLink>
          <div className="flex items-center gap-3">
            <NavLink to="/supplier" className={({ isActive }) =>
              `flex items-center gap-1.5 text-sm font-medium ${isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`
            }>
              <Plane className="w-4 h-4" /> Voyages assignés
            </NavLink>
            <div className="text-right hidden sm:block">
              <p className="text-xs text-muted-foreground leading-tight">{user.email}</p>
              <p className="text-[10px] text-accent leading-tight">Fournisseur Japon</p>
            </div>
            <Button variant="outline" size="sm" onClick={signOut}><LogOut className="w-3.5 h-3.5" /></Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6 md:p-10">
        <Outlet />
      </main>
    </div>
  );
};