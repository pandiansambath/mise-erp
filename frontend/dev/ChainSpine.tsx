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
// On a desktop it runs in the gap between his portrait and the cards, above
// the cards (a card only crosses it while far round the back). On a phone it
// runs down the middle of the cards, behind them.
//
// The spine itself is real 3D crystal now (CrystalSpine): "the centre divider
// skeleton crystal is not nice… a bit artificial… put more effort".

import { pageY, pageYFree } from "./scrollPos";
import { memo, useEffect, useRef, useState, type RefObject } from "react";
import { CrystalSpine } from "./CrystalSpine";

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

/** How far the crystal's lane reaches ABOVE the column: room for the portal
 *  the skeleton rises out of (CrystalSpine). */
export const SPINE_HEAD = 130;

// Memoised: it depends only on the column.
export const ChainSpine = memo(function ChainSpine({ column }: { column: RefObject<HTMLElement | null> }) {
  const [nodes, setNodes] = useState<number[]>([]);
  const fill = useRef<HTMLDivElement>(null);
  const lane = useRef<HTMLDivElement>(null);

  // How far the lane — and the chain — reach BELOW the column: measured, to
  // just through the finale's surface (a fixed figure fell short on a big
  // screen). CrystalSpine reads it from data-tail.
  useEffect(() => {
    const col = column.current;
    const ln = lane.current;
    if (!col || !ln) return;
    const measure = () => {
      const surface = document.querySelector<HTMLElement>("[data-surface]");
      let tail = window.matchMedia("(min-width: 640px)").matches ? 78 : 62;
      if (surface) {
        const gap = surface.getBoundingClientRect().top - col.getBoundingClientRect().bottom;
        // 40 px past it: room for the last link to cross the line and fade
        // below it, without the canvas's edge cutting it.
        if (gap > -40 && gap < 1200) tail = Math.max(48, Math.round(gap + 40));
      }
      ln.style.bottom = `${-tail}px`;
      ln.dataset.tail = String(tail);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(col);
    const fin = document.querySelector("[data-surface]")?.parentElement;
    if (fin) ro.observe(fin);
    window.addEventListener("resize", measure);
    // Once more after the late arrivals (fonts, images, the résumé card).
    const late = window.setTimeout(measure, 1500);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
      window.clearTimeout(late);
    };
  }, [column]);
  const spark = useRef<HTMLSpanElement>(null);
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
    // Where the column begins on the page (measured when it, or the page, changes size).
    let colTop = 0;
    const where = () => {
      colTop = col.getBoundingClientRect().top + window.scrollY;
    };
    where();
    const ro = new ResizeObserver(where);
    ro.observe(col);
    ro.observe(document.body);
    const paint = () => {
      frame = 0;
      // The reading line: a little below the middle of the screen, in the
      // column's own coordinates.
      const line = window.innerHeight * 0.62 - (pageYFree() ? colTop - pageY() : col.getBoundingClientRect().top);
      const head = Math.max(0, Math.min(line, nodes[nodes.length - 1]));
      // (Scaled, not made longer: a length is the page's layout worked out again, every frame
      // of a scroll.)
      if (fill.current) fill.current.style.transform = `scaleY(${(head / 100).toFixed(4)})`;
      if (spark.current) spark.current.style.transform = `translate(-50%, ${head - 4}px)`;
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
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [column, nodes]);

  return (
    // THE CRYSTAL SPINE: the divider between his portrait and the cards on a
    // desktop — the axis the cards orbit (globals.css, THE ORBIT) — and down
    // the middle of the cards on a phone, behind them ("center the divider
    // behind cards"). Nothing in it can stretch the page.
    <div aria-hidden data-spine className="pointer-events-none absolute inset-y-0 left-1/2 z-0 w-px lg:-left-11 lg:z-[1] xl:-left-16">
      {/* The light running down its core, seen between the bones. */}
      <div
        ref={fill}
        data-cord
        className="absolute left-[-0.5px] top-0 h-[100px] w-[2px] origin-top"
        style={{
          transform: "scaleY(0)",
          background: "linear-gradient(180deg, var(--d-a), var(--d-gold) 40%, var(--d-b))",
          boxShadow: "0 0 10px color-mix(in srgb, var(--d-b) 55%, transparent)",
        }}
      />
      {/* The crystal, in a lane wide enough for the sparks rising round it —
          reaching above the column (SPINE_HEAD: the portal the skeleton rises
          out of) and on below it (measured above) to the finale's surface of
          light, where the skeleton, become a chain, is lowered into it. */}
      <div
        ref={lane}
        className="absolute -bottom-[62px] left-1/2 w-[340px] -translate-x-1/2 sm:-bottom-[78px] lg:w-[350px] xl:w-[440px]"
        style={{ top: -SPINE_HEAD }}
      >
        <CrystalSpine column={column} />
      </div>
      {/* The head of the light: the dot that runs down and stops at each card. */}
      <span
        ref={spark}
        className="absolute left-0 top-0 h-2 w-2 rounded-full bg-[var(--d-b2)] shadow-[0_0_12px_3px_color-mix(in_srgb,_var(--d-b2)_85%,_transparent)]"
        style={{ transform: "translate(-50%, -4px)" }}
      />
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
