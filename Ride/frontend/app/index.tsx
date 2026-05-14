import { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ImageBackground } from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../src/auth";
import { colors, spacing, radius } from "../src/theme";

const HERO =
  "https://images.unsplash.com/photo-1634402149804-67614eb48331?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwxfHxjaXR5JTIwbmlnaHQlMjB0cmFmZmljJTIwYmx1cnxlbnwwfHx8fDE3NzgwMTkxMzV8MA&ixlib=rb-4.1.0&q=85";

export default function Welcome() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user) {
      if (user.role === "rider") router.replace("/rider/home");
      else router.replace("/driver/home");
    }
  }, [user, router]);

  return (
    <View style={styles.root}>
      <ImageBackground source={{ uri: HERO }} style={styles.bg} resizeMode="cover">
        <LinearGradient
          colors={["rgba(10,10,10,0.55)", "rgba(10,10,10,0.85)", "#0A0A0A"]}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safe}>
          <View style={styles.top}>
            <Text testID="brand-logo" style={styles.brand}>Ride</Text>
            <View style={styles.tagline}>
              <View style={styles.tagDot} />
              <Text style={styles.tag}>$30 MXN/day · drivers keep 100%</Text>
            </View>
          </View>

          <View style={styles.middle}>
            <Text style={styles.kicker}>GO ANYWHERE</Text>
            <Text style={styles.title}>Get there.</Text>
            <Text style={styles.titleAlt}>Earn from it.</Text>
            <Text style={styles.subtitle}>
              The ride-hailing app where drivers pay a flat daily fee instead of giving up a cut of every fare.
            </Text>
          </View>

          <View style={styles.bottom}>
            <TouchableOpacity
              testID="cta-rider"
              style={styles.primaryBtn}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: "/register", params: { role: "rider" } })}
            >
              <Ionicons name="navigate" size={18} color="#0A0A0A" />
              <Text style={styles.primaryBtnText}>Ride with us</Text>
              <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>

            <TouchableOpacity
              testID="cta-driver"
              style={styles.secondaryBtn}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: "/register", params: { role: "driver" } })}
            >
              <Ionicons name="car-sport" size={18} color="#fff" />
              <Text style={styles.secondaryBtnText}>Drive with us</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </TouchableOpacity>

            <TouchableOpacity testID="link-login" onPress={() => router.push("/login")} style={styles.loginLink}>
              <Text style={styles.loginText}>
                Already have an account? <Text style={{ color: "#fff", fontWeight: "700" }}>Log in</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.obsidian },
  bg: { flex: 1 },
  safe: { flex: 1, justifyContent: "space-between", padding: spacing.lg, paddingBottom: spacing.xl },
  top: { paddingTop: spacing.md, gap: spacing.sm },
  brand: { fontSize: 44, fontWeight: "900", color: "#fff", letterSpacing: -1.5 },
  tagline: { flexDirection: "row", alignItems: "center", gap: 8 },
  tagDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#00C853" },
  tag: { color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: "600" },
  middle: { gap: 6 },
  kicker: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "800", letterSpacing: 2.5, marginBottom: spacing.sm },
  title: { fontSize: 56, fontWeight: "900", color: "#fff", lineHeight: 60, letterSpacing: -2.5 },
  titleAlt: { fontSize: 56, fontWeight: "900", color: "#FFD700", lineHeight: 60, letterSpacing: -2.5 },
  subtitle: { color: "rgba(255,255,255,0.78)", fontSize: 16, lineHeight: 23, marginTop: spacing.md, maxWidth: 360 },
  bottom: { gap: spacing.sm },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#fff",
    paddingVertical: 18,
    borderRadius: radius.sm,
  },
  primaryBtnText: { color: "#0A0A0A", fontSize: 17, fontWeight: "800", letterSpacing: 0.3, flex: 1, textAlign: "center" },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
    paddingVertical: 16,
    borderRadius: radius.sm,
  },
  secondaryBtnText: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.3, flex: 1, textAlign: "center" },
  loginLink: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.sm },
  loginText: { color: "rgba(255,255,255,0.65)", fontSize: 14 },
});
