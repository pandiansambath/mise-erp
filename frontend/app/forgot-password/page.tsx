"use client";

// Forgot password: takes an email, always says "sent" (no account
// enumeration), and the emailed link lands on /reset-password.

import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/api";
import { Logo } from "@/components/Logo";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.post("/auth/forgot-password", { email }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  return (
    <div className="mise-dark-page grid min-h-screen place-items-center bg-ink-950 p-4 text-slate-100">
      <div className="mise-glass mise-liquid w-full max-w-md space-y-4 rounded-3xl p-7 text-center">
        <Logo size={40} className="mx-auto" />
        {sent ? (
          <>
            <span className="mise-pop-lg mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-2xl">✉️</span>
            <h1 className="font-display text-2xl text-white">Check your inbox</h1>
            <p className="text-sm leading-relaxed text-slate-300">
              If <b className="text-white">{email}</b> has a Mise account, a reset link is on its
              way. It works for <b className="text-white">1 hour</b>.
            </p>
            <p className="text-xs text-slate-500">
              back to <Link href="/login" className="underline">sign in</Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-2xl text-white">Forgot your password?</h1>
            <p className="text-sm text-slate-300">
              Tell us your email — we&apos;ll send a link to choose a new one.
            </p>
            <form onSubmit={submit} className="space-y-3 pt-1">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                required
                placeholder="you@yourrestaurant.com"
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
              />
              <button
                type="submit"
                disabled={busy}
                className="mise-press w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-60"
              >
                {busy ? "Sending…" : "Email me a reset link"}
              </button>
            </form>
            <p className="text-xs text-slate-500">
              remembered it? <Link href="/login" className="underline">sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
