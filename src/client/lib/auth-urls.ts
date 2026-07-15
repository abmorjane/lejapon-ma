const CANONICAL_SITE_ORIGIN = "https://www.lejapon.ma";

export const CLIENT_LOGIN_PATH = "/client/login";
export const CLIENT_PORTAL_PATH = "/client";
export const CLIENT_PORTAL_CANONICAL_PATH = "/espace-voyage";
export const CLIENT_LOGIN_CANONICAL_PATH = "/espace-voyage/login";
export const CLIENT_PASSWORD_RECOVERY_PATH = "/espace-voyage/nouveau-mot-de-passe";

const cleanOrigin = (value?: string | null) => {
  const trimmed = String(value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    return new URL(trimmed).origin;
  } catch {
    return "";
  }
};

export function publicSiteOrigin() {
  const configured = cleanOrigin(
    import.meta.env.VITE_PUBLIC_SITE_URL ||
    import.meta.env.VITE_SITE_URL ||
    import.meta.env.VITE_APP_URL,
  );
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname === "www.lejapon.ma" || hostname === "lejapon.ma") return origin;
    if (import.meta.env.DEV || hostname === "localhost" || hostname === "127.0.0.1") return origin;
  }

  return CANONICAL_SITE_ORIGIN;
}

export function clientLoginUrl() {
  return `${publicSiteOrigin()}${CLIENT_LOGIN_CANONICAL_PATH}`;
}

export function clientPortalUrl() {
  return `${publicSiteOrigin()}${CLIENT_PORTAL_CANONICAL_PATH}`;
}

export function clientPasswordRecoveryUrl() {
  return `${publicSiteOrigin()}${CLIENT_PASSWORD_RECOVERY_PATH}`;
}
