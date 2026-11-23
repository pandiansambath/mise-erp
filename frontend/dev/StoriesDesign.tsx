"use client";

// Design 7: Stories — "Tap through a life."
//
//   "i love the new designs so i need more n more… think deeply"
//
// His photos already live on Instagram, so this design tells his story the
// way people already read photos: full-screen stories you tap through.
//   · a story reel: progress bars, tap right for next and left for back,
//     press and hold to pause, arrow keys on a desktop; every story is one of
//     his photos, slowly moving, with stickers that are live (the Chennai
//     clock, his time in the chain to the second, the day count);
//   · a profile beside it: avatar ring, live stats, a bio, highlight rings
//     that jump to a chapter, and his photos as the post grid underneath.
// Phones get the reel full-width first, the profile and posts below it.

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { chennaiTime, elapsed, useDev, useNow, usePortraits, useData } from "./context";
import { honours } from "./profile";

/** The reel, in order: key, the highlight it belongs to, seconds on screen. */
const SLIDES = [
  { key: "hello", ring: "Hello", secs: 6 },
  { key: "work", ring: "Work", secs: 7 },
  { key: "rank", ring: "Awards", secs: 7 },
  { key: "honours", ring: "Awards", secs: 8 },
  { key: "skills", ring: "Skills", secs: 9 },
  { key: "dineai", ring: "DineAI", secs: 9 },
  { key: "life", ring: "Life", secs: 8 },
  { key: "today", ring: "Today", secs: 6 },
  { key: "hi", ring: "Say hi", secs: 10 },
] as const;

const RINGS = Array.from(new Set(SLIDES.map((s) => s.ring)));
/** The line each chapter shows in the "up next" list. */
const CAPTION: Record<(typeof SLIDES)[number]["key"], string> = {
  hello: "Hi, I'm Pandian",
  work: "System Engineer at TCS",
  rank: "Gold Medalist, 17th rank",
  honours: "Promoted twice in two years",
  skills: "What I work with",
  dineai: "DineAI, my own product",
  life: "Beyond the desk",
  today: "Today, live",
  hi: "Say hi",
};

