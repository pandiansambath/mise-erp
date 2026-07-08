"use client";

// Mise Copilot, made visible: a breathing orb, a conversation that types
// itself when the section enters view, and the four AI superpowers that
// actually exist in the product (no vapourware).

import { useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { SectionHead, useInView, usePrefersReducedMotion } from "./bits";

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
    <section id="copilot" className="mise-cv relative overflow-hidden border-t border-white/5 bg-[#02080a]">
      {/* the orb's glow bleeds over the whole section */}
      <div className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[860px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-60 blur-3xl"
        style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.28), rgba(234,183,138,0.12), transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
        <Reveal>
          <div className="flex justify-center">
            <div className="relative h-20 w-20 sm:h-24 sm:w-24">
              {/* halo */}
              <span className="absolute -inset-9 rounded-full bg-brand-400/15 blur-2xl" />
              <span className="absolute -inset-4 rounded-full bg-copper-400/10 blur-xl" />
              {/* glass sphere */}
              <span
                className="mise-l-orb absolute inset-0 rounded-full"
                style={{
                  background:
                    "radial-gradient(circle at 32% 28%, rgba(255,255,255,0.85), rgba(167,243,208,0.55) 22%, rgba(16,185,129,0.35) 52%, rgba(4,30,23,0.45) 82%)",
                  boxShadow:
                    "inset 0 -12px 26px rgba(2,20,14,0.6), inset 0 6px 14px rgba(255,255,255,0.28), 0 0 34px rgba(16,185,129,0.35)",
                }}
              />
              {/* orbiting light */}
              <span
                className="absolute -inset-1.5 rounded-full animate-[spin_9s_linear_infinite]"
                style={{
                  background:
                    "conic-gradient(from 0deg, transparent 0deg, rgba(167,243,208,0.8) 38deg, transparent 95deg)",
                  WebkitMask:
                    "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))",
                  mask: "radial-gradient(farthest-side, transparent calc(100% - 2.5px), #000 calc(100% - 2px))",
                }}
              />
            </div>
          </div>
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
