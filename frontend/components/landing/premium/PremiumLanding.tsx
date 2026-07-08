"use client";

// The Mise landing experience — composition root.
//
//   cinema hero (dish → live dashboard) → trust strip → three-beat story →
//   product tour → Copilot → reports → pricing → operators → dawn CTA
//
// Design rules: native scroll only (never hijacked), IntersectionObserver for
// every reveal, transform/opacity for every animation, cinematic AI film used
// as *moments* (one-shot morphs that settle into stills) — not a scrub reel.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Brand } from "@/components/Brand";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import AiShowcase from "./AiShowcase";
import Arrival from "./Arrival";
import { Counter, Magnetic, useDarkDocument } from "./bits";
import FeatureTour from "./FeatureTour";
import FinalCta from "./FinalCta";
import Hero from "./Hero";
import Pricing from "./Pricing";
import Reports from "./Reports";
import Story from "./Story";
import Testimonials from "./Testimonials";

/* ─────────────────────────── chrome ─────────────────────────── */

function ScrollProgress() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      if (ref.current) ref.current.style.transform = `scaleX(${p})`;
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-gradient-to-r from-brand-400 via-brand-300 to-copper-300"
      style={{ transform: "scaleX(0)" }}
    />
  );
}

/** A soft emerald spotlight that follows the cursor (fine pointers only).
    A fixed-size layer moved with translate3d — compositor-only, no repaints. */
function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setOn(true);
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (ref.current) {
          ref.current.style.transform = `translate3d(${e.clientX - 280}px, ${e.clientY - 280}px, 0)`;
        }
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);
  if (!on) return null;
  return (
    <div
      ref={ref}
      className="pointer-events-none fixed left-0 top-0 z-[5] h-[560px] w-[560px] rounded-full will-change-transform"
      style={{
        background: "radial-gradient(circle, rgba(16,185,129,0.055), transparent 65%)",
        transform: "translate3d(-600px, -600px, 0)",
      }}
      aria-hidden
    />
  );
}

/** Quietly pre-warms every journey still + film into the HTTP cache after the
    veil lifts, one at a time, so nothing pops in when the visitor scrolls. */
