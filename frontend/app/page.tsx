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
        <div className="mise-hero-gradient absolute inset-0 opacity-25" />
        <div className="pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full bg-brand-500/30 blur-3xl mise-blob" />
        <div className="pointer-events-none absolute -right-20 top-40 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl mise-blob" style={{ animationDelay: "4s" }} />
        <div className="relative mx-auto max-w-6xl px-5 pb-24 pt-20 sm:pt-28">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-brand-100">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" /> Restaurant ERP &amp; intelligence
            </span>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="mt-6 max-w-3xl text-4xl font-bold leading-[1.05] tracking-tight sm:text-6xl">
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

          {/* floating module chips */}
          <Reveal delay={320}>
            <div className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["Recipes & margins", "Live inventory", "Sales & cash", "Payroll"].map((t, i) => (
                <div
                  key={t}
                  className="mise-float rounded-2xl border border-white/10 bg-white/5 p-4 text-sm font-medium text-slate-200 backdrop-blur"
                  style={{ animationDelay: `${i * 0.8}s` }}
                >
                  {t}
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
      <section className="px-5 pb-24">
        <Reveal>
          <div className="mise-hero-gradient mx-auto max-w-5xl overflow-hidden rounded-3xl p-px">
            <div className="rounded-3xl bg-slate-950/80 px-8 py-14 text-center backdrop-blur">
              <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Bring order to your kitchen.</h2>
              <p className="mx-auto mt-3 max-w-xl text-slate-300">
                Set up your restaurant in minutes. No card required.
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
