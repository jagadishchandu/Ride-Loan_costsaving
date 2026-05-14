import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { api, formatApiError } from "../../src/api";
import { useAuth } from "../../src/auth";
import { colors, spacing, radius, shadow } from "../../src/theme";
import MapPanel from "../../src/MapPanel";
import { ensureNotificationSetup, notify, registerPushToken } from "../../src/notifications";
import { useRideSocket } from "../../src/useRideSocket";
import LocationPicker from "../../src/LocationPicker";

type Ride = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  status: string;
  driver_name?: string | null;
  driver_vehicle?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  requested: { label: "Searching for driver…", color: colors.warning },
  accepted: { label: "Driver on the way", color: colors.primary },
  completed: { label: "Completed", color: colors.success },
  cancelled: { label: "Cancelled", color: colors.danger },
};

const CDMX = { lat: 19.4326, lng: -99.1332 };

export default function RiderHome() {
  const { user } = useAuth();
  const [pickup, setPickup] = useState("");
  const [pickupCoords, setPickupCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [dropoff, setDropoff] = useState("");
  const [dropoffCoords, setDropoffCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState<null | "pickup" | "dropoff">(null);
  const [fare, setFare] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [estimate, setEstimate] = useState<{
    distance_km: number;
    duration_min: number;
    fare: number;
    currency: string;
    source: string;
  } | null>(null);
  const [estimating, setEstimating] = useState(false);
  const lastStatusRef = useRef<string | null>(null);

  // Request location once
  useEffect(() => {
    (async () => {
      ensureNotificationSetup();
      registerPushToken();
      if (Platform.OS === "web") return;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return;
        const loc = await Location.getCurrentPositionAsync({});
        setCoords({ lat: loc.coords.latitude, lng: loc.coords.longitude });
      } catch {
        // ignore
      }
    })();
  }, []);

  // Auto-estimate fare whenever both pickup & dropoff coords change
  useEffect(() => {
    if (!pickupCoords || !dropoffCoords) {
      setEstimate(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setEstimating(true);
      try {
        const res = await api.post("/rides/estimate-fare", {
          pickup_lat: pickupCoords.lat,
          pickup_lng: pickupCoords.lng,
          dropoff_lat: dropoffCoords.lat,
          dropoff_lng: dropoffCoords.lng,
        });
        if (!cancelled) {
          setEstimate(res.data);
          // Auto-fill the fare input if the user hasn't typed anything yet
          setFare((curr) => (curr ? curr : String(res.data.fare)));
        }
      } catch {
        // ignore — keep manual entry
      } finally {
        if (!cancelled) setEstimating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickupCoords, dropoffCoords]);

  // Live updates via WebSocket - applies any ride change instantly
  useRideSocket((event, payload) => {
    if (!payload || !payload.id) return;
    if (event === "ride.accepted" || event === "ride.location" || event === "ride.completed" || event === "ride.cancelled" || event === "ride.paid") {
      // Only react if it's our active ride
      if (activeRide && payload.id === activeRide.id) {
        setActiveRide((prev) => (prev ? { ...prev, ...payload } : payload));
        if (event === "ride.accepted") {
          notify("Driver accepted!", `${payload.driver_name || "A driver"} is on the way.`);
        }
      }
    }
  });

  const loadActive = useCallback(async () => {
    try {
      const res = await api.get<Ride[]>("/rides/my");
      const active = res.data.find((r) => ["requested", "accepted"].includes(r.status));
      // Notify on status change
      if (active && lastStatusRef.current && lastStatusRef.current !== active.status) {
        if (active.status === "accepted") {
          notify("Driver accepted!", `${active.driver_name || "A driver"} is on the way.`);
        }
      }
      const completedJustNow = !active && lastStatusRef.current === "accepted";
      if (completedJustNow) {
        notify("Trip completed", "Thanks for riding with us!");
      }
      lastStatusRef.current = active?.status || null;

      // Fetch fresh ride detail to get driver location
      if (active) {
        try {
          const detail = await api.get<Ride>(`/rides/${active.id}`);
          setActiveRide(detail.data);
          return;
        } catch {
          // fallback
        }
      }
      setActiveRide(active || null);
    } catch {
      // ignore
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadActive();
      const id = setInterval(loadActive, 4000);
      return () => clearInterval(id);
    }, [loadActive]),
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await loadActive();
    setRefreshing(false);
  };

  const handleRequest = async () => {
    setError(null);
    const fareNum = parseFloat(fare);
    if (!pickup.trim() || !dropoff.trim() || isNaN(fareNum) || fareNum <= 0) {
      setError("Please pick pickup, dropoff, and enter a valid fare.");
      return;
    }
    setSubmitting(true);
    try {
      const pCoords = pickupCoords || coords || CDMX;
      const dCoords = dropoffCoords || {
        lat: pCoords.lat + 0.02,
        lng: pCoords.lng + 0.02,
      };
      const res = await api.post<Ride>("/rides", {
        pickup_address: pickup.trim(),
        dropoff_address: dropoff.trim(),
        estimated_fare: fareNum,
        pickup_lat: pCoords.lat,
        pickup_lng: pCoords.lng,
        dropoff_lat: dCoords.lat,
        dropoff_lng: dCoords.lng,
        distance_km: estimate?.distance_km || null,
        duration_min: estimate?.duration_min || null,
      });
      setActiveRide(res.data);
      lastStatusRef.current = "requested";
      setPickup("");
      setPickupCoords(null);
      setDropoff("");
      setDropoffCoords(null);
      setFare("");
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!activeRide) return;
    try {
      await api.post(`/rides/${activeRide.id}/cancel`);
      setActiveRide(null);
      lastStatusRef.current = null;
    } catch (e: any) {
      setError(formatApiError(e));
    }
  };

  // Build markers for active ride map
  const activeMarkers = activeRide
    ? [
        activeRide.pickup_lat && activeRide.pickup_lng
          ? {
              id: "pickup",
              lat: activeRide.pickup_lat,
              lng: activeRide.pickup_lng,
              title: "Pickup",
              color: colors.primary,
            }
          : null,
        activeRide.dropoff_lat && activeRide.dropoff_lng
          ? {
              id: "dropoff",
              lat: activeRide.dropoff_lat,
              lng: activeRide.dropoff_lng,
              title: "Dropoff",
              color: colors.danger,
            }
          : null,
        activeRide.driver_lat && activeRide.driver_lng
          ? {
              id: "driver",
              lat: activeRide.driver_lat,
              lng: activeRide.driver_lng,
              title: activeRide.driver_name || "Driver",
              color: colors.success,
            }
          : null,
      ].filter(Boolean) as { id: string; lat: number; lng: number; title?: string; color?: string }[]
    : [];

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          <View style={styles.header}>
            <View>
              <Text style={styles.greet}>Hello,</Text>
              <Text testID="rider-name" style={styles.name}>{user?.name}</Text>
            </View>
            <View style={styles.avatar}>
              <Ionicons name="person" size={22} color="#fff" />
            </View>
          </View>

          {activeRide ? (
            <View testID="active-ride-card" style={[styles.card, shadow.card]}>
              <MapPanel
                testID="rider-map"
                markers={activeMarkers}
                height={200}
                showsUserLocation
              />

              <View style={[styles.statusRow, { marginTop: spacing.md }]}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_LABEL[activeRide.status]?.color || colors.warning }]} />
                <Text style={[styles.statusText, { color: STATUS_LABEL[activeRide.status]?.color || colors.warning }]}>
                  {STATUS_LABEL[activeRide.status]?.label || activeRide.status}
                </Text>
              </View>

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

              {activeRide.status === "accepted" && activeRide.driver_name && (
                <View style={styles.driverBox}>
                  <Ionicons name="car" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{activeRide.driver_name}</Text>
                    {activeRide.driver_vehicle && (
                      <Text style={styles.driverVeh}>{activeRide.driver_vehicle}</Text>
                    )}
                  </View>
                </View>
              )}

              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Estimated fare</Text>
                <Text style={styles.fareValue}>${activeRide.estimated_fare.toFixed(2)} MXN</Text>
              </View>

              {activeRide.status !== "completed" && (
                <TouchableOpacity
                  testID="cancel-ride-btn"
                  style={styles.cancelBtn}
                  onPress={handleCancel}
                  activeOpacity={0.85}
                >
                  <Text style={styles.cancelBtnText}>Cancel ride</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <View testID="request-form" style={[styles.card, shadow.card]}>
              <Text style={styles.cardTitle}>Where to?</Text>
              <Text style={styles.cardSub}>Enter pickup and destination to request a ride.</Text>

              <View style={styles.field}>
                <Text style={styles.label}>PICKUP</Text>
                <TouchableOpacity
                  testID="pickup-input"
                  style={styles.pickerInput}
                  onPress={() => setPickerOpen("pickup")}
                  activeOpacity={0.85}
                >
                  <View style={[styles.pickerDot, { backgroundColor: colors.primary }]} />
                  <Text
                    style={[styles.pickerText, !pickup && styles.pickerPlaceholder]}
                    numberOfLines={1}
                  >
                    {pickup || "Tap to choose pickup"}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>DROPOFF</Text>
                <TouchableOpacity
                  testID="dropoff-input"
                  style={styles.pickerInput}
                  onPress={() => setPickerOpen("dropoff")}
                  activeOpacity={0.85}
                >
                  <View style={[styles.pickerDot, { backgroundColor: colors.danger }]} />
                  <Text
                    style={[styles.pickerText, !dropoff && styles.pickerPlaceholder]}
                    numberOfLines={1}
                  >
                    {dropoff || "Tap to choose destination"}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>OFFER FARE (MXN)</Text>
                <TextInput
                  testID="fare-input"
                  style={styles.input}
                  value={fare}
                  onChangeText={setFare}
                  placeholder="e.g. 120"
                  placeholderTextColor="#9CA3AF"
                  keyboardType="decimal-pad"
                />
                {estimating && (
                  <View style={styles.estimateLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.estimateLoadingText}>Calculating fare…</Text>
                  </View>
                )}
                {estimate && !estimating && (
                  <View testID="fare-estimate" style={styles.estimateBox}>
                    <View style={styles.estimateRow}>
                      <View style={styles.estimateMetric}>
                        <Ionicons name="navigate-outline" size={14} color={colors.textSecondary} />
                        <Text style={styles.estimateMetricText}>{estimate.distance_km.toFixed(1)} km</Text>
                      </View>
                      <View style={styles.estimateMetric}>
                        <Ionicons name="time-outline" size={14} color={colors.textSecondary} />
                        <Text style={styles.estimateMetricText}>~{Math.round(estimate.duration_min)} min</Text>
                      </View>
                      <Text style={styles.estimateFare}>
                        ${estimate.fare.toFixed(0)} {estimate.currency}
                      </Text>
                    </View>
                    <TouchableOpacity
                      testID="use-suggested-fare"
                      onPress={() => setFare(String(estimate.fare))}
                      activeOpacity={0.7}
                      style={styles.useSuggestedBtn}
                    >
                      <Ionicons name="sparkles" size={14} color={colors.primary} />
                      <Text style={styles.useSuggestedText}>Use suggested fare</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {error ? <Text testID="rider-error" style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                testID="request-ride-btn"
                style={[styles.primaryBtn, submitting && { opacity: 0.7 }]}
                disabled={submitting}
                onPress={handleRequest}
                activeOpacity={0.85}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Request ride</Text>}
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
            <Text style={styles.infoText}>
              Drivers on Ride pay a flat $30 MXN/day subscription — they keep 100% of every fare you pay.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <LocationPicker
        visible={pickerOpen !== null}
        title={pickerOpen === "pickup" ? "Choose pickup" : "Choose destination"}
        initialCoords={
          pickerOpen === "pickup"
            ? pickupCoords || coords
            : dropoffCoords || pickupCoords || coords
        }
        onClose={() => setPickerOpen(null)}
        onSelect={({ lat, lng, address }) => {
          if (pickerOpen === "pickup") {
            setPickup(address);
            setPickupCoords({ lat, lng });
          } else if (pickerOpen === "dropoff") {
            setDropoff(address);
            setDropoffCoords({ lat, lng });
          }
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  greet: { color: colors.textSecondary, fontSize: 14 },
  name: { color: colors.obsidian, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.obsidian,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardTitle: { fontSize: 22, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  cardSub: { color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
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
  pickerInput: {
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  pickerDot: { width: 10, height: 10, borderRadius: 5 },
  pickerText: { flex: 1, fontSize: 16, color: colors.obsidian },
  pickerPlaceholder: { color: "#9CA3AF", fontWeight: "400" },
  error: { color: colors.danger, marginTop: 6, fontWeight: "600" },
  estimateLoading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.sm,
  },
  estimateLoadingText: { color: colors.textSecondary, fontSize: 13 },
  estimateBox: {
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  estimateRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  estimateMetric: { flexDirection: "row", alignItems: "center", gap: 4 },
  estimateMetricText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  estimateFare: { color: colors.obsidian, fontSize: 18, fontWeight: "800", letterSpacing: -0.5 },
  useSuggestedBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: "rgba(26,69,255,0.08)",
  },
  useSuggestedText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  primaryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: 18,
    borderRadius: radius.sm,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontWeight: "700", fontSize: 14 },
  routeRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  routeIconCol: { alignItems: "center", paddingTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 4 },
  routeLabel: { fontSize: 11, letterSpacing: 1.2, color: colors.textSecondary, fontWeight: "700" },
  routeText: { fontSize: 16, color: colors.obsidian, marginTop: 2 },
  driverBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  driverName: { fontSize: 16, fontWeight: "700", color: colors.obsidian },
  driverVeh: { fontSize: 13, color: colors.textSecondary },
  fareRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginBottom: spacing.md,
  },
  fareLabel: { color: colors.textSecondary, fontSize: 14 },
  fareValue: { color: colors.obsidian, fontSize: 16, fontWeight: "800" },
  cancelBtn: {
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: "center",
    borderWidth: 2,
    borderColor: colors.danger,
  },
  cancelBtnText: { color: colors.danger, fontWeight: "700", fontSize: 15 },
  infoBox: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "flex-start",
  },
  infoText: { flex: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
});