function usePreWarm(ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    type NetInfo = { saveData?: boolean };
    const conn = (navigator as Navigator & { connection?: NetInfo }).connection;
    if (conn?.saveData) return;
    let cancelled = false;
    const stills = ["sky", "forest", "source", "garden", "fire", "gold", "table", "restaurant", "dawn", "mountains"];
    const films = [
      "sky-to-mountains", "mountains-to-forest", "forest-to-source", "source-to-garden",
      "garden-to-fire", "table-to-gold", "dish-to-restaurant", "restaurant-to-table", "gold-to-dawn",
    ];
    const t = window.setTimeout(async () => {
      for (const s of stills) {
        if (cancelled) return;
        const im = new Image();
        im.src = `/experience/${s}.jpg`;
      }
      for (const f of films) {
        if (cancelled) return;
        try {
          await fetch(`/experience/film/${f}.mp4`, { cache: "force-cache" });
        } catch {
          /* offline / aborted — the scene still shows its still */
        }
      }
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [ready]);
}

function Nav() {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const onScroll = () => setSolid(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        solid ? "border-b border-white/5 bg-ink-950/95 sm:bg-ink-950/75 sm:backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-6">
        <Link href="/" aria-label="Mise home">
          <Brand size={28} wordClassName="text-lg text-white" />
        </Link>
        <div className="hidden items-center gap-7 text-sm text-slate-400 md:flex">
          <a href="#story" className="transition hover:text-white">How it works</a>
          <a href="#product" className="transition hover:text-white">Product</a>
          <a href="#copilot" className="transition hover:text-white">Copilot</a>
          <a href="#pricing" className="transition hover:text-white">Pricing</a>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <Link
            href="/login"
            className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-slate-300 transition hover:text-white sm:px-3"
          >
            Sign in
          </Link>
          <Magnetic strength={0.25}>
            <Link
              href="/signup"
              className="mise-btn-shine inline-block whitespace-nowrap rounded-lg bg-gradient-to-r from-brand-500 to-brand-400 px-3.5 py-2 text-[13px] font-semibold text-ink-950 shadow-lg shadow-brand-500/20 sm:px-4 sm:text-sm"
            >
              Register your hotel
            </Link>
          </Magnetic>
        </div>
      </nav>
    </header>
  );
}

/* ─────────────────────── trust strip ─────────────────────── */

const STATS = [
  { value: 11, suffix: "", label: "departments, one login" },
  { value: 0, custom: "Per-gram", label: "recipe costing accuracy" },
  { value: 0, custom: "£ / ₹ / $", label: "multi-currency, multi-property" },
  { value: 99.9, custom: "99.9%", label: "uptime target, cloud-hosted" },
];

function TrustStrip() {
  return (
    <section className="border-y border-white/5 bg-white/[0.02]">
      <div className="mx-auto grid max-w-6xl grid-cols-2 gap-8 px-6 py-12 sm:px-10 lg:grid-cols-4">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 80}>
            <div className="text-center">
              <p className="font-display text-3xl text-white sm:text-4xl">
                {s.custom ?? <Counter value={s.value} suffix={s.suffix} />}
              </p>
              <p className="mt-1.5 text-[12px] text-slate-500 sm:text-sm">{s.label}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────── footer ───────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-white/5 bg-ink-950">
      <div className="mx-auto max-w-6xl px-6 py-14 sm:px-10">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <Brand size={30} wordClassName="text-xl text-white" />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-500">
              The operating system for hotels &amp; restaurants. Every plate, every penny, in its
              place.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-14 gap-y-2 text-sm">
            <a href="#story" className="text-slate-400 transition hover:text-white">How it works</a>
            <Link href="/login" className="text-slate-400 transition hover:text-white">Sign in</Link>
            <a href="#product" className="text-slate-400 transition hover:text-white">Product</a>
            <Link href="/signup" className="text-slate-400 transition hover:text-white">Register your hotel</Link>
            <a href="#copilot" className="text-slate-400 transition hover:text-white">Copilot</a>
            <a href="#pricing" className="text-slate-400 transition hover:text-white">Pricing</a>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-white/5 pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-600">© {new Date().getFullYear()} Mise · made for independent operators</p>
          <p className="font-mono text-[11px] tracking-[0.25em] text-slate-600">EVERY PLATE · EVERY PENNY</p>
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────── page ───────────────────────── */

export default function PremiumLanding() {
  useDarkDocument();

  // A brief veil so the hero image never pops in half-loaded. Lifts on load
  // or after 1.6s, whichever comes first.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const img = new Image();
    img.src = "/experience/dish.jpg";
    const done = () => setReady(true);
    if (img.complete) done();
    else {
      img.onload = done;
      img.onerror = done;
    }
    const t = window.setTimeout(done, 1600);
    return () => window.clearTimeout(t);
  }, []);
  usePreWarm(ready);

  return (
    <div className="mise-dark-page min-h-screen bg-ink-950 text-slate-100">
      <div
        className="fixed inset-0 z-[70] grid place-items-center bg-ink-950 transition-opacity duration-700"
        style={{ opacity: ready ? 0 : 1, visibility: ready ? "hidden" : "visible" }}
        aria-hidden
      >
        <div className="flex flex-col items-center">
          <Logo size={48} className="mise-pop-lg" />
          <p className="mt-4 font-display text-3xl text-white">Mise</p>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.3em] text-copper-300/80">
            Every plate · Every penny
          </p>
        </div>
      </div>

      <ScrollProgress />
      <CursorGlow />
      <Nav />

      <main>
        <Hero start={ready} />
        <TrustStrip />
        <Story />
        <FeatureTour />
        <AiShowcase />
        <Reports />
        <Arrival />
        <Pricing />
        <Testimonials />
        <FinalCta />
      </main>

      <Footer />
    </div>
  );
}
