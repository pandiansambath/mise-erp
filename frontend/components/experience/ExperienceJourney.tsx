"use client";

// The premium "dimension journey" landing (separate from the current site).
// A pinned cinematic stage: 6 bespoke AI scenes that crossfade as you scroll,
// each image breathing slowly (alive even when still). Scroll is smoothed by
// Lenis for that buttery premium feel. Pure transform/opacity → GPU-composited,
// no video decode, no stutter. Morph videos will later upgrade the transitions.

import Link from "next/link";
import { useEffect, useRef } from "react";

type Chip = { label: string; value: string; sub?: string };
type Scene = {
  img: string;
  kicker: string;
  title: [string, string];
  em?: string;
  body?: string;
  chip?: Chip;
  align: "left" | "center" | "right";
  cta?: boolean;
};

const SCENES: Scene[] = [
  {
    img: "sky",
    kicker: "EVERY PLATE · EVERY PENNY",
    title: ["Everything", "in its place."],
    em: "Especially the profit.",
    body: "The operating system for your restaurant. Begin the journey.",
    align: "center",
  },
  {
    img: "mountains",
    kicker: "THE SOURCE",
    title: ["It begins", "in the wild."],
    body: "Every great plate starts far from the plate.",
    align: "left",
  },
  {
    img: "forest",
    kicker: "FROM NATURE",
    title: ["Fresh.", "Traceable."],
    em: "Costed to the gram.",
    align: "right",
  },
  {
    img: "source",
    kicker: "ONE INGREDIENT",
    title: ["One ingredient,", "one true cost."],
    body: "A delivery arrives and its weighted-average cost updates every recipe — automatically.",
    align: "left",
  },
  {
    img: "garden",
    kicker: "ONE SOURCE",
    title: ["It all grows from", "one source."],
    body: "Recipes, inventory, purchasing, staff and profit — one source of truth, not eight spreadsheets.",
    align: "left",
  },
  {
    img: "fire",
    kicker: "COST INTELLIGENCE",
    title: ["Cost every dish", "to the gram."],
    body: "Every recipe re-prices itself the moment a vendor price moves.",
    chip: { label: "Butter Chicken", value: "£3.41 cost · 71% margin", sub: "weighted-avg, live" },
    align: "left",
  },
  {
    img: "dish",
    kicker: "THE MARGIN",
    title: ["Every plate is", "a promise."],
    body: "See exactly what each dish really earns.",
    align: "center",
  },
  {
    img: "restaurant",
    kicker: "STEP INSIDE",
    title: ["The restaurant", "that runs on Mise."],
    align: "center",
  },
  {
    img: "table",
    kicker: "THE PAYOFF",
    title: ["Full tables.", "Open books."],
    body: "When the numbers work, everyone eats — and you keep what you earned.",
    align: "left",
  },
  {
    img: "gold",
    kicker: "SEE EVERY PENNY",
    title: ["Money in,", "money out."],
    body: "A real-time P&L — exactly what's left, today.",
    chip: { label: "Net profit, today", value: "£612 · 29% food cost", sub: "↑ 8% on target" },
    align: "right",
  },
  {
    img: "dawn",
    kicker: "YOUR TURN",
    title: ["Bring order to the kitchen —", "and the books."],
    body: "Set up your restaurant in minutes. No card required.",
    align: "center",
    cta: true,
  },
];

const N = SCENES.length;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const alignCls: Record<Scene["align"], string> = {
  left: "items-start text-left",
  center: "items-center text-center",
  right: "items-end text-right",
};