const KEN = ["devKenA", "devKenB", "devKenC", "devKenD"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Entrance for a story's pieces, replayed every time the story opens. */
const rise = (i: number): CSSProperties => ({ animation: `devFadeUp .6s ${0.15 + i * 0.12}s cubic-bezier(.2,.8,.2,1) both` });
const pop = (i: number): CSSProperties => ({ animation: `devPop .55s ${0.3 + i * 0.1}s cubic-bezier(.2,1.4,.4,1) both` });

const STICKER = "inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-black/35 px-3 py-1.5 text-[12.5px] text-white backdrop-blur-md";
const LINK_STICKER =
  "pointer-events-auto inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-[13px] font-semibold text-black shadow-[0_8px_24px_-8px_rgba(0,0,0,.6)] transition hover:scale-[1.04]";

export function StoriesDesign() {
  const { CAREER_START, CLUSTERS, EDUCATION, EMAIL, LINKS, PROJECT, VOLUNTEERING } = useData();
  // His portrait photos and their pace, set in the owner panel (22 Nov).
  const PORTRAITS = usePortraits();
  const { entered, photos, milestones, openAlbum, openResume, resume, toast } = useDev();
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const awards = honours(milestones);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const fill = useRef<HTMLSpanElement>(null);
  const spent = useRef(0);
  const frame = useRef<HTMLDivElement>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const last = i === SLIDES.length - 1;

  // A visitor who asked for less motion taps through at their own pace.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setPaused(true);
  }, []);

  const go = useCallback((to: number) => {
    spent.current = 0;
    setI(Math.max(0, Math.min(SLIDES.length - 1, to)));
  }, []);

  // The clock behind the progress bar: written to the DOM, not to state.
  useEffect(() => {
    if (!entered) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (t: number) => {
      const dt = t - prev;
      prev = t;
      if (!paused && !document.hidden) spent.current += dt;
      const p = Math.min(1, spent.current / (SLIDES[i].secs * 1000));
      if (fill.current) fill.current.style.width = `${p * 100}%`;
      if (p >= 1) {
        if (i < SLIDES.length - 1) go(i + 1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [i, paused, entered, go]);

  // The next story's photo is fetched before it is needed.
  const photoFor = useCallback(
    (k: number) => {
      if (SLIDES[k].key === "hello" || !photos.length) return PORTRAITS[0];
      return `/api/dev-site/full/${photos[(k * 5 + 2) % photos.length].id}.webp`;
    },
    [photos],
  );
  useEffect(() => {
    if (i + 1 < SLIDES.length) new Image().src = photoFor(i + 1);
  }, [i, photoFor]);
  // Its 24px preview shows at once while the full photo arrives.
  const lqipFor = (k: number) => (SLIDES[k].key === "hello" || !photos.length ? undefined : photos[(k * 5 + 2) % photos.length].lqip);

  // Arrow keys on a desktop, unless a popup is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]') || (e.target as HTMLElement)?.closest("input,textarea")) return;
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  // Tap: left third goes back, the rest goes on. Press and hold pauses.
  const interactive = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest("a,button");
  const onDown = (e: React.PointerEvent) => {
    if (interactive(e.target)) return;
    held.current = false;
    holdTimer.current = setTimeout(() => {
      held.current = true;
      setPaused(true);
    }, 230);
  };
  const onUp = (e: React.PointerEvent) => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (interactive(e.target)) return;
    if (held.current) {
      held.current = false;
      setPaused(false);
      return;
    }
    const r = frame.current?.getBoundingClientRect();
    if (!r) return;
    if (e.clientX - r.left < r.width * 0.3) go(i - 1);
    else go(i + 1);
  };
  const onCancel = () => {
    if (holdTimer.current) clearTimeout(holdTimer.current);
    if (held.current) {
      held.current = false;
      setPaused(false);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast(`Copied ${EMAIL}`);
    } catch {
      window.location.href = LINKS.email;
    }
  };

  const story = (key: (typeof SLIDES)[number]["key"]): ReactNode => {
    switch (key) {
      case "hello":
        return (
          <>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              HI, I&apos;M
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.4rem,11vw,3.6rem)] font-semibold leading-[0.95] tracking-tight text-white" style={rise(1)}>
              Pandian
              <br />
              Sambath
            </h2>
            <p className="mt-3 text-[15px] text-white/85" style={rise(2)}>
              System Engineer · Python, AWS and Generative AI
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={STICKER} style={pop(3)}>
                📍 Chennai · {now ? chennaiTime(now) : "—"}
              </span>
              <span className={STICKER} style={pop(4)}>
                Tap to continue →
              </span>
            </div>
          </>
        );
      case "work":
        return (
          <>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              SINCE JANUARY 2024
            </p>
            <h2 className="mt-2 font-display text-[clamp(1.9rem,8vw,2.7rem)] font-semibold leading-[1.02] text-white" style={rise(1)}>
              System Engineer at <span className="text-[var(--d-a2)]">Tata Consultancy Services</span>
            </h2>
            <div className="mt-5 inline-block rounded-2xl border border-white/15 bg-black/40 px-4 py-3 backdrop-blur-md" style={pop(2)}>
              <p className="font-mono text-[10px] tracking-[0.22em] text-white/60">IN THE CHAIN</p>
              <p className="mt-1 font-mono text-[22px] font-semibold tabular-nums text-white">
                {exp ? `${exp.years}y ${exp.months}m ${exp.days}d` : "—"}
              </p>
              <p className="font-mono text-[12px] tabular-nums text-[var(--d-b2)]">{exp ? `${pad(exp.hours)}:${pad(exp.minutes)}:${pad(exp.seconds)} and counting` : ""}</p>
            </div>
          </>
        );
      case "rank":
        return (
          <>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              ANNA UNIVERSITY · 2023
            </p>
            <h2 className="dev-gold mt-2 font-display text-[clamp(2rem,9vw,3rem)] font-semibold leading-none" style={rise(1)}>
              Gold Medalist
            </h2>
            <p className="mt-2 text-[17px] font-semibold text-white" style={rise(2)}>
              17th University Rank
            </p>
            <p className="mt-1 text-[14px] text-white/80" style={rise(3)}>
              {EDUCATION.degree} · {EDUCATION.percentage}
            </p>
            <a href={EDUCATION.verifyUrl} target="_blank" rel="noopener noreferrer" className={`${LINK_STICKER} mt-5`} style={pop(4)}>
              🔗 See the rank list
            </a>
          </>
        );
      case "honours":
        return (
          <>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              RECOGNITION
            </p>
            <h2 className="mt-2 font-display text-[clamp(1.8rem,8vw,2.5rem)] font-semibold leading-[1.02] text-white" style={rise(1)}>
              Promoted twice in two years
            </h2>
            <ul className="mt-4 space-y-2">
              {awards.map((m, k) => (
                <li key={`${m.when}-${m.title}`} className="flex items-center gap-2.5 rounded-xl border border-white/15 bg-black/40 px-3 py-2 backdrop-blur-md" style={pop(2 + k)}>
                  <span className="text-[15px]" style={{ color: m.kind === "recognition" ? "var(--d-gold)" : "var(--d-b2)" }}>
                    {m.kind === "recognition" ? "★" : "↑"}
                  </span>
                  <span className="min-w-0 flex-1 text-[13px] leading-snug text-white">{m.title}</span>
                  <span className="shrink-0 font-mono text-[10px] text-white/60">{m.when}</span>
                </li>
              ))}
            </ul>
          </>
        );
      case "skills":
        return (
          <>
            <div className="mb-4 rounded-2xl bg-white px-4 py-3 text-center text-black shadow-xl" style={pop(0)}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/50">Ask me</p>
              <p className="mt-0.5 text-[16px] font-bold">What do you work with?</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CLUSTERS.flatMap((c) => c.items.slice(0, 7).map((item) => ({ item, hue: c.hue }))).map((x, k) => (
                <span
                  key={x.item}
                  className="rounded-full border bg-black/40 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur-md"
                  style={{ borderColor: x.hue, animation: `devPop .45s ${0.5 + k * 0.05}s cubic-bezier(.2,1.4,.4,1) both` }}
                >
                  {x.item}
                </span>
              ))}
            </div>
          </>
        );
      case "dineai":
        return (
          <>
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              MY OWN PRODUCT
            </p>
            <h2 className="mt-2 font-display text-[clamp(2.2rem,10vw,3.2rem)] font-semibold leading-none text-white" style={rise(1)}>
              {PROJECT.name}
            </h2>
            <p className="mt-1 text-[17px] font-semibold text-[var(--d-a2)]" style={rise(2)}>
              {PROJECT.slogan}
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-white/85" style={rise(3)}>
              {PROJECT.pitch}
            </p>
            <p className="mt-2 text-[11.5px] leading-relaxed text-white/60" style={rise(4)}>
              Built with AI-assisted development.
            </p>
            <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className={`${LINK_STICKER} mt-4`} style={pop(5)}>
              🔗 dineai.cloud
            </a>
          </>
        );
      case "life":
        return (
          <>
            <div className="relative mb-4 h-40">
              {photos.slice(3, 6).map((p, k) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={openAlbum}
                  aria-label="Open the photo album"
                  className="pointer-events-auto absolute top-0 w-[38%] rounded-md bg-white p-1.5 pb-5 shadow-2xl transition hover:z-10 hover:scale-105"
                  style={{ left: `${k * 30}%`, rotate: `${(k - 1) * 9}deg`, animation: `devPop .6s ${0.2 + k * 0.15}s cubic-bezier(.2,1.4,.4,1) both` }}
                >
                  <img src={`/api/dev-site/thumb/${p.id}.webp`} alt="" className="aspect-square w-full object-cover" style={{ background: `url(${p.lqip}) center/cover` }} />
                </button>
              ))}
            </div>
            <h2 className="font-display text-[clamp(1.8rem,8vw,2.5rem)] font-semibold leading-[1.02] text-white" style={rise(3)}>
              Beyond the desk
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-white/85" style={rise(4)}>
              Volunteering with {VOLUNTEERING.map((v) => v.org).join(", ")}.
            </p>
            <button type="button" onClick={openAlbum} className={`${LINK_STICKER} mt-4`} style={pop(5)}>
              📷 Open the album
            </button>
          </>
        );
      case "today":
        return (
          <div className="text-center">
            <p className="font-mono text-[11px] tracking-[0.3em] text-white/75" style={rise(0)}>
              TODAY IS
            </p>
            <p className="mt-2 font-display text-[clamp(3.6rem,18vw,5.5rem)] font-semibold leading-none tabular-nums text-white" style={rise(1)}>
              Day {exp ? exp.dayNumber.toLocaleString("en-US") : "—"}
            </p>
            <p className="mt-2 font-mono text-[14px] tabular-nums text-[var(--d-b2)]" style={rise(2)}>
              {exp ? `${pad(exp.hours)}:${pad(exp.minutes)}:${pad(exp.seconds)}` : ""}
            </p>
            <p className="mt-4 text-[15px] text-white/85" style={rise(3)}>
              Life doesn’t stop. It moves like a chain.
            </p>
          </div>
        );
      case "hi":
        return (
          <>
            <h2 className="font-display text-[clamp(2.2rem,10vw,3.2rem)] font-semibold leading-none text-white" style={rise(0)}>
              Say hi
            </h2>
            <p className="mt-2 text-[14px] text-white/80" style={rise(1)}>
              Reply to this story the old way.
            </p>
            <div className="mt-5 flex flex-col items-start gap-2.5">
              <button type="button" onClick={copyEmail} className={LINK_STICKER} style={pop(2)}>
                ✉ Copy my email
              </button>
              <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className={LINK_STICKER} style={pop(3)}>
                in · LinkedIn
              </a>
              <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className={LINK_STICKER} style={pop(4)}>
                ⌥ GitHub
              </a>
              {resume && (
                <button type="button" onClick={openResume} className={LINK_STICKER} style={pop(5)}>
                  ▤ View my résumé
                </button>
              )}
              <button type="button" onClick={() => go(0)} className={`${STICKER} pointer-events-auto mt-2`} style={pop(6)}>
                ↺ Watch again
              </button>
            </div>
          </>
        );
    }
  };

  const ringStart = (ring: string) => SLIDES.findIndex((s) => s.ring === ring);
  const ringPhoto = (ring: string) => photoFor(ringStart(ring));

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-2 pb-12 pt-[4.25rem] sm:px-6 sm:pt-24">
      {/* The current photo, huge and blurred, as the room around the reel. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <img key={photoFor(i)} src={photoFor(i)} alt="" className="h-full w-full scale-125 object-cover opacity-[0.14] blur-3xl" style={{ animation: "devFade 1s ease both" }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 70% 45%, transparent, color-mix(in srgb, var(--d-bg) 70%, transparent) 45%, var(--d-bg) 80%)" }} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-12">
        {/* The reel. */}
        <div className="order-1 flex justify-center lg:order-2">
          <div className="relative flex items-center gap-4">
            <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous story" className="hidden h-11 w-11 place-items-center rounded-full border border-[var(--d-line2)] bg-[var(--d-glass)] text-[var(--d-ink2)] transition hover:scale-105 disabled:opacity-30 lg:grid">
              ‹
            </button>
            <div
              ref={frame}
              onPointerDown={onDown}
              onPointerUp={onUp}
              onPointerCancel={onCancel}
              onPointerLeave={onCancel}
              onContextMenu={(e) => e.preventDefault()}
              className="relative aspect-[9/16] h-[calc(100svh-5.5rem)] max-h-[860px] max-w-[calc(100vw-1rem)] touch-pan-y select-none overflow-hidden rounded-[22px] bg-black shadow-[0_40px_90px_-30px_rgba(0,0,0,.85)] sm:h-[calc(100svh-8rem)] sm:rounded-[28px]"
              style={{ opacity: entered ? 1 : 0, transition: "opacity .8s .2s" }}
              aria-roledescription="story"
              aria-label={`Story ${i + 1} of ${SLIDES.length}`}
            >
              <img
                key={`bg-${i}`}
                src={photoFor(i)}
                alt=""
                className="absolute inset-0 h-full w-full object-cover motion-reduce:!animate-none"
                style={{
                  animation: `${KEN[i % 4]} ${SLIDES[i].secs + 3}s ease-out both`,
                  background: lqipFor(i) ? `url(${lqipFor(i)}) center/cover` : undefined,
                }}
              />
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,.55),transparent_22%,transparent_38%,rgba(0,0,0,.82))]" />

              {/* Progress, one bar per story. */}
              <div className="absolute inset-x-3 top-3 flex gap-1">
                {SLIDES.map((s, k) => (
                  <span key={s.key} className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-white/30">
                    <span ref={k === i ? fill : undefined} className="absolute inset-y-0 left-0 rounded-full bg-white" style={{ width: k < i ? "100%" : "0%" }} />
                  </span>
                ))}
              </div>
              <div className="absolute inset-x-3 top-6 flex items-center gap-2 pt-1">
                <span className="relative h-8 w-8 shrink-0 rounded-full p-[2px]" style={{ background: "conic-gradient(var(--d-a2), var(--d-b), var(--d-c), var(--d-a2))" }}>
                  <img src={PORTRAITS[0]} alt="" className="h-full w-full rounded-full border-2 border-black object-cover" />
                </span>
                <span className="text-[13px] font-semibold text-white">pandian.sambath</span>
                <span className="text-[12px] text-white/60">· {SLIDES[i].ring}</span>
                <button
                  type="button"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? "Play the stories" : "Pause the stories"}
                  className="pointer-events-auto ml-auto grid h-8 w-8 place-items-center rounded-full text-[12px] text-white/85 hover:bg-white/10"
                >
                  {paused ? "▶" : "❚❚"}
                </button>
              </div>

              {/* The story itself, remounted so its entrance replays. */}
              <div key={`story-${i}`} className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-16 pt-24 sm:px-6 sm:pb-10 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
                {story(SLIDES[i].key)}
              </div>
              {last && <span className="sr-only">End of the stories.</span>}
            </div>
            <button type="button" onClick={() => go(i + 1)} disabled={last} aria-label="Next story" className="hidden h-11 w-11 place-items-center rounded-full border border-[var(--d-line2)] bg-[var(--d-glass)] text-[var(--d-ink2)] transition hover:scale-105 disabled:opacity-30 lg:grid">
              ›
            </button>
          </div>
        </div>

        {/* The profile. */}
        <aside className="order-2 lg:sticky lg:top-24 lg:order-1">
          <div className="flex items-center gap-5">
            <button type="button" onClick={() => go(0)} aria-label="Watch the stories from the start" className="relative h-24 w-24 shrink-0 rounded-full p-[3px] transition hover:scale-[1.03] sm:h-28 sm:w-28" style={{ background: "conic-gradient(var(--d-a2), var(--d-b), var(--d-c), var(--d-d), var(--d-a2))" }}>
              <img src={PORTRAITS[0]} alt="Pandian Sambath" className="h-full w-full rounded-full border-4 border-[var(--d-bg)] object-cover" />
            </button>
            <div className="grid flex-1 grid-cols-3 text-center">
              {[
                { v: exp ? exp.decimal : "—", k: "years" },
                { v: photos.length, k: "photos" },
                { v: awards.length + 1, k: "honours" },
              ].map((s) => (
                <div key={s.k}>
                  <p className="text-[19px] font-bold tabular-nums text-[var(--d-ink)]">{s.v}</p>
                  <p className="text-[12px] text-[var(--d-ink4)]">{s.k}</p>
                </div>
              ))}
            </div>
          </div>
          <h1 className="mt-4 text-[17px] font-bold text-[var(--d-ink)]">Pandian Sambath</h1>
          <p className="text-[14px] leading-relaxed text-[var(--d-ink3)]">
            System Engineer at Tata Consultancy Services
            <br />
            Python, AWS and Generative AI
            <br />
            📍 Chennai, India · <span className="tabular-nums">{now ? chennaiTime(now) : "—"}</span>
            <br />
            Building{" "}
            <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--d-b2)]">
              dineai.cloud
            </a>
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <button type="button" onClick={openResume} className="rounded-lg bg-[var(--d-bg2)] py-2 text-[13px] font-semibold text-[var(--d-ink)] ring-1 ring-[var(--d-line)] transition hover:ring-[var(--d-b)]">
              Résumé
            </button>
            <button type="button" onClick={copyEmail} className="rounded-lg bg-[var(--d-bg2)] py-2 text-[13px] font-semibold text-[var(--d-ink)] ring-1 ring-[var(--d-line)] transition hover:ring-[var(--d-b)]">
              Email
            </button>
            <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className="rounded-lg py-2 text-center text-[13px] font-semibold text-[var(--d-on)] transition hover:brightness-110" style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}>
              Follow
            </a>
          </div>

          {/* Highlights: each ring opens its chapter. */}
          <div className="mt-6 flex flex-wrap gap-x-4 gap-y-3 pb-2">
            {RINGS.map((ring) => {
              const on = SLIDES[i].ring === ring;
              return (
                <button key={ring} type="button" onClick={() => go(ringStart(ring))} className="group flex shrink-0 flex-col items-center gap-1.5">
                  <span
                    className="relative h-16 w-16 rounded-full p-[2px] transition group-hover:scale-105"
                    style={{ background: on ? "conic-gradient(var(--d-a2), var(--d-b), var(--d-a2))" : "var(--d-line2)" }}
                  >
                    <img src={ringPhoto(ring).replace("/full/", "/thumb/")} alt="" className="h-full w-full rounded-full border-[3px] border-[var(--d-bg)] object-cover" />
                  </span>
                  <span className={`text-[11.5px] ${on ? "font-semibold text-[var(--d-ink)]" : "text-[var(--d-ink3)]"}`}>{ring}</span>
                </button>
              );
            })}
          </div>
          {/* Up next: every story as a row, the current one lit. */}
          <ol className="mt-6 hidden space-y-1 lg:block">
            {SLIDES.map((s, k) => (
              <li key={s.key}>
                <button
                  type="button"
                  onClick={() => go(k)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${k === i ? "bg-[var(--d-bg2)] ring-1 ring-[var(--d-line2)]" : "hover:bg-[var(--d-bg2)]/60"}`}
                >
                  <span className={`font-mono text-[11px] tabular-nums ${k === i ? "text-[var(--d-b2)]" : "text-[var(--d-ink5)]"}`}>{String(k + 1).padStart(2, "0")}</span>
                  <span className={`flex-1 truncate text-[13.5px] ${k === i ? "font-semibold text-[var(--d-ink)]" : k < i ? "text-[var(--d-ink4)]" : "text-[var(--d-ink2)]"}`}>{CAPTION[s.key]}</span>
                  <span className="font-mono text-[10px] text-[var(--d-ink5)]">{s.secs}s</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="mt-4 hidden font-mono text-[10.5px] tracking-[0.16em] text-[var(--d-ink3)] lg:block">TAP · HOLD TO PAUSE · ← → KEYS</p>
        </aside>
      </div>

      {/* Posts: his photos, the grid people know. */}
      {photos.length > 0 && (
        <section className="mt-12 border-t border-[var(--d-line)] pt-4">
          <p className="mb-3 text-center font-mono text-[11px] tracking-[0.24em] text-[var(--d-ink3)]">▦ POSTS</p>
          <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 sm:gap-2 lg:grid-cols-6">
            {photos.map((p) => (
              <button key={p.id} type="button" onClick={openAlbum} className="group relative block overflow-hidden" aria-label="Open the photo album">
                <img
                  src={`/api/dev-site/thumb/${p.id}.webp`}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover transition duration-500 group-hover:scale-105"
                  style={{ background: `url(${p.lqip}) center/cover` }}
                />
                <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/20" />
              </button>
            ))}
          </div>
        </section>
      )}

      <p className="mt-8 text-center font-mono text-[10px] tracking-[0.16em] text-[var(--d-ink5)]">
        © {now ? now.getFullYear() : ""} PANDIAN SAMBATH · THIS PAGE WAS BUILT WITH AI-ASSISTED DEVELOPMENT
      </p>
    </main>
  );
}
