import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, Crown, Check } from 'lucide-react-native';
import { useAuth } from '../lib/AuthContext';
import { api } from '../lib/api';
import { colors, spacing, radii, type } from '../constants/theme';

type Plan = { id: string; name: string; price_inr: number; features: string[] };
type PaymentMethod = 'phonepe' | 'google_play' | 'paypal';

export default function Subscription() {
  const router = useRouter();
  const { user, refreshUser } = useAuth();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selectedTier, setSelectedTier] = useState<'private' | 'public'>('public');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/subscription/plans').then((r) => setPlans(r.data)).catch(() => {});
  }, []);

  const currentTier = user?.subscription_tier || 'free';

  const subscribe = async (method: PaymentMethod) => {
    setLoading(true);
    try {
      const r = await api.post('/subscription/subscribe', { tier: selectedTier, payment_method: method });
      await refreshUser();
      Alert.alert(
        'Subscription activated 🎉',
        `${r.data.tier === 'public' ? 'Public Pro' : 'Private Pro'} active until ${new Date(r.data.expires_at).toLocaleDateString()}.\n\n${r.data.message}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Subscription failed', e?.response?.data?.detail || 'Try again');
    } finally {
      setLoading(false);
    }
  };

  const onSubscribe = () => {
    Alert.alert(
      'Choose payment method',
      `Subscribe to ${selectedTier === 'public' ? 'Public Pro (₹90/mo)' : 'Private Pro (₹10/mo)'}\n\n(Note: payments are MOCKED in MVP)`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'PhonePe', onPress: () => subscribe('phonepe') },
        { text: 'Google Play', onPress: () => subscribe('google_play') },
        { text: 'PayPal', onPress: () => subscribe('paypal') },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ImageBackground
        source={{ uri: 'https://images.unsplash.com/photo-1594896733292-9a77b5809c63?crop=entropy&cs=srgb&fm=jpg&q=85&w=800' }}
        blurRadius={20}
        style={styles.bgImage}
      >
        <View style={styles.overlay}>
          <View style={styles.header}>
            <TouchableOpacity testID="subscription-close-button" onPress={() => router.back()}>
              <X size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Premium</Text>
            <View style={{ width: 24 }} />
          </View>

          <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.crownWrap}>
              <Crown size={48} color={colors.brand.accent} strokeWidth={1.4} />
            </View>
            <Text style={styles.title}>Unlock LendSplit Pro</Text>
            <Text style={styles.subtitle}>Currently on: {currentTier === 'free' ? 'Free' : currentTier === 'private' ? 'Private Pro' : 'Public Pro'}</Text>

            <View style={styles.planSwitch}>
              <TouchableOpacity
                testID="plan-private-button"
                style={[styles.planTab, selectedTier === 'private' && styles.planTabActive]}
                onPress={() => setSelectedTier('private')}
              >
                <Text style={[styles.planTabText, selectedTier === 'private' && { color: colors.text.primary }]}>Private ₹10/mo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="plan-public-button"
                style={[styles.planTab, selectedTier === 'public' && styles.planTabActive]}
                onPress={() => setSelectedTier('public')}
              >
                <Text style={[styles.planTabText, selectedTier === 'public' && { color: colors.text.primary }]}>Public ₹90/mo</Text>
              </TouchableOpacity>
            </View>

            {plans
              .filter((p) => p.id === selectedTier)
              .map((p) => (
                <View key={p.id} style={styles.planCard}>
                  <Text style={styles.planName}>{p.name}</Text>
                  <Text style={styles.planPrice}>
                    ₹{p.price_inr}
                    <Text style={styles.planPriceUnit}>/month</Text>
                  </Text>
                  {p.features.map((f) => (
                    <View key={f} style={styles.featureRow}>
                      <Check size={18} color={colors.brand.accent} />
                      <Text style={styles.featureText}>{f}</Text>
                    </View>
                  ))}
                </View>
              ))}

            <TouchableOpacity
              testID="subscribe-button"
              style={styles.ctaBtn}
              onPress={onSubscribe}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#1A2E25" />
              ) : (
                <Text style={styles.ctaText}>Subscribe • ₹{selectedTier === 'public' ? 90 : 10}/mo</Text>
              )}
            </TouchableOpacity>

            <Text style={styles.disclaimer}>
              Payments via PhonePe, Google Play or PayPal. Cancel anytime.{'\n'}
              <Text style={{ fontFamily: 'Manrope_700Bold' }}>MVP note: payments are MOCKED for testing.</Text>
            </Text>
          </ScrollView>
        </View>
      </ImageBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#1A2E25' },
  bgImage: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(26, 46, 37, 0.85)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.layout, paddingVertical: spacing.md },
  headerTitle: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 16, letterSpacing: 1 },
  scroll: { padding: spacing.layout, paddingBottom: spacing.xxxl, alignItems: 'center' },
  crownWrap: { width: 96, height: 96, borderRadius: 48, backgroundColor: 'rgba(232,163,101,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg },
  title: { color: '#fff', fontFamily: 'Manrope_800ExtraBold', fontSize: 28, textAlign: 'center', marginBottom: spacing.sm },
  subtitle: { color: 'rgba(255,255,255,0.7)', ...type.body, marginBottom: spacing.xl },
  planSwitch: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radii.pill, padding: 4, marginBottom: spacing.lg },
  planTab: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radii.pill },
  planTabActive: { backgroundColor: colors.brand.accent },
  planTabText: { color: 'rgba(255,255,255,0.85)', fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  planCard: { width: '100%', backgroundColor: colors.ui.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.lg },
  planName: { ...type.caption, color: colors.brand.accent, marginBottom: spacing.xs },
  planPrice: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 44, color: colors.text.primary, marginBottom: spacing.lg },
  planPriceUnit: { fontFamily: 'WorkSans_400Regular', fontSize: 14, color: colors.text.tertiary },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  featureText: { ...type.body, color: colors.text.primary, flex: 1 },
  ctaBtn: { width: '100%', backgroundColor: colors.brand.accent, borderRadius: radii.pill, paddingVertical: 18, alignItems: 'center' },
  ctaText: { color: '#1A2E25', fontFamily: 'Manrope_800ExtraBold', fontSize: 16 },
  disclaimer: { color: 'rgba(255,255,255,0.65)', ...type.body, fontSize: 12, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
