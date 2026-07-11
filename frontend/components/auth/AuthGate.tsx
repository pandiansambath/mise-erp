"use client";

// The auth gate — login and signup as ONE living screen.
//
// Both /login and /signup render this component; switching modes never
// navigates (no loading flash). On desktop it's the double-slide: a full-
// vibrancy cinematic panel glides across the gate while the forms trade
// places beneath it, and the URL is synced silently with replaceState.
// On mobile the card morphs in place. Everything fits the viewport — no
// scrolling to find the submit button.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PasswordInput, SubmitButton, authInput, authLabel } from "@/components/auth/bits";
import { Sparkline } from "@/components/charts";
import { Curtain, useCurtain } from "@/components/Curtain";
import { AnimatedNumber, Aurora } from "@/components/fx";
import { Logo } from "@/components/Logo";

export type AuthMode = "login" | "signup";

const COUNTRIES = [
  { code: "GB", label: "United Kingdom (£ GBP)" },
  { code: "IN", label: "India (₹ INR)" },
  { code: "US", label: "United States ($ USD)" },
  { code: "AE", label: "UAE (AED)" },
  { code: "EU", label: "Eurozone (€ EUR)" },
];

const PROMISES = [
  "Recipes costed to the gram, margins live",
  "Stock, purchasing and payroll in one place",
  "A real-time P&L from day one",
];

/* ─────────────────────────── forms ─────────────────────────── */

function LoginForm({ active }: { active: boolean }) {
  const { login } = useAuth();
  const [email, setEmail] = useState("owner@nirai.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in. Is the server running?");
      setShake(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onAnimationEnd={() => setShake(false)}
      className={`mise-glass space-y-4 rounded-3xl p-6 sm:p-7 ${shake ? "mise-shake" : ""}`}
    >
      <div>
        <h2 className="font-display text-2xl text-white">Welcome back</h2>
        <p className="mt-1 text-sm text-slate-300">Sign in to your Mise workspace.</p>
      </div>
      <div>
        <label htmlFor="li-email" className={authLabel}>Email</label>
        <input
          id="li-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={!active}
          placeholder="owner@restaurant.com"
          className={`mt-1.5 ${authInput}`}
        />
      </div>
      <div>
        <label htmlFor="li-password" className={authLabel}>Password</label>
        <PasswordInput id="li-password" value={password} onChange={setPassword} />
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          {error}
        </p>
      )}
      <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}

function SignupForm({ active }: { active: boolean }) {
  const { registerHotel } = useAuth();
  const [hotelName, setHotelName] = useState("");
  const [country, setCountry] = useState("GB");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerHotel({ hotel_name: hotelName, country, city: city || undefined, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register. Is the server running?");
      setShake(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onAnimationEnd={() => setShake(false)}
      className={`mise-glass space-y-3.5 rounded-3xl p-6 sm:p-7 ${shake ? "mise-shake" : ""}`}
    >
      <div>
        <h2 className="font-display text-2xl text-white">Register your hotel</h2>
        <p className="mt-1 text-sm text-slate-300">Free to start. No card required.</p>
      </div>
      <div>
        <label htmlFor="su-hotel" className={authLabel}>Restaurant name</label>
        <input
          id="su-hotel"
          value={hotelName}
          onChange={(e) => setHotelName(e.target.value)}
          required
          disabled={!active}
          placeholder="e.g. NIRAI"
          className={`mt-1.5 ${authInput}`}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="su-country" className={authLabel}>Country</label>
          <select
            id="su-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={`mt-1.5 ${authInput} [&>option]:bg-ink-900`}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="su-city" className={authLabel}>City (optional)</label>
          <input id="su-city" value={city} onChange={(e) => setCity(e.target.value)} className={`mt-1.5 ${authInput}`} />
        </div>
      </div>
      <div>
        <label htmlFor="su-email" className={authLabel}>Your email</label>
        <input
          id="su-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          disabled={!active}
          placeholder="owner@restaurant.com"
          className={`mt-1.5 ${authInput}`}
        />
      </div>
      <div>
        <label htmlFor="su-password" className={authLabel}>Password</label>
        <PasswordInput
          id="su-password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={8}
          placeholder="min 8 characters"
        />
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          {error}
        </p>
      )}
      <SubmitButton busy={busy} busyLabel="Creating your restaurant…">Create my restaurant</SubmitButton>
    </form>
  );
}

