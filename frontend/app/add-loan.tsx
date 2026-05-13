import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { X, ArrowRight } from 'lucide-react-native';
import { useAuth } from '../lib/AuthContext';
import { useMode } from '../lib/ModeContext';
import { api } from '../lib/api';
import { addPrivateLoan, computeMetrics } from '../lib/privateStorage';
import { colors, spacing, radii, type, formatINR } from '../constants/theme';

export default function AddLoan() {
  const router = useRouter();
  const { user } = useAuth();
  const { mode } = useMode();
  const accent = mode === 'private' ? colors.brand.private : colors.brand.public;

  const [direction, setDirection] = useState<'lent' | 'borrowed'>('lent');
  const [counterpartyName, setCounterpartyName] = useState('');
  const [counterpartyEmail, setCounterpartyEmail] = useState('');
  const [counterpartyPhone, setCounterpartyPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('0');
  const [startDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [reminderEnabled, setReminderEnabled] = useState(true);
  const [reminderDay, setReminderDay] = useState('1');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const monthlyInterest = (() => {
    const p = parseFloat(amount) || 0;
    const r = parseFloat(interestRate) || 0;
    return +((p * r) / 1200).toFixed(2);
  })();

  const save = async () => {
    if (!counterpartyName.trim()) {
      Alert.alert('Missing info', 'Please enter the counterparty name.');
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      Alert.alert('Invalid amount', 'Please enter a valid principal amount.');
      return;
    }
    const rate = parseFloat(interestRate);
    if (isNaN(rate) || rate < 0 || rate > 100) {
      Alert.alert('Invalid rate', 'Interest rate must be 0-100% per year.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'public') {
        await api.post('/loans', {
          mode: 'public',
          counterparty_name: counterpartyName.trim(),
          counterparty_email: counterpartyEmail.trim() || undefined,
          counterparty_phone: counterpartyPhone.trim() || undefined,
          direction,
          principal_amount: amt,
          interest_rate: rate,
          start_date: startDate,
          due_date: dueDate || undefined,
          reminder_enabled: reminderEnabled,
          reminder_day: Math.max(1, Math.min(28, parseInt(reminderDay) || 1)),
          notes: notes.trim() || undefined,
        });
      } else {
        if (!user) throw new Error('Not authenticated');
        const loan = computeMetrics({
          loan_id: `priv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          mode: 'private',
          counterparty_name: counterpartyName.trim(),
          counterparty_email: counterpartyEmail.trim() || null,
          counterparty_phone: counterpartyPhone.trim() || null,
          direction,
          principal_amount: amt,
          interest_rate: rate,
          start_date: startDate,
          due_date: dueDate || null,
          reminder_enabled: reminderEnabled,
          reminder_day: Math.max(1, Math.min(28, parseInt(reminderDay) || 1)),
          notes: notes.trim() || null,
          status: 'active',
          monthly_interest: 0,
          accrued_interest: 0,
          total_due: 0,
          months_elapsed: 0,
        });
        await addPrivateLoan(user.user_id, loan);
      }
      router.back();
    } catch (e: any) {
      Alert.alert('Failed to save', e?.response?.data?.detail || e?.message || 'Try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity testID="add-loan-close-button" onPress={() => router.back()} style={styles.closeBtn}>
          <X size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <View style={[styles.modeBadge, { backgroundColor: accent }]}>
          <Text style={styles.modeBadgeText}>{mode.toUpperCase()}</Text>
        </View>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>New {mode} loan</Text>

          {/* Direction toggle */}
          <View style={styles.dirToggle}>
            <TouchableOpacity
              testID="direction-lent-button"
              style={[styles.dirBtn, direction === 'lent' && { backgroundColor: accent }]}
              onPress={() => setDirection('lent')}
            >
              <Text style={[styles.dirText, direction === 'lent' && { color: '#fff' }]}>I lent</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="direction-borrowed-button"
              style={[styles.dirBtn, direction === 'borrowed' && { backgroundColor: accent }]}
              onPress={() => setDirection('borrowed')}
            >
              <Text style={[styles.dirText, direction === 'borrowed' && { color: '#fff' }]}>I borrowed</Text>
            </TouchableOpacity>
          </View>

          {/* Amount */}
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountWrap}>
            <Text style={styles.amountSymbol}>₹</Text>
            <TextInput
              testID="add-loan-amount-input"
              style={styles.amountInput}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.text.tertiary}
            />
          </View>

          {/* Counterparty */}
          <Text style={styles.label}>{direction === 'lent' ? 'Borrower' : 'Lender'}</Text>
          <TextInput
            testID="add-loan-counterparty-name"
            style={styles.input}
            placeholder="Name"
            placeholderTextColor={colors.text.tertiary}
            value={counterpartyName}
            onChangeText={setCounterpartyName}
          />
          <TextInput
            testID="add-loan-counterparty-email"
            style={styles.input}
            placeholder="Email (optional)"
            placeholderTextColor={colors.text.tertiary}
            value={counterpartyEmail}
            onChangeText={setCounterpartyEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <TextInput
            testID="add-loan-counterparty-phone"
            style={styles.input}
            placeholder="Phone (optional)"
            placeholderTextColor={colors.text.tertiary}
            value={counterpartyPhone}
            onChangeText={setCounterpartyPhone}
            keyboardType="phone-pad"
          />

          {/* Interest */}
          <Text style={styles.label}>Interest rate (% per year)</Text>
          <TextInput
            testID="add-loan-interest-rate"
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.text.tertiary}
            value={interestRate}
            onChangeText={setInterestRate}
            keyboardType="decimal-pad"
          />

          {monthlyInterest > 0 && (
            <View style={[styles.infoBox, { borderColor: accent }]}>
              <Text style={styles.infoLabel}>Monthly interest</Text>
              <Text style={[styles.infoValue, { color: accent }]}>{formatINR(monthlyInterest)}</Text>
            </View>
          )}

          {/* Start date */}
          <Text style={styles.label}>Start date</Text>
          <View style={styles.input}><Text style={{ color: colors.text.primary }}>{startDate}</Text></View>

          {/* Due date */}
          <Text style={styles.label}>Due date (optional, YYYY-MM-DD)</Text>
          <TextInput
            testID="add-loan-due-date"
            style={styles.input}
            placeholder="e.g. 2026-12-31"
            placeholderTextColor={colors.text.tertiary}
            value={dueDate}
            onChangeText={setDueDate}
            autoCapitalize="none"
          />

          {/* Reminders */}
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Monthly reminder</Text>
              <Text style={styles.helper}>Get a reminder on day {reminderDay} every month.</Text>
            </View>
            <Switch
              testID="add-loan-reminder-switch"
              value={reminderEnabled}
              onValueChange={setReminderEnabled}
              trackColor={{ false: colors.ui.border, true: accent }}
              thumbColor="#fff"
            />
          </View>
          {reminderEnabled && (
            <TextInput
              testID="add-loan-reminder-day"
              style={styles.input}
              placeholder="Day of month (1-28)"
              placeholderTextColor={colors.text.tertiary}
              value={reminderDay}
              onChangeText={setReminderDay}
              keyboardType="number-pad"
            />
          )}

          {/* Notes */}
          <Text style={styles.label}>Notes</Text>
          <TextInput
            testID="add-loan-notes"
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top', paddingTop: spacing.md }]}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.text.tertiary}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity
            testID="add-loan-save-button"
            style={[styles.saveBtn, { backgroundColor: accent }]}
            onPress={save}
            disabled={saving}
          >
            {saving ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.saveBtnText}>Save loan</Text>
                <ArrowRight size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg.primary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.layout,
    paddingVertical: spacing.md,
  },
  closeBtn: { padding: 6 },
  modeBadge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill },
  modeBadgeText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 1 },
  scroll: { padding: spacing.layout, paddingBottom: spacing.xxxl },
  title: { ...type.h1, marginBottom: spacing.lg },
  dirToggle: { flexDirection: 'row', backgroundColor: colors.bg.secondary, borderRadius: radii.pill, padding: 4, marginBottom: spacing.lg },
  dirBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: radii.pill },
  dirText: { ...type.bodyMed, color: colors.text.secondary, fontFamily: 'Manrope_600SemiBold' },
  label: { ...type.caption, marginTop: spacing.md, marginBottom: spacing.sm },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.secondary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    minHeight: 88,
  },
  amountSymbol: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 36, color: colors.text.primary, marginRight: spacing.sm },
  amountInput: { flex: 1, fontFamily: 'IBMPlexMono_700Bold', fontSize: 48, color: colors.text.primary, padding: 0 },
  input: {
    backgroundColor: colors.bg.secondary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontFamily: 'WorkSans_400Regular',
    fontSize: 15,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  infoBox: { borderWidth: 1, borderRadius: radii.md, padding: spacing.md, marginTop: spacing.sm, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  infoLabel: { ...type.caption },
  infoValue: { fontFamily: 'IBMPlexMono_700Bold', fontSize: 20 },
  switchRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, gap: spacing.md },
  helper: { ...type.body, color: colors.text.tertiary, fontSize: 12 },
  saveBtn: {
    borderRadius: radii.pill,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  saveBtnText: { color: '#fff', fontFamily: 'Manrope_700Bold', fontSize: 17 },
});
