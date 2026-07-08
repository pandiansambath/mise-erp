"use client";

// Reports: three glass cards over the "liquid gold" cinematic — a P&L that
// builds itself, a food-cost ring, and a cash-flow line that draws in. Charts
// are hand-rolled SVG/CSS so they animate at 60fps with zero dependencies.

import { Reveal } from "@/components/Reveal";
import { Aurora, Counter, SectionHead, useInView } from "./bits";

const PNL = [
  { n: "Net sales", v: "£41,208", pct: 100, deduct: false },
  { n: "Cost of sales", v: "−£11,950", pct: 29, deduct: true },
  { n: "Labour", v: "−£11,126", pct: 27, deduct: true },
  { n: "Overheads", v: "−£6,593", pct: 16, deduct: true },
];

const CASH = [12, 26, 18, 34, 30, 44, 40, 56, 48, 66, 60, 78, 72, 88];

function PnlCard() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-ink-900/85 p-5 backdrop-blur-xl sm:p-6">
      <p className="text-sm font-semibold text-white">Profit &amp; Loss</p>
      <p className="text-[11px] text-slate-500">this month · live</p>
      <div className="mt-4 space-y-2.5">
        {PNL.map((r, i) => (
          <div key={r.n} className="flex items-center gap-3 text-[12px]">
            <span className="w-24 shrink-0 text-slate-300">{r.n}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
              <span
                className={`block h-full rounded-full bg-gradient-to-r ${
                  r.deduct ? "from-amber-500/80 to-amber-300/80" : "from-slate-400 to-slate-200"
                }`}
                style={{
                  width: inView ? `${r.pct}%` : "0%",
                  transition: `width 1000ms cubic-bezier(0.22,1,0.36,1) ${i * 160}ms`,
                }}
              />
            </span>
            <span className="w-18 shrink-0 text-right font-mono text-[11px] text-slate-400">{r.v}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-baseline justify-between rounded-xl border border-copper-400/25 bg-copper-500/10 px-4 py-3">
        <span className="text-sm font-medium text-copper-200">You kept</span>
        <span className="font-mono text-xl font-bold text-copper-200">
          <Counter value={11539} prefix="£" /> · 28%
        </span>
      </div>
    </div>
  );
}

function FoodCostCard() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const R = 52;
  const C = 2 * Math.PI * R;
  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-ink-900/85 p-5 backdrop-blur-xl sm:p-6">
      <p className="text-sm font-semibold text-white">Food cost</p>
      <p className="text-[11px] text-slate-500">actual vs ideal · this week</p>
      <div className="mt-4 flex items-center justify-center gap-6">
        <div className="relative h-36 w-36">
          <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
            <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="11" />
            <circle
              cx="64"
              cy="64"
              r={R}
              fill="none"
              stroke="#34d399"
              strokeWidth="11"
              strokeLinecap="round"
              strokeDasharray={C}
              strokeDashoffset={inView ? C * (1 - 0.29) : C}
              style={{ transition: "stroke-dashoffset 1400ms cubic-bezier(0.22,1,0.36,1) 200ms" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <p className="font-mono text-2xl font-bold text-white">
                <Counter value={29} suffix="%" />
              </p>
              <p className="text-[10px] text-slate-500">of net sales</p>
            </div>
          </div>
        </div>
        <div className="space-y-2 text-[12px]">
          <p className="flex items-center gap-2 text-slate-300">
            <span className="h-2 w-2 rounded-full bg-brand-400" /> actual 29%
          </p>
          <p className="flex items-center gap-2 text-slate-400">
            <span className="h-2 w-2 rounded-full bg-white/25" /> ideal 27.2%
          </p>
          <p className="rounded-lg border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-200">
            1.8 pts of leak → £742/mo
          </p>
        </div>
      </div>
    </div>
  );
}

function CashCard() {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const W = 300;
  const H = 96;
  const max = Math.max(...CASH);
  const pts = CASH.map((v, i) => [(i / (CASH.length - 1)) * W, H - (v / max) * (H - 10) - 4]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <div ref={ref} className="rounded-2xl border border-white/10 bg-ink-900/85 p-5 backdrop-blur-xl sm:p-6">
      <p className="text-sm font-semibold text-white">Cash position</p>
      <p className="text-[11px] text-slate-500">rolling 14 days</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 h-24 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="mise-cash-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eab78a" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#eab78a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${line} L${W},${H} L0,${H} Z`}
          fill="url(#mise-cash-area)"
          style={{ opacity: inView ? 1 : 0, transition: "opacity 800ms ease 900ms" }}
        />
        <path
          d={line}
          fill="none"
          stroke="#eab78a"
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={inView ? 0 : 1}
          style={{ transition: "stroke-dashoffset 1500ms cubic-bezier(0.22,1,0.36,1) 250ms" }}
        />
      </svg>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[12px] text-slate-400">in the bank + till, after commitments</span>
        <span className="font-mono text-lg font-bold text-copper-200">
          <Counter value={8412} prefix="£" />
        </span>
      </div>
    </div>
  );
}

export default function Reports() {
  return (
    <section id="reports" className="mise-cv relative overflow-hidden">
      {/* the liquid-gold cinematic, veiled */}
      <img
        src="/experience/gold.jpg"
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover opacity-30"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950 via-ink-950/60 to-ink-950" />
      <Aurora strength={0.4} />

      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
        <Reveal>
          <SectionHead
            kicker="REPORTS"
            title={
              <>
                Know exactly <em className="mise-hero-text not-italic">what you keep.</em>
              </>
            }
            sub="Not dashboards for the sake of dashboards — three questions every operator asks, answered live: what did we make, where did it go, what's left."
          />
        </Reveal>
        <div className="mt-14 grid gap-5 lg:grid-cols-3">
          <Reveal delay={0}>
            <PnlCard />
          </Reveal>
          <Reveal delay={110}>
            <FoodCostCard />
          </Reveal>
          <Reveal delay={220}>
            <CashCard />
          </Reveal>
        </div>
        <Reveal delay={150}>
          <p className="mt-8 text-center font-mono text-xs text-slate-500">
            Every report exports to Excel, CSV or PDF · budgets & menu engineering included
          </p>
        </Reveal>
      </div>
    </section>
  );
}
