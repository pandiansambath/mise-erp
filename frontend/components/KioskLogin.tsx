"use client";

// Setting up the tablet by the door.
//
// One credential per restaurant, for a device rather than a person. The
// password is shown exactly once — it is hashed at rest and there is no way to
// read it back, which is deliberate: a screen anyone can walk up to must not
// be able to reveal its own login. Rotating is one tap, so losing it costs
// nothing.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

type Status = {
  exists: boolean;
  email: string;
  is_active: boolean;
  last_login: string | null;
};

export function KioskLogin() {
  const [status, setStatus] = useState<Status | null>(null);
  const [secret, setSecret] = useState<{ email: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get<Status>("/auth/kiosk")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function rotate() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ email: string; password: string }>("/auth/kiosk", {});
      setSecret(r);
      setStatus(await api.get<Status>("/auth/kiosk"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not set up the tablet login.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  return (
    <section className="mise-feel mb-6 rounded-2xl border border-line bg-glass/[0.03] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">📟</span>
        <h3 className="font-semibold text-fg">Attendance tablet</h3>
        <span className="text-xs text-fg-faint">
          a screen by the door where staff clock in and out
        </span>
      </div>
      <p className="mt-1.5 max-w-prose text-xs leading-relaxed text-fg-faint">
        Its own login, for the device rather than a person. It can record
        attendance and read staff names — and nothing else. No wages, no money,
        no reports, whatever anyone taps.
      </p>

      {status.exists && (
        <p className="mt-3 font-mono text-[11px] text-fg-soft">
          {status.email}
          <span className="ml-2 text-fg-faint">
            · {status.last_login ? `last used ${new Date(status.last_login).toLocaleString()}` : "never used"}
          </span>
        </p>
      )}

      {/* Shown once, then gone for good. */}
      {secret && (
        <div className="mise-pop mt-3 rounded-xl border border-brand-400/40 bg-brand-400/[0.08] p-3.5">
          <p className="text-xs font-medium text-brand-200">
            Sign the tablet in with these — this password is shown once
          </p>
          <p className="mt-2 break-all font-mono text-sm text-fg">{secret.email}</p>
          <p className="mt-1 font-mono text-lg font-semibold tracking-wider text-fg">
            {secret.password}
          </p>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard
                ?.writeText(`${secret.email}\n${secret.password}`)
                .then(() => setCopied(true))
                .catch(() => setCopied(false));
            }}
            className="mise-press mt-2.5 rounded-lg border border-brand-400/40 px-3 py-1.5 text-xs font-medium text-brand-200"
          >
            {copied ? "copied ✓" : "Copy both"}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            Open <b className="text-fg-soft">/kiosk</b> on the tablet and sign in there. If you
            lose this, make a new one — it costs nothing.
          </p>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

      <button
        type="button"
        onClick={rotate}
        disabled={busy}
        className="mise-press mt-3 rounded-lg border border-line-2 px-3.5 py-2 text-sm font-medium text-fg-soft transition hover:border-brand-400/50 hover:text-brand-300 disabled:opacity-50"
      >
        {busy
          ? "Working…"
          : status.exists
            ? "New password for the tablet"
            : "Set up the attendance tablet"}
      </button>
    </section>
  );
}
