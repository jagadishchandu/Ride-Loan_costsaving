import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { reverseGeocode, searchPlaces, GeoResult } from "./geocode";
import { colors, spacing, radius } from "./theme";

type Props = {
  visible: boolean;
  title: string;
  initialCoords?: { lat: number; lng: number } | null;
  onClose: () => void;
  onSelect: (coords: { lat: number; lng: number; address: string }) => void;
};

/**
 * Search-first location picker. No embedded map — uses the device's GPS
 * for "Use my location" and OpenStreetMap (Nominatim) for free address
 * search/reverse-geocoding. Users navigate with their LOCAL maps app.
 */
export default function LocationPicker({ visible, title, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<GeoResult | null>(null);
  const [resolving, setResolving] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setResults([]);
      setPicked(null);
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
    }
  }, [visible]);

  const onSearch = (q: string) => {
    setQuery(q);
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (!q.trim() || q.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceTimer.current = setTimeout(async () => {
      const r = await searchPlaces(q);
      setResults(r);
      setSearching(false);
    }, 280);
  };

  const useMyLocation = async () => {
    try {
      setResolving(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setResolving(false);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const { latitude, longitude } = loc.coords;
      const address = await reverseGeocode(latitude, longitude);
      setPicked({ lat: latitude, lng: longitude, address });
    } catch {
      // ignore
    } finally {
      setResolving(false);
    }
  };

  const confirm = () => {
    if (!picked) return;
    onSelect(picked);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity testID="picker-close" onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={26} color={colors.obsidian} />
          </TouchableOpacity>
          <Text style={styles.title}>{title}</Text>
          <View style={{ width: 40 }} />
        </View>

        <View style={styles.searchBar}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            testID="picker-search"
            value={query}
            onChangeText={onSearch}
            placeholder="Search address or place"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
            autoCorrect={false}
            autoFocus
          />
          {searching && <ActivityIndicator color={colors.primary} size="small" />}
        </View>

        <FlatList
          data={results}
          keyExtractor={(it, idx) => `${it.lat}-${it.lng}-${idx}`}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={36} color={colors.textSecondary} />
              <Text style={styles.emptyText}>
                Type a place above, or tap "Use my location".
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const selected = picked && picked.address === item.address;
            return (
              <TouchableOpacity
                style={[styles.resultRow, selected ? styles.resultRowSelected : null]}
                onPress={() => setPicked(item)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={selected ? "checkmark-circle" : "location"}
                  size={18}
                  color={selected ? colors.success : colors.primary}
                />
                <Text style={styles.resultText} numberOfLines={2}>{item.address}</Text>
              </TouchableOpacity>
            );
          }}
        />

        <View style={styles.footer}>
          {picked ? (
            <View style={styles.addressRow}>
              <Ionicons name="pin" size={16} color={colors.primary} />
              <Text style={styles.addressText} numberOfLines={2}>{picked.address}</Text>
            </View>
          ) : null}
          <View style={styles.actionRow}>
            <TouchableOpacity
              testID="picker-locate-me"
              style={styles.outlineBtn}
              onPress={useMyLocation}
              disabled={resolving}
              activeOpacity={0.85}
            >
              {resolving ? (
                <ActivityIndicator color={colors.obsidian} size="small" />
              ) : (
                <>
                  <Ionicons name="locate" size={18} color={colors.obsidian} />
                  <Text style={styles.outlineText}>Use my location</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              testID="picker-confirm"
              style={[styles.primaryBtn, !picked && { opacity: 0.4 }]}
              onPress={confirm}
              disabled={!picked}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  closeBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 17, fontWeight: "800", color: colors.obsidian },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    margin: spacing.md,
    paddingHorizontal: spacing.md,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.obsidian },
  empty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  emptyText: { color: colors.textSecondary, textAlign: "center", fontSize: 14 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultRowSelected: { backgroundColor: "rgba(26,69,255,0.06)" },
  resultText: { flex: 1, fontSize: 14, color: colors.obsidian },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    gap: spacing.sm,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.sm,
    backgroundColor: colors.bg,
    borderRadius: radius.sm,
  },
  addressText: { flex: 1, color: colors.obsidian, fontSize: 14 },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  outlineBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.border,
  },
  outlineText: { color: colors.obsidian, fontWeight: "700", fontSize: 14 },
  primaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: radius.sm,
    alignItems: "center",
    backgroundColor: colors.primary,
  },
  primaryText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
