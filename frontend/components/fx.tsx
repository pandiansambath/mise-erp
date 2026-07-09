"use client";

// App-wide motion & liveness primitives — the landing page's soul, lifted into
// the app. Theme-aware (semantic tokens), reduced-motion-safe, 60fps rules:
// transform/opacity only, observers detach after firing, timers only on screen.

import { useEffect, useRef, useState, type ReactNode } from "react";

/* ───────────────────────────── hooks ───────────────────────────── */

/** True once the element has entered the viewport (fires once, then detaches). */
export function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            setInView(true);
            io.disconnect();
          }
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/** Cycles 0..n-1 on an interval — the heartbeat behind "live" panels. */
export function useTick(n: number, ms = 2200) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (n <= 1) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setI((v) => (v + 1) % n), ms);
    return () => window.clearInterval(id);
  }, [n, ms]);
  return i;
}

/* ─────────────────────────── components ────────────────────────── */

/** Numbers never pop in — they count. Formats en-GB, supports decimals. */
export function AnimatedNumber({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1200,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.4);
  const reduced = usePrefersReducedMotion();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setN(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration);
      setN(value * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduced]);
  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}

/** Nudges its child toward the cursor — for primary CTAs only. */
export function Magnetic({ children, strength = 0.25 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      el.style.transform = `translate(${(e.clientX - (r.left + r.width / 2)) * strength}px, ${(e.clientY - (r.top + r.height / 2)) * strength}px)`;
    };
    const onLeave = () => {
      el.style.transform = "";
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
    };
  }, [strength]);
  return (
    <div ref={ref} className="inline-block transition-transform duration-200 ease-out">
      {children}
    </div>
  );
}

/** Drifting aurora light. Self-clipping — NEVER put overflow-hidden on the
    host for this (it silently breaks position:sticky descendants). */
export function Aurora({
  strength = 0.35,
  copper = true,
  className = "",
}: {
  strength?: number;
  copper?: boolean;
  className?: string;
}) {
  return (
    <div className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`} aria-hidden>
      <div className="mise-aurora mise-aurora-shift" style={{ opacity: strength }}>
        <span
          style={{ left: "-6%", top: "-12%", width: 440, height: 440, background: "radial-gradient(circle, #10b981, transparent 68%)" }}
        />
        <span
          className="hidden sm:block"
          style={{ right: "-8%", top: "16%", width: 400, height: 400, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "7s" }}
        />
        <span
          style={{
            left: "32%",
            bottom: "-24%",
            width: 480,
            height: 480,
            background: `radial-gradient(circle, ${copper ? "#c07b3e" : "#14b8a6"}, transparent 72%)`,
            animationDelay: "13s",
          }}
        />
      </div>
    </div>
  );
}
