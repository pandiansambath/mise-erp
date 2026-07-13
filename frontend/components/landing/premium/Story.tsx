"use client";

// The journey — ONE continuous cinema, directed by the films themselves.
//
// Sequencing (the fix for "I glimpse the next image before its video"):
// each morph film STARTS on the world you are already looking at and ENDS on
// the next scene's still. So when a beat takes the stage we play its film
// OVER the current backdrop first — the first frame matches what's on screen,
// no jump — and only when it finishes does the new still take the base. Going
// backwards (or fast-skipping, or with data-saver on) falls back to a soft
// still-to-still crossfade. Scrolling away re-arms everything, so the journey
// replays on every pass.

import { useCallback, useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { filmPath, HandoffVeil, stillPath, usePrefersReducedMotion, useSmallScreen } from "./bits";

type Beat = {
  still: string;
  videos: string[];
  kicker: string;
  title: [string, string];
  body: string;
  chip?: { label: string; value: string; sub: string };
  align: "left" | "center" | "right";
};

const BEATS: Beat[] = [
  {
    still: "forest",
    videos: ["sky-to-mountains", "mountains-to-forest"],
    kicker: "01 · THE WORLD",
    title: ["Every great plate", "starts far from the plate."],
    body: "Above the clouds, down the mountains, into the forest — everything you serve begins somewhere. Mise follows it all the way to your books.",
    align: "center",
  },
  {
    still: "source",
    videos: ["forest-to-source"],
    kicker: "02 · THE INGREDIENT",
    title: ["Every ingredient", "is a price."],
    body: "A delivery lands and its true cost blends into a live weighted average — tracked from the moment it arrives, to the gram.",
    chip: { label: "Tomato · Rudra Veg", value: "£1.84/kg → £1.92/kg", sub: "weighted average, updated on receipt" },
    align: "left",
  },
  {
    still: "garden",
    videos: ["source-to-garden"],
    kicker: "03 · ONE SOURCE",
    title: ["It all grows", "from one source."],
    body: "Recipes, stock, purchasing, people and money — one source of truth for the whole house, not eight spreadsheets that disagree.",
    align: "left",
  },
  {
    still: "fire",
    videos: ["garden-to-fire"],
    kicker: "04 · THE KITCHEN",
    title: ["Service runs hot.", "Your numbers stay cold."],
    body: "The moment a supplier price moves, every dish that uses it re-costs itself. No month-end surprises — the margin is live.",
    chip: { label: "Butter Chicken", value: "£3.41 cost · 71% GP", sub: "re-priced the second the market moved" },
    align: "left",
  },
  {
    still: "gold",
    videos: ["table-to-gold"],
    kicker: "05 · THE MONEY",
    title: ["Watch the money", "actually move."],
    body: "Sales, purchases, payroll and expenses roll into a living P&L. Not a report you build — a truth you glance at.",
    chip: { label: "Net profit · today", value: "£612 · 29% food cost", sub: "↑ 8% on target, till balanced to £0.00" },
    align: "right",
  },
];

const alignCls: Record<Beat["align"], string> = {
  left: "",
  center: "mx-auto text-center",
  right: "ml-auto text-right",
};

/** Plays a beat's film chain (1–2 clips) over the stage, then reports back. */
function FilmLayer({
  videos,
  onDone,
  onFail,
  fading,
}: {
  videos: string[];
  onDone: () => void;
  onFail: () => void;
  fading: boolean;
}) {
  const v0 = useRef<HTMLVideoElement>(null);
  const v1 = useRef<HTMLVideoElement>(null);
  const [seg, setSeg] = useState<"warmup" | "v0" | "v1">("warmup");
  const small = useSmallScreen();

  useEffect(() => {
    const el = v0.current;
    if (!el) return;
    let cancelled = false;
    el.play()
      .then(() => {
        if (!cancelled) setSeg("v0");
      })
      .catch(() => {
        if (!cancelled) onFail();
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = () => {
    if (videos[1] && v1.current) {
      v1.current
        .play()
        .then(() => setSeg("v1"))
        .catch(onDone);
    } else {
      onDone();
    }
  };

  return (
    <div
      className="absolute inset-0"
      style={{ opacity: seg === "warmup" || fading ? 0 : 1, transition: "opacity 900ms ease" }}
    >
      {small && <span className="mise-l-bandsmoke" aria-hidden />}
      <video
        ref={v0}
        muted
        playsInline
        preload="auto"
        src={filmPath(videos[0], small)}
        onEnded={advance}
        onError={onFail}
        className={
          small
            ? "mise-l-band absolute left-0 top-1/2 w-full -translate-y-1/2"
            : "absolute inset-0 h-full w-full object-cover"
        }
        style={{ opacity: seg === "v1" ? 0 : 1, transition: "opacity 350ms ease" }}
      />
      {videos[1] ? (
        <video
          ref={v1}
          muted
          playsInline
          preload="auto"
          src={filmPath(videos[1], small)}
          onEnded={onDone}
          onError={onDone}
          className={
            small
              ? "mise-l-band absolute left-0 top-1/2 w-full -translate-y-1/2"
              : "absolute inset-0 h-full w-full object-cover"
          }
          style={{ opacity: seg === "v1" ? 1 : 0, transition: "opacity 350ms ease" }}
        />
      ) : null}
    </div>
  );
}

type StageState = {
  base: number; // the settled still on the stage
  film: { to: number; run: number; fading: boolean } | null; // run = remount key
};

export default function Story() {
  const reduced = usePrefersReducedMotion();
  const small = useSmallScreen();
  const [allowed, setAllowed] = useState(false);
  const [active, setActive] = useState(0);
  const [st, setSt] = useState<StageState>({ base: 0, film: null });
  const runRef = useRef(0);
  const sectionRef = useRef<HTMLElement>(null);
  const beatRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    setAllowed(!reduced && !conn?.saveData);
  }, [reduced]);

  // Fast scrolls must never land on an undecoded (black) layer: keep the
  // neighbours decoded and ready before they're asked to show.
  useEffect(() => {
    if (!small) return;
    for (const i of [st.base - 2, st.base - 1, st.base + 1, st.base + 2]) {
      const b = BEATS[i];
      if (!b) continue;
      const im = new Image();
      im.src = stillPath(b.still, small);
      im.decode?.().catch(() => {});
    }
  }, [st.base, small]);

  // The copy block nearest the viewport centre owns the stage.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = beatRefs.current.indexOf(e.target as HTMLDivElement);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    beatRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  // Direct the stage: forward one step → the film IS the transition;
  // anything else → soft crossfade of stills.
  useEffect(() => {
    setSt((s) => {
      if (s.film && !s.film.fading) {
        if (s.film.to === active) return s;
        return { base: active, film: null }; // fast-scroll: cut to target
      }
      if (active === s.base) return s;
      if (allowed && active === s.base + 1) {
        runRef.current += 1;
        return { ...s, film: { to: active, run: runRef.current, fading: false } };
      }
      return { base: active, film: null };
    });
  }, [active, allowed]);

  // Entering the section from above plays the opening flythrough (beat 0);
  // leaving above re-arms it for the next visit.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const fromTop = e.boundingClientRect.top > 0;
          if (e.isIntersecting && fromTop) {
            setSt((s) => {
              if (s.base !== 0 || s.film) return s;
              runRef.current += 1;
              return { ...s, film: { to: 0, run: runRef.current, fading: false } };
            });
          }
        }
      },
      { threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // The handoff moment: a soft light-bloom "breath" swells over the stage as
  // the film hands back to the still, so the eye never catches the swap.
  const [bloom, setBloom] = useState(0);
  const onFilmDone = useCallback(() => {
    setBloom((b) => b + 1);
    setSt((s) => (s.film ? { base: s.film.to, film: { ...s.film, fading: true } } : s));
    window.setTimeout(() => {
      setSt((s) => (s.film?.fading ? { ...s, film: null } : s));
    }, 980);
  }, []);

  const onFilmFail = useCallback(() => {
    setSt((s) => (s.film ? { base: s.film.to, film: null } : s));
  }, []);

  return (
    <section ref={sectionRef} id="story" aria-label="How Mise works" className="relative">
      {/* ── the pinned cinema stage ── */}
      <div className="sticky top-0 h-screen overflow-hidden">
        {/* settled stills (crossfade base). Phones keep only the stills near
            the action mounted — five resident full-screen layers is too much
            GPU memory for small devices. */}
        {BEATS.map((b, i) =>
          !small || Math.abs(i - st.base) <= 2 || st.film?.to === i ? (
            <img
              key={b.still}
              src={stillPath(b.still, small)}
              alt=""
              loading={i === 0 ? "eager" : "lazy"}
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover ${reduced ? "" : "mise-l-ken"}`}
              style={{
                opacity: st.base === i ? 1 : 0,
                // pause, don't strip, the drift — class-toggling snapped the
                // scale mid-crossfade and flickered on every beat change
                animationPlayState: st.base === i ? "running" : "paused",
                // phone: defocus behind the rolling band (depth of field)
                filter: small && st.film && !st.film.fading ? "blur(7px) brightness(0.88)" : "none",
                transition: "opacity 900ms ease, filter 900ms ease",
              }}
            />
          ) : null,
        )}

        {/* the morph film, playing over the stage */}
        {st.film ? (
          <FilmLayer
            key={st.film.run}
            videos={BEATS[st.film.to].videos}
            onDone={onFilmDone}
            onFail={onFilmFail}
            fading={st.film.fading}
          />
        ) : null}

        {/* Warm the NEXT beat's film into the HTTP cache while the current
            still rests — by the time the user scrolls on, playback is instant
            instead of waiting on the network ("loading takes so much time"). */}
        {allowed && !st.film && BEATS[st.base + 1] && (
          <video
            key={`warm-${BEATS[st.base + 1].videos[0]}`}
            src={filmPath(BEATS[st.base + 1].videos[0], small)}
            preload="auto"
            muted
            playsInline
            aria-hidden
            tabIndex={-1}
            className="hidden"
          />
        )}
        {allowed && !st.film && st.base === 0 && (
          <video
            key="warm-first"
            src={filmPath(BEATS[0].videos[0], small)}
            preload="auto"
            muted
            playsInline
            aria-hidden
            tabIndex={-1}
            className="hidden"
          />
        )}

        {/* smoke + bloom hide every film→still handoff */}
        {bloom > 0 && <HandoffVeil key={bloom} />}

        {/* veils */}
        <div className="pointer-events-none absolute inset-0" style={{ background: "rgba(2,8,6,0.38)" }} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink-950 via-transparent to-ink-950" />

        {/* journey progress — five embers along the bottom of the stage */}
        <div className="absolute inset-x-0 bottom-7 z-10 flex justify-center gap-2.5">
          {BEATS.map((b, i) => (
            <span
              key={b.still}
              className="h-1.5 rounded-full transition-all duration-700"
              style={{
                width: active === i ? 26 : 6,
                background: active === i ? "var(--color-copper-300)" : "rgba(255,255,255,0.22)",
              }}
            />
          ))}
        </div>
      </div>

      {/* ── the copy glides over the stage ── */}
      <div className="relative z-10 -mt-[100vh]">
        {BEATS.map((b, i) => (
          <div
            key={b.still}
            ref={(el) => {
              beatRefs.current[i] = el;
            }}
            className="flex min-h-screen items-center"
          >
            <div className="mx-auto w-full max-w-6xl px-6 sm:px-10">
              <div className={`max-w-xl ${alignCls[b.align]}`}>
                <Reveal>
                  <p className="font-mono text-[11px] tracking-[0.4em] text-copper-200/90 sm:text-xs">{b.kicker}</p>
                </Reveal>
                <Reveal delay={110}>
                  <h2 className="mt-5 font-display text-4xl leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_28px_rgba(0,0,0,0.65)] sm:text-6xl">
                    {b.title[0]}
                    <span className="block">{b.title[1]}</span>
                  </h2>
                </Reveal>
                <Reveal delay={220}>
                  <p className="mt-6 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">{b.body}</p>
                </Reveal>
                {b.chip ? (
                  <Reveal delay={330}>
                    <div className="mt-7 inline-block rounded-2xl border border-white/15 bg-black/55 p-4 text-left sm:bg-black/45 sm:backdrop-blur-md">
                      <p className="text-[11px] uppercase tracking-wide text-slate-400">{b.chip.label}</p>
                      <p className="mt-1 font-mono text-lg font-semibold text-copper-200 sm:text-xl">{b.chip.value}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-brand-300/90">{b.chip.sub}</p>
                    </div>
                  </Reveal>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
