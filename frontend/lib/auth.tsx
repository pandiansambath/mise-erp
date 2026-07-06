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

export interface RegisterHotelInput {
  hotel_name: string;
  country: string;
  city?: string;
  email: string;
  password: string;
}

interface AuthState {
  user: UserOut | null;
  hotel: Hotel | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  registerHotel: (input: RegisterHotelInput) => Promise<void>;
  refreshHotel: () => Promise<void>;
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

  // Let the current page raise its transition curtain (components/Curtain.tsx)
  // and give the sweep time to cover the screen before the route swaps.
  const sweepThenGo = useCallback(
    async (path: string) => {
      window.dispatchEvent(new Event("mise:transition"));
      await new Promise((r) => setTimeout(r, 520));
      router.push(path);
    },
    [router]
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<TokenResponse>("/auth/login", { email, password });
      setToken(res.access_token);
      setUser(res.user);
      setHotel(res.hotel);
      // Operators go straight to the standalone Control Room; everyone else to the app.
      await sweepThenGo(res.user.is_platform_owner ? "/control-room" : "/dashboard");
    },
    [sweepThenGo]
  );

  const registerHotel = useCallback(
    async (input: RegisterHotelInput) => {
      const res = await api.post<TokenResponse>("/auth/register-hotel", input);
      setToken(res.access_token);
      setUser(res.user);
      setHotel(res.hotel);
      // New hotel → guided onboarding (import data → prefilled dashboard).
      await sweepThenGo("/onboarding");
    },
    [sweepThenGo]
  );

  const refreshHotel = useCallback(async () => {
    try {
      const me = await api.get<MeResponse>("/auth/me");
      setHotel(me.hotel);
    } catch {
      /* keep the current hotel on a transient failure */
    }
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setHotel(null);
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ user, hotel, loading, login, registerHotel, refreshHotel, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
