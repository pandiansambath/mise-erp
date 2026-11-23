"use client";

// The top of every design: no bar — a menu poured from the cards' water.
//
//   "these details I think we can remove from here and place in top of the
//    page so that if I enter site I can see my needed detail handy"
//   "the top bar is fully black… try to make this also like our card
//    animation… so that all UI will be in sync" (22 Nov)
//   "still I don't accept this top menu bar… not adapting to the UI
//    perfectly… think in a unique way for this… any new animation too for the
//    top menu bar" (23 Nov)
//
// Nothing spans the screen. The PS monogram and the buttons float, each one a
// drop of the cards' water, and surface tension merges the buttons into one
// capsule (LiquidBar: a WebGL field behind them). Drops fall in on arrival;
// the one under the cursor swells; the liquid reaches for the pointer; a fast
// scroll pulls it apart into bobbing beads that flow back together. His name
// pours out of the PS drop only when the big nameplate is off the screen, so
// it is never said twice at once.

import { useEffect, useRef, useState } from "react";
import { EMAIL, LINKS, useDev } from "./context";
import { IconCopy, IconDoc, IconGitHub, IconInstagram, IconLinkedIn, IconMail, IconPalette } from "./icons";
import { LiquidBar } from "./LiquidBar";
import type { Player } from "./music";
import { originOf, type Origin } from "./Popup";
import { SoundControl } from "./SoundControl";
import { Studio } from "./Studio";
import { Wave } from "./flourish";

// A button inside the liquid: no frame of its own — the drop is its frame.
const ICON =
  "group relative grid h-9 w-9 place-items-center rounded-full text-[var(--d-ink3)] transition duration-300 hover:text-[var(--d-ink)] sm:h-10 sm:w-10";

function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-full mt-3 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--d-line)] bg-[var(--d-bg2)] px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-[var(--d-ink2)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

/** Whether the design's big nameplate is on screen (none on the page counts
 *  as off: the menu then carries the name). */
function useHeroOnScreen(designId: string): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let io: IntersectionObserver | null = null;
    // After the design has rendered its nameplate.
    const id = window.setTimeout(() => {
      const hero = document.querySelector("[data-hero-name]");
      if (!hero) {
        setOn(false);
        return;
      }
      io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: "-72px 0px 0px 0px" });
      io.observe(hero);
    }, 300);
    return () => {
      window.clearTimeout(id);
      io?.disconnect();
    };
  }, [designId]);
  return on;
}

