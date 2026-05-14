import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api, formatApiError } from "./api";
import { colors, spacing, radius } from "./theme";

type Props = {
  visible: boolean;
  rideId: string | null;
  counterpartyName: string;
  onClose: () => void;
  onSubmitted: () => void;
};

export default function RatingModal({ visible, rideId, counterpartyName, onClose, onSubmitted }: Props) {
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!rideId) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post(`/rides/${rideId}/rate`, { score, comment: comment.trim() || undefined });
      setScore(5);
      setComment("");
      onSubmitted();
      onClose();
    } catch (e: any) {
      setError(formatApiError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="rating-modal" style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Rate {counterpartyName}</Text>
          <Text style={styles.sub}>How was your trip?</Text>

          <View style={styles.starsRow}>
            {[1, 2, 3, 4, 5].map((n) => (
              <TouchableOpacity
                key={n}
                testID={`star-${n}`}
                onPress={() => setScore(n)}
                activeOpacity={0.7}
                style={styles.starBtn}
              >
                <Ionicons
                  name={n <= score ? "star" : "star-outline"}
                  size={36}
                  color={n <= score ? colors.warning : colors.textSecondary}
                />
              </TouchableOpacity>
            ))}
          </View>

          <TextInput
            testID="rating-comment"
            style={styles.input}
            placeholder="Add a comment (optional)"
            placeholderTextColor="#9CA3AF"
            value={comment}
            onChangeText={setComment}
            multiline
            maxLength={240}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <TouchableOpacity
              testID="rating-cancel"
              style={[styles.btn, styles.btnGhost]}
              onPress={onClose}
              disabled={submitting}
            >
              <Text style={[styles.btnText, { color: colors.obsidian }]}>Skip</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="rating-submit"
              style={[styles.btn, styles.btnPrimary, submitting && { opacity: 0.7 }]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={[styles.btnText, { color: "#fff" }]}>Submit</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    alignSelf: "center",
    marginBottom: spacing.md,
  },
  title: { fontSize: 24, fontWeight: "800", color: colors.obsidian, letterSpacing: -0.5 },
  sub: { color: colors.textSecondary, marginTop: 4, marginBottom: spacing.lg },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm, marginBottom: spacing.lg },
  starBtn: { padding: 4 },
  input: {
    minHeight: 80,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    padding: spacing.md,
    fontSize: 15,
    color: colors.obsidian,
    textAlignVertical: "top",
  },
  error: { color: colors.danger, marginTop: spacing.sm, fontWeight: "600" },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  btn: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: radius.sm,
    alignItems: "center",
  },
  btnGhost: { borderWidth: 2, borderColor: colors.border, backgroundColor: colors.surface },
  btnPrimary: { backgroundColor: colors.primary },
  btnText: { fontSize: 16, fontWeight: "700" },
});
