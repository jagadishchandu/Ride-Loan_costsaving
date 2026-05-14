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
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/auth";
import { formatApiError } from "../src/api";
import { colors, spacing, radius } from "../src/theme";
import SocialButtons from "../src/SocialButtons";
import CountryPicker, { getDefaultCountry } from "../src/CountryPicker";
import type { Country } from "../src/countries";

export default function Register() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole = params.role === "driver" ? "driver" : "rider";

  const { register } = useAuth();
  const [role, setRole] = useState<"rider" | "driver">(initialRole as any);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<Country>(getDefaultCountry());
  const [vehicle, setVehicle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name || !email || password.length < 6) {
      setError("Please fill all fields. Password must be at least 6 chars.");
      return;
    }
    setLoading(true);
    try {
      // Build full phone with country code
      const fullPhone = phone.trim() ? `${selectedCountry.dialCode} ${phone.trim()}` : undefined;
      
      const u = await register({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
        phone: fullPhone,
        country_code: selectedCountry.code,  // Store country for currency routing
        currency: selectedCountry.currency,   // Store user's preferred currency
        vehicle: role === "driver" ? vehicle.trim() || undefined : undefined,
      });
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

          <Text style={styles.heading}>Create account</Text>
          <Text style={styles.sub}>Join Ride in less than a minute.</Text>

          <View style={styles.roleRow}>
            <TouchableOpacity
              testID="role-rider"
              style={[styles.roleChip, role === "rider" && styles.roleChipActive]}
              onPress={() => setRole("rider")}
              activeOpacity={0.85}
            >
              <Ionicons
                name="person-outline"
                size={18}
                color={role === "rider" ? "#fff" : colors.obsidian}
              />
              <Text style={[styles.roleText, role === "rider" && { color: "#fff" }]}>Rider</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="role-driver"
              style={[styles.roleChip, role === "driver" && styles.roleChipActive]}
              onPress={() => setRole("driver")}
              activeOpacity={0.85}
            >
              <Ionicons
                name="car-outline"
                size={18}
                color={role === "driver" ? "#fff" : colors.obsidian}
              />
              <Text style={[styles.roleText, role === "driver" && { color: "#fff" }]}>Driver</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>FULL NAME</Text>
            <TextInput
              testID="register-name"
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="Jane Doe"
              placeholderTextColor="#9CA3AF"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>EMAIL</Text>
            <TextInput
              testID="register-email"
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor="#9CA3AF"
              autoCapitalize="none"
              keyboardType="email-address"
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PASSWORD</Text>
            <TextInput
              testID="register-password"
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="At least 6 characters"
              placeholderTextColor="#9CA3AF"
              secureTextEntry
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>PHONE (optional)</Text>
            <View style={styles.phoneRow}>
              <CountryPicker
                selectedCountry={selectedCountry}
                onSelect={setSelectedCountry}
              />
              <TextInput
                testID="register-phone"
                style={styles.phoneInput}
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone number"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {role === "driver" && (
            <View style={styles.field}>
              <Text style={styles.label}>VEHICLE</Text>
              <TextInput
                testID="register-vehicle"
                style={styles.input}
                value={vehicle}
                onChangeText={setVehicle}
                placeholder="e.g. Toyota Corolla 2020 - ABC-123"
                placeholderTextColor="#9CA3AF"
              />
            </View>
          )}

          {error ? (
            <Text testID="register-error" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <TouchableOpacity
            testID="register-submit"
            style={[styles.btn, loading && { opacity: 0.7 }]}
            disabled={loading}
            onPress={handleSubmit}
            activeOpacity={0.85}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Create account</Text>
            )}
          </TouchableOpacity>

          <SocialButtons role={role} />

          <TouchableOpacity testID="goto-login" onPress={() => router.replace("/login")} style={{ marginTop: spacing.lg, alignItems: "center" }}>
            <Text style={{ color: colors.textSecondary }}>
              Already a member? <Text style={{ color: colors.primary, fontWeight: "700" }}>Log in</Text>
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
  sub: { color: colors.textSecondary, marginTop: 6, marginBottom: spacing.lg, fontSize: 16 },
  roleRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  roleChip: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  roleChipActive: { backgroundColor: colors.obsidian, borderColor: colors.obsidian },
  roleText: { color: colors.obsidian, fontWeight: "700", fontSize: 15 },
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
  phoneRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  phoneInput: {
    flex: 1,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    fontSize: 16,
    color: colors.obsidian,
  },
  error: { color: colors.danger, marginTop: spacing.xs, fontWeight: "600" },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    marginTop: spacing.md,
  },
  btnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
