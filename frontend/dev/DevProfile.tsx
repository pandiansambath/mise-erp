"use client";

// pandi-dev.dineai.cloud — the developer's own page.
//
// The page itself is NOT a CV. Its text carries who he is, where he is, what
// he has been recognised for and how to reach him. No client names, no project
// architecture, no packages — that was the explicit brief, and it is also the
// right call for a public page. The résumé is a document he chose to publish
// (21 Nov 2026): offered from its own card, never copied into the page's text.
//
// The experience counter is computed from the start date on every tick rather
// than hard-coded, so it stays true without anyone remembering to edit it. A
// portfolio that says "2 years" forever is a portfolio nobody maintained.

import { useCallback, useEffect, useRef, useState } from "react";
import { Album, type Photo } from "./Album";
import { SkillClusters } from "@/dev/SkillClusters";
import { SkillOrbit } from "@/dev/SkillOrbit";
import { Atmosphere } from "@/dev/Atmosphere";
import { BootSequence } from "./BootSequence";
import { ChainField } from "./ChainField";
import { ChainSpine } from "./ChainSpine";
import { DecryptText } from "./DecryptText";
import { Finale } from "./Finale";
import { Recognition, SideProject, Volunteering } from "./Highlights";
import { MonthChain } from "./MonthChain";
import { SkillDrift } from "./SkillDrift";
import { ResumeCard, ResumeViewer, type ResumeManifest } from "./Resume";
import { Terminal } from "./Terminal";
import { useHandoff } from "./useHandoff";

// First day as a System Engineer. Everything time-based derives from this.
const CAREER_START = new Date("2024-01-01T00:00:00Z");

const LINKS = [
  { label: "Email", value: "pandian.s.sambath@gmail.com", href: "mailto:pandian.s.sambath@gmail.com", glyph: "✉" },
  { label: "LinkedIn", value: "pandiansambath", href: "https://www.linkedin.com/in/pandiansambath", glyph: "in" },
  { label: "GitHub", value: "pandiansambath", href: "https://github.com/pandiansambath", glyph: "⌥" },
  { label: "Instagram", value: "pandian.sambath", href: "https://instagram.com/pandian.sambath", glyph: "◎" },
];

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
];

// The words that turn under his name. Things he builds with, nothing more.
const BUILDS_WITH = ["Python", "AWS", "Generative AI", "FastAPI", "Terraform", "Amazon Bedrock"];

/** One word at a time, sliding up into place. The line is short and ends
 *  with the word, so nothing after it shifts as the width changes. */
function Rotator({ words, active }: { words: string[]; active: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 2400);
    return () => clearInterval(id);
  }, [active, words.length]);
  return (
    <span className="inline-block overflow-hidden align-bottom">
      <span
        key={i}
        className="inline-block font-semibold"
        style={{
          animation: "devWordIn .55s cubic-bezier(.2,.8,.2,1) both",
          background: "linear-gradient(90deg, #f0a064, #2dd4bf)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
          color: "transparent",
        }}
      >
        {words[i]}
      </span>
    </span>
  );
}

/** Email, with a copy button beside it — a recruiter on a work laptop often
 *  has no mail app wired to mailto. */
function CopyEmail({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(email);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          window.location.href = `mailto:${email}`;
        }
      }}
      aria-label={copied ? "Email copied" : "Copy email address"}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[10px] text-[#7d93ad] transition hover:border-[#2dd4bf]/50 hover:text-[#7df0dc]"
    >
      {copied ? "COPIED ✓" : "COPY"}
    </button>
  );
}

function elapsed(from: Date, now: Date) {
  let years = now.getUTCFullYear() - from.getUTCFullYear();
  let months = now.getUTCMonth() - from.getUTCMonth();
  let days = now.getUTCDate() - from.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Days in the month that just ended — borrowing 30 would drift.
    days += new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) { years -= 1; months += 12; }
  return {
    years,
    months,
    days,
    hours: now.getUTCHours(),
    minutes: now.getUTCMinutes(),
    seconds: now.getUTCSeconds(),
    // The headline figure, e.g. 2.6 — decimal years, always current.
    decimal: ((now.getTime() - from.getTime()) / 31_557_600_000).toFixed(1),
  };
}

