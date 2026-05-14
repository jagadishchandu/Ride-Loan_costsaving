import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../src/auth";
import { exchangeGoogleSession } from "../../src/socialAuth";
import { colors, spacing, radius } from "../../src/theme";

/**
 * REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
 *
 * Handles the redirect from https://auth.emergentagent.com which delivers
 * the session_id in the URL fragment: /auth/callback#session_id=...
 *
 * Synchronously detects the fragment, exchanges it for our JWT, then routes
 * the user into the app.
 */
export default function AuthCallback() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    let sessionId: string | null = null;
    if (typeof window !== "undefined") {
      const hash = window.location.hash || "";
      const match = hash.match(/session_id=([^&]+)/);
      if (match) sessionId = decodeURIComponent(match[1]);
    }
    if (!sessionId) {
      setError("Missing session_id from auth provider.");
      return;
    }
    const wantedRole = role === "driver" ? "driver" : "rider";
    (async () => {
      try {
        const user = await exchangeGoogleSession(sessionId!, wantedRole);
        await refreshUser();
        if (typeof window !== "undefined") {
          // remove session_id fragment so it isn't reused
          history.replaceState({}, "", window.location.pathname);
        }
        router.replace(user.role === "driver" ? "/driver/home" : "/rider/home");
      } catch (e: any) {
        setError(e?.response?.data?.detail || e?.message || "Login failed");
      }
    })();
  }, [refreshUser, role, router]);

  return (
    <View style={styles.box}>
      {error ? (
        <>
          <Text style={styles.title}>Sign-in failed</Text>
          <Text style={styles.sub}>{error}</Text>
          <TouchableOpacity style={styles.btn} onPress={() => router.replace("/login")}>
            <Text style={styles.btnText}>Back to login</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.title}>Signing you in…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", alignItems: "center", padding: spacing.lg, gap: spacing.md },
  title: { fontSize: 22, fontWeight: "800", color: colors.obsidian, marginTop: spacing.md },
  sub: { color: colors.textSecondary, textAlign: "center" },
  btn: { backgroundColor: colors.primary, paddingHorizontal: spacing.xl, paddingVertical: 14, borderRadius: radius.sm, marginTop: spacing.md },
  btnText: { color: "#fff", fontWeight: "700" },
});
