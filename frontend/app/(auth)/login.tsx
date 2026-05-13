import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { Mail, Lock, ArrowRight } from 'lucide-react-native';
import { useAuth } from '../../lib/AuthContext';
import { colors, spacing, radii, type } from '../../constants/theme';

export default function Login() {
  const router = useRouter();
  const { signIn, signInWithGoogleSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const onLogin = async () => {
    if (!email || !password) {
      Alert.alert('Missing fields', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      await signIn(email.trim().toLowerCase(), password);
    } catch (e: any) {
      Alert.alert('Login failed', e?.response?.data?.detail || 'Please check your credentials');
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      const redirectUrl = Platform.OS === 'web'
        ? (typeof window !== 'undefined' ? window.location.origin + '/(auth)/login' : '')
        : Linking.createURL('auth');
      const authUrl = `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;

      if (Platform.OS === 'web') {
        window.location.href = authUrl;
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type !== 'success' || !result.url) {
        setGoogleLoading(false);
        return;
      }
      // Parse session_id from result.url
      const url = result.url;
      const hashMatch = url.match(/[#?&]session_id=([^&]+)/);
      const sessionId = hashMatch ? decodeURIComponent(hashMatch[1]) : null;
      if (!sessionId) {
        Alert.alert('Google sign-in failed', 'No session returned');
        setGoogleLoading(false);
        return;
      }
      await signInWithGoogleSession(sessionId);
    } catch (e: any) {
      Alert.alert('Google sign-in failed', e?.message || 'Try again');
    } finally {
      setGoogleLoading(false);
    }
  };

  // Web: handle redirect-back session_id on mount
  React.useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    const m = (hash + search).match(/[#?&]session_id=([^&]+)/);
    if (m && m[1]) {
      const sid = decodeURIComponent(m[1]);
      window.history.replaceState(null, '', window.location.pathname);
      setGoogleLoading(true);
      signInWithGoogleSession(sid)
        .catch((e) => Alert.alert('Google sign-in failed', e?.response?.data?.detail || 'Try again'))
        .finally(() => setGoogleLoading(false));
    }
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoRow}>
            <View style={styles.logoMark} />
            <Text style={styles.brand}>LendSplit</Text>
          </View>

          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>Track loans privately or share with the borrower.</Text>

          <View style={styles.field}>
            <Mail size={18} color={colors.text.tertiary} />
            <TextInput
              testID="login-email-input"
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.text.tertiary}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />
          </View>

          <View style={styles.field}>
            <Lock size={18} color={colors.text.tertiary} />
            <TextInput
              testID="login-password-input"
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.text.tertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            testID="login-submit-button"
            style={styles.primaryBtn}
            onPress={onLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Sign in</Text>
                <ArrowRight size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>OR</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity
            testID="login-google-button"
            style={styles.googleBtn}
            onPress={onGoogle}
            disabled={googleLoading}
          >
            {googleLoading ? (
              <ActivityIndicator color={colors.text.primary} />
            ) : (
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity testID="goto-signup-link" onPress={() => router.push('/(auth)/signup')} style={{ marginTop: spacing.xl }}>
            <Text style={styles.linkText}>
              Don&apos;t have an account? <Text style={styles.linkBold}>Sign up</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { padding: spacing.layout, paddingTop: spacing.xl, flexGrow: 1 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xxl },
  logoMark: { width: 28, height: 28, borderRadius: 8, backgroundColor: colors.brand.public },
  brand: { ...type.h3, color: colors.text.primary },
  title: { ...type.h1, marginBottom: spacing.sm },
  subtitle: { ...type.bodyLarge, color: colors.text.secondary, marginBottom: spacing.xl },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.bg.secondary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
    height: 56,
  },
  input: { flex: 1, ...type.body, height: 56 },
  primaryBtn: {
    backgroundColor: colors.brand.public,
    borderRadius: radii.pill,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  primaryBtnText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 17 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg },
  line: { flex: 1, height: 1, backgroundColor: colors.ui.border },
  dividerText: { ...type.caption, marginHorizontal: spacing.md },
  googleBtn: {
    borderWidth: 1,
    borderColor: colors.text.primary,
    borderRadius: radii.pill,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleBtnText: { ...type.bodyMed, color: colors.text.primary, fontFamily: 'Manrope_600SemiBold' },
  linkText: { ...type.body, textAlign: 'center', color: colors.text.secondary },
  linkBold: { color: colors.brand.public, fontFamily: 'Manrope_700Bold' },
});
