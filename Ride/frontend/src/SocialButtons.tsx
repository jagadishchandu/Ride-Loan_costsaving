import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons, FontAwesome, MaterialCommunityIcons } from "@expo/vector-icons";
import { startGoogleAuth, startFacebookAuth, startMicrosoftAuth } from "./socialAuth";
import { colors, spacing, radius } from "./theme";

type Props = { role: "rider" | "driver" };

export default function SocialButtons({ role }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.divider}>
        <View style={styles.line} />
        <Text style={styles.dividerText}>or continue with</Text>
        <View style={styles.line} />
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          testID="google-login-btn"
          style={styles.btn}
          activeOpacity={0.8}
          onPress={() => startGoogleAuth(role)}
        >
          <Ionicons name="logo-google" size={20} color="#0A0A0A" />
          <Text style={styles.btnText}>Google</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="facebook-login-btn"
          style={styles.btn}
          activeOpacity={0.8}
          onPress={() => startFacebookAuth(role)}
        >
          <FontAwesome name="facebook" size={20} color="#1877F2" />
          <Text style={styles.btnText}>Facebook</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        testID="microsoft-login-btn"
        style={[styles.btn, styles.btnFull]}
        activeOpacity={0.8}
        onPress={() => startMicrosoftAuth(role)}
      >
        <MaterialCommunityIcons name="microsoft" size={20} color="#0078D4" />
        <Text style={styles.btnText}>Continue with Microsoft</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, marginTop: spacing.md },
  divider: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 },
  row: { flexDirection: "row", gap: spacing.sm },
  btn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  btnFull: { flex: 0 },
  btnText: { color: colors.obsidian, fontWeight: "700", fontSize: 15 },
});
