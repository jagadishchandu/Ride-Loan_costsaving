import { useEffect, useRef, useState } from "react";
import { View, Text, ActivityIndicator, StyleSheet, TouchableOpacity } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useAuth } from "../../src/auth";
import { exchangeMicrosoftCode, getMicrosoftRedirectUrl } from "../../src/socialAuth";
import { colors, spacing, radius } from "../../src/theme";

/**
 * Handles redirect from Microsoft Identity Platform.
 * URL shape: /auth/microsoft-callback?code=...&state=...&role=...
 * (or ?error=... on failure)
 */
export default function MicrosoftAuthCallback() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    role?: string;
    code?: string;
    state?: string;
    error?: string;
    error_description?: string;
  }>();
  const { refreshUser } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const processed = useRef(false);

  useEffect(() => {
    if (processed.current) return;
    processed.current = true;

    if (params.error) {
      setError(params.error_description || params.error);
      return;
    }
    if (!params.code) {
      setError("Missing authorization code from Microsoft.");
      return;
    }
    const wantedRole = params.role === "driver" ? "driver" : "rider";

    // Validate state (CSRF) — best effort on web only
    if (typeof window !== "undefined") {
      try {
        const expected = window.sessionStorage?.getItem("ms_oauth_state");
        if (expected && params.state && expected !== params.state) {
          setError("State mismatch — possible CSRF.");
          return;
        }
        window.sessionStorage?.removeItem("ms_oauth_state");
      } catch {
        // ignore
      }
    }

    const redirectUri = getMicrosoftRedirectUrl(wantedRole);

    (async () => {
      try {
        const user = await exchangeMicrosoftCode(params.code!, wantedRole, redirectUri);
        await refreshUser();
        if (typeof window !== "undefined") {
          history.replaceState({}, "", window.location.pathname);
        }
        router.replace(user.role === "driver" ? "/driver/home" : "/rider/home");
      } catch (e: any) {
        setError(e?.response?.data?.detail || e?.message || "Microsoft login failed");
      }
    })();
  }, [params, refreshUser, router]);

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
          <Text style={styles.title}>Signing you in with Microsoft…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
    gap: spacing.md,
  },
  title: { fontSize: 22, fontWeight: "800", color: colors.obsidian, marginTop: spacing.md, textAlign: "center" },
  sub: { color: colors.textSecondary, textAlign: "center" },
  btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 14,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  btnText: { color: "#fff", fontWeight: "700" },
});
