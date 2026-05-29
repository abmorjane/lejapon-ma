// Centralized role-based permissions for the admin dashboard.
// Roles must match the `app_role` enum in the database.

export type Role =
  | "super_admin"
  | "admin"
  | "manager"
  | "agent"
  | "content_manager"
  | "supplier"
  | "marketing_manager";

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Sales Manager",
  agent: "Agent",
  content_manager: "Content Manager",
  supplier: "Fournisseur Japon",
  marketing_manager: "Responsable marketing",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  super_admin: "Accès complet — gère utilisateurs et rôles",
  admin: "Gère voyages et réservations",
  manager: "Accède aux leads et met à jour les clients",
  agent: "Suivi opérationnel des réservations",
  content_manager: "Gère le blog et les pages",
  supplier: "Saisie tarifs & logistique (Japon)",
  marketing_manager: "Gère les campagnes emailing et la base contacts",
};

// Permissions per module. A user has access if they hold ANY of the listed roles.
export const MODULE_PERMISSIONS = {
  dashboard: ["super_admin", "admin", "manager", "agent", "content_manager", "supplier"],
  trips: ["super_admin", "admin", "manager", "supplier"],
  bookings: ["super_admin", "admin", "manager", "agent"],
  clients: ["super_admin", "admin", "manager", "agent"],
  partner_requests: ["super_admin", "admin", "manager"],
  extras: ["super_admin", "admin", "supplier"],
  suppliers: ["super_admin", "admin"],
  supplier_costs: ["super_admin", "admin"],
  articles: ["super_admin", "content_manager"],
  pages: ["super_admin", "content_manager"],
  media: ["super_admin", "admin", "content_manager"],
  users: ["super_admin"],
  organizations: ["super_admin"],
  agency_settings: ["super_admin", "admin"],
  email_settings: ["super_admin"],
  email_logs: ["super_admin", "admin"],
  backups: ["super_admin"],
  visa: ["super_admin", "admin", "manager", "agent"],
  visa_settings: ["super_admin"],
  visa_checklists: ["super_admin", "admin"],
  programmes: ["super_admin", "admin", "content_manager"],
  frontend: ["super_admin", "admin", "content_manager"],
  marketing: ["super_admin", "admin", "marketing_manager"],
  marketing_settings: ["super_admin", "admin"],
  faqs: ["super_admin", "admin", "content_manager"],
  translations: ["super_admin", "admin", "content_manager"],
} as const satisfies Record<string, readonly Role[]>;

export type ModuleKey = keyof typeof MODULE_PERMISSIONS;

export function canAccess(roles: string[], module: ModuleKey): boolean {
  const allowed = MODULE_PERMISSIONS[module] as readonly string[];
  return roles.some((r) => allowed.includes(r));
}

export function hasAnyRole(roles: string[], allowed: readonly Role[]): boolean {
  return roles.some((r) => (allowed as readonly string[]).includes(r));
}
