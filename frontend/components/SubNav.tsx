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

import { useEffect, useRef, type ReactNode } from "react";
import { spotlight } from "./fx";

export type SubNavItem = {
  key: string;
  label: string;
  /** Optional shorter label for narrow screens, so a row of tabs can fit
   *  instead of scrolling. Falls back to `label`. */
  shortLabel?: string;
  icon?: ReactNode;
  /** Shown after the label when it is worth knowing (e.g. how many are low). */
  count?: number;
  /** Draws attention when the count means something needs doing. */
  tone?: "plain" | "warn" | "bad";
  /** The id of the thing this job is ABOUT.
   *
   *  Given one, choosing the job scrolls to it and pulses a ring around it.
   *  Pages that switch a tab used to change silently — on a long screen the
   *  new content can be entirely below the fold, so the click looked ignored.
   *  Naming the target here means every section confirms itself the same way,
   *  rather than each page inventing its own. */
  focus?: string;
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
  // Being told which job to open, from outside this page.
  //
  // This lives here rather than in each page on purpose: every one of the
  // twelve pages using SubNav names its state differently, so wiring them
  // individually would be twelve chances to get it wrong. The items already
  // carry their own onSelect — firing the matching one does exactly what
  // tapping it would.
  //
  // TWO routes in, because one is not enough:
  //
  //   ?section=<key> handles ARRIVING from another page, on mount.
  //
  //   A `mise:section` event handles being told while ALREADY here — and that
  //   is the case that was broken. Moving within a page does not remount this
  //   component, so a mount-only reader saw the first URL and never the next
  //   one. Clicking a sidebar sub-section did nothing, exactly as he reported.
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  });

  useEffect(() => {
    const pick = (key: string | null) => {
      if (!key) return;
      const hit = latest.current.find((i) => i.key === key);
      if (!hit) return;
      hit.onSelect();
      // Let the tab actually switch before hunting for the target.
      if (hit.focus) window.setTimeout(() => spotlight(hit.focus!), 60);
    };
    pick(new URLSearchParams(window.location.search).get("section"));

    const onJump = (e: Event) => pick((e as CustomEvent<{ key?: string }>).detail?.key ?? null);
    window.addEventListener("mise:section", onJump);
    return () => window.removeEventListener("mise:section", onJump);
  }, []);

  // Tell the sidebar which job is open, so it can light the right one —
  // including when the choice was made here rather than over there.
  useEffect(() => {
    if (!active) return;
    window.dispatchEvent(new CustomEvent("mise:section-open", { detail: { key: active } }));
  }, [active]);

  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Section actions"
      // Scrolls sideways on a phone rather than wrapping into three rows and
      // pushing the page's real content below the fold.
      className={`mise-well mise-stagger mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl p-1 [scrollbar-width:none] [&::-webkit-scrollbar]{display:none} ${className}`}
    >
      {items.map((item) => {
        const on = active === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              item.onSelect();
              if (item.focus) window.setTimeout(() => spotlight(item.focus!), 60);
            }}
            aria-current={on ? "true" : undefined}
            className={`mise-press flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-medium transition ${
              on
                ? "mise-btn-key"
                : "text-fg-soft hover:bg-glass/[0.06] hover:text-brand-300"
            }`}
          >
            {item.icon && <span aria-hidden>{item.icon}</span>}
            <span className="whitespace-nowrap">
              {item.shortLabel ? (
                <>
                  <span className="sm:hidden">{item.shortLabel}</span>
                  <span className="hidden sm:inline">{item.label}</span>
                </>
              ) : (
                item.label
              )}
            </span>
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
