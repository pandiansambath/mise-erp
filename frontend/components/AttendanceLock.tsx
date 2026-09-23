"use client";

// The attendance screen, set up in one place.
//
// His design after testing the first attempt: **one door, a PIN**. Open
// `<hotel>.dineai.cloud/kiosk` on the tablet, type the PIN, done. No second
// login, no credentials to copy, nothing on the Roles page.
//
// ⚠️ IT USED TO DEMAND A NEW PIN EVERY SINGLE TIME.
//
//     "why everytime it asking to create pin... let use previous pin...if
//      needed means we can create new pin.. pelaes chnage this UI alos"
//
// Two causes, both fixed — one in the storage and one here:
//
//  1. The PIN was hashed and nothing else, so the panel was PHYSICALLY unable
//     to answer "what is my PIN?". Generating another was the only move it
//     had. There is now a second, encrypted copy kept purely so the owner can
//     be told their own door code (see `attendance_lock.recall`).
//
//  2. This form did two unrelated jobs behind one required PIN field — set a
//     code, and choose what the screen displays. So opening it to tick "show
//     the rota" invalidated the code taped to the tablet. They are separate
//     now: the display settings save on the spot, and replacing the PIN is a
//     deliberate, separate act.

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { THEMES, useTheme, type ThemeKey } from "@/lib/theme";
import { useAuth } from "@/lib/auth";

type LockStatus = {
  has_pin: boolean;
  /** Whether the stored PIN can be shown again — older ones cannot. */
  can_show: boolean;
  can_manage: boolean;
  show_rota?: boolean;
  show_leave?: boolean;
  theme?: string;
};

/** Which of the two password-gated flows is open, if either. */
type Flow = null | "show" | "new";

