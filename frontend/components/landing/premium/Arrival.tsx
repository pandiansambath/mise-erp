"use client";

// The payoff scene, right before pricing: the plated dish becomes the glowing
// restaurant, the restaurant becomes a full candlelit room — what a house in
// order looks like. Two chained films settling on the dining-room still.

import { Reveal } from "@/components/Reveal";
import CineMedia from "./CineMedia";

export default function Arrival() {
  return (
    <section className="mise-cv-screen relative flex min-h-[92vh] items-center overflow-hidden">
      <CineMedia still="table" preStill="dish" videos={["dish-to-restaurant", "restaurant-to-table"]} dim={0.34} />
      <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-24 text-center sm:px-10">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.4em] text-copper-200/90 sm:text-xs">06 · THE PAYOFF</p>
        </Reveal>
        <Reveal delay={110}>
          <h2 className="mt-5 font-display text-4xl leading-[1.05] tracking-tight text-white drop-shadow-[0_2px_28px_rgba(0,0,0,0.65)] sm:text-6xl">
            Full tables.
            <span className="block">Open books.</span>
          </h2>
        </Reveal>
        <Reveal delay={220}>
          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-slate-200/90 drop-shadow sm:text-lg">
            This is what a house in order looks like — every plate a promise you can afford to
            keep, and you keep what you earned.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
