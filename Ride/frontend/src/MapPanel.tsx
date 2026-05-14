import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "./theme";
import { viewOnMaps } from "./navigate";

type MarkerT = {
  id: string;
  lat: number;
  lng: number;
  title?: string;
  color?: string;
};

type Props = {
  markers: MarkerT[];
  height?: number;
  showsUserLocation?: boolean;
  testID?: string;
};

/**
 * Embedded-map-free panel. Lists trip waypoints as colored dots and lets the
 * user open them directly in their LOCAL maps app (Apple Maps / Google Maps).
 * No Google Maps API key required.
 */
export default function MapPanel({ markers, testID }: Props) {
  const primary = markers.find((m) => m.id === "pickup") || markers[0];
  const open = (m: MarkerT) => viewOnMaps(m.lat, m.lng, m.title);

  return (
    <View testID={testID} style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="map" size={18} color={colors.primary} />
        <Text style={styles.headerText}>Trip on map</Text>
      </View>

      {markers.length === 0 ? (
        <Text style={styles.emptyText}>No coordinates yet for this trip.</Text>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {markers.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={styles.row}
              onPress={() => open(m)}
              activeOpacity={0.75}
            >
              <View style={[styles.dot, { backgroundColor: m.color || colors.primary }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{m.title || labelFor(m.id)}</Text>
                <Text style={styles.rowSub}>
                  {m.lat.toFixed(5)}, {m.lng.toFixed(5)}
                </Text>
              </View>
              <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {primary ? (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => open(primary)}
          activeOpacity={0.85}
        >
          <Ionicons name="navigate" size={16} color="#fff" />
          <Text style={styles.primaryBtnText}>Open in Maps</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function labelFor(id: string) {
  if (id === "pickup") return "Pickup";
  if (id === "dropoff") return "Dropoff";
  if (id === "driver" || id === "me") return "Driver";
  return "Waypoint";
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerText: { fontSize: 12, fontWeight: "800", color: colors.obsidian, letterSpacing: 1, textTransform: "uppercase" },
  emptyText: { color: colors.textSecondary, fontSize: 13 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowTitle: { color: colors.obsidian, fontSize: 14, fontWeight: "700" },
  rowSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  primaryBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.obsidian,
  },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});
