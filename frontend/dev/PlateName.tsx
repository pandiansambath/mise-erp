"use client";

// The name, drawn (§102.2): real text set by the browser — selectable, read
// aloud, found by a search — with one 2D canvas over it on which a design
// (plateArt.ts) draws the same letters. Until it has drawn its first frame, and
// wherever it cannot, the plain text is what you see.

import { useEffect, useRef, useState } from "react";
import { measure, readPal, type Art, type ArtFactory, type Geo, type Pad, type Ptr } from "./plateKit";
import { THEME_EVENT } from "./theme";

export function PlateName({
  text,
  entered,
  art,
  pad,
  className = "",
  hint,
}: {
  text: string;
  entered: boolean;
  art: ArtFactory;
  pad: (phone: boolean) => Pad;
  /** The name's type: font, size, weight. */
  className?: string;
  /** What a touch does, for a mouse's tooltip. */
  hint?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const h1 = useRef<HTMLHeadingElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  // How long it has played: kept while his words are edited under it, so each
  // letter typed does not play the entrance again.
  const clock = useRef(0);

  useEffect(() => {
    const box = wrap.current;
    const head = h1.current;
    const canvas = cv.current;
    if (!box || !head || !canvas || !entered) return;
    const g = canvas.getContext("2d");
    if (!g) return;
    const root = box.closest<HTMLElement>(".dev-root") ?? document.querySelector<HTMLElement>(".dev-root") ?? document.documentElement;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ptr: Ptr = { x: 0, y: 0, on: false, taps: [] };
    let geo: Geo | null = null;
    let piece: Art | null = null;
    let t = still ? 60 : clock.current > 6 ? clock.current : 0;
    let busy = true;
    let raf = 0;
    let last = performance.now();
    let visible = true;
    let scrolled = 0;
    let dead = false;
    let shape = "";

    const build = (force = false) => {
      if (dead) return;
      try {
        const phone = window.matchMedia("(max-width: 767px)").matches;
        const next = measure(head, box, pad(phone));
        if (!next) return;
        // The first resize notice (and any that changes nothing) is not news:
        // rebuilding for it threw the entrance away.
        const key = `${next.font}|${next.W}x${next.H}|${next.left.toFixed(1)}|${next.glyphs.map((l) => `${l.ch}${l.x.toFixed(1)},${l.y.toFixed(1)}`).join(" ")}`;
        if (key === shape && !force) return;
        shape = key;
        geo = next;
        canvas.width = Math.max(1, Math.round(geo.W * geo.dpr));
        canvas.height = Math.max(1, Math.round(geo.H * geo.dpr));
        Object.assign(canvas.style, { left: `${geo.left}px`, top: `${geo.top0}px`, width: `${geo.W}px`, height: `${geo.H}px` });
        piece = art(geo, readPal(root), { root, still, t });
        busy = true;
        if (still) draw(0.016);
      } catch {
        piece = null;
        setDrawn(false);
      }
    };
    const draw = (dt: number) => {
      if (!geo || !piece) return;
      g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.clearRect(0, 0, geo.W, geo.H);
      try {
        busy = piece.frame(g, t, dt, ptr);
        setDrawn(true);
      } catch {
        piece = null;
        g.clearRect(0, 0, geo.W, geo.H);
        setDrawn(false);
      }
    };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (!visible || document.hidden || !piece || !geo) {
        last = now;
        return;
      }
      // On a phone the page's scroll comes first; at rest, half the frames.
      if (geo.phone && now - scrolled < 150) {
        last = now;
        return;
      }
      const gap = now - last;
      if (!busy && gap < (geo.phone ? 40 : 30)) return;
      if (geo.phone && gap < 22) return;
      last = now;
      const dt = Math.min(0.05, gap / 1000);
      t += dt;
      clock.current = t;
      draw(dt);
    };

    let pending = 0;
    const again = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(build, 120);
    };
    const retheme = () => {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => build(true), 160);
    };
    const at = (e: PointerEvent) => {
      if (!geo) return;
      const r = canvas.getBoundingClientRect();
      ptr.x = ((e.clientX - r.left) / Math.max(1, r.width)) * geo.W;
      ptr.y = ((e.clientY - r.top) / Math.max(1, r.height)) * geo.H;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      at(e);
      ptr.on = true;
      busy = true;
    };
    const onLeave = () => {
      ptr.on = false;
    };
    const onTap = (e: MouseEvent) => {
      at(e as PointerEvent);
      ptr.taps.push({ x: ptr.x, y: ptr.y });
      busy = true;
    };
    const onScroll = () => {
      scrolled = performance.now();
    };
    const ro = new ResizeObserver(again);
    ro.observe(box);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(box);
    window.addEventListener(THEME_EVENT, retheme);
    window.addEventListener("scroll", onScroll, { passive: true });
    if (!still) {
      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerleave", onLeave);
      box.addEventListener("click", onTap);
      raf = requestAnimationFrame(loop);
    }
    void document.fonts.ready.then(() => build());
    return () => {
      dead = true;
      window.clearTimeout(pending);
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener(THEME_EVENT, retheme);
      window.removeEventListener("scroll", onScroll);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerleave", onLeave);
      box.removeEventListener("click", onTap);
    };
  }, [entered, art, pad, text, className]);

  return (
    <div ref={wrap} className="relative w-full" title={hint}>
      <h1 ref={h1} className={className} style={drawn ? { color: "transparent", WebkitTextFillColor: "transparent" } : { color: "var(--d-ink)" }}>
        {text}
      </h1>
      <canvas ref={cv} aria-hidden className="pointer-events-none absolute" style={{ left: 0, top: 0 }} />
    </div>
  );
}
