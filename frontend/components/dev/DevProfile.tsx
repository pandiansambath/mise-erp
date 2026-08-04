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
import { BootSequence } from "./BootSequence";
import { ChainField } from "./ChainField";
import { DecryptText } from "./DecryptText";
import { Terminal } from "./Terminal";

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
  const [albumOpen, setAlbumOpen] = useState(false);
  const [hint, setHint] = useState(false);
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
    <div className="relative min-h-dvh overflow-x-hidden bg-[#070a0f] text-[#e6edf5]">
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

      {!entered && <BootSequence photoUrls={thumbUrls} onEnter={() => setEntered(true)} />}

      <main
        className={`relative z-10 mx-auto flex min-h-dvh max-w-3xl flex-col items-center justify-center px-5 py-12 sm:px-6 sm:py-16 transition-all duration-700 ${
          entered ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
        }`}
      >
        {/* ── Identity ─────────────────────────────────────────────────── */}
        <div className="relative" style={entered ? { animation: "devFadeUp .8s .1s ease-out both" } : undefined}>
          <button
            onClick={openAlbum}
            onMouseEnter={() => setHint(true)}
            onMouseLeave={() => setHint(false)}
            aria-label="Open the photo album"
            className="group relative block h-32 w-32 rounded-3xl sm:h-36 sm:w-36"
          >
            <span
              aria-hidden
              className="absolute -inset-3 rounded-[2rem] opacity-60 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
              // Both strands, orbiting. A single-hue halo reads as a glow;
              // two make it look like the same system the background runs.
              style={{
                background:
                  "conic-gradient(from 0deg, #d97742, #2dd4bf, transparent, #d97742)",
                animation: "devSpin 8s linear infinite",
              }}
            />
            <span className="absolute inset-0 overflow-hidden rounded-3xl border border-white/10">
              <img
                src="/dev/profile.webp"
                alt="Pandian Sambath"
                className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500 group-hover:opacity-0"
              />
              {/* The second photo is not decoration — hovering swaps to it. */}
              <img
                src="/dev/profile-alt.webp"
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-105 object-cover opacity-0 transition-all duration-500 group-hover:scale-100 group-hover:opacity-100"
              />
            </span>
            <span
              className={`absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-xl border border-[#d97742]/40 bg-[#0d1219] text-xs text-[#f0a064] transition-all duration-300 ${
                hint ? "scale-100 opacity-100" : "scale-75 opacity-0"
              }`}
            >
              ⌗
            </span>
          </button>
        </div>

        <h1
          className="mt-7 text-center text-4xl font-semibold tracking-tight sm:text-5xl"
          style={entered ? { animation: "devFadeUp .8s .2s ease-out both" } : undefined}
        >
          {entered ? (
            <DecryptText text="Pandian Sambath" delay={420} replayOnHover />
          ) : (
            "Pandian Sambath"
          )}
        </h1>

        <p
          className="mt-2.5 text-center font-mono text-[13px] tracking-[0.14em] text-[#7d93ad]"
          style={entered ? { animation: "devFadeUp .8s .28s ease-out both" } : undefined}
        >
          {entered ? <DecryptText text="SYSTEM ENGINEER" delay={760} speed={26} /> : "SYSTEM ENGINEER"}
          <span className="mx-2 text-[#d97742]">·</span>
          {entered ? <DecryptText text="TATA CONSULTANCY SERVICES" delay={900} speed={20} /> : "TATA CONSULTANCY SERVICES"}
        </p>

        <p
          className="mt-1.5 text-center text-sm text-[#5b6e85]"
          style={entered ? { animation: "devFadeUp .8s .34s ease-out both" } : undefined}
        >
          Chennai, India
        </p>

        {/* ── Live experience ──────────────────────────────────────────── */}
        <div
          className="mt-9 w-full max-w-md rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 backdrop-blur-sm"
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

        {/* ── Contact ──────────────────────────────────────────────────── */}
        <div
          className="mt-7 grid w-full max-w-md grid-cols-1 gap-2 sm:grid-cols-2"
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
            a few seconds; something that answers back holds people. */}
        <div
          className="mt-7 flex w-full max-w-md justify-center"
          style={entered ? { animation: "devFadeUp .8s .58s ease-out both" } : undefined}
        >
          <Terminal onAlbum={openAlbum} experience={exp ? exp.decimal : "2"} />
        </div>

        <p
          className="mt-6 text-center font-mono text-[10px] tracking-[0.22em] text-[#2e3c4c]"
          style={entered ? { animation: "devFadeUp .8s .68s ease-out both" } : undefined}
        >
          TAP THE AVATAR — OR RUN <span className="text-[#5b6e85]">album</span>
        </p>
      </main>

      {albumOpen && <Album photos={photos} onClose={() => setAlbumOpen(false)} />}
    </div>
  );
}
