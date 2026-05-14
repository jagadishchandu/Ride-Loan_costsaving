import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { api, formatApiError } from "../../src/api";
import { colors, spacing, radius } from "../../src/theme";
import RatingModal from "../../src/RatingModal";
import { getAppOrigin } from "../../src/origin";

type Ride = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  status: string;
  paid?: boolean;
  rider_rating?: number | null;
  driver_name?: string | null;
  cash_pending_at?: string | null;
  created_at: string;
};

type Provider =
  | "paypal"
  | "googlepay"
  | "applepay"
  | "mercadopago"
  | "phonepe"
  | "cash";

type ProviderOption = { id: Provider; label: string; via: string };

// Visual config for each method in the provider sheet. Order here = display order.
const PROVIDER_STYLE: Record<Provider, { bg: string; icon: keyof typeof Ionicons.glyphMap; iconColor: string }> = {
  paypal: { bg: "#003087", icon: "logo-paypal", iconColor: "#fff" },
  googlepay: { bg: "#FFFFFF", icon: "logo-google", iconColor: "#4285F4" },
  applepay: { bg: "#000000", icon: "logo-apple", iconColor: "#fff" },
  mercadopago: { bg: "#009EE3", icon: "cash", iconColor: "#fff" },
  phonepe: { bg: "#5F259F", icon: "phone-portrait", iconColor: "#fff" },
  cash: { bg: "#1E8E3E", icon: "wallet", iconColor: "#fff" },
};

const STATUS_COLOR: Record<string, string> = {
  requested: colors.warning,
  accepted: colors.primary,
  completed: colors.success,
  cancelled: colors.danger,
};

