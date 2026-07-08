"use client";

// The story, compressed to three full-screen beats: ingredient → kitchen →
// money. Each beat is a normal-scroll viewport (no pinning, no scrubbing) with
// a one-shot cinematic morph that settles into a still. The copy carries the
// argument: chaos priced → kitchen costed → money visible.

import { Reveal } from "@/components/Reveal";
import CineMedia from "./CineMedia";

type Beat = {
  still: string;
  video?: string;
  kicker: string;
  title: [string, string];
  body: string;
  chip?: { label: string; value: string; sub: string };
  align: "left" | "right";
};

const BEATS: Beat[] = [
  {
    still: "source",
    video: "forest-to-source",
    kicker: "01 · THE INGREDIENT",
    title: ["Every plate", "begins as a price."],
    body: "A delivery lands and its true cost blends into a live weighted average — every ingredient tracked from the moment it arrives, to the gram.",
    chip: { label: "Tomato · Rudra Veg", value: "£1.84/kg → £1.92/kg", sub: "weighted average, updated on receipt" },
    align: "left",
  },
  {
    still: "fire",
    video: "garden-to-fire",
    kicker: "02 · THE KITCHEN",
    title: ["Service runs hot.", "Your numbers stay cold."],
    body: "The moment a supplier price moves, every dish that uses it re-costs itself. No spreadsheets, no month-end surprises — the margin is live.",
    chip: { label: "Butter Chicken", value: "£3.41 cost · 71% GP", sub: "re-priced the second the market moved" },
    align: "left",
  },
  {
    still: "gold",
    video: "table-to-gold",
    kicker: "03 · THE MONEY",
    title: ["Watch the money", "actually move."],
    body: "Sales, purchases, payroll and expenses roll into a living P&L. Not a report you build — a truth you glance at.",
    chip: { label: "Net profit · today", value: "£612 · 29% food cost", sub: "↑ 8% on target, till balanced to £0.00" },
    align: "right",
  },
];

export default function Story() {
  return (
    <section id="story" aria-label="How Mise works">
      {BEATS.map((b) => (
        <div key={b.still} className="relative flex min-h-screen items-center overflow-hidden">
          <CineMedia still={b.still} video={b.video} dim={0.38} />
          <div
            className={`relative z-10 mx-auto w-full max-w-6xl px-6 sm:px-10 ${
              b.align === "right" ? "flex justify-end" : ""
            }`}
          >
            <div className={`max-w-xl ${b.align === "right" ? "text-right" : ""}`}>
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
                <p className={`mt-6 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg ${b.align === "right" ? "ml-auto" : ""}`}>
                  {b.body}
                </p>
              </Reveal>
              {b.chip ? (
                <Reveal delay={330}>
                  <div className="mt-7 inline-block rounded-2xl border border-white/15 bg-black/45 p-4 text-left backdrop-blur-md">
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
    </section>
  );
}
