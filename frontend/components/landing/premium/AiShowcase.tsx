"use client";

// Mise Copilot, made visible: a breathing orb, a conversation that types
// itself when the section enters view, and the four AI superpowers that
// actually exist in the product (no vapourware).

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { Aurora, SectionHead, useInView, usePrefersReducedMotion } from "./bits";

const CONVOS = [
  {
    q: "Why is food cost up this week?",
    a: "Food cost is 31.4% — up 2.1 points. The driver is tomatoes: Rudra Veg raised them 12% on Tuesday. Switching 3 recipes to Farm2Land saves about £18/week.",
    chips: ["Show the 3 recipes", "Compare vendors"],
  },
  {
    q: "Set up tomorrow's prep from the party order.",
    a: "Done — I've drafted a kitchen indent with 6 lines from Party Order #2216 and a purchase order for the stock you're short of. It's waiting for your approval.",
    chips: ["Review indent", "Approve PO"],
  },
];

const POWERS = [
  {
    icon: "🧾",
    title: "Scans supplier bills",
    body: "Photograph an invoice — line items are read, matched to your vendors and price history updates itself.",
  },
  {
    icon: "✍️",
    title: "Reads handwritten recipes",
    body: "A chef's scribbled note becomes a costed, editable recipe in seconds — ingredients matched to your inventory.",
  },
  {
    icon: "📎",
    title: "Onboards from documents",
    body: "Drop in a PDF of your stock list or P&L and Copilot fills your database — no blank-slate setup.",
  },
  {
    icon: "🔮",
    title: "Watches your numbers",
    body: "Price-rise alerts, low-stock forecasts, labour % warnings — it tells you before the month-end does.",
  },
];

/* ─────────────────── the orbit — scroll-driven ─────────────────── */

// Everything Copilot touches revolves around it on a tilted elliptical track.
// The revolution is DRIVEN BY SCROLL (plus a slow idle drift so it never
// freezes), with depth faked by scale/opacity/z-index as satellites pass in
// front of or behind the orb. Refs + one rAF while on screen — zero React
// re-renders, transform/opacity only.

// Each department is a PLANET: its own hue, a tilted ring (four orbit
// orientations cycling), and a moon riding that ring at its own pace.
const SATELLITES = [
  { icon: "🧾", label: "Bills", hue: "#f59e0b" },
  { icon: "✍️", label: "Recipes", hue: "#f43f5e" },
  { icon: "📦", label: "Stock", hue: "#10b981" },
  { icon: "🗓", label: "Rota", hue: "#38bdf8" },
  { icon: "💷", label: "Sales", hue: "#a78bfa" },
  { icon: "📈", label: "P&L", hue: "#34d399" },
  { icon: "📎", label: "Docs", hue: "#eab308" },
  { icon: "🔮", label: "Forecasts", hue: "#22d3ee" },
];
const RING_TILTS = [0, 45, 90, 135]; // the four orbit orientations

const STARS = [
  { l: "6%", t: "18%", s: 2, d: 0, tw: 3.2 }, { l: "14%", t: "72%", s: 1.5, d: 1.1, tw: 4.1 },
  { l: "24%", t: "10%", s: 1.5, d: 0.6, tw: 3.8 }, { l: "38%", t: "84%", s: 2, d: 1.8, tw: 3.1 },
  { l: "52%", t: "6%", s: 1.5, d: 0.3, tw: 4.4 }, { l: "64%", t: "88%", s: 2, d: 2.3, tw: 3.6 },
  { l: "76%", t: "14%", s: 1.5, d: 1.4, tw: 4 }, { l: "88%", t: "64%", s: 2, d: 0.9, tw: 3.3 },
  { l: "93%", t: "30%", s: 1.5, d: 2, tw: 4.2 }, { l: "45%", t: "94%", s: 1.5, d: 0.2, tw: 3.9 },
];

