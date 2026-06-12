"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
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

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-500/20";
  const labelCls = "block text-sm font-medium text-slate-300";

  return (
    <div className="mise-dark-page relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 px-4 text-slate-100">
      <Curtain show={curtain} />
      {/* aurora backdrop — same colour-gliding treatment as the landing / signup */}
      <div className="mise-aurora mise-aurora-shift">
        <span style={{ left: "-10%", top: "-15%", width: 540, height: 540, background: "radial-gradient(circle, #10b981, transparent 68%)" }} />
        <span style={{ right: "-12%", bottom: "-20%", width: 500, height: 500, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "8s" }} />
      </div>
      <div className="mise-dots pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/30 to-ink-950" />

      <Reveal className="relative w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Link href="/"><Logo size={52} /></Link>
          <h1 className="mt-4 font-display text-3xl text-white">Welcome back</h1>
          <p className="mt-1.5 text-sm text-slate-400">Sign in to your Mise workspace.</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-7 shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <div>
            <label htmlFor="email" className={labelCls}>Email</label>
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
            <label htmlFor="password" className={labelCls}>Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              className={inputCls}
            />
          </div>

          {error && (
            <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mise-btn-shine w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-3 text-sm font-semibold text-ink-950 shadow-xl shadow-brand-500/25 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
          >
            {busy ? "Signing in…" : "Sign in"}
          </button>

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
