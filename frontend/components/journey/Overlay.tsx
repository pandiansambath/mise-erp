"use client";

// The narrative layer over the peaceful HD footage. One beat per scene, in
// scroll order; each crossfades as the camera reaches its scene. Opacity is
// written straight to the DOM from a rAF loop (no React state) so the words stay
// glued to the footage. Windows are GAPPED so only one beat shows at a time.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { journeyProgress, windowOpacity } from "./progress";

type Align = "center" | "left" | "right";

const BEATS: { start: number; end: number; align: Align }[] = [
  { start: -0.1, end: 0.06, align: "center" }, // 0 hero — mountains
  { start: 0.1, end: 0.185, align: "left" }, // 1 calm — sea
  { start: 0.245, end: 0.327, align: "right" }, // 2 one platform — forest
  { start: 0.388, end: 0.47, align: "left" }, // 3 cost to the gram — produce
  { start: 0.53, end: 0.612, align: "center" }, // 4 the margin — cooking
  { start: 0.673, end: 0.755, align: "right" }, // 5 with Mise — dining
  { start: 0.815, end: 0.897, align: "center" }, // 6 the payoff — sharing
  { start: 0.95, end: 1.2, align: "center" }, // 7 CTA — sunrise
];

const alignCls: Record<Align, string> = {
  center: "items-center text-center",
  left: "items-start text-left",
  right: "items-end text-right",
};

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-[11px] tracking-[0.4em] text-emerald-300/90 sm:text-xs">
      {children}
    </span>
  );
}

const beatClass = (i: number) =>
  `pointer-events-none fixed inset-0 z-20 flex flex-col justify-center px-7 sm:px-16 lg:px-24 ${alignCls[BEATS[i].align]}`;

const h2 = "mt-4 font-display text-4xl leading-[1.06] text-white drop-shadow sm:text-6xl";
const body = "mt-5 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg";

