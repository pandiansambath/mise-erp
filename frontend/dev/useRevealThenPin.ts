"use client";

// Let a tall column scroll into view, and only then pin it.
//
// `position: sticky; top: 0` pins something from the very first pixel of
// scroll. That is wrong for a column taller than the screen: it freezes with
// its bottom still below the fold, so the part you never saw is the part you
// can never reach.
//
// The fix is the top offset. Pin a SHORT column near the top of the screen;
// pin a TALL one at a negative offset — far enough up that when it finally
// sticks, its last line has just arrived at the last line of the viewport.
// Everything gets revealed on the way, then it stops and the other column
// keeps going.
//
// The offset depends on a height only the browser knows, so it is measured
// rather than guessed, and re-measured whenever the content or window changes.

import { useEffect, useRef, useState } from "react";

const GAP = 24; // breathing room at whichever edge it settles against

export function useRevealThenPin<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [top, setTop] = useState(GAP);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      const spare = window.innerHeight - el.offsetHeight - GAP;
      // Shorter than the screen  -> `spare` is positive, GAP wins: pins high.
      // Taller than the screen   -> `spare` is negative and wins: pins late.
      setTop(Math.min(GAP, spare));
    };

    measure();
    // The orbit settles and the type animation reflows, so a one-shot
    // measurement taken at mount would be of the wrong layout.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return { ref, top };
}
