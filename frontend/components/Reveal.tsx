"use client";

// Fades/slides children in when they scroll into view (IntersectionObserver).
// No animation library — pure CSS classes from globals.css.
//
//   <Reveal>…</Reveal>                    fade up (default)
//   <Reveal from="left" delay={120}>…     slide in from the left
//
import { useEffect, useRef, useState, type ReactNode } from "react";

type RevealFrom = "up" | "down" | "left" | "right" | "none";

const FROM_CLASS: Record<RevealFrom, string> = {
  up: "",
  down: "mise-reveal-down",
  left: "mise-reveal-left",
  right: "mise-reveal-right",
  none: "mise-reveal-none",
};

export function Reveal({
  children,
  delay = 0,
  from = "up",
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  from?: RevealFrom;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`mise-reveal ${FROM_CLASS[from]} ${shown ? "is-visible" : ""} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}
