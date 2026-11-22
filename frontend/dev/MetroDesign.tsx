"use client";

// Design 2 of 5: Metro — "Every line leads somewhere."
//
// His career as a transit map, built from nothing for this design:
//   · a station nameboard for his name, with a live departure board;
//   · his portrait as the "you are here" station badge;
//   · the line itself, 2019 to today, every milestone a station, a train
//     riding it as you scroll, the line drawing itself as it comes into view;
//   · his skill families as the network's other lines;
//   · the résumé as a ticket; DineAI as a branch line; volunteering as the
//     community line; and a line that runs on past today.

import { useEffect, useRef, useState } from "react";
import { CAREER_START, chennaiTime, elapsed, useDev, useNow, usePortraits } from "./context";
import { ResumeActions, kindGlyph, kindRole, stations, type Station } from "./designKit";
import { PROJECT, VOLUNTEERING } from "./profile";
import { CLUSTERS, DOCS, EDUCATION } from "./skills";

const SIGN = "font-sans font-black uppercase tracking-[0.04em]";

/** Characters that flip into place, like a split-flap departure board. */
function Flap({ text }: { text: string }) {
  return (
    <span className="inline-flex gap-[2px]">
      {text.split("").map((ch, i) => (
        <span
          key={`${i}-${ch}`}
          className="inline-grid min-w-[0.72em] place-items-center rounded-[3px] bg-black/60 px-[1px] py-[1px] font-mono font-bold text-[#ffd34d] shadow-[inset_0_-1px_0_rgba(255,255,255,.08)]"
          style={{ animation: `devFlap .5s ${i * 0.03}s cubic-bezier(.3,1.4,.5,1) both` }}
        >
          {ch === " " ? " " : ch}
        </span>
      ))}
    </span>
  );
}

/** Reveal-on-view for the station cards. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: "-10% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, seen] as const;
}

function StationRow({ s, i, last }: { s: Station; i: number; last: boolean }) {
  const [ref, seen] = useInView<HTMLLIElement>();
  const left = i % 2 === 0;
  const role = kindRole(s.kind);
  const era = s.kind === "education" ? "var(--d-c)" : "var(--d-a)";
  const interchange = s.kind === "recognition" || s.kind === "promotion" || s.kind === "now";
  const card = (
    <div
      className={`rounded-2xl border border-[var(--d-line2)] bg-[var(--d-bg2)] p-4 shadow-[0_18px_40px_-24px_rgba(0,0,0,.6)] transition-all duration-700 ease-out ${
        seen ? "translate-x-0 opacity-100" : left ? "-translate-x-6 opacity-0 md:-translate-x-10" : "translate-x-6 opacity-0 md:translate-x-10"
      }`}
    >
      <p className="flex items-center gap-2">
        <span className="rounded-md px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.12em] text-[var(--d-on)]" style={{ background: `var(--d-${role})` }}>
          {s.when.toUpperCase()}
        </span>
        <span className="font-mono text-[10px] tracking-[0.18em]" style={{ color: `var(--d-${role})` }}>
          {kindGlyph(s.kind)} {s.kind === "now" ? "YOU ARE HERE" : s.kind.toUpperCase()}
        </span>
      </p>
      <p className={`mt-2 text-[16px] font-bold leading-snug ${s.kind === "recognition" ? "dev-gold" : ""}`}>{s.title}</p>
      {s.promoted && (
        <p className="mt-1.5 inline-block rounded-full border border-[var(--d-b)]/40 px-2 py-0.5 font-mono text-[10px] text-[var(--d-b2)]">
          PROMOTED · {s.promoted.toUpperCase()}
        </p>
      )}
      <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--d-ink4)]">{s.note}</p>
      {s.title.startsWith("Gold Medalist") && (
        <a href={EDUCATION.verifyUrl} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block font-mono text-[11px] text-[var(--d-gold)] underline-offset-4 hover:underline">
          ✓ verify on the rank list ↗
        </a>
      )}
    </div>
  );
  return (
    <li ref={ref} className="relative grid grid-cols-[44px_1fr] md:grid-cols-[1fr_64px_1fr]">
      {/* The track through this station, in the colour of its era. */}
      <span
        aria-hidden
        className="absolute -bottom-px top-0 left-[17px] w-[10px] origin-top md:left-1/2 md:-translate-x-1/2"
        style={{
          background: last ? `linear-gradient(${era}, ${era} 40%, transparent)` : era,
          transform: seen ? "scaleY(1)" : "scaleY(0)",
          transition: "transform 900ms cubic-bezier(.2,.8,.2,1)",
        }}
      />
      <div className="hidden pb-10 pr-2 md:block">{left && card}</div>
      <div className="relative flex justify-center pt-3 md:pt-4">
        <span
          className={`relative z-10 grid place-items-center rounded-full border-[5px] bg-[var(--d-bg)] ${interchange ? "h-9 w-9" : "h-7 w-7"}`}
          style={{
            borderColor: interchange ? `var(--d-${role})` : "var(--d-ink)",
            boxShadow: interchange ? `0 0 0 4px var(--d-bg), 0 0 0 7px var(--d-${role})` : undefined,
            animation: s.kind === "now" ? "devPulseRing 2s ease-out infinite" : undefined,
          }}
        >
          {interchange && <span className="text-[11px] font-black" style={{ color: `var(--d-${role})` }}>{kindGlyph(s.kind)}</span>}
        </span>
      </div>
      {/* Phones show every card on the right; desktop alternates sides. */}
      <div className="pb-8 md:pb-10 md:pl-2">
        <div className={left ? "md:hidden" : ""}>{card}</div>
      </div>
    </li>
  );
}

