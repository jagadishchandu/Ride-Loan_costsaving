import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api, setToken, User } from './api';

type AuthState = {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signInWithGoogleSession: (sessionId: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadMe = useCallback(async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.data);
    } catch {
      setUser(null);
      await setToken(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMe();
  }, [loadMe]);

  const signIn = async (email: string, password: string) => {
    const r = await api.post('/auth/login', { email, password });
    await setToken(r.data.access_token);
    setUser(r.data.user);
  };

  const signUp = async (email: string, password: string, name: string) => {
    const r = await api.post('/auth/signup', { email, password, name });
    await setToken(r.data.access_token);
    setUser(r.data.user);
  };

  const signInWithGoogleSession = async (sessionId: string) => {
    const r = await api.post('/auth/google', { session_id: sessionId });
    await setToken(r.data.access_token);
    setUser(r.data.user);
  };

  const signOut = async () => {
    try {
      await api.post('/auth/logout');
    } catch {}
    await setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    try {
      const r = await api.get('/auth/me');
      setUser(r.data);
    } catch {}
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithGoogleSession, signOut, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
