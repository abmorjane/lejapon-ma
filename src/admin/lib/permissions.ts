// Centralized role-based permissions for the admin dashboard.
// Roles must match the `app_role` enum in the database.

export type Role =
  | "super_admin"
  | "admin"
  | "manager"
  | "sales"
  | "sales_user"
  | "sales_manager"
  | "partner_agency_admin"
  | "partner_agent"
  | "agent"
  | "content_manager"
  | "supplier"
  | "marketing_manager";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Sales Manager",
  sales: "Commercial",
  sales_user: "Commercial",
  sales_manager: "Sales Manager",
  partner_agency_admin: "Admin agence partenaire",
  partner_agent: "Agent agence partenaire",
  agent: "Agent",
  content_manager: "Content Manager",
  supplier: "Fournisseur Japon",
  marketing_manager: "Responsable marketing",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Accès complet — gère utilisateurs et rôles",
  admin: "Gère voyages et réservations",
  manager: "Accède aux leads et met à jour les clients",
  sales: "Accède aux leads et met à jour les clients",
  sales_user: "Accède aux leads et met à jour les clients",
  sales_manager: "Crée des devis commerciaux sans accès aux coûts internes",
  partner_agency_admin: "Gère les devis et paramètres de son agence partenaire",
  partner_agent: "Dépose des demandes FIT pour son agence partenaire",
  agent: "Suivi opérationnel des réservations",
  content_manager: "Gère le blog et les pages",
  supplier: "Saisie tarifs & logistique (Japon)",
  marketing_manager: "Gère les campagnes emailing et la base contacts",
};

// Permissions per module. A user has access if they hold ANY of the listed roles.
export const MODULE_PERMISSIONS = {
  dashboard: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent", "content_manager"],
  trips: ["super_admin", "admin", "manager"],
  bookings: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent"],
  accounting: ["super_admin", "admin", "manager"],
  travel_agreements: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent"],
  clients: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent"],
  partner_requests: ["super_admin", "admin", "manager"],
  agency_fit_requests: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager"],
  extras: ["super_admin", "admin"],
  suppliers: ["super_admin", "admin"],
  supplier_costs: ["super_admin", "admin"],
  operations_center: ["super_admin", "admin", "manager", "agent"],
  flight_tickets: ["super_admin", "admin", "manager", "agent"],
  operation_task_templates: ["super_admin", "admin"],
  fit_quotes: ["super_admin", "admin"],
  fit_control_tower: ["super_admin", "admin"],
  partner_fit_quotes: ["manager", "sales", "sales_user", "sales_manager", "partner_agency_admin", "partner_agent"],
  international_payments: ["super_admin", "admin"],
  articles: ["super_admin", "content_manager"],
  pages: ["super_admin", "content_manager"],
  media: ["super_admin", "admin", "content_manager"],
  users: ["super_admin"],
  organizations: ["super_admin"],
  agency_settings: ["super_admin", "admin"],
  email_settings: ["super_admin"],
  email_templates: ["super_admin", "admin", "marketing_manager"],
  email_logs: ["super_admin", "admin"],
  backups: ["super_admin"],
  visa: ["super_admin", "admin", "manager", "sales", "sales_user", "sales_manager", "agent"],
  visa_group_submissions: ["super_admin", "admin", "manager", "agent"],
  visa_settings: ["super_admin"],
  visa_checklists: ["super_admin", "admin"],
  programmes: ["super_admin", "admin", "content_manager"],
  hotels: ["super_admin", "admin", "content_manager"],
  frontend: ["super_admin", "admin", "content_manager"],
  marketing: ["super_admin", "admin", "marketing_manager"],
  marketing_settings: ["super_admin", "admin"],
  faqs: ["super_admin", "admin", "content_manager"],
  translations: ["super_admin", "admin", "content_manager"],
  theme: ["super_admin", "admin"],
} as const satisfies Record<string, readonly Role[]>;

export type ModuleKey = keyof typeof MODULE_PERMISSIONS;

export function canAccess(roles: string[], module: ModuleKey): boolean {
  const allowed = MODULE_PERMISSIONS[module] as readonly string[];
  return roles.some((r) => allowed.includes(r));
}

export function hasAnyRole(roles: string[], allowed: readonly Role[]): boolean {
  return roles.some((r) => (allowed as readonly string[]).includes(r));
}
