"use client";

/** A section that is shut until you want it.
 *
 *     "see ths...waht hte hell..have a close open kinda style for this"
 *
 *  He was looking at Display currency: fourteen currency tiles, all open, on a
 *  page that also holds Email & 2FA, Hotel handle, Public page, Billing,
 *  Attendance rules, Payroll and Account. Settings had become the exact thing
 *  he has objected to since the beginning — "i hate scrolling" — on the page
 *  that does it worst.
 *
 *  THE SUMMARY LINE IS THE POINT, not the toggle. A fold that says "Display
 *  currency ›" has hidden the answer and saved nothing: you still have to open
 *  it to learn what the currency is. A fold that says "Display currency · £ GBP"
 *  answers the question without opening at all, and most visits end there.
 *  So `value` is required, not optional — a fold with nothing to report is a
 *  fold that should not exist.
 *
 *  Opening is not persisted. A remembered open section is a section that is
 *  open for reasons you cannot see, and the next visit is back to the wall of
 *  scroll it was closed to avoid.
 */

import { useId, useState, type ReactNode } from "react";

export function Fold({
  title,
  value,
  hint,
  defaultOpen = false,
  children,
  className = "",
}: {
  title: ReactNode;
  /** The answer, shown while shut. Required on purpose — see the note above. */
  value: ReactNode;
  hint?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        // min-h-[44px]: this is a phone target as much as a desktop one.
        className="mise-press flex min-h-[44px] w-full items-center gap-3 rounded-xl px-1 py-2 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-fg">{title}</span>
          {hint && <span className="block text-[11px] leading-relaxed text-fg-faint">{hint}</span>}
        </span>
        {/* shrink-0 + nowrap: a flex item squeezes below its own content long
            before the row wraps, and a truncated "£ GBP" is worse than none. */}
        <span className="shrink-0 whitespace-nowrap text-sm font-medium text-fg-soft">{value}</span>
        <span
          aria-hidden
          className={`shrink-0 text-fg-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        >
          ›
        </span>
      </button>
      {/* Unmounted rather than hidden: the whole point is that the closed
          sections cost nothing, and a currency grid that is merely
          `display:none` is still fourteen buttons in the accessibility tree. */}
      {open && (
        <div id={panelId} className="pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
