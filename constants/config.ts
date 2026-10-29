// The KaventaFi API (backend/). Set EXPO_PUBLIC_API_URL in .env (local:
// http://localhost:8000; a device on your network needs the machine's LAN IP).
// Unset, the research and portfolio screens show a "not connected" state.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

/**
 * Sign-in (Clerk). Defaults to the Riches Digital Ventures production instance
 * (clerk.richesdigitalventures.com), shared with Riches Analytics, so one
 * account works across both apps on *.richesdigitalventures.com. A publishable
 * key is public by design. Override with EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY
 * (e.g. a pk_test_ key for local development, since production keys only
 * accept the production domain).
 */
export const CLERK_PUBLISHABLE_KEY =
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY || "pk_live_Y2xlcmsucmljaGVzZGlnaXRhbHZlbnR1cmVzLmNvbSQ";

// Where checkout and the billing portal send the user back (must be listed in
// the API's BILLING_RETURN_URLS).
export const BILLING_RETURN_URL = "kaventafi://pro";
