import { Platform } from "react-native";

/**
 * Resolves the backend base URL that the frontend should talk to.
 *
 * Why this exists:
 *   The frontend can run in three very different places, and each needs a
 *   different base URL:
 *
 *   1. Emergent preview / production web deploy
 *      The web app and backend are on the same origin; ingress proxies
 *      "/api/*" to FastAPI. The committed `frontend/.env` ships
 *      `EXPO_PUBLIC_BACKEND_URL=https://<emergent-host>` and we just use it.
 *
 *   2. `docker-compose up` on a developer's laptop
 *      Expo web is served on http://localhost:8081, backend on
 *      http://localhost:8001 (host port published from the `ride_backend`
 *      container). The bundle baked the Emergent host into env, but the
 *      browser is on localhost — so we must NOT use the env value here.
 *      We detect localhost / LAN IP at runtime and rewrite the host:port.
 *
 *   3. Expo Go on a phone / native build
 *      `window` doesn't exist, so we fall back to EXPO_PUBLIC_BACKEND_URL
 *      (which should be the LAN IP of the docker host, or the deployed
 *      backend URL).
 */

const ENV_URL = (process.env.EXPO_PUBLIC_BACKEND_URL as string | undefined) || "";

function isLocalHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") return true;
  // Private LAN ranges (RFC1918)
  if (/^10\./.test(hostname)) return true;
  if (/^192\.168\./.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true;
  // *.local (mDNS)
  if (/\.local$/i.test(hostname)) return true;
  return false;
}

function stripTrailingSlash(u: string): string {
  return u.endsWith("/") ? u.slice(0, -1) : u;
}

/**
 * Returns the backend origin (no trailing slash, no `/api` suffix).
 * Use `getApiUrl()` if you want the `/api`-suffixed base.
 */
export function getBackendUrl(): string {
  // Web: prefer runtime detection so localhost / LAN works without rebuilding.
  if (Platform.OS === "web" && typeof window !== "undefined" && window.location) {
    const { protocol, hostname, port } = window.location;

    if (isLocalHostname(hostname)) {
      // docker-compose / yarn web dev: Expo web on :8081, backend on :8001.
      // Always rewrite to backend's port, regardless of what was baked in.
      return `${protocol}//${hostname}:8001`;
    }

    // Hosted web (Emergent preview, prod deploy):
    //   If env var is set AND points to the same host we're on, use it.
    //   Otherwise prefer the current origin (single-domain deploys behind ingress).
    if (ENV_URL) {
      try {
        const envHost = new URL(ENV_URL).hostname;
        if (envHost === hostname) return stripTrailingSlash(ENV_URL);
      } catch {
        /* fallthrough */
      }
    }
    const portPart = port ? `:${port}` : "";
    return `${protocol}//${hostname}${portPart}`;
  }

  // Native (Expo Go, iOS/Android builds): no `window`, must use env.
  return stripTrailingSlash(ENV_URL);
}

/** Backend base URL with `/api` suffix. */
export function getApiUrl(): string {
  return `${getBackendUrl()}/api`;
}
