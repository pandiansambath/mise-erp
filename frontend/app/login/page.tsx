"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { AuthBackdrop, PasswordInput, SubmitButton, authInput, authLabel } from "@/components/auth/bits";
import { Curtain, useCurtain } from "@/components/Curtain";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";

export default function LoginPage() {
  // Paint the document dark while mounted (matches the landing/signup, kills the white flash).
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

  const { login } = useAuth();
  const curtain = useCurtain();
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
      setShake(true); // the card shakes "no" — cleared on animation end
    } finally {
      setBusy(false);
    }
  }

  const inputCls = `mt-1.5 ${authInput}`;

  return (
    <div className="mise-dark-page relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 px-4 text-slate-100">
      <Curtain show={curtain} />
      {/* cinematic backdrop — the warm dining room from the landing's world */}
      <AuthBackdrop still="table" />

      <Reveal className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/"><Logo size={52} /></Link>
          <h1 className="mt-4 font-display text-3xl text-white">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-400">Sign in to your Mise workspace.</p>
        </div>

        <form
          onSubmit={onSubmit}
          onAnimationEnd={() => setShake(false)}
          className={`space-y-4 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-7 shadow-2xl shadow-black/40 backdrop-blur-xl ${shake ? "mise-shake" : ""}`}
        >
          <div>
            <label htmlFor="email" className={authLabel}>Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="owner@restaurant.com"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor="password" className={authLabel}>Password</label>
            <PasswordInput id="password" value={password} onChange={setPassword} />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
              {error}
            </p>
          )}

          <SubmitButton busy={busy} busyLabel="Signing in…">
            Sign in
          </SubmitButton>

          <p className="text-center text-sm text-slate-400">
            New here?{" "}
            <Link href="/signup" className="font-medium text-brand-300 transition hover:text-brand-200">
              Register your hotel
            </Link>
          </p>
        </form>
      </Reveal>
    </div>
  );
}
