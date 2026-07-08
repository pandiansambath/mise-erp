"use client";

// Operator voices over the spice-mandala cinematic. The middle card carries
// the AURUM exterior — the "restaurant that runs on Mise".

import { Reveal } from "@/components/Reveal";
import { SectionHead } from "./bits";

const VOICES = [
  {
    quote:
      "We found £700 a month hiding in six recipes. Mise paid for itself inside the first week.",
    name: "Priya N.",
    role: "Owner · The Saffron House",
    img: null,
  },
  {
    quote:
      "Rota, attendance and payroll finally agree with each other. My Sunday nights are mine again.",
    name: "Marco B.",
    role: "General Manager · AURUM",
    img: "/experience/restaurant.jpg",
  },
  {
    quote:
      "I ask the Copilot why food cost moved and it answers with the exact vendor and the exact dish.",
    name: "Dan W.",
    role: "Head Chef · Fable & Fern",
    img: null,
  },
];

export default function Testimonials() {
  return (
    <section className="relative overflow-hidden border-t border-white/5">
      <img
        src="/experience/garden.jpg"
        alt=""
        loading="lazy"
        className="absolute inset-0 h-full w-full object-cover opacity-[0.16]"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950 via-ink-950/80 to-ink-950" />

      <div className="relative mx-auto max-w-6xl px-6 py-24 sm:px-10 sm:py-32">
        <Reveal>
          <SectionHead
            kicker="OPERATORS"
            title={
              <>
                Run by people <em className="mise-hero-text not-italic">who run the pass.</em>
              </>
            }
          />
        </Reveal>
        <div className="mt-14 grid items-stretch gap-5 lg:grid-cols-3">
          {VOICES.map((v, i) => (
            <Reveal key={v.name} delay={i * 110}>
              <figure className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900/80 backdrop-blur transition duration-300 hover:-translate-y-1.5 hover:border-copper-400/35">
                {v.img ? (
                  <div className="relative h-40 overflow-hidden">
                    <img
                      src={v.img}
                      alt={v.role}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-900 to-transparent" />
                  </div>
                ) : null}
                <div className="flex flex-1 flex-col p-6">
                  <p className="font-mono text-sm tracking-widest text-copper-300">★★★★★</p>
                  <blockquote className="mt-3.5 flex-1 font-display text-xl leading-snug text-slate-100">
                    “{v.quote}”
                  </blockquote>
                  <figcaption className="mt-5 border-t border-white/5 pt-4">
                    <p className="text-sm font-semibold text-white">{v.name}</p>
                    <p className="text-[12px] text-slate-500">{v.role}</p>
                  </figcaption>
                </div>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
