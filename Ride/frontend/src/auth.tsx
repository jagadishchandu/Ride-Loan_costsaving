import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api, tokenStorage, TOKEN_KEY } from "./api";

export type User = {
  id: string;
  email: string;
  name: string;
  role: "rider" | "driver";
  phone?: string | null;
  vehicle?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    role: "rider" | "driver";
    phone?: string;
    vehicle?: string;
  }) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      const token = await tokenStorage.getItem(TOKEN_KEY);
      if (!token) {
        setUser(null);
        return;
      }
      const res = await api.get("/auth/me");
      setUser(res.data);
    } catch {
      await tokenStorage.removeItem(TOKEN_KEY);
      setUser(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await refreshUser();
      setLoading(false);
    })();
  }, [refreshUser]);

  const login = async (email: string, password: string) => {
    const res = await api.post("/auth/login", { email, password });
    await tokenStorage.setItem(TOKEN_KEY, res.data.access_token);
    setUser(res.data.user);
    return res.data.user as User;
  };

  const register: AuthState["register"] = async (data) => {
    const res = await api.post("/auth/register", data);
    await tokenStorage.setItem(TOKEN_KEY, res.data.access_token);
    setUser(res.data.user);
    return res.data.user as User;
  };

  const logout = async () => {
    await tokenStorage.removeItem(TOKEN_KEY);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
