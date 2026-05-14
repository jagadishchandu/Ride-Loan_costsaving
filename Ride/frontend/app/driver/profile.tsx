import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth";
import { colors, spacing, radius } from "../../src/theme";

export default function DriverProfile() {
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  // The driver's `has_mp_token`/`paypal_email` come from /auth/me; if either
  // is missing the rider's "Pay" button will hide that provider, so surface
  // the configuration state here so the driver knows to fix it.
  const paypalConnected = !!user?.paypal_email;
  const mpConnected = !!(user as any)?.has_mp_token;
  const allMissing = !paypalConnected && !mpConnected;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Profile</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.[0]?.toUpperCase() || "D"}</Text>
        </View>
        <Text testID="profile-name" style={styles.name}>{user?.name}</Text>
        <Text style={styles.email}>{user?.email}</Text>
        <View style={styles.roleBadge}>
          <Ionicons name="car" size={14} color="#fff" />
          <Text style={styles.roleText}>DRIVER</Text>
        </View>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="call-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.infoLabel}>Phone</Text>
        <Text style={styles.infoValue}>{user?.phone || "Not set"}</Text>
      </View>

      <View style={styles.infoRow}>
        <Ionicons name="car-sport-outline" size={20} color={colors.textSecondary} />
        <Text style={styles.infoLabel}>Vehicle</Text>
        <Text style={styles.infoValue}>{user?.vehicle || "Not set"}</Text>
      </View>

      {/* Payout accounts — drives where customer payments land */}
      <TouchableOpacity
        testID="payouts-link"
        style={[styles.infoRow, allMissing && styles.infoRowWarn]}
        onPress={() => router.push("/driver/payouts")}
        activeOpacity={0.7}
      >
        <Ionicons
          name="wallet-outline"
          size={20}
          color={allMissing ? colors.danger : colors.textSecondary}
        />
        <Text style={[styles.infoLabel, allMissing && { color: colors.danger }]}>
          Payout accounts
        </Text>
        <View style={styles.payoutPills}>
          <View style={[styles.miniPill, paypalConnected ? styles.miniPillOn : styles.miniPillOff]}>
            <Ionicons
              name="logo-paypal"
              size={11}
              color={paypalConnected ? "#fff" : colors.textSecondary}
            />
            <Text style={[styles.miniPillText, paypalConnected && { color: "#fff" }]}>
              PayPal
            </Text>
          </View>
          <View style={[styles.miniPill, mpConnected ? styles.miniPillOn : styles.miniPillOff]}>
            <Ionicons
              name="cash-outline"
              size={11}
              color={mpConnected ? "#fff" : colors.textSecondary}
            />
            <Text style={[styles.miniPillText, mpConnected && { color: "#fff" }]}>MP</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      {allMissing && (
        <Text style={styles.warnText}>
          Set at least one payout account so customers can pay you.
        </Text>
      )}

      <TouchableOpacity
        testID="logout-btn"
        onPress={handleLogout}
        style={styles.logoutBtn}
        activeOpacity={0.85}
      >
        <Ionicons name="log-out-outline" size={20} color={colors.danger} />
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  header: { marginBottom: spacing.lg },
  title: { fontSize: 28, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: "center",
    marginBottom: spacing.md,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  avatarText: { color: "#fff", fontSize: 32, fontWeight: "800" },
  name: { fontSize: 22, fontWeight: "800", color: colors.obsidian },
  email: { color: colors.textSecondary, marginTop: 4 },
  roleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.obsidian,
    marginTop: spacing.md,
  },
  roleText: { color: "#fff", fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  infoLabel: { color: colors.textSecondary, flex: 1 },
  infoValue: { color: colors.obsidian, fontWeight: "600" },
  infoRowWarn: {
    borderWidth: 1,
    borderColor: colors.danger,
  },
  payoutPills: { flexDirection: "row", gap: 6 },
  miniPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  miniPillOn: { backgroundColor: colors.success },
  miniPillOff: { backgroundColor: "#EAEAEA" },
  miniPillText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
  warnText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "600",
    marginTop: -spacing.xs,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.danger,
    marginTop: spacing.md,
  },
  logoutText: { color: colors.danger, fontWeight: "700", fontSize: 16 },
});