export default function ExperienceJourney() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const bgs = Array.from(stage.querySelectorAll<HTMLDivElement>("[data-bg]"));
    const texts = Array.from(stage.querySelectorAll<HTMLDivElement>("[data-text]"));
    const op = new Array(N).fill(0);
    const sc = new Array(N).fill(1);
    const lastBg = new Array(N).fill(-1);
    const lastSc = new Array(N).fill(-1);
    const lastTx = new Array(N).fill(-1);

    // paint the document dark so overscroll never flashes white
    const rootEl = document.documentElement;
    const bodyEl = document.body;
    const prevRoot = rootEl.style.background;
    const prevBody = bodyEl.style.background;
    rootEl.style.background = "#04060c";
    bodyEl.style.background = "#04060c";

    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;

    const render = () => {
      const total = wrap.offsetHeight - window.innerHeight;
      const scrolled = clamp01(total > 0 ? -wrap.getBoundingClientRect().top / total : 0);
      if (barRef.current) barRef.current.style.transform = `scaleX(${scrolled})`;
      if (cueRef.current) cueRef.current.style.opacity = scrolled > 0.02 ? "0" : "1";

      const seg = scrolled * (N - 1);
      const a = Math.min(N - 1, Math.floor(seg));
      const frac = seg - a;
      const fade = smoothstep(0.6, 1.0, frac); // hold the scene, then crossfade late
      for (let i = 0; i < N; i++) {
        op[i] = 0;
        sc[i] = 1;
      }
      // "fly into the next dimension": current scene slowly zooms in (you travel
      // into it), the next arrives from depth — not a flat crossfade.
      op[a] = 1 - fade;
      sc[a] = 1 + frac * 0.14;
      if (a + 1 < N) {
        op[a + 1] = fade;
        sc[a + 1] = 1.12 - frac * 0.12;
      }

      for (let i = 0; i < N; i++) {
        const o = op[i];
        if (Math.abs(o - lastBg[i]) > 0.003) {
          bgs[i].style.opacity = String(o);
          lastBg[i] = o;
        }
        if (Math.abs(sc[i] - lastSc[i]) > 0.002) {
          bgs[i].style.transform = `scale(${sc[i].toFixed(4)})`;
          lastSc[i] = sc[i];
        }
        // text only when its scene is clearly dominant
        const t = clamp01((o - 0.5) * 2.4);
        if (Math.abs(t - lastTx[i]) > 0.004) {
          texts[i].style.opacity = String(t);
          texts[i].style.transform = `translateY(${((1 - t) * 26).toFixed(1)}px)`;
          texts[i].style.pointerEvents = t > 0.6 ? "auto" : "none";
          lastTx[i] = t;
        }
      }
    };

    let cancelled = false;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.15, smoothWheel: true });
      const loop = (time: number) => {
        lenis?.raf(time);
        render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    // also render immediately (before Lenis resolves) + on resize
    render();
    window.addEventListener("resize", render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", render);
      lenis?.destroy();
      rootEl.style.background = prevRoot;
      bodyEl.style.background = prevBody;
    };
  }, []);

  return (
    <div className="relative bg-[#04060c] text-white">
      {/* top scroll-progress hairline */}
      <div
        ref={barRef}
        className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-gradient-to-r from-amber-300 via-amber-200 to-emerald-300"
        style={{ transform: "scaleX(0)" }}
      />

      {/* nav */}
      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="font-display text-xl font-semibold tracking-tight drop-shadow">Mise</span>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-white/80 transition hover:text-white">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-full bg-gradient-to-r from-amber-300 to-amber-200 px-4 py-2 text-[13px] font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:shadow-xl"
          >
            Register your hotel
          </Link>
        </nav>
      </header>

      {/* pinned cinematic stage */}
      <section ref={wrapRef} className="relative" style={{ height: `${N * 100}vh` }}>
        <div ref={stageRef} className="mise-exp-in sticky top-0 h-screen w-full overflow-hidden">
          {/* scene images (crossfaded) */}
          {SCENES.map((s, i) => (
            <div
              key={s.img}
              data-bg={i}
              className="absolute inset-0"
              style={{ opacity: i === 0 ? 1 : 0, willChange: "opacity, transform" }}
            >
              <div
                className="mise-exp-drift absolute inset-0 bg-cover bg-center"
                style={{
                  backgroundImage: `url(/experience/${s.img}.jpg)`,
                  animationDelay: `${i * -5}s`,
                }}
              />
            </div>
          ))}

          {/* legibility scrim + vignette */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(4,6,12,0.55) 0%, rgba(4,6,12,0.20) 30%, rgba(4,6,12,0.35) 62%, rgba(4,6,12,0.80) 100%)",
            }}
          />
          <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 260px 80px rgba(0,0,0,0.6)" }} />

          {/* scene texts */}
          {SCENES.map((s, i) => (
            <div
              key={s.img}
              data-text={i}
              className={`absolute inset-0 z-20 flex flex-col justify-center px-7 sm:px-16 lg:px-28 ${alignCls[s.align]}`}
              style={{ opacity: i === 0 ? 1 : 0 }}
            >
              <div className="max-w-3xl">
                <span className="font-mono text-[11px] tracking-[0.4em] text-amber-300/90 sm:text-xs">
                  {s.kicker}
                </span>
                <h2 className="mt-5 font-display text-5xl leading-[1.04] tracking-tight drop-shadow-[0_2px_30px_rgba(0,0,0,0.6)] sm:text-7xl xl:text-8xl">
                  {s.title[0]}
                  <span className="block">{s.title[1]}</span>
                  {s.em ? (
                    <span className="mt-1 block bg-gradient-to-r from-amber-200 to-emerald-200 bg-clip-text italic text-transparent">
                      {s.em}
                    </span>
                  ) : null}
                </h2>
                {s.body ? (
                  <p
                    className={`mt-6 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg ${
                      s.align === "center" ? "mx-auto max-w-xl" : "max-w-xl"
                    }`}
                  >
                    {s.body}
                  </p>
                ) : null}

                {s.chip ? (
                  <div
                    className={`mt-7 inline-block rounded-2xl border border-white/15 bg-black/40 p-4 text-left backdrop-blur-md ${
                      s.align === "center" ? "mx-auto" : ""
                    }`}
                  >
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{s.chip.label}</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-amber-200">{s.chip.value}</p>
                    {s.chip.sub ? (
                      <p className="mt-0.5 font-mono text-[11px] text-emerald-300/90">{s.chip.sub}</p>
                    ) : null}
                  </div>
                ) : null}

                {s.cta ? (
                  <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                    <Link
                      href="/signup"
                      className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-amber-300 to-amber-200 px-7 py-3.5 text-base font-semibold text-black shadow-xl shadow-amber-500/25 transition hover:shadow-2xl"
                    >
                      Register your hotel
                    </Link>
                    <Link
                      href="/login"
                      className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/10"
                    >
                      Sign in
                    </Link>
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {/* scroll cue */}
          <div
            ref={cueRef}
            className="pointer-events-none absolute inset-x-0 bottom-8 z-30 flex flex-col items-center gap-2 transition-opacity duration-500"
          >
            <span className="font-mono text-[10px] tracking-[0.35em] text-white/80 drop-shadow">
              SCROLL TO EXPLORE
            </span>
            <span className="mise-scroll-chevron text-white/80">↓</span>
          </div>
        </div>
      </section>
    </div>
  );
}
