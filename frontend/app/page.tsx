"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

const MODULES = [
  { icon: "🪑", title: "Reservations & guests", desc: "Front-of-house flow, covers, and guest history — the night, planned." },
  { icon: "👨‍🍳", title: "Chefs & recipes", desc: "Cost every dish to the gram. Margins update live as prices move." },
  { icon: "📦", title: "Inventory", desc: "Real-time stock with weighted-average cost and low-stock alerts." },
  { icon: "🛒", title: "Purchasing", desc: "Kitchen indents → cheapest-vendor purchase orders → received into stock." },
  { icon: "🧾", title: "Sales & cash", desc: "Takings by channel, delivery commissions, and a balanced till." },
  { icon: "🧑‍🤝‍🧑", title: "Staff & payroll", desc: "Attendance, breaks, UK-compliant payslips, self-service for staff." },
  { icon: "🧹", title: "Housekeeping & ops", desc: "Tasks, documents, and expiry alerts — nothing falls through." },
  { icon: "📈", title: "Reports & P&L", desc: "Gross to net profit, food-cost %, and where the money really goes." },
];

const STEPS = [
  { n: "01", title: "Stock comes in", desc: "Log purchases; costs blend automatically into a weighted average." },
  { n: "02", title: "Every dish is costed", desc: "Recipes pull live vendor prices — see cost per plate and margin." },
  { n: "03", title: "You sell", desc: "Record takings by channel; commissions and cash are reconciled." },
  { n: "04", title: "Profit, in the open", desc: "A live P&L shows exactly what you kept — and what to fix." },
];

const ECO = [
  { icon: "🪑", label: "Reservations" },
  { icon: "👨‍🍳", label: "Chefs" },
  { icon: "📦", label: "Inventory" },
  { icon: "🛒", label: "Purchasing" },
  { icon: "🧾", label: "Sales" },
  { icon: "🧑‍🤝‍🧑", label: "Staff" },
  { icon: "🧹", label: "Housekeeping" },
  { icon: "📈", label: "Reports" },
];

const CHIPS = [
  { icon: "🍲", title: "Recipes & margins", sub: "cost per plate, live" },
  { icon: "📦", title: "Live inventory", sub: "weighted-avg cost" },
  { icon: "🧾", title: "Sales & cash", sub: "till reconciled" },
  { icon: "💷", title: "Payroll", sub: "UK-compliant payslips" },
];

