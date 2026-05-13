// Local storage for PRIVATE mode loans (device-only).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Loan } from './api';

const KEY_PREFIX = 'lendsplit_private_loans_';

export type PrivateLoan = Omit<Loan, 'owner_user_id'> & { owner_user_id?: string };

function key(userId: string) {
  return `${KEY_PREFIX}${userId}`;
}

export async function getPrivateLoans(userId: string): Promise<PrivateLoan[]> {
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    if (!raw) return [];
    return JSON.parse(raw) as PrivateLoan[];
  } catch {
    return [];
  }
}

export async function savePrivateLoans(userId: string, loans: PrivateLoan[]) {
  await AsyncStorage.setItem(key(userId), JSON.stringify(loans));
}

export async function addPrivateLoan(userId: string, loan: PrivateLoan) {
  const all = await getPrivateLoans(userId);
  all.unshift(loan);
  await savePrivateLoans(userId, all);
}

export async function updatePrivateLoan(userId: string, loanId: string, patch: Partial<PrivateLoan>) {
  const all = await getPrivateLoans(userId);
  const idx = all.findIndex((l) => l.loan_id === loanId);
  if (idx >= 0) {
    all[idx] = { ...all[idx], ...patch, updated_at: new Date().toISOString() };
    await savePrivateLoans(userId, all);
    return all[idx];
  }
  return null;
}

export async function deletePrivateLoan(userId: string, loanId: string) {
  const all = await getPrivateLoans(userId);
  const filtered = all.filter((l) => l.loan_id !== loanId);
  await savePrivateLoans(userId, filtered);
}

export async function getPrivateLoan(userId: string, loanId: string): Promise<PrivateLoan | null> {
  const all = await getPrivateLoans(userId);
  return all.find((l) => l.loan_id === loanId) ?? null;
}

// Compute interest metrics client-side for private loans
export function computeMetrics(loan: PrivateLoan): PrivateLoan {
  const principal = Number(loan.principal_amount) || 0;
  const rate = Number(loan.interest_rate) || 0;
  let start = new Date(loan.start_date);
  if (isNaN(start.getTime())) start = new Date();
  const now = new Date();
  const months = Math.max(0, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()));
  const monthly_interest = Math.round((principal * rate) / 12) / 100 ? Math.round((principal * rate) / 1200 * 100) / 100 : 0;
  const monthlyInterest = Math.round((principal * rate) / 12) / 100;
  // Cleaner calc
  const mi = +((principal * rate) / 1200).toFixed(2);
  const ai = +(mi * months).toFixed(2);
  const td = +(principal + ai).toFixed(2);
  let is_overdue = false;
  if (loan.due_date && loan.status === 'active') {
    const due = new Date(loan.due_date);
    if (!isNaN(due.getTime()) && now > due) is_overdue = true;
  }
  return {
    ...loan,
    monthly_interest: mi,
    accrued_interest: ai,
    total_due: td,
    months_elapsed: months,
    is_overdue,
  };
}
