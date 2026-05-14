import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "../../src/api";
import { colors, spacing, radius, shadow } from "../../src/theme";

type Ride = {
  id: string;
  pickup_address: string;
  dropoff_address: string;
  estimated_fare: number;
  completed_at?: string;
};

type Earnings = {
  total_earnings: number;
  completed_rides: number;
  rides: Ride[];
};

export default function DriverEarnings() {
  const [data, setData] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Earnings>("/driver/earnings");
      setData(res.data);
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

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { justifyContent: "center", alignItems: "center" }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Earnings</Text>
      </View>

      <View style={[styles.summary, shadow.card]}>
        <Text style={styles.eyebrow}>TOTAL EARNINGS</Text>
        <Text testID="total-earnings" style={styles.amount}>
          ${data?.total_earnings.toFixed(2) || "0.00"} <Text style={styles.amountCurrency}>MXN</Text>
        </Text>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Ionicons name="checkmark-done" size={18} color={colors.success} />
            <Text style={styles.statValue}>{data?.completed_rides || 0}</Text>
            <Text style={styles.statLabel}>Trips</Text>
          </View>
          <View style={styles.stat}>
            <Ionicons name="trending-up" size={18} color={colors.primary} />
            <Text style={styles.statValue}>
              ${data?.completed_rides ? (data.total_earnings / data.completed_rides).toFixed(0) : 0}
            </Text>
            <Text style={styles.statLabel}>Avg / trip</Text>
          </View>
        </View>
      </View>

      <FlatList
        testID="earnings-list"
        data={data?.rides || []}
        keyExtractor={(it) => it.id}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListHeaderComponent={
          <Text style={styles.sectionTitle}>Recent trips</Text>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="cash-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyText}>Complete rides to see your earnings here</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.address} numberOfLines={1}>{item.pickup_address}</Text>
              <Text style={styles.addressSub} numberOfLines={1}>→ {item.dropoff_address}</Text>
              {item.completed_at && (
                <Text style={styles.date}>{new Date(item.completed_at).toLocaleString()}</Text>
              )}
            </View>
            <Text style={styles.fare}>+${item.estimated_fare.toFixed(2)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.lg, paddingBottom: spacing.sm },
  title: { fontSize: 28, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  summary: {
    margin: spacing.lg,
    marginTop: 0,
    backgroundColor: colors.obsidian,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, color: "rgba(255,255,255,0.6)", fontWeight: "800" },
  amount: { fontSize: 44, color: "#fff", fontWeight: "800", marginTop: spacing.sm, letterSpacing: -2 },
  amountCurrency: { fontSize: 18, color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  statRow: { flexDirection: "row", gap: spacing.lg, marginTop: spacing.lg },
  stat: { flexDirection: "row", alignItems: "center", gap: 6 },
  statValue: { color: "#fff", fontWeight: "800", fontSize: 18 },
  statLabel: { color: "rgba(255,255,255,0.6)", fontSize: 13 },
  list: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
  sectionTitle: { fontSize: 18, fontWeight: "800", color: colors.obsidian, marginBottom: spacing.md },
  empty: { alignItems: "center", padding: spacing.xxl, gap: spacing.md },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: "center" },
  row: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    alignItems: "center",
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  address: { color: colors.obsidian, fontWeight: "700", fontSize: 14 },
  addressSub: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  date: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  fare: { color: colors.success, fontWeight: "800", fontSize: 16 },
});
