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
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { dropDoors, rememberedWords, rememberWords } from "@/dev/awardDoor";
import { AWARD_MODEL_FILES, DOOR_IMG } from "@/dev/awardFiles";
import { arrive } from "@/dev/chunks";
import { cleanCopy, safeLink, word } from "@/dev/copy";
import { PlainAward } from "@/dev/Medal";
import { AWARD_TRACK, setSoundMuted, soundMuted } from "@/dev/music";

// The room's code, all of it at once rather than each piece asking for the next.
if (typeof window !== "undefined") {
  void Promise.all([import("@/dev/AwardStage"), import("@/dev/awardRoom"), import("three"), import("three/examples/jsm/loaders/GLTFLoader.js")]).catch(() => {});
}

// Cinzel: cut from Roman inscriptional capitals — the lettering on monuments
// and coins. He asked for "an ancient feel", and this is literally the shape
// carved into stone, which is the right voice for an award.
const ancient = localFont({ src: "../fonts/cinzel.woff2", weight: "400 700", display: "swap" });

// Browser-only: WebGL cannot be server-rendered, and the renderer should not
// be in anybody's bundle until they ask for this page.
// And if it will not come (an old page after a deploy, a phone's network) the
// page comes afresh once, then the plain medal stands in: never an error.
const AwardStage = dynamic(() => arrive(() => import("@/dev/AwardStage").then((m) => m.AwardStage), PlainAward), {
  ssr: false,
  loading: () => null,
});

/** A line of his, with what he put between *stars* in bold. */
function Bold({ text }: { text: string }) {
  return text.split("*").map((part, i) => (i % 2 ? <b key={i}>{part}</b> : <Fragment key={i}>{part}</Fragment>));
}

