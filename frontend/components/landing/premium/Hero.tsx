"use client";

// Two-act hero. Act 1: the fire-to-dish film plays ONCE on arrival and settles
// into the plate still under the brand line. Act 2: as you scroll, the film
// fades and the real product — a live dashboard simulation — rises and
// straightens into view.
//
// Performance: scroll drives everything through REFS with direct style writes
// inside one rAF — zero React re-renders per frame, transform/opacity only.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Aurora, btnGhost, btnPrimary, filmPath, HandoffVeil, Magnetic, stillPath, useSmallScreen } from "./bits";
import DashboardSim from "./DashboardSim";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

// Embers + steam motes drifting up around the plate — position, tint, pace.
const MOTES = [
  { left: "18%", size: 5, tint: "rgba(234,183,138,0.8)", t: 12, x: 42, o: 0.5, d: 0 },
  { left: "30%", size: 3, tint: "rgba(167,243,208,0.7)", t: 14, x: -30, o: 0.4, d: 3.5, sm: true },
  { left: "42%", size: 4, tint: "rgba(234,183,138,0.75)", t: 10, x: 24, o: 0.55, d: 1.2 },
  { left: "52%", size: 6, tint: "rgba(246,216,184,0.6)", t: 15, x: -46, o: 0.4, d: 5.4 },
  { left: "63%", size: 3, tint: "rgba(167,243,208,0.65)", t: 11, x: 36, o: 0.45, d: 2.3, sm: true },
  { left: "72%", size: 4, tint: "rgba(234,183,138,0.8)", t: 13, x: -22, o: 0.5, d: 6.8 },
  { left: "84%", size: 5, tint: "rgba(246,216,184,0.55)", t: 16, x: 30, o: 0.4, d: 4.1, sm: true },
  { left: "10%", size: 3, tint: "rgba(167,243,208,0.6)", t: 13, x: 26, o: 0.4, d: 8.2, sm: true },
];

