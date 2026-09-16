"use client";

// THE STUDIO — where a page is designed, and the only place the preview lives.
//
//   "better can move the entire feature to a popup view... here we can freely do
//    the modification and see the preview too."
//   "currently i can see whenever i enter the setting im seeing that preview in
//    top — why? it need to show only when we reach the preview edit area."
//
// He is right on both counts, and they are the same point. A preview is not a
// decoration on a settings page; it is one half of an editor, and it means
// nothing next to a currency dropdown. Sitting permanently at the top of
// Settings it was in the way of every other job on that screen, and cramped
// while doing it — the controls got a third of the width and truncated their
// own labels ("Directions link (Google N").
//
// So designing a page is its own surface, opened deliberately: controls down one
// side with room to breathe, the page itself down the other at its real size.
// Nothing else on screen, because nothing else is the job.

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useBackToClose } from "@/components/useBackToClose";

export function PageStudio({
  open,
  onClose,
  title,
  subtitle,
  controls,
  preview,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** The form. Given real width, because it is a form. */
  controls: ReactNode;
  /** The live page. */
  preview: ReactNode;
  footer?: ReactNode;
}) {
  useBackToClose(open, onClose);

  /** Phone only. Desktop shows both columns and ignores this entirely. */
  const [tab, setTab] = useState<"edit" | "preview">("edit");

  const mobile = (
    <div className="flex shrink-0 gap-1 border-b border-line bg-paper px-4 py-2 lg:hidden">
      {(
        [
          ["edit", "Edit"],
          ["preview", "Preview"],
        ] as const
      ).map(([k, label]) => (
        <button
          key={k}
          type="button"
          onClick={() => setTab(k)}
          aria-pressed={tab === k}
          className={`mise-press min-h-[36px] flex-1 rounded-lg px-3 text-xs font-semibold transition ${
            tab === k ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll under a surface that fills the screen.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    /* `h-[100dvh]` as well as inset-0: on a phone, `100vh` (and a fixed
       inset-0 box) is the LAYOUT viewport, which includes the space under the
       browser's collapsing address bar. So the studio is taller than what you
       can actually see and the bottom of it — the preview — sits under the
       chrome. `dvh` is the viewport as it is right now. This is the specific
       reason the preview "cuts at the bottom" on a phone even when the maths
       above is right. */
    <div className="fixed inset-0 z-[90] flex h-[100dvh] flex-col overflow-hidden bg-shell">
      <header className="flex shrink-0 items-center gap-3 border-b border-line bg-paper px-4 py-3">
        <button
          type="button"
          onClick={onClose}
          data-testid="studio-close"
          className="mise-btn-flat mise-press flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-fg-soft"
        >
          ‹ Done
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg font-bold text-fg">{title}</p>
          {subtitle && <p className="truncate text-xs text-fg-soft">{subtitle}</p>}
        </div>
        {footer}
      </header>

      {/* ON A PHONE THIS IS TWO SCREENS, NOT TWO ROWS.
          --------------------------------------------------------------------
          It stacked: `grid-rows-[auto_1fr]`, controls first. `auto` means the
          controls take their full CONTENT height — which on this form is well
          over a screen — so the preview row was handed whatever was left, which
          was nothing. Measured at 390x844: the device frame's top edge sat at
          y=873, below the bottom of the window, and six wheel gestures moved it
          0px because the containers are `overflow:hidden`. Not "cut off at the
          bottom": not on screen at all, and unreachable.

          The old comment had the right insight and drew the wrong conclusion —
          you genuinely cannot edit and watch at once on 390px, so the answer is
          not to stack them and hope, it is to show ONE of them. A toggle costs
          one tap and never costs a scroll. Desktop is untouched: side by side,
          where there is room for both. */}
      {mobile}
      <div className="grid min-h-0 flex-1 grid-rows-1 overflow-hidden lg:grid-cols-[34rem_1fr]">
        {/* WHY THE CONTROLS LOOKED CLUMSY, AND WHY THE FIRST FIX WAS WORSE.
            They were written for a 42rem card and carry two- and three-column
            grids; in a 26rem column every text field became a stub — "Add",
            "Pho", "Mor". My first answer collapsed every inner grid to one
            column, which fixed the text boxes and turned the hero-photo picker
            into six full-width photographs stacked down the page.
            Grids were never the problem. WIDTH was. The column is 34rem now —
            close to the width the form was designed for — so the tiles stay
            tiles and the inputs get their room back. Only the story box is
            overridden, because it ships two rows tall and is meant for a
            paragraph. */}
        <div
          className={`mise-noscrollbar min-h-0 overflow-y-auto border-line p-4 lg:border-r lg:p-6 [&_textarea]:min-h-[6rem] ${
            tab === "edit" ? "" : "hidden lg:block"
          }`}
        >
          {controls}
        </div>
        {/* FLEX, NOT A BLOCK. The preview's own wrapper asks for `flex-1
            min-h-0` so it can fill this cell — and `flex-1` against a block
            parent is inert, so the wrapper sized to its content, the frame
            measured itself, and the whole fit-to-height calculation downstream
            had nothing real to measure. The cell was bounded; it just never
            passed that down. */}
        <div
          className={`min-h-0 flex-col overflow-hidden bg-shell p-4 lg:flex lg:p-6 ${
            tab === "preview" ? "flex" : "hidden"
          }`}
        >
          {preview}
        </div>
      </div>
    </div>,
    document.body,
  );
}