function OrbitStage() {
  const stageRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const satRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let running = false;
    const t0 = performance.now();

    const render = (now: number) => {
      const rect = stage.getBoundingClientRect();
      const vh = window.innerHeight;
      // -1 → 1 as the stage crosses the viewport: scroll turns the ring.
      const p = ((vh - rect.top - rect.height / 2) / (vh + rect.height)) * 2;
      const rx = Math.min(rect.width / 2 - 64, 330);
      const ry = Math.max(rx * 0.3, 62);
      if (trackRef.current) {
        trackRef.current.style.width = `${rx * 2}px`;
        trackRef.current.style.height = `${ry * 2}px`;
      }
      const base = reduced ? -Math.PI / 2 : p * 2.6 + (now - t0) * 0.00012;
      const n = SATELLITES.length;
      satRefs.current.forEach((el, i) => {
        if (!el) return;
        const a = base + (i / n) * Math.PI * 2;
        const depth = (Math.sin(a) + 1) / 2; // 0 = behind the orb, 1 = in front
        el.style.transform = `translate(-50%, -50%) translate3d(${(Math.cos(a) * rx).toFixed(1)}px, ${(Math.sin(a) * ry).toFixed(1)}px, 0) scale(${(0.72 + depth * 0.34).toFixed(3)})`;
        el.style.opacity = (0.35 + depth * 0.65).toFixed(3);
        el.style.zIndex = depth > 0.5 ? "30" : "5";
      });
      if (running && !reduced) raf = requestAnimationFrame(render);
    };

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && !running) {
            running = true;
            raf = requestAnimationFrame(render);
          } else if (!e.isIntersecting && running) {
            running = false;
            cancelAnimationFrame(raf);
          }
        }
      },
      { threshold: 0 },
    );
    io.observe(stage);
    render(performance.now()); // first paint, even before intersection
    return () => {
      running = false;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <div ref={stageRef} id="orbit-stage" className="relative mx-auto h-[270px] w-full max-w-3xl sm:h-[320px]">
      {/* the galaxy: revolving nebula fog + distant stars */}
      <span className="mise-l-nebula" aria-hidden />
      <span className="mise-l-nebula mise-l-nebula--rev" aria-hidden />
      {STARS.map((st, i) => (
        <span
          key={i}
          className="mise-l-star"
          style={{
            left: st.l,
            top: st.t,
            width: st.s,
            height: st.s,
            animationDelay: `${st.d}s`,
            ["--tw" as string]: `${st.tw}s`,
          }}
          aria-hidden
        />
      ))}
      {/* the elliptical track + a fainter outer companion */}
      <div
        ref={trackRef}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/10"
        aria-hidden
      >
        <span className="absolute -inset-[12%] rounded-[50%] border border-white/5" />
        {/* the asteroid belt: dashed debris rings, twinkling out of phase */}
        <span className="mise-l-belt absolute -inset-[6%] rounded-[50%] border border-dashed border-white/15" />
        <span className="mise-l-belt absolute -inset-[8%] rounded-[50%] border border-dotted border-copper-300/20" style={{ animationDelay: "3s" }} />
        <span className="absolute inset-[10%] rounded-[50%] border border-dashed border-white/[0.04]" />
      </div>
      {/* two comets on long, offset journeys */}
      <span className="mise-l-comet left-[4%] top-[16%]" style={{ animationDelay: "2.5s" }} aria-hidden />
      <span className="mise-l-comet left-[38%] top-[6%]" style={{ animationDelay: "10.5s", animationDuration: "23s" }} aria-hidden />
      {/* the orb — the still centre of the system */}
      <div className="absolute left-1/2 top-1/2 z-10 h-20 w-20 -translate-x-1/2 -translate-y-1/2 sm:h-24 sm:w-24">
        <span className="mise-l-rays" aria-hidden />
        <span className="mise-l-flare absolute -inset-9 rounded-full bg-brand-400/15 blur-2xl" />
        <span className="absolute -inset-4 rounded-full bg-copper-400/10 blur-xl" />
        <span
          className="mise-l-orb absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85), rgba(167,243,208,0.55) 22%, rgba(16,185,129,0.35) 52%, rgba(4,30,23,0.45) 82%)",
            boxShadow:
              "inset 0 -12px 26px rgba(2,20,14,0.6), inset 0 6px 14px rgba(255,255,255,0.28), 0 0 34px rgba(16,185,129,0.35)",
          }}
        />
        <span
          className="absolute -inset-1.5 rounded-full animate-[spin_9s_linear_infinite]"
          style={{
            background: "conic-gradient(from 0deg, transparent 0deg, rgba(167,243,208,0.8) 38deg, transparent 95deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))",
          }}
        />
      </div>
      {/* the planets — every department Copilot touches, each a world of its
          own: spherical shading, a tilted ring, and a moon riding the ring */}
      {SATELLITES.map((s, i) => {
        const tilt = RING_TILTS[i % RING_TILTS.length];
        return (
          <div
            key={s.label}
            ref={(el) => {
              satRefs.current[i] = el;
            }}
            className="absolute left-1/2 top-1/2 flex flex-col items-center will-change-transform"
            style={{ opacity: 0 }}
          >
            <div className="relative h-11 w-11">
              {/* the sphere */}
              <span
                aria-hidden
                className="absolute inset-0 rounded-full"
                style={{
                  background: `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85), ${s.hue}cc 34%, ${s.hue}55 62%, rgba(3,10,8,0.85) 88%)`,
                  boxShadow: `inset -5px -7px 12px rgba(0,0,0,0.6), inset 3px 4px 7px rgba(255,255,255,0.3), 0 0 16px ${s.hue}3d`,
                }}
              />
              {/* surface weather: faint latitude bands + a specular glint */}
              <span
                aria-hidden
                className="absolute inset-0 overflow-hidden rounded-full opacity-25"
                style={{
                  background: "repeating-linear-gradient(14deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 7px)",
                  mixBlendMode: "overlay",
                }}
              />
              <span aria-hidden className="absolute left-[24%] top-[18%] h-1.5 w-1.5 rounded-full bg-white/80 blur-[1.5px]" />
              {/* the icon lives on the surface */}
              <span aria-hidden className="absolute inset-0 grid place-items-center text-base drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]">
                {s.icon}
              </span>
              {/* the tilted ring + its moon — one of four orbit orientations;
                  the squashed parent turns the moon's circle into the ring's
                  exact ellipse */}
              <span
                aria-hidden
                className="pointer-events-none absolute -inset-2.5"
                style={{ transform: `rotate(${tilt}deg) scaleY(0.36)` }}
              >
                <span
                  className="absolute inset-0 rounded-[50%] border"
                  style={{ borderColor: `${s.hue}59`, boxShadow: `0 0 8px ${s.hue}26, inset 0 0 8px ${s.hue}1a` }}
                />
                <span
                  className="mise-l-moon"
                  style={{
                    animationDuration: `${3.6 + i * 0.9}s`,
                    animationDirection: i % 2 ? "reverse" : "normal",
                    ["--moon-r" as string]: "33px",
                  }}
                >
                  <i
                    className="block h-[5px] w-[5px] rounded-full"
                    style={{ background: s.hue, boxShadow: `0 0 7px ${s.hue}` }}
                  />
                </span>
              </span>
            </div>
            <span className="mt-2 whitespace-nowrap rounded-full border border-white/10 bg-ink-900/85 px-2 py-0.5 text-[10px] font-medium text-slate-200 shadow-lg shadow-black/40 backdrop-blur">
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Types `text` character-by-character once `go` turns true. */
function useTyped(text: string, go: boolean, speed = 18) {
  const reduced = usePrefersReducedMotion();
  const [out, setOut] = useState("");
  useEffect(() => {
    if (!go) return setOut("");
    if (reduced) return setOut(text);
    setOut("");
    let i = 0;
    const id = window.setInterval(() => {
      i++;
      setOut(text.slice(0, i));
      if (i >= text.length) window.clearInterval(id);
    }, speed);
    return () => window.clearInterval(id);
  }, [text, go, speed, reduced]);
  return { out, done: out.length >= text.length };
}

function Chat() {
  const { ref, inView } = useInView<HTMLDivElement>(0.5);
  const [convo, setConvo] = useState(0);
  const c = CONVOS[convo];

  const q = useTyped(c.q, inView, 26);
  const a = useTyped(c.a, inView && q.done, 12);

  // After a conversation completes, rest, then play the next one.
  const timer = useRef<number>(0);
  useEffect(() => {
    if (!a.done) return;
    timer.current = window.setTimeout(() => setConvo((v) => (v + 1) % CONVOS.length), 6500);
    return () => window.clearTimeout(timer.current);
  }, [a.done]);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 p-5 shadow-2xl shadow-black/50 backdrop-blur-xl sm:p-6"
    >
      <div className="flex items-center gap-2.5 border-b border-white/5 pb-3.5">
        <span className="relative grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400/30 to-copper-400/30">
          <span className="absolute inset-0 animate-pulse rounded-full bg-brand-400/10" />✨
        </span>
        <div>
          <p className="text-sm font-semibold text-white">Mise Copilot</p>
          <p className="text-[10px] text-slate-500">knows your stock, prices, staff & sales</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-brand-500/15 px-2 py-0.5 text-[10px] text-brand-200">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> online
        </span>
      </div>

      <div className="mt-4 min-h-[240px] space-y-3.5 sm:min-h-[220px]">
        {q.out ? (
          <div className="flex justify-end">
            <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-500/15 px-4 py-2.5 text-sm text-brand-50">
              {q.out}
              {!q.done ? <span className="mise-l-caret" /> : null}
            </p>
          </div>
        ) : null}
        {a.out ? (
          <div className="flex">
            <p className="max-w-[90%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm leading-relaxed text-slate-200">
              {a.out}
              {!a.done ? <span className="mise-l-caret" /> : null}
            </p>
          </div>
        ) : null}
        {a.done ? (
          <div className="mise-pop flex flex-wrap gap-2 pl-1">
            {c.chips.map((chip) => (
              <span
                key={chip}
                className="rounded-full border border-copper-400/30 bg-copper-500/10 px-3 py-1 text-[11px] font-medium text-copper-200"
              >
                {chip} →
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-4 py-2.5">
        <span className="text-[13px] text-slate-500">Ask anything about your hotel…</span>
        <span className="ml-auto grid h-6 w-6 place-items-center rounded-lg bg-brand-500/20 text-[11px] text-brand-300">↵</span>
      </div>
    </div>
  );
}

export default function AiShowcase() {
  return (
    // No content-visibility here: the orbit measures its rect every frame and
    // anchor-jumps to #copilot must land exactly.
    <section id="copilot" className="relative overflow-hidden bg-ink-950">
      {/* the orb's glow bleeds over the whole section */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.28), rgba(234,183,138,0.12), transparent 70%)" }}
      />
      <Aurora strength={0.55} />
      <div className="relative mx-auto max-w-6xl px-6 py-20 sm:px-10 sm:py-24">
        <Reveal>
          <OrbitStage />
        </Reveal>
        <Reveal delay={100}>
          <div className="mt-8">
            <SectionHead
              kicker="MISE COPILOT"
              title={
                <>
                  Ask your hotel <em className="mise-hero-text not-italic">anything.</em>
                </>
              }
              sub="Copilot sits inside the app with your live numbers — it answers with the exact vendor, dish or shift, and can do the work, not just describe it."
            />
          </div>
        </Reveal>

        <div className="mt-14 grid items-start gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <Reveal from="left">
            <Chat />
          </Reveal>
          <div className="grid gap-4 sm:grid-cols-2">
            {POWERS.map((p, i) => (
              <Reveal key={p.title} delay={i * 90}>
                <div className="group h-full rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition duration-300 hover:-translate-y-1 hover:border-brand-400/35 hover:bg-white/[0.05]">
                  <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-lg">
                    {p.icon}
                  </span>
                  <h3 className="mt-3.5 text-[15px] font-semibold text-white">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{p.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
