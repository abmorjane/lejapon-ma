import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useAgencyContext } from "../useAgencyContext";

const LoadingState = () => (
  <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
    <Loader2 className="h-4 w-4 animate-spin" />
    Chargement de l'espace partenaire…
  </div>
);

const AccessState = ({ title, message, detail }: { title: string; message: string; detail?: string | null }) => {
  const { signOut } = useAuth();
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-secondary/35 p-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-background">
        <ShieldOff className="h-6 w-6 text-muted-foreground" />
      </div>
      <div>
        <h1 className="font-display text-2xl">{title}</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">{message}</p>
        {detail && (
          <p className="mt-3 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      <Button variant="outline" onClick={signOut}>Se déconnecter</Button>
    </div>
  );
};

export function RequireAgencyMember({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const agency = useAgencyContext();
  const location = useLocation();

  if (authLoading || agency.loading) return <LoadingState />;
  if (!user) return <Navigate to="/agency/login" state={{ from: location.pathname }} replace />;
  if (!agency.hasAgencyAccess) {
    return (
      <AccessState
        title="Accès partenaire en attente"
        message="Votre compte n'est pas rattaché à une agence active ou en onboarding."
        detail={agency.error}
      />
    );
  }
  return <>{children}</>;
}

export function RequireActiveAgencyMember({ children }: { children: ReactNode }) {
  const agency = useAgencyContext();

  if (agency.loading) return <LoadingState />;
  if (agency.isSuspendedAgency) return <Navigate to="/agency/onboarding" replace />;
  if (!agency.isActiveAgency) {
    return (
      <AccessState
        title="Accès partenaire indisponible"
        message="Votre organisation n'est pas active. Contactez Moroccan Express / LeJapon.ma."
        detail={agency.error || agency.organization?.status || null}
      />
    );
  }
  return <>{children}</>;
}

export function RequireAgencyOnboarding({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const agency = useAgencyContext();
  const location = useLocation();

  if (authLoading || agency.loading) return <LoadingState />;
  if (!user) return <Navigate to="/agency/login" state={{ from: location.pathname }} replace />;
  if (!agency.hasAgencyAccess) {
    return (
      <AccessState
        title="Aucun dossier partenaire"
        message="Votre compte n'est pas encore lié à une organisation partenaire."
        detail={agency.error}
      />
    );
  }
  return <>{children}</>;
}
