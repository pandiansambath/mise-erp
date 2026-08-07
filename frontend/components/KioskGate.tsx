"use client";

// The door to the attendance screen.
//
// A tablet on the wall, nobody signed in. Type the restaurant's PIN and the
// screen opens. That is the whole thing — his design, after two sign-in
// mechanisms confused us both.
//
// It is a real keypad, not a text field. The device is held by somebody
// standing up, often one-handed, sometimes with wet hands, and a phone
// keyboard sliding over half the screen to enter four digits is the wrong
// tool. Big round keys, no keyboard, no autocorrect.

import { useCallback, useEffect, useState } from "react";
import { API_BASE, setTabToken } from "@/lib/api";
import { themeVars } from "@/lib/theme";

/** How many dots to show at rest — the length `suggest()` generates. */
const PIN_SLOTS = 6;

/** The restaurant handle, taken from <handle>.dineai.cloud. */
function siteFromHost(): string {
  if (typeof window === "undefined") return "";
  const host = window.location.hostname.toLowerCase();
  const parts = host.split(".");
  if (parts.length < 3) return ""; // apex or localhost — no handle to read
  const sub = parts[0];
  return sub === "www" ? "" : sub;
}

export function KioskGate({ onOpen }: { onOpen: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [site, setSite] = useState("");

  useEffect(() => setSite(siteFromHost()), []);

  const submit = useCallback(
    async (value: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`${API_BASE}/api/attendance/kiosk-open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ site: siteFromHost(), pin: value }),
        });
        if (!res.ok) {
          setPin("");
          setError(
            res.status === 403
              ? "That PIN is not right."
              : "Could not open the attendance screen.",
          );
          return;
        }
        const body = (await res.json()) as { token: string };
        // Tab-scoped, so the tablet holds an attendance-only session and
        // nothing else — see lib/api.ts.
        setTabToken(body.token);
        onOpen();
      } catch {
        setError("Could not reach DineAI.");
      } finally {
        setBusy(false);
      }
    },
    [onOpen],
  );

  function press(d: string) {
    if (busy) return;
    const next = (pin + d).slice(0, 8);
    setPin(next);
    setError(null);
  }

  // A physical keyboard should still work — somebody will plug one in.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter" && pin.length >= 4) submit(pin);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    // Pinned dark, like the screen behind it — the account's theme must not
    // reach a device bolted to a wall in a kitchen.
    <div
      className="mise-app grid min-h-dvh place-items-center bg-shell px-6 py-10 text-fg"
      data-mode="dark"
      style={themeVars("dark")}
    >
      {/* Light behind the glass, so a wall screen at rest still looks alive. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <span
          className="absolute -left-40 -top-40 h-[36rem] w-[36rem] rounded-full opacity-25 blur-[130px]"
          style={{ background: "radial-gradient(circle, var(--color-brand-500), transparent 68%)" }}
        />
        <span
          className="absolute -bottom-48 -right-40 h-[32rem] w-[32rem] rounded-full opacity-20 blur-[130px]"
          style={{ background: "radial-gradient(circle, #38bdf8, transparent 70%)" }}
        />
      </div>

      <div className="relative w-full max-w-xs text-center">
        <p className="text-4xl" aria-hidden>🕰</p>
        <h1 className="mt-3 font-display text-2xl font-semibold tracking-tight">
          Attendance screen
        </h1>
        <p className="mt-1 text-sm text-fg-faint">
          {site ? `${site} · enter the PIN` : "Enter the PIN"}
        </p>

        {/* Dots, not digits. Somebody is always standing behind you.
            SIX of them, because that is the length DineAI generates — four
            slots in front of a six-digit PIN reads as "it will not fit", and
            that is exactly how it read. It still grows to eight for a longer
            one somebody set by hand. */}
        <div className="mt-7 flex justify-center gap-3" aria-hidden>
          {Array.from({ length: Math.max(PIN_SLOTS, pin.length) }, (_, i) => (
            <span
              key={i}
              className={`h-3.5 w-3.5 rounded-full transition ${
                i < pin.length ? "scale-110 bg-brand-400" : "bg-white/15"
              }`}
            />
          ))}
        </div>

        <p className="mt-4 h-5 text-sm text-rose-300">{error ?? ""}</p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => press(d)}
              className="mise-press grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] font-display text-2xl font-semibold transition hover:bg-white/[0.12]"
            >
              {d}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPin((p) => p.slice(0, -1))}
            className="mise-press grid h-16 place-items-center rounded-2xl text-xl text-fg-faint transition hover:bg-white/[0.06]"
            aria-label="Delete"
          >
            ⌫
          </button>
          <button
            type="button"
            onClick={() => press("0")}
            className="mise-press grid h-16 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] font-display text-2xl font-semibold transition hover:bg-white/[0.12]"
          >
            0
          </button>
          <button
            type="button"
            onClick={() => submit(pin)}
            disabled={busy || pin.length < 4}
            className="mise-press grid h-16 place-items-center rounded-2xl bg-brand-600 text-xl font-semibold text-white transition hover:bg-brand-500 disabled:opacity-30"
            aria-label="Open"
          >
            {busy ? "…" : "→"}
          </button>
        </div>

        {!site && (
          <p className="mt-6 text-[11px] leading-relaxed text-fg-faint">
            Open this on your restaurant&apos;s own address —{" "}
            <b className="text-fg-soft">yourhotel.dineai.cloud/kiosk</b> — so the screen knows
            which kitchen it belongs to.
          </p>
        )}
      </div>
    </div>
  );
}