export function MetroDesign() {
  // His portrait photos and their pace, set in the owner panel (22 Nov).
  const PORTRAITS = usePortraits();
  const { entered, milestones, openAlbum } = useDev();
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const list = stations(milestones, now);
  const map = useRef<HTMLElement>(null);
  const train = useRef<HTMLDivElement>(null);

  // The train rides the line with the scroll: DOM writes, no re-render.
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = 0;
      const el = map.current;
      const t = train.current;
      if (!el || !t) return;
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (window.innerHeight * 0.55 - r.top) / r.height));
      t.style.transform = `translate(-50%, ${(p * (r.height - 60)).toFixed(0)}px)`;
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      cancelAnimationFrame(raf);
    };
  }, []);

  const pop = (d: number) => (entered ? { animation: `devFadeUp .8s ${d}s ease-out both` } : { opacity: 0 });

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-20 pt-24 sm:px-6 sm:pt-28">
      {/* The map's paper: a faint grid. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          backgroundImage:
            "linear-gradient(color-mix(in srgb, var(--d-ink) 5%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--d-ink) 5%, transparent) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* ── The station ─────────────────────────────────────────────── */}
      <section className="grid items-center gap-8 md:grid-cols-[1.3fr_1fr]">
        <div style={pop(0.05)}>
          <div className="overflow-hidden rounded-2xl border-[6px] shadow-[0_30px_60px_-30px_rgba(0,0,0,.7)]" style={{ borderColor: "var(--d-a)" }}>
            <div className="px-5 py-5 text-[var(--d-on)] sm:px-7 sm:py-7" style={{ background: "var(--d-a)" }}>
              <p className="font-mono text-[11px] font-bold tracking-[0.3em] opacity-80">NOW ARRIVING</p>
              <h1 className={`${SIGN} mt-1 text-[clamp(2.2rem,7vw,4.6rem)] leading-[0.95]`}>Pandian Sambath</h1>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-[var(--d-bg2)] px-5 py-3 font-mono text-[11px] font-bold tracking-[0.14em] sm:px-7">
              <span className="text-[var(--d-ink)]">SYSTEM ENGINEER LINE</span>
              <span className="text-[var(--d-a2)]">TATA CONSULTANCY SERVICES</span>
              <span className="text-[var(--d-ink5)]">PLATFORM 1 · CHENNAI · {now ? `${chennaiTime(now)} IST` : "--:--"}</span>
            </div>
          </div>

          {/* Departures. */}
          <div className="mt-4 rounded-2xl bg-[#0b0b0d] p-4 text-[13px] text-[#ffd34d] shadow-inner ring-1 ring-black/40 sm:text-[15px]">
            <p className="mb-2 font-mono text-[10px] tracking-[0.3em] text-[#ffd34d]/60">DEPARTURES</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-[#ffd34d]/70">IN SERVICE</span>
                {exp && <Flap text={`${exp.years}Y ${String(exp.months).padStart(2, "0")}M ${String(exp.days).padStart(2, "0")}D`} />}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-[#ffd34d]/70">DAY</span>
                {exp && <Flap text={exp.dayNumber.toLocaleString("en-US")} />}
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-[#ffd34d]/70">NEXT STOP</span>
                {exp && <Flap text={`${exp.years + 1} YEARS`} />}
              </div>
            </div>
          </div>
        </div>

        {/* You are here: the portrait as a station badge. */}
        <button type="button" onClick={openAlbum} aria-label="Open the photo album" className="group relative mx-auto block w-[min(78vw,340px)]" style={pop(0.2)}>
          <span className="absolute inset-0 rounded-full" style={{ background: "conic-gradient(var(--d-a) 0 25%, var(--d-b) 0 50%, var(--d-c) 0 75%, var(--d-a2) 0)", animation: "devSpin 30s linear infinite" }} />
          <span className="absolute inset-[14px] rounded-full bg-[var(--d-bg)]" />
          <span className="absolute inset-[22px] overflow-hidden rounded-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend */}
            <img src={PORTRAITS[0]} alt="Pandian Sambath" className="h-full w-full object-cover transition duration-700 group-hover:scale-105" style={{ objectPosition: "50% 30%" }} />
          </span>
          <span className="relative block aspect-square" />
          <span className={`${SIGN} absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-4 py-1.5 text-[12px] text-[var(--d-on)] shadow-lg`} style={{ background: "var(--d-b)" }}>
            ● You are here
          </span>
        </button>
      </section>

      {/* ── The line ─────────────────────────────────────────────────── */}
      <section ref={map} className="relative mt-20">
        <h2 className={`${SIGN} mb-8 text-center text-[clamp(1.4rem,4vw,2.4rem)]`}>
          The line <span className="text-[var(--d-ink5)]">· 2019 → today</span>
        </h2>
        <div
          ref={train}
          aria-hidden
          className="pointer-events-none absolute left-[22px] top-[4.5rem] z-20 md:left-1/2"
          style={{ transform: "translate(-50%, 0)" }}
        >
          <span className="block h-14 w-[22px] rounded-full border-2 border-[var(--d-bg)] shadow-[0_0_20px_var(--d-b)]" style={{ background: "linear-gradient(var(--d-b2), var(--d-b))" }}>
            <span className="mx-auto mt-2 block h-2 w-2.5 rounded-sm bg-[var(--d-bg)]/70" />
            <span className="mx-auto mt-1 block h-2 w-2.5 rounded-sm bg-[var(--d-bg)]/70" />
          </span>
        </div>
        <ol className="relative">
          {list.map((s, i) => (
            <StationRow key={`${s.when}-${s.title}`} s={s} i={i} last={i === list.length - 1} />
          ))}
        </ol>
      </section>

      {/* ── The network: skill families as lines ────────────────────── */}
      <section className="mt-16">
        <h2 className={`${SIGN} text-[clamp(1.4rem,4vw,2.4rem)]`}>The network</h2>
        <p className="mt-1 text-[13px] text-[var(--d-ink4)]">Every family of skills is a line. Every stop opens its documentation.</p>
        <div className="mt-6 space-y-6">
          {CLUSTERS.map((c) => (
            <div key={c.key} className="rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-4">
              <p className="flex items-center gap-2">
                <span className={`${SIGN} rounded-md px-2.5 py-1 text-[12px] text-[var(--d-on)]`} style={{ background: c.hue }}>
                  {c.label} line
                </span>
                <span className="font-mono text-[10px] text-[var(--d-ink5)]">{c.items.length} STOPS</span>
              </p>
              <div className="relative mt-5 flex flex-wrap gap-x-1 gap-y-6 pl-1">
                <span aria-hidden className="absolute left-0 right-0 top-[9px] h-[6px] rounded-full" style={{ background: c.hue }} />
                {c.items.map((item) => (
                  <a
                    key={item}
                    href={DOCS[item]}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group relative flex min-w-[88px] flex-1 flex-col items-center"
                  >
                    <span className="relative z-10 h-6 w-6 rounded-full border-[4px] bg-[var(--d-bg)] transition group-hover:scale-125" style={{ borderColor: c.hue }} />
                    <span className="mt-1.5 text-center font-mono text-[11px] font-bold text-[var(--d-ink2)] group-hover:text-[var(--d-ink)]">{item}</span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Ticket, branch line, community line ─────────────────────── */}
      <section className="mt-16 grid gap-5 md:grid-cols-3">
        <div className="dev-ticket relative overflow-hidden rounded-2xl p-5 text-[var(--d-on)]" style={{ background: "linear-gradient(135deg, var(--d-a2), var(--d-a))" }}>
          <p className="font-mono text-[10px] font-bold tracking-[0.3em] opacity-80">SINGLE JOURNEY</p>
          <p className={`${SIGN} mt-1 text-2xl`}>Résumé</p>
          <p className="mt-1 text-[12px] opacity-85">Admit one reader · valid everywhere</p>
          <ResumeActions className="mt-4" button="rounded-full bg-black/25 px-3 py-1.5 text-[12px] font-bold text-white backdrop-blur transition hover:bg-black/40" />
        </div>
        <div className="rounded-2xl border-l-[8px] border-y border-r border-[var(--d-line)] bg-[var(--d-bg2)] p-5" style={{ borderLeftColor: "var(--d-b)" }}>
          <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-[var(--d-b)]">BRANCH LINE · SINCE {PROJECT.since.toUpperCase()}</p>
          <p className={`${SIGN} mt-1 text-2xl`}>{PROJECT.name}</p>
          <p className="mt-1 text-[15px] font-semibold text-[var(--d-b2)]">“{PROJECT.slogan}”</p>
          <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--d-ink4)]">{PROJECT.pitch}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-[12px] font-bold">
            <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className="rounded-full px-3 py-1.5 text-[var(--d-on)]" style={{ background: "var(--d-b)" }}>
              Ride it ↗
            </a>
            <a href={PROJECT.code} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[var(--d-line2)] px-3 py-1.5 text-[var(--d-ink2)]">
              Code ↗
            </a>
          </div>
          <p className="mt-3 text-[11px] text-[var(--d-ink6)]">{PROJECT.honesty}</p>
        </div>
        <div className="rounded-2xl border-l-[8px] border-y border-r border-[var(--d-line)] bg-[var(--d-bg2)] p-5" style={{ borderLeftColor: "var(--d-c)" }}>
          <p className="font-mono text-[10px] font-bold tracking-[0.3em] text-[var(--d-c)]">COMMUNITY LINE</p>
          <ol className="mt-3 space-y-3">
            {VOLUNTEERING.map((v) => (
              <li key={v.org} className="flex gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full border-[3px] bg-[var(--d-bg)]" style={{ borderColor: "var(--d-c)" }} />
                <p className="text-[12.5px] leading-relaxed text-[var(--d-ink3)]">
                  <span className="font-bold text-[var(--d-ink)]">{v.org}</span> — {v.what}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── The line runs on ─────────────────────────────────────────── */}
      <section className="mt-20 text-center">
        <div aria-hidden className="mx-auto h-24 w-[10px] rounded-full" style={{ background: "repeating-linear-gradient(var(--d-a) 0 14px, transparent 14px 26px)" }} />
        <p className={`${SIGN} mt-6 text-[clamp(1.8rem,6vw,3.6rem)] leading-none`}>Every line leads somewhere.</p>
        <p className="mt-3 font-mono text-[11px] tracking-[0.2em] text-[var(--d-ink5)]">THIS ONE ISN’T FINISHED · {exp ? `DAY ${exp.dayNumber.toLocaleString("en-US")}` : ""}</p>
      </section>
    </main>
  );
}
