"use client";

// Two-act hero. Act 1: pure cinema — the floating dish under a spotlight with
// the brand line. Act 2: as you scroll, the film fades and the real product —
// a live dashboard simulation — rises and straightens into view. One sticky
// viewport, all transform/opacity (GPU-cheap), no scroll hijacking.

import Link from "next/link";
import { btnGhost, btnPrimary, Magnetic, usePrefersReducedMotion, useScrollProgress } from "./bits";
import DashboardSim from "./DashboardSim";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Remap progress so a phase runs 0→1 between a and b. */
const phase = (p: number, a: number, b: number) => clamp01((p - a) / (b - a));

export default function Hero() {
  const { ref, p } = useScrollProgress<HTMLElement>();
  const reduced = usePrefersReducedMotion();

  const fade = phase(p, 0.05, 0.5); // headline + film out
  const rise = phase(p, 0.12, 0.85); // dashboard in
  const eased = 1 - Math.pow(1 - rise, 3);

  return (
    <section ref={ref} className="relative" style={{ height: "230vh" }}>
      <div className="sticky top-0 h-screen overflow-hidden bg-ink-950">
        {/* Act 1 backdrop — the dish */}
        <img
          src="/experience/dish.jpg"
          alt=""
          fetchPriority="high"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: 1 - fade * 0.96,
            transform: reduced ? undefined : `scale(${1.06 + p * 0.1})`,
            transformOrigin: "50% 42%",
          }}
        />
        {/* Act 2 backdrop — above the clouds */}
        <img
          src="/experience/sky.jpg"
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          style={{ opacity: fade * 0.42 }}
        />
        {/* veils — keep type readable, blend edges into ink */}
        <div className="absolute inset-0 bg-gradient-to-b from-ink-950/85 via-ink-950/10 to-ink-950" />
        <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 220px 60px rgba(2,8,6,0.55)" }} />

        {/* Act 1 — headline */}
        <div
          className="absolute inset-x-0 top-[14vh] z-10 flex flex-col items-center px-6 text-center sm:top-[15vh]"
          style={{
            opacity: 1 - fade * 1.35,
            transform: reduced ? undefined : `translateY(${fade * -46}px)`,
            pointerEvents: fade > 0.5 ? "none" : undefined,
          }}
        >
          <span className="mise-enter is-in inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/30 px-3.5 py-1.5 font-mono text-[11px] tracking-[0.3em] text-copper-200 backdrop-blur">
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
        <div
          className="absolute inset-x-0 bottom-0 z-20 flex justify-center"
          style={{ perspective: "1400px" }}
        >
          <div
            className="origin-bottom"
            style={{
              transform: reduced
                ? "translateY(4%)"
                : `translateY(${(1 - eased) * 66}%) rotateX(${(1 - eased) * 18}deg) scale(${0.94 + eased * 0.06})`,
            }}
          >
            <DashboardSim />
          </div>
        </div>

        {/* caption that appears with the dashboard */}
        <div
          className="pointer-events-none absolute inset-x-0 top-[7vh] z-10 text-center"
          style={{ opacity: phase(p, 0.45, 0.75) }}
        >
          <p className="font-mono text-[11px] tracking-[0.35em] text-brand-300/90">THIS IS MISE</p>
          <p className="mt-2 font-display text-2xl text-white sm:text-3xl">
            Your whole operation, <em className="text-copper-200">live</em>.
          </p>
        </div>

        {/* scroll cue — sits BELOW the rising dashboard so the window covers it */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-6 z-[15] flex flex-col items-center gap-1.5"
          style={{ opacity: 1 - phase(p, 0.01, 0.08), transition: "opacity 300ms" }}
        >
          <span className="font-mono text-[10px] tracking-[0.35em] text-white/70">SCROLL</span>
          <span className="mise-scroll-chevron text-white/70">↓</span>
        </div>
      </div>
    </section>
  );
}
