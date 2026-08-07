"use client";

// How far the left column has handed over.
//
// The portrait is the point of the page for about one screen. After that it
// has been seen, it stops earning the space it is pinned in, and the space
// reads as a hole — "you can see empty space in left side… please fill that
// space with terminal… so that user won't see that as empty space hereafter".
//
// So the column does not hold one thing, it holds two, and this is the number
// that crossfades between them: 0 while the portrait is the subject, 1 once
// the shell has taken over. Nothing moves — the swap happens in place, which
// is what makes it read as one surface rather than two stacked panels.
//
// Driven off scroll position rather than IntersectionObserver because the
// value is continuous; an observer gives you crossings, not a ramp.

import { useEffect, useState } from "react";

export function useHandoff() {
  const [t, setT] = useState(0);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const h = window.innerHeight || 1;
      // Hold the portrait for a third of a screen, then trade over the next
      // half. Finishing too early swaps while the orbit is still on show.
      const start = h * 0.34;
      const span = h * 0.5;
      const raw = (window.scrollY - start) / span;
      setT(Math.min(1, Math.max(0, raw)));
    };
    // Coalesce to one read per frame — scroll fires far faster than paint.
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return t;
}
