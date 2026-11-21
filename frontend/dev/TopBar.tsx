"use client";

// The bar across the top of every design.
//
//   "these details I think we can remove from here and place in top of the
//    page so that if I enter site I can see my needed detail handy"
//
// The ways to reach him, the résumé, and the studio (themes and designs), in
// reach from the first second on every screen. Icons pop in one after another
// once the intro has been passed.

import { useRef, useState } from "react";
import { EMAIL, LINKS, useDev } from "./context";
import { IconCopy, IconDoc, IconGitHub, IconInstagram, IconLinkedIn, IconMail, IconPalette } from "./icons";
import { originOf, type Origin } from "./Popup";
import { Studio } from "./Studio";
import { Wave } from "./flourish";

const BTN =
  "group relative grid h-9 w-9 place-items-center rounded-full border border-[var(--d-line)] bg-[var(--d-glass)] text-[var(--d-ink3)] transition duration-300 hover:-translate-y-0.5 hover:border-[var(--d-b)] hover:text-[var(--d-ink)] sm:h-10 sm:w-10";

function Tip({ children }: { children: string }) {
  return (
    <span className="pointer-events-none absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--d-line)] bg-[var(--d-bg2)] px-2 py-1 font-mono text-[10px] tracking-[0.1em] text-[var(--d-ink2)] opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
      {children}
    </span>
  );
}

export function TopBar() {
  const { entered, resume, openResume, toast, openOwner } = useDev();
  const [studio, setStudio] = useState<Origin | false>(false);
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
  const pop = (i: number) => (entered ? { animation: `devPop .5s ${0.15 + i * 0.06}s cubic-bezier(.2,1.4,.4,1) both` } : { opacity: 0 });

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
        className="fixed inset-x-0 top-0 z-40 border-b border-[var(--d-line)] backdrop-blur-xl transition-transform duration-700"
        style={{
          background: "color-mix(in srgb, var(--d-bg) 68%, transparent)",
          transform: entered ? "translateY(0)" : "translateY(-100%)",
        }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 sm:h-16 sm:px-6">
          <a href="#top" onClick={onMonogram} className="flex min-w-0 items-center gap-2.5" aria-label="Back to the top">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-display text-[15px] font-semibold text-[var(--d-on)] shadow-[0_6px_20px_-8px_var(--d-b)]"
              style={{ background: "linear-gradient(135deg, var(--d-a2), var(--d-b))" }}
            >
              PS
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-[13px] font-semibold leading-tight">
                <Wave text="Pandian Sambath" />
              </span>
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] text-[var(--d-ink5)]">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--d-b)] opacity-70 motion-safe:animate-ping" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--d-b)]" />
                </span>
                CHENNAI · INDIA
              </span>
            </span>
          </a>

          <nav className="ml-auto flex items-center gap-1.5 sm:gap-2" aria-label="Contact">
            <button type="button" onClick={copyEmail} className={BTN} style={pop(0)} aria-label="Copy email address">
              <IconMail />
              <Tip>COPY EMAIL</Tip>
            </button>
            <a href={LINKS.linkedin} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(1)} aria-label="LinkedIn">
              <IconLinkedIn />
              <Tip>LINKEDIN</Tip>
            </a>
            <a href={LINKS.github} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(2)} aria-label="GitHub">
              <IconGitHub />
              <Tip>GITHUB</Tip>
            </a>
            <a href={LINKS.instagram} target="_blank" rel="noopener noreferrer" className={BTN} style={pop(3)} aria-label="Instagram">
              <IconInstagram />
              <Tip>INSTAGRAM</Tip>
            </a>
            {resume && (
              <button
                type="button"
                onClick={openResume}
                style={pop(4)}
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
              style={pop(5)}
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
