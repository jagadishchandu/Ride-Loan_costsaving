import { Platform } from "react-native";
import { getBackendUrl } from "./backend";

/**
 * Returns the origin URL to use as the base for PayPal/Stripe return URLs.
 *
 * - On web: uses window.location.origin (the actual page the user is on,
 *   which is the right URL to redirect back to after checkout).
 * - On native: uses EXPO_PUBLIC_APP_URL if set, else falls back to the
 *   resolved backend URL (which on Emergent shares one domain with the
 *   frontend; on docker/local that's http://localhost:8001 — the redirect
 *   back to the app is then handled by expo-web-browser).
 */
export function getAppOrigin(): string {
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return (
    (process.env.EXPO_PUBLIC_APP_URL as string | undefined) ||
    getBackendUrl() ||
    ""
  );
}
