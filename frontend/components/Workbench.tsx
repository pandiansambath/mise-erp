"use client";

// A page whose controls stay put while its data moves.
//
// WHAT I BROKE, AND WHY, because the shape of this file is a direct answer to
// it. The first version took the viewport over: AppShell handed `main` its
// padding and its scrollbar, and the page rebuilt itself as a flex column with
// its own inner scroller. That works only if every link in the chain holds —
// main flex, bench flex-1 + min-h-0, scroller flex-1 + min-h-0. One link did
// not hold in production, so the content overflowed a box with
// `overflow: hidden` on it.
//
// An `overflow: hidden` box still scrolls when SCRIPT moves it, and never
// scrolls for a wheel or a finger. That is precisely what he saw: "only
// buttons are working... pressed button took me here". His data was reachable
// by the sub-nav and unreachable by scrolling.
//
// My harness tested the flex chain in isolation and passed, which is why I
// shipped it. It proved the mechanism could work, not that it did work in the
// real tree — those are different claims and I reported the wrong one.
//
// So: no height hijacking. The page scrolls the way every other page scrolls.
// The rail is `sticky top-0` and the tally is `sticky bottom-0`, which pins
// them with no dependency on any ancestor's layout. Sticky either sticks or it
// scrolls with the page; it cannot produce a page that refuses the wheel.
//
// What he actually asked for is not "no scrollbar" — he said it himself:
//
//     "this means we need to show data in a different UI style where no need
//      to scroll ... but if I want to see I need to scroll"
//
// So the job is to make the first screen answer the question, and let
// scrolling work normally for everything behind it.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export function Workbench({
  title,
  subtitle,
  action,
  tools,
  tally,
  children,
}: {
  title: string;
  subtitle?: string;
  /** The one thing this page is for making. Opens a sheet — never inline. */
  action?: ReactNode;
  /** Tabs, search, filters. Pinned: you can always retarget the list. */
  tools?: ReactNode;
  /** Live totals. Pinned to the bottom, so the number the page exists to
   *  produce never needs a scroll to reach. */
  tally?: ReactNode;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  // Condense the rail once the page has moved past it. An IntersectionObserver
  // on a one-pixel sentinel rather than a scroll listener: it does not care
  // WHICH ancestor scrolls, it fires only on the crossing, and it costs nothing
  // per frame. The dev page taught what per-frame work does to this app.
  const condensed = useRef(false);
  const apply = useCallback((v: boolean) => {
    if (v === condensed.current) return;
    condensed.current = v;
    rail.current?.setAttribute("data-condensed", v ? "true" : "false");
  }, []);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    // A LOCK, not a margin.
    //
    // The shake was real: condensing REMOVES height, which scrolls the sentinel
    // back into view, which expands the rail, which puts the height back — a
    // loop, many times a second, for as long as you hover near the line.
    //
    // My fix for it broke the feature outright. `rootMargin: -64px` shrinks the
    // root, and the sentinel sits at ~63px — just under the app header — so it
    // was ALREADY outside at rest. An IntersectionObserver only fires when
    // something CROSSES its boundary; a thing that starts outside and stays
    // outside never fires again, so the rail simply stopped condensing. He
    // noticed immediately: "previously working scroll down to shrink... it's
    // completely gone now."
    //
    // So the margin goes back to zero — the crossing is real again — and the
    // oscillation is stopped in time instead of in space. After a flip the
    // state is held for 350ms, which is longer than the reflow it causes, so
    // the reflow cannot flip it back.
    let lockedUntil = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        const now = performance.now();
        if (now < lockedUntil) return;
        const next = !entry.isIntersecting;
        if (next === condensed.current) return;
        lockedUntil = now + 350;
        apply(next);
      },
      { threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [apply]);

  // IS THE TOOLBAR SHORT ENOUGH TO TUCK?
  //
  //   "see top area buttons... let me scroll... now see... worst UI."
  //
  // Condensing slides the tools UP beside the title by a fixed distance. That
  // works for a single row of buttons and fails badly for a tall toolbar —
  // Tables and Kitchen both have labelled input groups, so most of the row was
  // left hanging BELOW the rail, on top of the cards. A rail that overlaps the
  // page is worse than a rail that never shrinks.
  //
  // So the tuck is earned, not assumed: measure the row, and only tuck when it
  // genuinely fits on the title's line. Anything taller just loses its padding.
  useEffect(() => {
    const el = rail.current;
    if (!el) return;
    const measure = () => {
      const box = el.querySelector<HTMLElement>(".mise-bench-tools");
      if (!box) return;
      // TALL **or** WIDE. Tucking slides the tools up beside the title, which
      // needs room in BOTH directions — and I only checked one. A single row of
      // search-plus-three-buttons is short enough to tuck and far too wide to
      // fit, so it slid up and ran straight off the right-hand edge: "the side
      // top buttons are hidden".
      //
      // Anything that would need more than half the rail's width has nowhere to
      // go beside a title, so it condenses in place instead.
      const tall = box.offsetHeight > 62;
      const wide = box.scrollWidth > el.clientWidth * 0.52;
      el.setAttribute("data-tall", tall || wide ? "true" : "false");
    };
    measure();
    const ro = new ResizeObserver(measure);
    const box = el.querySelector<HTMLElement>(".mise-bench-tools");
    if (box) ro.observe(box);
    // The rail itself resizes when the window does, and a toolbar that fitted
    // at 1400px does not at 900.
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div data-bench className="min-w-0">
      {/* One pixel, at the very top. When it leaves the viewport the rail
          condenses; when it returns, the rail opens back up. */}
      <div ref={sentinel} aria-hidden className="h-px" />

      <div
        ref={rail}
        data-condensed="false"
        className="mise-bench-rail sticky z-30 -mx-4 border-b border-glass/10 bg-shell/90 px-4 backdrop-blur-xl lg:-mx-8 lg:px-8"
      >
        {/* Title and tools share a GRID, not two stacked blocks.
            "I want that the buttons also need to shrink in size and go one step
             up by shrinking, so that when we scroll down and look at the top
             portion there will be only one row which has all buttons and that
             Purchasing word too."
            Two rows when you are at the top, ONE row once you scroll — the
            grid's areas change, so the tools genuinely move up beside the
            title rather than merely looking smaller. */}
        <div className="mise-bench-grid">
        <div className="mise-bench-head flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mise-bench-title truncate font-display font-semibold text-fg">
              {title}
            </h1>
            {subtitle && (
              /* The wrapper is the collapsing grid row; the <p> inside is what
                 gets squeezed. A grid-rows collapse needs a child that will
                 accept being squashed, which means overflow:hidden on it. */
              <div className="mise-bench-sub">
                <p className="truncate text-sm text-fg-faint">{subtitle}</p>
              </div>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
        {tools && <div className="mise-bench-tools pb-3">{tools}</div>}
        </div>
      </div>

      {/* The bottom padding lives HERE, above the tally — never below it.
          Padding under the tally would push the bench's bottom edge past it,
          and a sticky element cannot escape its containing block, so the tally
          would strand itself mid-page again. That was the "hanging card". */}
      <div className={`pt-4 ${tally ? "pb-24 lg:pb-16" : "pb-8"}`}>{children}</div>

      {tally && (
        <div className="mise-bench-tally sticky z-20 -mx-4 border-t border-glass/10 bg-shell/90 px-4 py-2.5 backdrop-blur-xl lg:-mx-8 lg:px-8 lg:pr-24">
          {tally}
        </div>
      )}
    </div>
  );
}

/** An empty state that fills its space instead of sitting as a thin line. */
export function BenchEmpty({
  icon = "◍",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-[14rem] place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-line text-2xl text-fg-faint">
          {icon}
        </div>
        <p className="font-display text-base font-semibold text-fg">{title}</p>
        {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-fg-faint">{hint}</p>}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/** The occasional actions, behind one dot.
 *
 *  Inventory carried five buttons across its header — common items, template,
 *  import, export, CSV — each permanently occupying the top of a page whose
 *  job is showing stock. Import runs perhaps weekly. The one you came for
 *  stays out front and the rest live here.
 */
export function BenchMenu({ items }: { items: BenchAction[] }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-expanded={open}
        className="mise-press grid h-9 w-9 place-items-center rounded-xl border border-line-2 text-lg text-fg-soft transition hover:border-brand-400/50"
      >
        ⋯
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="mise-pop absolute right-0 top-11 z-50 w-60 overflow-hidden rounded-2xl border border-line bg-paper p-1.5 shadow-2xl">
            {items.map((it, i) =>
              it.divider ? (
                <div key={`d${i}`} className="my-1.5 h-px bg-line" />
              ) : (
                <button
                  key={it.label}
                  type="button"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect?.();
                  }}
                  className="mise-press flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition hover:bg-glass/5 disabled:opacity-50"
                >
                  <span aria-hidden className="mt-px w-5 shrink-0 text-center text-sm">
                    {it.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-fg">{it.label}</span>
                    {it.hint && (
                      <span className="block text-[11px] leading-snug text-fg-faint">
                        {it.hint}
                      </span>
                    )}
                  </span>
                </button>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}

export type BenchAction = {
  label: string;
  icon?: string;
  hint?: string;
  disabled?: boolean;
  divider?: boolean;
  onSelect?: () => void;
};
