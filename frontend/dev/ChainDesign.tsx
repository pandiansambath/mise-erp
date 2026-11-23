"use client";

// Design 1 of 5: Chain Reaction — the original, and the default.
//
// Left: who he is, and the solar system of his skills around his portrait —
// pinned the whole way down, because it is the page's centrepiece. Right: the live
// counter with its chain of months, the résumé, skills, education,
// recognition, what he builds, how he recharges — every card born small and
// growing as it scrolls in, a chain spine beside them lighting card by card.
// At the end, the chain itself gathers round the slogan.

import { ChainField } from "./ChainField";
import { ChainSpine } from "./ChainSpine";
import { CAREER_START, chennaiTime, elapsed, useDev, useNow } from "./context";
import { nameLook, word } from "./copy";
import { DecryptText } from "./DecryptText";
import { DustField } from "./DustField";
import { Finale } from "./Finale";
import { Recognition, SideProject, Volunteering } from "./Highlights";
import { MonthChain } from "./MonthChain";
import { ResumeCard } from "./Resume";
import { SkillClusters } from "./SkillClusters";
import { SkillDrift } from "./SkillDrift";
import { SkillOrbit } from "./SkillOrbit";
import { Terminal } from "./Terminal";
import { useRef } from "react";
import { CardChrome, Wave } from "./flourish";
import { SectionHead } from "./SectionHead";

// `backwards`: held at its first frame while it waits, nothing kept after —
// a `both` fill kept these blocks (the orbit among them, 8.5 MB on a phone)
// as GPU layers for the life of the page (22 Nov).
const fade = (entered: boolean, delay: number) =>
  entered ? { animation: `devFadeUp .8s ${delay}s ease-out backwards` } : { opacity: 0 };

/** His name, set like a nameplate.
 *
 *  "my name and company looks raw… there we already have one unique thing
 *   like if I place cursor word will fastly scramble… also color and font"
 *
 *  The scramble stays (hover the name). Around it: a greeting, the name in
 *  the display serif with a slow metallic light crossing it, a line drawing
 *  itself under it in the theme's colours, the role and company as one
 *  confident line, and the time in Chennai, live. */
function Nameplate({ entered }: { entered: boolean }) {
  const now = useNow();
  // His words and his name's look (the Template).
  const { copy } = useDev();
  const name = word(copy, "name");
  const look = nameLook(copy.style);
  return (
    <div className="w-full text-center lg:text-left">
      <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--d-a)]" style={fade(entered, 0.05)}>
        {word(copy, "hello")}
      </p>
      {/* data-hero-name: the top bar shows his name only while this is off
          screen. data-noswell: the name has its own hover (the scramble). */}
      <h1
        data-hero-name
        data-noswell
        className={`mt-2 ${look.fontClass} text-[clamp(2.4rem,6vw,3.9rem)] font-semibold leading-[1.02] tracking-tight`}
        style={fade(entered, 0.1)}
      >
        {entered ? (
          <DecryptText key={name} text={name} delay={420} replayOnHover textClassName={look.colorClass} textStyle={look.colorStyle} />
        ) : (
          <span className={look.colorClass} style={look.colorStyle}>
            {name}
          </span>
        )}
      </h1>
      <span
        aria-hidden
        className="mx-auto mt-3 block h-[2px] origin-left rounded-full lg:mx-0"
        style={{
          width: "min(320px, 70%)",
          background: "linear-gradient(90deg, var(--d-a), var(--d-gold), var(--d-b), transparent)",
          transform: entered ? "scaleX(1)" : "scaleX(0)",
          transition: "transform 1.4s cubic-bezier(.2,.8,.2,1) .6s",
        }}
      />
      <p
        className="mt-4 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[15px] lg:justify-start"
        style={fade(entered, 0.2)}
      >
        <Wave text={word(copy, "role")} className="font-semibold text-[var(--d-ink)]" />
        <span className="text-[var(--d-ink6)]">{word(copy, "at")}</span>
        <Wave text={word(copy, "company")} className="font-semibold" style={{ color: "var(--d-a2)" }} />
      </p>
      <p
        className="mt-2 flex flex-wrap items-center justify-center gap-x-3 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)] lg:justify-start"
        style={fade(entered, 0.28)}
      >
        <span>{word(copy, "place")}</span>
        <span aria-hidden className="text-[var(--d-ink7)]">·</span>
        <span className="tabular-nums text-[var(--d-ink4)]">{now ? `${chennaiTime(now)} IST` : " "}</span>
      </p>
    </div>
  );
}

/** The time card: the one block on this page that changes every second, so
 *  it alone reads the clock (useNow) and re-renders on the tick. */
