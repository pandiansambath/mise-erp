"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  api,
  clearToken,
  getToken,
  setToken,
  type Hotel,
  type MeResponse,
  type TokenResponse,
  type UserOut,
} from "./api";

interface AuthState {
  user: UserOut | null;
  hotel: Hotel | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // On mount, if we have a token, fetch the current user + hotel.
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .get<MeResponse>("/auth/me")
      .then((me) => {
        setUser(me.user);
        setHotel(me.hotel);
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<TokenResponse>("/auth/login", { email, password });
      setToken(res.access_token);
      setUser(res.user);
      setHotel(res.hotel);
      router.push("/dashboard");
    },
    [router]
  );

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setHotel(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, hotel, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
