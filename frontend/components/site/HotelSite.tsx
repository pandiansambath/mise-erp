"use client";

// The hotel's public front door, served at <handle>.dineai.cloud.
//
// One component, two homes: the real subdomain page (/s/[handle]) and the LIVE
// PREVIEW inside Settings — so what an owner tweaks is exactly what a guest sees.
// Motion follows the premium-landing rules: native scroll only, IntersectionObserver
// reveals, transform/opacity writes inside one rAF (no per-frame React renders),
// and everything switches off for prefers-reduced-motion / save-data / preview.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { API_BASE, type HotelLanding, type LandingConfig } from "@/lib/api";

/** Hero photo styles an owner can pick between (files in /public/site). */
export const HERO_STYLES = [
  { key: "warm", label: "Warm & cosy" },
  { key: "fine", label: "Fine dining" },
  { key: "rustic", label: "Rustic" },
  { key: "spice", label: "Spice" },
  { key: "cafe", label: "Bright café" },
  { key: "night", label: "After dark" },
] as const;

export const LANDING_THEMES = [
  { key: "dark", label: "Midnight" },
  { key: "light", label: "Daylight" },
  { key: "warm", label: "Parchment" },
] as const;

/** Mirrors LANDING_DEFAULTS in backend/app/api/site.py — keep the two in step. */
export const DEFAULT_LANDING: Required<LandingConfig> = {
  hero: "warm",
  tagline: "",
  about_title: "Our story",
  about: "",
  quote: "",
  quote_by: "",
  cta_label: "Order online",
  address: "",
  phone: "",
  hours: "",
  accent: "#059669",
  theme: "dark",
  show_order: false,
  show_gallery: true,
};

type Skin = {
  bg: string; panel: string; fg: string; sub: string; line: string; scrim: number;
};
const THEMES: Record<string, Skin> = {
  dark:  { bg: "#080c0b", panel: "rgba(255,255,255,.05)", fg: "#f2f6f5", sub: "#9fb0aa", line: "rgba(255,255,255,.10)", scrim: 0.66 },
  light: { bg: "#faf9f7", panel: "rgba(15,26,23,.04)",    fg: "#101a17", sub: "#5c6b66", line: "rgba(15,26,23,.10)",   scrim: 0.52 },
  warm:  { bg: "#f7f1e6", panel: "rgba(80,58,28,.05)",    fg: "#2a2117", sub: "#7b6a53", line: "rgba(80,58,28,.14)",   scrim: 0.55 },
};

const GALLERY = [
  "biryani", "butter-chicken", "dosa", "tandoori", "paneer", "dessert",
] as const;

function monogram(name: string): string {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "M";
}

