// The Mindful Money API (backend/). Set EXPO_PUBLIC_API_URL in .env (local:
// http://localhost:8000; a device on your network needs the machine's LAN IP).
// Unset, the research and portfolio screens show a "not connected" state.
export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

// Where checkout and the billing portal send the user back (must be listed in
// the API's BILLING_RETURN_URLS).
export const BILLING_RETURN_URL = "mmmapp://pro";
