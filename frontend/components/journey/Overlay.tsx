"use client";

// The narrative layer that floats over the 3D world. Each "beat" is pinned
// full-screen and crossfades as the camera reaches its station — oversized
// typography + real product examples, so by the end of the flight a visitor
// understands exactly why Mise matters. Opacity/translate are written straight
// to the DOM from a rAF loop (never React state) so the words stay glued to the
// camera with zero re-render jank.

import Link from "next/link";
import { useEffect, useRef } from "react";
import { journeySmooth, windowOpacity } from "./progress";

type Align = "center" | "left" | "right";

// Windows are spaced with deliberate GAPS so only one beat is ever on screen at
// a time — between beats the words clear away and the 3D world breathes.
const BEATS: { start: number; end: number; align: Align }[] = [
  { start: -0.1, end: 0.075, align: "center" }, // 0 hero
  { start: 0.12, end: 0.215, align: "left" }, // 1 mise en place / calm
  { start: 0.255, end: 0.35, align: "right" }, // 2 one tree
  { start: 0.39, end: 0.485, align: "left" }, // 3 cost to the gram
  { start: 0.525, end: 0.62, align: "center" }, // 4 cooking in the dark
  { start: 0.655, end: 0.735, align: "right" }, // 5 our hotel can see
  { start: 0.765, end: 0.845, align: "center" }, // 6 step inside
  { start: 0.875, end: 0.93, align: "left" }, // 7 the money loop
  { start: 0.95, end: 1.2, align: "center" }, // 8 CTA
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

export default function Overlay() {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const p = journeySmooth.value;
      for (let i = 0; i < BEATS.length; i++) {
        const el = refs.current[i];
        if (!el) continue;
        const o = windowOpacity(p, BEATS[i].start, BEATS[i].end, 0.035);
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

  const setRef = (i: number) => (el: HTMLDivElement | null) => {
    refs.current[i] = el;
  };

  const beatClass = (i: number) =>
    `pointer-events-none fixed inset-0 z-20 flex flex-col justify-center px-7 sm:px-16 lg:px-24 ${alignCls[BEATS[i].align]}`;

  return (
    <div aria-hidden={false}>
      {/* 0 — HERO */}
      <div ref={setRef(0)} className={beatClass(0)} style={{ willChange: "opacity, transform" }}>
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

      {/* 1 — CALM / MISE EN PLACE */}
      <div ref={setRef(1)} className={beatClass(1)}>
        <div className="max-w-xl">
          <Kicker>FROM THE KITCHEN</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            Every great kitchen <em className="not-italic text-emerald-300">begins calm.</em>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            Before the rush, everything is prepped, weighed and in its place.
            The French call it <span className="italic text-amber-200">mise en place</span>.
            We applied the same discipline to the whole business.
          </p>
        </div>
      </div>

      {/* 2 — ONE TREE, EVERY HARVEST */}
      <div ref={setRef(2)} className={beatClass(2)}>
        <div className="max-w-xl">
          <Kicker>ONE PLATFORM</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            One tree. <em className="not-italic text-emerald-300">Every harvest.</em>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            Recipes, inventory, purchasing, staff, sales and profit don&apos;t live in eight
            spreadsheets here. They grow from one source of truth — so a price change in the
            morning re-costs every dish before lunch.
          </p>
        </div>
      </div>

      {/* 3 — COST TO THE GRAM */}
      <div ref={setRef(3)} className={beatClass(3)}>
        <div className="max-w-xl">
          <Kicker>COST INTELLIGENCE</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            Cost every dish <em className="not-italic text-amber-200">to the gram.</em>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            A delivery arrives and the cost blends into a weighted average automatically. Every
            recipe that uses it re-prices itself the moment it moves.
          </p>
          <div className="mt-6 inline-block rounded-2xl border border-white/15 bg-black/40 p-4 text-left backdrop-blur-md">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">Butter Chicken</p>
            <p className="mt-1 font-mono text-xl font-semibold text-emerald-300">£3.41 cost · 71% margin</p>
            <p className="mt-0.5 font-mono text-[11px] text-slate-400">chicken £4.20 → £4.35/kg · weighted avg, live</p>
          </div>
        </div>
      </div>

      {/* 4 — COOKING IN THE DARK */}
      <div ref={setRef(4)} className={beatClass(4)}>
        <div className="max-w-2xl">
          <Kicker>THE PROBLEM</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            Most kitchens cook <em className="not-italic text-rose-300">in the dark.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            Busy every night and still losing money — because no one can see which dish, which
            vendor or which shift is quietly eating the profit.
          </p>
        </div>
      </div>

      {/* 5 — OUR HOTEL CAN SEE */}
      <div ref={setRef(5)} className={beatClass(5)}>
        <div className="max-w-xl">
          <Kicker>WITH MISE</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            This one can see <em className="not-italic text-emerald-300">every penny.</em>
          </h2>
          <p className="mt-5 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            The lights are on. Money in, money out, and exactly what&apos;s left — live.
          </p>
          <div className="mt-6 flex flex-wrap gap-3 justify-end">
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

      {/* 6 — STEP INSIDE */}
      <div ref={setRef(6)} className={beatClass(6)}>
        <div className="max-w-xl">
          <Kicker>WELCOME</Kicker>
          <h2 className="mt-4 font-display text-5xl text-white drop-shadow sm:text-7xl">
            So step <em className="not-italic text-amber-200">inside.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            This is what your restaurant looks like with the lights on.
          </p>
        </div>
      </div>

      {/* 7 — THE MONEY LOOP */}
      <div ref={setRef(7)} className={beatClass(7)}>
        <div className="max-w-xl">
          <Kicker>THE MONEY LOOP</Kicker>
          <h2 className="mt-4 font-display text-4xl text-white drop-shadow sm:text-6xl">
            Watch a pound move <em className="not-italic text-emerald-300">through your kitchen.</em>
          </h2>
          <ol className="mt-6 space-y-2.5">
            {[
              ["01", "Stock comes in", "cost blends to a weighted average"],
              ["02", "Every dish is costed", "to the gram, the second prices move"],
              ["03", "You sell", "commissions off, till balanced"],
              ["04", "Profit, in the open", "a live P&L of what you actually kept"],
            ].map(([n, t, d]) => (
              <li key={n} className="flex items-baseline gap-3">
                <span className="font-mono text-sm text-emerald-300">{n}</span>
                <span className="text-base text-white drop-shadow sm:text-lg">
                  <span className="font-semibold">{t}</span>
                  <span className="text-slate-300"> — {d}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {/* 8 — CTA */}
      <div ref={setRef(8)} className={beatClass(8)}>
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
