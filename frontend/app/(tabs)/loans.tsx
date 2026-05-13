import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/AuthContext';
import { useMode } from '../../lib/ModeContext';
import { api, Loan } from '../../lib/api';
import { getPrivateLoans, computeMetrics } from '../../lib/privateStorage';
import { LoanRow } from './index';
import { colors, spacing, radii, type } from '../../constants/theme';

type Filter = 'all' | 'active' | 'settled' | 'closed';

export default function Loans() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode } = useMode();
  const [filter, setFilter] = useState<Filter>('all');
  const [loans, setLoans] = useState<Loan[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const accent = mode === 'private' ? colors.brand.private : colors.brand.public;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      if (mode === 'public') {
        const r = await api.get('/loans');
        setLoans(r.data);
      } else {
        const priv = await getPrivateLoans(user.user_id);
        setLoans(priv.map(computeMetrics) as unknown as Loan[]);
      }
    } catch (e) {
      console.log('Loans load error', e);
    }
  }, [mode, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = loans.filter((l) => (filter === 'all' ? true : l.status === filter));

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.title}>{mode === 'private' ? 'Private loans' : 'Public loans'}</Text>
        <Text style={styles.subtitle}>{loans.length} total</Text>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={styles.tabsContent}
      >
        {(['all', 'active', 'settled', 'closed'] as Filter[]).map((f) => (
          <TouchableOpacity
            key={f}
            testID={`filter-${f}-button`}
            style={[styles.chip, filter === f && { backgroundColor: accent, borderColor: accent }]}
            onPress={() => setFilter(f)}
          >
            <Text style={[styles.chipText, filter === f && { color: '#fff' }]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.layout, paddingBottom: spacing.xxxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
      >
        {filtered.length === 0 ? (
          <View style={styles.empty} testID="loans-empty-state">
            <Text style={styles.emptyTitle}>No loans in this view</Text>
            <Text style={styles.emptySub}>Add a new loan or switch filter.</Text>
          </View>
        ) : (
          filtered.map((l) => (
            <LoanRow
              key={l.loan_id}
              loan={l}
              accent={accent}
              onPress={() => router.push(`/loan/${l.loan_id}?mode=${l.mode}`)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: { paddingHorizontal: spacing.layout, paddingTop: spacing.md, paddingBottom: spacing.md },
  title: { ...type.h1 },
  subtitle: { ...type.body, color: colors.text.tertiary, marginTop: 4 },
  tabs: { flexGrow: 0 },
  tabsContent: { paddingHorizontal: spacing.layout, paddingBottom: spacing.md, gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.ui.border,
    marginRight: spacing.sm,
    backgroundColor: colors.ui.surface,
  },
  chipText: { ...type.bodyMed, color: colors.text.secondary, fontSize: 13 },
  empty: { paddingVertical: spacing.xxl, alignItems: 'center' },
  emptyTitle: { ...type.h3, marginBottom: spacing.xs },
  emptySub: { ...type.body, color: colors.text.tertiary },
});
