"use client";

// How far the left column has handed over — WITHOUT re-rendering the page.
//
// This used to be `useState`, updated on every scroll frame. That is what made
// everything shake: a state change here re-rendered DevProfile sixty times a
// second, and with it the orbit, the skill cards and the shell. Anything whose
// animation is tied to its own render restarted continuously — "literally all
// things are shaking like earthquake, my skills revolving and all shaking".
//
// So no state. The scroll handler writes opacity and transform STRAIGHT onto
// two DOM nodes. React renders this page once and then stays out of the way,
// which is what it should have done from the start: a crossfade is a paint
// concern, not application state.

import { useEffect, useRef } from "react";

export function useHandoff<A extends HTMLElement, B extends HTMLElement>() {
  const goingRef = useRef<A>(null); // the portrait, on its way out
  const comingRef = useRef<B>(null); // the shell, on its way in
  const smokeRef = useRef<HTMLDivElement>(null); // what covers the swap

  useEffect(() => {
    let frame = 0;

    const paint = () => {
      frame = 0;
      const h = window.innerHeight || 1;
      // Hold the portrait for a third of a screen, then trade over the next
      // half. Finishing sooner swaps while the orbit is still on show.
      const t = Math.min(1, Math.max(0, (window.scrollY - h * 0.34) / (h * 0.5)));

      const going = goingRef.current;
      const coming = comingRef.current;
      if (going) {
        going.style.opacity = String(1 - t);
        going.style.transform = `scale(${1 - t * 0.04})`;
        // The faded ghost must stop swallowing clicks meant for the shell.
        going.style.pointerEvents = t > 0.5 ? "none" : "";
      }
      if (coming) {
        coming.style.opacity = String(t);
        coming.style.transform = `translateY(${(1 - t) * 18}px)`;
        coming.style.pointerEvents = t > 0.5 ? "" : "none";
      }
      // Smoke over the join.
      //
      // Two things dissolving through each other reads as a glitch, because
      // for a moment you can see both. Cover the middle of the swap and the
      // eye accepts it as one thing becoming another — which is the oldest
      // trick in stagecraft. Peaks at the halfway point and is gone at both
      // ends, so it costs nothing when nothing is happening.
      const smoke = smokeRef.current;
      if (smoke) {
        const veil = Math.sin(Math.PI * t); // 0 → 1 → 0
        smoke.style.opacity = String(veil * 0.85);
        smoke.style.transform = `scale(${1 + veil * 0.35}) translateY(${(0.5 - t) * 30}px)`;
      }
    };

    // Coalesce to one write per frame — scroll fires far faster than paint.
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
  }, []);

  return { goingRef, comingRef, smokeRef };
}
