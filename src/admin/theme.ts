export type AdminThemeId = "classic" | "premium-dashboard";

export type AdminThemeConfig = {
  id: AdminThemeId;
  name: string;
  description: string;
  accent: string;
};

export const ADMIN_THEME_STORAGE_KEY = "lejapon.admin.theme";

export const ADMIN_THEMES: Record<AdminThemeId, AdminThemeConfig> = {
  classic: {
    id: "classic",
    name: "Classic",
    description: "Interface admin actuelle, claire et familiere.",
    accent: "Orange LeJapon.ma",
  },
  "premium-dashboard": {
    id: "premium-dashboard",
    name: "Premium dashboard",
    description: "Sidebar charbon, tables compactes et surface SaaS plus professionnelle.",
    accent: "Ambre premium",
  },
};

export const DEFAULT_ADMIN_THEME: AdminThemeId = "premium-dashboard";

export function isAdminThemeId(value: unknown): value is AdminThemeId {
  return typeof value === "string" && value in ADMIN_THEMES;
}

export function readAdminTheme(): AdminThemeId {
  if (typeof window === "undefined") return DEFAULT_ADMIN_THEME;
  try {
    const stored = window.localStorage.getItem(ADMIN_THEME_STORAGE_KEY);
    return isAdminThemeId(stored) ? stored : DEFAULT_ADMIN_THEME;
  } catch {
    return DEFAULT_ADMIN_THEME;
  }
}

export function saveAdminTheme(theme: AdminThemeId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ADMIN_THEME_STORAGE_KEY, theme);
    window.dispatchEvent(new CustomEvent("admin-theme-change", { detail: theme }));
  } catch {
    window.dispatchEvent(new CustomEvent("admin-theme-change", { detail: DEFAULT_ADMIN_THEME }));
  }
}

export function resetAdminTheme() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ADMIN_THEME_STORAGE_KEY);
  } catch {
    // localStorage can be unavailable in private contexts; classic remains the fallback.
  }
  window.dispatchEvent(new CustomEvent("admin-theme-change", { detail: DEFAULT_ADMIN_THEME }));
}
