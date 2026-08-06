"use client";

// Turning this device into the attendance screen.
//
// Two ways into the same room, and the page says so plainly:
//
//   1. **The PIN** — fastest. Any signed-in device becomes the attendance
//      screen when somebody types the restaurant's PIN. Nothing to set up.
//   2. **The tablet login** — for a device that lives on the wall and should
//      come back to the attendance screen on its own after a reboot.
//
// Both end at the same place, on the same sealed permissions, which is why it
// is worth saying they are the same feature rather than leaving somebody to
// wonder which one they were supposed to use.
//
// The PIN route is not a screen lock. Unlocking REPLACES this tab's token with
// an attendance-only one, so the tablet on the counter is not somebody's admin
// session behind a modal — the credential in it genuinely cannot reach the
// money, however hard it is poked.

import { useEffect, useState } from "react";
import { api, ApiError, setTabToken } from "@/lib/api";

type LockStatus = { has_pin: boolean; can_manage: boolean };

export function AttendanceLock() {
  const [status, setStatus] = useState<LockStatus | null>(null);
  const [mode, setMode] = useState<"idle" | "unlock" | "setpin">("idle");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .get<LockStatus>("/attendance/lock")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function unlock() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ token: string }>("/attendance/lock/unlock", { pin });
      // THIS TAB only. The person who typed the PIN keeps their own session
      // everywhere else — they have simply handed this one screen over.
      setTabToken(r.token);
      window.location.assign("/kiosk");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not unlock.");
      setBusy(false);
    }
  }

  async function savePin() {
    if (pin !== pin2) {
      setError("The two PINs do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/attendance/lock/pin", { password, pin });
      setSaved(true);
      setStatus({ ...(status ?? { can_manage: true }), has_pin: true } as LockStatus);
      setMode("idle");
      setPin("");
      setPin2("");
      setPassword("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not save the PIN.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const pinField =
    "mise-well w-full rounded-xl px-3 py-2.5 text-center font-mono text-xl tracking-[0.35em] outline-none";

  return (
    <section className="mise-feel mb-5 rounded-2xl border border-brand-400/25 bg-brand-400/[0.04] p-5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span aria-hidden className="text-lg">📟</span>
        <h3 className="font-semibold text-fg">Attendance screen</h3>
        <span className="text-xs text-fg-faint">
          turn a tablet into the clock-in screen by the door
        </span>
      </div>

      {/* Say plainly that these are two doors to one room. */}
      <p className="mt-2 max-w-prose text-xs leading-relaxed text-fg-faint">
        Two ways in, same screen and same locked-down access either way —{" "}
        <b className="text-fg-soft">the PIN</b> turns whatever device you are holding into the
        attendance screen right now, and <b className="text-fg-soft">the tablet login</b> (on{" "}
        <b className="text-fg-soft">Roles &amp; Access</b>) suits a device that lives on the wall
        and should come back to this screen on its own after a reboot. Neither can see wages,
        money or reports.
      </p>

      {saved && (
        <p className="mt-3 rounded-lg bg-brand-400/10 px-3 py-2 text-xs text-brand-300">
          PIN saved. Anyone with it can now open the attendance screen.
        </p>
      )}

      {mode === "idle" && (
        <div className="mt-4 flex flex-wrap gap-2">
          {status.has_pin ? (
            <button
              type="button"
              onClick={() => { setMode("unlock"); setError(null); }}
              className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
            >
              📟 Open attendance view
            </button>
          ) : (
            <p className="text-xs text-amber-300">
              No PIN yet — the owner sets one before this screen can be opened.
            </p>
          )}
          {status.can_manage && (
            <button
              type="button"
              onClick={() => { setMode("setpin"); setError(null); }}
              className="mise-press rounded-xl border border-line-2 px-4 py-2.5 text-sm font-medium text-fg-soft"
            >
              {status.has_pin ? "Change the PIN" : "Set the PIN"}
            </button>
          )}
        </div>
      )}

      {mode === "unlock" && (
        <div className="mt-4 max-w-xs">
          <label className="block text-xs font-medium text-fg-soft">Attendance PIN</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
            inputMode="numeric"
            autoFocus
            placeholder="••••"
            className={`${pinField} mt-1`}
          />
          <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
            This tab becomes the attendance screen. Your own session elsewhere is untouched, and
            the same PIN is needed to leave it.
          </p>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={unlock}
              disabled={busy || pin.length < 4}
              className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Opening…" : "Open"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setPin(""); setError(null); }}
              className="rounded-xl px-4 py-2.5 text-sm text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "setpin" && (
        <div className="mt-4 max-w-xs space-y-2">
          <div>
            <label className="block text-xs font-medium text-fg-soft">New PIN (4–8 digits)</label>
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              autoFocus
              className={`${pinField} mt-1`}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-soft">Again</label>
            <input
              value={pin2}
              onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 8))}
              inputMode="numeric"
              className={`${pinField} mt-1`}
            />
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
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={savePin}
              disabled={busy || pin.length < 4 || !password}
              className="mise-press flex-1 rounded-xl bg-brand-600 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : "Save PIN"}
            </button>
            <button
              type="button"
              onClick={() => { setMode("idle"); setPin(""); setPin2(""); setPassword(""); setError(null); }}
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
