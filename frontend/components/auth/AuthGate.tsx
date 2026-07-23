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
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { PasswordInput, SubmitButton, authInput, authLabel } from "@/components/auth/bits";
import ChefMascot, { type ChefMood } from "@/components/auth/ChefMascot";
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

/** hotel name → a valid @handle suggestion (lowercase, letters/numbers only). */
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
}

/** Shared chef-mood logic: watches typed fields, covers eyes on password. */
function useChefMood(typedLen: number) {
  const [typingFocus, setTypingFocus] = useState(false);
  const [pwFocus, setPwFocus] = useState(false);
  const [pwShown, setPwShown] = useState(false);
  const [busyHappy, setBusyHappy] = useState(false);
  const mood: ChefMood = busyHappy
    ? "happy"
    : pwFocus
      ? pwShown
        ? "peek"
        : "cover"
      : typingFocus
        ? "watch"
        : "idle";
  // eyes sweep left→right as the text grows
  const look = -1 + 2 * Math.min(1, typedLen / 26);
  return { mood, look, setTypingFocus, setPwFocus, setPwShown, setBusyHappy };
}

/* ─────────────────────────── forms ─────────────────────────── */

function LoginForm({ active }: { active: boolean }) {
  const { login, loginOtp } = useAuth();
  const [email, setEmail] = useState("owner@nirai.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  // Two-step sign-in: password accepted → a 6-digit code is in their inbox.
  const [otpStep, setOtpStep] = useState(false);
  const [otp, setOtp] = useState("");
  const chef = useChefMood(email.length);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    chef.setBusyHappy(true);
    try {
      const outcome = await login(email, password);
      if (outcome === "otp") {
        setOtpStep(true);
        setOtp("");
        chef.setBusyHappy(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in. Is the server running?");
      setShake(true);
      chef.setBusyHappy(false);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmitOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginOtp(email, otp.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That code didn't work.");
      setShake(true);
    } finally {
      setBusy(false);
    }
  }

  if (otpStep) {
    return (
      <form
        onSubmit={onSubmitOtp}
        onAnimationEnd={() => setShake(false)}
        className={`mise-glass mise-liquid relative space-y-4 rounded-3xl p-6 text-center sm:p-7 ${shake ? "mise-shake" : ""}`}
      >
        <div className="mx-auto -mt-1 w-24 sm:w-28">
          <ChefMascot mood="point" />
        </div>
        <div>
          <h2 className="font-display text-2xl text-white">Enter your sign-in code 🔐</h2>
          <p className="mt-1 text-sm text-slate-300">
            We emailed a 6-digit code to <b className="text-white">{email}</b>. It works for 10
            minutes.
          </p>
        </div>
        <input
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="••••••"
          aria-label="6-digit sign-in code"
          className="mx-auto block w-44 rounded-xl border border-white/10 bg-white/[0.04] py-3 text-center font-mono text-2xl tracking-[0.4em] text-white outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
        />
        {error && (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || otp.length !== 6}
          className="mise-press w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-60"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <button
            type="button"
            onClick={() => { setOtpStep(false); setError(null); }}
            className="underline-offset-2 hover:text-white hover:underline"
          >
            ← back
          </button>
          <button
            type="button"
            onClick={() => { login(email, password).catch(() => {}); setOtp(""); }}
            className="underline-offset-2 hover:text-white hover:underline"
          >
            Send a fresh code
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      onAnimationEnd={() => setShake(false)}
      className={`mise-glass mise-liquid relative space-y-4 rounded-3xl p-6 sm:p-7 ${shake ? "mise-shake" : ""}`}
    >
      {/* the maître — watches your email, covers his eyes for the password.
          In-flow (not absolute) so no container ever crops his toque. */}
      <div className="mx-auto -mt-1 w-24 sm:w-28">
        <ChefMascot mood={chef.mood} look={chef.look} />
      </div>
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
          onFocus={() => chef.setTypingFocus(true)}
          onBlur={() => chef.setTypingFocus(false)}
          required
          disabled={!active}
          placeholder="owner@restaurant.com"
          className={`mt-1.5 ${authInput}`}
        />
      </div>
      <div>
        <label htmlFor="li-password" className={authLabel}>Password</label>
        <PasswordInput
          id="li-password"
          value={password}
          onChange={setPassword}
          onFocusChange={chef.setPwFocus}
          onShowChange={chef.setPwShown}
        />
      </div>
      {error && /verify your email/i.test(error) ? (
        <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-200">
          <p className="font-semibold">✉️ One click left — verify your email</p>
          <p className="mt-1 text-xs text-amber-200/80">
            We sent a link to <b>{email}</b> when you signed up. Click it and you&apos;re in.
          </p>
          <button
            type="button"
            onClick={() => api.post("/auth/resend-verification", { email }).catch(() => {})}
            className="mise-press mt-2 rounded-lg border border-amber-400/40 px-3 py-1.5 text-xs font-semibold text-amber-200 hover:bg-amber-400/10"
          >
            Resend the link
          </button>
        </div>
      ) : error && (
        /suspended/i.test(error) ? (
          <div role="alert" className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-200">
            <p className="font-semibold">🔒 This restaurant&apos;s account is suspended</p>
            <p className="mt-1 text-xs text-amber-200/80">
              Your data is safe — access is paused by the Mise team (usually billing). Email{" "}
              <a href="mailto:support@mise.app" className="underline">support@mise.app</a> and we&apos;ll sort it out.
            </p>
          </div>
        ) : (
          <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
            {error}
          </p>
        )
      )}
      <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-center">
        <Link href="/forgot-password" className="text-xs text-slate-400 underline-offset-2 transition hover:text-white hover:underline">
          Forgot your password?
        </Link>
      </p>
    </form>
  );
}

function SignupForm({ active }: { active: boolean }) {
  const { registerHotel } = useAuth();
  const [hotelName, setHotelName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [country, setCountry] = useState("GB");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [sent, setSent] = useState(false); // account made → go check the inbox
  const [siteUrl, setSiteUrl] = useState<string | null>(null); // their live subdomain
  const [plan, setPlan] = useState("pro"); // shapes the dashboard from day one
  const chef = useChefMood(email.length || hotelName.length);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    chef.setBusyHappy(true);
    try {
      const res = await registerHotel({
        hotel_name: hotelName, username, country, city: city || undefined, email, password, plan,
      });
      setSiteUrl(res.site_url ?? null);
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register. Is the server running?");
      setShake(true);
      chef.setBusyHappy(false);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="mise-glass mise-liquid relative space-y-4 rounded-3xl p-6 text-center sm:p-7">
        <ChefMascot mood="point" className="mx-auto w-24" />
        <h2 className="font-display text-2xl text-white">Check your inbox ✉️</h2>
        <p className="text-sm leading-relaxed text-slate-300">
          We sent a confirmation link to <b className="text-white">{email}</b>.
          One click and your kitchen opens — it also proves alerts and reports
          can reach you later.
        </p>
        {siteUrl && (
          <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-left">
            <p className="text-sm font-semibold text-emerald-200">🌐 Your own site is ready</p>
            <p className="mt-1 text-xs text-slate-300">
              This restaurant now has its own web address. After confirming your email,
              log in there:
            </p>
            <a
              href={siteUrl}
              target="_blank"
              rel="noreferrer"
              className="mise-press mt-2 inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/30"
            >
              {siteUrl.replace(/^https?:\/\//, "")} →
            </a>
          </div>
        )}
        <button
          type="button"
          onClick={() => api.post("/auth/resend-verification", { email }).catch(() => {})}
          className="mise-press rounded-xl border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
        >
          Resend the email
        </button>
        <p className="text-[11px] text-slate-500">wrong address? just sign up again with the right one</p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      onAnimationEnd={() => setShake(false)}
      className={`mise-glass mise-liquid relative space-y-3.5 rounded-3xl p-6 sm:p-7 ${shake ? "mise-shake" : ""}`}
    >
      {/* the maître greets new houses too — in-flow, crop-proof on all devices */}
      <div className="mx-auto -mt-1 w-20 sm:w-24">
        <ChefMascot mood={chef.mood} look={chef.look} />
      </div>
      <div>
        <h2 className="font-display text-2xl text-white">Register your hotel</h2>
        <p className="mt-1 text-sm text-slate-300">Free to start. No card required.</p>
      </div>
      <div>
        <label htmlFor="su-hotel" className={authLabel}>Restaurant name</label>
        <input
          id="su-hotel"
          value={hotelName}
          onChange={(e) => {
            setHotelName(e.target.value);
            if (!usernameEdited) setUsername(slugify(e.target.value)); // auto-suggest the handle
          }}
          onFocus={() => chef.setTypingFocus(true)}
          onBlur={() => chef.setTypingFocus(false)}
          required
          disabled={!active}
          placeholder="e.g. NIRAI"
          className={`mt-1.5 ${authInput}`}
        />
      </div>
      <div>
        <label htmlFor="su-username" className={authLabel}>Your web address</label>
        <input
          id="su-username"
          value={username}
          onChange={(e) => { setUsername(slugify(e.target.value)); setUsernameEdited(true); }}
          onFocus={() => chef.setTypingFocus(true)}
          onBlur={() => chef.setTypingFocus(false)}
          required
          minLength={3}
          disabled={!active}
          placeholder="nirai"
          className={`mt-1.5 ${authInput}`}
        />
        <p className="mt-1 text-[11px] text-slate-400">
          {username.length >= 3 ? (
            <>Your own site → <b className="text-emerald-300">{username}.dineai.cloud</b></>
          ) : (
            "3–40 lowercase letters / numbers / _ — becomes your own live site address."
          )}
        </p>
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
          onFocus={() => chef.setTypingFocus(true)}
          onBlur={() => chef.setTypingFocus(false)}
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
          onFocusChange={chef.setPwFocus}
          onShowChange={chef.setPwShown}
        />
      </div>
      {error && (
        <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
          {error}
        </p>
      )}
      <div>
        <span className={authLabel}>Your plan (change any time)</span>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {[
            ["starter", "Starter", "money + stock"],
            ["pro", "Pro", "everything"],
            ["enterprise", "Enterprise", "unlimited"],
          ].map(([key, label, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPlan(key)}
              className={`rounded-xl border px-2 py-2 text-center transition ${
                plan === key
                  ? "border-emerald-400/60 bg-emerald-400/10"
                  : "border-white/10 bg-white/[0.03] hover:border-white/25"
              }`}
            >
              <span className="block text-xs font-semibold text-white">{label}</span>
              <span className="block text-[10px] text-slate-400">{hint}</span>
            </button>
          ))}
        </div>
      </div>
      <SubmitButton busy={busy} busyLabel="Creating your restaurant…">Create my restaurant</SubmitButton>
    </form>
  );
}

/** True once the browser holds a fully-decoded copy — backdrops fade in as a
    whole frame instead of revealing top-to-bottom while the JPEG streams. */
function useDecoded(src: string): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const im = new Image();
    const done = () => {
      if (!cancelled) setOk(true);
    };
    im.src = src;
    if (im.decode) im.decode().then(done).catch(done);
    else {
      im.onload = done;
      im.onerror = done;
    }
    return () => {
      cancelled = true;
    };
  }, [src]);
  return ok;
}

/* ──────────────────── the sliding cinema panel ──────────────────── */

function CinePanel({ mode, onSwitch }: { mode: AuthMode; onSwitch: (m: AuthMode) => void }) {
  // The panel always pitches the OTHER door.
  const pitchSignup = mode === "login";
  const tableOk = useDecoded("/experience/table.jpg");
  const dawnOk = useDecoded("/experience/dawn.jpg");
  return (
    <div className="relative flex h-full flex-col justify-between overflow-hidden p-8 lg:p-10">
      {/* full-vibrancy film stills, crossfading with the mode */}
      <img
        src="/experience/table.jpg"
        alt=""
        decoding="async"
        className="mise-l-ken absolute inset-0 h-full w-full object-cover"
        style={{ opacity: mode === "login" && tableOk ? 1 : 0, transition: "opacity 700ms ease" }}
      />
      <img
        src="/experience/dawn.jpg"
        alt=""
        decoding="async"
        className="mise-l-ken absolute inset-0 h-full w-full object-cover"
        style={{ opacity: mode === "signup" && dawnOk ? 1 : 0, transition: "opacity 700ms ease" }}
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
  const mTableOk = useDecoded("/experience/m/table.jpg");
  const mDawnOk = useDecoded("/experience/m/dawn.jpg");

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
            style={{ opacity: isLogin && mTableOk ? 1 : 0, transition: "opacity 700ms ease" }}
          />
          <img
            src="/experience/m/dawn.jpg"
            alt=""
            decoding="async"
            className="mise-l-ken absolute inset-0 h-full w-full object-cover"
            style={{ opacity: !isLogin && mDawnOk ? 1 : 0, transition: "opacity 700ms ease" }}
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
