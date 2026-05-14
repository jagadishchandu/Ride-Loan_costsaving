import { Platform, Linking, Alert } from "react-native";
import { api, tokenStorage, TOKEN_KEY } from "./api";
import { getBackendUrl } from "./backend";

/**
 * Build the redirect URL for the OAuth callback.
 * REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
 */
export function getOAuthRedirectUrl(role: "rider" | "driver"): string {
  const path = `/auth/callback?role=${role}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + path;
  }
  // On native, the same HTTPS URL is used; expo-web-browser will detect the
  // redirect when the deployed web app receives the session_id.
  return getBackendUrl() + path;
}

export async function startGoogleAuth(role: "rider" | "driver") {
  const redirectUrl = getOAuthRedirectUrl(role);
  const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = authUrl;
    return;
  }
  // Native: open the URL — after Google login the deployed web page at
  // /auth/callback will run, exchange session_id for our JWT, and store it.
  // For Expo Go preview this still works in-browser.
  await Linking.openURL(authUrl);
}

export async function startFacebookAuth(_role: "rider" | "driver") {
  Alert.alert(
    "Facebook login not configured",
    "Add FACEBOOK_APP_ID and FACEBOOK_APP_SECRET to backend/.env to enable Facebook sign-in.",
  );
}

/* -------------------------- Microsoft (Azure AD) -------------------------- */

const MS_CLIENT_ID = process.env.EXPO_PUBLIC_MS_CLIENT_ID || "";
const MS_TENANT = process.env.EXPO_PUBLIC_MS_TENANT_ID || "common";

export function getMicrosoftRedirectUrl(role: "rider" | "driver"): string {
  const path = `/auth/microsoft-callback?role=${role}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin + path;
  }
  return getBackendUrl() + path;
}

export async function startMicrosoftAuth(role: "rider" | "driver") {
  if (!MS_CLIENT_ID) {
    Alert.alert(
      "Microsoft login not configured",
      "Set EXPO_PUBLIC_MS_CLIENT_ID and EXPO_PUBLIC_MS_TENANT_ID in frontend/.env",
    );
    return;
  }
  const redirectUrl = getMicrosoftRedirectUrl(role);
  // Random state for CSRF; include role so the callback knows who's coming back
  const state = `${role}_${Math.random().toString(36).slice(2)}`;
  if (typeof window !== "undefined") {
    try {
      window.sessionStorage?.setItem("ms_oauth_state", state);
    } catch {
      /* ignore */
    }
  }
  const params = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUrl,
    response_mode: "query",
    scope: "openid profile email User.Read",
    state,
    prompt: "select_account",
  });
  const authUrl = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/authorize?${params.toString()}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = authUrl;
    return;
  }
  await Linking.openURL(authUrl);
}

export async function exchangeMicrosoftCode(
  code: string,
  role: "rider" | "driver",
  redirectUri: string,
) {
  const res = await api.post("/auth/microsoft/login", {
    code,
    redirect_uri: redirectUri,
    role,
  });
  await tokenStorage.setItem(TOKEN_KEY, res.data.access_token);
  return res.data.user as { id: string; email: string; name: string; role: "rider" | "driver" };
}

/** Called by the AuthCallback route after Emergent Auth returns. */
export async function exchangeGoogleSession(sessionId: string, role: "rider" | "driver") {
  const res = await api.post("/auth/google/session", { session_id: sessionId, role });
  await tokenStorage.setItem(TOKEN_KEY, res.data.access_token);
  return res.data.user as { id: string; email: string; name: string; role: "rider" | "driver" };
}
