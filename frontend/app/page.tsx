"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { Reveal } from "@/components/Reveal";
import { Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";

/* ────────────────────────────── content ─────────────────────────────────── */

const MODULES = [
  { icon: "🪑", title: "Reservations & guests", desc: "Front-of-house flow, covers and guest history — the night, planned." },
  { icon: "👨‍🍳", title: "Chefs & recipes", desc: "Cost every dish to the gram. Margins update live as vendor prices move." },
  { icon: "📦", title: "Inventory", desc: "Real-time stock at weighted-average cost, with low-stock alerts." },
  { icon: "🛒", title: "Purchasing", desc: "Kitchen indents → cheapest-vendor purchase orders → received into stock." },
  { icon: "🧾", title: "Sales & cash", desc: "Takings by channel, delivery commissions, and a till that balances." },
  { icon: "🧑‍🤝‍🧑", title: "Staff & payroll", desc: "Attendance, breaks, UK-compliant payslips, self-service for staff." },
  { icon: "🧹", title: "Housekeeping & ops", desc: "Tasks, documents and expiry alerts — nothing falls through." },
  { icon: "📈", title: "Reports & P&L", desc: "Gross to net, food-cost %, and where the money really goes." },
];

const LOOP_STEPS = [
  {
    n: "01",
    icon: "📦",
    title: "Stock comes in",
    desc: "Log a delivery and the cost blends automatically into a weighted average. No spreadsheets, no guessing what the chicken really costs.",
    chip: { label: "Chicken breast", value: "£4.20 → £4.35 /kg", sub: "weighted avg, updated live" },
  },
  {
    n: "02",
    icon: "👨‍🍳",
    title: "Every dish is costed",
    desc: "Recipes pull live vendor prices, so the moment an ingredient moves, every plate that uses it re-costs itself — to the gram.",
    chip: { label: "Butter Chicken", value: "£3.41 cost · 71% margin", sub: "re-costed the second prices move" },
  },
  {
    n: "03",
    icon: "🧾",
    title: "You sell",
    desc: "Record takings by channel. Delivery commissions come off automatically and the till is reconciled to the penny.",
    chip: { label: "Tonight's takings", value: "£1,180 dine-in · £660 delivery", sub: "commission deducted, till balanced" },
  },
  {
    n: "04",
    icon: "📈",
    title: "Profit, in the open",
    desc: "A live P&L shows exactly what you kept — and which dish, vendor or shift is quietly eating it.",
    chip: { label: "Net profit, today", value: "£612", sub: "↑ 8% on last week" },
  },
];

const QUOTES = [
  { text: "A menu is a list of promises. Your margins decide whether you can keep them." },
  { text: "Great kitchens don’t hope the numbers work. They prep them like everything else." },
  { text: "Profit isn’t found at the end of the month. It’s plated one dish at a time." },
];

const STATS = [
  { value: "Per-gram", label: "dish costing accuracy" },
  { value: "₹ / £ / $", label: "multi-currency, multi-restaurant" },
  { value: "Live", label: "one set of numbers for every role" },
  { value: "1 platform", label: "the whole brigade, orchestrated" },
];

const btnPrimary =
  "mise-btn-shine inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-6 py-3 text-base font-semibold text-ink-950 shadow-xl shadow-brand-500/25 transition duration-300 hover:shadow-2xl hover:shadow-brand-400/30";
const btnGhost =
  "inline-flex items-center justify-center rounded-xl border border-white/15 px-6 py-3 text-base font-semibold text-white transition duration-300 hover:border-white/30 hover:bg-white/5";

/* ────────────────────────────── hooks ───────────────────────────────────── */

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 0 → 1 progress of scrolling through a tall (taller-than-viewport) section. */
function useScrollProgress(ref: RefObject<HTMLDivElement | null>) {
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) {
        setP(0);
        return;
      }
      setP(Math.min(1, Math.max(0, -rect.top / total)));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [ref]);

  return p;
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Paint the document itself dark while a dark page is mounted, so rubber-band
    overscroll never flashes the app's light theme. */
function useDarkDocument() {
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
}

/** Buttery wheel scrolling — a ~50-line lerp, no library. Desktop pointers
    only; native behaviour kept for touch, keyboard, scrollbar and anchors. */
