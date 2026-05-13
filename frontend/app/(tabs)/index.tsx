import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { TrendingUp, TrendingDown, Wallet, AlertCircle, Sparkles } from 'lucide-react-native';
import { useAuth } from '../../lib/AuthContext';
import { useMode } from '../../lib/ModeContext';
import { api, Loan } from '../../lib/api';
import { getPrivateLoans, computeMetrics } from '../../lib/privateStorage';
import { colors, spacing, radii, type, formatINR, shadow } from '../../constants/theme';

type Summary = {
  total_lent: number;
  total_borrowed: number;
  total_outstanding: number;
  monthly_interest_expected: number;
  active_loans: number;
  overdue_loans: number;
  settled_loans: number;
  total_loans: number;
};

const ZERO_SUMMARY: Summary = {
  total_lent: 0, total_borrowed: 0, total_outstanding: 0, monthly_interest_expected: 0,
  active_loans: 0, overdue_loans: 0, settled_loans: 0, total_loans: 0,
};

export default function Home() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode, setMode } = useMode();
  const [summary, setSummary] = useState<Summary>(ZERO_SUMMARY);
  const [recent, setRecent] = useState<Loan[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const accent = mode === 'private' ? colors.brand.private : colors.brand.public;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      if (mode === 'public') {
        const [sum, loans] = await Promise.all([
          api.get('/dashboard/summary').then((r) => r.data),
          api.get('/loans').then((r) => r.data),
        ]);
        setSummary(sum);
        setRecent(loans.slice(0, 5));
      } else {
        const priv = await getPrivateLoans(user.user_id);
        const withMetrics = priv.map(computeMetrics);
        let total_lent = 0,
          total_borrowed = 0,
          total_outstanding = 0,
          monthly_interest_expected = 0,
          active_loans = 0,
          overdue_loans = 0,
          settled_loans = 0;
        for (const l of withMetrics) {
          if (l.direction === 'borrowed') total_borrowed += l.principal_amount;
          else total_lent += l.principal_amount;
          if (l.status === 'active') {
            active_loans += 1;
            total_outstanding += l.total_due;
            monthly_interest_expected += l.monthly_interest;
            if (l.is_overdue) overdue_loans += 1;
          } else if (l.status === 'settled') settled_loans += 1;
        }
        setSummary({
          total_lent: +total_lent.toFixed(2),
          total_borrowed: +total_borrowed.toFixed(2),
          total_outstanding: +total_outstanding.toFixed(2),
          monthly_interest_expected: +monthly_interest_expected.toFixed(2),
          active_loans, overdue_loans, settled_loans, total_loans: withMetrics.length,
        });
        setRecent(withMetrics.slice(0, 5) as unknown as Loan[]);
      }
    } catch (e) {
      console.log('Home load error', e);
    }
  }, [mode, user]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={accent} />}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.greeting}>Hello, {user?.name?.split(' ')[0] || 'there'}</Text>
            <Text style={styles.subgreet}>Track your loans, your way</Text>
          </View>
          <View style={[styles.avatar, { backgroundColor: accent }]}>
            <Text style={styles.avatarText}>{(user?.name || 'U').charAt(0).toUpperCase()}</Text>
          </View>
        </View>

        {/* Mode toggle */}
        <View style={styles.toggleWrap} testID="mode-toggle">
          <TouchableOpacity
            testID="mode-public-button"
            style={[styles.toggleBtn, mode === 'public' && { backgroundColor: colors.brand.public }]}
            onPress={() => setMode('public')}
          >
            <Text style={[styles.toggleText, mode === 'public' && styles.toggleTextActive]}>Public</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="mode-private-button"
            style={[styles.toggleBtn, mode === 'private' && { backgroundColor: colors.brand.private }]}
            onPress={() => setMode('private')}
          >
            <Text style={[styles.toggleText, mode === 'private' && styles.toggleTextActive]}>Private</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.modeHint}>
          {mode === 'public'
            ? 'Cloud-stored. Visible to counterparties when linked.'
            : 'Stored only on this device. Just for your eyes.'}
        </Text>

        {/* Hero card - Outstanding */}
        <View style={[styles.hero, { backgroundColor: accent }]} testID="dashboard-hero-card">
          <Text style={styles.heroLabel}>Total outstanding</Text>
          <Text style={styles.heroAmount} testID="dashboard-total-outstanding">{formatINR(summary.total_outstanding)}</Text>
          <View style={styles.heroRow}>
            <View style={styles.heroChip}>
              <TrendingUp size={14} color="#fff" />
              <Text style={styles.heroChipText}>Lent {formatINR(summary.total_lent)}</Text>
            </View>
            <View style={styles.heroChip}>
              <TrendingDown size={14} color="#fff" />
              <Text style={styles.heroChipText}>Borrowed {formatINR(summary.total_borrowed)}</Text>
            </View>
          </View>
        </View>

        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard} testID="stat-monthly-interest">
            <Wallet size={18} color={colors.brand.public} strokeWidth={1.8} />
            <Text style={styles.statLabel}>Monthly interest</Text>
            <Text style={styles.statValue}>{formatINR(summary.monthly_interest_expected)}</Text>
          </View>
          <View style={styles.statCard} testID="stat-active-loans">
            <Sparkles size={18} color={colors.brand.public} strokeWidth={1.8} />
            <Text style={styles.statLabel}>Active loans</Text>
            <Text style={styles.statValue}>{summary.active_loans}</Text>
          </View>
        </View>

        {summary.overdue_loans > 0 && (
          <View style={styles.overdueCard}>
            <AlertCircle size={18} color={colors.status.overdue} />
            <Text style={styles.overdueText}>
              {summary.overdue_loans} overdue loan{summary.overdue_loans > 1 ? 's' : ''} — follow up now
            </Text>
          </View>
        )}

        {/* Recent loans */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Recent loans</Text>
          <TouchableOpacity testID="see-all-loans-link" onPress={() => router.push('/(tabs)/loans')}>
            <Text style={[styles.linkBold, { color: accent }]}>See all</Text>
          </TouchableOpacity>
        </View>

        {recent.length === 0 ? (
          <View style={styles.empty} testID="dashboard-empty-state">
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1691430754878-e7a05db7f1be?crop=entropy&cs=srgb&fm=jpg&q=85&w=400' }}
              style={styles.emptyImg}
            />
            <Text style={styles.emptyTitle}>No loans yet</Text>
            <Text style={styles.emptySub}>Tap the + button to record your first loan.</Text>
            <TouchableOpacity
              testID="empty-add-loan-button"
              style={[styles.primaryBtn, { backgroundColor: accent }]}
              onPress={() => router.push('/add-loan')}
            >
              <Text style={styles.primaryBtnText}>Add a loan</Text>
            </TouchableOpacity>
          </View>
        ) : (
          recent.map((l) => (
            <LoanRow key={l.loan_id} loan={l} accent={accent} onPress={() => router.push(`/loan/${l.loan_id}?mode=${l.mode}`)} />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export function LoanRow({ loan, accent, onPress }: { loan: any; accent: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      testID={`loan-row-${loan.loan_id}`}
      style={styles.loanRow}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.loanAvatar, { backgroundColor: loan.mode === 'private' ? colors.brand.private : colors.brand.public }]}>
        <Text style={styles.loanAvatarText}>{(loan.counterparty_name || 'U').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.loanName} numberOfLines={1}>{loan.counterparty_name}</Text>
        <Text style={styles.loanSub}>
          {loan.direction === 'lent' ? 'You lent' : 'You borrowed'} • {loan.interest_rate}% p.a. • {loan.mode}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[styles.loanAmount, { color: loan.direction === 'lent' ? colors.status.settled : colors.status.overdue }]}>
          {formatINR(loan.total_due)}
        </Text>
        <Text style={styles.loanStatus}>{loan.is_overdue ? 'Overdue' : loan.status}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  scroll: { padding: spacing.layout, paddingBottom: spacing.xxxl },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  greeting: { ...type.h2 },
  subgreet: { ...type.body, color: colors.text.secondary, marginTop: 2 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 18 },
  toggleWrap: {
    flexDirection: 'row',
    backgroundColor: colors.bg.secondary,
    borderRadius: radii.pill,
    padding: 4,
    marginBottom: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: radii.pill,
  },
  toggleText: { ...type.bodyMed, color: colors.text.secondary, fontFamily: 'Manrope_600SemiBold' },
  toggleTextActive: { color: '#fff' },
  modeHint: { ...type.body, color: colors.text.tertiary, fontSize: 13, marginBottom: spacing.lg },
  hero: {
    padding: spacing.lg,
    borderRadius: radii.lg,
    marginBottom: spacing.md,
    ...shadow.card,
  },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontFamily: 'WorkSans_500Medium', fontSize: 13, letterSpacing: 0.5, textTransform: 'uppercase' },
  heroAmount: { color: '#fff', fontFamily: 'IBMPlexMono_700Bold', fontSize: 40, letterSpacing: -1, marginTop: spacing.sm },
  heroRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' },
  heroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radii.pill,
  },
  heroChipText: { color: '#fff', fontFamily: 'WorkSans_500Medium', fontSize: 12 },
  statsGrid: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  statCard: {
    flex: 1,
    backgroundColor: colors.ui.surface,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.ui.border,
    gap: spacing.sm,
  },
  statLabel: { ...type.caption, color: colors.text.tertiary },
  statValue: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 22, color: colors.text.primary, letterSpacing: -0.5 },
  overdueCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: '#FCE9E9',
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
  },
  overdueText: { ...type.bodyMed, color: colors.status.overdue, flex: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { ...type.h3 },
  linkBold: { fontFamily: 'Manrope_700Bold', fontSize: 14 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyImg: { width: 120, height: 120, borderRadius: 60, marginBottom: spacing.md },
  emptyTitle: { ...type.h3, marginBottom: spacing.xs },
  emptySub: { ...type.body, color: colors.text.secondary, textAlign: 'center', marginBottom: spacing.lg },
  primaryBtn: { paddingHorizontal: spacing.xl, paddingVertical: 14, borderRadius: radii.pill },
  primaryBtnText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 15 },
  loanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.ui.border,
  },
  loanAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  loanAvatarText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 16 },
  loanName: { ...type.bodyMed, fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  loanSub: { ...type.body, color: colors.text.tertiary, fontSize: 12, marginTop: 2 },
  loanAmount: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 16 },
  loanStatus: { ...type.caption, color: colors.text.tertiary, fontSize: 10 },
});
