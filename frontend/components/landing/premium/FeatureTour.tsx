"use client";

// The product tour. Desktop: a sticky demo panel on the right MORPHS while the
// feature copy scrolls on the left. Every demo is ALIVE — rows light up in
// sequence, values blip, badges pulse — the machine visibly running, never a
// dead screenshot. Mobile: each feature card carries its own live mini-demo.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal } from "@/components/Reveal";
import { Aurora, Counter, SectionHead, useTick } from "./bits";

/* ────────────────────────── live demo panels ────────────────────────── */

function Row({ children, hot = false, className = "" }: { children: ReactNode; hot?: boolean; className?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-lg text-[12px] transition-colors duration-500 ${hot ? "mise-l-live-row" : ""} ${className}`}>
      {children}
    </div>
  );
}

function Bar({ pct, tone = "from-brand-500 to-brand-300" }: { pct: number; tone?: string }) {
  return (
    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
      <span
        className={`block h-full rounded-full bg-gradient-to-r ${tone}`}
        style={{ width: `${pct}%`, transition: "width 700ms cubic-bezier(0.22,1,0.36,1)" }}
      />
    </span>
  );
}

function LiveDot() {
  return (
    <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-brand-300/90">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> live
    </span>
  );
}

function MockInventory() {
  const hot = useTick(4, 2000);
  const rows = [
    { n: "Basmati rice", v: "42 kg", pct: 84, low: false },
    { n: "Chicken breast", v: "6 kg", pct: 48, low: false },
    { n: "Paneer", v: "1.2 kg", pct: 22, low: true },
    { n: "Tomatoes", v: "18 kg", pct: 72, low: false },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <Row key={r.n} hot={hot === i} className="border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <span className="w-28 shrink-0 truncate text-slate-200">{r.n}</span>
          <Bar pct={r.pct + (hot === i ? 4 : 0)} tone={r.low ? "from-amber-500 to-amber-300" : "from-brand-500 to-brand-300"} />
          <span className={`w-14 shrink-0 text-right font-mono text-[11px] text-slate-400 ${hot === i ? "mise-l-blip" : ""}`}>{r.v}</span>
          {r.low ? (
            <span className="shrink-0 animate-pulse rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300">
              LOW
            </span>
          ) : (
            <span className="w-9 shrink-0" />
          )}
        </Row>
      ))}
      <div className="flex items-center pt-1">
        <p className="font-mono text-[10px] text-slate-500">
          Shelf valued live · <span className="text-copper-200">£4,318</span>
        </p>
        <LiveDot />
      </div>
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
  const hot = useTick(ing.length + 1, 1500); // final beat lands on the total
  const totalHot = hot === ing.length;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-semibold text-white">Butter Chicken</p>
        <span className={`rounded-full border border-brand-400/30 bg-brand-500/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-brand-300 ${totalHot ? "mise-l-blip" : ""}`}>
          71% GP
        </span>
      </div>
      <div className="mt-3 space-y-1">
        {ing.map((i, idx) => (
          <Row key={i.n} hot={hot === idx} className="justify-between border-b border-white/5 px-2 py-1.5">
            <span className="text-slate-300">{i.n}</span>
            <span className={`font-mono text-[11px] text-slate-400 ${hot === idx ? "mise-l-blip text-copper-200" : ""}`}>{i.v}</span>
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-[12px] text-slate-400">Plate cost → menu £11.95</span>
        <span className={`font-mono text-lg font-bold text-copper-200 ${totalHot ? "mise-l-blip" : ""}`}>£3.41</span>
      </div>
      <div className="mt-2 flex items-center">
        <p className="font-mono text-[10px] text-slate-500">Re-costs itself when any vendor price moves</p>
        <LiveDot />
      </div>
    </div>
  );
}

function MockPurchasing() {
  const hot = useTick(3, 1900);
  const pos = [
    { v: "Rudra Foods", items: "5 items", total: "£43.60", tag: "cheapest on 5/5" },
    { v: "Farm2Land", items: "4 items", total: "£28.90", tag: "cheapest on 4/4" },
  ];
  return (
    <div className="space-y-2.5">
      <div className={`rounded-lg border border-white/10 bg-white/[0.04] p-3 transition-colors duration-500 ${hot === 0 ? "mise-l-live-row" : ""}`}>
        <p className="text-[11px] font-medium text-slate-300">Kitchen indent · 9 items</p>
        <p className="mt-1 text-[11px] text-slate-500">Split by cheapest vendor →</p>
      </div>
      {pos.map((po, i) => (
        <div
          key={po.v}
          className={`rounded-lg border border-brand-400/20 bg-brand-500/[0.06] p-3 transition-colors duration-500 ${hot === i + 1 ? "mise-l-live-row" : ""}`}
        >
          <div className="flex items-baseline justify-between">
            <p className="text-[12px] font-semibold text-white">PO → {po.v}</p>
            <p className={`font-mono text-[12px] font-bold text-copper-200 ${hot === i + 1 ? "mise-l-blip" : ""}`}>{po.total}</p>
          </div>
          <div className="mt-1 flex items-center justify-between">
            <p className="text-[11px] text-slate-400">{po.items}</p>
            <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[9px] font-medium text-brand-300">{po.tag}</span>
          </div>
        </div>
      ))}
      <div className="flex items-center">
        <p className="font-mono text-[10px] text-slate-500">Received → stock &amp; costs update automatically</p>
        <LiveDot />
      </div>
    </div>
  );
}

function MockStaff() {
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const hot = useTick(7, 1300);
  const labour = 26 + (hot % 3);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {days.map((d, i) => (
          <div
            key={d}
            className={`rounded-lg border border-white/5 bg-white/[0.03] p-1.5 text-center transition-colors duration-400 ${hot === i ? "mise-l-live-row" : ""}`}
          >
            <p className="text-[9px] uppercase text-slate-500">{d}</p>
            <div className={`mt-1 rounded px-1 py-1 text-[9px] font-medium ${i === 5 || i === 6 ? "bg-copper-500/20 text-copper-200" : "bg-brand-500/15 text-brand-200"}`}>
              {i === 5 || i === 6 ? "3 shifts" : "2 shifts"}
            </div>
          </div>
        ))}
      </div>
      <Row className="mt-3.5">
        <span className="w-32 shrink-0 text-slate-300">Labour this week</span>
        <Bar pct={labour} />
        <span className="shrink-0 font-mono text-[11px] font-semibold text-brand-300">
          <span key={labour} className="mise-l-blip">{labour}%</span> of net sales
        </span>
      </Row>
      <div className="mt-3 flex items-center">
        <p className="font-mono text-[10px] text-slate-500">Punch clock → attendance → UK-compliant payslips</p>
        <LiveDot />
      </div>
    </div>
  );
}

function MockSales() {
  const hot = useTick(4, 1700);
  const ch = [
    { n: "Dine-in", v: "£1,180", note: "no commission" },
    { n: "Deliveroo", v: "£412", note: "−28% commission" },
    { n: "Takeaway", v: "£248", note: "no commission" },
  ];
  return (
    <div className="space-y-2">
      {ch.map((c, i) => (
        <Row key={c.n} hot={hot === i} className="justify-between border border-white/5 bg-white/[0.03] px-3 py-2.5">
          <span className="text-slate-200">{c.n}</span>
          <span className="text-[10px] text-slate-500">{c.note}</span>
          <span className={`font-mono text-[12px] font-semibold text-white ${hot === i ? "mise-l-blip" : ""}`}>{c.v}</span>
        </Row>
      ))}
      <div className={`rounded-lg border border-brand-400/25 bg-brand-500/[0.07] px-3 py-2.5 transition-colors duration-500 ${hot === 3 ? "mise-l-live-row" : ""}`}>
        <Row className="justify-between">
          <span className="font-medium text-brand-200">Till reconciled</span>
          <span className={`font-mono text-[12px] font-bold text-brand-300 ${hot === 3 ? "mise-l-blip" : ""}`}>variance £0.00 ✓</span>
        </Row>
      </div>
      <div className="flex items-center">
        <p className="font-mono text-[10px] text-slate-500">Petty cash &amp; carry-over handled nightly</p>
        <LiveDot />
      </div>
    </div>
  );
}

function MockReports() {
  const hot = useTick(4, 1600);
  const rows = [
    { n: "Net sales", v: "£41,208", pct: 100, tone: "from-slate-400 to-slate-300" },
    { n: "Cost of sales", v: "−£11,950", pct: 29, tone: "from-amber-500 to-amber-300" },
    { n: "Labour", v: "−£11,126", pct: 27, tone: "from-amber-500 to-amber-300" },
    { n: "Overheads", v: "−£6,593", pct: 16, tone: "from-amber-500 to-amber-300" },
  ];
  return (
    <div>
      <p className="text-[11px] font-medium text-slate-300">P&L · this month</p>
      <div className="mt-2.5 space-y-1.5">
        {rows.map((r, i) => (
          <Row key={r.n} hot={hot === i} className="px-2 py-1">
            <span className="w-24 shrink-0 text-slate-300">{r.n}</span>
            <Bar pct={r.pct} tone={r.tone} />
            <span className={`w-20 shrink-0 text-right font-mono text-[11px] text-slate-400 ${hot === i ? "mise-l-blip" : ""}`}>{r.v}</span>
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-baseline justify-between rounded-lg border border-copper-400/25 bg-copper-500/[0.08] px-3 py-2.5">
        <span className="text-[12px] font-medium text-copper-200">Net profit</span>
        <span className="font-mono text-base font-bold text-copper-200">
          <Counter value={11539} prefix="£" /> · 28%
        </span>
      </div>
      <div className="mt-2 flex items-center">
        <p className="font-mono text-[10px] text-slate-500">Excel / CSV / PDF export · variance vs ideal</p>
        <LiveDot />
      </div>
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
    Mock: MockInventory,
  },
  {
    key: "recipes",
    icon: "👨‍🍳",
    title: "Recipes costed to the gram",
    body: "Every dish knows its plate cost and margin, pulls live vendor prices, and re-costs itself the moment the market moves.",
    Mock: MockRecipes,
  },
  {
    key: "purchasing",
    icon: "🛒",
    title: "Purchasing on autopilot",
    body: "Kitchen indents become purchase orders grouped by the cheapest vendor. Receiving a delivery updates stock and costs in one tap.",
    Mock: MockPurchasing,
  },
  {
    key: "staff",
    icon: "🧑‍🤝‍🧑",
    title: "Rota, attendance & payroll",
    body: "Shifts with break rules, a punch clock, salary advances and UK-compliant payslips — with labour % of sales watching the line.",
    Mock: MockStaff,
  },
  {
    key: "sales",
    icon: "🧾",
    title: "Sales & a till that balances",
    body: "Takings by channel with delivery commissions handled, petty cash, and a cash drawer reconciled to the penny every night.",
    Mock: MockSales,
  },
  {
    key: "reports",
    icon: "📈",
    title: "Reports that end arguments",
    body: "A live P&L from gross to net, food-cost variance against ideal, budgets, menu engineering — one set of numbers for every role.",
    Mock: MockReports,
  },
];

// Embers drifting through the tour's dark air — the copy column leaves a lot
// of black between blocks on desktop; these keep that space alive.
const TOUR_MOTES = [
  { left: "8%", size: 5, tint: "rgba(234,183,138,0.7)", d: 0, t: 13, x: 34, o: 0.4 },
  { left: "22%", size: 3, tint: "rgba(148,233,184,0.6)", d: 3.2, t: 11, x: -26, o: 0.35 },
  { left: "38%", size: 4, tint: "rgba(226,217,202,0.55)", d: 6.1, t: 15, x: 18, o: 0.3 },
  { left: "47%", size: 3, tint: "rgba(234,183,138,0.6)", d: 1.6, t: 12, x: -30, o: 0.35 },
  { left: "60%", size: 5, tint: "rgba(148,233,184,0.5)", d: 4.4, t: 14, x: 24, o: 0.3 },
  { left: "76%", size: 3, tint: "rgba(226,217,202,0.5)", d: 7.8, t: 12, x: -20, o: 0.3 },
  { left: "90%", size: 4, tint: "rgba(234,183,138,0.55)", d: 2.7, t: 13, x: 28, o: 0.35 },
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

  const Active = FEATURES[active].Mock;

  return (
    // No overflow-hidden on this section — it would break the sticky demo panel.
    <section id="product" className="relative bg-ink-950">
      <Aurora strength={0.8} />
      {/* fill the void: faint dot grid + a warm hearth glow behind the panel */}
      <div className="mise-dots pointer-events-none absolute inset-0" aria-hidden />
      <div
        className="pointer-events-none absolute right-[-8%] top-1/4 hidden h-[560px] w-[560px] rounded-full lg:block"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.10), rgba(234,183,138,0.06) 45%, transparent 70%)" }}
        aria-hidden
      />
      {/* a second hearth on the copy side + embers rising through the section,
          so the air between the copy blocks never reads as dead black */}
      <div
        className="pointer-events-none absolute left-[-10%] top-[55%] hidden h-[520px] w-[520px] rounded-full lg:block"
        style={{ background: "radial-gradient(circle, rgba(234,183,138,0.08), rgba(16,185,129,0.05) 45%, transparent 70%)" }}
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="sticky top-0 h-screen overflow-hidden">
          {TOUR_MOTES.map((m, i) => (
            <span
              key={i}
              className="mise-l-mote"
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
      </div>
      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
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
                      active === i ? "border-brand-400/30 bg-ink-900/80" : "border-white/10 bg-ink-900/60"
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
                        active === i ? "text-white" : "text-slate-300 lg:text-slate-400"
                      }`}
                    >
                      {f.title}
                    </h3>
                    <p
                      className={`mt-3 max-w-md leading-relaxed transition-colors duration-500 ${
                        active === i ? "text-slate-300" : "text-slate-400 lg:text-slate-500"
                      }`}
                    >
                      {f.body}
                    </p>
                    {/* inline live demo on small screens */}
                    <div className="mt-5 rounded-xl border border-white/10 bg-ink-900/80 p-4 lg:hidden">
                      <f.Mock />
                    </div>
                  </div>
                </Reveal>
              </div>
            ))}
          </div>

          {/* right — the sticky morphing panel (desktop) */}
          <div className="hidden lg:block">
            <div className="sticky top-24">
              <div className="mise-liquid relative overflow-hidden rounded-2xl border border-white/15 bg-gradient-to-br from-ink-800/90 to-ink-900/95 shadow-2xl shadow-black/50 ring-1 ring-white/10 backdrop-blur-xl">
                <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <span className="ml-2 font-mono text-[11px] text-slate-500">mise · {FEATURES[active].key}</span>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] font-medium text-brand-200">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> Live
                  </span>
                </div>
                <div className="min-h-[360px] p-6">
                  {/* remount per feature → entrance animation + fresh live cycle */}
                  <div key={FEATURES[active].key} className="mise-card-slide">
                    <Active />
                  </div>
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
