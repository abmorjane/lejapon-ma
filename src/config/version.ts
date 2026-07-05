// Single source of truth for the deployed site version.
// Update this value at each deployment to verify the correct build is live.
export const SITE_VERSION = "V2.002";
export const SITE_BUILD_DATE = "2026-05-13";
export const PLATFORM_VERSION = "V2.5.0";
export const PLATFORM_RELEASE_CHANNEL = "Travel Agreements & UX Stabilization";
export const PLATFORM_BADGE_LABEL = `${PLATFORM_VERSION} — ${PLATFORM_RELEASE_CHANNEL}`;

// Fallback used when bundler somehow strips the constant.
export const SAFE_SITE_VERSION = SITE_VERSION || "V2.002";
