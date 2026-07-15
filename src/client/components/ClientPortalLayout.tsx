import { ReactNode } from "react";
import { Link, Navigate, NavLink, Outlet, useLocation } from "react-router-dom";
import { CalendarCheck, FileSignature, FileText, HelpCircle, LogOut, Plane, Sparkles, Stamp } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/logo-lejapon.png";
import { CLIENT_LOGIN_CANONICAL_PATH, CLIENT_PORTAL_CANONICAL_PATH } from "../lib/auth-urls";

const nav = [
  { to: CLIENT_PORTAL_CANONICAL_PATH, label: "Mon voyage", icon: Plane, end: true },
  { to: `${CLIENT_PORTAL_CANONICAL_PATH}/reservations`, label: "Réservations", icon: CalendarCheck },
  { to: `${CLIENT_PORTAL_CANONICAL_PATH}/documents`, label: "Documents", icon: FileText },
  { to: `${CLIENT_PORTAL_CANONICAL_PATH}/visa`, label: "Visa", icon: Stamp },
  { to: `${CLIENT_PORTAL_CANONICAL_PATH}/accords`, label: "Accords", icon: FileSignature },
  { to: `${CLIENT_PORTAL_CANONICAL_PATH}/experiences`, label: "Expériences", icon: Sparkles },
];

const WHATSAPP_FALLBACK = "212661800008";
const whatsappHref = `https://wa.me/${WHATSAPP_FALLBACK}?text=${encodeURIComponent("Bonjour, j’ai une question concernant mon espace voyage LeJapon.ma.")}`;

export function RequireClientPortal({ children }: { children?: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] text-sm text-muted-foreground">
        Chargement de votre espace…
      </div>
    );
  }

  if (!user) return <Navigate to={CLIENT_LOGIN_CANONICAL_PATH} state={{ from: location.pathname }} replace />;

  return <>{children ?? <Outlet />}</>;
}

export default function ClientPortalLayout() {
  const { user, loading, signOut } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f8fafc] text-sm text-muted-foreground">
        Chargement de votre espace…
      </div>
    );
  }

  if (!user) return <Navigate to={CLIENT_LOGIN_CANONICAL_PATH} state={{ from: location.pathname }} replace />;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-foreground">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to={CLIENT_PORTAL_CANONICAL_PATH} className="flex items-center gap-3">
            <img src={logo} alt="LeJapon.ma" className="h-9 w-auto" />
            <span className="hidden text-sm font-medium text-muted-foreground sm:inline">/ Mon voyage</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[220px] truncate text-xs text-muted-foreground sm:block">{user?.email}</span>
            <Button variant="outline" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Déconnexion</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-5 px-4 py-5 lg:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <nav className="flex gap-2 overflow-x-auto rounded-xl border bg-white p-2 lg:flex-col lg:overflow-visible">
            {nav.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                      isActive ? "bg-red-600 text-white shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="mt-4 hidden rounded-xl border bg-white p-4 text-sm text-muted-foreground lg:block">
            <div className="mb-2 flex items-center gap-2 font-medium text-foreground">
              <HelpCircle className="h-4 w-4 text-red-600" />
              Besoin d’aide ?
            </div>
            <p>Notre équipe reste disponible pour vos documents, paiements et prochaines étapes.</p>
            <Button asChild className="mt-3 w-full" size="sm">
              <a href={whatsappHref} target="_blank" rel="noreferrer">WhatsApp</a>
            </Button>
          </div>
        </aside>

        <main className="min-w-0 pb-12">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
