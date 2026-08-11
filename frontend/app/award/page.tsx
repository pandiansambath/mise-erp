"use client";

// pandi-dev.dineai.cloud/award
//
// Its own page, not a panel over another one. That was his instruction and it
// is the right shape: a thing you break open deserves the whole screen, and a
// real route means it can be linked, shared and closed with the back button.
//
// One viewport. No scrolling anywhere — the stage is the screen, the words sit
// over the top and bottom of it where nothing needs covering, and the way out
// is a ✕ in the corner.

// Local — see app/layout.tsx.
import localFont from "next/font/local";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";

// Cinzel: cut from Roman inscriptional capitals — the lettering on monuments
// and coins. He asked for "an ancient feel", and this is literally the shape
// carved into stone, which is the right voice for an award.
const ancient = localFont({ src: "../fonts/cinzel.woff2", weight: "400 700", display: "swap" });

// Browser-only: WebGL cannot be server-rendered, and the renderer should not
// be in anybody's bundle until they ask for this page.
const AwardStage = dynamic(() => import("@/dev/AwardStage").then((m) => m.AwardStage), {
  ssr: false,
  loading: () => null,
});

export default function AwardPage() {
  const [opened, setOpened] = useState(false);

  return (
    <main className={`${ancient.className} fixed inset-0 overflow-hidden bg-[#07060a] text-[#e6edf5]`}>
      {/* Start the chest downloading with the HTML, not after the renderer has
          booted. It used to be requested only once three.js had parsed and the
          scene was built, which put the whole model behind a chain of waits. */}
      {/* eslint-disable-next-line @next/next/no-head-element */}
      <link rel="preload" as="fetch" href="/dev/models/chest.glb" crossOrigin="anonymous" />
      {/* The room. Lit from behind the chest, so the object sits IN something
          rather than on a black rectangle — "background is glowing like hell". */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(62% 50% at 50% 44%, #7a4d0f 0%, #45290a 26%, #1c1207 52%, #0a0709 76%, #06050a 100%)",
        }}
      />
      <div
        aria-hidden
        className={`dev-case-glow absolute inset-x-0 top-1/4 h-1/2 blur-[90px] transition-opacity duration-1000 ${
          opened ? "opacity-100" : "opacity-70"
        }`}
        style={{
          background: "radial-gradient(closest-side, rgba(255,186,84,.6), transparent 72%)",
        }}
      />

      <AwardStage onOpened={() => setOpened(true)} />

      {/* Above: whose award it is. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 px-6 pt-6 text-center sm:pt-8">
        <p
          className="dev-gold text-[10px] font-semibold tracking-[0.42em] sm:text-[11px]"
          style={{ animation: "devFadeUp .8s .1s ease-out both" }}
        >
          ANNA UNIVERSITY · 2023
        </p>
        <h1
          className="dev-gold mt-2 font-display text-2xl font-semibold sm:text-4xl"
          style={{ animation: "devFadeUp .8s .2s ease-out both" }}
        >
          Gold Medalist
        </h1>
      </div>

      {/* Below: the citation, which only earns its place once it is open. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-7 pt-20 text-center transition-opacity duration-1000 ${
          opened ? "opacity-100" : "opacity-0"
        }`}
        style={{ background: "linear-gradient(to top, rgba(7,6,10,.94) 34%, rgba(7,6,10,.55) 72%, transparent)" }}
      >
        <p className="dev-gold mx-auto max-w-2xl text-[13px] leading-relaxed sm:text-base">
          Presented to <b>Pandian Sambath</b> in recognition of
          placing <b>17th in the university</b> — B.Tech
          Information Technology, 92% — and for work done with care, patience and a
          refusal to leave things half finished.
        </p>
        <a
          href="/dev/RANK_AFF_UG_2023.pdf"
          target="_blank"
          rel="noreferrer noopener"
          // An award nobody can check is a claim. The line that names the
          // source may as well BE the source.
          className="dev-gold pointer-events-auto mt-2.5 inline-block text-[9px] tracking-[0.24em] underline-offset-4 hover:underline sm:text-[10px]"
        >
          RANK LIST · APRIL / MAY 2023 EXAMINATIONS ↗
        </a>
      </div>

      {/* Out. A corner ✕, like everything full-screen anybody has closed. */}
      <Link
        href="/"
        aria-label="Back"
        className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-[#c08a4e]/35 text-lg text-[#c08a4e] transition hover:border-[#c08a4e]/70 hover:bg-[#c08a4e]/10 hover:text-[#f0d5a8] sm:right-6 sm:top-6"
      >
        ✕
      </Link>
    </main>
  );
}
