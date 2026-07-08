"use client";

// Shared building blocks for the premium landing. Dependency-free on purpose:
// IntersectionObserver + rAF + CSS transitions are all GPU-friendly and never
// fight the user's scroll the way JS smooth-scroll libraries can.

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

/** 0 → 1 progress of scrolling through a taller-than-viewport section. */
export function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return setP(0);
      const next = Math.min(1, Math.max(0, -rect.top / total));
      setP((prev) => (Math.abs(next - prev) < 0.002 ? prev : next));
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  return { ref, p };
}

/** Paint the document dark while mounted so overscroll never flashes white. */
export function useDarkDocument() {
  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const prevRoot = root.style.background;
    const prevBody = body.style.background;
    root.style.background = "#030d09";
    body.style.background = "#030d09";
    return () => {
      root.style.background = prevRoot;
      body.style.background = prevBody;
    };
  }, []);
}

/* ─────────────────────────── primitives ────────────────────────── */

/** Counts 0 → value with an ease-out once scrolled into view. */
export function Counter({
  value,
  prefix = "",
  suffix = "",
  duration = 1300,
  className = "",
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLSpanElement>(0.6);
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
      setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, value, duration, reduced]);
  return (
    <span ref={ref} className={className}>
      {prefix}
      {n.toLocaleString("en-GB")}
      {suffix}
    </span>
  );
}

/** Nudges its child toward the cursor — the "magnetic button" feel. */
export function Magnetic({ children, strength = 0.3 }: { children: ReactNode; strength?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - (r.left + r.width / 2);
      const y = e.clientY - (r.top + r.height / 2);
      el.style.transform = `translate(${x * strength}px, ${y * strength}px)`;
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

/** Consistent section opener: mono kicker, serif title, optional sub-line. */
export function SectionHead({
  kicker,
  title,
  sub,
  align = "center",
}: {
  kicker: string;
  title: ReactNode;
  sub?: ReactNode;
  align?: "center" | "left";
}) {
  const cls = align === "center" ? "text-center" : "text-left";
  return (
    <div className={cls}>
      <p className="font-mono text-[11px] tracking-[0.35em] text-copper-300/90 sm:text-xs">{kicker}</p>
      <h2 className="mt-4 font-display text-4xl leading-tight text-white sm:text-5xl">{title}</h2>
      {sub ? (
        <p className={`mt-5 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg ${align === "center" ? "mx-auto" : ""}`}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/** Drifting aurora light — the ambient thread that ties every section
    together. Blurred blobs on their own compositor layers (cheap), with the
    slow hue-melt from the design system. `strength` scales the presence. */
export function Aurora({
  strength = 1,
  copper = true,
  className = "",
}: {
  strength?: number;
  copper?: boolean;
  className?: string;
}) {
  return (
    <div className={`mise-aurora mise-aurora-shift ${className}`} style={{ opacity: strength }} aria-hidden>
      <span
        style={{ left: "-6%", top: "-12%", width: 480, height: 480, background: "radial-gradient(circle, #10b981, transparent 68%)" }}
      />
      <span
        className="hidden sm:block"
        style={{ right: "-8%", top: "14%", width: 440, height: 440, background: "radial-gradient(circle, #0ea5e9, transparent 70%)", animationDelay: "7s" }}
      />
      <span
        style={{
          left: "30%",
          bottom: "-24%",
          width: 520,
          height: 520,
          background: `radial-gradient(circle, ${copper ? "#c07b3e" : "#14b8a6"}, transparent 72%)`,
          animationDelay: "13s",
        }}
      />
    </div>
  );
}

/** Cycles 0..n-1 on an interval — the heartbeat behind "live" demo panels. */
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

export const btnPrimary =
  "mise-btn-shine inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-brand-500 to-brand-400 px-6 py-3 text-base font-semibold text-ink-950 shadow-xl shadow-brand-500/25 transition duration-300 hover:shadow-2xl hover:shadow-brand-400/30";

export const btnGhost =
  "inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/[0.03] px-6 py-3 text-base font-semibold text-white backdrop-blur transition duration-300 hover:border-white/30 hover:bg-white/5";
