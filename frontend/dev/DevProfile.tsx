"use client";

// pandi-dev.dineai.cloud — the developer's own page.
//
// Deliberately NOT a CV. It carries who he is, where he is, and how to reach
// him. No client names, no project architecture, no packages — that was the
// explicit brief, and it is also the right call for a public page.
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
import { DecryptText } from "./DecryptText";
import { Terminal } from "./Terminal";
import { useHandoff } from "./useHandoff";

// First day as a System Engineer. Everything time-based derives from this.
const CAREER_START = new Date("2024-01-01T00:00:00Z");

const LINKS = [
  { label: "Email", value: "pandian.s.sambath@gmail.com", href: "mailto:pandian.s.sambath@gmail.com", glyph: "✉" },
  { label: "LinkedIn", value: "pandian-sambath", href: "https://linkedin.com/in/pandian-sambath-6b97601b3", glyph: "in" },
  { label: "GitHub", value: "pandiansambath", href: "https://github.com/pandiansambath", glyph: "⌥" },
  { label: "Instagram", value: "pandian.sambath", href: "https://instagram.com/pandian.sambath", glyph: "◎" },
];

const KONAMI = [
  "ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown",
  "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a",
];

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

export function DevProfile({ photos }: { photos: Photo[] }) {
  const [entered, setEntered] = useState(false);
  // The crossfade is written straight to these two nodes on scroll — no
  // React state, so the page is not re-rendered sixty times a second.
  const { goingRef, comingRef } = useHandoff<HTMLDivElement, HTMLDivElement>();
  const [albumOpen, setAlbumOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  // Starts null and fills in on the client: rendering a clock on the server
  // would hydrate with a stale time and React would (correctly) complain.
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const openAlbum = useCallback(() => setAlbumOpen(true), []);

  // Three ways in, because "hidden" should still be findable:
  //   1. the lock glyph on the avatar (appears on hover)
  //   2. type "album" anywhere
  //   3. the Konami code
  const buffer = useRef("");
  const konami = useRef<string[]>([]);
  useEffect(() => {
    if (!entered) return;
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
  }, [entered, openAlbum]);

  const thumbUrls = photos.map((p) => `/dev/thumb/${p.id}.webp`);
  const exp = now ? elapsed(CAREER_START, now) : null;

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
        <div className="grid h-full place-content-center [&>*]:col-start-1 [&>*]:row-start-1">

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

        <div
          className="relative mt-6 w-full"
          style={entered ? { animation: "devFadeUp .8s .3s ease-out both" } : undefined}
        >
          <SkillOrbit
            photos={["/dev/profile.webp", "/dev/profile-alt.webp"]}
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
          <Terminal onAlbum={openAlbum} experience={exp ? exp.decimal : "2"} />
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
          className="flex w-full flex-col items-center lg:items-stretch"
        >

        {/* ── Live experience ──────────────────────────────────────────── */}
        <div
          className="w-full max-w-md rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-sm lg:max-w-none"
          style={entered ? { animation: "devFadeUp .8s .42s ease-out both" } : undefined}
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
            {exp ? exp.decimal : "—"}
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
          <p className="mt-3 text-center font-mono text-[10px] tabular-nums tracking-[0.18em] text-[#3f4f61]">
            {exp
              ? `+ ${String(exp.hours).padStart(2, "0")}:${String(exp.minutes).padStart(2, "0")}:${String(exp.seconds).padStart(2, "0")} AND COUNTING`
              : "SYNCING…"}
          </p>
        </div>

        {/* ── What he works with, and where he studied ─────────────────
            The orbit is the showpiece; these are the answers. A recruiter
            checking "does he know ECS" should not have to wait for a chip to
            come round, and twenty chips will not fit on a phone at any
            readable size. */}
        <div className="mt-6 w-full max-w-md lg:max-w-none">
          <SkillClusters entered={entered} />
        </div>

        {/* ── Contact ──────────────────────────────────────────────────── */}
        <div
          className="mt-6 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2 lg:max-w-none"
          style={entered ? { animation: "devFadeUp .8s .5s ease-out both" } : undefined}
        >
          {LINKS.map((l) => (
            <a
              key={l.label}
              href={l.href}
              target={l.href.startsWith("mailto") ? undefined : "_blank"}
              rel="noopener noreferrer"
              className="group flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.02] px-3.5 py-3 transition-all duration-300 hover:-translate-y-0.5 hover:border-[#2dd4bf]/40 hover:bg-[#2dd4bf]/[0.06]"
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
          ))}
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
          <Terminal onAlbum={openAlbum} experience={exp ? exp.decimal : "2"} />
        </div>

        <p
          className="mt-5 text-center font-mono text-[10px] tracking-[0.22em] text-[#2e3c4c] lg:hidden"
          style={entered ? { animation: "devFadeUp .8s .68s ease-out both" } : undefined}
        >
          TAP THE AVATAR — OR RUN <span className="text-[#5b6e85]">album</span>
        </p>

        </section>
      </div>
      </main>

      {albumOpen && <Album photos={photos} onClose={() => setAlbumOpen(false)} />}
    </div>
  );
}