function useButterScroll(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let target = window.scrollY;
    let current = target;
    let raf = 0;
    let animating = false;

    const max = () => document.documentElement.scrollHeight - window.innerHeight;

    const tick = () => {
      current += (target - current) * 0.09;
      if (Math.abs(target - current) < 0.5) {
        current = target;
        window.scrollTo(0, current);
        animating = false;
        return;
      }
      window.scrollTo(0, current);
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) return; // let pinch-zoom through
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      target = Math.max(0, Math.min(max(), target + delta));
      if (!animating) {
        animating = true;
        current = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    };

    // Keep in sync when scrolling happens by other means (keys, drag, anchor).
    const onScroll = () => {
      if (!animating) {
        target = window.scrollY;
        current = target;
      }
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("scroll", onScroll);
    };
  }, [enabled]);
}

/* ─────────────────────────── micro-components ───────────────────────────── */

/** Thin scroll-progress line pinned to the very top of the viewport. */
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
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-gradient-to-r from-brand-500 via-brand-300 to-copper-300"
      style={{ transform: "scaleX(0)" }}
    />
  );
}

/** Soft light that trails the cursor (desktop only, blends like a glow). */
function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let tx = window.innerWidth / 2;
    let ty = window.innerHeight * 0.35;
    let x = tx;
    let y = ty;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
    };
    const tick = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      if (ref.current) ref.current.style.transform = `translate3d(${x - 350}px, ${y - 350}px, 0)`;
      raf = requestAnimationFrame(tick);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);
  return <div ref={ref} className="mise-cursor-glow" aria-hidden />;
}

/** Buttons that lean toward the cursor and spring back. */
function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left - r.width / 2) * strength;
    const y = (e.clientY - r.top - r.height / 2) * strength;
    el.style.transform = `translate(${x}px, ${y}px)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "translate(0, 0)";
  };
  return (
    <div ref={ref} onMouseMove={onMove} onMouseLeave={onLeave} className="mise-magnetic">
      {children}
    </div>
  );
}

/** The once-per-session intro: counter climbs, curtain lifts, hero staggers. */
function Preloader({ leaving, onCounted }: { leaving: boolean; onCounted: () => void }) {
  const [count, setCount] = useState(0);
  const counted = useRef(false);

  useEffect(() => {
    const start = performance.now();
    const DURATION = 1200;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / DURATION);
      const eased = 1 - Math.pow(1 - p, 3);
      setCount(Math.round(eased * 100));
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else if (!counted.current) {
        counted.current = true;
        onCounted();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [onCounted]);

  return (
    <div className={`mise-loader fixed inset-0 z-[60] ${leaving ? "is-leaving" : ""}`} aria-hidden>
      <div className="mise-loader-back absolute inset-0 bg-gradient-to-b from-brand-700 via-brand-900 to-ink-950" />
      <div className="mise-loader-front absolute inset-0 flex flex-col bg-ink-950">
        <div className="mise-loader-content flex flex-1 flex-col items-center justify-center px-6">
          <Logo size={56} />
          <p className="mt-6 font-display text-5xl text-white sm:text-6xl">Mise</p>
          <p className="mise-loader-tag mt-4 font-mono text-[10px] uppercase text-brand-200/80 sm:text-xs">
            Every plate · Every penny
          </p>
        </div>
        <div className="mise-loader-content px-6 pb-7 sm:px-10">
          <div className="flex items-end justify-between font-mono text-xs text-slate-500">
            <span className="text-2xl text-slate-300 sm:text-3xl">
              {String(count).padStart(3, "0")}
            </span>
            <span className="tracking-[0.3em]">MISE EN PLACE</span>
          </div>
          <div className="mt-3 h-px w-full overflow-hidden bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-brand-400 to-copper-300"
              style={{ width: `${count}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ──────────────────── the money loop (pinned scrollytelling) ────────────── */
/* A tall section. While you scroll through it, a circular "plate" dial stays
   pinned centre-screen and rotates with your scroll; the four steps of the
   money loop slide past on alternating sides. As you reach the bottom of the
   section the dial gently fades out and hands the page back to you.        */

