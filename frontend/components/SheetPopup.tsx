"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { useBackToClose } from "@/components/useBackToClose";
import { overlayOpened } from "@/lib/overlay";

/**
 * The purchasing popup, freed from the purchasing page.
 *
 *   "please keep purchase page and role&access page UI UX as reference and
 *    implement the same kinda UI UX in all the pages... in purchase page we
 *    have popup burst animation and all, its super cool nah"
 *
 * It lived as a private function inside `OrderFlow.tsx`, so any other page that
 * wanted it had to copy it — and six copies of a popup is how six popups start
 * behaving differently. One of them gets the Escape handler, one forgets to
 * lock the page behind it, one centres itself and one does not. Extracting it
 * first is the difference between spreading a style and spreading a mess.
 *
 * What it already knew, and every page now inherits for free:
 *  - centred on BOTH axes at every size ("this popup is not centred")
 *  - the page behind cannot scroll while it is open
 *  - it can stack: depth 2 sits over depth 1, and only the depth changes
 *  - it is as WIDE as its content needs, because a popup that stays one size
 *    while its list grows is a popup you scroll instead of read
 */
export function SheetPopup({
  onClose,
  title,
  subtitle,
  depth = 1,
  panelId,
  columns = 1,
  children,
  footer,
}: {
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** 1 = over the page, 2 = over another sheet. Only the depth changes. */
  depth?: 1 | 2;
  /** So anything on the page can find this panel and animate it — the burst
   *  needs a handle on the thing that is about to fly. */
  panelId?: string;
  /** How many card columns this sheet should be able to hold. The panel is
   *  sized to fit them; more items means a wider panel, not a longer scroll. */
  columns?: 1 | 2 | 3 | 4;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    // The page behind must not scroll under a popup, and the floating launcher
    // must not sit on top of one.
    const release = overlayOpened();
    return () => {
      window.removeEventListener("keydown", onKey);
      release();
    };
  }, [onClose]);

  // On Android, Back should close the popup rather than leave the page. The
  // order pad never wired this up because its sheets are always reachable by
  // the ✕; a popup on every page makes it worth having.
  useBackToClose(true, onClose);

  const z = depth === 1 ? "z-[70]" : "z-[80]";
  // Centred, both axes, at every size. It used to be pinned to the top with
  // side insets, so it sat high and off-centre — "this popup is not centred".
  // No -translate-x-1/2 here: .mise-pop-centre carries the centring inside its
  // keyframes, because an animation's transform replaces the class's.
  const width: Record<number, string> = {
    4: "w-[min(72rem,95vw)]",
    3: depth === 1 ? "w-[min(56rem,94vw)]" : "w-[min(58rem,94vw)]",
    2: depth === 1 ? "w-[min(40rem,94vw)]" : "w-[min(42rem,94vw)]",
    1:
      depth === 1
        ? "w-fit min-w-[min(22rem,92vw)] max-w-[min(30rem,94vw)]"
        : "w-[min(26rem,94vw)]",
  };
  const box = `left-1/2 top-1/2 ${width[Math.min(4, Math.max(1, columns))]}`;

  // RENDERED INTO <body>, ALWAYS.
  //
  // `position: fixed` is only relative to the viewport when no ancestor has a
  // transform, a filter, or a BACKDROP-FILTER — any of those makes the ancestor
  // the containing block instead. The header bar is `backdrop-blur`, so a popup
  // opened from the clock inside it was being centred in a 62px-tall strip:
  // measured `top: -214px` with the dial cut off above the screen, on a popup
  // only 491px tall that had all the room it needed.
  //
  // A portal takes it out of that ancestor entirely, which fixes the clock and
  // every future popup opened from anywhere blurred or transformed — a class of
  // bug rather than one instance of it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const ui = (
    <>
      <div
        data-sheet-backdrop
        className={`mise-fade fixed inset-0 ${z} bg-black/50 backdrop-blur-sm`}
        onClick={onClose}
        aria-hidden
      />
      <div
        id={panelId}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`mise-pop-centre mise-sheet-sheen fixed ${box} ${z} flex max-h-[86dvh] flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-2xl`}
      >
        <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-line bg-gradient-to-b from-brand-500/10 to-transparent px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-display text-lg font-semibold text-fg">{title}</p>
            {subtitle && <p className="truncate text-xs text-fg-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line-2 text-fg-soft transition hover:border-brand-400/50"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{children}</div>
        {footer && <div className="shrink-0 border-t border-line p-3">{footer}</div>}
      </div>
    </>
  );

  // Before hydration there is no document to portal into; rendering nothing for
  // one frame is right, because a popup is always opened by a click that has
  // not happened yet on the server.
  return mounted ? createPortal(ui, document.body) : null;
}
