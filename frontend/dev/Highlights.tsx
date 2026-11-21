"use client";

// Three cards under the skills: what he has been recognised for, what he
// builds outside work, and how he recharges.
//
// They sit below the first screen, so they are born as they scroll in
// (`dev-reborn`, the scroll-driven growth in globals.css) instead of fading up
// on entry, where nobody would be looking. Browsers without scroll timelines
// simply show them.

import { honours, PROJECT, VOLUNTEERING } from "@/dev/profile";
import { useDev } from "./context";
import { SectionHead } from "@/dev/SectionHead";

const CARD =
  "dev-reborn dev-card group relative w-full overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-4 backdrop-blur-sm transition-colors duration-500 hover:border-[var(--d-line2)] sm:p-5";

const GOLD = "var(--d-gold)";
const EMERALD = "var(--d-b)";
// Periwinkle: the résumé card took sky.
const SKY = "var(--d-c)";

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
  // The same list the month blocks show, so an entry he adds there lands here.
  const list = honours(useDev().milestones);
  const promotions = list.filter((m) => m.kind === "promotion").length;
  return (
    <section data-link className={CARD}>
      <Wash hue={GOLD} left />
      <SectionHead glyph="★" label="Recognition" hue={GOLD} aside={list.length} />

      <p className="relative mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--d-b)]/30 bg-[var(--d-b)]/[0.07] px-3 py-1 font-mono text-[10.5px] tracking-[0.12em] text-[var(--d-b2)]">
        <span aria-hidden>↑</span>
        {promotions === 2 ? "PROMOTED TWICE IN TWO YEARS" : `PROMOTED ${promotions} TIMES SINCE 2024`}
      </p>

      {/* A timeline in the chain's colours: copper where it starts, teal
          where it has got to. */}
      <div className="relative mt-4">
        <span
          aria-hidden
          className="absolute bottom-2 left-[7px] top-2 w-px"
          style={{ background: "linear-gradient(180deg, var(--d-a), var(--d-b))" }}
        />
        <ol className="space-y-4 pl-7">
          {list.map((m) => (
            <li key={`${m.when}-${m.title}`} className="relative">
              <span
                aria-hidden
                className={`absolute -left-7 top-[3px] grid h-[15px] w-[15px] place-items-center rounded-full border ${
                  m.kind === "recognition" ? "border-[var(--d-gold)] bg-[#3a2410]" : "border-[var(--d-line2)] bg-[var(--d-bg2)]"
                }`}
              >
                <span className={`h-[5px] w-[5px] rounded-full ${m.kind === "recognition" ? "bg-[var(--d-gold)]" : "bg-[var(--d-ink4)]"}`} />
              </span>
              <p className="font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink5)]">{m.when.toUpperCase()}</p>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold leading-snug">
                {m.kind === "recognition" ? (
                  <>
                    <span aria-hidden className="dev-medal text-sm">
                      🏅
                    </span>
                    <span className="dev-gold">{m.title}</span>
                  </>
                ) : (
                  <span className="text-[var(--d-ink)]">{m.title}</span>
                )}
                {m.promoted && (
                  <span className="rounded-full border border-[var(--d-b)]/30 bg-[var(--d-b)]/[0.07] px-2 py-0.5 font-mono text-[9.5px] font-normal tracking-[0.1em] text-[var(--d-b2)]">
                    PROMOTED · {m.promoted.toUpperCase()}
                  </span>
                )}
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-[var(--d-ink4)]">{m.note}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Live() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--d-b)]">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--d-b)] opacity-60 motion-safe:animate-ping" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--d-b)]" />
      </span>
      LIVE
    </span>
  );
}

const LINK_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-[var(--d-on)] shadow-[0_8px_24px_-10px_color-mix(in_srgb,_var(--d-b)_70%,_transparent)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110";
const LINK_SECONDARY =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--d-line)] bg-[var(--d-shade)] px-3 py-1.5 font-mono text-[11px] text-[var(--d-ink2)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--d-b)]/40 hover:text-[var(--d-ink)]";

export function SideProject() {
  const p = PROJECT;
  return (
    <section data-link className={CARD}>
      <Wash hue={EMERALD} />
      <SectionHead glyph="◆" label="Built outside work" hue={EMERALD} aside={<Live />} />

      <div className="relative mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="text-xl font-semibold tracking-tight text-[var(--d-ink)]">{p.name}</h4>
        <a
          href={p.site}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-[var(--d-b2)] underline-offset-4 hover:underline"
        >
          dineai.cloud ↗
        </a>
      </div>

      {/* The question the product answers, in the page's two colours. */}
      <p
        className="relative mt-1.5 text-[17px] font-semibold leading-snug"
        style={{
          background: "linear-gradient(90deg, var(--d-a2), var(--d-b))",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        “{p.slogan}”
      </p>
      <p className="relative mt-2 text-[12.5px] leading-relaxed text-[var(--d-ink3)]">{p.pitch}</p>
      <p className="relative mt-2 text-[12px] text-[var(--d-ink4)]">
        In use at{" "}
        <a
          href={p.inUse.href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--d-ink2)] underline-offset-4 transition hover:text-[var(--d-ink)] hover:underline"
        >
          {p.inUse.label} ↗
        </a>
      </p>

      <ul className="relative mt-3 flex flex-wrap gap-1.5">
        {p.stack.map((s) => (
          <li
            key={s}
            className="rounded-lg border px-2.5 py-1 font-mono text-[11px] text-[var(--d-ink2)]"
            style={{ borderColor: `color-mix(in srgb, ${EMERALD} 18%, transparent)`, background: `color-mix(in srgb, ${EMERALD} 6%, transparent)` }}
          >
            {s}
          </li>
        ))}
      </ul>

      <p className="relative mt-3 text-[11px] leading-relaxed text-[var(--d-ink5)]">{p.honesty}</p>

      <div className="relative mt-3.5 flex flex-wrap gap-2">
        <a
          href={p.site}
          target="_blank"
          rel="noopener noreferrer"
          className={LINK_PRIMARY}
          style={{ background: "linear-gradient(90deg, var(--d-b), var(--d-b))" }}
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
    <section data-link className={CARD}>
      <Wash hue={SKY} />
      <SectionHead glyph="♡" label="Volunteering" hue={SKY} aside="HOW I RECHARGE" />
      <ul className="relative mt-3 space-y-3">
        {VOLUNTEERING.map((v) => (
          <li key={v.org} className="flex gap-3">
            <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SKY }} />
            <p className="text-[12.5px] leading-relaxed text-[var(--d-ink3)]">
              <span className="font-semibold text-[var(--d-ink)]">{v.org}</span> — {v.what}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
