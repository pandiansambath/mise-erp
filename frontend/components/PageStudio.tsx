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

import { useEffect, type ReactNode } from "react";
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
    <div className="fixed inset-0 z-[90] flex flex-col bg-shell">
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

      {/* Controls left, page right. On a phone they stack, controls first,
          because you cannot edit and watch at once on 390px anyway. */}
      <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-hidden lg:grid-cols-[30rem_1fr] lg:grid-rows-1">
        {/* WHY THE CONTROLS LOOKED CLUMSY. They were written for a wide card
            and carry two- and three-column grids inside; dropped into a column
            they kept those columns and every field became a stub — "Add",
            "Pho", "Mor", a Quote box one character wide. Collapsing the inner
            grids to one column here, rather than rewriting thirty fields,
            keeps one source of truth for the form and gives every input the
            full width it was always asking for. */}
        <div className="mise-noscrollbar min-h-0 overflow-y-auto border-line p-4 lg:border-r lg:p-6 [&_.grid]:grid-cols-1 [&_input]:w-full [&_textarea]:min-h-[5rem] [&_textarea]:w-full">
          {controls}
        </div>
        <div className="min-h-0 overflow-hidden bg-shell p-4 lg:p-6">{preview}</div>
      </div>
    </div>,
    document.body,
  );
}
