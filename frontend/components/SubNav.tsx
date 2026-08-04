"use client";

// The jobs a page can do, said out loud.
//
// A section like Inventory does five or six different things — add an item,
// find one, see what is low, tidy the categories, review a supplier — and all of
// them were reachable only by knowing where to look. The page told you what it
// WAS, never what you could DO on it.
//
// So this sits under the page title: one row of the page's actual jobs, each one
// tap. Purchasing already worked this way with its tabs and is the easiest page
// in the app to use; this is that idea made reusable.
//
// Two deliberate choices:
//
// **Not routing.** These are jobs within one page, not places. Making them URLs
// would put "I clicked search" in the back button, which is not a thing anyone
// wants to go back to.
//
// **A count, not a badge.** Where a job has a number worth knowing — 4 items low
// — it is shown plainly. Red dots train people to ignore them.

import type { ReactNode } from "react";

export type SubNavItem = {
  key: string;
  label: string;
  icon?: ReactNode;
  /** Shown after the label when it is worth knowing (e.g. how many are low). */
  count?: number;
  /** Draws attention when the count means something needs doing. */
  tone?: "plain" | "warn" | "bad";
  onSelect: () => void;
};

export function SubNav({
  items,
  active,
  className = "",
}: {
  items: SubNavItem[];
  /** Highlights the current one, when the page tracks a mode. */
  active?: string;
  className?: string;
}) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Section actions"
      // Scrolls sideways on a phone rather than wrapping into three rows and
      // pushing the page's real content below the fold.
      className={`mise-stagger -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none} ${className}`}
    >
      {items.map((item) => {
        const on = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onSelect}
            aria-current={on ? "true" : undefined}
            className={`mise-press flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition ${
              on
                ? "border-transparent bg-brand-600 text-white shadow-sm"
                : "border-line text-fg-soft hover:border-brand-400/50 hover:text-brand-300"
            }`}
          >
            {item.icon && <span aria-hidden>{item.icon}</span>}
            <span className="whitespace-nowrap">{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span
                className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${
                  on
                    ? "bg-white/20 text-white"
                    : item.tone === "bad"
                      ? "bg-rose-400/15 text-rose-300"
                      : item.tone === "warn"
                        ? "bg-amber-400/15 text-amber-300"
                        : "bg-glass/10 text-fg-faint"
                }`}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
