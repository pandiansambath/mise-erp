"use client";

// The top of every design: no bar, no capsule — the menu is words.
//
//   "these details I think we can remove from here and place in top of the
//    page so that if I enter site I can see my needed detail handy"
//   "the top bar is fully black… try to make this also like our card
//    animation… so that all UI will be in sync" (22 Nov)
//   "still I don't accept this top menu bar… think in a unique way" (23 Nov)
//   "the top menu bar design seriously I don't like… I can literally see those
//    very clearly, which takes my attention to them… also that résumé button
//    still has the old [style], no consistency among them… please think in a
//    unique way to solve this" (23 Nov, after the liquid capsules)
//
// Three tries drew something behind the buttons — a black bar, a water bar,
// liquid capsules — and each one pulled the eye. So nothing is drawn: the
// menu is WRITTEN, in the page's own hand (the small spaced capitals of
// "HELLO, I'M"), in quiet ink that brightens only under the cursor, every item
// in one style — the résumé too (it keeps the accent colour, nothing more).
//   · Each word decrypts into place on arrival, the way his name scrambles.
//   · Under the cursor a hairline draws beneath the word and ends in a small
//     link of chain.
//   · It steps aside while you read: scrolling down it slides up and away,
//     leaving one small node in the corner; scrolling up — or pointing at the
//     top of the screen, or tapping the node — brings it back.
//   · A phone shows the same items as thin line icons, nothing behind them.
// His name joins the PS mark only while the big nameplate is off the screen,
// so it is never said twice at once. No WebGL here at all: a phone allows only
// so many live WebGL contexts, and the one the liquid menu took cost the page
// its background (§100.2).

import { useEffect, useRef, useState } from "react";
import { EMAIL, LINKS, useDev } from "./context";
import { word } from "./copy";
import { IconCopy, IconDoc, IconGitHub, IconInstagram, IconLinkedIn, IconMail, IconPalette } from "./icons";
import type { Player } from "./music";
import { originOf, type Origin } from "./Popup";
import { SoundControl } from "./SoundControl";
import { Studio } from "./Studio";
import { Wave } from "./flourish";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#%&*+<>/";

/** A word that decrypts into place: random glyphs settling letter by letter,
 *  on the clock (a slow frame never leaves it scrambled). The real word stays
 *  in the DOM the whole time (transparent while the glyphs run over it), so
 *  nothing shifts and a screen reader reads the word. */
