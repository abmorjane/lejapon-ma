export const SUPPLIER_ROLE = "supplier";
export const SUPPLIER_PORTAL_PATH = "/supplier";
export const ADMIN_PORTAL_PATH = "/admin";

export const INTERNAL_STAFF_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "agent",
  "content_manager",
  "marketing_manager",
] as const;

export const ADMIN_ROLES = ["super_admin", "admin"] as const;

export function hasSupplierRole(roles: readonly string[]) {
  return roles.includes(SUPPLIER_ROLE);
}

export function hasInternalStaffRole(roles: readonly string[]) {
  return roles.some((role) => (INTERNAL_STAFF_ROLES as readonly string[]).includes(role));
}

export function hasAdminRole(roles: readonly string[]) {
  return roles.some((role) => (ADMIN_ROLES as readonly string[]).includes(role));
}

export function isSupplierOnlyRole(roles: readonly string[]) {
  return hasSupplierRole(roles) && !hasInternalStaffRole(roles);
}

export function portalHomeForRoles(roles: readonly string[]) {
  return isSupplierOnlyRole(roles) ? SUPPLIER_PORTAL_PATH : ADMIN_PORTAL_PATH;
}
