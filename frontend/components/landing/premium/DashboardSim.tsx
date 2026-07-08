"use client";

// A realistic, animated simulation of the Mise dashboard — the "try it without
// logging in" moment. Everything is hand-drawn DOM/SVG (no screenshots), so it
// stays crisp on every screen and weighs almost nothing.

import { useEffect, useState } from "react";
import { Logo } from "@/components/Logo";
import { Counter, useInView, usePrefersReducedMotion } from "./bits";

const NAV = [
  { icon: "◧", label: "Dashboard", active: true },
  { icon: "📦", label: "Inventory" },
  { icon: "👨‍🍳", label: "Recipes" },
  { icon: "🛒", label: "Purchasing" },
  { icon: "🧾", label: "Sales & Cash" },
  { icon: "🗓", label: "Rota" },
  { icon: "📈", label: "Reports" },
  { icon: "✨", label: "Copilot" },
];

const KPIS = [
  { label: "Net sales · today", value: 1840, prefix: "£", trend: "↑ 12% vs last Tue", tone: "text-white" },
  { label: "Net profit · today", value: 612, prefix: "£", trend: "↑ 8% on target", tone: "text-copper-200" },
  { label: "Food cost", value: 29, suffix: "%", trend: "target 25–35%", tone: "text-brand-300" },
  { label: "Covers", value: 214, trend: "38 tables turned", tone: "text-white" },
];

// Two weeks of net sales for the chart — a believable shape, not noise.
const SALES = [920, 1040, 860, 1180, 1420, 1960, 2140, 980, 1120, 940, 1260, 1540, 2080, 2310];

const LOW_STOCK = [
  { name: "Paneer", left: "1.2 kg", min: "4 kg", pct: 26 },
  { name: "Basmati rice", left: "4 kg", min: "10 kg", pct: 38 },
  { name: "Chicken breast", left: "6 kg", min: "12 kg", pct: 48 },
];

const FEED = [
  { icon: "✓", tone: "text-brand-300", text: "PO-2214 received — Rudra Foods, £43.60" },
  { icon: "↗", tone: "text-amber-300", text: "Tomato price +12% at Rudra Veg" },
  { icon: "✨", tone: "text-copper-200", text: "Copilot re-costed 3 recipes automatically" },
  { icon: "🧾", tone: "text-slate-300", text: "Till reconciled — variance £0.00" },
  { icon: "🗓", tone: "text-slate-300", text: "Rota published for next week" },
  { icon: "✓", tone: "text-brand-300", text: "Payslips generated for 12 staff" },
];

const TOASTS = [
  { icon: "⚠", ring: "border-amber-400/30", chip: "bg-amber-500/20 text-amber-300", title: "Paneer low — reorder", sub: "1.2 kg left · min 4 kg" },
  { icon: "✓", ring: "border-brand-400/30", chip: "bg-brand-500/20 text-brand-300", title: "PO approved", sub: "Rudra Foods · £43.60" },
  { icon: "✨", ring: "border-copper-400/30", chip: "bg-copper-500/20 text-copper-200", title: "Copilot insight", sub: "Switch veg vendor → save £18/wk" },
];

