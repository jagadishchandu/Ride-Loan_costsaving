import { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../src/api";
import { colors, spacing, radius } from "../src/theme";

/**
 * Both subscription (always PayPal) and ride payments (PayPal or Mercado
 * Pago) redirect back to this page. We rely on:
 *   - `session_id` (always present) to look up status
 *   - `provider`   (only set when redirected by a ride payment — defaults
 *                   to "paypal" so old subscription URLs still work)
 *
 * Then we pick the right capture endpoint, and pull `purpose` from the
 * status response to tailor the success message ("subscription active"
 * vs "driver has been paid").
 */
type Purpose = "driver_subscription" | "ride_payment" | "unknown";

export default function PaymentSuccess() {
  const router = useRouter();
  const { session_id, provider } = useLocalSearchParams<{
    session_id?: string;
    provider?: string;
  }>();
  const [status, setStatus] = useState<"checking" | "paid" | "failed" | "expired">("checking");
  const [purpose, setPurpose] = useState<Purpose>("unknown");

  useEffect(() => {
    if (!session_id) {
      setStatus("failed");
      return;
    }
    let attempts = 0;
    let cancelled = false;

    // Pick the capture endpoint based on the provider that brought us here.
    // Both are idempotent and return 400 if called for the wrong provider —
    // which is fine, we just swallow it and rely on polling.
    const captureEndpoint =
      provider === "mercadopago"
        ? `/mercadopago/capture/${session_id}`
        : `/paypal/capture/${session_id}`;

    const run = async () => {
      // Step 1: Trigger capture/verification (idempotent on both providers).
      try {
        await api.post(captureEndpoint);
      } catch {
        // Webhook will retry; we still poll below.
      }
      // Step 2: Poll backend for activation
      while (!cancelled && attempts < 12) {
        try {
          const res = await api.get(`/payments/checkout/status/${session_id}`);
          if (res.data.purpose) setPurpose(res.data.purpose);
          if (res.data.payment_status === "paid") {
            setStatus("paid");
            return;
          }
          if (res.data.status === "expired") {
            setStatus("expired");
            return;
          }
          // Mercado Pago payments are processed asynchronously — re-poke the
          // capture endpoint once partway through in case the first call hit
          // before MP had recorded the payment.
          if (attempts === 3 && provider === "mercadopago") {
            try {
              await api.post(captureEndpoint);
            } catch {
              /* ignore */
            }
          }
        } catch {
          // ignore
        }
        attempts += 1;
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) setStatus("failed");
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [session_id, provider]);

  const isRide = purpose === "ride_payment";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.box}>
        {status === "checking" && (
          <>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.title}>Confirming payment…</Text>
            <Text style={styles.sub}>
              {isRide
                ? "Hang tight — we're confirming the payment to your driver."
                : "Please wait while we activate your subscription."}
            </Text>
          </>
        )}
        {status === "paid" && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.success }]}>
              <Ionicons name="checkmark" size={40} color="#fff" />
            </View>
            <Text testID="payment-success" style={styles.title}>
              {isRide ? "Payment sent!" : "You're live!"}
            </Text>
            <Text style={styles.sub}>
              {isRide
                ? "Your driver has been paid directly. Thanks for riding with us!"
                : "Your subscription is active for the next 24 hours."}
            </Text>
            <TouchableOpacity
              testID="back-to-driver"
              style={styles.btn}
              onPress={() => router.replace(isRide ? "/rider/history" : "/driver/home")}
            >
              <Text style={styles.btnText}>
                {isRide ? "View trips" : "Start driving"}
              </Text>
            </TouchableOpacity>
          </>
        )}
        {(status === "failed" || status === "expired") && (
          <>
            <View style={[styles.iconCircle, { backgroundColor: colors.danger }]}>
              <Ionicons name="close" size={40} color="#fff" />
            </View>
            <Text style={styles.title}>Payment not completed</Text>
            <Text style={styles.sub}>
              {isRide
                ? "We couldn't confirm the payment. You can try again from your trip history."
                : "Please try subscribing again from your dashboard."}
            </Text>
            <TouchableOpacity
              testID="back-to-driver"
              style={styles.btn}
              onPress={() => router.replace(isRide ? "/rider/history" : "/driver/home")}
            >
              <Text style={styles.btnText}>
                {isRide ? "Back to trips" : "Back to dashboard"}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, justifyContent: "center", padding: spacing.lg },
  box: { alignItems: "center", gap: spacing.md, padding: spacing.xl },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { fontSize: 28, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5, textAlign: "center" },
  sub: { color: colors.textSecondary, textAlign: "center", fontSize: 15, lineHeight: 22 },
  btn: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xl,
    paddingVertical: 16,
    borderRadius: radius.sm,
    marginTop: spacing.md,
  },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
