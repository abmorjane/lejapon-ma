import { Navigate, useLocation, useParams } from "react-router-dom";

/**
 * Maps legacy WordPress URLs from lejapon.ma (pre-rebuild) to the new
 * React Router routes, preserving SEO link equity via 301-style client redirects.
 * Pair this with server-side 301s in production for full SEO benefit.
 */

// Static one-to-one mappings
const STATIC_MAP: Record<string, string> = {
  "/programme": "/voyages",
  "/programme-2": "/voyages",
  "/prix": "/reserver",
  "/paiement": "/reserver",
  "/inscription": "/reserver",
  "/extra-plans": "/experiences",
  "/hotels": "/voyages",
  "/hotels-avril": "/voyages",
  "/accueil-2": "/",
  "/a2": "/a-propos",
  "/demande-de-visa-pour-le-japon": "/visa",
  "/accord-de-voyage": "/contact",
  "/accord-de-voyage-avril": "/contact",
  "/accord-de-voyage-2": "/contact",
  "/questionnaire-de-satisfaction": "/contact",
  "/politique-de-confidentialite": "/a-propos",
  "/login-customizer": "/admin/login",
};

export const LegacyStaticRedirect = () => {
  const { pathname } = useLocation();
  const clean = pathname.replace(/\/+$/, "").toLowerCase();
  const to = STATIC_MAP[clean] ?? "/";
  return <Navigate to={to} replace />;
};

/** /extra-plans/:slug → /experiences */
export const LegacyExtraRedirect = () => {
  return <Navigate to="/experiences" replace />;
};

/** Legacy article slugs (single-segment) → /blog/:slug (preserve SEO equity) */
export const LegacyArticleRedirect = () => {
  const { pathname } = useLocation();
  const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return <Navigate to={slug ? `/blog/${slug}` : "/blog"} replace />;
};