export function TopBar({ player }: { player: Player | null }) {
  const { entered, resume, openResume, toast, openOwner, designId } = useDev();
  const [studio, setStudio] = useState<Origin | false>(false);
  const bar = useRef<HTMLElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const liquid = useRef<LiquidBar | null>(null);
  // No WebGL: the drops are plain glass instead (globals.css).
  const [glass, setGlass] = useState(false);
  const heroOn = useHeroOnScreen(designId);

  useEffect(() => {
    const host = bar.current;
    const c = canvas.current;
    if (!host || !c) return;
    const l = new LiquidBar(c, host);
    if (l.init()) liquid.current = l;
    else {
      l.dispose();
      setGlass(true);
    }
    return () => {
      liquid.current = null;
      l.dispose();
    };
  }, []);
  useEffect(() => {
    if (entered) liquid.current?.enter();
  }, [entered]);
  useEffect(() => {
    liquid.current?.setName(!heroOn);
  }, [heroOn]);
  // The drops follow the layout: the résumé button and the music arrive late.
  useEffect(() => {
    const id = window.setTimeout(() => liquid.current?.measure(), 60);
    return () => window.clearTimeout(id);
  }, [resume, player, entered]);

  // The hidden door: three taps within a second on the monogram (his ask: "hidden,
  // don't show clearly"). One or two taps still just go back to the top.
  const taps = useRef<number[]>([]);
  const onMonogram = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1000), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      openOwner();
    }
  };
  // Each icon pops as its drop lands: LiquidBar starts drop i falling at
  // i × 0.07 s, and a drop takes about 0.22 s to land.
  const pop = (i: number) => (entered ? { animation: `devPop .5s ${0.22 + i * 0.07}s cubic-bezier(.2,1.4,.4,1) backwards` } : { opacity: 0 });

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast(`Copied ${EMAIL}`);
    } catch {
      window.location.href = LINKS.email;
    }
  };

  return (
    <>
      <header
        ref={bar}
        data-liquid-glass={glass ? "" : undefined}
        className="dev-liquidbar pointer-events-none fixed inset-x-0 top-0 z-40"
      >
        {/* The liquid: behind the buttons, the width of the screen, clear
            everywhere but the drops. */}
        <canvas ref={canvas} aria-hidden className="absolute inset-0 h-full w-full" />
        <div className="relative mx-auto flex h-[68px] max-w-6xl items-center gap-2 px-3 sm:h-[76px] sm:px-6">
          <div className="pointer-events-auto flex items-center gap-2">
            <a
              href="#top"
              onClick={onMonogram}
              data-liquid
              data-liquid-radius="15"
              aria-label="Back to the top"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
              style={pop(0)}
            >
              <span
                className="grid h-9 w-9 place-items-center rounded-xl font-display text-[15px] font-semibold text-[var(--d-on)] shadow-[0_6px_20px_-8px_var(--d-b)]"
                style={{ background: "linear-gradient(135deg, var(--d-a2), var(--d-b))" }}
              >
                PS
              </span>
            </a>
            {/* His name pours out of the PS drop when the nameplate is gone;
                its words fade in over the last part of the pour (--pour, which
                LiquidBar writes as the liquid moves). Plain glass: a fade. */}
            <span
              data-liquid="name"
              aria-hidden={heroOn}
              className={`hidden h-11 min-w-0 flex-col justify-center pl-4 pr-6 sm:flex ${glass ? "transition-opacity duration-500" : ""}`}
              style={glass ? { opacity: heroOn ? 0 : 1 } : { opacity: "clamp(0, calc((var(--pour, 0) - 0.6) * 2.5), 1)" }}
            >
              <span className="block truncate text-[13px] font-semibold leading-tight">
                <Wave text="Pandian Sambath" />
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] text-[var(--d-ink4)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--d-b)] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--d-b)]" />
                </span>
                SYSTEM ENGINEER · CHENNAI
              </span>
            </span>
          </div>

          <nav className="pointer-events-auto ml-auto flex items-center gap-1 sm:gap-1.5" aria-label="Contact">
            <SoundControl player={player} style={pop(1)} />
            <button type="button" onClick={copyEmail} data-liquid className={ICON} style={pop(2)} aria-label="Copy email address">
              <IconMail />
              <Tip>COPY EMAIL</Tip>
            </button>
            <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" data-liquid className={ICON} style={pop(3)} aria-label="LinkedIn">
              <IconLinkedIn />
              <Tip>LINKEDIN</Tip>
            </a>
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer" data-liquid className={ICON} style={pop(4)} aria-label="GitHub">
              <IconGitHub />
              <Tip>GITHUB</Tip>
            </a>
            <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" data-liquid className={ICON} style={pop(5)} aria-label="Instagram">
              <IconInstagram />
              <Tip>INSTAGRAM</Tip>
            </a>
            {resume && (
              <button
                type="button"
                onClick={openResume}
                data-liquid
                style={pop(6)}
                className="group relative ml-0.5 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-[var(--d-on)] shadow-[0_8px_24px_-10px_var(--d-b)] transition hover:brightness-110 sm:h-10 sm:px-4"
              >
                <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }} />
                <IconDoc className="relative" width={16} height={16} />
                <span className="relative hidden sm:inline">Résumé</span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => setStudio(originOf(e.currentTarget))}
              data-liquid
              className={ICON}
              style={pop(7)}
              aria-label="Themes and designs"
            >
              <IconPalette />
              <Tip>THEMES & DESIGNS</Tip>
            </button>
          </nav>
        </div>
      </header>
      {studio !== false && <Studio origin={studio} onClose={() => setStudio(false)} />}
    </>
  );
}

/** A small message that rises from the bottom and leaves on its own. */
export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      key={message}
      role="status"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[90] flex justify-center px-4"
      style={{ animation: "devToast 2.4s ease both" }}
    >
      <span className="inline-flex items-center gap-2 rounded-full border border-[var(--d-line2)] bg-[var(--d-bg2)] px-4 py-2.5 text-[13px] text-[var(--d-ink)] shadow-2xl">
        <IconCopy width={15} height={15} className="text-[var(--d-b)]" />
        {message}
      </span>
    </div>
  );
}
