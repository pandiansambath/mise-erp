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
import { useWord } from "./context";
import { listOf } from "./words";

/** Never leave someone stuck behind the door, whatever the network does. */
const MAX_WAIT_MS = 20000;

/** Something else to have in the cache before the door opens: the music, the
 *  award room's engine and model, the portraits. "make sure we're loading all
 *  the stuff before entering… so that there won't be lag". */
export type BootTask = () => Promise<unknown>;

export function BootSequence({
  photoUrls,
  tasks = [],
  onEnter,
}: {
  photoUrls: string[];
  tasks?: BootTask[];
  onEnter: () => void;
}) {
  const [typed, setTyped] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const total = photoUrls.length + tasks.length;
  const w = useWord();
  const [lines] = useState(() => listOf(w("bootLines")));

  // ── Type the boot log ──────────────────────────────────────────────────
  useEffect(() => {
    let line = 0;
    let char = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled || line >= lines.length) return;
      const text = lines[line];
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
  }, [lines]);

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

    // Each task counts as one block whether it succeeds or fails: a missing
    // file must still advance the counter, or it locks the door forever.
    const settle = () => {
      done += 1;
      setLoaded(done);
      if (done >= total) release();
    };
    photoUrls.forEach((src) => {
      const img = new Image();
      img.onload = settle;
      img.onerror = settle;
      img.src = src;
    });
    tasks.forEach((run) => {
      run().then(settle, settle);
    });

    const bail = setTimeout(release, MAX_WAIT_MS);
    return () => clearTimeout(bail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the task list is fixed for the page's life
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
      className={`fixed inset-0 z-50 grid place-items-center bg-[var(--d-bg)] px-6 transition-all duration-[600ms] ${
        leaving ? "pointer-events-none scale-[1.06] opacity-0 blur-sm" : ""
      }`}
    >
      <div className="w-full max-w-lg font-mono text-[13px] leading-relaxed">
        {typed.map((l) => (
          <p key={l} className="text-[var(--d-ink4)]">
            <span className="text-[var(--d-a)]">›</span> {l}
          </p>
        ))}
        {current && (
          <p className="text-[var(--d-ink4)]">
            <span className="text-[var(--d-a)]">›</span> {current}
            <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-[var(--d-a)]" />
          </p>
        )}

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[11px] text-[var(--d-ink5)]">
            <span>{w("bootVerified")}</span>
            <span className="tabular-nums text-[var(--d-ink4)]">
              {loaded}/{total}
            </span>
          </div>
          <div className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-[var(--d-bg2)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[var(--d-a)] to-[var(--d-a2)] transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        <div className="mt-7 h-11">
          {ready ? (
            <button
              onClick={enter}
              autoFocus
              className="group relative overflow-hidden rounded-lg border border-[var(--d-a)]/40 bg-[var(--d-a)]/10 px-6 py-2.5 text-[13px] font-semibold tracking-[0.18em] text-[var(--d-a2)] transition-all duration-300 hover:border-[var(--d-a)] hover:bg-[var(--d-a)]/20 hover:tracking-[0.26em]"
              style={{ animation: "devFadeUp .5s ease-out both" }}
            >
              <span className="relative z-10">{w("bootEnter")}</span>
              <span className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[var(--d-a)]/25 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
            </button>
          ) : (
            <p className="text-[11px] tracking-[0.2em] text-[var(--d-ink7)]">
              {w("bootWait")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
