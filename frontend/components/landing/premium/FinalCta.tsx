"use client";

// The closing scene: gold dissolves into dawn over the city — and the ask.

import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import CineMedia from "./CineMedia";
import { btnGhost, btnPrimary, Magnetic } from "./bits";

export default function FinalCta() {
  return (
    <section className="mise-cv-screen relative flex min-h-[92vh] items-center overflow-hidden">
      <CineMedia still="dawn" preStill="gold" videos={["gold-to-dawn"]} dim={0.3} />
      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-28 text-center sm:px-10">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.4em] text-copper-200/90 sm:text-xs">YOUR TURN</p>
        </Reveal>
        <Reveal delay={110}>
          <h2 className="mt-5 font-display text-5xl leading-[1.04] tracking-tight text-white drop-shadow-[0_2px_30px_rgba(0,0,0,0.7)] sm:text-7xl">
            Bring order to the house.
          </h2>
        </Reveal>
        <Reveal delay={220}>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-100/90 drop-shadow sm:text-lg">
            Every plate, every penny, in its place. Set up your hotel in minutes — Copilot can even
            import your stock list and P&amp;L from a PDF.
          </p>
        </Reveal>
        <Reveal delay={330}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Magnetic>
              <Link href="/signup" className={`${btnPrimary} px-8 py-4`}>
                Register your hotel
              </Link>
            </Magnetic>
            <Magnetic>
              <Link href="/login" className={btnGhost}>
                Sign in
              </Link>
            </Magnetic>
          </div>
          <p className="mt-5 font-mono text-xs text-slate-300/80 drop-shadow">
            No card required · free to start · cancel anytime
          </p>
        </Reveal>
      </div>
    </section>
  );
}
