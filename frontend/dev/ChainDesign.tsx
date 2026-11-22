"use client";

// Design 1 of 5: Chain Reaction — the original, and the default.
//
// Left: who he is, and the solar system of his skills around his portrait —
// pinned the whole way down, because it is the page's centrepiece. Right: the live
// counter with its chain of months, the résumé, skills, education,
// recognition, what he builds, how he recharges — every card born small and
// growing as it scrolls in, a chain spine beside them lighting card by card.
// At the end, the chain itself gathers round the slogan.

import { Atmosphere } from "./Atmosphere";
import { ChainField } from "./ChainField";
import { ChainSpine } from "./ChainSpine";
import { CAREER_START, chennaiTime, elapsed, useDev, useNow } from "./context";
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

const fade = (entered: boolean, delay: number) =>
  entered ? { animation: `devFadeUp .8s ${delay}s ease-out both` } : { opacity: 0 };

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
  return (
    <div className="w-full text-center lg:text-left">
      <p className="font-mono text-[11px] tracking-[0.34em] text-[var(--d-a)]" style={fade(entered, 0.05)}>
        HELLO, I’M
      </p>
      <h1
        className="mt-2 font-display text-[clamp(2.4rem,6vw,3.9rem)] font-semibold leading-[1.02] tracking-tight"
        style={fade(entered, 0.1)}
      >
        {entered ? (
          <DecryptText text="Pandian Sambath" delay={420} replayOnHover textClassName="dev-sheen" />
        ) : (
          <span className="dev-sheen">Pandian Sambath</span>
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
        <Wave text="System Engineer" className="font-semibold text-[var(--d-ink)]" />
        <span className="text-[var(--d-ink6)]">at</span>
        <Wave text="Tata Consultancy Services" className="font-semibold" style={{ color: "var(--d-a2)" }} />
      </p>
      <p
        className="mt-2 flex flex-wrap items-center justify-center gap-x-3 font-mono text-[11px] tracking-[0.14em] text-[var(--d-ink5)] lg:justify-start"
        style={fade(entered, 0.28)}
      >
        <span>CHENNAI, INDIA</span>
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
  const exp = now ? elapsed(CAREER_START, now) : null;
  return (
  <div
    data-link="first"
    className="dev-reborn dev-card group relative w-full max-w-md overflow-hidden rounded-2xl border border-[var(--d-line)] bg-[var(--d-glass)] p-5 backdrop-blur-sm lg:max-w-none"
  >
    <CardChrome />
    <p className="text-center font-mono text-[10px] tracking-[0.3em] text-[var(--d-a)]">
      <Wave text="TIME IN THE CHAIN" />
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
  const { entered, resume, openAlbum, openResume } = useDev();
  const column = useRef<HTMLElement>(null);
  const terminal = <LiveTerminal onAlbum={openAlbum} onResume={resume ? openResume : undefined} />;

  return (
    <>
      <ChainField intensity={entered ? 1 : 0.35} />
      {/* Fine dust in the room: zooms in as you scroll, ripples from the
          pointer like water (DustField). */}
      <DustField />
      {/* The two accents bleeding in from the corners, so the background and
          the content read as one system. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            "radial-gradient(110% 70% at 70% 0%, color-mix(in srgb, var(--d-a) 11%, transparent), transparent 55%), radial-gradient(90% 60% at 15% 85%, color-mix(in srgb, var(--d-b) 9%, transparent), transparent 60%), radial-gradient(100% 70% at 50% 100%, color-mix(in srgb, var(--d-bg) 92%, transparent), transparent 60%)",
        }}
      />
      <Atmosphere />
      <SkillDrift />

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
                <SkillOrbit photos={["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"]} onOpenAlbum={openAlbum} />
              </div>
              <p className="mt-5 w-full text-center font-mono text-[10px] tracking-[0.22em] text-[var(--d-ink6)] lg:text-left" style={fade(entered, 0.5)}>
                TAP THE PORTRAIT FOR THE ALBUM · DRAG THE ORBIT TO SPIN IT
              </p>
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