/* ──────────────────── the sliding cinema panel ──────────────────── */

function CinePanel({ mode, onSwitch }: { mode: AuthMode; onSwitch: (m: AuthMode) => void }) {
  // The panel always pitches the OTHER door.
  const pitchSignup = mode === "login";
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-8 lg:p-10">
      {/* full-vibrancy film stills, crossfading with the mode */}
      <img
        src="/experience/table.jpg"
        alt=""
        decoding="async"
        className="mise-l-ken absolute inset-0 h-full w-full object-cover"
        style={{ opacity: mode === "login" ? 1 : 0, transition: "opacity 700ms ease" }}
      />
      <img
        src="/experience/dawn.jpg"
        alt=""
        decoding="async"
        className="mise-l-ken absolute inset-0 h-full w-full object-cover"
        style={{ opacity: mode === "signup" ? 1 : 0, transition: "opacity 700ms ease" }}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/30 to-ink-950/60" />

      <Link href="/" className="relative inline-flex items-center gap-2.5">
        <Logo size={32} />
        <span className="font-display text-lg font-semibold tracking-tight text-white">Mise</span>
      </Link>

      <div className="relative">
        {/* the pitch swaps with the mode */}
        <div key={mode} className="mise-auth-stagger">
          <h1 className="font-display text-3xl leading-[1.08] text-white drop-shadow-[0_2px_24px_rgba(0,0,0,0.7)] lg:text-4xl">
            {pitchSignup ? (
              <>
                New around here?
                <span className="mise-profit-text block italic">Set your house in order.</span>
              </>
            ) : (
              <>
                Already one of us?
                <span className="mise-profit-text block italic">The pass is waiting.</span>
              </>
            )}
          </h1>
          <ul className="mt-5 space-y-2.5">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-slate-200 drop-shadow">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-brand-400/40 bg-brand-500/20 text-[10px] text-brand-200">✓</span>
                {p}
              </li>
            ))}
          </ul>
          {pitchSignup && (
            <div className="mise-glass mt-6 max-w-xs rounded-2xl p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-300">Net profit · this week</p>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> live
                </span>
              </div>
              <p className="mt-1 font-mono text-xl font-bold text-copper-200">
                <AnimatedNumber value={3412} prefix="£" />
              </p>
              <Sparkline data={[380, 420, 361, 505, 468, 590, 688]} color="#eab78a" height={30} className="mt-1.5 h-[30px]" />
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => onSwitch(pitchSignup ? "signup" : "login")}
          className="mise-press relative mt-7 inline-flex items-center justify-center rounded-xl border border-white/30 bg-white/10 px-6 py-3 text-sm font-semibold text-white backdrop-blur transition hover:border-white/50 hover:bg-white/15"
        >
          {pitchSignup ? "Register your hotel →" : "← Sign in instead"}
        </button>
      </div>

      <p className="relative font-mono text-[10px] uppercase tracking-[0.3em] text-slate-400">
        Every plate · Every penny
      </p>
    </div>
  );
}

/* ───────────────────────── the gate ───────────────────────── */

