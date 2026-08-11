"use client";

// CountUp — the React Bits name, this codebase's implementation.
//
// React Bits' own CountUp depends on `motion` (~30kb), and this app runs on
// tills and wall tablets; a rolling number does not justify shipping an
// animation library to all of them.
//
// It also turned out `components/fx.tsx` already had AnimatedNumber doing the
// same arithmetic — same ease-out cubic, same rAF, same reduced-motion guard —
// differing only in where it counts FROM. So rather than keep two, that one
// grew a `from="previous"` mode and a `format` prop, and this is a name
// pointing at it. Two functions doing the same sum in one codebase is how they
// drift apart.

import { AnimatedNumber } from "@/components/fx";

export function CountUp({
  to,
  duration = 600,
  format,
  className,
}: {
  to: number;
  duration?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  return (
    <AnimatedNumber
      value={to}
      duration={duration}
      format={format}
      className={className}
      from="previous"
    />
  );
}
