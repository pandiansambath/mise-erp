"use client";

// A LITTLE ⓘ THAT EXPLAINS ONE SENTENCE.
//
//   "here u showing expected 1 but not yet — here have a i icon to explain that
//    sentence."
//
// The alternative was writing the explanation into the line itself, and that is
// how a summary strip turns into a paragraph: the number you glance at every
// morning ends up buried in a caveat you needed to read exactly once.
//
// A tooltip would have been the obvious reach and the wrong one. Hover does not
// exist on the phone he checks this on, `title=""` cannot be styled or read by
// a screen reader in any dependable way, and it disappears the moment the
// pointer twitches. This is a button that opens a small panel and stays open
// until dismissed — click on any device, Escape to close.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function InfoDot({
  label,
  children,
  align = "start",
}: {
  /** What the ⓘ is explaining — read out instead of the word "info". */
  label: string;
  children: React.ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const id = useId();

  // WHY THIS IS A PORTAL AND NOT AN ABSOLUTE CHILD.
  //
  //   "rota page: UI bugs see — 2 popups are fighting to show."
  //
  // It was `absolute … z-50` next to its button, and a shift card two hundred
  // pixels away painted straight over the top of it. z-index only orders things
  // inside the same stacking context, and any ancestor with a transform,
  // filter, opacity or its own z-index starts a new one — so a z-50 that looks
  // enormous in the markup can be trapped below a plain `relative` card that
  // simply comes later in a different context. Animated pages are full of
  // transforms, which is why this kind of bug always arrives late.
  //
  // Rendering into <body> takes the panel out of every ancestor context there
  // is, and `fixed` coordinates measured from the button keep it attached. Same
  // fix, and same reason, as the one that stopped popups being centred inside
  // the blurred header.
  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const w = Math.min(360, window.innerWidth - 24);
    // Prefer the requested side, then keep it on screen — a note that explains
    // something is no use half off the edge of a phone.
    let left = align === "end" ? b.right - w : b.left;
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    setAt({ top: b.bottom + 8, left });
  }, [align]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      const t = e.target as Node;
      if (!btn.current?.contains(t) && !panel.current?.contains(t)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Scrolling or resizing moves the button; the panel has to follow it or it
    // ends up pointing at nothing.
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="mise-press grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border border-line-2 bg-paper-2 align-middle text-[10px] font-bold leading-none text-fg-soft transition hover:border-brand-400/60 hover:text-brand-300"
      >
        i
      </button>
      {mounted &&
        open &&
        at &&
        createPortal(
          <span
            ref={panel}
            id={id}
            role="note"
            style={{ top: at.top, left: at.left, width: Math.min(360, window.innerWidth - 24) }}
            // z-[95] sits under a SheetPopup's backdrop (z-70/80) is wrong —
            // this can be opened from INSIDE a sheet, so it has to clear one.
            className="mise-pop fixed z-[95] rounded-xl border border-line bg-paper-2 p-3 text-left text-xs font-normal leading-relaxed text-fg-soft shadow-2xl shadow-black/30"
          >
            {children}
          </span>,
          document.body,
        )}
    </>
  );
}
