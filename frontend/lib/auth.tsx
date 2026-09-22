"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { nextFromLocation } from "./nextPath";
import { setGrantedPermissions } from "./permissions";
import { setAppTimeZone } from "./date";
import { useRouter } from "next/navigation";
import { hotelSite } from "@/lib/site";
import { forgetAll } from "@/lib/rangeMemory";
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
  username: string; // @handle → <username>.dineai.cloud (mandatory)
  country: string;
  city?: string;
  email: string;
  password: string;
  plan?: string; // starter | pro | enterprise — shapes the new dashboard
}

export interface RegisterHotelResult {
  site_url?: string; // https://<handle>.dineai.cloud — their live front door
  subdomain?: string;
  // REGISTRATION HANDS BACK A SESSION. Optional only so an older server that
  // still withholds it does not break the page — `registerHotel` falls back
  // to the inbox screen in that case rather than throwing.
  access_token?: string;
  token_type?: string;
  user?: UserOut;
  hotel?: Hotel;
  permissions?: string[];
}

interface AuthState {
  user: UserOut | null;
  hotel: Hotel | null;
  loading: boolean;
  /** Resolves "otp" when the account has two-step sign-in — call loginOtp next. */
  /** `to` overrides where they land — SIGNUP passes "/onboarding", because a
   *  restaurant we just created is known to be empty. */
  login: (email: string, password: string, to?: string) => Promise<"ok" | "otp">;
  loginOtp: (email: string, code: string) => Promise<void>;
  registerHotel: (input: RegisterHotelInput) => Promise<RegisterHotelResult>;
  refreshHotel: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserOut | null>(null);
  const [hotel, setHotel] = useState<Hotel | null>(null);

  // Every "today" in the app is the RESTAURANT's today. Set here because this
  // is the one place that knows which restaurant you are signed into — see
  // lib/date.ts for the bug that made this necessary.
  useEffect(() => {
    setAppTimeZone(hotel?.timezone ?? null);
  }, [hotel]);
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
      setGrantedPermissions(me.permissions);
        setGrantedPermissions(me.permissions);
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
    async (res: TokenResponse, forced?: string) => {
      setToken(res.access_token);
      setUser(res.user);
      setHotel(res.hotel);
      setGrantedPermissions(res.permissions);

      // THE RESTAURANT'S COLOURS, NOW, NOT ON THE NEXT HARD RELOAD.
      //
      // `ThemeProvider` fetches the theme once on mount and gives up if there
      // is no token yet — which there is not, when you arrive cold and get
      // bounced to sign-in. Signing in does not remount it, so the app stayed
      // on the default for the whole session for anyone without primed
      // localStorage. This response already carries the hotel, and `HotelOut`
      // already declares `theme`; it was simply being dropped.
      try {
        window.dispatchEvent(
          new CustomEvent("mise:theme", {
            detail: { theme: (res.hotel as { theme?: string | null } | null)?.theme ?? null },
          }),
        );
      } catch {
        /* never let a cosmetic dispatch break a sign-in */
      }
      // Where they were actually trying to go, if anywhere.
      //
      // `safeNext` is an allowlist of SHAPE — one leading slash, no scheme, no
      // host — because `?next=` is attacker-controlled and an open redirect
      // after a successful sign-in is the most convincing phishing page there
      // is: the victim has just proved the site is real.
      //
      // An operator's destination has to be inside the Control Room. Sending
      // one to a tenant page would render the app shell around somebody who
      // has no hotel, which the app-group layout then bounces anyway.
      const wanted = nextFromLocation();
      // A BRAND-NEW RESTAURANT LANDS ON SETUP, NOT ON AN EMPTY DASHBOARD.
      //
      // This line sent every non-operator to /dashboard, and the ONLY route to
      // onboarding was a 900ms timer on the verify-email page — so an owner
      // who signed up, confirmed later, or simply signed in again never saw it
      // once. A 601-line page nobody could reach is indistinguishable from a
      // page that does not exist, which is exactly how he described it.
      //
      // `needs_setup` is true only while the restaurant has no stock, no
      // suppliers, no dishes and no staff, so this redirects once and then
      // stops. It is computed, never stored — a hotel that is emptied gets the
      // guidance back rather than being stranded on a dashboard of zeros.
      const home = res.user.is_platform_owner
        ? "/control-room"
        : forced
          ? forced
          : res.hotel?.needs_setup
            ? "/onboarding"
            : "/dashboard";
      const allowed =
        wanted &&
        (res.user.is_platform_owner
          ? wanted.startsWith("/control-room")
          : !wanted.startsWith("/control-room"));
      await sweepThenGo(allowed ? wanted : home);
    },
    [sweepThenGo]
  );

  const login = useCallback(
    async (email: string, password: string, to?: string): Promise<"ok" | "otp"> => {
      const res = await api.post<TokenResponse & { twofa_required?: boolean }>("/auth/login", {
        email,
        password,
        // Which restaurant's door this is. The server enforces it; sending it
        // is what lets the server know there is a door to enforce.
        site: hotelSite(),
      });
      // Two-step accounts get a 6-digit code by email instead of a session.
      if (res.twofa_required) return "otp";
      // `to` is set by SIGNUP, where the destination is not a guess: we just
      // created the restaurant, so we know it is empty. Everywhere else this
      // is undefined and `adoptSession` works it out from `needs_setup`.
      await adoptSession(res, to);
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
    // ONE REQUEST. Registration provisions a subdomain and sends an email
    // before it answers; making the page then ask /auth/login for a session
    // it could have been handed meant two waits with nothing changing on
    // screen between them, the long one first. That was the "stuck".
    //
    // The response now carries the session, so signing up ends INSIDE the
    // product. The address is still unverified, reset and alerts are still
    // paused, and the banner inside still asks.
    const res = await api.post<RegisterHotelResult>("/auth/register-hotel", input);
    if (res.access_token && res.user) {
      // /setup explicitly: we just made this restaurant, so we know it is
      // empty. Asking a computed flag to tell us that on the way back is how
      // an owner lands on a dashboard of zeros.
      await adoptSession(res as never, "/onboarding");
    }
    return res;
  }, [adoptSession]);

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
    // Remembered date ranges are per-session by design. On a shared terminal
    // the next person must not inherit the last one's view.
    forgetAll();
    setUser(null);
    setHotel(null);
    setGrantedPermissions(null);
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
