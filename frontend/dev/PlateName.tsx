"use client";

// The name, drawn (§102.2): real text set by the browser — selectable, read
// aloud, found by a search — with one 2D canvas over it on which a design
// (plateArt.ts) draws the same letters. Until it has drawn its first frame, and
// wherever it cannot, the plain text is what you see.

import { useEffect, useRef, useState } from "react";
import { layer, measure, readPal, type Art, type ArtFactory, type Geo, type Layer, type Pad, type Ptr } from "./plateKit";
import { THEME_EVENT } from "./theme";

/** The drawing, its columns stretched about the cursor: letters swell there,
 *  standing on their baseline, and settle back with distance (Wave's shape).
 *  One device pixel at a time, side by side: overlapping columns drew their
 *  seams twice over in anything translucent. */
function swell(g: CanvasRenderingContext2D, from: Layer, geo: Geo, x0: number, up: number, row: number, spare: () => Layer) {
  const { dpr, px, lines } = geo;
  const cw = g.canvas.width;
  const ch = g.canvas.height;
  const line = lines[row];
  let src = from.c;
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (lines.length > 1) {
    // A name of several lines: the others as they are, this one alone bent.
    const top = row > 0 ? Math.round((lines[row - 1].base + px * 0.3) * dpr) : 0;
    const end = row < lines.length - 1 ? Math.round((line.base + px * 0.3) * dpr) : ch;
    if (top > 0) g.drawImage(src, 0, 0, cw, top, 0, 0, cw, top);
    if (end < ch) g.drawImage(src, 0, end, cw, ch - end, 0, end, cw, ch - end);
    const own = spare();
    own.g.setTransform(1, 0, 0, 1, 0, 0);
    own.g.clearRect(0, 0, cw, ch);
    own.g.drawImage(src, 0, top, cw, end - top, 0, top, cw, end - top);
    src = own.c;
  }
  const pat = g.createPattern(src, "no-repeat");
  if (!pat) {
    g.drawImage(src, 0, 0);
    return;
  }
  const base = line.base * dpr;
  const mid = Math.round(x0 * dpr);
  const sig = px * 0.72 * dpr;
  const reach = sig * 2.7;
  const tall = 0.36 * up;
  // What lies beyond the swell moves aside by whole pixels, so it stays sharp.
  const shift = Math.round(tall * sig * 0.8862);
  const wide = shift / (sig * 0.8862);
  const bell = (d: number) => Math.exp(-((d / sig) ** 2));
  const m = new DOMMatrix();
  const column = (x: number, u: number) => {
    const s = 1 + tall * bell(u - mid);
    m.a = m.d = s;
    m.e = x + 0.5 - s * u;
    m.f = base * (1 - s) - (s - 1) * px * dpr * 0.22;
    pat.setTransform(m);
    g.fillStyle = pat;
    g.fillRect(x, 0, 1, ch);
  };
  let u = mid;
  let x = mid;
  for (; x < cw && u - mid < reach; x++) {
    const half = 0.5 / (1 + wide * bell(u - mid));
    column(x, u + half);
    u += half + 0.5 / (1 + wide * bell(u + half - mid));
  }
  if (x < cw) g.drawImage(src, x - shift, 0, cw - x, ch, x, 0, cw - x, ch);
  u = mid;
  x = mid;
  for (; x > 0 && mid - u < reach; x--) {
    const half = 0.5 / (1 + wide * bell(u - mid));
    column(x - 1, u - half);
    u -= half + 0.5 / (1 + wide * bell(u - half - mid));
  }
  if (x > 0) g.drawImage(src, shift, 0, x, ch, 0, 0, x, ch);
}

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
    // The swell: how far it has come up, where it is, and the drawing to bend.
    let up = 0;
    let at0 = 0;
    let row = 0;
    let flat: Layer | null = null;
    let own: Layer | null = null;
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
        flat = own = null;
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
      const line = ptr.on ? geo.lines.find((l) => ptr.y > l.base - geo!.px * 0.95 && ptr.y < l.base + geo!.px * 0.3 && ptr.x > l.x0 - geo!.px * 0.4 && ptr.x < l.x1 + geo!.px * 0.4) : undefined;
      up += ((line ? 1 : 0) - up) * (1 - Math.exp(-dt * (line ? 11 : 8)));
      if (line) {
        at0 += (ptr.x - at0) * (up < 0.15 ? 1 : 1 - Math.exp(-dt * 20));
        row = geo.lines.indexOf(line);
      }
      const bend = up > 0.006;
      if (bend && !flat) flat = layer(geo);
      const on = bend ? flat!.g : g;
      for (const c of bend ? [g, on] : [g]) {
        c.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
        c.globalCompositeOperation = "source-over";
        c.globalAlpha = 1;
        c.clearRect(0, 0, geo.W, geo.H);
      }
      try {
        busy = piece.frame(on, t, dt, ptr) || bend;
        if (bend) swell(g, flat!, geo, at0, up, Math.min(row, geo.lines.length - 1), () => (own ??= layer(geo!)));
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
      if (!busy && gap < (geo.phone ? 44 : 38)) return;
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
    <div ref={wrap} data-noswell className="relative w-full" title={hint}>
      <h1 ref={h1} className={className} style={drawn ? { color: "transparent", WebkitTextFillColor: "transparent" } : { color: "var(--d-ink)" }}>
        {text}
      </h1>
      <canvas ref={cv} aria-hidden className="pointer-events-none absolute" style={{ left: 0, top: 0 }} />
    </div>
  );
}
