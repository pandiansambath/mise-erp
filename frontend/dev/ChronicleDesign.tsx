"use client";

// Design 3 of 5: The Chronicle — "Printed in Chennai. Read everywhere."
//
// A newspaper front page, today's edition, built from nothing for this
// design: a masthead with a live dateline and an edition number that is his
// day count, a markets ticker of his skills, a lead story with a halftone
// portrait and a drop cap, an honours roll, Business (DineAI), Community,
// From the Archives (education, with the proof), a skills directory set like
// market listings, and classifieds for the résumé and the ways to reach him.
// In a dark theme it prints as the Night Edition.

import { CAREER_START, EMAIL, LINKS, chennaiTime, elapsed, useDev, useNow, usePortraits } from "./context";
import { ResumeActions } from "./designKit";
import { honours, PROJECT, VOLUNTEERING } from "./profile";
import { CLUSTERS, EDUCATION } from "./skills";
import { findTheme } from "./theme";

const RULE = "border-[var(--d-ink)]";
const KICKER = "font-mono text-[10px] font-bold tracking-[0.28em] text-[var(--d-a)]";
const HEAD = "font-display font-bold leading-[1.02] tracking-tight";

function longDate(now: Date) {
  return now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

export function ChronicleDesign() {
  // His portrait photos and their pace, set in the owner panel (22 Nov).
  const PORTRAITS = usePortraits();
  const { entered, milestones, themeId, openAlbum, photos } = useDev();
  const now = useNow();
  const exp = now ? elapsed(CAREER_START, now) : null;
  const list = honours(milestones);
  const night = !findTheme(themeId).light;
  const press = (d: number) => (entered ? { animation: `devPress .9s ${d}s cubic-bezier(.2,.8,.2,1) both` } : { opacity: 0 });
  const ticker = CLUSTERS.flatMap((c) => c.items.map((i) => ({ i, hue: c.hue })));

  return (
    <main className="relative z-10 mx-auto w-full max-w-6xl px-4 pb-16 pt-20 font-serif sm:px-6 sm:pt-24">
      {/* Newsprint: a faint grain and a vignette. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, transparent 60%, color-mix(in srgb, var(--d-ink) 7%, transparent)), repeating-radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--d-ink) 3%, transparent) 0 1px, transparent 1px 3px)",
        }}
      />

      {/* ── Masthead ──────────────────────────────────────────────────── */}
      <header style={press(0)}>
        <div className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b ${RULE} pb-2 font-mono text-[10px] tracking-[0.16em] text-[var(--d-ink3)]`}>
          <span>EDITION No. {exp ? exp.dayNumber.toLocaleString("en-US") : "—"}</span>
          <span className="order-3 w-full text-center sm:order-none sm:w-auto">{now ? longDate(now).toUpperCase() : " "}</span>
          <span>{night ? "NIGHT EDITION" : "MORNING EDITION"} · PRICE: ONE HELLO</span>
        </div>
        <h1 className={`${HEAD} py-3 text-center text-[clamp(2.4rem,9.5vw,6.8rem)]`} style={{ fontVariationSettings: '"opsz" 144' }}>
          The Pandian Chronicle
        </h1>
        <div className={`border-y-[3px] border-double ${RULE} py-1.5 text-center font-mono text-[10.5px] tracking-[0.3em] text-[var(--d-ink3)]`}>
          PRINTED IN CHENNAI · READ EVERYWHERE
        </div>
      </header>

      {/* ── Markets ticker ────────────────────────────────────────────── */}
      <div className={`mt-2 overflow-hidden border-b ${RULE} py-1.5`} style={press(0.1)}>
        <div className="flex w-max gap-8 whitespace-nowrap font-mono text-[11px]" style={{ animation: "devMarquee 50s linear infinite" }}>
          {[...ticker, ...ticker].map((t, k) => (
            <span key={k} className="text-[var(--d-ink2)]">
              {t.i.toUpperCase()} <span style={{ color: t.hue }}>▲</span>
            </span>
          ))}
        </div>
      </div>

      {/* ── Front page ────────────────────────────────────────────────── */}
      <section className="mt-6 grid gap-8 md:grid-cols-12">
        <article className="md:col-span-8" style={press(0.18)}>
          <p className={KICKER}>SPECIAL REPORT · CHENNAI</p>
          <h2 className={`${HEAD} mt-2 text-[clamp(2rem,5.4vw,3.6rem)]`}>
            Chennai engineer marks day {exp ? exp.dayNumber.toLocaleString("en-US") : "…"} of building — and isn’t slowing down
          </h2>
          <p className="mt-3 text-[17px] italic leading-snug text-[var(--d-ink3)]">
            A System Engineer at Tata Consultancy Services, a university gold medallist, and promoted twice in two years.
          </p>
          <p className="mt-3 font-mono text-[10.5px] tracking-[0.16em] text-[var(--d-ink5)]">BY THE CHRONICLE DESK · {now ? `${chennaiTime(now)} IST` : ""}</p>

          <figure className="mt-5">
            <button type="button" onClick={openAlbum} className="group relative block w-full overflow-hidden" aria-label="Open the photo album">
              {/* eslint-disable-next-line @next/next/no-img-element -- private bucket via the backend */}
              <img
                src={PORTRAITS[0]}
                alt="Pandian Sambath"
                className="aspect-[16/10] w-full object-cover transition duration-700 group-hover:scale-[1.03]"
                style={{ objectPosition: "50% 30%", filter: "grayscale(1) contrast(1.25) brightness(1.02)" }}
              />
              {/* Halftone: printed dots over the photograph. */}
              <span aria-hidden className="absolute inset-0 mix-blend-multiply" style={{ backgroundImage: "radial-gradient(rgba(0,0,0,.55) 0.9px, transparent 1.1px)", backgroundSize: "4px 4px" }} />
              <span aria-hidden className="absolute inset-0 mix-blend-color" style={{ background: "var(--d-a)", opacity: 0.18 }} />
            </button>
            <figcaption className={`border-b ${RULE} py-2 text-[12px] italic text-[var(--d-ink4)]`}>
              Pandian Sambath in Chennai. {photos.length ? `${photos.length} more photographs in the album — tap the picture.` : ""}
            </figcaption>
          </figure>

          <div className="mt-4 gap-6 text-[15.5px] leading-[1.65] text-[var(--d-ink2)] md:columns-2 [&>p]:mb-4">
            <p className="first-letter:float-left first-letter:mr-2 first-letter:font-display first-letter:text-[4.2rem] first-letter:font-bold first-letter:leading-[0.8] first-letter:text-[var(--d-a)]">
              CHENNAI — Pandian Sambath has been building for {exp ? `${exp.years} years, ${exp.months} months and ${exp.days} days` : "almost three years"}, and by every measure the
              clock on his own page keeps, he is not close to done. A System Engineer at Tata Consultancy Services since January 2024, he works across
              AWS, Python and generative AI.
            </p>
            <p>
              The honours have followed the work.{" "}
              {list.map((h, k) => (
                <span key={`${h.when}-${h.title}`}>
                  {h.title} ({h.when}){k < list.length - 1 ? "; " : "."}
                </span>
              ))}{" "}
              The Star of the Month came when he was the youngest engineer on the team, with 1.6 years of experience.
            </p>
            <p>
              Before any of it, he studied Information Technology at {EDUCATION.school} from 2019 to 2023 and graduated with {EDUCATION.percentage}, placing
              17th across Anna University — a gold medal. <a href="#archives" className="text-[var(--d-a)] underline underline-offset-2">See the Archives.</a>
            </p>
            <p>
              Outside work, he builds and runs {PROJECT.name}, a live product for UK restaurants.{" "}
              <a href="#business" className="text-[var(--d-a)] underline underline-offset-2">Business, below.</a>
            </p>
          </div>
        </article>

        <aside className="space-y-6 md:col-span-4" style={press(0.28)}>
          <div className={`border-[3px] border-double ${RULE} p-4`}>
            <p className={KICKER}>HONOURS ROLL</p>
            <ul className="mt-3 divide-y divide-[var(--d-line2)]">
              {list.map((h) => (
                <li key={`${h.when}-${h.title}`} className="py-2.5">
                  <p className="font-mono text-[10px] tracking-[0.16em] text-[var(--d-ink5)]">{h.when.toUpperCase()}</p>
                  <p className={`${HEAD} mt-0.5 text-[18px] ${h.kind === "recognition" ? "dev-gold" : ""}`}>
                    {h.kind === "recognition" ? "★ " : "↑ "}
                    {h.title}
                  </p>
                  {h.promoted && <p className="mt-0.5 text-[12px] italic text-[var(--d-b)]">Promoted · {h.promoted}</p>}
                </li>
              ))}
            </ul>
          </div>
          <div className={`border-t-[3px] ${RULE} pt-3`}>
            <p className={KICKER}>THE FORECAST</p>
            <p className={`${HEAD} mt-1 text-[22px]`}>Chennai · {now ? chennaiTime(now) : "—"}</p>
            <p className="mt-1 text-[14px] italic text-[var(--d-ink3)]">Outlook: building, all day. Next work anniversary in {now ? `${Math.ceil((Date.UTC(now.getUTCFullYear() + 1, 0, 1) - now.getTime()) / 86_400_000)} days` : "—"}.</p>
          </div>
          <div className={`border-t-[3px] ${RULE} pt-3`}>
            <p className={KICKER}>INSIDE TODAY</p>
            <ul className="mt-2 space-y-1.5 text-[14px]">
              {[
                ["Business", "#business", "2"],
                ["Community", "#community", "3"],
                ["From the Archives", "#archives", "4"],
                ["Skills directory", "#directory", "5"],
                ["Classifieds", "#classifieds", "6"],
              ].map(([t, h, pg]) => (
                <li key={t} className="flex items-baseline gap-2">
                  <a href={h} className="hover:text-[var(--d-a)]">
                    {t}
                  </a>
                  <span className="flex-1 border-b border-dotted border-[var(--d-line2)]" />
                  <span className="font-mono text-[11px] text-[var(--d-ink5)]">{pg}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>

      {/* ── Business · Community · Archives ──────────────────────────── */}
      <section className={`mt-10 grid gap-8 border-t-[3px] border-double ${RULE} pt-6 md:grid-cols-3`}>
        <article id="business" className="scroll-mt-24">
          <p className={KICKER}>BUSINESS</p>
          <h3 className={`${HEAD} mt-2 text-[26px]`}>“{PROJECT.slogan}” A Chennai engineer has an answer for UK restaurants</h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--d-ink2)]">{PROJECT.pitch} It is in use today at {PROJECT.inUse.label}.</p>
          <p className="mt-2 text-[12.5px] italic text-[var(--d-ink4)]">{PROJECT.honesty}</p>
          <p className="mt-3 flex flex-wrap gap-3 font-mono text-[12px]">
            <a href={PROJECT.site} target="_blank" rel="noopener noreferrer" className="font-bold text-[var(--d-a)] underline underline-offset-2">dineai.cloud ↗</a>
            <a href={PROJECT.code} target="_blank" rel="noopener noreferrer" className="text-[var(--d-ink3)] underline underline-offset-2">the code ↗</a>
          </p>
        </article>
        <article id="community" className="scroll-mt-24 md:border-x md:border-[var(--d-line2)] md:px-6">
          <p className={KICKER}>COMMUNITY</p>
          <h3 className={`${HEAD} mt-2 text-[26px]`}>How he recharges</h3>
          <div className="mt-3 space-y-3 text-[14.5px] leading-relaxed text-[var(--d-ink2)]">
            {VOLUNTEERING.map((v) => (
              <p key={v.org}>
                <span className="font-bold">{v.org}.</span> {v.what}
              </p>
            ))}
          </div>
        </article>
        <article id="archives" className="scroll-mt-24">
          <p className={KICKER}>FROM THE ARCHIVES · 2023</p>
          <h3 className={`${HEAD} mt-2 text-[26px]`}>Gold medal at Anna University: 17th rank, {EDUCATION.percentage}</h3>
          <p className="mt-3 text-[14.5px] leading-relaxed text-[var(--d-ink2)]">
            {EDUCATION.degree}, {EDUCATION.school}, {EDUCATION.year}. {EDUCATION.affiliation}.
          </p>
          <a href={EDUCATION.verifyUrl} target="_blank" rel="noreferrer noopener" className="mt-3 inline-block border border-[var(--d-ink)] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.12em] transition hover:bg-[var(--d-ink)] hover:text-[var(--d-bg)]">
            ✓ READ THE RANK LIST · PAGE 35 ↗
          </a>
        </article>
      </section>

      {/* ── Skills directory, set like market listings ───────────────── */}
      <section id="directory" className={`mt-10 scroll-mt-24 border-t-[3px] ${RULE} pt-4`}>
        <p className={KICKER}>SKILLS DIRECTORY</p>
        <div className="mt-3 grid gap-x-8 gap-y-5 font-mono text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
          {CLUSTERS.map((c) => (
            <div key={c.key}>
              <p className="border-b border-[var(--d-ink)] pb-1 text-[11px] font-bold tracking-[0.2em]" style={{ color: c.hue }}>
                {c.label.toUpperCase()}
              </p>
              <ul className="mt-1.5 space-y-1">
                {c.items.map((item) => (
                  <li key={item} className="flex items-baseline gap-2 text-[var(--d-ink2)]">
                    <span>{item}</span>
                    <span className="flex-1 border-b border-dotted border-[var(--d-line2)]" />
                    <span style={{ color: c.hue }}>▲</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* ── Classifieds ──────────────────────────────────────────────── */}
      <section id="classifieds" className={`mt-10 scroll-mt-24 border-t-[3px] border-double ${RULE} pt-4`}>
        <p className={KICKER}>CLASSIFIEDS</p>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          <div className="border border-[var(--d-ink)] p-4">
            <p className={`${HEAD} text-[20px]`}>RÉSUMÉ AVAILABLE</p>
            <p className="mt-1 text-[13.5px] text-[var(--d-ink3)]">System Engineer, Chennai. Python · AWS · Generative AI. Two pages, ready to read.</p>
            <ResumeActions className="mt-3" button="border border-[var(--d-ink)] px-2.5 py-1 font-mono text-[11px] font-bold transition hover:bg-[var(--d-ink)] hover:text-[var(--d-bg)]" />
          </div>
          <div className="border border-[var(--d-ink)] p-4">
            <p className={`${HEAD} text-[20px]`}>CORRESPONDENCE</p>
            <ul className="mt-2 space-y-1 font-mono text-[12px]">
              <li><a className="underline underline-offset-2" href={LINKS.email}>{EMAIL}</a></li>
              <li><a className="underline underline-offset-2" href={LINKS.linkedin} target="_blank" rel="noopener noreferrer">linkedin.com/in/pandiansambath</a></li>
              <li><a className="underline underline-offset-2" href={LINKS.github} target="_blank" rel="noopener noreferrer">github.com/pandiansambath</a></li>
            </ul>
          </div>
          <button type="button" onClick={openAlbum} className="border border-[var(--d-ink)] p-4 text-left transition hover:bg-[var(--d-glass)]">
            <p className={`${HEAD} text-[20px]`}>THE ALBUM</p>
            <p className="mt-1 text-[13.5px] text-[var(--d-ink3)]">{photos.length} photographs. Viewing now — no appointment needed. →</p>
          </button>
        </div>
      </section>

      <footer className={`mt-12 border-t ${RULE} pt-3 text-center`}>
        <p className={`${HEAD} text-[clamp(1.4rem,4vw,2.2rem)]`}>Printed in Chennai. Read everywhere.</p>
        <p className="mt-1 font-mono text-[10px] tracking-[0.2em] text-[var(--d-ink5)]">
          © {now ? now.getFullYear() : ""} PANDIAN SAMBATH · THIS EDITION SET {now ? `${chennaiTime(now)} IST` : ""} · BUILT WITH AI-ASSISTED DEVELOPMENT
        </p>
      </footer>
    </main>
  );
}
