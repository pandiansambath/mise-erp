"use client";

// The attendance screen, set up in one place.
//
// His design after testing the first attempt: **one door, a PIN**. Open
// `<hotel>.dineai.cloud/kiosk` on the tablet, type the PIN, done. No second
// login, no credentials to copy, nothing on the Roles page.
//
// The PIN is generated rather than chosen — a PIN somebody invents is 1234, or
// the year, or the door code they already use everywhere else. It is hashed,
// so this screen can show a NEW one and never an old one; losing it costs one
// tap.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type LockStatus = { has_pin: boolean; can_manage: boolean };

export function AttendanceLock() {
  const { hotel } = useAuth();
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "pin" | null>(null);

  useEffect(() => {
    api
      .get<LockStatus>("/attendance/lock")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  // The exact address to open on the tablet. Built from the hotel's handle so
  // it is the thing they can actually type, not a description of it.
  const kioskUrl = (() => {
    if (typeof window === "undefined") return "";
    const host = window.location.hostname;
    const handle = hotel?.username;
    if (!handle || host === "localhost" || /^\d+(\.\d+){3}$/.test(host)) {
      return `${window.location.origin}/kiosk`;
    }
    const apex = host.split(".").slice(-2).join(".");
    return `${window.location.protocol}//${handle}.${apex}/kiosk`;
  })();

  // What the wall tablet may show besides clocking in and out. Decided here
  // because generating the PIN is the one moment the owner is already
  // thinking about what that screen is for.
  const [showRota, setShowRota] = useState(false);
  const [showLeave, setShowLeave] = useState(false);

  function suggest() {
    setPin(String(Math.floor(100000 + Math.random() * 900000)));
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/attendance/lock/pin", { password, pin, show_rota: showRota, show_leave: showLeave });
      setShown(pin);
      setStatus({ has_pin: true, can_manage: true });
      setOpen(false);
      setPin("");
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the PIN.");
    } finally {
      setBusy(false);
    }
  }

  function copy(what: "link" | "pin", text: string) {
    navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(what))
      .catch(() => setCopied(null));
  }

  if (!status) return null;

  return (
    <section className="mise-feel mb-5 rounded-2xl border border-brand-400/25 bg-brand-400/[0.04] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">🕰</span>
        <h3 className="font-semibold text-fg">The attendance screen</h3>
        <span className="text-xs text-fg-faint">a tablet by the door for clocking in and out</span>
      </div>

      {/* Three sentences, in order, because this is the bit he had to work out
          for himself last time. */}
      <ol className="mt-3 max-w-prose space-y-1.5 text-xs leading-relaxed text-fg-soft">
        <li>
          <b className="text-fg">1.</b> Set a PIN below — it is generated for you.
        </li>
        <li>
          <b className="text-fg">2.</b> On the tablet, open{" "}
          <b className="break-all font-mono text-brand-300">{kioskUrl}</b>
        </li>
        <li>
          <b className="text-fg">3.</b> Type the PIN. That is it — no login, and the screen can
          only clock people in and out. The same PIN closes it again.
        </li>
      </ol>

      {/* Shown once, right after it is set. */}
      {shown && (
        <div className="mise-pop mt-4 rounded-xl border border-brand-400/40 bg-brand-400/[0.09] p-4">
          <p className="text-xs font-medium text-brand-200">
            Your PIN — write it down, it is not shown again
          </p>
          <p className="mt-1.5 font-mono text-3xl font-semibold tracking-[0.3em] text-fg">
            {shown}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copy("pin", shown)}
              className="mise-press rounded-lg border border-brand-400/40 px-3 py-1.5 text-xs font-medium text-brand-200"
            >
              {copied === "pin" ? "copied ✓" : "Copy PIN"}
            </button>
            <button
              type="button"
              onClick={() => copy("link", kioskUrl)}
              className="mise-press rounded-lg border border-brand-400/40 px-3 py-1.5 text-xs font-medium text-brand-200"
            >
              {copied === "link" ? "copied ✓" : "Copy the tablet link"}
            </button>
          </div>
        </div>
      )}

      {!open && (
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={kioskUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
          >
            🕰 Open the attendance screen ↗
          </a>
          <button
            type="button"
            onClick={() => copy("link", kioskUrl)}
            className="mise-press rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft"
          >
            {copied === "link" ? "copied ✓" : "Copy the link"}
          </button>
          {status.can_manage && (
            <button
              type="button"
              onClick={() => { setOpen(true); suggest(); setError(null); }}
              className="mise-press rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft"
            >
              {status.has_pin ? "New PIN" : "Set the PIN"}
            </button>
          )}
          {!status.has_pin && (
            <p className="w-full text-xs text-amber-300">
              No PIN yet — set one before the tablet can open the screen.
            </p>
          )}
        </div>
      )}

      {open && (
        <div className="mt-4 max-w-xs space-y-2">
          <div>
            <label className="block text-xs font-medium text-fg-soft">PIN</label>
            <div className="mt-1 flex gap-2">
              <input
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                inputMode="numeric"
                className="mise-well w-full rounded-xl px-3 py-2.5 text-center font-mono text-xl tracking-[0.3em] outline-none"
              />
              <button
                type="button"
                onClick={suggest}
                title="Generate another"
                className="mise-press shrink-0 rounded-xl border border-line-2 px-3 text-sm text-fg-soft"
              >
                ↻
              </button>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-soft">Your password</label>
            {/* A code that unlocks a screen must not be changeable by whoever
                happens to be sitting at an unlocked one. */}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="to confirm it is you"
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </div>
          {/* What the screen may show besides clocking in and out.
              Both start OFF: a tablet by the door is read by everyone who
              walks past it, and who is on leave today is more than some
              kitchens want on display. Off is the choice you can reverse. */}
          <div className="rounded-xl border border-line bg-paper-2/50 p-3">
            <p className="text-xs font-medium text-fg-soft">What the screen may show</p>
            {([
              ["rota", "Today's rota", "who is working, and their hours", showRota, setShowRota],
              ["leave", "Who is off", "today's approved leave", showLeave, setShowLeave],
            ] as const).map(([key, label, hint, val, set]) => (
              <label key={key} className="mt-2 flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={val}
                  onChange={(e) => set(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-fg">{label}</span>
                  <span className="block text-[11px] text-fg-faint">{hint}</span>
                </span>
              </label>
            ))}
          </div>

          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={busy || pin.length < 4 || !password}
              className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save PIN"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setPin(""); setPassword(""); setError(null); }}
              className="rounded-xl px-4 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
