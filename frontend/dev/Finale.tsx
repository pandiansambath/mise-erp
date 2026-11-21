"use client";

// The end of the page: life moving like a chain.
//
//   "chain rotation movement to show that life doesn't stop, it moves like a
//    chain, with a small slogan"
//
// A ring of interlocking links, tilted like a planet's ring and turning
// slowly around the slogan. Alternate links stand at right angles to their
// neighbours — the one detail that makes a ring of ovals read as a CHAIN. The
// count under it is real: the days since his first day, one link each.
//
// Pure CSS 3D (globals.css: devRing). Reduced motion keeps the ring, still.

import { memo } from "react";
import { PROJECT } from "@/dev/profile";

const LINKS = 40;
const COPPER = [217, 119, 66];
const TEAL = [45, 212, 191];

/** Copper at the front of the ring, teal at the back, blended between. */
function hueAt(i: number) {
  const t = (1 - Math.cos((i / LINKS) * Math.PI * 2)) / 2;
  const c = COPPER.map((v, k) => Math.round(v + (TEAL[k] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-[#071016] shadow-[0_10px_30px_-12px_rgba(45,212,191,.8)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110";
const SECONDARY =
  "inline-flex items-center gap-1.5 rounded-full border border-white/[0.12] bg-black/25 px-4 py-2 font-mono text-[12px] text-[#c3d3e4] transition duration-300 hover:-translate-y-0.5 hover:border-[#2dd4bf]/50 hover:text-white";

// Memoised: `days` changes once a day, the page's clock every second.
export const Finale = memo(function Finale({ days, onResume }: { days: number | null; onResume?: () => void }) {
  return (
    <section className="dev-reborn relative mt-20 w-full overflow-hidden rounded-[2rem] border border-white/[0.07] bg-white/[0.015] px-5 pb-10 pt-12 text-center backdrop-blur-sm sm:mt-28 sm:px-10 sm:pb-12 sm:pt-16">
      {/* Light behind the ring, in the chain's two colours. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[44%] h-[60%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[80px]"
        style={{ background: "radial-gradient(closest-side, rgba(217,119,66,.55), rgba(45,212,191,.35) 60%, transparent)" }}
      />

      <p className="relative font-mono text-[10px] tracking-[0.34em] text-[#d97742]">THE CHAIN KEEPS MOVING</p>

      <div
        className="relative mx-auto mt-8 grid place-items-center [--R:clamp(130px,38vw,290px)] sm:mt-10"
        style={{ perspective: "1000px", minHeight: "calc(var(--R) * 0.95)" }}
      >
        {/* The ring. */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-0 w-0"
          style={{
            transformStyle: "preserve-3d",
            transform: "rotateX(66deg)",
            animation: "devRing 40s linear infinite",
          }}
        >
          {Array.from({ length: LINKS }, (_, i) => {
            const angle = (360 / LINKS) * i;
            const hue = hueAt(i);
            return (
              <span
                key={i}
                className="absolute left-0 top-0 rounded-full"
                style={{
                  width: "calc(var(--R) * 0.17)",
                  height: "calc(var(--R) * 0.068)",
                  marginLeft: "calc(var(--R) * -0.085)",
                  marginTop: "calc(var(--R) * -0.034)",
                  border: `max(2px, calc(var(--R) * 0.012)) solid ${hue}`,
                  transform: `rotateZ(${angle}deg) translateY(calc(var(--R) * -1)) ${i % 2 ? "rotateX(90deg)" : ""}`,
                }}
              />
            );
          })}
        </div>

        <h2 className="relative z-10 font-display text-[clamp(1.75rem,6vw,3.6rem)] font-semibold leading-[1.1] tracking-tight">
          <span className="block text-[#e6edf5]">Life doesn’t stop.</span>
          <span
            className="block"
            style={{
              background: "linear-gradient(90deg, #f0a064, #f0bd6a 40%, #2dd4bf)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            It moves like a chain.
          </span>
        </h2>
      </div>

      <p className="relative mx-auto mt-8 max-w-md text-[14px] leading-relaxed text-[#a9bdd2] sm:mt-10">
        One link at a time. Every day is a link, and the chain is still being made.
      </p>
      <p className="relative mt-2 font-mono text-[11px] tabular-nums tracking-[0.2em] text-[#5b6e85]">
        {days ? `DAY ${days.toLocaleString("en-US")} OF MINE · AND COUNTING` : " "}
      </p>

      <div className="relative mt-7 flex flex-wrap justify-center gap-2.5">
        <a
          href="mailto:pandian.s.sambath@gmail.com"
          className={PRIMARY}
          style={{ background: "linear-gradient(90deg, #f0a064, #2dd4bf)" }}
        >
          Say hello <span aria-hidden>→</span>
        </a>
        <a href="https://www.linkedin.com/in/pandiansambath" target="_blank" rel="noopener noreferrer" className={SECONDARY}>
          LinkedIn <span aria-hidden>↗</span>
        </a>
        {onResume && (
          <button type="button" onClick={onResume} className={SECONDARY}>
            View résumé
          </button>
        )}
        <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className={SECONDARY}>
          DineAI <span aria-hidden>↗</span>
        </a>
      </div>

      <p className="relative mt-10 font-mono text-[10px] leading-relaxed tracking-[0.16em] text-[#3f4f61]">
        © {new Date().getFullYear()} PANDIAN SAMBATH · CHENNAI, INDIA
        <span className="mt-1 block text-[#334152]">THIS PAGE WAS BUILT WITH AI-ASSISTED DEVELOPMENT</span>
      </p>
    </section>
  );
});