export function DevProfile({ photos, resume }: { photos: Photo[]; resume: ResumeManifest | null }) {
  const [entered, setEntered] = useState(false);
  // The crossfade is written straight to these two nodes on scroll — no
  // React state, so the page is not re-rendered sixty times a second.
  const { goingRef, comingRef, smokeRef } = useHandoff<HTMLDivElement, HTMLDivElement>();
  const [albumOpen, setAlbumOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Starts null and fills in on the client: rendering a clock on the server
  // would hydrate with a stale time and React would (correctly) complain.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const openAlbum = useCallback(() => setAlbumOpen(true), []);
  const openResume = useCallback(() => setResumeOpen(true), []);
  const column = useRef<HTMLElement>(null);

  // The light that follows the pointer across a card (.dev-card in
  // globals.css). One listener for the page, writing two custom properties on
  // the card under the pointer only — no React state, no re-render.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const card = (e.target as Element | null)?.closest?.(".dev-card") as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  // Three ways in, because "hidden" should still be findable:
  //   1. the lock glyph on the avatar (appears on hover)
  //   2. type "album" anywhere
  //   3. the Konami code
  const buffer = useRef("");
  const konami = useRef<string[]>([]);
  useEffect(() => {
    // Not while the résumé is open: the album must not land on top of it.
    if (!entered || resumeOpen) return;
    const onKey = (e: KeyboardEvent) => {
      buffer.current = (buffer.current + e.key.toLowerCase()).slice(-5);
      if (buffer.current === "album") { openAlbum(); buffer.current = ""; }

      konami.current = [...konami.current, e.key].slice(-KONAMI.length);
      if (konami.current.join(",") === KONAMI.join(",")) {
        openAlbum();
        konami.current = [];
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entered, openAlbum, resumeOpen]);

  const thumbUrls = photos.map((p) => `/api/dev-site/thumb/${p.id}.webp`);
  const exp = now ? elapsed(CAREER_START, now) : null;
  // Day 1 was the first day. One link per day, for the finale.
  const days = now ? Math.floor((now.getTime() - CAREER_START.getTime()) / 86_400_000) + 1 : null;

  return (
    // `clip`, not `hidden`.
    //
    // `overflow-x: hidden` makes this element a scroll container, and a
    // `position: sticky` descendant then sticks to THAT rather than to the
    // viewport — so the left column quietly stopped holding and the half went
    // blank. `clip` cuts the same overflow without creating a scroll
    // container, which leaves sticky working.
    <div className="relative min-h-dvh overflow-x-clip bg-[#070a0f] text-[#e6edf5]">
      <ChainField intensity={entered ? 1 : 0.35} />

      {/* Warm the corners so the chain never fights the text for attention. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0"
        style={{
          background:
            // Copper from the top, teal from the bottom-left: the two strands' 
            // colours bleeding into the page so the background and the content 
            // read as one system.
            "radial-gradient(110% 70% at 70% 0%, rgba(217,119,66,.11), transparent 55%), radial-gradient(90% 60% at 15% 85%, rgba(45,212,191,.09), transparent 60%), radial-gradient(100% 70% at 50% 100%, rgba(8,12,18,.92), transparent 60%)",
        }}
      />

      {/* Light on the structure. The chain is the engineering; this is the
          weather over it. Two layers doing different jobs read as depth. */}
      <Atmosphere />

      {/* His skills, drifting through the background at different depths. */}
      <SkillDrift />

      {/* How far down the page you are, in the chain's colours. */}
      <div aria-hidden className="dev-progress" />

      {!entered && <BootSequence photoUrls={thumbUrls} onEnter={() => setEntered(true)} />}

      <main
        className={`relative z-10 mx-auto flex min-h-dvh w-full max-w-lg flex-col items-center justify-center px-5 py-12 transition-all duration-700 sm:px-6 sm:py-16 lg:max-w-5xl lg:justify-start lg:pt-28 xl:max-w-6xl ${
          entered ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
      {/* One column on phones, two once there is room. The empty margins on
          desktop were the content declining to use the width it had — and
          simply widening a single column would have produced long, unreadable
          lines instead. Identity on the left, the things you DO on the right. */}
      <div className="grid w-full items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-14">
        <section
          // Exactly one screen tall, pinned near the top.
          //
          // The measured offset was too clever and it broke: the column's own
          // height drove where it pinned, so the shell could settle off-screen
          // and the left half went blank — "still I can see empty space, and
          // where is the terminal?". A column that IS the viewport can only
          // pin at one place, and whatever is centred in it is always on
          // screen. No measuring, nothing to get wrong.
          className="min-w-0 lg:sticky lg:top-12 lg:h-[calc(100dvh-6rem)] lg:self-start"
        >
        {/* Two things, one space.
            Both children are put in the SAME grid cell, so the shell does not
            appear below the portrait — it appears THROUGH it. */}
        <div className="relative grid h-full place-content-center [&>*]:col-start-1 [&>*]:row-start-1">

        {/* The smoke that covers the swap. Sits over both, in the same cell,
            and is only ever visible in the middle of the transition. */}
        <div
          ref={smokeRef}
          aria-hidden
          style={{ opacity: 0 }}
          className="dev-smoke pointer-events-none z-10 hidden self-center justify-self-center lg:block"
        />


        <div
          // The portrait, on its way out. `pointer-events` is handed over with
          // the opacity, or the faded ghost keeps swallowing clicks meant for
          // the shell underneath.
          ref={goingRef}
          className="flex min-w-0 flex-col items-center lg:items-start lg:text-left"
        >

        {/* Name first, orbit under it.
            The orbit was on top and vertically centred, which pushed his name
            below the fold on a desktop and left a large empty band above it —
            "why that empty gap… I need to scroll to see my pic and name". The
            identity is the point of the page, so it goes first. */}
        <h1
          className="text-center font-display text-4xl font-semibold tracking-tight sm:text-5xl lg:text-left lg:text-6xl"
          style={entered ? { animation: "devFadeUp .8s .1s ease-out both" } : undefined}
        >
          {entered ? (
            <DecryptText text="Pandian Sambath" delay={420} replayOnHover />
          ) : (
            "Pandian Sambath"
          )}
        </h1>

        <p
          className="mt-2.5 text-center font-mono text-[12px] tracking-[0.14em] text-[#7d93ad] sm:text-[13px] lg:text-left"
          style={entered ? { animation: "devFadeUp .8s .18s ease-out both" } : undefined}
        >
          {entered ? <DecryptText text="SYSTEM ENGINEER" delay={760} speed={26} /> : "SYSTEM ENGINEER"}
          <span className="mx-2 text-[#d97742]">·</span>
          <br className="sm:hidden" />
          {entered ? <DecryptText text="TATA CONSULTANCY SERVICES" delay={900} speed={20} /> : "TATA CONSULTANCY SERVICES"}
        </p>

        <p
          className="mt-1.5 text-center text-sm text-[#5b6e85] lg:text-left"
          style={entered ? { animation: "devFadeUp .8s .24s ease-out both" } : undefined}
        >
          Chennai, India
        </p>

        <p
          // Not on short desktop screens (a 768px-tall laptop): the left column
          // is exactly one screen tall, and this line pushed the orbit's lowest
          // chips off the bottom.
          className="mt-3 text-center font-mono text-[11px] tracking-[0.16em] text-[#5b6e85] sm:text-[12px] lg:text-left [@media(min-width:1024px)_and_(max-height:820px)]:hidden"
          style={entered ? { animation: "devFadeUp .8s .27s ease-out both" } : undefined}
        >
          BUILDING WITH <Rotator words={BUILDS_WITH} active={entered} />
        </p>

        <div
          className="relative mt-6 w-full"
          style={entered ? { animation: "devFadeUp .8s .3s ease-out both" } : undefined}
        >
          <SkillOrbit
            photos={["/api/dev-site/profile.webp", "/api/dev-site/profile-alt.webp"]}
            onOpenAlbum={openAlbum}
          />
        </div>

        </div>

        {/* The shell, taking the space over.
            Desktop only: on a phone there is one column and nothing to fill,
            so the terminal stays where it was, at the end. */}
        <div
          ref={comingRef}
          // Starts invisible; the scroll handler takes it from here.
          style={{ opacity: 0, pointerEvents: "none" }}
          className="relative hidden self-center lg:block"
        >
          {/* Light coming up behind the shell as it takes the space.
              The swap alone is a fade; this makes it read as something being
              switched ON in that space, which is the difference between a
              transition you notice and one you remember. */}
          <span
            aria-hidden
            className="pointer-events-none absolute -inset-x-10 -inset-y-8 -z-10 rounded-[3rem] blur-[70px]"
            style={{
              opacity: 0.5,
              background:
                "radial-gradient(60% 60% at 30% 40%, #2dd4bf, transparent 70%), radial-gradient(55% 55% at 75% 65%, #d97742, transparent 72%)",
            }}
          />
          <Terminal onAlbum={openAlbum} onResume={resume ? openResume : undefined} experience={exp ? exp.decimal : "2"} />
          <p className="mt-4 text-center font-mono text-[10px] tracking-[0.22em] text-[#2e3c4c] lg:text-left">
            TAP THE AVATAR — OR RUN <span className="text-[#5b6e85]">album</span>
          </p>
        </div>

        </div>
        </section>

        {/* Right column: the live counter, the shell, and the ways to reach
            him — the parts you interact with, kept together. */}
        <section
          // Deliberately NOT its own scroll container. When it was one, the
          // wheel did nothing unless the pointer happened to be over this
          // half — "wherever I scroll, I need to see the right side
          // scrolling". The page scrolls; this is simply the tall part of it.
          //
          // `relative` for the chain spine that runs down its left edge.
          ref={column}
          className="relative flex w-full flex-col items-center lg:items-stretch"
        >
        <ChainSpine column={column} />

        {/* ── Live experience ──────────────────────────────────────────────
            Every card is born small and grows as it scrolls in (dev-reborn),
            the effect he asked for on all of them. The first-screen cards
            used to fade up on entry instead, which silently overrode it. */}
        <div
          data-link
          className="dev-reborn dev-card relative w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-sm lg:max-w-none"
        >
          <p className="text-center font-mono text-[10px] tracking-[0.3em] text-[#d97742]">
            TIME IN THE CHAIN
          </p>
          <div
            aria-hidden
            className="mx-auto mt-2 h-px w-24"
            style={{ background: "linear-gradient(90deg, transparent, #d97742, #2dd4bf, transparent)" }}
          />
          <p className="mt-2 text-center text-5xl font-semibold tabular-nums tracking-tight">
            <span
              style={{
                background: "linear-gradient(180deg, #ffffff, #b9cadb)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {exp ? exp.decimal : "—"}
            </span>
            <span className="ml-2 text-base font-normal text-[#5b6e85]">years</span>
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            {[
              ["YEARS", exp?.years],
              ["MONTHS", exp?.months],
              ["DAYS", exp?.days],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-white/[0.05] bg-black/20 py-2.5">
                <p className="font-mono text-[9px] tracking-[0.2em] text-[#4a5c70]">{label}</p>
                <p className="mt-0.5 text-xl font-semibold tabular-nums text-[#e6edf5]">
                  {value ?? "—"}
                </p>
              </div>
            ))}
          </div>
          {/* One block per month since the first day — the chain itself. */}
          {now && <MonthChain start={CAREER_START} now={now} play={entered} />}
          <p className="mt-3 text-center font-mono text-[10px] tabular-nums tracking-[0.18em] text-[#3f4f61]">
            {exp
              ? `+ ${String(exp.hours).padStart(2, "0")}:${String(exp.minutes).padStart(2, "0")}:${String(exp.seconds).padStart(2, "0")} AND COUNTING`
              : "SYNCING…"}
          </p>
        </div>

        {/* ── Résumé ─────────────────────────────────────────────────────
            Straight after the time served: it is what a recruiter came for.
            No card at all until one has been published. */}
        {resume && (
          <div className="mt-6 w-full max-w-md lg:max-w-none">
            <ResumeCard resume={resume} onOpen={openResume} />
          </div>
        )}

        {/* ── What he works with, and where he studied ─────────────────
            The orbit is the showpiece; these are the answers. A recruiter
            checking "does he know ECS" should not have to wait for a chip to
            come round, and twenty chips will not fit on a phone at any
            readable size. */}
        <div className="mt-6 w-full max-w-md lg:max-w-none">
          <SkillClusters />
        </div>

        {/* ── Recognition, what he builds, how he recharges ───────────── */}
        <div className="mt-6 w-full max-w-md space-y-4 lg:max-w-none">
          <Recognition />
          <SideProject />
          <Volunteering />
        </div>

        {/* ── Contact ──────────────────────────────────────────────────── */}
        <div data-link className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-none">
          {LINKS.map((l) => (
            <div key={l.label} className={`dev-reborn relative ${l.label === "Email" ? "sm:col-span-2" : ""}`}>
            <a
              href={l.href}
              target={l.href.startsWith("mailto") ? undefined : "_blank"}
              rel="noopener noreferrer"
              className={`group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/[0.06] ${
                l.label === "Email" ? "pr-24" : ""
              }`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 font-mono text-xs text-[#7d93ad] transition-colors group-hover:border-[#2dd4bf]/40 group-hover:text-[#7df0dc]">
                {l.glyph}
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[9px] tracking-[0.2em] text-[#4a5c70]">
                  {l.label.toUpperCase()}
                </span>
                <span className="block truncate text-[13px] text-[#c3d0dd] transition-colors group-hover:text-[#e6edf5]">
                  {l.value}
                </span>
              </span>
            </a>
            {/* Beside the link, never inside it: a button in an <a> is invalid
                and would also follow the mailto. */}
            {l.label === "Email" && <CopyEmail email={l.value} />}
            </div>
          ))}
          {resume && (
            <button
              type="button"
              onClick={openResume}
              className="dev-reborn group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/[0.06]"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/10 bg-black/30 font-mono text-xs text-[#7d93ad] transition-colors group-hover:border-[#2dd4bf]/40 group-hover:text-[#7df0dc]">
                ▤
              </span>
              <span className="min-w-0">
                <span className="block font-mono text-[9px] tracking-[0.2em] text-[#4a5c70]">RÉSUMÉ</span>
                <span className="block truncate text-[13px] text-[#c3d0dd] transition-colors group-hover:text-[#e6edf5]">
                  View · PDF · Word
                </span>
              </span>
            </button>
          )}
        </div>

        {/* A shell you can actually type into. Passive animation impresses for
            a few seconds; something that answers back holds people.

            Phones only. On a desktop it now lives in the left column, where it
            takes over the space the portrait was holding — and the page ends
            here, at the links, rather than scrolling on past them. */}
        <div
          className="mt-6 flex w-full max-w-md justify-center lg:hidden"
          style={entered ? { animation: "devFadeUp .8s .58s ease-out both" } : undefined}
        >
          <Terminal onAlbum={openAlbum} onResume={resume ? openResume : undefined} experience={exp ? exp.decimal : "2"} />
        </div>

        <p
          className="mt-5 text-center font-mono text-[10px] tracking-[0.22em] text-[#2e3c4c] lg:hidden"
          style={entered ? { animation: "devFadeUp .8s .68s ease-out both" } : undefined}
        >
          TAP THE AVATAR — OR RUN <span className="text-[#5b6e85]">album</span>
        </p>

        </section>
      </div>

      {/* The end of the page: the slogan inside a turning ring of links. */}
      <Finale days={days} onResume={resume ? openResume : undefined} />
      </main>

      {albumOpen && <Album photos={photos} onClose={() => setAlbumOpen(false)} />}
      {/* Outside <main>, like the album: <main> carries a transform, and a
          transformed ancestor would pin this "fixed" layer to itself instead
          of to the screen. */}
      {resumeOpen && resume && <ResumeViewer resume={resume} onClose={() => setResumeOpen(false)} />}
    </div>
  );
}
