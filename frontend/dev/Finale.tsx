"use client";

// The end of the page: life moving like a chain.
//
//   "chain rotation movement to show that life doesn't stop, it moves like a
//    chain, with a small slogan"
//
// A ring of real metal links drawn in 3D around the slogan (ChainRing). It
// gathers link by link as you scroll in, closes with a flash, then turns; the
// slogan's words arrive once it has closed. The count under it is real: the
// days since his first day, one link each. Reduced motion: closed and still.

import { memo, useState } from "react";
import { PROJECT } from "@/dev/profile";
import { ChainRing } from "./ChainRing";

const LINE_1 = ["Life", "doesn’t", "stop."];
const LINE_2 = ["It", "moves", "like", "a", "chain."];
const STATEMENT =
  "You don’t need to remember everything. It’s a chain — the right link comes back at the right time. Just keep learning.";

const PRIMARY =
  "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-semibold text-[var(--d-on)] shadow-[0_10px_30px_-12px_color-mix(in_srgb,_var(--d-b)_80%,_transparent)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110";
const SECONDARY =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] px-4 py-2 font-mono text-[12px] text-[var(--d-ink2)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--d-b)]/50 hover:text-[var(--d-ink)]";

// Memoised: `days` changes once a day, the page's clock every second.
export const Finale = memo(function Finale({ days, onResume }: { days: number | null; onResume?: () => void }) {
  const [closed, setClosed] = useState(false);
  return (
    <section className="dev-reborn relative mt-20 w-full overflow-hidden rounded-[2rem] border border-[var(--d-line)] bg-[var(--d-glass)] px-5 pb-10 pt-12 text-center backdrop-blur-sm sm:mt-28 sm:px-10 sm:pb-12 sm:pt-16">
      {/* Light behind the ring, in the chain's two colours. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[44%] h-[60%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[80px]"
        style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--d-a) 55%, transparent), color-mix(in srgb, var(--d-b) 35%, transparent) 60%, transparent)" }}
      />

      <p className="relative font-mono text-[10px] tracking-[0.34em] text-[var(--d-a)]">THE CHAIN KEEPS MOVING</p>

      {/* The chain gathers as you scroll in, closes with a flash, then turns;
          the slogan's words arrive one by one once it has closed. */}
      <div className="relative mt-6 sm:mt-8">
        <ChainRing onAssembled={() => setClosed(true)}>
          <h2 className="font-display text-[clamp(1.25rem,5vw,3.5rem)] font-semibold leading-[1.1] tracking-tight">
            <span className="block text-[var(--d-ink)]">
              {LINE_1.map((word, i) => (
                <Word key={word} word={word} on={closed} delay={i * 0.09} />
              ))}
            </span>
            <span className="block">
              {LINE_2.map((word, i) => (
                <Word key={word} word={word} on={closed} delay={0.3 + i * 0.09} gradient />
              ))}
            </span>
          </h2>
        </ChainRing>
        {/* His line, under the ring on every screen: inside it, the front
            links crossed the words whenever the ring tilted. */}
        <p
          className="relative mx-auto mt-3 max-w-xs px-2 text-center text-[12.5px] italic leading-relaxed text-[var(--d-ink2)] transition-all duration-1000 sm:mt-1 sm:max-w-lg sm:text-[15px]"
          style={{ opacity: closed ? 1 : 0, transform: closed ? "none" : "translateY(8px)", transitionDelay: closed ? "1s" : "0s" }}
        >
          <span aria-hidden className="mr-1 font-display text-[1.6em] not-italic leading-none text-[var(--d-a)] align-[-0.3em]">“</span>
          {STATEMENT}
          <span aria-hidden className="ml-1 font-display text-[1.6em] not-italic leading-none text-[var(--d-b)] align-[-0.3em]">”</span>
        </p>
      </div>

      <p className="relative mx-auto mt-8 max-w-md text-[14px] leading-relaxed text-[var(--d-ink3)] sm:mt-10">
        One link at a time. Every day is a link, and the chain is still being made.
      </p>
      <p className="relative mt-2 font-mono text-[11px] tabular-nums tracking-[0.2em] text-[var(--d-ink4)]">
        {days ? (
          <>
            DAY {days.toLocaleString("en-US")} OF MINE · <span className="whitespace-nowrap">AND COUNTING</span>
          </>
        ) : (
          " "
        )}
      </p>

      <div className="relative mt-7 flex flex-wrap justify-center gap-2.5">
        <a
          href="mailto:pandian.s.sambath@gmail.com"
          className={PRIMARY}
          style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }}
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

      <p className="relative mt-10 text-balance font-mono text-[10px] leading-relaxed tracking-[0.16em] text-[var(--d-ink4)]">
        © {new Date().getFullYear()} PANDIAN SAMBATH <span className="whitespace-nowrap">· CHENNAI, INDIA</span>
        <span className="mt-1 block text-balance text-[var(--d-ink5)]">THIS PAGE WAS BUILT WITH <span className="whitespace-nowrap">AI-ASSISTED</span> DEVELOPMENT</span>
      </p>
    </section>
  );
});

/** One word of the slogan: hidden until the chain closes, then rising into place. */
function Word({ word, on, delay, gradient = false }: { word: string; on: boolean; delay: number; gradient?: boolean }) {
  return (
    <span
      className="mr-[0.25em] inline-block transition-[opacity,transform,filter] duration-700 ease-out last:mr-0"
      style={{
        opacity: on ? 1 : 0,
        transform: on ? "none" : "translateY(0.45em) scale(.96)",
        filter: on ? "none" : "blur(6px)",
        transitionDelay: on ? `${delay}s` : "0s",
        ...(gradient
          ? {
              background: "linear-gradient(90deg, var(--d-a2), var(--d-gold) 50%, var(--d-b))",
              backgroundSize: "260% 100%",
              backgroundPosition: `${(delay - 0.3) * 160}% 0`,
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }
          : {}),
      }}
    >
      {word}
    </span>
  );
}
