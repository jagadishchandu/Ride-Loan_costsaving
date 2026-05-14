import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Linking,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api, errorMessage } from "../../src/api";
import { colors, spacing, radius } from "../../src/theme";

type PayoutAccounts = {
  paypal_email: string | null;
  has_mp_token: boolean;
  mp_token_kind: "sandbox" | "live" | null;
  mp_token_hint: string | null;
  phonepe_merchant_id: string | null;
  has_phonepe_salt: boolean;
  phonepe_salt_hint: string | null;
  phonepe_salt_index: string | null;
  accepts_cash: boolean;
};

/**
 * Driver "Payout Accounts" screen.
 *
 * Drivers configure where each payment method's money should land. Money
 * flows direct-to-driver — the platform never holds the funds.
 *
 *   • PayPal: receiving PayPal email. Also enables Google Pay & Apple Pay
 *             (PayPal's checkout natively offers them as funding sources).
 *   • Mercado Pago: driver's own Access Token (TEST-* for sandbox).
 *   • PhonePe (India): merchant_id + salt_key + salt_index from PhonePe Business.
 *   • Cash: a simple on/off toggle. Driver must confirm receipt afterwards.
 *
 * Secrets (mp_access_token, phonepe_salt_key) are write-only — server returns
 * only a "…lastN" hint, never the full value.
 */
