import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, shadow } from "./theme";

interface RideRequestData {
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
}

interface RideRequestModalProps {
  visible: boolean;
  rideData: RideRequestData | null;
  onAccept: (rideId: string) => Promise<void>;
  onDismiss: () => void;
  expiresInSeconds?: number;  // Auto-dismiss after this time
}

export default function RideRequestModal({
  visible,
  rideData,
  onAccept,
  onDismiss,
  expiresInSeconds = 30,
}: RideRequestModalProps) {
  const [accepting, setAccepting] = useState(false);
  const [countdown, setCountdown] = useState(expiresInSeconds);
  const [progress] = useState(new Animated.Value(1));

  // Countdown timer
  useEffect(() => {
    if (!visible) {
      setCountdown(expiresInSeconds);
      progress.setValue(1);
      return;
    }

    setCountdown(expiresInSeconds);
    
    // Animate progress bar
    Animated.timing(progress, {
      toValue: 0,
      duration: expiresInSeconds * 1000,
      useNativeDriver: false,
    }).start();

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [visible, expiresInSeconds, onDismiss, progress]);

  const handleAccept = async () => {
    if (!rideData || accepting) return;
    setAccepting(true);
    try {
      await onAccept(rideData.ride_id);
    } finally {
      setAccepting(false);
    }
  };

  if (!rideData) return null;

  const {
    pickup_address,
    dropoff_address,
    estimated_fare,
    distance_km,
    duration_min,
    currency,
    rider_name,
  } = rideData;

  const progressWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Progress bar */}
          <View style={styles.progressBar}>
            <Animated.View
              style={[
                styles.progressFill,
                { width: progressWidth },
              ]}
            />
          </View>

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name="car" size={28} color={colors.primary} />
            </View>
            <Text style={styles.headerTitle}>New Ride Request!</Text>
            <Text style={styles.countdown}>{countdown}s</Text>
          </View>

          {/* Rider info */}
          <View style={styles.riderInfo}>
            <Ionicons name="person" size={20} color={colors.textSecondary} />
            <Text style={styles.riderName}>{rider_name}</Text>
          </View>

          {/* Route info */}
          <View style={styles.routeCard}>
            {/* Pickup */}
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: colors.success }]} />
              <View style={styles.routeTextContainer}>
                <Text style={styles.routeLabel}>PICKUP</Text>
                <Text style={styles.routeAddress} numberOfLines={2}>
                  {pickup_address}
                </Text>
              </View>
            </View>

            {/* Connector line */}
            <View style={styles.connector} />

            {/* Dropoff */}
            <View style={styles.routeRow}>
              <View style={[styles.dot, { backgroundColor: colors.danger }]} />
              <View style={styles.routeTextContainer}>
                <Text style={styles.routeLabel}>DROPOFF</Text>
                <Text style={styles.routeAddress} numberOfLines={2}>
                  {dropoff_address}
                </Text>
              </View>
            </View>
          </View>

          {/* Trip details */}
          <View style={styles.detailsRow}>
            {distance_km != null && (
              <View style={styles.detailItem}>
                <Ionicons name="navigate" size={18} color={colors.primary} />
                <Text style={styles.detailValue}>{distance_km.toFixed(1)} km</Text>
              </View>
            )}
            {duration_min != null && (
              <View style={styles.detailItem}>
                <Ionicons name="time" size={18} color={colors.warning} />
                <Text style={styles.detailValue}>{Math.round(duration_min)} min</Text>
              </View>
            )}
            <View style={[styles.detailItem, styles.fareItem]}>
              <Text style={styles.fareLabel}>YOU EARN</Text>
              <Text style={styles.fareValue}>
                ${estimated_fare.toFixed(2)} {currency}
              </Text>
            </View>
          </View>

          {/* Action buttons */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.rejectBtn}
              onPress={onDismiss}
              disabled={accepting}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color={colors.danger} />
              <Text style={styles.rejectText}>Skip</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.acceptBtn, accepting && styles.acceptBtnDisabled]}
              onPress={handleAccept}
              disabled={accepting}
              activeOpacity={0.8}
            >
              {accepting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark" size={24} color="#fff" />
                  <Text style={styles.acceptText}>Accept Ride</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "flex-end",
  },
  container: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    ...shadow.card,
  },
  progressBar: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.primary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primaryLight,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: "800",
    color: colors.obsidian,
  },
  countdown: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textSecondary,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  riderInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  riderName: {
    fontSize: 16,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  routeCard: {
    backgroundColor: colors.bg,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  routeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 4,
  },
  connector: {
    width: 2,
    height: 24,
    backgroundColor: colors.border,
    marginLeft: 5,
    marginVertical: spacing.xs,
  },
  routeTextContainer: {
    flex: 1,
  },
  routeLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  routeAddress: {
    fontSize: 15,
    color: colors.obsidian,
    fontWeight: "500",
    lineHeight: 20,
  },
  detailsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    gap: spacing.sm,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.obsidian,
  },
  fareItem: {
    flexDirection: "column",
    alignItems: "flex-end",
    backgroundColor: "rgba(0, 200, 83, 0.1)",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  fareLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: colors.success,
  },
  fareValue: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.success,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.md,
  },
  rejectBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: "rgba(255, 59, 48, 0.08)",
  },
  rejectText: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.danger,
  },
  acceptBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.success,
  },
  acceptBtnDisabled: {
    opacity: 0.7,
  },
  acceptText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#fff",
  },
});