function TimeCard({ entered }: { entered: boolean }) {
  const now = useNow();
  const { copy } = useDev();
  const exp = now ? elapsed(CAREER_START, now) : null;
  return (
  <div
    data-link="first"
    className="dev-reborn dev-card group relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-5 backdrop-blur-sm lg:max-w-none"
  >
    <CardChrome />
    <p className="text-center font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">
      <Wave text={word(copy, "timeTitle")} />
    </p>
    <div aria-hidden className="mx-auto mt-2 h-px w-24" style={{ background: "linear-gradient(90deg, transparent, var(--d-a), var(--d-b), transparent)" }} />
    <p className="mt-2 text-center text-5xl font-semibold tabular-nums tracking-tight">
      <span
        style={{
          background: "linear-gradient(180deg, var(--d-ink), var(--d-ink3))",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {exp ? exp.decimal : "—"}
      </span>
      <span className="ml-2 text-base font-normal text-[var(--d-ink5)]">years</span>
    </p>
    <div className="mt-4 grid grid-cols-3 gap-2 text-center">
      {(
        [
          ["YEARS", exp?.years],
          ["MONTHS", exp?.months],
          ["DAYS", exp?.days],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="rounded-xl border border-[var(--d-line)] bg-[var(--d-shade)] py-2.5">
          <p className="font-mono text-[9px] tracking-[0.2em] text-[var(--d-ink6)]">{label}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-[var(--d-ink)]">{value ?? "—"}</p>
        </div>
      ))}
    </div>
    {now && <MonthChain start={CAREER_START} now={now} play={entered} />}
    <p className="mt-3 text-center font-mono text-[10px] tabular-nums tracking-[0.18em] text-[var(--d-ink7)]">
      {exp
        ? `+ ${String(exp.hours).padStart(2, "0")}:${String(exp.minutes).padStart(2, "0")}:${String(exp.seconds).padStart(2, "0")} AND COUNTING`
        : "SYNCING…"}
    </p>
  </div>
  );
}

function LiveTerminal({ onAlbum, onResume }: { onAlbum: () => void; onResume?: () => void }) {
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  return <Terminal onAlbum={onAlbum} onResume={onResume} experience={exp ? exp.decimal : "2"} />;
}

function LiveFinale({ onResume }: { onResume?: () => void }) {
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  return <Finale days={exp ? exp.dayNumber : null} onResume={onResume} />;
}

export function ChainDesign() {
  // No clock here: the whole page used to re-render on every tick.
  const { entered, resume, openAlbum, openResume, portraits } = useDev();
  const column = useRef<HTMLElement>(null);
  const terminal = <LiveTerminal onAlbum={openAlbum} onResume={resume ? openResume : undefined} />;

  return (
    <>
      <ChainField intensity={entered ? 1 : 0.35} />
      {/* The room: the watercolour, fine dust that zooms in as you scroll and
          ripples from the pointer — and, painted in the same canvas, the
          accents bleeding in from the corners, the drifting blooms, the waves,
          the vignette and the dot grid. Each of those used to be a full-screen
          layer of its own: ~100 MB of GPU memory on a phone, which is what made
          the orbit's chips go black after a scroll (22 Nov). */}
      <DustField decor />
      <SkillDrift grid={false} />

      <main
        className={`relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center px-5 pb-12 pt-24 transition-all duration-700 sm:px-6 sm:pb-16 sm:pt-28 lg:max-w-5xl lg:pt-28 xl:max-w-6xl ${
          entered ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        <div className="grid w-full grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-[5.5rem]">
          {/* Left: exactly one screen tall below the bar, pinned for the whole
              page — the portrait and its solar system stay in view. */}
          {/* z-[2] on a desktop: a card orbiting round to the left (one still
              to come, or gone by) is small and passes BEHIND the portrait. */}
          <section className="min-w-0 lg:sticky lg:top-20 lg:z-[2] lg:h-[calc(100dvh-6.5rem)] lg:self-start">
            <div className="flex h-full min-w-0 flex-col items-center justify-center lg:items-start">
              <Nameplate entered={entered} />
              <div className="relative mt-8 w-full" style={fade(entered, 0.34)}>
                <SkillOrbit photos={portraits.photos} interval={portraits.interval} onOpenAlbum={openAlbum} />
              </div>
            </div>
          </section>

          {/* Right: the parts you read and use. */}
          <section ref={column} className="relative flex w-full flex-col items-center lg:items-stretch">
            <ChainSpine column={column} />

            <TimeCard entered={entered} />

            {resume && (
              <div className="mt-6 w-full max-w-md lg:max-w-none">
                <ResumeCard resume={resume} onOpen={openResume} />
              </div>
            )}

            <div className="mt-6 w-full max-w-md lg:max-w-none">
              <SkillClusters />
            </div>

            <div className="mt-6 w-full max-w-md space-y-4 lg:max-w-none">
              <Recognition />
              <SideProject />
              <Volunteering />
            </div>

            {/* The shell, as a card of its own on every screen. */}
            <section
              data-link
              className="dev-reborn dev-card group relative mt-4 w-full max-w-md overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-4 backdrop-blur-sm sm:p-5 lg:max-w-none"
            >
              <CardChrome hue="var(--d-b)" />
              <SectionHead glyph="›_" label="Shell" hue="var(--d-b)" aside="TYPE OR TAP" />
              <p className="relative mt-1.5 text-[12px] leading-relaxed text-[var(--d-ink4)]">
                Ask the chain anything it knows — try <span className="font-mono text-[var(--d-b2)]">awards</span> or{" "}
                <span className="font-mono text-[var(--d-b2)]">resume</span>.
              </p>
              <div className="relative mt-3">{terminal}</div>
            </section>
          </section>
        </div>

        <LiveFinale onResume={resume ? openResume : undefined} />
      </main>
    </>
  );
}
