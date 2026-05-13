import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';
export const API_BASE = `${BASE_URL}/api`;
const TOKEN_KEY = 'lendsplit_token';

async function getToken(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') {
      return await AsyncStorage.getItem(TOKEN_KEY);
    }
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function setToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
    else await AsyncStorage.removeItem(TOKEN_KEY);
  } else {
    if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  }
}

export const api = axios.create({ baseURL: API_BASE, timeout: 20000 });

api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers = config.headers ?? {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

export type User = {
  user_id: string;
  email: string;
  name: string;
  phone?: string | null;
  picture?: string | null;
  subscription_tier: string;
  subscription_expires_at?: string | null;
};

export type Loan = {
  loan_id: string;
  mode: 'private' | 'public';
  counterparty_name: string;
  counterparty_email?: string | null;
  counterparty_phone?: string | null;
  direction: 'lent' | 'borrowed';
  principal_amount: number;
  interest_rate: number;
  start_date: string;
  due_date?: string | null;
  reminder_enabled: boolean;
  reminder_day: number;
  notes?: string | null;
  status: 'active' | 'settled' | 'closed' | 'overdue';
  monthly_interest: number;
  accrued_interest: number;
  total_due: number;
  months_elapsed: number;
  is_overdue?: boolean;
  created_at?: string;
  updated_at?: string;
  owner_user_id?: string;
};