/** SVG line+area chart that draws itself when scrolled into view. */
function SalesChart({ draw }: { draw: boolean }) {
  const W = 560;
  const H = 120;
  const max = Math.max(...SALES);
  const pts = SALES.map((v, i) => [
    (i / (SALES.length - 1)) * W,
    H - (v / max) * (H - 14) - 4,
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full sm:h-28" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="mise-sim-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#mise-sim-area)" style={{ opacity: draw ? 1 : 0, transition: "opacity 900ms ease 900ms" }} />
      <path
        d={line}
        fill="none"
        stroke="#34d399"
        strokeWidth="2.5"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={1}
        strokeDashoffset={draw ? 0 : 1}
        style={{ transition: "stroke-dashoffset 1600ms cubic-bezier(0.22,1,0.36,1) 250ms" }}
      />
      {/* tonight's point */}
      <circle
        cx={pts[pts.length - 1][0]}
        cy={pts[pts.length - 1][1]}
        r="4"
        fill="#a7f3d0"
        style={{ opacity: draw ? 1 : 0, transition: "opacity 400ms ease 1700ms" }}
      />
    </svg>
  );
}

export default function DashboardSim() {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);
  const reduced = usePrefersReducedMotion();
  const live = inView && !reduced;

  // Rotate the activity feed + the floating toast while visible.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 3200);
    return () => window.clearInterval(id);
  }, [live]);

  const feed = [0, 1, 2, 3].map((i) => FEED[(tick + i) % FEED.length]);
  const toast = TOASTS[tick % TOASTS.length];

  return (
    <div ref={ref} className="relative w-[min(1060px,94vw)]">
      {/* the app window */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-ink-800/95 to-ink-900/95 shadow-2xl shadow-black/60 ring-1 ring-white/5 backdrop-blur-xl">
        {/* chrome */}
        <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
          <span className="ml-3 font-mono text-[11px] text-slate-500">app.mise · dashboard</span>
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> Live
          </span>
        </div>

        <div className="flex">
          {/* sidebar */}
          <aside className="hidden w-44 shrink-0 border-r border-white/5 p-3 md:block">
            <div className="flex items-center gap-2 px-2 pb-3">
              <Logo size={20} />
              <span className="text-sm font-semibold text-white">NIRAI</span>
            </div>
            <nav className="space-y-0.5">
              {NAV.map((n) => (
                <span
                  key={n.label}
                  className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] ${
                    n.active ? "bg-brand-500/15 font-medium text-brand-200" : "text-slate-400"
                  }`}
                >
                  <span className="w-4 text-center text-[11px]">{n.icon}</span>
                  {n.label}
                </span>
              ))}
            </nav>
          </aside>

          {/* main */}
          <div className="min-w-0 flex-1 p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold text-white sm:text-base">Good evening, NIRAI</p>
              <p className="font-mono text-[10px] text-slate-500">Tue · service in progress</p>
            </div>

            {/* KPIs */}
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-2.5">
              {KPIS.map((k) => (
                <div key={k.label} className="rounded-xl border border-white/5 bg-white/[0.04] p-2.5 sm:p-3">
                  <p className="truncate text-[9px] uppercase tracking-wide text-slate-400 sm:text-[10px]">{k.label}</p>
                  <p className={`mt-1 font-mono text-base font-bold sm:text-lg ${k.tone}`}>
                    <Counter value={k.value} prefix={k.prefix ?? ""} suffix={k.suffix ?? ""} />
                  </p>
                  <p className="truncate text-[9px] text-brand-300/80 sm:text-[10px]">{k.trend}</p>
                </div>
              ))}
            </div>

            {/* chart */}
            <div className="mt-3 rounded-xl border border-white/5 bg-white/[0.03] p-3">
              <div className="flex items-baseline justify-between">
                <p className="text-[11px] font-medium text-slate-300">Net sales · last 14 days</p>
                <p className="font-mono text-[10px] text-brand-300">tonight £2,310</p>
              </div>
              <SalesChart draw={inView} />
            </div>

            {/* bottom row */}
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {/* low stock */}
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-slate-300">Low stock</p>
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300">
                    3 items
                  </span>
                </div>
                <div className="mt-2.5 space-y-2">
                  {LOW_STOCK.map((s, i) => (
                    <div key={s.name} className="flex items-center gap-2.5 text-[11px]">
                      <span className="w-24 shrink-0 truncate text-slate-300">{s.name}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <span
                          className="block h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300"
                          style={{
                            width: inView ? `${s.pct}%` : "0%",
                            transition: `width 900ms cubic-bezier(0.22,1,0.36,1) ${300 + i * 140}ms`,
                          }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-[10px] text-slate-400">
                        {s.left} <span className="text-slate-600">/ {s.min}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2.5 inline-flex rounded-lg border border-white/10 px-2.5 py-1 text-[10px] font-medium text-slate-300">
                  Order all low stock →
                </p>
              </div>

              {/* live activity */}
              <div className="rounded-xl border border-white/5 bg-white/[0.03] p-3">
                <p className="text-[11px] font-medium text-slate-300">Just now</p>
                <ul className="mt-2.5 space-y-1.5 overflow-hidden">
                  {feed.map((f, i) => (
                    <li
                      key={`${f.text}-${tick}-${i}`}
                      className={`flex items-start gap-2 text-[11px] leading-snug text-slate-400 ${i === 0 ? "mise-pop" : ""}`}
                    >
                      <span className={`w-4 shrink-0 text-center ${f.tone}`}>{f.icon}</span>
                      <span className="truncate">{f.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* floating glass cards around the window */}
      <div
        key={toast.title}
        className={`mise-pop absolute -top-4 right-2 hidden items-center gap-2.5 rounded-xl border ${toast.ring} bg-ink-900/95 px-3.5 py-2.5 text-xs shadow-2xl shadow-black/50 backdrop-blur sm:flex`}
      >
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${toast.chip}`}>{toast.icon}</span>
        <div>
          <p className="font-medium text-white">{toast.title}</p>
          <p className="text-slate-400">{toast.sub}</p>
        </div>
      </div>

      <div className="mise-float absolute -bottom-7 -left-8 hidden rounded-xl border border-white/10 bg-ink-900/95 px-3.5 py-2.5 shadow-2xl shadow-black/50 backdrop-blur xl:block">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">Butter Chicken</p>
        <p className="mt-0.5 font-mono text-sm font-bold text-copper-200">£3.41 · 71% GP</p>
        <p className="text-[10px] text-slate-400">re-costed live</p>
      </div>

      <div
        className="mise-float absolute -bottom-5 -right-4 hidden rounded-xl border border-brand-400/25 bg-ink-900/95 px-3.5 py-2.5 shadow-2xl shadow-black/50 backdrop-blur lg:block"
        style={{ animationDelay: "2.2s" }}
      >
        <p className="text-[10px] uppercase tracking-wide text-slate-500">Labour · this week</p>
        <p className="mt-0.5 font-mono text-sm font-bold text-brand-300">27% of net sales</p>
        <p className="text-[10px] text-slate-400">on target · rota published</p>
      </div>
    </div>
  );
}
