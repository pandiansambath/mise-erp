"use client";

// Three cards under the skills: what he has been recognised for, what he
// builds outside work, and how he recharges.
//
// They sit below the first screen, so they are born as they scroll in
// (`dev-reborn`, the scroll-driven growth in globals.css) instead of fading up
// on entry, where nobody would be looking. Browsers without scroll timelines
// simply show them.

import { PROJECT, RECOGNITION, VOLUNTEERING } from "@/dev/profile";
import { SectionHead } from "@/dev/SectionHead";

const CARD =
  "dev-reborn group relative w-full overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4 backdrop-blur-sm transition-colors duration-500 hover:border-white/[0.14] sm:p-5";

const GOLD = "#f0bd6a";
const EMERALD = "#34d399";
const SKY = "#7dd3fc";

/** A wash in the card's own colour, so the cards tell apart at a glance
 *  without shouting — the same device the skill cards use. */
function Wash({ hue, left = false }: { hue: string; left?: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute -top-16 h-40 w-40 rounded-full opacity-[0.12] blur-3xl transition-opacity duration-500 group-hover:opacity-[0.22] ${
        left ? "-left-16" : "-right-16"
      }`}
      style={{ background: hue }}
    />
  );
}

export function Recognition() {
  return (
    <section className={CARD}>
      <Wash hue={GOLD} left />
      <SectionHead glyph="★" label="Recognition" hue={GOLD} aside={RECOGNITION.length} />

      <p className="relative mt-3 inline-flex items-center gap-2 rounded-full border border-[#2dd4bf]/30 bg-[#2dd4bf]/[0.07] px-3 py-1 font-mono text-[10.5px] tracking-[0.12em] text-[#7df0dc]">
        <span aria-hidden>↑</span>
        PROMOTED TWICE IN TWO YEARS
      </p>

      {/* A timeline in the chain's colours: copper where it starts, teal
          where it has got to. */}
      <div className="relative mt-4">
        <span
          aria-hidden
          className="absolute bottom-2 left-[7px] top-2 w-px"
          style={{ background: "linear-gradient(180deg, #d97742, #2dd4bf)" }}
        />
        <ol className="space-y-4 pl-7">
          {RECOGNITION.map((m) => (
            <li key={m.title} className="relative">
              <span
                aria-hidden
                className={`absolute -left-7 top-[3px] grid h-[15px] w-[15px] place-items-center rounded-full border ${
                  m.gold ? "border-[#f0bd6a] bg-[#3a2410]" : "border-white/20 bg-[#0b1118]"
                }`}
              >
                <span className={`h-[5px] w-[5px] rounded-full ${m.gold ? "bg-[#ffd27a]" : "bg-[#7d93ad]"}`} />
              </span>
              <p className="font-mono text-[10px] tracking-[0.2em] text-[#5b6e85]">{m.when.toUpperCase()}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold leading-snug">
                {m.gold ? (
                  <>
                    <span aria-hidden className="dev-medal text-sm">
                      🏅
                    </span>
                    <span className="dev-gold">{m.title}</span>
                  </>
                ) : (
                  <span className="text-[#e6edf5]">{m.title}</span>
                )}
                {m.promoted && (
                  <span className="rounded-full border border-[#2dd4bf]/30 bg-[#2dd4bf]/[0.07] px-2 py-0.5 font-mono text-[9.5px] font-normal tracking-[0.1em] text-[#7df0dc]">
                    PROMOTED · {m.promoted.toUpperCase()}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[#7d93ad]">{m.note}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Live() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[#34d399]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[#34d399] opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[#34d399]" />
      </span>
      LIVE
    </span>
  );
}

const LINK_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-[#071016] shadow-[0_8px_24px_-10px_rgba(52,211,153,.7)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110";
const LINK_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] bg-black/20 px-3 py-1.5 font-mono text-[11px] text-[#c3d3e4] transition duration-300 hover:-translate-y-0.5 hover:border-[#34d399]/40 hover:text-white";

export function SideProject() {
  const p = PROJECT;
  return (
    <section className={CARD}>
      <Wash hue={EMERALD} />
      <SectionHead glyph="◆" label="Built outside work" hue={EMERALD} aside={<Live />} />

      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-xl font-semibold tracking-tight text-[#e6edf5]">{p.name}</h4>
        <a
          href={p.site}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-[#6ee7b7] underline-offset-4 hover:underline"
        >
          dineai.cloud ↗
        </a>
      </div>

      {/* The question the product answers, in the page's two colours. */}
      <p
        className="relative mt-1.5 text-[17px] font-semibold leading-snug"
        style={{
          background: "linear-gradient(90deg, #f0a064, #2dd4bf)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        “{p.slogan}”
      </p>
      <p className="relative mt-2 text-[12.5px] leading-relaxed text-[#a9bdd2]">{p.pitch}</p>
      <p className="relative mt-2 text-[12px] text-[#7d93ad]">
        In use at{" "}
        <a
          href={p.inUse.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#c3d3e4] underline-offset-4 transition hover:text-white hover:underline"
        >
          {p.inUse.label} ↗
        </a>
      </p>

      <ul className="relative mt-3 flex flex-wrap gap-1.5">
        {p.stack.map((s) => (
          <li
            key={s}
            className="rounded-lg border px-2.5 py-1 font-mono text-[11px] text-[#c3d3e4]"
            style={{ borderColor: `${EMERALD}2e`, background: `${EMERALD}0f` }}
          >
            {s}
          </li>
        ))}
      </ul>

      <p className="relative mt-3 text-[11px] leading-relaxed text-[#5b6e85]">{p.honesty}</p>

      <div className="relative mt-3.5 flex flex-wrap gap-2">
        <a
          href={p.site}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_PRIMARY}
          style={{ background: "linear-gradient(90deg, #34d399, #2dd4bf)" }}
        >
          Visit dineai.cloud <span aria-hidden>↗</span>
        </a>
        <a href={p.code} target="_blank" rel="noopener noreferrer" className={LINK_SECONDARY}>
          Code on GitHub <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}

export function Volunteering() {
  return (
    <section className={CARD}>
      <Wash hue={SKY} />
      <SectionHead glyph="♡" label="Volunteering" hue={SKY} aside="HOW I RECHARGE" />
      <ul className="relative mt-3 space-y-3">
        {VOLUNTEERING.map((v) => (
          <li key={v.org} className="flex gap-3">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SKY }} />
            <p className="text-[12.5px] leading-relaxed text-[#a9bdd2]">
              <span className="font-semibold text-[#e6edf5]">{v.org}</span> — {v.what}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