export default function DriverPayouts() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"paypal" | "mp" | "phonepe" | "cash" | null>(null);
  const [acc, setAcc] = useState<PayoutAccounts | null>(null);

  // Local form state
  const [paypalEmail, setPaypalEmail] = useState("");
  const [mpToken, setMpToken] = useState("");
  const [ppMid, setPpMid] = useState("");
  const [ppSalt, setPpSalt] = useState("");
  const [ppIdx, setPpIdx] = useState("1");
  const [cashOn, setCashOn] = useState(false);

  const load = async () => {
    try {
      const r = await api.get<PayoutAccounts>("/driver/payout-accounts");
      setAcc(r.data);
      setPaypalEmail(r.data.paypal_email || "");
      setMpToken(""); // never prefill the token field — we only have the hint
      setPpMid(r.data.phonepe_merchant_id || "");
      setPpSalt(""); // never prefill the salt — write-only
      setPpIdx(r.data.phonepe_salt_index || "1");
      setCashOn(r.data.accepts_cash);
    } catch (e) {
      Alert.alert("Could not load payout accounts", errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const savePaypal = async () => {
    setSaving("paypal");
    try {
      const r = await api.patch<PayoutAccounts>("/driver/payout-accounts", {
        paypal_email: paypalEmail.trim(),
      });
      setAcc(r.data);
      setPaypalEmail(r.data.paypal_email || "");
      Alert.alert(
        "Saved",
        paypalEmail.trim()
          ? "PayPal connected. Customers can now pay you via PayPal, Google Pay, or Apple Pay — all routed to this account."
          : "PayPal account cleared. PayPal / Google Pay / Apple Pay are now unavailable.",
      );
    } catch (e) {
      Alert.alert("Could not save", errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const saveMp = async () => {
    setSaving("mp");
    try {
      const r = await api.patch<PayoutAccounts>("/driver/payout-accounts", {
        mp_access_token: mpToken.trim(),
      });
      setAcc(r.data);
      setMpToken("");
      Alert.alert(
        "Saved",
        mpToken.trim()
          ? `Mercado Pago account verified (${r.data.mp_token_kind === "sandbox" ? "sandbox" : "live"}).`
          : "Mercado Pago account cleared.",
      );
    } catch (e) {
      Alert.alert("Could not save", errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const savePhonepe = async () => {
    setSaving("phonepe");
    try {
      const body: any = {
        phonepe_merchant_id: ppMid.trim(),
        phonepe_salt_index: ppIdx.trim() || "1",
      };
      // Only send salt_key if the driver typed something — empty string clears.
      if (ppSalt.length > 0) body.phonepe_salt_key = ppSalt.trim();
      const r = await api.patch<PayoutAccounts>("/driver/payout-accounts", body);
      setAcc(r.data);
      setPpSalt("");
      Alert.alert(
        "Saved",
        r.data.phonepe_merchant_id && r.data.has_phonepe_salt
          ? "PhonePe connected. Note: PhonePe processes payments in INR — fares are sent as the same numeric value in rupees."
          : "PhonePe account cleared.",
      );
    } catch (e) {
      Alert.alert("Could not save", errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  const toggleCash = async (next: boolean) => {
    setSaving("cash");
    setCashOn(next); // optimistic
    try {
      const r = await api.patch<PayoutAccounts>("/driver/payout-accounts", {
        accepts_cash: next,
      });
      setAcc(r.data);
      setCashOn(r.data.accepts_cash);
    } catch (e) {
      setCashOn(!next); // revert
      Alert.alert("Could not save", errorMessage(e));
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 80 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.obsidian} />
        </TouchableOpacity>
        <Text style={styles.title}>Payout Accounts</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={20} color={colors.primary} />
            <Text style={styles.bannerText}>
              Customer payments go directly to your accounts below. Ride keeps 0%
              commission. Enable as many methods as you like.
            </Text>
          </View>

          {/* PayPal card (also covers Google Pay + Apple Pay) */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={styles.providerBadge}>
                <Ionicons name="logo-paypal" size={18} color="#003087" />
                <Text style={styles.providerName}>PayPal · GPay · Apple Pay</Text>
              </View>
              {acc?.paypal_email ? (
                <View style={styles.statusOk}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.statusOkText}>Connected</Text>
                </View>
              ) : (
                <View style={styles.statusOff}>
                  <Text style={styles.statusOffText}>Not connected</Text>
                </View>
              )}
            </View>

            <Text style={styles.label}>Receiving email</Text>
            <TextInput
              style={styles.input}
              value={paypalEmail}
              onChangeText={setPaypalEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Text style={styles.help}>
              All three methods route through PayPal&apos;s checkout — Google Pay
              appears on Chrome, Apple Pay on Safari/iOS. Money lands here.
            </Text>

            <TouchableOpacity
              style={[styles.saveBtn, saving === "paypal" && styles.saveBtnDisabled]}
              onPress={savePaypal}
              disabled={saving !== null}
              activeOpacity={0.85}
            >
              {saving === "paypal" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {paypalEmail.trim() ? "Save PayPal email" : "Clear PayPal account"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Mercado Pago card */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.providerBadge, { backgroundColor: "#FFF4D6" }]}>
                <Ionicons name="cash" size={18} color="#009EE3" />
                <Text style={[styles.providerName, { color: "#0A0A0A" }]}>
                  Mercado Pago
                </Text>
              </View>
              {acc?.has_mp_token ? (
                <View style={styles.statusOk}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.statusOkText}>
                    {acc.mp_token_kind === "sandbox" ? "Sandbox" : "Live"} ·{" "}
                    {acc.mp_token_hint}
                  </Text>
                </View>
              ) : (
                <View style={styles.statusOff}>
                  <Text style={styles.statusOffText}>Not connected</Text>
                </View>
              )}
            </View>

            <Text style={styles.label}>Access Token</Text>
            <TextInput
              style={[styles.input, styles.mono]}
              value={mpToken}
              onChangeText={setMpToken}
              placeholder={
                acc?.has_mp_token
                  ? "Paste a new token to replace, or leave blank to keep current"
                  : "APP_USR-… (live) or TEST-… (sandbox)"
              }
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              onPress={() =>
                Linking.openURL("https://www.mercadopago.com.mx/developers/panel/app")
              }
            >
              <Text style={styles.link}>Where do I find my Access Token? →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, saving === "mp" && styles.saveBtnDisabled]}
              onPress={saveMp}
              disabled={saving !== null}
              activeOpacity={0.85}
            >
              {saving === "mp" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>
                  {mpToken.trim() ? "Save Mercado Pago token" : "Clear Mercado Pago account"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* PhonePe card */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.providerBadge, { backgroundColor: "#EFE7F7" }]}>
                <Ionicons name="phone-portrait" size={18} color="#5F259F" />
                <Text style={[styles.providerName, { color: "#5F259F" }]}>
                  PhonePe (India)
                </Text>
              </View>
              {acc?.phonepe_merchant_id && acc?.has_phonepe_salt ? (
                <View style={styles.statusOk}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.statusOkText}>Connected</Text>
                </View>
              ) : (
                <View style={styles.statusOff}>
                  <Text style={styles.statusOffText}>Not connected</Text>
                </View>
              )}
            </View>

            <Text style={styles.help}>
              <Text style={{ fontWeight: "700" }}>Note:</Text> PhonePe operates in
              INR. The fare value is sent as the same numeric amount in rupees —
              use only if your riders pay in INR.
            </Text>

            <Text style={[styles.label, { marginTop: spacing.md }]}>Merchant ID</Text>
            <TextInput
              style={[styles.input, styles.mono]}
              value={ppMid}
              onChangeText={setPpMid}
              placeholder="e.g. M2306YOURMERCHANT"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Text style={[styles.label, { marginTop: spacing.sm }]}>Salt Key</Text>
            <TextInput
              style={[styles.input, styles.mono]}
              value={ppSalt}
              onChangeText={setPpSalt}
              placeholder={
                acc?.has_phonepe_salt
                  ? `Paste new salt key to replace (current ends ${acc.phonepe_salt_hint || "…"})`
                  : "Salt key from PhonePe Business credentials"
              }
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />

            <Text style={[styles.label, { marginTop: spacing.sm }]}>Salt Index</Text>
            <TextInput
              style={[styles.input, styles.mono, { maxWidth: 120 }]}
              value={ppIdx}
              onChangeText={setPpIdx}
              placeholder="1"
              placeholderTextColor={colors.textSecondary}
              keyboardType="number-pad"
              maxLength={2}
            />

            <TouchableOpacity
              onPress={() => Linking.openURL("https://business.phonepe.com/")}
            >
              <Text style={styles.link}>Find these in PhonePe Business → Developer Tools →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, saving === "phonepe" && styles.saveBtnDisabled]}
              onPress={savePhonepe}
              disabled={saving !== null}
              activeOpacity={0.85}
            >
              {saving === "phonepe" ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>Save PhonePe credentials</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Cash toggle */}
          <View style={styles.card}>
            <View style={[styles.cardHead, { marginBottom: 0 }]}>
              <View style={[styles.providerBadge, { backgroundColor: "#E8F8EE" }]}>
                <Ionicons name="wallet" size={18} color={colors.success} />
                <Text style={[styles.providerName, { color: colors.success }]}>Cash</Text>
              </View>
              <Switch
                value={cashOn}
                onValueChange={toggleCash}
                disabled={saving !== null}
                trackColor={{ true: colors.success, false: "#D6D6D6" }}
                thumbColor="#fff"
              />
            </View>
            <Text style={[styles.help, { marginTop: spacing.sm }]}>
              When on, riders can choose &quot;Pay with cash&quot;. The ride stays
              unpaid until you tap <Text style={{ fontWeight: "700" }}>Confirm cash received</Text> in
              your earnings screen.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { fontSize: 20, fontWeight: "800", color: colors.obsidian },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: "#EEF2FF",
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  bannerText: { flex: 1, color: colors.obsidian, fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  providerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: "#E6F0FF",
    flexShrink: 1,
  },
  providerName: { fontWeight: "700", color: "#003087", fontSize: 13 },

  statusOk: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E8F8EE",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusOkText: { color: colors.success, fontSize: 12, fontWeight: "700" },
  statusOff: {
    backgroundColor: "#FEE",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  statusOffText: { color: colors.danger, fontSize: 12, fontWeight: "700" },

  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: 15,
    color: colors.obsidian,
    backgroundColor: "#FAFAFA",
    minHeight: 48,
  },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  help: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  link: { color: colors.primary, fontSize: 13, fontWeight: "700", marginTop: spacing.sm },

  saveBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.obsidian,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: "#fff", fontWeight: "800", fontSize: 15 },
});
