"use client";

// The bar across the top of every design.
//
//   "these details I think we can remove from here and place in top of the
//    page so that if I enter site I can see my needed detail handy"
//   "the top bar is fully black and inside that we place buttons… even this
//    is also a disturbance… try to make this also like our card animation…
//    so that all UI will be in sync and adapt to animations" (22 Nov)
//   "is that Pandian Sambath (green dot) Chennai India really needed? Pandian
//    Sambath is already showing in a very big font on the front page" (22 Nov)
//
// The ways to reach him, the résumé, the music and the studio (themes and
// designs), in reach from the first second on every screen. The bar wears the
// cards' glass and water (a CardGL surface) and its buttons are glass over it,
// in the theme's own colours.
//
// His name comes into the bar only when the big nameplate has gone off the
// screen — like a large title collapsing into an app's bar — so it is never
// said twice at once.

import { useEffect, useRef, useState } from "react";
import { registerSurface } from "./CardGL";
import { EMAIL, LINKS, useDev } from "./context";
import { IconCopy, IconDoc, IconGitHub, IconInstagram, IconLinkedIn, IconMail, IconPalette } from "./icons";
import type { Player } from "./music";
import { originOf, type Origin } from "./Popup";
import { SoundControl } from "./SoundControl";
import { Studio } from "./Studio";
import { Wave } from "./flourish";

const BTN =
  "dev-glassbtn group relative grid h-9 w-9 place-items-center rounded-full text-[var(--d-ink3)] transition duration-300 hover:-translate-y-0.5 hover:text-[var(--d-ink)] sm:h-10 sm:w-10";

function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--d-line)] bg-[var(--d-bg2)] px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-[var(--d-ink2)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

/** Whether the design's big nameplate is on screen (none on the page counts
 *  as off: the bar then carries the name). */
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
      io = new IntersectionObserver(([e]) => setOn(e.isIntersecting), { rootMargin: "-64px 0px 0px 0px" });
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
  const water = useRef<HTMLSpanElement>(null);
  const heroOn = useHeroOnScreen(designId);

  useEffect(() => {
    const el = bar.current;
    const slot = water.current;
    if (!el || !slot) return;
    return registerSurface(el, slot, { radius: 0, hue: "var(--d-b)" });
  }, []);

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
  // `backwards`: the icons hold their first frame while they wait their turn,
  // and keep nothing afterwards (a `both` fill kept a GPU layer per icon).
  const pop = (i: number) => (entered ? { animation: `devPop .5s ${0.15 + i * 0.06}s cubic-bezier(.2,1.4,.4,1) backwards` } : { opacity: 0 });

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
        className="dev-surface dev-bar fixed inset-x-0 top-0 z-40 transition-transform duration-700"
        style={{ transform: entered ? "translateY(0)" : "translateY(-100%)" }}
      >
        {/* The water: a WebGL canvas the bar's size, behind everything. */}
        <span ref={water} aria-hidden className="dev-glsurface" />
        <div className="relative mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:px-6">
          <a href="#top" onClick={onMonogram} className="flex min-w-0 items-center gap-2.5" aria-label="Back to the top">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[15px] font-semibold text-[var(--d-on)] shadow-[0_6px_20px_-8px_var(--d-b)]"
              style={{ background: "linear-gradient(135deg, var(--d-a2), var(--d-b))" }}
            >
              PS
            </span>
            <span
              aria-hidden={heroOn}
              className="hidden min-w-0 transition-[opacity,transform] duration-500 ease-out sm:block"
              style={{ opacity: heroOn ? 0 : 1, transform: heroOn ? "translateY(8px)" : "none" }}
            >
              <span className="block truncate text-[13px] font-semibold leading-tight">
                <Wave text="Pandian Sambath" />
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] text-[var(--d-ink5)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--d-b)] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--d-b)]" />
                </span>
                SYSTEM ENGINEER · CHENNAI
              </span>
            </span>
          </a>

          <nav className="ml-auto flex items-center gap-1.5 sm:gap-2" aria-label="Contact">
            <SoundControl player={player} style={pop(0)} />
            <button type="button" onClick={copyEmail} className={BTN} style={pop(1)} aria-label="Copy email address">
              <IconMail />
              <Tip>COPY EMAIL</Tip>
            </button>
            <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(2)} aria-label="LinkedIn">
              <IconLinkedIn />
              <Tip>LINKEDIN</Tip>
            </a>
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(3)} aria-label="GitHub">
              <IconGitHub />
              <Tip>GITHUB</Tip>
            </a>
            <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(4)} aria-label="Instagram">
              <IconInstagram />
              <Tip>INSTAGRAM</Tip>
            </a>
            {resume && (
              <button
                type="button"
                onClick={openResume}
                style={pop(5)}
                className="group relative ml-0.5 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold text-[var(--d-on)] shadow-[0_8px_24px_-10px_var(--d-b)] transition hover:-translate-y-0.5 hover:brightness-110 sm:h-10 sm:px-4"
              >
                <span aria-hidden className="absolute inset-0 rounded-full" style={{ background: "linear-gradient(90deg, var(--d-a2), var(--d-b))" }} />
                <IconDoc className="relative" width={16} height={16} />
                <span className="relative hidden sm:inline">Résumé</span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => setStudio(originOf(e.currentTarget))}
              className={BTN}
              style={pop(6)}
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
