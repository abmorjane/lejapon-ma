import { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

const segmentLabels: Record<string, string> = {
  admin: "Admin",
  sales: "Sales",
  bookings: "Réservations",
  clients: "Clients",
  trips: "Voyages",
  workspace: "Dossier voyage",
  overview: "Vue générale",
  reservations: "Réservations",
  participants: "Participants",
  finance: "Finance",
  flights: "Vols",
  supplier: "Fournisseur",
  operations: "Opérations",
  documents: "Documents",
  programmes: "Programmes",
  hotels: "Hôtels",
  visa: "Visa",
  accounting: "Comptabilité",
  organizations: "Organisations",
  marketing: "Marketing",
  articles: "Articles",
  pages: "Pages",
  media: "Médias",
  users: "Utilisateurs",
  suppliers: "Fournisseurs",
  "supplier-costs": "Coûts fournisseurs",
  "fit-quotes": "Devis FIT",
  "agency-fit-requests": "Demandes FIT",
  "travel-agreements": "Accords de voyage",
  "flight-tickets": "Billets d’avion",
  "operation-task-templates": "Tâches standards",
  "email-templates": "Templates email",
  "email-logs": "Logs email",
  "email-settings": "Paramètres email",
  "visa-checklists": "Documents visa",
  "visa-settings": "Bureau Japon",
  "visa-group-submissions": "Dépôts groupés",
  "user-guide": "FAQ & User Guide",
};

const humanizeSegment = (segment: string) =>
  segmentLabels[segment] ?? segment.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

const buildCrumbs = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => ({
    raw: segment,
    label: humanizeSegment(segment),
    href: `/${segments.slice(0, index + 1).join("/")}`,
    current: index === segments.length - 1,
  }));
};

export const PageHeader = ({ title, description, action, breadcrumbCurrent }: { title: string; description?: string; action?: ReactNode; breadcrumbCurrent?: string }) => {
  const location = useLocation();
  const crumbs = buildCrumbs(location.pathname).filter((crumb) => !/^[0-9a-f-]{16,}$/i.test(crumb.raw));

  if (breadcrumbCurrent) {
    const current = crumbs.find(crumb => crumb.current);
    if (current) current.label = breadcrumbCurrent;
    else crumbs.push({ raw: breadcrumbCurrent, label: breadcrumbCurrent, href: location.pathname, current: true });
  }

  return (
    <header className="mb-6 rounded-lg border bg-card px-4 py-4 shadow-sm sm:px-5">
      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {crumbs.map((crumb, index) => (
          <span key={crumb.href} className="inline-flex items-center gap-1.5">
            {index > 0 && <span className="text-border">/</span>}
            {crumb.current ? (
              <span className="text-foreground">{crumb.label}</span>
            ) : (
              <Link to={crumb.href} className="transition-colors hover:text-foreground">
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-tight tracking-normal md:text-3xl">{title}</h1>
          {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex w-full shrink-0 flex-wrap gap-2 sm:w-auto sm:justify-end">{action}</div>}
      </div>
    </header>
  );
};