/** Fade-and-rise when the element scrolls into view (once). */
function Reveal({
  children, delay = 0, still = false, className = "",
}: { children: React.ReactNode; delay?: number; still?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(still);
  useEffect(() => {
    if (still) return;
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(true); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect(); } },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [still]);
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? "none" : "translateY(22px)",
        transition: `opacity .75s cubic-bezier(.22,.7,.3,1) ${delay}ms, transform .75s cubic-bezier(.22,.7,.3,1) ${delay}ms`,
        willChange: shown ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

export default function HotelSite({
  data, config, preview = false,
}: {
  data: HotelLanding;
  /** Live (possibly unsaved) overrides — Settings passes its working copy. */
  config?: LandingConfig;
  preview?: boolean;
}) {
  const L = { ...DEFAULT_LANDING, ...(data.landing ?? {}), ...(config ?? {}) };
  const t = THEMES[L.theme] ?? THEMES.dark;
  const accent = /^#[0-9a-f]{6}$/i.test(L.accent || "") ? L.accent : "#059669";
  const heroKey = HERO_STYLES.some((h) => h.key === L.hero) ? L.hero : "warm";
  const hero = `/site/hero-${heroKey}.jpg`;
  const tagline = L.tagline || (data.city ? `A kitchen in ${data.city}` : "Every plate, every penny.");

  // ── hero parallax + scrim deepen: one rAF, direct style writes ──
  const imgRef = useRef<HTMLDivElement>(null);
  const veilRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (preview) return;
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      nav.connection?.saveData
    ) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const p = Math.min(1, y / Math.max(window.innerHeight, 1));
        if (imgRef.current) imgRef.current.style.transform = `translate3d(0,${y * 0.28}px,0) scale(${1.06 + p * 0.06})`;
        if (veilRef.current) veilRef.current.style.opacity = String(Math.min(1, 0.25 + p * 0.75));
        if (copyRef.current) {
          copyRef.current.style.transform = `translate3d(0,${y * 0.12}px,0)`;
          copyRef.current.style.opacity = String(Math.max(0, 1 - p * 1.25));
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (raf) cancelAnimationFrame(raf); };
  }, [preview]);

  const words = data.name.split(/\s+/);
  // Preview lives inside a Settings card, so the hero gets a fixed box there.
  const heroH = preview ? "340px" : "100svh";

  return (
    <div style={{ background: t.bg, color: t.fg }} className="relative w-full overflow-x-hidden">
      {/* ── HERO ───────────────────────────────────────────────────────── */}
      <section className="relative isolate flex items-center justify-center overflow-hidden"
               style={{ minHeight: heroH }}>
        {/* photo (slow settle drift) */}
        <div ref={imgRef} aria-hidden className="absolute inset-0 -z-20"
             style={{
               backgroundImage: `url(${hero})`,
               backgroundSize: "cover",
               backgroundPosition: "center",
               transform: "scale(1.06)",
               animation: preview ? undefined : "mise-site-drift 26s ease-out forwards",
             }} />
        {/* readability scrim — the glass-readability rule: text never fights the photo */}
        <div aria-hidden className="absolute inset-0 -z-10"
             style={{
               background:
                 `linear-gradient(180deg, rgba(0,0,0,${t.scrim * 0.85}) 0%, rgba(0,0,0,${t.scrim * 0.35}) 38%, ${t.bg} 99%)`,
             }} />
        <div ref={veilRef} aria-hidden className="absolute inset-0 -z-10"
             style={{ background: `radial-gradient(70% 60% at 50% 40%, ${accent}22, transparent 72%)`, opacity: 0.25 }} />

        <div ref={copyRef} className="relative mx-auto max-w-3xl px-6 py-24 text-center">
          {/* crest */}
          <Reveal still={preview}>
            {data.has_logo && data.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_BASE}${data.logo_url}`} alt={data.name}
                   className="mx-auto h-20 w-20 rounded-2xl object-contain shadow-2xl"
                   style={{ background: "rgba(255,255,255,.08)", backdropFilter: "blur(6px)" }} />
            ) : (
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-2xl text-2xl font-black text-white shadow-2xl"
                   style={{ background: `linear-gradient(135deg, ${accent}, ${accent}99)` }}>
                {monogram(data.name)}
              </div>
            )}
          </Reveal>

          {/* name — word stagger */}
          <h1 className="mt-8 flex flex-wrap justify-center gap-x-4 text-5xl font-black tracking-tight text-white drop-shadow-[0_2px_24px_rgba(0,0,0,.6)] sm:text-7xl">
            {words.map((w, i) => (
              <Reveal key={`${w}-${i}`} delay={120 + i * 110} still={preview}>
                <span>{w}</span>
              </Reveal>
            ))}
          </h1>

          <Reveal delay={140 + words.length * 110} still={preview}>
            <div className="mx-auto mt-6 h-px w-24" style={{ background: accent }} />
            <p className="mt-6 text-lg font-light text-white/85 sm:text-xl">{tagline}</p>
          </Reveal>

          <Reveal delay={260 + words.length * 110} still={preview}>
            <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {L.show_order && (
                <Link href={data.order_url}
                      className="mise-press rounded-xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
                      style={{ background: accent, boxShadow: `0 10px 34px ${accent}55` }}>
                  {L.cta_label || "Order online"}
                </Link>
              )}
              <Link href="/login"
                    className="mise-press rounded-xl border px-7 py-3.5 text-sm font-semibold text-white transition hover:bg-white/10"
                    style={{ borderColor: "rgba(255,255,255,.35)", backdropFilter: "blur(4px)" }}>
                Staff log in →
              </Link>
            </div>
          </Reveal>

          {data.city && (
            <Reveal delay={360 + words.length * 110} still={preview}>
              <p className="mt-8 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/55">
                {data.city}
              </p>
            </Reveal>
          )}
        </div>

        {!preview && (
          <div aria-hidden className="absolute bottom-7 left-1/2 -translate-x-1/2">
            <div className="h-9 w-5 rounded-full border border-white/30 p-1">
              <div className="h-2 w-full rounded-full bg-white/70" style={{ animation: "mise-site-cue 1.7s ease-in-out infinite" }} />
            </div>
          </div>
        )}
      </section>

      {/* ── ABOUT + QUOTE ──────────────────────────────────────────────── */}
      {(L.about || L.quote) && (
        <section className="relative mx-auto max-w-5xl px-6 py-24 sm:py-28">
          <div className="grid gap-14 md:grid-cols-[1.15fr_1fr] md:items-center">
            <div>
              <Reveal still={preview}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: accent }}>
                  {L.about_title || "Our story"}
                </p>
              </Reveal>
              {L.about && (
                <Reveal delay={90} still={preview}>
                  <p className="mt-5 text-xl font-light leading-relaxed sm:text-2xl" style={{ color: t.fg }}>
                    {L.about}
                  </p>
                </Reveal>
              )}
              {L.quote && (
                <Reveal delay={180} still={preview}>
                  <figure className="mt-9 rounded-2xl border p-6"
                          style={{ borderColor: t.line, background: t.panel }}>
                    <div className="text-3xl leading-none" style={{ color: accent }}>&ldquo;</div>
                    <blockquote className="mt-2 text-[17px] italic leading-relaxed" style={{ color: t.fg }}>
                      {L.quote}
                    </blockquote>
                    {L.quote_by && (
                      <figcaption className="mt-3 text-xs font-semibold uppercase tracking-[0.18em]"
                                  style={{ color: t.sub }}>
                        — {L.quote_by}
                      </figcaption>
                    )}
                  </figure>
                </Reveal>
              )}
            </div>

            {/* stacked photo pair */}
            <Reveal delay={140} still={preview}>
              <div className="relative mx-auto aspect-[4/5] w-full max-w-[300px]">
                <div className="absolute inset-0 rotate-3 rounded-3xl border" style={{ borderColor: t.line, background: t.panel }} />
                <div className="absolute inset-0 -rotate-2 overflow-hidden rounded-3xl shadow-2xl"
                     style={{ backgroundImage: `url(${hero})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                <div className="absolute -bottom-4 -right-3 rounded-xl px-4 py-2 text-xs font-bold text-white shadow-xl"
                     style={{ background: accent }}>
                  {data.city || "Open today"}
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      )}

      {/* ── GALLERY ────────────────────────────────────────────────────── */}
      {L.show_gallery && (
        <section className="relative px-6 pb-24 sm:pb-28">
          <div className="mx-auto max-w-5xl">
            <Reveal still={preview}>
              <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: accent }}>
                From our kitchen
              </p>
            </Reveal>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
              {GALLERY.map((g, i) => (
                <Reveal key={g} delay={i * 80} still={preview}>
                  <div className="group relative aspect-[4/3] overflow-hidden rounded-2xl">
                    <div
                      className="absolute inset-0 transition-transform duration-700 group-hover:scale-110"
                      style={{ backgroundImage: `url(/dishes/${g}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" }}
                    />
                    <div aria-hidden className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                         style={{ background: `linear-gradient(0deg, ${accent}66, transparent 60%)` }} />
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── VISIT US ───────────────────────────────────────────────────── */}
      {(L.address || L.phone || L.hours) && (
        <section className="relative px-6 pb-24 sm:pb-28">
          <div className="mx-auto grid max-w-4xl gap-4 sm:grid-cols-3">
            {([
              ["Find us", L.address, "📍"],
              ["Call", L.phone, "📞"],
              ["Hours", L.hours, "🕒"],
            ] as const)
              .filter(([, v]) => Boolean(v))
              .map(([label, value, icon], i) => (
                <Reveal key={label} delay={i * 90} still={preview}>
                  <div className="h-full rounded-2xl border p-5 transition-transform duration-300 hover:-translate-y-1"
                       style={{ borderColor: t.line, background: t.panel }}>
                    <div className="text-xl">{icon}</div>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.24em]" style={{ color: accent }}>
                      {label}
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed" style={{ color: t.fg }}>
                      {value}
                    </p>
                  </div>
                </Reveal>
              ))}
          </div>
        </section>
      )}

      {/* ── CLOSING CTA ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-20">
        <div aria-hidden className="absolute inset-0"
             style={{ background: `linear-gradient(135deg, ${accent}22, transparent 55%, ${accent}18)` }} />
        <Reveal still={preview}>
          <div className="relative mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-black tracking-tight sm:text-4xl" style={{ color: t.fg }}>
              {L.show_order ? "Hungry?" : `Welcome to ${data.name}`}
            </h2>
            <p className="mt-3 text-sm" style={{ color: t.sub }}>
              {L.show_order
                ? "Order in a couple of taps — straight from our kitchen to your table."
                : tagline}
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {L.show_order && (
                <Link href={data.order_url}
                      className="mise-press rounded-xl px-7 py-3.5 text-sm font-semibold text-white shadow-lg transition hover:brightness-110"
                      style={{ background: accent, boxShadow: `0 10px 34px ${accent}44` }}>
                  {L.cta_label || "Order online"}
                </Link>
              )}
              <Link href="/login" className="mise-press rounded-xl border px-7 py-3.5 text-sm font-semibold transition"
                    style={{ borderColor: t.line, color: t.fg }}>
                Staff log in →
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <footer className="border-t px-6 py-8 text-center" style={{ borderColor: t.line }}>
        <p className="text-xs" style={{ color: t.sub }}>
          {data.username && <span className="mr-2 font-semibold">@{data.username}</span>}
          Powered by{" "}
          <a href="https://dineai.cloud" className="font-bold" style={{ color: t.fg }}>Mise</a>
          {" "}· every plate, every penny
        </p>
      </footer>

      <style jsx global>{`
        @keyframes mise-site-drift {
          from { transform: scale(1.06) translate3d(0, 0, 0); }
          to   { transform: scale(1.13) translate3d(0, -1.2%, 0); }
        }
        @keyframes mise-site-cue {
          0%, 100% { opacity: .25; transform: translateY(0); }
          50%      { opacity: 1;   transform: translateY(6px); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="mise-site-drift"] { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