export function AttendanceLock() {
  const { hotel } = useAuth();
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [flow, setFlow] = useState<Flow>(null);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "pin" | null>(null);

  const { theme: appTheme } = useTheme();
  const [showRota, setShowRota] = useState(false);
  const [showLeave, setShowLeave] = useState(false);
  const [kioskTheme, setKioskTheme] = useState<ThemeKey>(appTheme);
  const [savedTick, setSavedTick] = useState(false);

  useEffect(() => {
    api
      .get<LockStatus>("/attendance/lock")
      .then((s) => {
        setStatus(s);
        setShowRota(!!s.show_rota);
        setShowLeave(!!s.show_leave);
        if (s.theme && s.theme in THEMES) setKioskTheme(s.theme as ThemeKey);
      })
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

  function suggest() {
    setPin(String(Math.floor(100000 + Math.random() * 900000)));
  }

  /** Display settings only. NO PIN, NO PASSWORD — see the note at the top. */
  async function saveDisplay(
    next: Partial<{ rota: boolean; leave: boolean; theme: ThemeKey }>,
  ) {
    const body = {
      show_rota: next.rota ?? showRota,
      show_leave: next.leave ?? showLeave,
      theme: next.theme ?? kioskTheme,
    };
    if (next.rota !== undefined) setShowRota(next.rota);
    if (next.leave !== undefined) setShowLeave(next.leave);
    if (next.theme !== undefined) setKioskTheme(next.theme);
    try {
      await api.post("/attendance/lock/pin", body);
      setSavedTick(true);
      window.setTimeout(() => setSavedTick(false), 1400);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save that.");
    }
  }

  async function reveal() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ pin: string | null; why?: string }>(
        "/attendance/lock/reveal",
        { password },
      );
      if (r.pin) {
        setShown(r.pin);
        setNote(null);
      } else {
        setShown(null);
        setNote(r.why ?? "That PIN cannot be shown.");
      }
      setFlow(null);
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not show the PIN.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNew() {
    setBusy(true);
    setError(null);
    try {
      await api.post("/attendance/lock/pin", {
        password,
        pin,
        show_rota: showRota,
        show_leave: showLeave,
        theme: kioskTheme,
      });
      setShown(pin);
      setNote(null);
      setStatus((s) => (s ? { ...s, has_pin: true, can_show: true } : s));
      setFlow(null);
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

  const btn =
    "mise-press rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft";

  return (
    <section className="mise-feel mb-5 rounded-2xl border border-brand-400/25 bg-brand-400/[0.04] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">🕰</span>
        <h3 className="font-semibold text-fg">The attendance screen</h3>
        <span className="text-xs text-fg-faint">
          a tablet by the door for clocking in and out
        </span>
      </div>

      {/* The steps read differently once a PIN exists — telling somebody to
          "set a PIN" when they already have one is what made this feel like it
          was asking again on every visit. */}
      <ol className="mt-3 max-w-prose space-y-1.5 text-xs leading-relaxed text-fg-soft">
        <li>
          <b className="text-fg">1.</b>{" "}
          {status.has_pin
            ? "Your PIN is already set — keep using it. Show it below if you have forgotten it."
            : "Set a PIN below — it is generated for you."}
        </li>
        <li>
          <b className="text-fg">2.</b> On the tablet, open{" "}
          <b className="break-all font-mono text-brand-300">{kioskUrl}</b>
        </li>
        <li>
          <b className="text-fg">3.</b> Type the PIN. That is it — no login, and the screen
          can only clock people in and out. The same PIN closes it again.
        </li>
      </ol>

      {/* The PIN itself, once it has been asked for. */}
      {shown && (
        <div className="mise-pop mt-4 rounded-xl border border-brand-400/40 bg-brand-400/[0.09] p-4">
          <p className="text-xs font-medium text-brand-200">Your PIN</p>
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
              onClick={() => setShown(null)}
              className="mise-press rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Hide
            </button>
          </div>
        </div>
      )}

      {note && (
        <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-xs text-amber-300">
          {note}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={kioskUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
        >
          🕰 Open the attendance screen ↗
        </a>
        <button type="button" onClick={() => copy("link", kioskUrl)} className={btn}>
          {copied === "link" ? "copied ✓" : "Copy the link"}
        </button>

        {status.can_manage && status.has_pin && status.can_show && (
          <button
            type="button"
            onClick={() => {
              setFlow("show");
              setError(null);
              setPassword("");
            }}
            className={btn}
          >
            Show the PIN
          </button>
        )}
        {status.can_manage && (
          <button
            type="button"
            onClick={() => {
              setFlow("new");
              suggest();
              setError(null);
              setPassword("");
            }}
            // Quieter than the rest once a PIN exists: replacing the code means
            // walking to the tablet, so it must not be the obvious thing to press.
            className={
              status.has_pin
                ? "mise-press rounded-xl px-4 py-2.5 text-sm text-fg-faint underline hover:text-fg"
                : "mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            }
          >
            {status.has_pin ? "Replace it with a new PIN" : "Set the PIN"}
          </button>
        )}
        {!status.has_pin && (
          <p className="w-full text-xs text-amber-300">
            No PIN yet — set one before the tablet can open the screen.
          </p>
        )}
      </div>

      {/* ── one password field, two meanings ─────────────────────────────── */}
      {flow && (
        <div className="mise-pop mt-4 max-w-xs space-y-2 rounded-xl border border-line bg-paper-2/50 p-3">
          {flow === "new" && (
            <div>
              <label className="block text-xs font-medium text-fg-soft">The new PIN</label>
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
              <p className="mt-1 text-[11px] text-amber-300">
                This replaces the PIN on the tablet. Anyone using the old one will be
                locked out.
              </p>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-fg-soft">Your password</label>
            {/* Being shown a door code and being able to change one are the
                same capability from the point of view of somebody sitting at
                an unattended screen, so both flows ask. */}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="to confirm it is you"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && password) {
                  if (flow === "show") reveal();
                  else saveNew();
                }
              }}
              className="mise-well mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={flow === "show" ? reveal : saveNew}
              disabled={busy || !password || (flow === "new" && pin.length < 6)}
              className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "…" : flow === "show" ? "Show it" : "Save the new PIN"}
            </button>
            <button
              type="button"
              onClick={() => {
                setFlow(null);
                setPin("");
                setPassword("");
                setError(null);
              }}
              className="rounded-xl px-4 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── what the screen shows: its own thing, saved on the spot ──────── */}
      {status.can_manage && (
        <div className="mt-4 max-w-sm rounded-xl border border-line bg-paper-2/50 p-3">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-medium text-fg-soft">What the screen may show</p>
            {savedTick && <span className="text-[11px] text-brand-300">saved ✓</span>}
          </div>
          {/* Both start OFF: a tablet by the door is read by everyone who
              walks past it, and who is on leave today is more than some
              kitchens want on display. Off is the choice you can reverse. */}
          {(
            [
              ["rota", "Today's rota", "who is working, and their hours", showRota],
              ["leave", "Who is off", "today's approved leave", showLeave],
            ] as const
          ).map(([key, label, hint, val]) => (
            <label key={key} className="mt-2 flex cursor-pointer items-start gap-2.5">
              <input
                type="checkbox"
                checked={val}
                onChange={(e) =>
                  saveDisplay(
                    key === "rota" ? { rota: e.target.checked } : { leave: e.target.checked },
                  )
                }
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
              />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-fg">{label}</span>
                <span className="block text-[11px] text-fg-faint">{hint}</span>
              </span>
            </label>
          ))}

          <p className="mt-3 text-xs font-medium text-fg-soft">How it should look</p>
          <p className="text-[11px] text-fg-faint">
            Starts as your own theme. Anyone at the tablet can change it for that device.
          </p>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {(Object.keys(THEMES) as ThemeKey[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => saveDisplay({ theme: k })}
                title={THEMES[k].label}
                aria-label={THEMES[k].label}
                className={`grid h-8 place-items-center rounded-lg ring-1 ${
                  k === kioskTheme ? "ring-brand-400" : "ring-glass/20"
                }`}
                style={{ background: THEMES[k].surfaces[1] }}
              >
                <span
                  className="h-3 w-3 rounded-full"
                  style={{ background: THEMES[k].brand["500"] }}
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
