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
// until dismissed — click on any device, Escape to close, focus returned.

import { useEffect, useId, useRef, useState } from "react";

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
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    function away(e: MouseEvent) {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <span ref={wrap} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="mise-press grid h-[18px] w-[18px] place-items-center rounded-full border border-line-2 bg-paper-2 text-[10px] font-bold leading-none text-fg-soft transition hover:border-brand-400/60 hover:text-brand-300"
      >
        i
      </button>
      {open && (
        <span
          id={id}
          role="note"
          // Sized in ch rather than rem: this is a paragraph, and a measure of
          // roughly 40 characters is what makes one readable at this size.
          className={`mise-pop absolute top-[26px] z-50 w-[min(38ch,80vw)] rounded-xl border border-line bg-paper-2 p-3 text-left text-xs font-normal leading-relaxed text-fg-soft shadow-2xl shadow-black/30 ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
