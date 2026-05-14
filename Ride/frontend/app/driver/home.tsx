import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { api, formatApiError } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, spacing, radius, shadow } from "../../src/theme";
import MapPanel from "../../src/MapPanel";
import { ensureNotificationSetup, notify, registerPushToken } from "../../src/notifications";
import { useRideSocket } from "../../src/useRideSocket";
import RatingModal from "../../src/RatingModal";
import RideRequestModal from "../../src/RideRequestModal";
import { getAppOrigin } from "../../src/origin";
import { navigateTo } from "../../src/navigate";

type Plan = {
  id: "daily" | "weekly" | "monthly";
  name: string;
  amount: number;
  hours: number;
  label: string;
  savings: string | null;
};

type Subscription = {
  active: boolean;
  subscription: { expires_at: string } | null;
  amount: number;
  currency: string;
  plans: Plan[];
};

type Ride = {
  id: string;
  rider_name: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  status: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  distance_km?: number | null;
  duration_min?: number | null;
  currency?: string;
};

// Type for incoming ride request from push notification
type RideRequestData = {
  ride_id: string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  estimated_fare: number;
  distance_km?: number | null;
  duration_min?: number | null;
  currency: string;
  rider_name: string;
};

export default function DriverHome() {
  const { user } = useAuth();
  const [sub, setSub] = useState<Subscription | null>(null);
  const [available, setAvailable] = useState<Ride[]>([]);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<"daily" | "weekly" | "monthly">("daily");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const knownAvailableRef = useRef<Set<string>>(new Set());
  
  // State for ride request modal
  const [rideRequestData, setRideRequestData] = useState<RideRequestData | null>(null);
  const [showRideRequest, setShowRideRequest] = useState(false);

  // Setup permissions + start location streaming
  useEffect(() => {
    ensureNotificationSetup();
    registerPushToken();
    if (Platform.OS === "web") return;
    let watch: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10000, distanceInterval: 25 },
          async (loc) => {
            const c = { lat: loc.coords.latitude, lng: loc.coords.longitude };
            setCoords(c);
            try {
              await api.post("/driver/location", c);
            } catch {
              // ignore
            }
          },
        );
      } catch {
        // ignore
      }
    })();
    return () => {
      if (watch) watch.remove();
    };
  }, []);

  // Live updates via WebSocket
  useRideSocket((event, payload) => {
    if (event === "ride.created") {
      // Reload available rides quickly
      loadAvailable();
    }
    // Handle incoming ride request - show modal with ride details
    if (event === "ride.new_request" && payload) {
      // Don't show if we already have an active ride
      if (activeRide) return;
      
      setRideRequestData({
        ride_id: payload.ride_id,
        pickup_address: payload.pickup_address || "Unknown pickup",
        dropoff_address: payload.dropoff_address || "Unknown dropoff",
        pickup_lat: payload.pickup_lat,
        pickup_lng: payload.pickup_lng,
        dropoff_lat: payload.dropoff_lat,
        dropoff_lng: payload.dropoff_lng,
        estimated_fare: payload.estimated_fare || 0,
        distance_km: payload.distance_km,
        duration_min: payload.duration_min,
        currency: payload.currency || "MXN",
        rider_name: payload.rider_name || "Rider",
      });
      setShowRideRequest(true);
    }
    if (event === "ride.paid" && payload?.id && activeRide && payload.id === activeRide.id) {
      notify("Payment received", `+$${payload.estimated_fare?.toFixed(2)} MXN paid for your trip.`);
    }
  });

  // Listen for push notifications (for when app is in foreground or opened from notification)
  useEffect(() => {
    if (Platform.OS === "web") return;
    
    // Handle notification received while app is foregrounded
    const foregroundSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data;
      if (data?.type === "ride.new_request" && !activeRide) {
        setRideRequestData({
          ride_id: data.ride_id,
          pickup_address: data.pickup_address || "Unknown pickup",
          dropoff_address: data.dropoff_address || "Unknown dropoff",
          pickup_lat: data.pickup_lat,
          pickup_lng: data.pickup_lng,
          dropoff_lat: data.dropoff_lat,
          dropoff_lng: data.dropoff_lng,
          estimated_fare: data.estimated_fare || 0,
          distance_km: data.distance_km,
          duration_min: data.duration_min,
          currency: data.currency || "MXN",
          rider_name: data.rider_name || "Rider",
        });
        setShowRideRequest(true);
      }
    });
    
    // Handle when user taps on notification
    const responseSub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.type === "ride.new_request" && !activeRide) {
        setRideRequestData({
          ride_id: data.ride_id,
          pickup_address: data.pickup_address || "Unknown pickup",
          dropoff_address: data.dropoff_address || "Unknown dropoff",
          pickup_lat: data.pickup_lat,
          pickup_lng: data.pickup_lng,
          dropoff_lat: data.dropoff_lat,
          dropoff_lng: data.dropoff_lng,
          estimated_fare: data.estimated_fare || 0,
          distance_km: data.distance_km,
          duration_min: data.duration_min,
          currency: data.currency || "MXN",
          rider_name: data.rider_name || "Rider",
        });
        setShowRideRequest(true);
      }
    });
    
    return () => {
      foregroundSub.remove();
      responseSub.remove();
    };
  }, [activeRide]);

  const [ratingFor, setRatingFor] = useState<Ride | null>(null);
  const [pendingCashRides, setPendingCashRides] = useState<Ride[]>([]);
  const [confirmingCash, setConfirmingCash] = useState<string | null>(null);

  const loadSub = useCallback(async () => {
    try {
      const res = await api.get<Subscription>("/driver/subscription");
      setSub(res.data);
      return res.data;
    } catch {
      return null;
    }
  }, []);

  const loadRides = useCallback(async () => {
    try {
      const myRes = await api.get<Ride[]>("/rides/my");
      const active = myRes.data.find((r) => r.status === "accepted");
      setActiveRide(active || null);
      
      // Also load pending cash rides from earnings endpoint
      const earningsRes = await api.get<{pending_cash_rides: Ride[]}>("/driver/earnings");
      setPendingCashRides(earningsRes.data.pending_cash_rides || []);
    } catch {
      // ignore
    }
  }, []);

  const loadAvailable = useCallback(async () => {
    try {
      const res = await api.get<Ride[]>("/rides/available");
      const newRides = res.data.filter((r) => !knownAvailableRef.current.has(r.id));
      if (newRides.length > 0 && knownAvailableRef.current.size > 0) {
        // Only notify after the first load
        notify("New ride request", `${newRides.length} new ride${newRides.length > 1 ? "s" : ""} available.`);
      }
      knownAvailableRef.current = new Set(res.data.map((r) => r.id));
      setAvailable(res.data);
    } catch {
      setAvailable([]);
    }
  }, []);

  const loadAll = useCallback(async () => {
    const s = await loadSub();
    await loadRides();
    if (s?.active) {
      await loadAvailable();
    } else {
      setAvailable([]);
    }
  }, [loadSub, loadRides, loadAvailable]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      loadAll().finally(() => setLoading(false));
      const id = setInterval(loadAll, 5000);
      return () => clearInterval(id);
    }, [loadAll]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleSubscribe = async (planId: "daily" | "weekly" | "monthly") => {
    setSubscribing(planId);
    try {
      const origin = getAppOrigin();
      const res = await api.post("/driver/subscribe", { origin_url: origin, plan_id: planId });
      const url = res.data.url as string;

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.location.href = url;
      } else {
        const result = await WebBrowser.openAuthSessionAsync(url, `${origin}/payment-success`);
        if (result.type === "success" && result.url) {
          const sessionId = new URL(result.url).searchParams.get("session_id");
          if (sessionId) await pollPaymentStatus(sessionId);
        } else {
          await loadAll();
        }
      }
    } catch (e: any) {
      Alert.alert("Subscription error", formatApiError(e));
    } finally {
      setSubscribing(null);
    }
  };

  const pollPaymentStatus = async (sessionId: string) => {
    for (let i = 0; i < 8; i++) {
      try {
        const res = await api.get(`/payments/checkout/status/${sessionId}`);
        if (res.data.payment_status === "paid") {
          await loadAll();
          notify("You're live!", "Your subscription is active.");
          return;
        }
      } catch {
        // ignore
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    await loadAll();
  };

  const handleAccept = async (ride: Ride) => {
    try {
      const res = await api.post(`/rides/${ride.id}/accept`);
      setActiveRide(res.data);
      notify("Ride accepted", `${res.data.rider_name || "Rider"} is waiting at pickup.`);
      await loadAvailable();
    } catch (e: any) {
      Alert.alert("Could not accept", formatApiError(e));
    }
  };

  const handleComplete = async () => {
    if (!activeRide) return;
    try {
      await api.post(`/rides/${activeRide.id}/complete`);
      notify("Trip completed", `+$${activeRide.estimated_fare.toFixed(2)} MXN earned.`);
      setActiveRide(null);
      await loadAll();
    } catch (e: any) {
      Alert.alert("Error", formatApiError(e));
    }
  };

  const handleConfirmCash = async (rideId: string) => {
    setConfirmingCash(rideId);
    try {
      await api.post(`/rides/${rideId}/confirm-cash`);
      notify("Cash confirmed", "Payment received and recorded.");
      await loadAll();
    } catch (e: any) {
      Alert.alert("Error", formatApiError(e));
    } finally {
      setConfirmingCash(null);
    }
  };

  const handleRejectCash = async (rideId: string, riderName: string) => {
    Alert.alert(
      "Reject Cash Payment",
      `Are you sure ${riderName} did NOT pay you cash?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Yes, Reject",
          style: "destructive",
          onPress: async () => {
            setConfirmingCash(rideId);
            try {
              await api.post(`/rides/${rideId}/reject-cash`);
              notify("Cash rejected", "The rider will need to pay via another method.");
              await loadAll();
            } catch (e: any) {
              Alert.alert("Error", formatApiError(e));
            } finally {
              setConfirmingCash(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  const expired = !sub?.active;
  const expiresAt = sub?.subscription?.expires_at
    ? new Date(sub.subscription.expires_at).toLocaleString()
    : null;
  const plans = sub?.plans || [];
  const currentPlan = plans.find((p) => p.id === selectedPlan) || plans[0];

  // Build map markers for active ride
  const activeMarkers = activeRide
    ? [
        activeRide.pickup_lat && activeRide.pickup_lng
          ? { id: "pickup", lat: activeRide.pickup_lat, lng: activeRide.pickup_lng, title: "Pickup", color: colors.primary }
          : null,
        activeRide.dropoff_lat && activeRide.dropoff_lng
          ? { id: "dropoff", lat: activeRide.dropoff_lat, lng: activeRide.dropoff_lng, title: "Dropoff", color: colors.danger }
          : null,
        coords ? { id: "me", lat: coords.lat, lng: coords.lng, title: "You", color: colors.success } : null,
      ].filter(Boolean) as { id: string; lat: number; lng: number; title?: string; color?: string }[]
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View
        testID="subscription-banner"
        style={[styles.banner, { backgroundColor: expired ? colors.danger : colors.success }]}
      >
        <Ionicons name={expired ? "alert-circle" : "checkmark-circle"} size={20} color="#fff" />
        <Text style={styles.bannerText}>
          {expired
            ? "Subscription expired — pick a plan to go online"
            : `Active until ${expiresAt}`}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.greet}>Hey,</Text>
            <Text style={styles.name}>{user?.name}</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: expired ? colors.textSecondary : colors.primary }]}>
            <Ionicons name="car" size={22} color="#fff" />
          </View>
        </View>

        {expired ? (
          <View testID="paywall-card" style={[styles.paywall, shadow.card]}>
            <Text style={styles.paywallEyebrow}>CHOOSE YOUR PASS</Text>
            <Text style={styles.paywallTitle}>Pay once. Drive freely.</Text>
            <Text style={styles.paywallSub}>
              No commission. Keep 100% of every fare. Cancel anytime.
            </Text>

            <View style={styles.tierRow}>
              {plans.map((plan) => {
                const active = selectedPlan === plan.id;
                return (
                  <TouchableOpacity
                    key={plan.id}
                    testID={`plan-${plan.id}`}
                    onPress={() => setSelectedPlan(plan.id)}
                    activeOpacity={0.85}
                    style={[styles.tierCard, active && styles.tierCardActive]}
                  >
                    {plan.savings && (
                      <View style={styles.tierBadge}>
                        <Text style={styles.tierBadgeText}>{plan.savings}</Text>
                      </View>
                    )}
                    <Text style={[styles.tierName, active && { color: "#fff" }]}>{plan.name}</Text>
                    <Text style={[styles.tierAmount, active && { color: "#fff" }]}>
                      ${plan.amount.toFixed(0)}
                    </Text>
                    <Text style={[styles.tierUnit, active && { color: "rgba(255,255,255,0.7)" }]}>
                      MXN · {plan.hours}h
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              testID="subscribe-btn"
              style={[styles.primaryBtn, !!subscribing && { opacity: 0.7 }]}
              onPress={() => currentPlan && handleSubscribe(currentPlan.id)}
              disabled={!!subscribing || !currentPlan}
              activeOpacity={0.85}
            >
              {subscribing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>
                  Pay ${currentPlan?.amount.toFixed(0)} MXN with PayPal
                </Text>
              )}
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              Sandbox: log in with your PayPal sandbox personal account · No real money charged
            </Text>
          </View>
        ) : activeRide ? (
          <View testID="active-ride-card" style={[styles.card, shadow.card]}>
            <MapPanel testID="driver-map" markers={activeMarkers} height={200} showsUserLocation />

            <View style={[styles.statusPill, { backgroundColor: colors.primary, marginTop: spacing.md }]}>
              <Text style={styles.statusPillText}>EN ROUTE</Text>
            </View>
            <Text style={styles.riderName}>{activeRide.rider_name}</Text>
            <View style={styles.routeRow}>
              <View style={styles.routeIconCol}>
                <View style={[styles.dot, { backgroundColor: colors.primary }]} />
                <View style={styles.routeLine} />
                <View style={[styles.dot, { backgroundColor: colors.danger }]} />
              </View>
              <View style={{ flex: 1, gap: spacing.md }}>
                <View>
                  <Text style={styles.routeLabel}>PICKUP</Text>
                  <Text style={styles.routeText}>{activeRide.pickup_address}</Text>
                </View>
                <View>
                  <Text style={styles.routeLabel}>DROPOFF</Text>
                  <Text style={styles.routeText}>{activeRide.dropoff_address}</Text>
                </View>
              </View>
            </View>
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>You earn</Text>
              <Text style={styles.fareValue}>${activeRide.estimated_fare.toFixed(2)} MXN</Text>
            </View>
            <TouchableOpacity
              testID="navigate-btn"
              style={[styles.successBtn, { backgroundColor: colors.obsidian, marginTop: spacing.sm }]}
              onPress={() => {
                if (activeRide.dropoff_lat && activeRide.dropoff_lng) {
                  navigateTo(activeRide.dropoff_lat, activeRide.dropoff_lng, "Dropoff");
                } else if (activeRide.pickup_lat && activeRide.pickup_lng) {
                  navigateTo(activeRide.pickup_lat, activeRide.pickup_lng, "Pickup");
                }
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Open in Maps</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="complete-ride-btn"
              style={styles.successBtn}
              onPress={handleComplete}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Complete ride</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.sectionTitle}>Available rides</Text>
            <Text style={styles.sectionSub}>Auto-refreshes every 5 seconds · Push notifications on for new requests</Text>

            {available.length === 0 ? (
              <View style={[styles.card, { alignItems: "center", paddingVertical: spacing.xl }]}>
                <Ionicons name="hourglass-outline" size={36} color={colors.textSecondary} />
                <Text style={{ color: colors.textSecondary, marginTop: spacing.sm }}>
                  Waiting for ride requests…
                </Text>
              </View>
            ) : (
              available.map((r) => (
                <View key={r.id} testID={`available-ride-${r.id}`} style={[styles.card, shadow.card]}>
                  <View style={styles.rideHeader}>
                    <Text style={styles.riderName}>{r.rider_name}</Text>
                    <Text style={styles.farePill}>${r.estimated_fare.toFixed(0)} MXN</Text>
                  </View>
                  <View style={{ marginTop: spacing.sm, gap: 4 }}>
                    <Text style={styles.address} numberOfLines={1}>● {r.pickup_address}</Text>
                    <Text style={styles.address} numberOfLines={1}>◆ {r.dropoff_address}</Text>
                  </View>
                  <TouchableOpacity
                    testID={`accept-ride-${r.id}`}
                    style={styles.primaryBtn}
                    onPress={() => handleAccept(r)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>Accept ride</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        )}

        {/* Pending Cash Confirmations Section */}
        {pendingCashRides.length > 0 && (
          <View style={{ marginTop: spacing.lg }}>
            <Text style={styles.sectionTitle}>💵 Pending Cash Confirmations</Text>
            <Text style={styles.sectionSub}>Confirm you received cash from these riders</Text>
            
            {pendingCashRides.map((ride) => (
              <View key={ride.id} testID={`cash-confirm-${ride.id}`} style={[styles.card, shadow.card, { borderLeftWidth: 4, borderLeftColor: colors.warning }]}>
                <View style={styles.rideHeader}>
                  <Text style={styles.riderName}>{ride.rider_name}</Text>
                  <Text style={[styles.farePill, { backgroundColor: colors.warning }]}>
                    ${ride.estimated_fare.toFixed(0)} CASH
                  </Text>
                </View>
                <View style={{ marginTop: spacing.sm, gap: 4 }}>
                  <Text style={styles.address} numberOfLines={1}>● {ride.pickup_address}</Text>
                  <Text style={styles.address} numberOfLines={1}>◆ {ride.dropoff_address}</Text>
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                  <TouchableOpacity
                    testID={`reject-cash-${ride.id}`}
                    style={[styles.primaryBtn, { flex: 1, backgroundColor: colors.danger }]}
                    onPress={() => handleRejectCash(ride.id, ride.rider_name)}
                    disabled={confirmingCash === ride.id}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>
                      {confirmingCash === ride.id ? "..." : "Did NOT Receive"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`confirm-cash-${ride.id}`}
                    style={[styles.successBtn, { flex: 1 }]}
                    onPress={() => handleConfirmCash(ride.id)}
                    disabled={confirmingCash === ride.id}
                    activeOpacity={0.85}
                  >
                    {confirmingCash === ride.id ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.primaryBtnText}>✓ Cash Received</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <RatingModal
        visible={!!ratingFor}
        rideId={ratingFor?.id || null}
        counterpartyName={ratingFor?.rider_name || "your rider"}
        onClose={() => setRatingFor(null)}
        onSubmitted={loadAll}
      />
      
      {/* Ride Request Modal - shows when nearby driver receives new ride notification */}
      <RideRequestModal
        visible={showRideRequest}
        rideData={rideRequestData}
        onAccept={async (rideId) => {
          try {
            await api.post(`/rides/${rideId}/accept`);
            setShowRideRequest(false);
            setRideRequestData(null);
            await loadAll();
            notify("Ride accepted!", "Navigate to the pickup location.");
          } catch (e: any) {
            Alert.alert("Could not accept ride", formatApiError(e));
          }
        }}
        onDismiss={() => {
          setShowRideRequest(false);
          setRideRequestData(null);
        }}
        expiresInSeconds={30}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  bannerText: { color: "#fff", fontWeight: "700", fontSize: 14, flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  greet: { color: colors.textSecondary, fontSize: 14 },
  name: { color: colors.obsidian, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  paywall: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    borderWidth: 2,
    borderColor: colors.obsidian,
  },
  paywallEyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    fontWeight: "800",
    color: colors.primary,
    marginBottom: spacing.sm,
  },
  paywallTitle: { fontSize: 28, fontWeight: "800", color: colors.obsidian, letterSpacing: -1 },
  paywallSub: { color: colors.textSecondary, marginTop: spacing.xs, fontSize: 15, lineHeight: 21, marginBottom: spacing.lg },
  tierRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.lg },
  tierCard: {
    flex: 1,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    minHeight: 120,
    position: "relative",
  },
  tierCardActive: {
    backgroundColor: colors.obsidian,
    borderColor: colors.obsidian,
  },
  tierBadge: {
    position: "absolute",
    top: -10,
    right: 8,
    backgroundColor: colors.success,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  tierBadgeText: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  tierName: { fontSize: 12, fontWeight: "700", color: colors.textSecondary, letterSpacing: 1, textTransform: "uppercase" },
  tierAmount: { fontSize: 32, fontWeight: "800", color: colors.obsidian, marginTop: 6, letterSpacing: -1 },
  tierUnit: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  successBtn: {
    backgroundColor: colors.success,
    paddingVertical: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    marginTop: spacing.md,
  },
  disclaimer: { color: colors.textSecondary, fontSize: 12, marginTop: spacing.md, textAlign: "center" },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 22, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  sectionSub: { color: colors.textSecondary, marginTop: 2, marginBottom: spacing.md, fontSize: 13 },
  rideHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  riderName: { fontSize: 16, fontWeight: "700", color: colors.obsidian },
  farePill: {
    backgroundColor: colors.obsidian,
    color: "#fff",
    fontWeight: "800",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    overflow: "hidden",
    fontSize: 13,
  },
  address: { color: colors.textPrimary, fontSize: 14 },
  statusPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    marginBottom: spacing.sm,
  },
  statusPillText: { color: "#fff", fontWeight: "800", fontSize: 11, letterSpacing: 1 },
  routeRow: { flexDirection: "row", gap: spacing.md, marginVertical: spacing.md },
  routeIconCol: { alignItems: "center", paddingTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { fontSize: 11, letterSpacing: 1.2, color: colors.textSecondary, fontWeight: "700" },
  routeText: { fontSize: 16, color: colors.obsidian, marginTop: 2 },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  fareLabel: { color: colors.textSecondary },
  fareValue: { color: colors.obsidian, fontWeight: "800", fontSize: 18 },
});
