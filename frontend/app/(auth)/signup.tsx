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
import { Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react-native';
import { useAuth } from '../../lib/AuthContext';
import { colors, spacing, radii, type } from '../../constants/theme';

export default function Signup() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const onSignup = async () => {
    if (!name || !email || !password) {
      Alert.alert('Missing fields', 'Please fill in all fields.');
      return;
    }
    if (password.length < 6) {
      Alert.alert('Weak password', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    try {
      await signUp(email.trim().toLowerCase(), password, name);
    } catch (e: any) {
      Alert.alert('Signup failed', e?.response?.data?.detail || 'Please try again');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.logoRow}>
            <View style={styles.logoMark} />
            <Text style={styles.brand}>LendSplit</Text>
          </View>

          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Start tracking loans with auto interest & reminders.</Text>

          <View style={styles.field}>
            <UserIcon size={18} color={colors.text.tertiary} />
            <TextInput
              testID="signup-name-input"
              style={styles.input}
              placeholder="Full name"
              placeholderTextColor={colors.text.tertiary}
              value={name}
              onChangeText={setName}
            />
          </View>

          <View style={styles.field}>
            <Mail size={18} color={colors.text.tertiary} />
            <TextInput
              testID="signup-email-input"
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
              testID="signup-password-input"
              style={styles.input}
              placeholder="Password (min 6 chars)"
              placeholderTextColor={colors.text.tertiary}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
          </View>

          <TouchableOpacity
            testID="signup-submit-button"
            style={styles.primaryBtn}
            onPress={onSignup}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.primaryBtnText}>Create account</Text>
                <ArrowRight size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity testID="goto-login-link" onPress={() => router.replace('/(auth)/login')} style={{ marginTop: spacing.xl }}>
            <Text style={styles.linkText}>
              Already have an account? <Text style={styles.linkBold}>Sign in</Text>
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
  linkText: { ...type.body, textAlign: 'center', color: colors.text.secondary },
  linkBold: { color: colors.brand.public, fontFamily: 'Manrope_700Bold' },
});
