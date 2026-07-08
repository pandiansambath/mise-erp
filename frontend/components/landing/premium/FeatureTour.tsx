"use client";

// The product tour. Desktop: a sticky mock panel on the right morphs while the
// feature copy scrolls on the left (scroll drives the active feature — no icon
// grid). Mobile: each feature card carries its own mini-mock inline.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { SectionHead } from "./bits";

/* ────────────────────────── mock panels ────────────────────────── */

function Row({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`flex items-center gap-3 text-[12px] ${className}`}>{children}</div>;
}

function Bar({ pct, tone = "from-brand-500 to-brand-300" }: { pct: number; tone?: string }) {
  return (
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <span className={`block h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

function MockInventory() {
  const rows = [
    { n: "Basmati rice", v: "42 kg", pct: 84, low: false },
    { n: "Chicken breast", v: "6 kg", pct: 48, low: false },
    { n: "Paneer", v: "1.2 kg", pct: 22, low: true },
    { n: "Tomatoes", v: "18 kg", pct: 72, low: false },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <Row key={r.n} className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <span className="w-28 shrink-0 truncate text-slate-200">{r.n}</span>
          <Bar pct={r.pct} tone={r.low ? "from-amber-500 to-amber-300" : "from-brand-500 to-brand-300"} />
          <span className="w-14 shrink-0 text-right font-mono text-[11px] text-slate-400">{r.v}</span>
          {r.low ? (
            <span className="shrink-0 rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300">
              LOW
            </span>
          ) : (
            <span className="w-9 shrink-0" />
          )}
        </Row>
      ))}
      <p className="pt-1 font-mono text-[10px] text-slate-500">
        Stock valued live at weighted-average cost · <span className="text-copper-200">£4,318 on the shelf</span>
      </p>
    </div>
  );
}

function MockRecipes() {
  const ing = [
    { n: "Chicken breast · 180 g", v: "£1.12" },
    { n: "Butter · 40 g", v: "£0.36" },
    { n: "Cream · 60 ml", v: "£0.31" },
    { n: "Spice blend · 12 g", v: "£0.44" },
    { n: "Tomato base · 120 g", v: "£0.68" },
  ];
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-white">Butter Chicken</p>
        <span className="rounded-full border border-brand-400/30 bg-brand-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-brand-300">
          71% GP
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        {ing.map((i) => (
          <Row key={i.n} className="justify-between border-b border-white/5 pb-1.5">
            <span className="text-slate-300">{i.n}</span>
            <span className="font-mono text-[11px] text-slate-400">{i.v}</span>
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[12px] text-slate-400">Plate cost → menu £11.95</span>
        <span className="font-mono text-lg font-bold text-copper-200">£3.41</span>
      </div>
      <p className="mt-2 font-mono text-[10px] text-slate-500">Re-costs itself when any vendor price moves</p>
    </div>
  );
}

function MockPurchasing() {
  return (
    <div className="space-y-2.5">
      <div className="rounded-lg border border-white/10 bg-white/[0.04] p-3">
        <p className="text-[11px] font-medium text-slate-300">Kitchen indent · 9 items</p>
        <p className="mt-1 text-[11px] text-slate-500">Split by cheapest vendor →</p>
      </div>
      {[
        { v: "Rudra Foods", items: "5 items", total: "£43.60", tag: "cheapest on 5/5" },
        { v: "Farm2Land", items: "4 items", total: "£28.90", tag: "cheapest on 4/4" },
      ].map((po) => (
        <div key={po.v} className="rounded-lg border border-brand-400/20 bg-brand-500/[0.06] p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] font-semibold text-white">PO → {po.v}</p>
            <p className="font-mono text-[12px] font-bold text-copper-200">{po.total}</p>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">{po.items}</p>
            <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[9px] font-medium text-brand-300">{po.tag}</span>
          </div>
        </div>
      ))}
      <p className="font-mono text-[10px] text-slate-500">Received → stock & costs update automatically</p>
    </div>
  );
}

function MockStaff() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <div key={d} className="rounded-lg border border-white/5 bg-white/[0.03] p-1.5 text-center">
            <p className="text-[9px] uppercase text-slate-500">{d}</p>
            <div className={`mt-1 rounded px-1 py-1 text-[9px] font-medium ${i === 5 || i === 6 ? "bg-copper-500/20 text-copper-200" : "bg-brand-500/15 text-brand-200"}`}>
              {i === 5 || i === 6 ? "3 shifts" : "2 shifts"}
            </div>
          </div>
        ))}
      </div>
      <Row className="mt-3.5">
        <span className="w-32 shrink-0 text-slate-300">Labour this week</span>
        <Bar pct={27} />
        <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-300">27% of net sales</span>
      </Row>
      <p className="mt-3 font-mono text-[10px] text-slate-500">
        Punch clock → attendance → UK-compliant payslips, one thread
      </p>
    </div>
  );
}

function MockSales() {
  const ch = [
    { n: "Dine-in", v: "£1,180", note: "no commission" },
    { n: "Deliveroo", v: "£412", note: "−28% commission" },
    { n: "Takeaway", v: "£248", note: "no commission" },
  ];
  return (
    <div className="space-y-2">
      {ch.map((c) => (
        <Row key={c.n} className="justify-between rounded-lg border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <span className="text-slate-200">{c.n}</span>
          <span className="text-[10px] text-slate-500">{c.note}</span>
          <span className="font-mono text-[12px] font-semibold text-white">{c.v}</span>
        </Row>
      ))}
      <div className="rounded-lg border border-brand-400/25 bg-brand-500/[0.07] px-3 py-2.5">
        <Row className="justify-between">
          <span className="font-medium text-brand-200">Till reconciled</span>
          <span className="font-mono text-[12px] font-bold text-brand-300">variance £0.00 ✓</span>
        </Row>
      </div>
    </div>
  );
}

function MockReports() {
  const rows = [
    { n: "Net sales", v: "£41,208", pct: 100, tone: "from-slate-400 to-slate-300" },
    { n: "Cost of sales", v: "−£11,950", pct: 29, tone: "from-amber-500 to-amber-300" },
    { n: "Labour", v: "−£11,126", pct: 27, tone: "from-amber-500 to-amber-300" },
    { n: "Overheads", v: "−£6,593", pct: 16, tone: "from-amber-500 to-amber-300" },
  ];
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-300">P&L · this month</p>
      <div className="mt-2.5 space-y-2">
        {rows.map((r) => (
          <Row key={r.n}>
            <span className="w-24 shrink-0 text-slate-300">{r.n}</span>
            <Bar pct={r.pct} tone={r.tone} />
            <span className="w-20 shrink-0 text-right font-mono text-[11px] text-slate-400">{r.v}</span>
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between rounded-lg border border-copper-400/25 bg-copper-500/[0.08] px-3 py-2.5">
        <span className="text-[12px] font-medium text-copper-200">Net profit</span>
        <span className="font-mono text-base font-bold text-copper-200">£11,539 · 28%</span>
      </div>
      <p className="mt-2 font-mono text-[10px] text-slate-500">Excel / CSV / PDF export · food-cost variance vs ideal</p>
    </div>
  );
}

/* ─────────────────────────── the tour ──────────────────────────── */

const FEATURES = [
  {
    key: "inventory",
    icon: "📦",
    title: "Inventory that knows its worth",
    body: "Live stock at weighted-average cost, low-stock alerts, waste log, stock-take variance — the shelf, valued in pounds at all times.",
    mock: <MockInventory />,
  },
  {
    key: "recipes",
    icon: "👨‍🍳",
    title: "Recipes costed to the gram",
    body: "Every dish knows its plate cost and margin, pulls live vendor prices, and re-costs itself the moment the market moves.",
    mock: <MockRecipes />,
  },
  {
    key: "purchasing",
    icon: "🛒",
    title: "Purchasing on autopilot",
    body: "Kitchen indents become purchase orders grouped by the cheapest vendor. Receiving a delivery updates stock and costs in one tap.",
    mock: <MockPurchasing />,
  },
  {
    key: "staff",
    icon: "🧑‍🤝‍🧑",
    title: "Rota, attendance & payroll",
    body: "Shifts with break rules, a punch clock, salary advances and UK-compliant payslips — with labour % of sales watching the line.",
    mock: <MockStaff />,
  },
  {
    key: "sales",
    icon: "🧾",
    title: "Sales & a till that balances",
    body: "Takings by channel with delivery commissions handled, petty cash, and a cash drawer reconciled to the penny every night.",
    mock: <MockSales />,
  },
  {
    key: "reports",
    icon: "📈",
    title: "Reports that end arguments",
    body: "A live P&L from gross to net, food-cost variance against ideal, budgets, menu engineering — one set of numbers for every role.",
    mock: <MockReports />,
  },
];

export default function FeatureTour() {
  const [active, setActive] = useState(0);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // The left card nearest the viewport centre drives the sticky panel.
  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const idx = itemRefs.current.indexOf(e.target as HTMLDivElement);
          if (idx >= 0) setActive(idx);
        }
      },
      { rootMargin: "-42% 0px -42% 0px" },
    );
    itemRefs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <section id="product" className="relative border-t border-white/5 bg-ink-950">
      <div className="mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
        <Reveal>
          <SectionHead
            kicker="ONE SYSTEM · EVERY DEPARTMENT"
            title={
              <>
                From the pass <em className="mise-hero-text not-italic">to the P&amp;L.</em>
              </>
            }
            sub="Every department usually means another tool that disagrees. In Mise they all share one brain — change a price anywhere and every number downstream already knows."
          />
        </Reveal>

        <div className="mt-16 grid gap-10 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
          {/* left — the copy list */}
          <div className="space-y-5 lg:space-y-40 lg:py-24">
            {FEATURES.map((f, i) => (
              <div
                key={f.key}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
              >
                <Reveal>
                  <div
                    className={`rounded-2xl border p-6 transition-colors duration-500 lg:border-0 lg:bg-transparent lg:p-0 ${
                      active === i ? "border-brand-400/30 bg-white/[0.04]" : "border-white/10 bg-white/[0.02]"
                    }`}
                  >
                    <span
                      className={`grid h-11 w-11 place-items-center rounded-xl border text-xl transition-colors duration-500 ${
                        active === i ? "border-brand-400/40 bg-brand-500/10" : "border-white/10 bg-white/[0.05]"
                      }`}
                    >
                      {f.icon}
                    </span>
                    <h3
                      className={`mt-4 font-display text-2xl transition-colors duration-500 sm:text-3xl ${
                        active === i ? "text-white" : "text-slate-300 lg:text-slate-500"
                      }`}
                    >
                      {f.title}
                    </h3>
                    <p
                      className={`mt-3 max-w-md leading-relaxed transition-colors duration-500 ${
                        active === i ? "text-slate-300" : "text-slate-400 lg:text-slate-600"
                      }`}
                    >
                      {f.body}
                    </p>
                    {/* inline mock on small screens */}
                    <div className="mt-5 rounded-xl border border-white/10 bg-ink-900/80 p-4 lg:hidden">{f.mock}</div>
                  </div>
                </Reveal>
              </div>
            ))}
          </div>

          {/* right — the sticky morphing panel (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-ink-800/95 to-ink-900/95 shadow-2xl shadow-black/50 ring-1 ring-white/5">
                <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 font-mono text-[11px] text-slate-500">mise · {FEATURES[active].key}</span>
                </div>
                <div className="relative min-h-[380px] p-6">
                  {FEATURES.map((f, i) => (
                    <div
                      key={f.key}
                      className="absolute inset-0 p-6 transition-all duration-500"
                      style={{
                        opacity: active === i ? 1 : 0,
                        transform: active === i ? "translateY(0)" : "translateY(14px)",
                        pointerEvents: active === i ? "auto" : "none",
                      }}
                    >
                      {f.mock}
                    </div>
                  ))}
                </div>
              </div>
              {/* progress dots */}
              <div className="mt-5 flex justify-center gap-2">
                {FEATURES.map((f, i) => (
                  <span
                    key={f.key}
                    className={`h-1.5 rounded-full transition-all duration-400 ${
                      active === i ? "w-7 bg-brand-400" : "w-1.5 bg-white/15"
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