export default function Overlay() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>("[data-beat]"));
    let raf = 0;
    const tick = () => {
      const p = journeyProgress.value;
      for (const el of els) {
        const i = Number(el.dataset.beat);
        const o = windowOpacity(p, BEATS[i].start, BEATS[i].end, 0.03);
        el.style.opacity = String(o);
        el.style.transform = `translateY(${(1 - o) * 26}px)`;
        el.style.pointerEvents = o > 0.6 ? "auto" : "none";
        el.style.visibility = o < 0.01 ? "hidden" : "visible";
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={rootRef}>
      {/* 0 — HERO (mountains) */}
      <div data-beat={0} className={beatClass(0)} style={{ willChange: "opacity, transform" }}>
        <div className="max-w-3xl">
          <Kicker>EVERY PLATE · EVERY PENNY</Kicker>
          <h1 className="mt-5 font-display text-5xl leading-[1.03] tracking-tight text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.6)] sm:text-7xl xl:text-8xl">
            Everything in its place.
            <span className="mt-1 block bg-gradient-to-r from-emerald-300 to-amber-200 bg-clip-text italic text-transparent">
              Especially the profit.
            </span>
          </h1>
          <p className="mx-auto mt-7 max-w-xl text-lg text-slate-200/90 drop-shadow">
            Mise is the operating system for your restaurant. Take a journey through it.
          </p>
        </div>
      </div>

      {/* 1 — CALM (sea) */}
      <div data-beat={1} className={beatClass(1)}>
        <div className="max-w-xl">
          <Kicker>MISE EN PLACE</Kicker>
          <h2 className={h2}>
            Calm comes from <em className="not-italic text-emerald-300">control.</em>
          </h2>
          <p className={body}>
            Before the rush, every cost, order and shift is in its place. The French call it
            <span className="italic text-amber-200"> mise en place</span> — we applied it to the
            whole business.
          </p>
        </div>
      </div>

      {/* 2 — ONE PLATFORM (forest) */}
      <div data-beat={2} className={beatClass(2)}>
        <div className="max-w-xl">
          <Kicker>ONE PLATFORM</Kicker>
          <h2 className={h2}>
            It all grows from <em className="not-italic text-emerald-300">one source.</em>
          </h2>
          <p className={body}>
            Recipes, inventory, purchasing, staff, sales and profit aren&apos;t eight spreadsheets
            here. They grow from one source of truth — so a price change in the morning re-costs
            every dish before lunch.
          </p>
        </div>
      </div>

      {/* 3 — COST TO THE GRAM (produce) */}
      <div data-beat={3} className={beatClass(3)}>
        <div className="max-w-xl">
          <Kicker>COST INTELLIGENCE</Kicker>
          <h2 className={h2}>
            Cost every dish <em className="not-italic text-amber-200">to the gram.</em>
          </h2>
          <p className={body}>
            A delivery arrives and its cost blends into a weighted average automatically. Every
            recipe that uses it re-prices itself the moment it moves.
          </p>
          <div className="mt-6 inline-block rounded-2xl border border-white/15 bg-black/40 p-4 text-left backdrop-blur-md">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Butter Chicken</p>
            <p className="mt-1 font-mono text-xl font-semibold text-emerald-300">£3.41 cost · 71% margin</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-400">chicken £4.20 → £4.35/kg · weighted avg, live</p>
          </div>
        </div>
      </div>

      {/* 4 — THE MARGIN (cooking) */}
      <div data-beat={4} className={beatClass(4)}>
        <div className="max-w-2xl">
          <Kicker>THE MARGIN</Kicker>
          <h2 className={h2}>
            Every plate is <em className="not-italic text-amber-200">a promise.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            Your margins decide whether you can keep it. Mise shows what every dish really earns —
            the second a vendor price moves.
          </p>
        </div>
      </div>

      {/* 5 — WITH MISE (dining) */}
      <div data-beat={5} className={beatClass(5)}>
        <div className="max-w-xl">
          <Kicker>WITH MISE</Kicker>
          <h2 className={h2}>
            See <em className="not-italic text-emerald-300">every penny.</em>
          </h2>
          <p className={body}>The lights are on. Money in, money out, and exactly what&apos;s left — live.</p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            {[
              ["Net profit, today", "£612", "↑ 8%"],
              ["Food cost", "29%", "on target"],
            ].map(([l, v, t]) => (
              <div key={l} className="rounded-2xl border border-white/15 bg-black/40 px-5 py-3 text-left backdrop-blur-md">
                <p className="text-[11px] uppercase tracking-wide text-slate-400">{l}</p>
                <p className="mt-1 font-mono text-xl font-bold text-amber-200">{v}</p>
                <p className="text-[11px] text-emerald-300">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 6 — THE PAYOFF (sharing) */}
      <div data-beat={6} className={beatClass(6)}>
        <div className="max-w-2xl">
          <Kicker>THE PAYOFF</Kicker>
          <h2 className={h2}>
            Full tables. <em className="not-italic text-emerald-300">Profit in the open.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            When the numbers work, everyone eats — and you keep what you earned.
          </p>
        </div>
      </div>

      {/* 7 — CTA (sunrise) */}
      <div data-beat={7} className={beatClass(7)}>
        <div className="max-w-2xl">
          <Kicker>YOUR TURN</Kicker>
          <h2 className="mt-4 font-display text-5xl leading-[1.05] text-white drop-shadow sm:text-7xl">
            Bring order to the kitchen —
            <span className="mt-1 block bg-gradient-to-r from-emerald-300 to-amber-200 bg-clip-text italic text-transparent">
              and the books.
            </span>
          </h2>
          <p className="mx-auto mt-6 max-w-md text-base text-slate-200/90 drop-shadow sm:text-lg">
            Set up your restaurant in minutes. Costs, recipes, staff and profit — all in one place.
            No card required.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-7 py-3.5 text-base font-semibold text-emerald-950 shadow-xl shadow-emerald-500/30 transition hover:shadow-2xl hover:shadow-emerald-400/40"
            >
              Register your hotel
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/10"
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