const STATS = [
  { value: "₹ / £ / $", label: "Multi-currency, multi-restaurant" },
  { value: "Per-gram", label: "Dish costing accuracy" },
  { value: "Live", label: "Operations, across every login" },
  { value: "1 platform", label: "The whole brigade, orchestrated" },
];

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  if (loading || user) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/70 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">Mise</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-300 hover:text-white">
              Sign in
            </Link>
            <Link
              href="/signup"
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-lg shadow-brand-500/20 transition hover:bg-brand-100"
            >
              Register your hotel
            </Link>
          </div>
        </nav>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* animated aurora waves on a near-black base */}
        <div className="mise-aurora">
          <span style={{ left: "-6%", top: "-12%", width: 560, height: 560, background: "radial-gradient(circle, #10b981, transparent 68%)" }} />
          <span style={{ right: "-8%", top: "6%", width: 520, height: 520, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "6s" }} />
          <span style={{ left: "28%", bottom: "-22%", width: 620, height: 620, background: "radial-gradient(circle, #14b8a6, transparent 72%)", animationDelay: "11s" }} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-slate-950/40 to-slate-950" />
        <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pt-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            {/* LEFT — message */}
            <div>
              <Reveal>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-100">
                  <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Restaurant ERP &amp; intelligence
                </span>
              </Reveal>
              <Reveal delay={80}>
                <h1 className="mt-6 text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
                  Run your restaurant like a <span className="mise-hero-text">symphony</span>.
                </h1>
              </Reveal>
              <Reveal delay={160}>
                <p className="mt-5 max-w-xl text-lg text-slate-300">
                  Guests, chefs, inventory, purchasing, sales, staff and payroll — every moving
                  part of your kitchen, beautifully orchestrated in one platform. And at the
                  centre of it all: <span className="font-semibold text-white">your money</span>.
                </p>
              </Reveal>
              <Reveal delay={240}>
                <div className="mt-8 flex flex-wrap gap-3">
                  <Link href="/signup" className="rounded-xl bg-brand-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-xl shadow-brand-500/25 transition hover:-translate-y-0.5 hover:bg-brand-100">
                    Start free — register your hotel
                  </Link>
                  <Link href="/login" className="rounded-xl border border-white/15 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/5">
                    Sign in
                  </Link>
                </div>
              </Reveal>
            </div>

            {/* RIGHT — 3D app preview (tilts upright as you scroll in) */}
            <Reveal delay={200} className="mise-3d-stage hidden sm:block">
              <div className="mise-3d relative">
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-800/90 to-slate-900/95 shadow-2xl shadow-emerald-950/50 ring-1 ring-white/5 backdrop-blur-xl">
                  {/* window chrome */}
                  <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-3">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                    <span className="ml-2 text-[11px] text-slate-500">mise · dashboard</span>
                  </div>

                  <div className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Logo size={22} />
                        <span className="text-sm font-semibold text-white">NIRAI</span>
                      </div>
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-200">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> Live
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2.5">
                      {[
                        { l: "Net sales", v: "£1,840", t: "↑ 12%", c: "text-white" },
                        { l: "Net profit", v: "£612", t: "↑ 8%", c: "text-brand-300" },
                        { l: "Food cost", v: "29%", t: "target 25-35", c: "text-amber-300" },
                      ].map((k) => (
                        <div key={k.l} className="rounded-xl border border-white/5 bg-white/[0.04] p-3">
                          <p className="text-[10px] uppercase tracking-wide text-slate-400">{k.l}</p>
                          <p className={`mt-1 text-lg font-bold ${k.c}`}>{k.v}</p>
                          <p className="text-[10px] text-brand-300/80">{k.t}</p>
                        </div>
                      ))}
                    </div>

                    {/* sparkline */}
                    <div className="mt-4 flex items-end gap-1.5">
                      {[38, 52, 44, 66, 58, 74, 90].map((h, i) => (
                        <div
                          key={i}
                          className="mise-hero-gradient flex-1 rounded-t"
                          style={{ height: `${h * 0.5}px`, opacity: 0.55 + i * 0.06 }}
                        />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-500">Net sales · last 7 days</p>

                    <div className="mt-4 space-y-1.5">
                      {[
                        { n: "Butter Chicken", m: 89 },
                        { n: "Chicken Biryani", m: 91 },
                        { n: "Masala Dosa", m: 82 },
                      ].map((d) => (
                        <div key={d.n} className="flex items-center gap-3 text-sm">
                          <span className="w-28 shrink-0 text-slate-300">{d.n}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                            <span className="block h-full rounded-full bg-brand-400" style={{ width: `${d.m}%` }} />
                          </span>
                          <span className="w-9 text-right text-xs font-semibold text-brand-300">{d.m}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* notification toasts — anchored cleanly at the card edges */}
                <div className="absolute -right-3 -top-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-slate-900/95 px-3 py-2 text-xs shadow-2xl shadow-black/40">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-500/20 text-amber-300">⚠</span>
                  <span className="font-medium text-amber-100">Paneer low — reorder</span>
                </div>
                <div className="absolute -bottom-4 -left-3 flex items-center gap-2 rounded-xl border border-brand-400/30 bg-slate-900/95 px-3 py-2 text-xs shadow-2xl shadow-black/40">
                  <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-500/20 text-brand-300">✓</span>
                  <div>
                    <p className="font-medium text-white">PO approved</p>
                    <p className="text-slate-400">Rudra Foods · £43.60</p>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

          {/* what's inside — module cards */}
          <Reveal delay={320}>
            <div className="mt-20 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {CHIPS.map((c, i) => (
                <div
                  key={c.title}
                  className="mise-float group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.12] to-white/[0.02] p-4 shadow-xl shadow-black/20 backdrop-blur transition hover:-translate-y-1 hover:border-brand-400/50"
                  style={{ animationDelay: `${i * 0.8}s` }}
                >
                  <div className="absolute -right-6 -top-6 h-16 w-16 rounded-full bg-brand-500/20 blur-2xl transition group-hover:bg-brand-400/40" />
                  <div className="relative">
                    <span className="text-2xl">{c.icon}</span>
                    <p className="mt-2 text-sm font-semibold text-white">{c.title}</p>
                    <p className="text-xs text-brand-200/80">{c.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-5 py-12 sm:grid-cols-4">
          {STATS.map((s, i) => (
            <Reveal key={s.label} delay={i * 80}>
              <p className="text-2xl font-bold text-brand-300">{s.value}</p>
              <p className="mt-1 text-sm text-slate-400">{s.label}</p>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Ecosystem ── */}
      <section className="mx-auto max-w-6xl px-5 py-24">
        <Reveal>
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
            One platform. The whole brigade.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-center text-slate-400">
            From the host stand to the head chef to the back office — every role works in the
            same system, on the same live numbers.
          </p>
        </Reveal>
        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m, i) => (
            <Reveal key={m.title} delay={(i % 4) * 80}>
              <div className="group h-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-6 transition hover:-translate-y-1 hover:border-brand-400/40">
                <div className="text-3xl">{m.icon}</div>
                <h3 className="mt-4 font-semibold text-white">{m.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{m.desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Orchestration carousel (centered, rotating 3D) ── */}
      <section className="relative overflow-hidden border-y border-white/5 bg-slate-950 py-28">
        <div className="mise-aurora">
          <span style={{ left: "20%", top: "0%", width: 520, height: 520, background: "radial-gradient(circle, #10b981, transparent 70%)" }} />
          <span style={{ right: "15%", bottom: "-10%", width: 480, height: 480, background: "radial-gradient(circle, #0ea5e9, transparent 72%)", animationDelay: "7s" }} />
        </div>
        <div className="relative mx-auto max-w-3xl px-5 text-center">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Everything, in concert.</h2>
            <p className="mx-auto mt-4 max-w-xl text-slate-400">
              One system conducting every station — spinning quietly in the background so you
              don&apos;t have to.
            </p>
          </Reveal>
        </div>
        {/* rotating 3D ring of module icons */}
        <div className="mise-carousel-stage relative mx-auto mt-16 h-[260px]">
          <div className="absolute left-1/2 top-1/2 h-44 w-44 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/20 blur-3xl" />
          <div className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-2xl border border-white/10 bg-slate-900/80 shadow-2xl">
            <Logo size={34} />
          </div>
          <div className="mise-carousel absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2">
            {ECO.map((e, i) => (
              <div
                key={e.label}
                className="mise-carousel-face grid place-items-center"
                style={{ transform: `rotateY(${i * 45}deg) translateZ(220px)` }}
              >
                <div className="grid h-20 w-20 place-items-center rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.12] to-white/[0.02] text-3xl shadow-xl backdrop-blur" title={e.label}>
                  {e.icon}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="border-y border-white/5 bg-gradient-to-b from-emerald-950/30 to-transparent">
        <div className="mx-auto max-w-6xl px-5 py-24">
          <Reveal>
            <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">The money loop, closed.</h2>
            <p className="mt-4 max-w-2xl text-slate-400">
              Mise connects the chain that decides whether a restaurant makes money — so a
              vendor raising chicken £1/kg instantly shows up in your dish margins and P&amp;L.
            </p>
          </Reveal>
          <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 90}>
                <div className="relative h-full rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                  <span className="text-sm font-bold text-brand-400">{s.n}</span>
                  <h3 className="mt-2 font-semibold text-white">{s.title}</h3>
                  <p className="mt-2 text-sm text-slate-400">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Slogan band ── */}
      <section className="mx-auto max-w-4xl px-5 py-24 text-center">
        <Reveal>
          <p className="text-2xl font-medium leading-snug text-slate-200 sm:text-3xl">
            “Mise en place” — everything in its place. We took the chef&apos;s discipline and
            built it into <span className="mise-hero-text">software for the whole business.</span>
          </p>
        </Reveal>
      </section>

      {/* ── Final CTA ── */}
      <section className="px-5 py-24">
        <Reveal>
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-emerald-900/50 via-slate-900 to-sky-900/40 px-8 py-16 text-center shadow-2xl shadow-emerald-950/40">
            <div className="mise-aurora">
              <span style={{ left: "10%", top: "-30%", width: 420, height: 420, background: "radial-gradient(circle, #10b981, transparent 70%)" }} />
              <span style={{ right: "8%", bottom: "-30%", width: 380, height: 380, background: "radial-gradient(circle, #0ea5e9, transparent 72%)", animationDelay: "5s" }} />
            </div>
            <div className="relative">
              <Logo size={44} className="mx-auto" />
              <h2 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">Bring order to your kitchen.</h2>
              <p className="mx-auto mt-3 max-w-xl text-slate-300">
                Set up your restaurant in minutes — costs, recipes, staff and profit, all in one
                place. No card required.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/signup" className="rounded-xl bg-brand-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-xl shadow-brand-500/25 transition hover:-translate-y-0.5 hover:bg-brand-100">
                  Register your hotel
                </Link>
                <Link href="/login" className="rounded-xl border border-white/15 px-6 py-3 text-base font-semibold text-white transition hover:bg-white/5">
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-10 text-sm text-slate-500 sm:flex-row">
          <div className="flex items-center gap-2">
            <Logo size={24} />
            <span className="font-medium text-slate-300">Mise</span>
            <span>— restaurant intelligence</span>
          </div>
          <p>© {new Date().getFullYear()} Mise. Every plate, every penny.</p>
        </div>
      </footer>
    </div>
  );
}