function MoneyLoop() {
  const stageRef = useRef<HTMLDivElement>(null);
  const p = useScrollProgress(stageRef);
  const reduced = usePrefersReducedMotion();

  const stepFloat = p * LOOP_STEPS.length;
  const active = Math.min(LOOP_STEPS.length - 1, Math.floor(stepFloat));

  // Dial: spins with scroll, fades + shrinks as the section bottoms out.
  const rot = -p * 270;
  const exit = clamp01((p - 0.72) / 0.28);
  const dialOpacity = 1 - exit * 0.88;
  const dialScale = 1 - exit * 0.07;

  // Per-step card visibility (fade in → hold → hand off to the next).
  const cardStyle = (i: number): CSSProperties => {
    const t = stepFloat - i;
    const enter = clamp01(t / 0.22);
    const leave = i === LOOP_STEPS.length - 1 ? 0 : clamp01((t - 0.78) / 0.22);
    const opacity = enter * (1 - leave);
    const y = (1 - enter) * 36 - leave * 36;
    return {
      opacity,
      transform: `translateY(${y}px)`,
      pointerEvents: opacity > 0.5 ? "auto" : "none",
    };
  };

  const stepCard = (s: (typeof LOOP_STEPS)[number]) => (
    <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-7 shadow-2xl shadow-black/30 backdrop-blur-xl">
      <p className="font-mono text-xs tracking-[0.35em] text-brand-300/90">STEP {s.n}</p>
      <h3 className="mt-3 font-display text-3xl text-white">{s.title}</h3>
      <p className="mt-3 text-sm leading-relaxed text-slate-300">{s.desc}</p>
      <div className="mt-5 rounded-xl border border-white/10 bg-ink-950/60 p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">{s.chip.label}</p>
        <p className="mt-1 font-mono text-lg font-semibold text-copper-200">{s.chip.value}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{s.chip.sub}</p>
      </div>
    </div>
  );

  /* Simple stacked fallback — mobile & reduced motion. */
  const stacked = (
    <div className={`${reduced ? "" : "lg:hidden"} mx-auto max-w-6xl px-5 py-20 sm:py-24`}>
      <Reveal>
        <p className="text-center font-mono text-xs tracking-[0.35em] text-brand-300/90">THE MONEY LOOP</p>
        <h2 className="mt-4 text-center font-display text-4xl text-white sm:text-5xl">
          Watch a pound move <em className="mise-profit-text not-italic">through your kitchen</em>.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-5 sm:grid-cols-2">
        {LOOP_STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90}>
            <div className="flex h-full flex-col rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.07] to-white/[0.02] p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-xl">{s.icon}</span>
                <span className="font-mono text-xs tracking-[0.3em] text-brand-300/90">STEP {s.n}</span>
              </div>
              <h3 className="mt-4 font-display text-2xl text-white">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
              <div className="mt-auto pt-4">
                <p className="font-mono text-sm font-semibold text-copper-200">{s.chip.value}</p>
                <p className="text-[11px] text-slate-500">{s.chip.sub}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </div>
  );

  return (
    <section id="how-it-works" className="relative border-y border-white/5 bg-ink-950">
      {stacked}

      {!reduced && (
        <div ref={stageRef} className="relative hidden lg:block" style={{ height: "420vh" }}>
          <div className="sticky top-0 flex h-screen items-center overflow-hidden">
            {/* quiet aurora behind the stage */}
            <div className="mise-aurora mise-aurora-shift opacity-70">
              <span style={{ left: "12%", top: "8%", width: 460, height: 460, background: "radial-gradient(circle, #10b981, transparent 70%)" }} />
              <span style={{ right: "10%", bottom: "0%", width: 420, height: 420, background: "radial-gradient(circle, #0ea5e9, transparent 72%)", animationDelay: "8s" }} />
            </div>

            {/* heading pinned at the top of the stage */}
            <div
              className="pointer-events-none absolute inset-x-0 top-24 text-center transition-opacity duration-300"
              style={{ opacity: 0.4 + dialOpacity * 0.6 }}
            >
              <p className="font-mono text-xs tracking-[0.35em] text-brand-300/90">THE MONEY LOOP</p>
              <h2 className="mt-3 font-display text-4xl text-white xl:text-5xl">
                Watch a pound move <em className="mise-profit-text not-italic">through your kitchen</em>.
              </h2>
            </div>

            <div className="relative mx-auto grid w-full max-w-6xl grid-cols-[1fr_auto_1fr] items-center gap-10 px-5 pt-24">
              {/* LEFT column — steps 1 & 3 */}
              <div className="relative h-[430px]">
                {[0, 2].map((i) => (
                  <div
                    key={i}
                    className="absolute inset-0 flex items-center justify-end will-change-transform"
                    style={cardStyle(i)}
                  >
                    {stepCard(LOOP_STEPS[i])}
                  </div>
                ))}
              </div>

              {/* CENTRE — the pinned plate dial */}
              <div
                className="relative h-[360px] w-[360px] will-change-transform"
                style={{ opacity: dialOpacity, transform: `scale(${dialScale})` }}
              >
                {/* halo */}
                <div className="absolute -inset-12 rounded-full bg-brand-500/15 blur-3xl" />
                {/* outer dashed ring — rotates with scroll */}
                <div
                  className="absolute inset-0 rounded-full border-2 border-dashed border-white/15 will-change-transform"
                  style={{ transform: `rotate(${rot}deg)` }}
                />
                {/* mid ring */}
                <div className="absolute inset-9 rounded-full border border-white/10" />

                {/* orbiting module glyphs — counter-rotated to stay upright */}
                {LOOP_STEPS.map((s, i) => {
                  const angle = i * 90 + rot;
                  const isActive = i === active;
                  return (
                    <div
                      key={s.n}
                      className="absolute left-1/2 top-1/2 will-change-transform"
                      style={{ transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-148px) rotate(${-angle}deg)` }}
                    >
                      <div
                        className={`grid h-16 w-16 place-items-center rounded-2xl border text-2xl shadow-xl backdrop-blur transition-all duration-300 ${
                          isActive
                            ? "scale-110 border-brand-400/60 bg-brand-500/15 shadow-brand-500/30 ring-2 ring-brand-400/20"
                            : "border-white/10 bg-white/[0.05] opacity-60"
                        }`}
                      >
                        {s.icon}
                      </div>
                    </div>
                  );
                })}

                {/* centre disc — crossfades the active step */}
                <div className="absolute inset-[104px] overflow-hidden rounded-full border border-white/10 bg-ink-900/80 shadow-2xl backdrop-blur-xl">
                  {LOOP_STEPS.map((s, i) => {
                    const o = clamp01(1.2 - Math.abs(stepFloat - i - 0.5) * 2);
                    return (
                      <div
                        key={s.n}
                        className="absolute inset-0 grid place-items-center"
                        style={{ opacity: o }}
                      >
                        <div className="text-center">
                          <p className="text-3xl">{s.icon}</p>
                          <p className="mt-1 font-mono text-[10px] tracking-[0.3em] text-brand-300">{s.n}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT column — steps 2 & 4 */}
              <div className="relative h-[430px]">
                {[1, 3].map((i) => (
                  <div
                    key={i}
                    className="absolute inset-0 flex items-center justify-start will-change-transform"
                    style={cardStyle(i)}
                  >
                    {stepCard(LOOP_STEPS[i])}
                  </div>
                ))}
              </div>
            </div>

            {/* progress rail */}
            <div
              className="absolute right-8 top-1/2 hidden -translate-y-1/2 flex-col items-center gap-3 xl:flex"
              style={{ opacity: dialOpacity }}
            >
              <span className="font-mono text-xs text-slate-400">
                {String(active + 1).padStart(2, "0")}
                <span className="text-slate-600"> / 04</span>
              </span>
              <div className="relative h-44 w-px overflow-hidden rounded-full bg-white/10">
                <div
                  className="absolute inset-x-0 top-0 bg-gradient-to-b from-brand-400 to-copper-300"
                  style={{ height: `${p * 100}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────── page ────────────────────────────────────── */

type Intro = "pending" | "play" | "leaving" | "done";

export default function Landing() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [intro, setIntro] = useState<Intro>("pending");
  const heroIn = intro === "leaving" || intro === "done";

  useDarkDocument();
  useButterScroll(intro === "done" || intro === "leaving");

  // Decide whether to play the intro (once per tab session; never for
  // reduced-motion users).
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seen = sessionStorage.getItem("mise:intro");
    setIntro(reduced || seen ? "done" : "play");
  }, []);

  // Lock scrolling while the curtain is down.
  useEffect(() => {
    const lock = intro === "pending" || intro === "play";
    document.body.style.overflow = lock ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [intro]);

  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
  }, [user, loading, router]);

  const onCounted = useCallback(() => {
    sessionStorage.setItem("mise:intro", "1");
    setIntro("leaving");
    window.setTimeout(() => setIntro("done"), 1050);
  }, []);

  // Hero entrance helper — staggers children in once the curtain lifts.
  const enter = (i: number, extra = ""): { className: string; style: CSSProperties } => ({
    className: `mise-enter ${extra} ${heroIn ? "is-in" : ""}`,
    style: { transitionDelay: `${150 + i * 110}ms` },
  });

  if ((loading || user) && intro === "done") {
    return (
      <div className="mise-dark-page grid min-h-screen place-items-center bg-ink-950">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="mise-dark-page min-h-screen bg-ink-950 text-slate-100">
      {intro !== "done" && intro !== "pending" && (
        <Preloader leaving={intro === "leaving"} onCounted={onCounted} />
      )}
      {intro === "pending" && (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-ink-950" aria-hidden>
          <div className="flex flex-col items-center">
            <Logo size={56} />
            <p className="mt-6 font-display text-5xl text-white sm:text-6xl">Mise</p>
          </div>
        </div>
      )}

      <ScrollProgress />
      <CursorGlow />

      {/* ── Nav ── */}
      <header
        className={`mise-enter mise-enter-down sticky top-0 z-30 border-b border-white/5 bg-ink-950/70 backdrop-blur-xl ${heroIn ? "is-in" : ""}`}
        style={{ transitionDelay: "80ms" }}
      >
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Logo size={32} />
            <span className="text-lg font-semibold tracking-tight">Mise</span>
          </div>
          <div className="hidden items-center gap-7 text-sm text-slate-400 md:flex">
            <a href="#how-it-works" className="transition hover:text-white">How it works</a>
            <a href="#modules" className="transition hover:text-white">Modules</a>
            <a href="#why" className="transition hover:text-white">Why Mise</a>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Link href="/login" className="whitespace-nowrap rounded-lg px-2.5 py-2 text-sm font-medium text-slate-300 transition hover:text-white sm:px-3">
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

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* aurora — colours glide from emerald → teal → blue and back */}
        <div className="mise-aurora mise-aurora-shift">
          <span style={{ left: "-6%", top: "-12%", width: 600, height: 600, background: "radial-gradient(circle, #10b981, transparent 68%)" }} />
          <span style={{ right: "-8%", top: "2%", width: 560, height: 560, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "7s" }} />
          <span style={{ left: "30%", bottom: "-24%", width: 660, height: 660, background: "radial-gradient(circle, #14b8a6, transparent 72%)", animationDelay: "13s" }} />
        </div>
        <div className="mise-dots pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-ink-950/30 to-ink-950" />

        <div className="relative mx-auto max-w-6xl px-5 pb-16 pt-20 sm:pt-28">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            {/* LEFT — message */}
            <div>
              <div {...enter(0)}>
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 font-mono text-[11px] tracking-[0.25em] text-brand-200">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" />
                  EVERY PLATE · EVERY PENNY
                </span>
              </div>
              <div {...enter(1)}>
                <h1 className="mt-7 font-display text-5xl leading-[1.04] tracking-tight text-white sm:text-6xl xl:text-7xl">
                  Everything in its place.
                  <span className="mise-profit-text mt-1 block italic">Especially the profit.</span>
                </h1>
              </div>
              <div {...enter(2)}>
                <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-300">
                  Mise is the operating system for your restaurant — recipes costed to the gram,
                  stock and purchasing in lockstep, payroll done properly, and a live P&amp;L that
                  tells you what you <span className="font-semibold text-copper-200">actually kept</span>.
                </p>
              </div>
              <div {...enter(3)}>
                <div className="mt-9 flex flex-wrap gap-3">
                  <Magnetic>
                    <Link href="/signup" className={btnPrimary}>
                      Start free — register your hotel
                    </Link>
                  </Magnetic>
                  <Magnetic>
                    <Link href="/login" className={btnGhost}>
                      Sign in
                    </Link>
                  </Magnetic>
                </div>
                <p className="mt-4 font-mono text-xs text-slate-500">No card required · set up in minutes</p>
              </div>
            </div>

            {/* RIGHT — 3D dashboard preview (straightens as you scroll in) */}
            <div {...enter(4, "mise-enter-right")}>
              <div className="mise-3d-stage hidden sm:block">
                <div className="mise-3d relative">
                  <div className="overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-ink-800/95 to-ink-900/95 shadow-2xl shadow-black/50 ring-1 ring-white/5 backdrop-blur-xl">
                    {/* window chrome */}
                    <div className="flex items-center gap-1.5 border-b border-white/5 px-4 py-3">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-400/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                      <span className="ml-2 font-mono text-[11px] text-slate-500">mise · dashboard</span>
                    </div>

                    <div className="p-5 pb-7">
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
                          { l: "Net profit", v: "£612", t: "↑ 8%", c: "text-copper-200" },
                          { l: "Food cost", v: "29%", t: "target 25–35", c: "text-brand-300" },
                        ].map((k) => (
                          <div key={k.l} className="rounded-xl border border-white/5 bg-white/[0.04] p-3">
                            <p className="text-[10px] uppercase tracking-wide text-slate-400">{k.l}</p>
                            <p className={`mt-1 font-mono text-lg font-bold ${k.c}`}>{k.v}</p>
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
                      <p className="mt-1 font-mono text-[10px] text-slate-500">Net sales · last 7 days</p>

                      <div className="mt-4 space-y-1.5">
                        {[
                          { n: "Butter Chicken", m: 89 },
                          { n: "Chicken Biryani", m: 91 },
                          { n: "Masala Dosa", m: 82 },
                        ].map((d) => (
                          <div key={d.n} className="flex items-center gap-3 text-sm">
                            <span className="w-28 shrink-0 text-slate-300">{d.n}</span>
                            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                              <span className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-300" style={{ width: `${d.m}%` }} />
                            </span>
                            <span className="w-9 text-right font-mono text-xs font-semibold text-brand-300">{d.m}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* floating notifications */}
                  <div className="mise-float absolute -right-3 -top-3 flex items-center gap-2 rounded-xl border border-amber-400/30 bg-ink-900/95 px-3 py-2 text-xs shadow-2xl shadow-black/40">
                    <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-500/20 text-amber-300">⚠</span>
                    <span className="font-medium text-amber-100">Paneer low — reorder</span>
                  </div>
                  <div className="mise-float absolute -bottom-5 -left-4 flex items-center gap-2 rounded-xl border border-brand-400/30 bg-ink-900/95 px-3 py-2 text-xs shadow-2xl shadow-black/40" style={{ animationDelay: "2.5s" }}>
                    <span className="grid h-6 w-6 place-items-center rounded-lg bg-brand-500/20 text-brand-300">✓</span>
                    <div>
                      <p className="font-medium text-white">PO approved</p>
                      <p className="text-slate-400">Rudra Foods · <span className="font-mono text-copper-200">£43.60</span></p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* module marquee gliding under the hero */}
        <div {...enter(5)}>
          <div className="relative border-t border-white/5 py-5">
            <div className="mise-marquee-mask overflow-hidden">
              <div className="mise-marquee gap-3 pr-3">
                {[...MODULES, ...MODULES].map((m, i) => (
                  <span
                    key={`${m.title}-${i}`}
                    className="inline-flex shrink-0 items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300"
                  >
                    <span className="text-base">{m.icon}</span>
                    {m.title}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── "mise en place", the dictionary entry ── */}
      <section id="why" className="border-b border-white/5 bg-white/[0.02]">
        <div className="mx-auto max-w-3xl px-5 py-20 sm:py-28">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.35em] text-brand-300/90">FROM THE KITCHEN</p>
            <h2 className="mt-5 font-display text-5xl text-white sm:text-6xl">mise en place</h2>
            <p className="mt-3 font-mono text-sm text-slate-500">/ miːz ɒ̃ ˈplas / · noun · French</p>
          </Reveal>
          <Reveal delay={120}>
            <div className="mt-8 space-y-5 border-l border-white/10 pl-6">
              <p className="text-lg leading-relaxed text-slate-300">
                <span className="mr-3 font-mono text-sm text-slate-500">1.</span>
                <em className="font-display italic text-brand-200">cooking</em> — the discipline great
                kitchens run on: every ingredient prepped, weighed and in its place before service begins.
              </p>
              <p className="text-lg leading-relaxed text-slate-300">
                <span className="mr-3 font-mono text-sm text-slate-500">2.</span>
                <em className="font-display italic text-copper-200">this software</em> — the same
                discipline, applied to the business: every cost, order, shift and sale in its place
                before you open the books.
              </p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── The money loop (pinned scrollytelling) ── */}
      <MoneyLoop />

      {/* ── Modules ── */}
      <section id="modules" className="mx-auto max-w-6xl px-5 py-20 sm:py-28">
        <Reveal>
          <p className="text-center font-mono text-xs tracking-[0.35em] text-brand-300/90">EIGHT MODULES, ONE BRAIN</p>
          <h2 className="mt-4 text-center font-display text-4xl text-white sm:text-5xl">
            One platform. <em className="mise-hero-text not-italic">The whole brigade.</em>
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-center text-slate-400">
            From the host stand to the head chef to the back office — every role works in the same
            system, on the same live numbers.
          </p>
        </Reveal>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m, i) => (
            <Reveal key={m.title} delay={(i % 4) * 80}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-6 transition duration-300 hover:-translate-y-1.5 hover:border-brand-400/40 hover:bg-white/[0.04]">
                <div className="absolute -right-8 -top-8 h-20 w-20 rounded-full bg-brand-500/15 blur-2xl transition duration-300 group-hover:bg-brand-400/30" />
                <div className="relative">
                  <span className="grid h-11 w-11 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-xl">
                    {m.icon}
                  </span>
                  <h3 className="mt-4 font-semibold text-white">{m.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{m.desc}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Kitchen wisdom (pull quotes) ── */}
      <section className="border-y border-white/5 bg-white/[0.02]">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 sm:py-24 lg:grid-cols-3 lg:gap-0 lg:divide-x lg:divide-white/5">
          {QUOTES.map((q, i) => (
            <Reveal key={i} delay={i * 110}>
              <figure className="lg:px-10">
                <span className="font-display text-6xl leading-none text-copper-300/70">“</span>
                <blockquote className="mt-2 font-display text-xl leading-snug text-slate-200">
                  {q.text}
                </blockquote>
              </figure>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Stats band ── */}
      <section className="mx-auto grid max-w-6xl grid-cols-2 gap-x-6 gap-y-10 px-5 py-16 sm:grid-cols-4 sm:py-20">
        {STATS.map((s, i) => (
          <Reveal key={s.label} delay={i * 80}>
            <p className="font-display text-3xl text-white">{s.value}</p>
            <p className="mt-2 text-sm text-slate-400">{s.label}</p>
          </Reveal>
        ))}
      </section>

      {/* ── Final CTA ── */}
      <section className="px-5 pb-24 pt-4">
        <Reveal>
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-brand-900/50 via-ink-900 to-ink-950 px-8 py-16 text-center shadow-2xl shadow-black/40">
            <div className="mise-aurora mise-aurora-shift">
              <span style={{ left: "8%", top: "-30%", width: 420, height: 420, background: "radial-gradient(circle, #10b981, transparent 70%)" }} />
              <span style={{ right: "6%", bottom: "-30%", width: 380, height: 380, background: "radial-gradient(circle, #0ea5e9, transparent 72%)", animationDelay: "6s" }} />
            </div>
            <div className="mise-dots pointer-events-none absolute inset-0" />
            <div className="relative">
              <Logo size={44} className="mx-auto" />
              <h2 className="mt-6 font-display text-4xl text-white sm:text-5xl">
                Bring order to the kitchen —<br className="hidden sm:block" />
                <em className="mise-profit-text not-italic"> and the books.</em>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-slate-300">
                Set up your restaurant in minutes — costs, recipes, staff and profit, all in one place.
                No card required.
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Magnetic>
                  <Link href="/signup" className={btnPrimary}>
                    Register your hotel
                  </Link>
                </Magnetic>
                <Magnetic>
                  <Link href="/login" className={btnGhost}>
                    Sign in
                  </Link>
                </Magnetic>
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
            <span className="hidden sm:inline">— restaurant intelligence</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#how-it-works" className="transition hover:text-slate-300">How it works</a>
            <a href="#modules" className="transition hover:text-slate-300">Modules</a>
            <Link href="/login" className="transition hover:text-slate-300">Sign in</Link>
          </div>
          <p className="font-display italic">Every plate, every penny. © {new Date().getFullYear()} Mise</p>
        </div>
      </footer>
    </div>
  );
}
