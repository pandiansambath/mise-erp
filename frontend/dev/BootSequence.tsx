"use client";

// The door. A boot log that types itself out while the album actually loads
// behind it.
//
// The important word is "actually". A fake progress bar that finishes on a timer
// is the oldest trick on the web and it always shows: the bar hits 100% and then
// the first photo still pops in grey. So the bar here is driven by real image
// onload events, and the door does not open until every thumbnail is decoded and
// sitting in the browser cache. Opening the album after that is instant because
// there is nothing left to fetch.
//
// It also can't hang. If the network is dead or a file 404s, each image resolves
// either way and a hard timeout opens the door regardless — a portfolio that
// traps you on a loading screen is worse than one with slow photos.
//
// It opens BY ITSELF (§103.10: "no need [of an] enter button, instead open [the]
// site automatically whenever loading is completed… have a best transition"):
// opening.ts plays the opening; this file says when. Nothing is pressed on the way
// in any more, so the music waits for the first touch anywhere (music.ts).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDev, useWord } from "./context";
import { makeOpening, type Opening } from "./opening";
import { openedBefore, openStage, sealStage, shutStage } from "./stage";
import { findTheme, readRGB } from "./theme";
import { listOf } from "./words";

/** Never leave someone stuck behind the door, whatever the network does. */
const MAX_WAIT_MS = 20000;
/** …and, when everything is there at once, long enough to be seen. */
const LEAST_MS = 1150;

/** Something else to have in the cache before the door opens: the music, the
 *  award room's engine and model, the portraits. "make sure we're loading all
 *  the stuff before entering… so that there won't be lag". */
export type BootTask = () => Promise<unknown>;

const rest = (ms: number) => new Promise<void>((done) => window.setTimeout(done, Math.max(0, ms)));

/** Somebody is looking: a tab opened behind another one opens when it is turned to. */
const seen = () =>
  document.visibilityState === "visible"
    ? Promise.resolve()
    : new Promise<void>((done) => {
        const f = () => {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", f);
          done();
        };
        document.addEventListener("visibilitychange", f);
      });

