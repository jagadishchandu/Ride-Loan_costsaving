import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Switch, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useMode } from '../../lib/ModeContext';
import { api, Loan } from '../../lib/api';
import { getPrivateLoans, computeMetrics } from '../../lib/privateStorage';
import { colors, spacing, radii, type, formatINR } from '../../constants/theme';
import { Bell, BellOff } from 'lucide-react-native';

export default function Reminders() {
  const { user } = useAuth();
  const { mode } = useMode();
  const [loans, setLoans] = useState<Loan[]>([]);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const accent = mode === 'private' ? colors.brand.private : colors.brand.public;

  useEffect(() => {
    (async () => {
      if (Platform.OS === 'web') return;
      const { status } = await Notifications.getPermissionsAsync();
      setNotifEnabled(status === 'granted');
    })();
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      if (mode === 'public') {
        const r = await api.get('/loans?status=active');
        setLoans(r.data);
      } else {
        const priv = await getPrivateLoans(user.user_id);
        setLoans(priv.filter((l) => l.status === 'active').map(computeMetrics) as unknown as Loan[]);
      }
    } catch {}
  }, [mode, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const requestPermission = async () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not supported', 'Notifications work on iOS/Android only.');
      return;
    }
    const { status } = await Notifications.requestPermissionsAsync();
    setNotifEnabled(status === 'granted');
    if (status === 'granted') {
      Alert.alert('Enabled', 'You will receive monthly loan reminders.');
    }
  };

  const reminderLoans = loans.filter((l) => l.reminder_enabled);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Reminders</Text>
        <Text style={styles.subtitle}>Monthly notifications for active loans</Text>

        <View style={styles.permCard}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 }}>
            {notifEnabled ? (
              <Bell size={22} color={accent} strokeWidth={1.8} />
            ) : (
              <BellOff size={22} color={colors.text.tertiary} strokeWidth={1.8} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.permTitle}>Device notifications</Text>
              <Text style={styles.permSub}>
                {notifEnabled ? 'Enabled — you will get monthly reminders' : 'Tap to enable monthly reminders'}
              </Text>
            </View>
          </View>
          <Switch
            testID="reminders-permission-switch"
            value={notifEnabled}
            onValueChange={requestPermission}
            trackColor={{ false: colors.ui.border, true: accent }}
            thumbColor="#fff"
          />
        </View>

        <Text style={styles.section}>Upcoming this month</Text>
        {reminderLoans.length === 0 ? (
          <View style={styles.empty} testID="reminders-empty-state">
            <Text style={styles.emptyTitle}>No upcoming reminders</Text>
            <Text style={styles.emptySub}>Enable reminders on active loans to see them here.</Text>
          </View>
        ) : (
          reminderLoans.map((l) => (
            <View key={l.loan_id} style={styles.row} testID={`reminder-row-${l.loan_id}`}>
              <View style={[styles.dot, { backgroundColor: accent }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{l.counterparty_name}</Text>
                <Text style={styles.rowSub}>Day {l.reminder_day} of every month</Text>
              </View>
              <Text style={styles.rowAmount}>{formatINR(l.monthly_interest)}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { padding: spacing.layout, paddingBottom: spacing.xxxl },
  title: { ...type.h1 },
  subtitle: { ...type.body, color: colors.text.tertiary, marginTop: 4, marginBottom: spacing.lg },
  permCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.ui.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.ui.border,
  },
  permTitle: { ...type.bodyMed, fontFamily: 'Manrope_600SemiBold' },
  permSub: { ...type.body, color: colors.text.tertiary, fontSize: 13, marginTop: 2 },
  section: { ...type.caption, marginTop: spacing.xl, marginBottom: spacing.md },
  empty: { paddingVertical: spacing.xl, alignItems: 'center' },
  emptyTitle: { ...type.h3, marginBottom: spacing.xs },
  emptySub: { ...type.body, color: colors.text.tertiary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.border,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowName: { ...type.bodyMed, fontFamily: 'Manrope_600SemiBold' },
  rowSub: { ...type.body, color: colors.text.tertiary, fontSize: 12, marginTop: 2 },
  rowAmount: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 14, color: colors.text.primary },
});
