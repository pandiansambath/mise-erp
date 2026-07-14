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
  plan?: string; // starter | pro | enterprise — shapes the new dashboard
}

interface AuthState {
  user: UserOut | null;
  hotel: Hotel | null;
  loading: boolean;
  /** Resolves "otp" when the account has two-step sign-in — call loginOtp next. */
  login: (email: string, password: string) => Promise<"ok" | "otp">;
  loginOtp: (email: string, code: string) => Promise<void>;
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

  // Shared tail of both sign-in steps: store the session and enter the app.
  const adoptSession = useCallback(
    async (res: TokenResponse) => {
      setToken(res.access_token);
      setUser(res.user);
      setHotel(res.hotel);
      // Operators go straight to the standalone Control Room; everyone else to the app.
      await sweepThenGo(res.user.is_platform_owner ? "/control-room" : "/dashboard");
    },
    [sweepThenGo]
  );

  const login = useCallback(
    async (email: string, password: string): Promise<"ok" | "otp"> => {
      const res = await api.post<TokenResponse & { twofa_required?: boolean }>("/auth/login", {
        email,
        password,
      });
      // Two-step accounts get a 6-digit code by email instead of a session.
      if (res.twofa_required) return "otp";
      await adoptSession(res);
      return "ok";
    },
    [adoptSession]
  );

  const loginOtp = useCallback(
    async (email: string, code: string) => {
      const res = await api.post<TokenResponse>("/auth/login-otp", { email, code });
      await adoptSession(res);
    },
    [adoptSession]
  );

  const registerHotel = useCallback(async (input: RegisterHotelInput) => {
    // Real-email era: the account is created but the door opens from the
    // VERIFICATION EMAIL (the verify page stores the session + routes to
    // onboarding). The signup form shows the check-your-inbox panel.
    await api.post<TokenResponse>("/auth/register-hotel", input);
  }, []);

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
    <AuthContext.Provider
      value={{ user, hotel, loading, login, loginOtp, registerHotel, refreshHotel, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