export default function AwardPage() {
  const [opened, setOpened] = useState(false);
  // His words for the room (the Template): brought from the profile, or asked for.
  const [words, setWords] = useState(rememberedWords);
  useEffect(() => {
    if (words.known) return;
    let on = true;
    const slow = window.setTimeout(() => on && setWords((w) => ({ ...w, known: true })), 2500);
    fetch("/api/dev-site/texts.json")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((raw) => {
        if (!on) return;
        const copy = cleanCopy(raw);
        rememberWords(copy);
        setWords({ copy, known: true });
      });
    return () => {
      on = false;
      window.clearTimeout(slow);
    };
  }, [words.known]);
  const w = (key: string) => word(words.copy, key);

  // The doors (§103.2): shut until the room stands behind them; the light in their
  // crack is as much of it as has come.
  const [ready, setReady] = useState(false);
  const [awake, setAwake] = useState(false);
  const [plain, setPlain] = useState(false);
  const [slow, setSlow] = useState(false);
  const doors = useRef<HTMLDivElement>(null);
  const onReady = useCallback(() => setReady(true), []);
  const onOpened = useCallback(() => setOpened(true), []);
  const onAwake = useCallback(() => setAwake(true), []);
  const onProgress = useCallback((p: number) => doors.current?.style.setProperty("--p", p.toFixed(3)), []);
  const open = ready && words.known;
  useEffect(() => {
    // The doors that were shut over the profile: these, the same, are here now.
    const raf = requestAnimationFrame(() => requestAnimationFrame(dropDoors));
    const t = window.setTimeout(() => setSlow(true), 12000);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
      dropDoors();
    };
  }, []);
  // The room's music: his track ("in treasure chest area i said to add music
  // but music not playing… use this"), from the bucket beside the site's
  // songs and fetched during the site's intro. It replaces a score generated
  // live in WebAudio, which stayed silent whenever the audio context had not
  // been woken. A plain audio element has one way to fail — the browser
  // refusing sound before a tap — and that is answered below.
  const [muted, setMuted] = useState(false);
  const track = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    const m = soundMuted();
    setMuted(m);
    const el = new Audio(AWARD_TRACK);
    // Not el.loop: each time round it fades out at its end, a short quiet,
    // and fades in again — like every song on the site ("even for a single
    // song… follow it too").
    el.loop = false;
    el.preload = "auto";
    el.muted = m;
    el.volume = 0;
    track.current = el;
    let fade: ReturnType<typeof setInterval> | null = null;
    const fadeTo = (to: number, ms: number, then?: () => void) => {
      if (fade) clearInterval(fade);
      const from = el.volume;
      const steps = Math.max(1, Math.round(ms / 50));
      let k = 0;
      fade = setInterval(() => {
        k += 1;
        el.volume = Math.min(1, Math.max(0, from + ((to - from) * k) / steps));
        if (k >= steps) {
          if (fade) clearInterval(fade);
          fade = null;
          then?.();
        }
      }, 50);
    };
    const start = () => {
      if (!el.paused || el.muted) return;
      void el
        .play()
        .then(() => fadeTo(0.45, 2000))
        .catch(() => {
          /* refused before a tap: the listeners below try again */
        });
    };
    start();
    let leaving = false;
    let again: ReturnType<typeof setTimeout> | null = null;
    const onTime = () => {
      if (leaving || el.paused || !el.duration || Number.isNaN(el.duration)) return;
      if (el.duration - el.currentTime <= 3.2) {
        leaving = true;
        fadeTo(0, 3000);
      }
    };
    const onEnded = () => {
      again = setTimeout(() => {
        if (track.current !== el) return;
        leaving = false;
        el.currentTime = 0;
        void el
          .play()
          .then(() => fadeTo(0.45, 2600))
          .catch(() => {});
      }, 1400);
    };
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    // Opened directly, a browser keeps sound off until the first tap or key.
    // Striking the chest IS a tap, so at the latest the first hit starts it.
    const wake = () => start();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      if (again) clearTimeout(again);
      fadeTo(0, 500, () => el.pause());
      track.current = null;
    };
  }, []);
  const toggle = () => {
    const m = !muted;
    setMuted(m);
    setSoundMuted(m);
    const el = track.current;
    if (!el) return;
    el.muted = m;
    if (!m && el.paused) {
      el.volume = 0.45;
      void el.play().catch(() => {});
    }
  };

  return (
    <main className={`${ancient.className} fixed inset-0 overflow-hidden bg-[#07060a] text-[#e6edf5]`}>
      {/* The app's touch ripple is off in here: a ring of water on a wooden
          chest breaks the room; the blow leaves its own mark. */}
      <style>{`.mise-ripple{display:none!important}`}</style>
      {/* Start the chest downloading with the HTML, not after the renderer has
          booted. It used to be requested only once three.js had parsed and the
          scene was built, which put the whole model behind a chain of waits. */}
      {AWARD_MODEL_FILES.map((href) => (
        <link key={href} rel="preload" as={href.includes("/vault_floor/") ? "image" : "fetch"} href={href} crossOrigin="anonymous" />
      ))}
      <link rel="preload" as="image" href={DOOR_IMG} />

      <AwardStage
        onOpened={onOpened}
        onReady={onReady}
        onProgress={onProgress}
        onAwake={onAwake}
        plain={plain}
        words={{ strike: w("awardStrike"), again: w("awardAgain"), breaking: w("awardBreaking"), coinLink: safeLink(w("coinLink")) ?? "", coinHint: w("coinHint") }}
      />

      {/* Above: whose award it is. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 px-6 pt-6 text-center sm:pt-8">
        <p
          className="dev-gold text-[10px] font-semibold tracking-[0.42em] sm:text-[11px]"
          style={{ animation: "devFadeUp .8s .1s ease-out both" }}
        >
          {w("awardTop")}
        </p>
        <h1
          className="dev-gold mt-2 font-display text-2xl font-semibold sm:text-4xl"
          style={{ animation: "devFadeUp .8s .2s ease-out both" }}
        >
          {w("awardTitle")}
        </h1>
        {/* The verse on the wall, once its lamps are lit. */}
        <p
          className={`mx-auto mt-2 max-w-md text-[11px] leading-relaxed text-[#e9c98d] transition-opacity duration-[1600ms] sm:text-[12.5px] ${awake ? "opacity-90" : "opacity-0"}`}
          style={{ textShadow: "0 1px 10px rgba(0,0,0,.9)" }}
        >
          “{w("awardVerse")}” <span className="whitespace-nowrap text-[9px] tracking-[0.24em] text-[#b98f52]">{w("awardVerseBy")}</span>
        </p>
      </div>

      {/* Below: the citation, which only earns its place once it is open. */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 px-6 pb-7 pt-20 text-center transition-opacity duration-1000 ${
          opened ? "opacity-100" : "opacity-0"
        }`}
        style={{ background: "linear-gradient(to top, rgba(7,6,10,.94) 34%, rgba(7,6,10,.55) 72%, transparent)" }}
      >
        <p className="dev-gold mx-auto max-w-2xl text-[13px] leading-relaxed sm:text-base">
          <Bold text={w("awardCitation")} />
        </p>
        <a
          // It moved to the private bucket in October; the old /dev/ path is a 404.
          // #page=35 opens it at his name.
          href={safeLink(w("awardProofLink")) ?? "/api/dev-site/RANK_AFF_UG_2023.pdf#page=35"}
          target="_blank"
          rel="noreferrer noopener"
          // An award nobody can check is a claim. The line that names the
          // source may as well BE the source.
          className="dev-gold pointer-events-auto mt-2.5 inline-block text-[9px] tracking-[0.24em] underline-offset-4 hover:underline sm:text-[10px]"
        >
          {w("awardProof")} ↗
        </a>
      </div>

      {/* The music: one tap to silence it, remembered across the site. */}
      <button
        type="button"
        onClick={toggle}
        aria-label={muted ? "Play music" : "Mute music"}
        className="absolute left-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-[#c08a4e]/35 text-[#c08a4e] transition hover:border-[#c08a4e]/70 hover:bg-[#c08a4e]/10 sm:bottom-6 sm:left-6 sm:top-auto"
      >
        <span aria-hidden className="flex h-4 items-end gap-[3px]">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="w-[3px] rounded-full bg-[#e0a95c]"
              style={{ height: muted ? "3px" : undefined, animation: muted ? undefined : `devEq ${0.8 + i * 0.2}s ${i * 0.12}s ease-in-out infinite alternate` }}
            />
          ))}
        </span>
      </button>

      {/* Out. A corner ✕, like everything full-screen anybody has closed. */}
      <Link
        href="/"
        prefetch={false}
        aria-label="Back"
        className="absolute right-4 top-4 z-10 grid h-11 w-11 place-items-center rounded-full border border-[#c08a4e]/35 text-lg text-[#c08a4e] transition hover:border-[#c08a4e]/70 hover:bg-[#c08a4e]/10 hover:text-[#f0d5a8] sm:right-6 sm:top-6"
      >
        ✕
      </Link>

      {/* The doors, over everything, until the room is there. */}
      <div ref={doors} className="award-doors" data-open={open ? "" : undefined} style={{ ["--p" as string]: words.known ? 0.6 : 0.04 }} role={open ? undefined : "status"} aria-label={open ? undefined : "Opening the award room"} aria-hidden={open || undefined}>
        <div className="award-door award-door-l" />
        <div className="award-door award-door-r" />
        <i className="award-crack" />
        <div className="award-flood" />
        {slow && !open && (
          <div className="absolute inset-x-0 bottom-[12%] text-center" style={{ animation: "devFadeUp .8s ease-out both" }}>
            <p className="text-[11px] tracking-[0.3em] text-[#e0a95c]">THE ROOM IS ON ITS WAY…</p>
            <button type="button" onClick={() => setPlain(true)} className="mt-4 rounded-full border border-[#c08a4e]/50 bg-[#0a0706]/80 px-5 py-2.5 text-[12px] text-[#f0d5a8]">
              Show the medal instead
            </button>
          </div>
        )}
      </div>
      <noscript>
        <style>{`.award-doors{display:none}`}</style>
      </noscript>
    </main>
  );
}
