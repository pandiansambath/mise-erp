"use client";

// The premium scroll-SCRUBBED cinematic journey.
// The whole thing is driven by your scroll — nothing autoplays:
//   • a scene HOLDS (still image + headline you can read) for a stretch of scroll
//   • then as you keep scrolling, the transition video SCRUBS frame-by-frame with
//     your scroll — scroll down = fly forward, scroll up = fly back.
// Videos are all-intra (every frame a keyframe) so seeking is instant + smooth.
// Posters = the start still, so there is never a black gap. Lenis smooths scroll.

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

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
  { img: "sky", kicker: "EVERY PLATE · EVERY PENNY", title: ["Everything", "in its place."], em: "Especially the profit.", body: "The operating system for your restaurant. Begin the journey.", align: "center" },
  { img: "mountains", kicker: "THE SOURCE", title: ["It begins", "in the wild."], body: "Every great plate starts far from the plate.", align: "left" },
  { img: "forest", kicker: "FROM NATURE", title: ["Fresh.", "Traceable."], em: "Costed to the gram.", align: "right" },
  { img: "source", kicker: "ONE INGREDIENT", title: ["One ingredient,", "one true cost."], body: "A delivery arrives and its weighted-average cost updates every recipe — automatically.", align: "left" },
  { img: "garden", kicker: "ONE SOURCE", title: ["It all grows from", "one source."], body: "Recipes, inventory, purchasing, staff and profit — one source of truth, not eight spreadsheets.", align: "left" },
  { img: "fire", kicker: "COST INTELLIGENCE", title: ["Cost every dish", "to the gram."], body: "Every recipe re-prices itself the moment a vendor price moves.", chip: { label: "Butter Chicken", value: "£3.41 cost · 71% margin", sub: "weighted-avg, live" }, align: "left" },
  { img: "dish", kicker: "THE MARGIN", title: ["Every plate is", "a promise."], body: "See exactly what each dish really earns.", align: "center" },
  { img: "restaurant", kicker: "STEP INSIDE", title: ["The restaurant", "that runs on Mise."], align: "center" },
  { img: "table", kicker: "THE PAYOFF", title: ["Full tables.", "Open books."], body: "When the numbers work, everyone eats — and you keep what you earned.", align: "left" },
  { img: "gold", kicker: "SEE EVERY PENNY", title: ["Money in,", "money out."], body: "A real-time P&L — exactly what's left, today.", chip: { label: "Net profit, today", value: "£612 · 29% food cost", sub: "↑ 8% on target" }, align: "right" },
  { img: "dawn", kicker: "YOUR TURN", title: ["Bring order to the kitchen —", "and the books."], body: "Set up your restaurant in minutes. No card required.", align: "center", cta: true },
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

// Timeline of "beats": hold scene 0, transition 0→1, hold scene 1, … hold scene N-1.
const HOLD_W = 0.62; // scroll length of a scene hold (read the headline)
const TRANS_W = 0.85; // scroll length of a flythrough (room to scrub smoothly)
type Beat = { type: "hold" | "trans"; i: number; start: number; end: number };
const BEATS: Beat[] = (() => {
  const raw: { type: "hold" | "trans"; i: number; w: number }[] = [];
  for (let i = 0; i < N; i++) {
    raw.push({ type: "hold", i, w: HOLD_W });
    if (i < N - 1) raw.push({ type: "trans", i, w: TRANS_W });
  }
  const total = raw.reduce((s, b) => s + b.w, 0);
  let acc = 0;
  return raw.map((b) => {
    const start = acc / total;
    acc += b.w;
    return { type: b.type, i: b.i, start, end: acc / total };
  });
})();
const TOTAL_W = N * HOLD_W + (N - 1) * TRANS_W;

