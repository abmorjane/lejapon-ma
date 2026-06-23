import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import { canAccess, ModuleKey } from "../lib/permissions";
import { ShieldOff } from "lucide-react";
import { Navigate } from "react-router-dom";

const salesFitRoles = ["manager", "sales", "sales_user", "sales_manager"];
const partnerFitRoles = ["partner_agency_admin", "partner_agent"];

export const RequireRole = ({ module, children }: { module: ModuleKey; children: ReactNode }) => {
  const { roles } = useAuth();
  if (!canAccess(roles, module)) {
    if (
      module === "fit_quotes"
      && roles.some((role) => [...salesFitRoles, ...partnerFitRoles].includes(role))
    ) {
      return <Navigate to={roles.some((role) => salesFitRoles.includes(role)) ? "/sales/fit-quotes" : "/agency/fit-quotes"} replace />;
    }
    return (
      <div className="flex flex-col items-center justify-center text-center py-20 gap-3">
        <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center">
          <ShieldOff className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="font-display text-xl">Accès restreint</h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          Votre rôle ne vous permet pas d'accéder à ce module. Contactez un Super Admin pour obtenir les droits nécessaires.
        </p>
      </div>
    );
  }
  return <>{children}</>;
};