function Decrypt({ text, start, delay }: { text: string; start: boolean; delay: number }) {
  const word = useRef<HTMLSpanElement>(null);
  const over = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const w = word.current;
    const o = over.current;
    if (!w || !o || !start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t0 = performance.now() + delay * 1000;
    const settle = (j: number) => 200 + j * 32;
    const end = settle(text.length);
    let raf = 0;
    let swapped = -1;
    w.style.color = "transparent";
    const tick = (now: number) => {
      const t = now - t0;
      if (t >= end) {
        o.textContent = "";
        w.style.color = "";
        return;
      }
      raf = requestAnimationFrame(tick);
      // New glyphs every 45 ms, not every frame.
      const step = Math.floor(t / 45);
      if (step === swapped) return;
      swapped = step;
      let s = "";
      for (let j = 0; j < text.length; j++) {
        const c = text[j];
        if (t < 0) s += " ";
        else if (c === " " || t >= settle(j)) s += c;
        else s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }
      o.textContent = s;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      o.textContent = "";
      w.style.color = "";
    };
  }, [start, text, delay]);
  return (
    <span className="relative inline-block">
      <span ref={word}>{text}</span>
      <span ref={over} aria-hidden className="absolute inset-0 whitespace-pre" />
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

/** Tucked away while the page is read downwards; back on any scroll up, near
 *  the top of the page, or when a mouse comes to the top of the screen. */
function useTucked(): [boolean, () => void] {
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let run = 0;
    const onScroll = () => {
      const y = window.scrollY;
      const dy = y - last;
      last = y;
      if (y < 160) {
        run = 0;
        setTucked(false);
        return;
      }
      // A little travel in one direction before it changes its mind.
      run = Math.sign(dy) === Math.sign(run) ? run + dy : dy;
      if (run > 28) setTucked(true);
      else if (run < -14) setTucked(false);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.clientY < 80) setTucked(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);
  return [tucked, () => setTucked(false)];
}

// One style for every item: the words on a wide screen, thin icons on a narrow
// one, never anything behind them.
const ITEM = "dev-navlink group relative inline-flex h-10 items-center justify-center text-[var(--d-ink3)] transition-colors duration-300 hover:text-[var(--d-ink)] lg:h-9";
const WORD = "hidden font-mono text-[10.5px] font-medium tracking-[0.24em] lg:inline";
const GLYPH = "lg:hidden";

export function TopBar({ player }: { player: Player | null }) {
  const { entered, resume, openResume, toast, openOwner, designId, copy } = useDev();
  const [studio, setStudio] = useState<Origin | false>(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const heroOn = useHeroOnScreen(designId);
  const [tuckedRaw, untuck] = useTucked();
  // Never tucked away while one of its menus is open.
  const tucked = tuckedRaw && !soundOpen && studio === false;

  // The hidden door: three taps within a second on the monogram (his ask:
  // "hidden, don't show clearly"). One or two taps still just go back to the top.
  const taps = useRef<number[]>([]);
  const onMonogram = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1000), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      openOwner();
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(EMAIL);
      toast(`Copied ${EMAIL}`);
    } catch {
      window.location.href = LINKS.email;
    }
  };

  // The order the words arrive in (and decrypt).
  const d = (i: number) => 0.18 + i * 0.08;
  const fade = (i: number) => (entered ? { animation: `devFadeUp .6s ${d(i)}s cubic-bezier(.2,.8,.2,1) backwards` } : { opacity: 0 });

  return (
    <>
      <header data-tucked={tucked ? "" : undefined} className="dev-topbar pointer-events-none fixed inset-x-0 top-0 z-40">
        <div className="dev-topbar-inner relative mx-auto flex h-[64px] max-w-6xl items-center gap-3 px-4 sm:h-[72px] sm:px-6">
          <div className="pointer-events-auto flex min-w-0 items-center gap-3">
            <a
              href="#top"
              onClick={onMonogram}
              aria-label="Back to the top"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[15px] font-semibold text-[var(--d-on)] shadow-[0_6px_20px_-8px_var(--d-b)]"
              style={{ background: "linear-gradient(135deg, var(--d-a2), var(--d-b))", ...fade(0) }}
            >
              PS
            </a>
            {/* His name joins the mark when the nameplate is gone. */}
            <span
              aria-hidden={heroOn}
              className="dev-navshade hidden min-w-0 flex-col justify-center transition-[opacity,transform] duration-500 sm:flex"
              style={{ opacity: heroOn ? 0 : 1, transform: heroOn ? "translateX(-6px)" : "none", transitionDelay: heroOn ? "0s" : ".1s" }}
            >
              <span className="block truncate text-[13px] font-semibold leading-tight text-[var(--d-ink)]">
                <Wave text={word(copy, "name")} />
              </span>
              <span className="truncate font-mono text-[9.5px] tracking-[0.18em] text-[var(--d-ink4)]">{word(copy, "barLine")}</span>
            </span>
          </div>

          <nav className="dev-navshade pointer-events-auto ml-auto flex items-center gap-1 sm:gap-2 lg:gap-7" aria-label="Contact">
            <div style={fade(1)}>
              <SoundControl player={player} onOpenChange={setSoundOpen} />
            </div>
            <button type="button" onClick={copyEmail} className={`${ITEM} w-9 lg:w-auto`} style={fade(2)} aria-label="Copy email address">
              <IconMail className={GLYPH} width={18} height={18} />
              <span className={WORD}>
                <Decrypt text="MAIL" start={entered} delay={d(2)} />
              </span>
            </button>
            <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className={`${ITEM} w-9 lg:w-auto`} style={fade(3)} aria-label="LinkedIn">
              <IconLinkedIn className={GLYPH} width={18} height={18} />
              <span className={WORD}>
                <Decrypt text="LINKEDIN" start={entered} delay={d(3)} />
              </span>
            </a>
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className={`${ITEM} w-9 lg:w-auto`} style={fade(4)} aria-label="GitHub">
              <IconGitHub className={GLYPH} width={18} height={18} />
              <span className={WORD}>
                <Decrypt text="GITHUB" start={entered} delay={d(4)} />
              </span>
            </a>
            <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className={`${ITEM} w-9 lg:w-auto`} style={fade(5)} aria-label="Instagram">
              <IconInstagram className={GLYPH} width={18} height={18} />
              <span className={WORD}>
                <Decrypt text="INSTAGRAM" start={entered} delay={d(5)} />
              </span>
            </a>
            {resume && (
              <button
                type="button"
                onClick={openResume}
                className={`${ITEM} w-9 !text-[var(--d-a)] hover:!text-[var(--d-a2)] lg:w-auto`}
                style={fade(6)}
                aria-label="Résumé"
              >
                <IconDoc className={GLYPH} width={18} height={18} />
                <span className={WORD}>
                  <Decrypt text="RÉSUMÉ" start={entered} delay={d(6)} />
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={(e) => setStudio(originOf(e.currentTarget))}
              className={`${ITEM} w-9 lg:w-auto`}
              style={fade(7)}
              aria-label="Themes and designs"
            >
              <IconPalette className={GLYPH} width={18} height={18} />
              <span className={WORD}>
                <Decrypt text="THEMES" start={entered} delay={d(7)} />
              </span>
            </button>
          </nav>
        </div>
        {/* What stays while it is tucked away: one small node in the corner. */}
        <button type="button" onClick={untuck} aria-label="Show the menu" tabIndex={tucked ? 0 : -1} className="dev-topbar-node pointer-events-auto absolute right-4 top-4 grid h-8 w-8 place-items-center sm:right-6 sm:top-5">
          <span aria-hidden className="block h-2 w-2 rounded-full border border-[var(--d-b2)]" />
        </button>
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