/** The page has caught its breath: a few frames on time, one after another. */
const calm = (need: number, most: number) =>
  new Promise<void>((done) => {
    const t0 = performance.now();
    let last = t0;
    let n = 0;
    const tick = (now: number) => {
      n = now - last < 36 ? n + 1 : 0;
      last = now;
      if (n >= need || now - t0 > most) done();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** What has just begun to move on the page: held as it will END, so that it is painted
 *  behind the door, all of it — and played, from its first frame, when the door opens. */
function holdNew(): () => void {
  const end = (a: Animation) => Number(a.effect?.getComputedTiming().endTime ?? Infinity);
  const list = (document.getAnimations?.() ?? []).filter((a) => a.timeline === document.timeline && a.playState === "running" && Number(a.currentTime ?? 1e9) < 130 && end(a) < 1e5);
  for (const a of list) {
    a.pause();
    a.currentTime = Math.max(0, end(a) - 1);
  }
  return () => {
    for (const a of list) {
      try {
        a.currentTime = 0;
        a.play();
      } catch {
        /* its element is gone */
      }
    }
  };
}

// The door is opaque to the eye and not quite to the browser: behind something truly
// opaque it paints nothing, and then the whole page was painted for the first time in
// the very moment it opened (0.7 s of it, on his laptop).
const THIN = "color-mix(in srgb, var(--d-bg) 99.7%, transparent)";
const SOLID = "var(--d-bg)";

export function BootSequence({
  photoUrls,
  tasks = [],
  onEnter,
  onDone,
}: {
  photoUrls: string[];
  tasks?: BootTask[];
  /** The page may begin (it is still dark). */
  onEnter: () => void;
  /** The opening is over: the door can be taken away. */
  onDone: () => void;
}) {
  // Coming back from the award room: everything is here already.
  const [again] = useState(openedBefore);
  const [typed, setTyped] = useState<string[]>([]);
  const [current, setCurrent] = useState("");
  const [loaded, setLoaded] = useState(0);
  const [ready, setReady] = useState(false);
  const [sealed, setSealed] = useState(false);
  const total = photoUrls.length + tasks.length;
  const w = useWord();
  const { themeId } = useDev();
  const [lines] = useState(() => listOf(w("bootLines")));

  const door = useRef<HTMLDivElement>(null);
  const sky = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const opening = useRef<Opening | null>(null);
  const born = useRef(0);
  const fast = useRef(false);
  const written = useRef(false);
  const impatient = useRef(false);
  /** The opening has been asked for; the page has been let in. */
  const begun = useRef(false);
  const entered = useRef(false);
  const told = useRef({ onEnter, onDone });
  useEffect(() => {
    told.current = { onEnter, onDone };
  }, [onEnter, onDone]);

  /** No canvas, or no motion wanted: the door simply fades. */
  const fadeAway = useRef((play: () => void) => {
    const el = door.current;
    // (Taken away while the page still loads: it fades when its time comes.)
    if (!begun.current || !el) return;
    if (!entered.current) told.current.onEnter();
    entered.current = true;
    openStage(false);
    play();
    el.style.pointerEvents = "none";
    el.style.transition = "opacity .5s ease";
    el.style.opacity = "0";
    el.dataset.boot = "open";
    window.setTimeout(() => told.current.onDone(), 560);
  });

  // Before anything behind it begins: the door is shut.
  useLayoutEffect(() => {
    shutStage();
    born.current = performance.now();
  }, []);

  // ── Type the boot log (at once, when everything is here before it is done) ──
  useEffect(() => {
    if (again) return;
    let line = 0;
    let char = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (line >= lines.length) {
        written.current = true;
        return;
      }
      const text = lines[line];
      char = Math.min(text.length, char + (fast.current ? 5 : 1));
      setCurrent(text.slice(0, char));
      if (char >= text.length) {
        setTyped((t) => [...t, text]);
        setCurrent("");
        line += 1;
        char = 0;
        setTimeout(tick, fast.current ? 24 : 170);
      } else {
        setTimeout(tick, fast.current ? 12 : 22 + Math.random() * 26);
      }
    };
    const id = setTimeout(tick, 240);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [lines, again]);

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
        fast.current = true;
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
      opening.current?.progress(done / total);
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
    // (Back from the award room: it is all in the cache, nothing to wait for.)
    if (again) release();

    const bail = setTimeout(release, MAX_WAIT_MS);
    return () => clearTimeout(bail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the task list is fixed for the page's life
  }, [photoUrls, total]);

  // ── The opening ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = door.current;
    const cv = sky.current;
    if (!el || !cv || opening.current) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rgb = (role: string, fb: [number, number, number]) => readRGB(el, role, fb);
    let play = () => {};
    opening.current = makeOpening(
      cv,
      {
        a: rgb("a", [217, 119, 66]),
        a2: rgb("a2", [240, 160, 100]),
        b2: rgb("b2", [125, 240, 220]),
        c: rgb("c", [155, 140, 255]),
        gold: rgb("gold", [240, 189, 106]),
        bg: rgb("bg", [7, 10, 15]),
        light: !!findTheme(themeId).light,
      },
      {
        gone: () => {
          if (box.current) box.current.style.visibility = "hidden";
          el.style.background = SOLID;
        },
        dark: () => {
          el.style.background = THIN;
          entered.current = true;
          told.current.onEnter();
          play = holdNew();
        },
        bang: () => {
          el.style.background = "transparent";
          el.style.pointerEvents = "none";
          el.dataset.boot = "open";
          openStage(true);
          play();
          // (A phone feels it — if it has been touched: no browser allows it before.)
          if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.([8, 40, 26]);
        },
        done: () => told.current.onDone(),
        // The graphics taken away (a phone's few contexts), or refused: what is left of it
        // is a door that fades.
        lost: () => {
          opening.current = null;
          fadeAway.current(play);
        },
      },
      window.matchMedia("(max-width: 767px)").matches,
    );
    return () => {
      opening.current?.dispose();
      opening.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- made once, in the colours the page opens in
  }, []);

  useEffect(() => {
    if (!ready) return;
    let off = false;
    void (async () => {
      await seen();
      if (!again) {
        await Promise.race([document.fonts?.ready ?? rest(0), rest(1500)]);
        await rest(LEAST_MS - (performance.now() - born.current));
        for (let i = 0; i < 30 && !written.current; i++) await rest(30);
        if (off) return;
        sealStage();
        setSealed(true);
        await rest(impatient.current ? 160 : 480);
        await calm(5, 2200);
      }
      await seen();
      if (off) return;
      // (Its own graphics are built by now: they were the first thing asked for.)
      for (let i = 0; i < 40 && opening.current && !opening.current.ready(); i++) await rest(50);
      if (off) return;
      begun.current = true;
      const o = opening.current;
      if (!o?.ready() || !box.current) {
        o?.dispose();
        opening.current = null;
        fadeAway.current(() => {});
        return;
      }
      if (again) o.point(1.8);
      else o.fall(box.current);
    })();
    return () => {
      off = true;
    };
  }, [ready, again]);

  // Nothing to press; but a key or a touch here hurries it along.
  useEffect(() => {
    const el = door.current;
    const hurry = () => {
      impatient.current = true;
      opening.current?.hurry();
    };
    const onKey = (e: KeyboardEvent) => {
      if (el?.dataset.boot === "open") return;
      if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
        e.preventDefault();
        hurry();
      }
    };
    // The page behind it does not scroll away meanwhile.
    const still = (e: WheelEvent) => {
      if (el?.dataset.boot !== "open") e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    el?.addEventListener("pointerdown", hurry);
    el?.addEventListener("wheel", still, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      el?.removeEventListener("pointerdown", hurry);
      el?.removeEventListener("wheel", still);
    };
  }, []);

  const pct = total ? Math.round((loaded / total) * 100) : 100;

  return (
    <div ref={door} data-boot={sealed ? "sealed" : "loading"} className="fixed inset-0 z-50 grid touch-none place-items-center overscroll-none px-6" style={{ background: THIN }}>
      <canvas ref={sky} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <div ref={box} className="relative w-full max-w-lg font-mono text-[13px] leading-relaxed" style={again ? { visibility: "hidden" } : undefined}>
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
            <span className={`tabular-nums transition-colors duration-300 ${sealed ? "text-[var(--d-a2)]" : "text-[var(--d-ink4)]"}`}>
              {loaded}/{total}
            </span>
          </div>
          <div className="dev-boot-bar mt-1.5" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--d-bg2)]">
              <div
                data-ink
                className="h-full rounded-full bg-gradient-to-r from-[var(--d-a)] to-[var(--d-a2)] transition-[width] duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mt-7 h-11">
          {sealed ? (
            <p className="dev-boot-word text-[13px] font-semibold text-[var(--d-a2)]">{w("bootOpen")}</p>
          ) : (
            <p className="text-[11px] tracking-[0.2em] text-[var(--d-ink7)]">{w("bootWait")}</p>
          )}
        </div>
      </div>
    </div>
  );
}
