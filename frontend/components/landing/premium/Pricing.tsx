"use client";

// Pricing. The monthly figures come live from the Control Room's public
// /api/platform/plans endpoint (operator-editable), falling back to the
// defaults below. Yearly = 10× monthly — two months free, computed only when
// the operator's price hint parses as "£N/mo".

import Link from "next/link";
import { useEffect, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { API_BASE } from "@/lib/api";
import { Magnetic, SectionHead } from "./bits";

const PLANS = [
  {
    key: "starter",
    name: "Starter",
    blurb: "Money + stock basics for a small kitchen.",
    fallback: "£29/mo",
    featured: false,
    cta: "Start free",
    features: [
      "Inventory, recipes & live per-gram costing",
      "Vendors & purchasing — consolidated POs",
      "Sales, expenses & a real-time P&L",
      "Up to 3 users",
      "Email support",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    blurb: "The full operating system for a busy hotel.",
    fallback: "£79/mo",
    featured: true,
    cta: "Start free",
    features: [
      "Everything in Starter",
      "AI Copilot + bill & handwritten-recipe scanning",
      "Payroll, rota & attendance",
      "Documents, food safety & price comparison",
      "Up to 15 users",
      "Priority support",
    ],
  },
  {
    key: "enterprise",
    name: "Enterprise",
    blurb: "For groups & chains that need it all.",
    fallback: "Let's talk",
    featured: false,
    cta: "Contact sales",
    features: [
      "Everything in Pro",
      "Unlimited users",
      "Priority support + guided onboarding",
      "Early access to new modules",
      "Custom terms & invoicing",
    ],
  },
];

/** "£29/mo" → 29; anything else → null (shown verbatim, toggle-proof). */
function parseMonthly(hint: string): number | null {
  const m = hint.match(/^£\s*(\d+(?:\.\d+)?)\s*\/mo$/i);
  return m ? Number(m[1]) : null;
}

export default function Pricing() {
  const [yearly, setYearly] = useState(false);
  const [hints, setHints] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch(`${API_BASE}/api/platform/plans`)
      .then((r) => r.json())
      .then((d) => {
        const m: Record<string, string> = {};
        for (const p of d.plans ?? []) m[p.key] = p.price_hint;
        setHints(m);
      })
      .catch(() => {});
  }, []);

  return (
    <section id="pricing" className="mise-cv relative overflow-hidden border-t border-white/5">
      {/* dawn sky, barely there */}
      <img
        src="/experience/sky.jpg"
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover opacity-[0.14]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950 via-ink-950/85 to-ink-950" />

      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
        <Reveal>
          <SectionHead
            kicker="PRICING"
            title={
              <>
                Start small. <em className="mise-hero-text not-italic">Grow into it.</em>
              </>
            }
            sub="One price per property, every user included up to your plan's limit. If Mise catches one mispriced dish a day, it has already paid for itself."
          />
        </Reveal>

        {/* monthly / yearly */}
        <Reveal delay={100}>
          <div className="mt-10 flex items-center justify-center gap-3">
            <span className={`text-sm ${yearly ? "text-slate-500" : "font-medium text-white"}`}>Monthly</span>
            <button
              type="button"
              role="switch"
              aria-checked={yearly}
              aria-label="Bill yearly"
              onClick={() => setYearly((v) => !v)}
              className={`relative h-7 w-13 rounded-full border transition-colors duration-300 ${
                yearly ? "border-brand-400/50 bg-brand-500/30" : "border-white/15 bg-white/10"
              }`}
            >
              <span
                className="absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow transition-all duration-300"
                style={{ left: yearly ? "calc(100% - 24px)" : "2px" }}
              />
            </button>
            <span className={`text-sm ${yearly ? "font-medium text-white" : "text-slate-500"}`}>
              Yearly <span className="ml-1 rounded-full bg-copper-500/15 px-2 py-0.5 text-[11px] font-medium text-copper-200">2 months free</span>
            </span>
          </div>
        </Reveal>

        <div className="mt-12 grid items-stretch gap-5 lg:grid-cols-3">
          {PLANS.map((t, i) => {
            const hint = hints[t.key] ?? t.fallback;
            const monthly = parseMonthly(hint);
            const price =
              monthly === null ? hint : yearly ? `£${Math.round(monthly * 10).toLocaleString("en-GB")}` : `£${monthly}`;
            const per = monthly === null ? "" : yearly ? "/yr" : "/mo";
            return (
              <Reveal key={t.key} delay={i * 100}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-7 backdrop-blur transition duration-300 ${
                    t.featured
                      ? "border-brand-400/50 bg-gradient-to-b from-brand-500/[0.14] to-transparent shadow-2xl shadow-brand-900/40"
                      : "border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent hover:-translate-y-1 hover:border-white/20"
                  }`}
                >
                  {t.featured && (
                    <span className="absolute -top-3 left-7 rounded-full bg-gradient-to-r from-brand-500 to-brand-400 px-3 py-1 text-[11px] font-semibold text-ink-950 shadow-lg shadow-brand-500/30">
                      Most popular
                    </span>
                  )}
                  <h3 className="text-lg font-semibold text-white">{t.name}</h3>
                  <p className="mt-1 text-sm text-slate-400">{t.blurb}</p>
                  <p className="mt-5 flex items-baseline gap-1.5">
                    <span className="font-display text-4xl text-white">{price}</span>
                    {per && <span className="text-sm text-slate-400">{per}</span>}
                  </p>
                  {monthly !== null && yearly ? (
                    <p className="mt-1 text-[11px] text-copper-200/90">≈ £{Math.round((monthly * 10) / 12)}/mo, billed annually</p>
                  ) : (
                    <p className="mt-1 text-[11px] text-transparent select-none">·</p>
                  )}
                  <ul className="mt-5 space-y-2.5 text-sm text-slate-300">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5">
                        <span className="mt-0.5 shrink-0 text-brand-400">✓</span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-auto pt-7">
                    <Magnetic strength={0.15}>
                      <Link
                        href="/signup"
                        className={`block rounded-xl px-6 py-3 text-center text-sm font-semibold transition ${
                          t.featured
                            ? "mise-btn-shine bg-gradient-to-r from-brand-500 to-brand-400 text-ink-950 shadow-lg shadow-brand-500/25 hover:shadow-xl"
                            : "border border-white/15 text-white hover:bg-white/5"
                        }`}
                      >
                        {t.cta}
                      </Link>
                    </Magnetic>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal delay={150}>
          <p className="mt-8 text-center text-xs text-slate-500">
            Prices in GBP, per property, excl. VAT · no card to start · upgrade or cancel anytime
          </p>
        </Reveal>
      </div>
    </section>
  );
}