export default function ExperienceJourney() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const cueRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const onReady = useCallback(() => setReady(true), []);

  // Lock scroll until the first scenes are loaded.
  useEffect(() => {
    document.body.style.overflow = ready ? "" : "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [ready]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const stage = stageRef.current;
    if (!wrap || !stage) return;
    const bgs = Array.from(stage.querySelectorAll<HTMLDivElement>("[data-bg]"));
    const texts = Array.from(stage.querySelectorAll<HTMLDivElement>("[data-text]"));
    const vids = Array.from(stage.querySelectorAll<HTMLVideoElement>("[data-morph]"));
    const lastBg = new Array(N).fill(-1);
    const lastTx = new Array(N).fill(-1);
    const lastVid = new Array(vids.length).fill(-1);
    const lastSeek = new Array(vids.length).fill(-1);

    const rootEl = document.documentElement;
    const bodyEl = document.body;
    const prevRoot = rootEl.style.background;
    const prevBody = bodyEl.style.background;
    rootEl.style.background = "#04060c";
    bodyEl.style.background = "#04060c";

    // ── preload the first scene images, then reveal ──
    let loaded = 0;
    const REVEAL = Math.min(2, N);
    const bump = () => {
      loaded++;
      setProgress(Math.min(1, loaded / REVEAL));
      if (loaded >= REVEAL) onReady();
    };
    for (let i = 0; i < REVEAL; i++) {
      const im = new Image();
      im.onload = bump;
      im.onerror = bump;
      im.src = `/experience/${SCENES[i].img}.jpg`;
    }
    const revealTimeout = window.setTimeout(onReady, 7000);

    const setBg = (i: number, o: number) => {
      if (Math.abs(o - lastBg[i]) > 0.004) {
        bgs[i].style.opacity = String(o);
        lastBg[i] = o;
      }
    };
    const setTx = (i: number, o: number) => {
      if (Math.abs(o - lastTx[i]) > 0.004) {
        texts[i].style.opacity = String(o);
        texts[i].style.transform = `translateY(${((1 - o) * 24).toFixed(1)}px)`;
        texts[i].style.pointerEvents = o > 0.6 ? "auto" : "none";
        lastTx[i] = o;
      }
    };
    const setVid = (t: number, o: number) => {
      if (Math.abs(o - lastVid[t]) > 0.004) {
        vids[t].style.opacity = String(o);
        lastVid[t] = o;
      }
    };

    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;

    const render = () => {
      const total = wrap.offsetHeight - window.innerHeight;
      const p = clamp01(total > 0 ? -wrap.getBoundingClientRect().top / total : 0);
      if (barRef.current) barRef.current.style.transform = `scaleX(${p})`;
      if (cueRef.current) cueRef.current.style.opacity = p > 0.01 ? "0" : "1";

      // find the active beat
      let b = BEATS[BEATS.length - 1];
      for (let k = 0; k < BEATS.length; k++) {
        if (p < BEATS[k].end) {
          b = BEATS[k];
          break;
        }
      }
      const lp = clamp01((p - b.start) / (b.end - b.start));

      // reset all
      for (let i = 0; i < N; i++) {
        setBg(i, 0);
        setTx(i, 0);
      }

      if (b.type === "hold") {
        const s = b.i;
        setBg(s, 1);
        // headline visible across the middle of the hold
        const tOp = clamp01(Math.min(smoothstep(0.04, 0.2, lp), 1 - smoothstep(0.82, 0.98, lp)) * 1.05);
        setTx(s, tOp);
        for (let t = 0; t < vids.length; t++) setVid(t, 0);
      } else {
        const t = b.i;
        const vIn = smoothstep(0.0, 0.12, lp);
        const vOut = smoothstep(0.88, 1.0, lp);
        setBg(t, 1 - vIn); // start scene fades out as the flight begins
        setBg(t + 1, vOut); // end scene fades in as it lands
        const vo = clamp01(Math.min(vIn, 1 - vOut));
        for (let k = 0; k < vids.length; k++) setVid(k, k === t ? vo : 0);
        // SCRUB the flythrough to scroll
        const v = vids[t];
        const dur = v.duration && isFinite(v.duration) ? v.duration : 5;
        const target = lp * dur;
        if (v.readyState >= 1 && Math.abs(target - lastSeek[t]) > 0.04) {
          try {
            v.currentTime = target;
          } catch {
            /* not seekable yet */
          }
          lastSeek[t] = target;
        }
      }

      // lazy-load the current + neighbouring transition videos
      const at = b.type === "trans" ? b.i : Math.min(b.i, N - 2);
      for (let t = 0; t < vids.length; t++) {
        if ((t === at || t === at + 1 || t === at - 1) && !vids[t].getAttribute("src")) {
          vids[t].setAttribute("src", vids[t].dataset.src || "");
          vids[t].load();
        }
      }
    };

    let cancelled = false;
    import("lenis").then(({ default: Lenis }) => {
      if (cancelled) return;
      lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      const loop = (time: number) => {
        lenis?.raf(time);
        render();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    });
    render();
    window.addEventListener("resize", render);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      clearTimeout(revealTimeout);
      window.removeEventListener("resize", render);
      lenis?.destroy();
      rootEl.style.background = prevRoot;
      bodyEl.style.background = prevBody;
    };
  }, [onReady]);

  return (
    <div className="relative bg-[#04060c] text-white">
      {/* Loader — holds until the first scenes are ready (no black flash) */}
      <div
        className="fixed inset-0 z-[60] grid place-items-center bg-[#04060c] transition-opacity duration-700"
        style={{ opacity: ready ? 0 : 1, visibility: ready ? "hidden" : "visible" }}
      >
        <div className="flex w-56 max-w-[70vw] flex-col items-center">
          <p className="font-display text-5xl tracking-tight">Mise</p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.3em] text-amber-200/80">Every plate · Every penny</p>
          <div className="mt-6 h-[3px] w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-300 to-emerald-300 transition-[width] duration-300" style={{ width: `${Math.max(8, Math.round(progress * 100))}%` }} />
          </div>
        </div>
      </div>

      <div ref={barRef} className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-gradient-to-r from-amber-300 via-amber-200 to-emerald-300" style={{ transform: "scaleX(0)" }} />

      <header className="fixed inset-x-0 top-0 z-40 flex items-center justify-between px-6 py-5 sm:px-10">
        <span className="font-display text-xl font-semibold tracking-tight drop-shadow">Mise</span>
        <nav className="flex items-center gap-3">
          <Link href="/login" className="text-sm font-medium text-white/80 transition hover:text-white">Sign in</Link>
          <Link href="/signup" className="rounded-full bg-gradient-to-r from-amber-300 to-amber-200 px-4 py-2 text-[13px] font-semibold text-black shadow-lg shadow-amber-500/20 transition hover:shadow-xl">Register your hotel</Link>
        </nav>
      </header>

      <section ref={wrapRef} className="relative" style={{ height: `${Math.round(TOTAL_W * 100)}vh` }}>
        <div ref={stageRef} className="sticky top-0 h-screen w-full overflow-hidden">
          {/* scene stills */}
          {SCENES.map((s, i) => (
            <div key={s.img} data-bg={i} className="absolute inset-0" style={{ opacity: i === 0 ? 1 : 0, willChange: "opacity" }}>
              <div className="mise-exp-drift absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(/experience/${s.img}.jpg)`, animationDelay: `${i * -5}s` }} />
            </div>
          ))}

          {/* flythrough videos — scrubbed by scroll; poster = start still (no black) */}
          {SCENES.slice(0, N - 1).map((s, i) => (
            <video
              key={`morph-${i}`}
              data-morph={i}
              data-src={`/experience/morphs/${SCENES[i].img}-to-${SCENES[i + 1].img}.mp4`}
              poster={`/experience/${SCENES[i].img}.jpg`}
              muted
              playsInline
              preload="none"
              className="absolute inset-0 h-full w-full object-cover"
              style={{ opacity: 0, willChange: "opacity" }}
            />
          ))}

          <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(4,6,12,0.55) 0%, rgba(4,6,12,0.20) 30%, rgba(4,6,12,0.35) 62%, rgba(4,6,12,0.80) 100%)" }} />
          <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 260px 80px rgba(0,0,0,0.6)" }} />

          {/* scene texts */}
          {SCENES.map((s, i) => (
            <div key={s.img} data-text={i} className={`absolute inset-0 z-20 flex flex-col justify-center px-7 sm:px-16 lg:px-28 ${alignCls[s.align]}`} style={{ opacity: i === 0 ? 1 : 0 }}>
              <div className="max-w-3xl">
                <span className="font-mono text-[11px] tracking-[0.4em] text-amber-300/90 sm:text-xs">{s.kicker}</span>
                <h2 className="mt-5 font-display text-5xl leading-[1.04] tracking-tight drop-shadow-[0_2px_30px_rgba(0,0,0,0.65)] sm:text-7xl xl:text-8xl">
                  {s.title[0]}
                  <span className="block">{s.title[1]}</span>
                  {s.em ? <span className="mt-1 block bg-gradient-to-r from-amber-200 to-emerald-200 bg-clip-text italic text-transparent">{s.em}</span> : null}
                </h2>
                {s.body ? <p className={`mt-6 text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg ${s.align === "center" ? "mx-auto max-w-xl" : "max-w-xl"}`}>{s.body}</p> : null}
                {s.chip ? (
                  <div className={`mt-7 inline-block rounded-2xl border border-white/15 bg-black/40 p-4 text-left backdrop-blur-md ${s.align === "center" ? "mx-auto" : ""}`}>
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">{s.chip.label}</p>
                    <p className="mt-1 font-mono text-xl font-semibold text-amber-200">{s.chip.value}</p>
                    {s.chip.sub ? <p className="mt-0.5 font-mono text-[11px] text-emerald-300/90">{s.chip.sub}</p> : null}
                  </div>
                ) : null}
                {s.cta ? (
                  <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
                    <Link href="/signup" className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-amber-300 to-amber-200 px-7 py-3.5 text-base font-semibold text-black shadow-xl shadow-amber-500/25 transition hover:shadow-2xl">Register your hotel</Link>
                    <Link href="/login" className="inline-flex items-center justify-center rounded-xl border border-white/25 bg-white/5 px-7 py-3.5 text-base font-semibold text-white backdrop-blur-md transition hover:bg-white/10">Sign in</Link>
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {/* scroll cue */}
          <div ref={cueRef} className="pointer-events-none absolute inset-x-0 bottom-8 z-30 flex flex-col items-center gap-2 transition-opacity duration-500">
            <span className="font-mono text-[10px] tracking-[0.35em] text-white/80 drop-shadow">SCROLL TO EXPLORE</span>
            <span className="mise-scroll-chevron text-white/80">↓</span>
          </div>
        </div>
      </section>
    </div>
  );
}
