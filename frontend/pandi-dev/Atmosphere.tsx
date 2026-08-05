"use client";

// Weather for the dev page: aurora blooms, a wave horizon, and a scroll-driven
// depth shift.
//
// It sits BEHIND the chain field rather than replacing it. The chain is the
// structure — deliberate, linked, engineered; the aurora is the light falling
// on it. Two layers doing different jobs read as depth. One layer trying to do
// both reads as noise.
//
// Everything here is compositor-only: transform and opacity, no layout, no
// paint, no JavaScript per frame except one passive scroll listener that
// writes a single custom property. That is what keeps a page this busy at 60fps
// on a phone.

import { useEffect, useRef, useState } from "react";

export function Atmosphere() {
  const root = useRef<HTMLDivElement>(null);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(mq.matches);
    const on = () => setStill(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  // Scroll parallax. One passive listener, batched into a frame, writing ONE
  // custom property — the layers read it in CSS. Moving thirty elements from
  // JavaScript is how a scroll handler starts costing frames.
  useEffect(() => {
    if (still) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        root.current?.style.setProperty("--dev-scroll", String(y));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [still]);

  return (
    <div
      ref={root}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* ── Aurora ─────────────────────────────────────────────────────── */}
      {[
        { c: "#d97742", x: "-18%", y: "-22%", s: 760, d: "0s", dur: "34s" },
        { c: "#2dd4bf", x: "62%", y: "-10%", s: 680, d: "-9s", dur: "44s" },
        { c: "#7c5cff", x: "18%", y: "58%", s: 820, d: "-18s", dur: "52s" },
      ].map((b) => (
        <span
          key={b.c}
          className="absolute rounded-full"
          style={{
            left: b.x,
            top: b.y,
            width: b.s,
            height: b.s,
            background: `radial-gradient(circle, ${b.c} 0%, transparent 66%)`,
            // Heavy blur is what makes a gradient read as LIGHT rather than as
            // a coloured circle sitting on the page.
            filter: "blur(90px)",
            opacity: 0.5,
            animation: still ? undefined : `devAurora ${b.dur} ${b.d} ease-in-out infinite`,
            // Parallax: the blooms drift up as you scroll, slower than content.
            transform: "translate3d(0, calc(var(--dev-scroll, 0) * -0.06px), 0)",
          }}
        />
      ))}

      {/* ── Waves ──────────────────────────────────────────────────────── */}
      {/* Two bands at different speeds. The speed difference IS the parallax —
          no second technique needed. Each path is drawn at 200% width and
          slides exactly -50%, so the loop has no seam. */}
      <div
        className="absolute inset-x-0 bottom-0 h-[42vh]"
        style={{
          transform: "translate3d(0, calc(var(--dev-scroll, 0) * 0.04px), 0)",
        }}
      >
        {[
          { fill: "#d97742", op: 0.1, dur: "28s", h: "62%", bottom: "0%" },
          { fill: "#2dd4bf", op: 0.08, dur: "44s", h: "48%", bottom: "6%" },
        ].map((w) => (
          <div
            key={w.fill}
            className="absolute inset-x-0"
            style={{
              bottom: w.bottom,
              height: w.h,
              opacity: w.op,
              animation: still ? undefined : `devWave ${w.dur} linear infinite`,
              width: "200%",
            }}
          >
            <svg
              viewBox="0 0 1200 200"
              preserveAspectRatio="none"
              className="h-full w-full"
            >
              <path
                d="M0,120 C150,60 300,180 450,120 C600,60 750,180 900,120 C1050,60 1125,150 1200,120 L1200,200 L0,200 Z"
                fill={w.fill}
              />
              {/* The second copy is what makes -50% seamless. */}
              <path
                transform="translate(1200,0)"
                d="M0,120 C150,60 300,180 450,120 C600,60 750,180 900,120 C1050,60 1125,150 1200,120 L1200,200 L0,200 Z"
                fill={w.fill}
              />
            </svg>
          </div>
        ))}
      </div>

      {/* A vignette so the middle of the page stays readable over all of it. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, transparent 30%, rgba(6,10,15,.55) 78%, rgba(6,10,15,.9) 100%)",
        }}
      />
    </div>
  );
}