export default function AuthGate({ initialMode }: { initialMode: AuthMode }) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const curtain = useCurtain();
  const liveRef = useRef<HTMLParagraphElement>(null);

  // Paint the document dark while mounted (kills white overscroll flash).
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.background;
    const prevBody = body.style.background;
    root.style.background = "#030d09";
    body.style.background = "#030d09";
    return () => {
      root.style.background = prevRoot;
      body.style.background = prevBody;
    };
  }, []);

  // Mode switch = animation + silent URL sync. Never a navigation.
  const switchTo = useCallback((m: AuthMode) => {
    setMode(m);
    window.history.replaceState(null, "", m === "login" ? "/login" : "/signup");
    document.title = m === "login" ? "Sign in · Mise" : "Register your hotel · Mise";
  }, []);

  const isLogin = mode === "login";

  return (
    <div className="mise-dark-page relative h-svh overflow-hidden bg-ink-950 text-slate-100">
      <Curtain show={curtain} label={isLogin ? undefined : "Setting your tables…"} />
      <Aurora strength={0.4} />
      <div className="mise-dots pointer-events-none absolute inset-0" />
      <p ref={liveRef} className="sr-only" aria-live="polite">
        {isLogin ? "Sign in form" : "Registration form"}
      </p>

      {/* ── desktop: the double-slide gate ── */}
      <div className="relative mx-auto hidden h-full w-full max-w-6xl items-center px-6 lg:flex">
        <div className="relative h-[min(720px,92vh)] w-full overflow-hidden rounded-[28px] border border-white/10 shadow-2xl shadow-black/60">
          {/* forms live on both halves; the panel covers the sleeping one */}
          <div
            className={`mise-noscrollbar absolute inset-y-0 left-0 flex w-1/2 items-center justify-center overflow-y-auto bg-ink-950/80 p-8 transition-opacity duration-500 ${
              isLogin ? "pointer-events-none opacity-0" : "opacity-100"
            }`}
            style={{ transitionDelay: isLogin ? "0ms" : "260ms" }}
            aria-hidden={isLogin}
          >
            <div className="w-full max-w-md">
              <SignupForm active={!isLogin} />
            </div>
          </div>
          <div
            className={`mise-noscrollbar absolute inset-y-0 right-0 flex w-1/2 items-center justify-center overflow-y-auto bg-ink-950/80 p-8 transition-opacity duration-500 ${
              isLogin ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
            style={{ transitionDelay: isLogin ? "260ms" : "0ms" }}
            aria-hidden={!isLogin}
          >
            <div className="w-full max-w-md">
              <LoginForm active={isLogin} />
            </div>
          </div>

          {/* the cinematic panel glides between the doors */}
          <div
            className="absolute inset-y-0 left-0 w-1/2 will-change-transform motion-reduce:transition-none"
            style={{
              transform: isLogin ? "translateX(0%)" : "translateX(100%)",
              transition: "transform 650ms cubic-bezier(0.76, 0, 0.24, 1)",
            }}
          >
            <CinePanel mode={mode} onSwitch={switchTo} />
          </div>
        </div>
      </div>

      {/* ── mobile: full-bleed cinema behind the morphing glass card ── */}
      <div className="mise-noscrollbar relative flex h-full flex-col overflow-y-auto lg:hidden">
        {/* the 9:16 film stills the user shot for phones — full vibrancy */}
        <div className="fixed inset-0" aria-hidden>
          <img
            src="/experience/m/table.jpg"
            alt=""
            decoding="async"
            className="mise-l-ken absolute inset-0 h-full w-full object-cover"
            style={{ opacity: isLogin ? 1 : 0, transition: "opacity 700ms ease" }}
          />
          <img
            src="/experience/m/dawn.jpg"
            alt=""
            decoding="async"
            className="mise-l-ken absolute inset-0 h-full w-full object-cover"
            style={{ opacity: isLogin ? 0 : 1, transition: "opacity 700ms ease" }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-ink-950/80 via-ink-950/35 to-ink-950/90" />
        </div>

        <div className="relative flex min-h-full flex-col px-4 pb-8 pt-6">
          <Link href="/" className="mb-6 flex items-center gap-2.5">
            <Logo size={38} />
            <span className="font-display text-xl font-semibold text-white drop-shadow">Mise</span>
            <span className="ml-auto font-mono text-[9px] uppercase tracking-[0.3em] text-slate-300 drop-shadow">
              Every plate · Every penny
            </span>
          </Link>

          <div key={mode} className="mise-auth-stagger mx-auto mt-auto w-full max-w-md">
            <h1 className="mb-4 font-display text-3xl leading-tight text-white drop-shadow-[0_2px_20px_rgba(0,0,0,0.7)]">
              {isLogin ? (
                <>Welcome back to <span className="mise-profit-text italic">the pass.</span></>
              ) : (
                <>Set your house <span className="mise-profit-text italic">in order.</span></>
              )}
            </h1>
            {isLogin ? <LoginForm active /> : <SignupForm active />}
            <p className="mb-2 mt-5 text-center text-sm text-slate-200 drop-shadow">
              {isLogin ? (
                <>
                  New here?{" "}
                  <button type="button" onClick={() => switchTo("signup")} className="mise-press font-semibold text-brand-300 transition hover:text-brand-200">
                    Register your hotel →
                  </button>
                </>
              ) : (
                <>
                  Already have an account?{" "}
                  <button type="button" onClick={() => switchTo("login")} className="mise-press font-semibold text-brand-300 transition hover:text-brand-200">
                    ← Sign in
                  </button>
                </>
              )}
            </p>
          </div>
          <div className="mt-auto" />
        </div>
      </div>
    </div>
  );
}
