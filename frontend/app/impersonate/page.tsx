"use client";

// Landing pad for the Control Room's "View as hotel" (read-only support view).
//
// The 15-minute token arrives in the URL HASH — never sent to a server, never
// written to a log — and is stored for THIS TAB only.
//
// Two things this page learned the hard way:
//
// **sessionStorage, not localStorage.** It is scoped to the tab rather than the
// origin, so the operator's Control Room login survives even when the support
// view is opened from the same host. localStorage wrote the hotel's token onto
// the operator's own key and signed them out of their own console.
//
// **Check the token HERE, and say what is wrong.** It used to store and
// redirect blind. If the token was rejected, the dashboard bounced to /login
// with no explanation — which reads exactly like "View as is broken" — and the
// failed check cleared storage on the way past, logging the operator out too.
// Verifying here turns a mystery into a sentence.

import { useEffect, useState } from "react";
import { API_BASE } from "@/lib/api";

export default function ImpersonatePage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("t");
    if (!token) {
      setError("No support token in this link. Close the tab and press View as again.");
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        // Verify BEFORE storing, so a dead token never lands in the tab and
        // never trips the sign-out path on the next page.
        const res = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (cancelled) return;

        if (!res.ok) {
          setError(
            res.status === 401
              ? "This support token has expired — they last 15 minutes. Press View as again."
              : `The hotel refused this support token (${res.status}). Nothing was changed.`,
          );
          return;
        }

        sessionStorage.setItem("mise_token", token);
        // These two only suppress a tour in the operator's own browser, so they
        // stay in localStorage, where they are read from.
        try {
          localStorage.setItem("mise.tour.done", "1");
          localStorage.setItem("mise.setup.done", "1");
        } catch {
          /* private mode — a tour is survivable */
        }
        window.location.replace("/dashboard");
      } catch {
        if (!cancelled) setError("Could not reach DineAI to check the support token.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center bg-[#0b1220] p-6 text-white">
      {error ? (
        <div className="max-w-sm text-center">
          <p className="text-2xl" aria-hidden>🔒</p>
          <p className="mt-3 text-sm leading-relaxed text-white/80">{error}</p>
          <p className="mt-4 text-xs text-white/40">
            Your Control Room session is untouched — this tab has its own.
          </p>
        </div>
      ) : (
        <p className="text-sm text-white/70">Opening read-only support view…</p>
      )}
    </div>
  );
}
