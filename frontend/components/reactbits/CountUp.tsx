"use client";

// A number that rolls to its new value.
//
// React Bits ships a CountUp, but it depends on `motion` (~30kb) and this app
// runs on tills and wall tablets all day. Shipping an animation library to
// every one of them for a rolling number is a bad trade, and the whole thing is
// twenty lines of requestAnimationFrame.
//
// Used where a number CHANGING is the information: the order total as items
// land, the dashboard money, the saving on Price Comparison. Not used on counts
// that merely happen to be numbers — a rolling "13 open orders" says nothing
// that "13" did not.

import { useEffect, useRef, useState } from "react";

/** Ease-out cubic: fast to begin, settling gently. A number arriving should
 *  decelerate the way a physical dial does, not stop dead. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUp({
  to,
  duration = 600,
  format,
  className,
}: {
  to: number;
  duration?: number;
  /** How to render it — pass the currency formatter and it stays money. */
  format?: (n: number) => string;
  className?: string;
}) {
  const [shown, setShown] = useState(to);
  const from = useRef(to);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const start = from.current;
    if (start === to) return;

    // Someone who has asked for less motion should be told the number, not
    // shown a performance of it.
    const still =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      from.current = to;
      setShown(to);
      return;
    }

    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setShown(start + (to - start) * ease(p));
      if (p < 1) raf.current = requestAnimationFrame(step);
      else from.current = to;
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      // Land on the target if we are interrupted, so a fast series of changes
      // never leaves a stale figure on screen.
      from.current = to;
    };
  }, [to, duration]);

  return (
    <span className={className} aria-live="polite">
      {format ? format(shown) : Math.round(shown).toLocaleString()}
    </span>
  );
}
