"use client";

// Edit where you clicked.
//
// The pattern this replaces: clicking "Edit" on row 40 scrolled you to a form at
// the top of the page. You lost your place, and coming back meant scrolling down
// to find where you had been. Raised three times — inventory, recipes, vendors —
// so it is a rule, not three bugs.
//
// Modelled on the recipe costing stage, which is the interaction that works:
// centred, wide enough for a real form, its own scroll, and a header that stays
// put. Deliberately a plain modal rather than the side DetailSheet — a form
// wants a comfortable width and the middle of the screen, while a sheet is for
// reading a record.
//
// It owns presentation only. Every page pours its own existing form in, so the
// fields, validation and submit logic are untouched.

import { useEffect, useRef, type ReactNode } from "react";

import { useBackToClose } from "./useBackToClose";
import { createPortal } from "react-dom";

export function EditModal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  /** Sticky actions. Keeping Save visible means a long form never hides it. */
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}) {
  const panel = useRef<HTMLDivElement>(null);

  // Back closes the overlay rather than leaving the page.
  useBackToClose(open, onClose);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the first real field, not the panel, so you can start typing.
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]):not([disabled]), textarea, select",
      );
      (first ?? panel.current)?.focus();
    }, 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      clearTimeout(t);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const widths = {
    sm: "sm:max-w-md",
    md: "sm:max-w-xl",
    lg: "sm:max-w-3xl",
  }[width];

  // Portalled to <body>: any ancestor with a transform, filter or opacity makes
  // a new stacking context, and a modal trapped inside one cannot rise above the
  // page however high its z-index goes.
  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
    >
      <div className="mise-fade-in absolute inset-0 bg-black/60 backdrop-blur-[3px]" onClick={onClose} />
      <div
        ref={panel}
        tabIndex={-1}
        className={`mise-pop-lg relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-line bg-paper shadow-2xl shadow-black/60 outline-none sm:rounded-3xl ${widths}`}
      >
        {/* grab handle (phones) */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-fg/15 sm:hidden" />

        <header className="flex shrink-0 items-center gap-3 border-b border-line bg-gradient-to-r from-brand-500/10 via-transparent to-transparent px-5 py-4">
          {icon !== undefined && (
            <span aria-hidden className="mise-neo-raised grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-xl">
              {icon}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-display text-lg font-semibold text-fg">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-fg-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press -mr-1 grid h-9 w-9 shrink-0 place-items-center rounded-xl text-fg-faint transition hover:bg-paper-2 hover:text-fg"
          >
            ✕
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line bg-paper-2/50 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** One form, two homes.
 *
 *  ADDING is a top-of-page job — you come to the page intending it, and the
 *  form being there is a prompt. EDITING is not: you are deep in a list, you
 *  clicked a row, and being thrown to the top loses your place.
 *
 *  So the same form markup renders inline while adding and as a modal while
 *  editing. Pages keep their existing fields, validation and submit untouched —
 *  they just wrap them in this.
 */
export function FormShell({
  editing,
  onClose,
  title,
  subtitle,
  icon,
  innerRef,
  flash,
  width = "lg",
  children,
}: {
  editing: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  innerRef?: React.RefObject<HTMLDivElement | null>;
  /** Pulse the inline card when it is targeted from elsewhere (⌘K, deep link). */
  flash?: boolean;
  width?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  if (editing) {
    return (
      <EditModal open onClose={onClose} title={title} subtitle={subtitle} icon={icon} width={width}>
        {children}
      </EditModal>
    );
  }
  return (
    <div ref={innerRef} className={`scroll-mt-4 ${flash ? "mise-flash" : ""}`}>
      {children}
    </div>
  );
}