export default function Hero({ start }: { start: boolean }) {
  const wrapRef = useRef<HTMLElement>(null);
  const filmRef = useRef<HTMLDivElement>(null); // dish still + entry film
  const skyRef = useRef<HTMLImageElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const dashRef = useRef<HTMLDivElement>(null);
  const capRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const vidRef = useRef<HTMLVideoElement>(null);
  // Entry-film sequencing (fix for "I see the plate, then fire, then plate"):
  // when the film is allowed, the hero OPENS on the fire — the film's first
  // frame — plays the flame-into-dish morph, and LANDS on the plate. The
  // plate is the destination, never a spoiler. No film → plate from frame 1.
  // Optimistically true so the FIRST paint is already the fire — never a
  // flash of the plate. The effect corrects it for data-saver/reduced-motion.
  const [allowed, setAllowed] = useState(true);
  const [film, setFilm] = useState<"idle" | "playing" | "done">("idle");
  const [visible, setVisible] = useState(true);
  const small = useSmallScreen();

  useEffect(() => {
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAllowed(!reduced && !conn?.saveData);
  }, []);

  // Leaving the hero rewinds the entry film so it replays on the way back.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) setVisible(e.isIntersecting);
      },
      { threshold: 0.02 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (visible) return;
    const el = vidRef.current;
    if (el) {
      el.pause();
      try { el.currentTime = 0; } catch { /* not loaded yet */ }
    }
    setFilm("idle");
  }, [visible]);

  useEffect(() => {
    if (!start || !visible || film !== "idle") return;
    if (!allowed) {
      setFilm("done");
      return;
    }
    const el = vidRef.current;
    if (!el) return;
    el.play()
      .then(() => setFilm("playing"))
      .catch(() => setFilm("done"));
  }, [start, visible, allowed, film]);

  // What the backdrop shows before/after the film.
  const baseStill = allowed && film !== "done" ? "fire" : "dish";

  // ── scroll → direct style writes, no re-renders ──
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = -1;

    const update = () => {
      const rect = wrap.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const p = clamp01(total > 0 ? -rect.top / total : 0);
      if (Math.abs(p - last) < 0.0015) return;
      last = p;

      const fade = phase(p, 0.05, 0.5); // headline + film out
      const rise = phase(p, 0.12, 0.85); // dashboard in
      const eased = 1 - Math.pow(1 - rise, 3);

      // PHONES: continuous per-frame writes on huge layers (film opacity, the
      // headline) forced constant re-compositing — the entrance flicker and
      // black flashes. Discrete beats + CSS transitions instead: styles only
      // CHANGE a handful of times per scroll, the GPU coasts in between.
      if (window.matchMedia("(max-width: 767px)").matches) {
        const past = fade > 0.45;
        if (filmRef.current) {
          filmRef.current.style.opacity = p > 0.62 ? "0.05" : "1";
          filmRef.current.style.transform = "";
        }
        if (skyRef.current) skyRef.current.style.opacity = p > 0.62 ? "0.42" : "0";
        if (headRef.current) {
          headRef.current.style.opacity = past ? "0" : "1";
          headRef.current.style.transform = past ? "translateY(-28px)" : "translateY(0px)";
          headRef.current.style.pointerEvents = past ? "none" : "";
        }
        if (dashRef.current) dashRef.current.style.transform = eased > 0.5 ? "translateY(4%)" : "translateY(66%)";
        if (capRef.current) capRef.current.style.opacity = p > 0.55 ? "1" : "0";
        if (cueRef.current) cueRef.current.style.opacity = p > 0.06 ? "0" : "1";
        return;
      }

      if (filmRef.current) {
        filmRef.current.style.opacity = String(1 - fade * 0.96);
        if (!reduced) filmRef.current.style.transform = `scale(${1.06 + p * 0.1})`;
      }
      if (skyRef.current) skyRef.current.style.opacity = String(fade * 0.42);
      if (headRef.current) {
        headRef.current.style.opacity = String(1 - fade * 1.35);
        if (!reduced) headRef.current.style.transform = `translateY(${fade * -46}px)`;
        headRef.current.style.pointerEvents = fade > 0.5 ? "none" : "";
      }
      if (dashRef.current) {
        dashRef.current.style.transform = reduced
          ? "translateY(4%)"
          : `translateY(${(1 - eased) * 66}%) rotateX(${(1 - eased) * 18}deg) scale(${0.94 + eased * 0.06})`;
      }
      if (capRef.current) capRef.current.style.opacity = String(phase(p, 0.45, 0.75));
      if (cueRef.current) cueRef.current.style.opacity = String(1 - phase(p, 0.01, 0.08));
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section ref={wrapRef} className="relative" style={{ height: "230vh" }}>
      <div className="sticky top-0 h-screen overflow-hidden bg-ink-950">
        {/* Act 1 backdrop — fire (film start) morphing into the dish (destination) */}
        <div ref={filmRef} className="absolute inset-0 will-change-transform max-md:transition-opacity max-md:duration-700" style={{ transformOrigin: "50% 42%" }}>
          <img
            src={stillPath("fire", small)}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: baseStill === "fire" ? 1 : 0,
              // phone: fall out of focus behind the band — the film becomes
              // the focal plane instead of a pasted rectangle
              filter: small && film === "playing" ? "blur(7px) brightness(0.88)" : "none",
              transition: "opacity 1000ms ease, filter 900ms ease",
            }}
          />
          <img
            src={stillPath("dish", small)}
            alt=""
            fetchPriority="high"
            decoding="async"
            className="mise-l-ken absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: baseStill === "dish" ? 1 : 0,
              filter: small && film === "playing" ? "blur(7px) brightness(0.88)" : "none",
              transition: "opacity 1000ms ease, filter 900ms ease",
            }}
          />
          {small && (
            <>
              <span className="mise-l-bandveil" style={{ opacity: film === "playing" ? 1 : 0 }} aria-hidden />
              <span className="mise-l-bandsmoke" style={{ opacity: film === "playing" ? 1 : 0 }} aria-hidden />
            </>
          )}
          <video
            ref={vidRef}
            muted
            playsInline
            preload="auto"
            src={filmPath("fire-to-dish", small)}
            onEnded={() => setFilm("done")}
            onError={() => setFilm("done")}
            className={
              small
                ? "mise-l-band absolute left-0 top-1/2 w-full -translate-y-1/2"
                : "absolute inset-0 h-full w-full object-cover"
            }
            style={{ opacity: film === "playing" ? 1 : 0, transition: "opacity 1000ms ease" }}
          />
          {/* smoke + bloom over the film→plate handoff */}
          {film === "done" && <HandoffVeil />}
        </div>
        {/* Act 2 backdrop — above the clouds */}
        <img
          ref={skyRef}
          src={stillPath("sky", small)}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover will-change-[opacity] max-md:transition-opacity max-md:duration-700"
          style={{ opacity: 0 }}
        />
        {/* aurora breathing at the edges + embers rising off the plate */}
        <Aurora strength={0.32} />
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          {MOTES.map((m, i) => (
            <span
              key={i}
              className={`mise-l-mote ${m.sm ? "hidden sm:block" : ""}`}
              style={{
                left: m.left,
                width: m.size,
                height: m.size,
                background: m.tint,
                animationDelay: `${m.d}s`,
                ["--mote-t" as string]: `${m.t}s`,
                ["--mote-x" as string]: `${m.x}px`,
                ["--mote-o" as string]: m.o,
              }}
            />
          ))}
        </div>

        {/* veils — keep type readable, blend edges into ink */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/85 via-ink-950/10 to-ink-950" />
        <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 220px 60px rgba(2,8,6,0.55)" }} />

        {/* Act 1 — headline */}
        <div
          ref={headRef}
          className="absolute inset-x-0 top-[14vh] z-10 flex flex-col items-center px-6 text-center sm:top-[15vh] will-change-[transform,opacity] max-md:transition-[opacity,transform] max-md:duration-500 max-md:ease-out"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3.5 py-1.5 font-mono text-[11px] tracking-[0.3em] text-copper-200 backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
            THE HOTEL OPERATING SYSTEM
          </span>
          <h1 className="mt-7 max-w-4xl font-display text-5xl leading-[1.03] tracking-tight text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.7)] sm:text-7xl">
            Everything in its place.
            <span className="mise-profit-text mt-1 block italic">Especially the profit.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            Inventory, recipes, purchasing, payroll, sales and a live P&amp;L — run from one place,
            with an AI copilot that knows your numbers.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Magnetic>
              <Link href="/signup" className={btnPrimary}>
                Register your hotel
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/login" className={btnGhost}>
                Sign in
              </Link>
            </Magnetic>
          </div>
          <p className="mt-4 font-mono text-xs text-slate-400">No card required · set up in minutes</p>
        </div>

        {/* Act 2 — the product rises */}
        <div className="absolute inset-x-0 bottom-0 z-20 flex justify-center" style={{ perspective: "1400px" }}>
          <div ref={dashRef} className="origin-bottom will-change-transform max-md:transition-transform max-md:duration-700 max-md:ease-out" style={{ transform: "translateY(66%) rotateX(18deg) scale(0.94)" }}>
            <DashboardSim />
          </div>
        </div>

        {/* caption that appears with the dashboard */}
        <div ref={capRef} className="pointer-events-none absolute inset-x-0 top-[7vh] z-10 text-center will-change-[opacity] max-md:transition-opacity max-md:duration-500" style={{ opacity: 0 }}>
          <p className="font-mono text-[11px] tracking-[0.35em] text-brand-300/90">THIS IS MISE</p>
          <p className="mt-2 font-display text-2xl text-white sm:text-3xl">
            Your whole operation, <em className="text-copper-200">live</em>.
          </p>
        </div>

        {/* scroll cue — sits BELOW the rising dashboard so the window covers it */}
        <div
          ref={cueRef}
          className="pointer-events-none absolute inset-x-0 bottom-6 z-[15] flex flex-col items-center gap-1.5 transition-opacity duration-300 will-change-[opacity] max-md:transition-opacity max-md:duration-300"
        >
          <span className="font-mono text-[10px] tracking-[0.35em] text-white/70">SCROLL</span>
          <span className="mise-scroll-chevron text-white/70">↓</span>
        </div>
      </div>
    </section>
  );
}
