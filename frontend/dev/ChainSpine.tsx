"use client";

// The chain reaction down the right-hand column.
//
//   "chaining reaction… awesome chaining… movement to show that life doesn't
//    stop, it moves like a chain"
//
// A spine runs in the gap beside the cards. As you scroll, a light runs down
// it, and every card has a link on the spine that bursts the moment the light
// reaches it — one card setting off the next, all the way down.
//
// Same rule as useHandoff: no React state on scroll. The handler writes the
// fill height and the lit links straight onto the DOM, so scrolling never
// re-renders the page. React renders again only when the column changes size.
//
// Desktop only: on a phone there is one column and no gap to run it in.

import { memo, useEffect, useRef, useState, type RefObject } from "react";

/** A card's offset inside the column, from layout — not getBoundingClientRect,
 *  which would include the cards' scroll-driven scaling and drift with it. */
function offsetWithin(el: HTMLElement, root: HTMLElement): number {
  let y = 0;
  let n: HTMLElement | null = el;
  while (n && n !== root) {
    y += n.offsetTop;
    n = n.offsetParent as HTMLElement | null;
  }
  return n === root ? y : NaN;
}

// Memoised: the page re-renders every second for its clock.
export const ChainSpine = memo(function ChainSpine({ column }: { column: RefObject<HTMLElement | null> }) {
  const [nodes, setNodes] = useState<number[]>([]);
  const fill = useRef<HTMLDivElement>(null);
  const links = useRef<(HTMLSpanElement | null)[]>([]);

  // Where each card's link sits: level with the card's header.
  useEffect(() => {
    const col = column.current;
    if (!col) return;
    const measure = () => {
      const ys = [...col.querySelectorAll<HTMLElement>("[data-link]")]
        .map((el) => offsetWithin(el, col) + 27)
        .filter((y) => Number.isFinite(y));
      setNodes((prev) =>
        prev.length === ys.length && prev.every((y, i) => Math.abs(y - ys[i]) < 1) ? prev : ys,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(col);
    return () => ro.disconnect();
  }, [column]);

  useEffect(() => {
    const col = column.current;
    if (!col || nodes.length === 0) return;
    let frame = 0;
    const paint = () => {
      frame = 0;
      // The reading line: a little below the middle of the screen, in the
      // column's own coordinates.
      const line = window.innerHeight * 0.62 - col.getBoundingClientRect().top;
      const head = Math.max(0, Math.min(line, nodes[nodes.length - 1]));
      if (fill.current) fill.current.style.height = `${head}px`;
      links.current.forEach((link, i) => {
        if (!link) return;
        const on = nodes[i] <= line;
        if (on && !link.dataset.on) {
          link.dataset.on = "1";
          // Restart the burst every time the light arrives, scrolling back
          // up and down included — the reaction can be set off again.
          link.classList.remove("dev-ignite");
          void link.offsetWidth;
          link.classList.add("dev-ignite");
        } else if (!on && link.dataset.on) {
          delete link.dataset.on;
          link.classList.remove("dev-ignite");
        }
      });
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [column, nodes]);

  return (
    // THE CRYSTAL SPINE (22 Nov): the divider between his portrait and the
    // cards on a desktop — the axis the cards orbit (globals.css devRevolve) —
    // and down the middle of the cards on a phone ("center the divider behind
    // cards"). Over it in front, under it behind. Its own light runs inside a
    // clipped column, so nothing here can stretch the page any more.
    <div aria-hidden className="pointer-events-none absolute inset-y-0 left-1/2 z-[1] w-px lg:-left-7">
      <div className="absolute inset-y-0 -left-[9px] w-[18px] overflow-hidden">
        <div className="dev-crystal absolute inset-0" />
        <div className="dev-crystal-light">
          <i />
        </div>
      </div>
      {/* The light running down it, with a spark at its head. */}
      <div
        ref={fill}
        className="absolute left-[-0.5px] top-0 w-[2px] rounded-full"
        style={{
          height: 0,
          background: "linear-gradient(180deg, var(--d-a), var(--d-gold) 40%, var(--d-b))",
          boxShadow: "0 0 10px color-mix(in srgb, var(--d-b) 55%, transparent)",
        }}
      >
        <span className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-[var(--d-b2)] shadow-[0_0_12px_3px_color-mix(in_srgb,_var(--d-b2)_85%,_transparent)]" />
      </div>
      {nodes.map((y, i) => (
        <span
          key={i}
          ref={(el) => {
            links.current[i] = el;
          }}
          className="absolute left-0 grid h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-[var(--d-line2)] bg-[var(--d-bg2)] transition-colors duration-500 data-[on]:border-[var(--d-b2)]/70 data-[on]:bg-[#0f2626] data-[on]:*:bg-[var(--d-b2)]"
          style={{ top: y }}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--d-ink6)] transition-colors duration-500" />
        </span>
      ))}
    </div>
  );
});
