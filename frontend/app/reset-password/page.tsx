"use client";

// The reset link lands here: choose a new password (with the eye), done.

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Logo } from "@/components/Logo";

function ResetInner() {
  const [token, setTok] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTok(new URLSearchParams(window.location.search).get("token"));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/reset-password", { token, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That link is invalid or has expired.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mise-glass mise-liquid w-full max-w-md space-y-4 rounded-3xl p-7 text-center">
      <Logo size={40} className="mx-auto" />
      {done ? (
        <>
          <span className="mise-pop-lg mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-2xl">✓</span>
          <h1 className="font-display text-2xl text-white">Password updated</h1>
          <p className="text-sm text-slate-300">Sign in with the new one — you&apos;re all set.</p>
          <Link
            href="/login"
            className="mise-press inline-block rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-6 py-2.5 text-sm font-semibold text-ink-950"
          >
            Go to sign in →
          </Link>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl text-white">Choose a new password</h1>
          <p className="text-sm text-slate-300">At least 8 characters — make it yours.</p>
          <form onSubmit={submit} className="space-y-3 pt-1">
            <span className="relative block">
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={show ? "text" : "password"}
                required
                minLength={8}
                placeholder="new password"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 pl-3.5 pr-11 text-sm text-white outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? "Hide password" : "Show password"}
                className="mise-press absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-slate-400 hover:text-white"
              >
                {show ? "🙈" : "👁"}
              </button>
            </span>
            {error && (
              <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">
                {error} — <Link href="/forgot-password" className="underline">get a fresh link</Link>
              </p>
            )}
            <button
              type="submit"
              disabled={busy || !token}
              className="mise-press w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-60"
            >
              {busy ? "Saving…" : "Set new password"}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mise-dark-page grid min-h-screen place-items-center bg-ink-950 p-4 text-slate-100">
      <Suspense>
        <ResetInner />
      </Suspense>
    </div>
  );
}
