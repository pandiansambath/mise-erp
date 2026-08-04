"use client";

// The door. A boot log that types itself out while the album actually loads
// behind it.
//
// The important word is "actually". A fake progress bar that finishes on a timer
// is the oldest trick on the web and it always shows: the bar hits 100% and then
// the first photo still pops in grey. So the bar here is driven by real image
// onload events — 34 of them — and the ENTER state is not reachable until every
// thumbnail is decoded and sitting in the browser cache. Opening the album after
// that is instant because there is nothing left to fetch.
//
// It also can't hang. If the network is dead or a file 404s, each image resolves
// either way and a hard timeout releases the door regardless — a portfolio that
// traps you on a loading screen is worse than one with slow photos.

import { useEffect, useRef, useState } from "react";

const LINES = [
  "$ ssh pandi-dev.dineai.cloud",
  "authenticating…  [ok]",
  "mounting /dev/pandian",
  "syncing chain — verifying blocks",
];

/** Never leave someone stuck behind the door, whatever the network does. */
const MAX_WAIT_MS = 9000;

export function BootSequence({
  photoUrls,
  onEnter,
}: {
  photoUrls: string[];
  onEnter: () => void;
}) {
  const [typed, setTyped] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const total = photoUrls.length;

  // ── Type the boot log ──────────────────────────────────────────────────
  useEffect(() => {
    let line = 0;
    let char = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled || line >= LINES.length) return;
      const text = LINES[line];
      char += 1;
      setCurrent(text.slice(0, char));
      if (char >= text.length) {
        setTyped((t) => [...t, text]);
        setCurrent("");
        line += 1;
        char = 0;
        setTimeout(tick, 170);
      } else {
        setTimeout(tick, 22 + Math.random() * 26);
      }
    };
    const id = setTimeout(tick, 240);
    return () => { cancelled = true; clearTimeout(id); };
  }, []);

  // ── Actually fetch every thumbnail ─────────────────────────────────────
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;

    let done = 0;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        setReady(true);
      }
    };

    if (total === 0) {
      release();
      return;
    }

    photoUrls.forEach((src) => {
      const img = new Image();
      // Resolve on BOTH events: a 404 must still advance the counter, or one
      // missing file locks the door forever.
      const settle = () => {
        done += 1;
        setLoaded(done);
        if (done >= total) release();
      };
      img.onload = settle;
      img.onerror = settle;
      img.src = src;
    });

    const bail = setTimeout(release, MAX_WAIT_MS);
    return () => clearTimeout(bail);
  }, [photoUrls, total]);

  const enter = () => {
    if (!ready || leaving) return;
    setLeaving(true);
    // Let the door animation play before the page underneath takes over.
    setTimeout(onEnter, 620);
  };

  // Enter/Space works too — this is a developer's page, the keyboard should work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); enter(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const pct = total ? Math.round((loaded / total) * 100) : 100;

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center bg-[#070a0f] px-6 transition-all duration-[600ms] ${
        leaving ? "pointer-events-none scale-[1.06] opacity-0 blur-sm" : ""
      }`}
    >
      <div className="w-full max-w-lg font-mono text-[13px] leading-relaxed">
        {typed.map((l) => (
          <p key={l} className="text-[#7d93ad]">
            <span className="text-[#d97742]">›</span> {l}
          </p>
        ))}
        {current && (
          <p className="text-[#7d93ad]">
            <span className="text-[#d97742]">›</span> {current}
            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-[#d97742]" />
          </p>
        )}

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[11px] text-[#5b6e85]">
            <span>blocks verified</span>
            <span className="tabular-nums text-[#7d93ad]">
              {loaded}/{total}
            </span>
          </div>
          <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[#16202c]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#d97742] to-[#f0a064] transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-7 h-11">
          {ready ? (
            <button
              onClick={enter}
              autoFocus
              className="group relative overflow-hidden rounded-lg border border-[#d97742]/40 bg-[#d97742]/10 px-6 py-2.5 text-[13px] font-semibold tracking-[0.18em] text-[#f0a064] transition-all duration-300 hover:border-[#d97742] hover:bg-[#d97742]/20 hover:tracking-[0.26em]"
              style={{ animation: "devFadeUp .5s ease-out both" }}
            >
              <span className="relative z-10">ENTER</span>
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[#d97742]/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
          ) : (
            <p className="text-[11px] tracking-[0.2em] text-[#3f4f61]">
              PLEASE WAIT…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
