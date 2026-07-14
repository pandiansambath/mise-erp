"use client";

// The landing spot for the verification email's link: verifies the token,
// stores the session it returns, and opens the kitchen (onboarding for a
// brand-new owner). Errors offer a resend.

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { api, ApiError, setToken } from "@/lib/api";
import { Logo } from "@/components/Logo";

type TokenResponse = { access_token: string };

function VerifyInner() {
  const [state, setState] = useState<"working" | "done" | "error">("working");
  const [error, setError] = useState("That link is invalid or already used.");
  const [email, setEmail] = useState("");
  const [resent, setResent] = useState(false);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState("error");
      return;
    }
    api
      .post<TokenResponse>("/auth/verify-email", { token })
      .then((res) => {
        setToken(res.access_token);
        setState("done");
        window.setTimeout(() => window.location.assign("/onboarding"), 900);
      })
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : "That link is invalid or already used.");
        setState("error");
      });
  }, []);

  return (
    <div className="mise-glass mise-liquid w-full max-w-md space-y-4 rounded-3xl p-7 text-center">
      <Logo size={40} className="mx-auto" />
      {state === "working" && (
        <>
          <h1 className="font-display text-2xl text-white">Confirming your email…</h1>
          <span className="mise-upload-ring mx-auto block" aria-hidden />
        </>
      )}
      {state === "done" && (
        <>
          <span className="mise-pop-lg mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-500/15 text-2xl">✓</span>
          <h1 className="font-display text-2xl text-white">You&apos;re verified!</h1>
          <p className="text-sm text-slate-300">Opening your kitchen…</p>
        </>
      )}
      {state === "error" && (
        <>
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-rose-500/15 text-2xl">✕</span>
          <h1 className="font-display text-2xl text-white">That link didn&apos;t work</h1>
          <p className="text-sm text-slate-300">{error}</p>
          <div className="space-y-2 pt-1">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="your signup email"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none focus:border-emerald-400/50"
            />
            <button
              type="button"
              disabled={!email || resent}
              onClick={() => {
                api.post("/auth/resend-verification", { email }).catch(() => {});
                setResent(true);
              }}
              className="mise-press w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-4 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-60"
            >
              {resent ? "Sent — check your inbox ✓" : "Send me a fresh link"}
            </button>
          </div>
          <p className="text-xs text-slate-500">
            or head back to <Link href="/login" className="underline">sign in</Link>
          </p>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="mise-dark-page grid min-h-screen place-items-center bg-ink-950 p-4 text-slate-100">
      <Suspense>
        <VerifyInner />
      </Suspense>
    </div>
  );
}
