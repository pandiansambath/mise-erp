"use client";

// Shared pieces for the auth funnel (login / signup) — the first screens a
// trialing owner touches after the landing page, so they carry the same
// cinematic DNA: film-still backdrop, aurora, tactile inputs.

import { useState } from "react";

export const authInput =
  "w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-500/20";

export const authLabel = "block text-sm font-medium text-slate-300";

/** Cinematic backdrop: a heavily-veiled film still + aurora + dot grid. */
export function AuthBackdrop({ still = "table" }: { still?: string }) {
  return (
    <>
      <img
        src={`/experience/${still}.jpg`}
        alt=""
        decoding="async"
        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-[0.22]"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950/70 via-ink-950/45 to-ink-950" />
      <div className="mise-aurora mise-aurora-shift">
        <span style={{ left: "-10%", top: "-15%", width: 540, height: 540, background: "radial-gradient(circle, #10b981, transparent 68%)" }} />
        <span style={{ right: "-12%", bottom: "-20%", width: 500, height: 500, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "8s" }} />
      </div>
      <div className="mise-dots pointer-events-none absolute inset-0" />
    </>
  );
}

/** Password field with show/hide and a caps-lock warning. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete = "current-password",
  placeholder = "••••••••",
  minLength,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
  minLength?: number;
}) {
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div className="mt-1.5">
      <div className="relative">
        <input
          id={id}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
          onBlur={() => setCaps(false)}
          required
          minLength={minLength}
          placeholder={placeholder}
          className={`${authInput} pr-11`}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          className="mise-press absolute right-1.5 top-1/2 grid h-7 w-8 -translate-y-1/2 place-items-center rounded-lg text-sm text-slate-400 transition hover:bg-white/5 hover:text-white"
        >
          {show ? "🙈" : "👁"}
        </button>
      </div>
      {caps && (
        <p className="mise-pop mt-1.5 text-[11px] font-medium text-amber-300">⇪ Caps Lock is on</p>
      )}
    </div>
  );
}

/** Primary submit: shine sweep, press-down, spinner morphs in while busy. */
export function SubmitButton({
  busy,
  busyLabel,
  children,
}: {
  busy: boolean;
  busyLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="mise-btn-shine mise-press w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-3 text-sm font-semibold text-ink-950 shadow-xl shadow-brand-500/25 transition hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-brand-400/30 disabled:translate-y-0 disabled:opacity-75"
    >
      <span className="flex items-center justify-center gap-2.5">
        {busy && (
          <span className="mise-pop h-4 w-4 animate-spin rounded-full border-2 border-ink-950/25 border-t-ink-950" aria-hidden />
        )}
        {busy ? busyLabel : children}
      </span>
    </button>
  );
}