export default function RiderHistory() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [ratingFor, setRatingFor] = useState<Ride | null>(null);
  // Provider sheet: ride being paid + the list of providers the driver accepts
  // (fetched live so we never offer one the driver hasn't configured).
  const [providerSheetFor, setProviderSheetFor] = useState<Ride | null>(null);
  const [providerOptions, setProviderOptions] = useState<ProviderOption[] | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(false);

  const openProviderSheet = async (ride: Ride) => {
    setProviderSheetFor(ride);
    setProviderOptions(null);
    setOptionsLoading(true);
    try {
      const r = await api.get<{ providers: ProviderOption[] }>(
        `/rides/${ride.id}/payment-options`,
      );
      setProviderOptions(r.data.providers || []);
    } catch (e) {
      // Fall back to showing all — the backend will 409 anything the driver
      // hasn't connected.
      setProviderOptions([
        { id: "paypal", label: "PayPal", via: "paypal" },
        { id: "mercadopago", label: "Mercado Pago", via: "mercadopago" },
      ]);
    } finally {
      setOptionsLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await api.get<Ride[]>("/rides/my");
      setRides(res.data);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [load]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handlePay = async (ride: Ride, provider: Provider) => {
    setProviderSheetFor(null);
    setPaying(ride.id);
    try {
      const origin = getAppOrigin();
      const res = await api.post(`/rides/${ride.id}/pay`, {
        origin_url: origin,
        provider,
      });

      // Cash: no checkout URL — just inform the rider and refresh.
      if (provider === "cash" || res.data.requires_driver_confirmation) {
        Alert.alert(
          "Hand the cash to your driver",
          res.data.message ||
            "The driver will confirm they received the cash from their app. The trip will be marked paid once confirmed.",
        );
        await load();
        return;
      }

      const url = res.data.url as string;
      const sessionId = res.data.session_id as string;
      // For googlepay/applepay the txn provider is googlepay/applepay; but the
      // hosted checkout is PayPal, so the capture endpoint is PayPal's.
      const via = (res.data.via as string) || provider;
      const captureEndpoint =
        via === "mercadopago"
          ? `/mercadopago/capture/${sessionId}`
          : via === "phonepe"
          ? `/phonepe/capture/${sessionId}`
          : `/paypal/capture/${sessionId}`; // paypal | googlepay | applepay

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = url;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(
          url,
          `${origin}/payment-success`,
        );
        if (result.type === "success" && result.url) {
          try {
            await api.post(captureEndpoint);
          } catch {
            // not fatal — webhook will eventually activate the txn
          }
          for (let i = 0; i < 8; i++) {
            try {
              const s = await api.get(`/payments/checkout/status/${sessionId}`);
              if (s.data.payment_status === "paid") {
                await load();
                return;
              }
            } catch {
              // ignore
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
        await load();
      }
    } catch (e: any) {
      Alert.alert("Payment error", formatApiError(e));
    } finally {
      setPaying(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Your trips</Text>
        <Text style={styles.sub}>{rides.length} {rides.length === 1 ? "trip" : "trips"} so far</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          testID="rider-history-list"
          data={rides}
          keyExtractor={(it) => it.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="navigate-outline" size={48} color={colors.textSecondary} />
              <Text style={styles.emptyText}>No trips yet — request your first ride!</Text>
            </View>
          }
          renderItem={({ item }) => {
            const canPay = item.status === "completed" && !item.paid;
            const canRate = item.status === "completed" && item.paid && !item.rider_rating;
            return (
              <View testID={`ride-${item.id}`} style={styles.card}>
                <View style={styles.rowTop}>
                  <Text style={styles.date}>{new Date(item.created_at).toLocaleString()}</Text>
                  <View style={[styles.badge, { backgroundColor: STATUS_COLOR[item.status] || colors.textSecondary }]}>
                    <Text style={styles.badgeText}>{item.status}</Text>
                  </View>
                </View>
                <Text style={styles.address} numberOfLines={1}>● {item.pickup_address}</Text>
                <Text style={styles.address} numberOfLines={1}>◆ {item.dropoff_address}</Text>
                <View style={styles.rowBottom}>
                  <Text style={styles.driver}>
                    {item.driver_name ? `Driver: ${item.driver_name}` : "—"}
                  </Text>
                  <Text style={styles.fare}>${item.estimated_fare.toFixed(2)} MXN</Text>
                </View>

                {item.paid && (
                  <View style={styles.paidPill}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text style={styles.paidText}>Paid · sent to driver</Text>
                  </View>
                )}
                {item.rider_rating ? (
                  <View style={styles.starsRow}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Ionicons
                        key={n}
                        name={n <= (item.rider_rating || 0) ? "star" : "star-outline"}
                        size={14}
                        color={n <= (item.rider_rating || 0) ? colors.warning : colors.textSecondary}
                      />
                    ))}
                    <Text style={styles.ratedText}>You rated {item.rider_rating}/5</Text>
                  </View>
                ) : null}

                {(canPay || canRate) && (
                  <View style={styles.actionRow}>
                    {canPay && (
                      <TouchableOpacity
                        testID={`pay-ride-${item.id}`}
                        style={[styles.actionBtn, { backgroundColor: colors.primary }]}
                        onPress={() => openProviderSheet(item)}
                        activeOpacity={0.85}
                        disabled={paying === item.id}
                      >
                        {paying === item.id ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <>
                            <Ionicons name="card" size={16} color="#fff" />
                            <Text style={styles.actionText}>
                              {item.cash_pending_at ? "Awaiting driver…" : "Pay driver"}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    )}
                    {canRate && (
                      <TouchableOpacity
                        testID={`rate-ride-${item.id}`}
                        style={[styles.actionBtn, { backgroundColor: colors.obsidian }]}
                        onPress={() => setRatingFor(item)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="star" size={16} color="#fff" />
                        <Text style={styles.actionText}>Rate driver</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <RatingModal
        visible={!!ratingFor}
        rideId={ratingFor?.id || null}
        counterpartyName={ratingFor?.driver_name || "your driver"}
        onClose={() => setRatingFor(null)}
        onSubmitted={load}
      />

      {/* Payment provider picker — appears when rider taps "Pay driver". */}
      <Modal
        visible={!!providerSheetFor}
        transparent
        animationType="fade"
        onRequestClose={() => setProviderSheetFor(null)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.sheetBackdrop}
          onPress={() => setProviderSheetFor(null)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>How do you want to pay?</Text>
            <Text style={styles.sheetSub}>
              ${providerSheetFor?.estimated_fare.toFixed(2)} MXN · goes directly to{" "}
              {providerSheetFor?.driver_name || "the driver"}
            </Text>

            {optionsLoading ? (
              <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
            ) : !providerOptions || providerOptions.length === 0 ? (
              <View style={styles.noProvidersBox}>
                <Ionicons name="alert-circle" size={20} color={colors.warning} />
                <Text style={styles.noProvidersText}>
                  Your driver hasn&apos;t connected any payment method yet. Please
                  ask them to set up payouts before paying.
                </Text>
              </View>
            ) : (
              providerOptions.map((opt, idx) => {
                const style = PROVIDER_STYLE[opt.id] || PROVIDER_STYLE.paypal;
                // White GPay button gets a border for visibility
                const needsBorder = opt.id === "googlepay";
                const textColor = opt.id === "googlepay" ? "#3C4043" : "#fff";
                return (
                  <TouchableOpacity
                    key={opt.id}
                    testID={`pay-with-${opt.id}`}
                    style={[
                      styles.providerBtn,
                      {
                        backgroundColor: style.bg,
                        marginTop: idx === 0 ? 0 : 10,
                        borderWidth: needsBorder ? 1.5 : 0,
                        borderColor: "#DADCE0",
                      },
                    ]}
                    onPress={() =>
                      providerSheetFor && handlePay(providerSheetFor, opt.id)
                    }
                    activeOpacity={0.88}
                  >
                    <Ionicons name={style.icon} size={22} color={style.iconColor} />
                    <Text style={[styles.providerBtnText, { color: textColor }]}>
                      {opt.id === "googlepay" || opt.id === "applepay"
                        ? `Pay with ${opt.label}`
                        : opt.id === "cash"
                        ? "Pay with Cash"
                        : `Pay with ${opt.label}`}
                    </Text>
                    {opt.via === "paypal" && opt.id !== "paypal" && (
                      <Text style={[styles.providerBtnSub, { color: textColor }]}>
                        via PayPal
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              })
            )}

            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => setProviderSheetFor(null)}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, marginTop: 4 },
  list: { padding: spacing.lg, paddingTop: 0, gap: spacing.md, paddingBottom: spacing.xxl },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  date: { color: colors.textSecondary, fontSize: 12 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  badgeText: { color: "#fff", fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  address: { color: colors.obsidian, fontSize: 14 },
  rowBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  driver: { color: colors.textSecondary, fontSize: 13 },
  fare: { color: colors.obsidian, fontWeight: "800", fontSize: 16 },
  paidPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,200,83,0.1)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    marginTop: 6,
  },
  paidText: { color: colors.success, fontSize: 12, fontWeight: "700" },
  starsRow: { flexDirection: "row", alignItems: "center", gap: 2, marginTop: 4 },
  ratedText: { color: colors.textSecondary, fontSize: 12, marginLeft: 6 },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.sm,
  },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  // Payment-provider bottom sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl + 12,
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.obsidian,
    marginBottom: 2,
  },
  sheetSub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginBottom: spacing.lg,
  },
  providerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 14,
    borderRadius: radius.md,
    minHeight: 52,
  },
  providerBtnText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  providerBtnSub: { fontSize: 11, opacity: 0.7, marginLeft: 4, fontWeight: "600" },
  noProvidersBox: {
    flexDirection: "row",
    gap: spacing.sm,
    backgroundColor: "#FFF7E6",
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
  },
  noProvidersText: {
    flex: 1,
    color: colors.obsidian,
    fontSize: 13,
    lineHeight: 18,
  },
  sheetCancel: {
    paddingVertical: spacing.md,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  sheetCancelText: { color: colors.textSecondary, fontWeight: "600", fontSize: 15 },
});
