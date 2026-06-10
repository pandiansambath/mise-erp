"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";

const COUNTRIES = [
  { code: "GB", label: "United Kingdom (£ GBP)" },
  { code: "IN", label: "India (₹ INR)" },
  { code: "US", label: "United States ($ USD)" },
  { code: "AE", label: "UAE (AED)" },
  { code: "EU", label: "Eurozone (€ EUR)" },
];

const PROMISES = [
  "Recipes costed to the gram, margins live",
  "Stock, purchasing and payroll in one place",
  "A real-time P&L from day one",
];

export default function SignupPage() {
  // Paint the document dark while mounted (kills white overscroll flash).
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.background;
    const prevBody = body.style.background;
    root.style.background = "#030d09";
    body.style.background = "#030d09";
    return () => {
      root.style.background = prevRoot;
      body.style.background = prevBody;
    };
  }, []);

  const { registerHotel } = useAuth();
  const [hotelName, setHotelName] = useState("");
  const [country, setCountry] = useState("GB");
  const [city, setCity] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await registerHotel({ hotel_name: hotelName, country, city: city || undefined, email, password });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register. Is the server running?");
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "mt-1.5 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 outline-none transition focus:border-brand-400/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-brand-500/20";
  const labelCls = "block text-sm font-medium text-slate-300";

  return (
    <div className="mise-dark-page relative min-h-screen overflow-hidden bg-ink-950 text-slate-100">
      {/* aurora backdrop — same colour-gliding treatment as the landing */}
      <div className="mise-aurora mise-aurora-shift">
        <span style={{ left: "-10%", top: "-15%", width: 560, height: 560, background: "radial-gradient(circle, #10b981, transparent 68%)" }} />
        <span style={{ right: "-12%", bottom: "-20%", width: 520, height: 520, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "8s" }} />
      </div>
      <div className="mise-dots pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/30 to-ink-950" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-5 py-12 lg:grid-cols-[1fr_minmax(0,440px)] lg:gap-20">
        {/* LEFT — the pitch (hidden on small screens) */}
        <div className="hidden lg:block">
          <Reveal>
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Logo size={36} />
              <span className="text-xl font-semibold tracking-tight">Mise</span>
            </Link>
          </Reveal>
          <Reveal delay={90}>
            <h1 className="mt-10 font-display text-5xl leading-[1.05] text-white">
              Your restaurant,
              <span className="mise-profit-text block italic">in its place.</span>
            </h1>
          </Reveal>
          <Reveal delay={170}>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-slate-300">
              Register your hotel and you&apos;ll be the Super Admin — invite the brigade when
              you&apos;re ready.
            </p>
          </Reveal>
          <Reveal delay={250}>
            <ul className="mt-8 space-y-3.5">
              {PROMISES.map((p) => (
                <li key={p} className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-brand-400/40 bg-brand-500/15 text-xs text-brand-300">✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={330}>
            <p className="mt-10 max-w-sm border-l border-white/10 pl-5 font-display text-lg italic leading-snug text-slate-400">
              “Great kitchens don&apos;t hope the numbers work. They prep them like everything else.”
            </p>
          </Reveal>
        </div>

        {/* RIGHT — the form */}
        <Reveal delay={120} className="w-full">
          <div className="mx-auto w-full max-w-md">
            {/* compact header on small screens */}
            <div className="mb-8 flex flex-col items-center text-center lg:hidden">
              <Link href="/"><Logo size={52} /></Link>
              <h1 className="mt-4 font-display text-3xl text-white">Register your hotel</h1>
              <p className="mt-1.5 text-sm text-slate-400">
                Set up your restaurant on Mise — you&apos;ll be the Super Admin.
              </p>
            </div>

            <form
              onSubmit={onSubmit}
              className="space-y-4 rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-7 shadow-2xl shadow-black/40 backdrop-blur-xl"
            >
              <div className="hidden lg:block">
                <h2 className="font-display text-2xl text-white">Register your hotel</h2>
                <p className="mt-1 text-sm text-slate-400">Free to start. No card required.</p>
              </div>

              <div>
                <label htmlFor="hotel" className={labelCls}>Restaurant name</label>
                <input id="hotel" value={hotelName} onChange={(e) => setHotelName(e.target.value)} required placeholder="e.g. NIRAI" className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="country" className={labelCls}>Country</label>
                  <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className={`${inputCls} [&>option]:bg-ink-900`}>
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="city" className={labelCls}>City (optional)</label>
                  <input id="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
                </div>
              </div>
              <div>
                <label htmlFor="email" className={labelCls}>Your email</label>
                <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="owner@restaurant.com" className={inputCls} />
              </div>
              <div>
                <label htmlFor="password" className={labelCls}>Password</label>
                <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} placeholder="min 8 characters" className={inputCls} />
              </div>

              {error && (
                <p role="alert" className="rounded-xl border border-rose-400/30 bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-200">{error}</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="mise-btn-shine w-full rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-4 py-3 text-sm font-semibold text-ink-950 shadow-xl shadow-brand-500/25 transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
              >
                {busy ? "Creating your restaurant…" : "Create my restaurant"}
              </button>

              <p className="text-center text-sm text-slate-400">
                Already have an account?{" "}
                <Link href="/login" className="font-medium text-brand-300 transition hover:text-brand-200">Sign in</Link>
              </p>
            </form>
          </div>
        </Reveal>
      </div>
    </div>
  );
}
