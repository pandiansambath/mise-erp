"use client";

// A page that fits the screen.
//
// The complaint was "clumsy and collapsed", and it was not a styling problem.
// Inventory put a 180-line "add item" FORM between the header and your stock
// list; Purchasing did the same with the indent form. So the first thing you
// did on a page whose job is to show you your stock was scroll past a form you
// use a few times a day. Then the list itself was capped at max-h-[60vh] and
// scrolled INSIDE the page that was already scrolling — a scrollbar inside a
// scrollbar. That is where both words came from: collapsed, because the list
// only ever got the leftovers; clumsy, because two scrollbars fight.
//
// So the shape is inverted here. The page IS the list. It fills the screen
// exactly and the page itself never scrolls. Making things — the form — moves
// behind a button and opens in place, which is the rule he set:
//
//     Click anything, do anything.
//
// The layout, top to bottom:
//
//   ┌────────────────────────────────────────────┐
//   │ Title · subtitle              [ do this ]  │  rail — pinned
//   │ [ tabs ]        [ search ]      [ filter ] │  tools — pinned
//   ├────────────────────────────────────────────┤
//   │                                            │
//   │   the thing the page is FOR                │  the only scroller,
//   │   (takes every pixel that is left)         │  and it takes the rest
//   │                                            │
//   ├────────────────────────────────────────────┤
//   │ 148 items · £4,210 on hand · 6 low         │  tally — pinned
//   └────────────────────────────────────────────┘
//
// The rail condenses as you scroll, handing its height to the list. That is
// driven by writing to a ref rather than through React state — the dev page
// taught that lesson expensively: state updated once per scroll frame
// re-renders the whole tree sixty times a second, and the screen shakes.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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
  /** Live totals. Pinned, so the numbers never require a scroll to the end. */
  tally?: ReactNode;
  children: ReactNode;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  // Condense the rail once the list has moved. Threshold + a flag, so we touch
  // the DOM on the crossing rather than on every frame.
  const condensed = useRef(false);
  const onScroll = useCallback(() => {
    const past = (scroller.current?.scrollTop ?? 0) > 24;
    if (past === condensed.current) return;
    condensed.current = past;
    rail.current?.setAttribute("data-condensed", past ? "true" : "false");
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onScroll]);

  return (
    // data-bench is the signal to AppShell: this page manages its own height,
    // so drop main's padding and stop main from scrolling.
    // The bottom padding on mobile clears the fixed tab bar; without it the
    // tally strip hides underneath it.
    <div
      data-bench
      className="flex min-h-0 flex-1 flex-col bg-shell pb-[calc(4.75rem+env(safe-area-inset-bottom))] lg:pb-0"
    >
      <div
        ref={rail}
        data-condensed="false"
        className="mise-bench-rail z-20 shrink-0 border-b border-glass/10 bg-shell/80 px-4 backdrop-blur-xl lg:px-8"
      >
        <div className="mise-bench-head flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="mise-bench-title truncate font-display font-semibold text-fg">
              {title}
            </h1>
            {subtitle && (
              <p className="mise-bench-sub truncate text-sm text-fg-faint">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
        </div>
        {tools && <div className="pb-3">{tools}</div>}
      </div>

      {/* The one scroll region on the page. overscroll-contain stops a flick at
          the end of the list from bouncing the whole window behind it. */}
      <div
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 lg:px-8"
      >
        {children}
      </div>

      {tally && (
        <div className="z-20 shrink-0 border-t border-glass/10 bg-shell/85 px-4 py-2.5 backdrop-blur-xl lg:px-8 lg:pr-24">
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
    <div className="grid h-full min-h-[14rem] place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-2xl border border-line text-2xl text-fg-faint">
          {icon}
        </div>
        <p className="font-display text-base font-semibold text-fg">{title}</p>
        {hint && (
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-faint">{hint}</p>
        )}
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

/** The occasional actions, behind one dot.
 *
 *  Inventory carried five buttons across its header — common items, template,
 *  import, export, CSV — each permanently occupying the top of a page whose
 *  job is showing stock. Import runs perhaps weekly. A row of five buttons is
 *  where "things you can do" stops reading as help and starts reading as
 *  clutter, so the one you came for stays out front and the rest live here.
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
                      <span className="block text-[11px] leading-snug text-fg-faint">{it.hint}</span>
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
