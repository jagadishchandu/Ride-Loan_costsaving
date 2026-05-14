import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/auth";
import { formatApiError } from "../src/api";
import { colors, spacing, radius } from "../src/theme";
import SocialButtons from "../src/SocialButtons";

export default function Login() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async () => {
    setError(null);
    setLoading(true);
    try {
      const u = await login(email.trim(), password);
      if (u.role === "rider") router.replace("/rider/home");
      else router.replace("/driver/home");
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.obsidian} />
          </TouchableOpacity>

          <Text style={styles.heading}>Welcome back</Text>
          <Text style={styles.sub}>Log in to continue your journey.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              testID="login-email"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              testID="login-password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#9CA3AF"
              secureTextEntry
            />
          </View>

          {error ? (
            <Text testID="login-error" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            testID="login-submit"
            style={[styles.btn, loading && { opacity: 0.7 }]}
            disabled={loading}
            onPress={handleLogin}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Log in</Text>
            )}
          </TouchableOpacity>

          <SocialButtons role="rider" />

          <TouchableOpacity testID="goto-register" onPress={() => router.replace("/register")} style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <Text style={{ color: colors.textSecondary }}>
              Don&apos;t have an account? <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  scroll: { padding: spacing.lg, flexGrow: 1 },
  backBtn: { width: 40, height: 40, justifyContent: "center", marginBottom: spacing.md },
  heading: { fontSize: 32, fontWeight: "800", color: colors.obsidian, letterSpacing: -1 },
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: spacing.xl, fontSize: 16 },
  field: { marginBottom: spacing.md },
  label: { fontSize: 11, letterSpacing: 1.2, color: colors.textSecondary, marginBottom: 6, fontWeight: "700" },
  input: {
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.obsidian,
  },
  error: { color: colors.danger, marginTop: spacing.xs, marginBottom: spacing.sm, fontWeight: "600" },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    marginTop: spacing.md,
  },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
