"use client";

// The finale's chain, drawn as real metal in 3D.
//
//   "this area we can enhance more… looks artificial and raw"
//   "the last stage… please have something different kind of animation when we
//    move to that slogan area"
//
// Each link is an actual stadium-shaped loop placed in 3D around a ring on a
// table seen from a little above. Alternate links stand at right angles to
// their neighbours — that is what makes loops read as a CHAIN — and every
// link is stroked like a tube: a lit edge, a body, a shadowed edge, and a
// specular line, brighter the nearer it is.
//
// Two canvases: the far half of the ring behind the slogan, the near half in
// front of it, so the chain truly goes round the words.
//
// The arrival: as the section scrolls in, the links fly in from scattered
// positions, tumbling, and gather into the ring one after another — scrubbed
// by the scroll itself, so you pull the chain together. When the last link
// closes, the ring flashes once and starts to turn.

import { useEffect, useRef, type ReactNode } from "react";
import { readRGB, THEME_EVENT } from "./theme";

type RGB = [number, number, number];
const N = 36;

/** mulberry32: the same scatter on every load. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ChainRing({ children, onAssembled }: { children: ReactNode; onAssembled?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLCanvasElement>(null);
  const front = useRef<HTMLCanvasElement>(null);
  const assembledCb = useRef(onAssembled);
  useEffect(() => {
    assembledCb.current = onAssembled;
  }, [onAssembled]);

  useEffect(() => {
    const host = wrap.current;
    const cb = back.current;
    const cf = front.current;
    if (!host || !cb || !cf) return;
    const gb = cb.getContext("2d");
    const gf = cf.getContext("2d");
    if (!gb || !gf) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let A: RGB = [217, 119, 66];
    let B: RGB = [45, 212, 191];
    let G: RGB = [240, 189, 106];
    const colours = () => {
      A = readRGB(host, "a", A);
      B = readRGB(host, "b", B);
      G = readRGB(host, "gold", G);
    };
    colours();

    const rnd = seeded(7);
    const scatter = Array.from({ length: N }, () => ({
      dx: (rnd() - 0.5) * 2.2,
      dy: (rnd() - 0.5) * 1.8 - 0.4,
      rot: (rnd() - 0.5) * Math.PI * 3,
    }));

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      w = host.clientWidth;
      h = host.clientHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      for (const c of [cb, cf]) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
        c.style.width = `${w}px`;
        c.style.height = `${h}px`;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    const E = (24 * Math.PI) / 180; // camera elevation
    const F = 1500; // camera distance
    let spin = 0;
    let shown = reduced ? 1 : 0; // eased assembly 0..1
    let flash = 0;
    let fired = false;
    let raf = 0;
    let last = performance.now();
    let visible = true;

    const mixRGB = (p: RGB, q: RGB, t: number): RGB => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
    const css = (c: RGB, k: number, a = 1) =>
      `rgba(${Math.min(255, Math.round(c[0] * k))}, ${Math.min(255, Math.round(c[1] * k))}, ${Math.min(255, Math.round(c[2] * k))}, ${a})`;

    const draw = () => {
      // Wider on a phone, so the slogan never touches the side links.
      const R = Math.min(w * (w < 520 ? 0.48 : 0.44), 330);
      const L = ((2 * Math.PI * R) / N) * 1.32; // links overlap: they interlock
      const half = L / 2;
      const rho = L * 0.24;
      const flat = half - rho;
      const T = Math.max(1.6, L * 0.13);
      const cx = w / 2;
      const cy = h / 2;
      const sinE = Math.sin(E);
      const cosE = Math.cos(E);

      // Project a point given in table coordinates (X right, Y up, Z towards you).
      const project = (X: number, Y: number, Z: number) => {
        const depth = F - Z * cosE - Y * sinE;
        const s = F / depth;
        return { x: cx + X * s, y: cy + (-Y * cosE + Z * sinE) * s, s, depth };
      };

      const links: { pts: { x: number; y: number }[]; depth: number; near: number; c: RGB; s: number; a: number }[] = [];
      for (let i = 0; i < N; i++) {
        // Stagger: each link arrives a little after the one before.
        const local = Math.min(1, Math.max(0, (shown * 1.5 - (i / N) * 0.5) / 1));
        const e = 1 - (1 - local) ** 3;
        if (e <= 0.001) continue;
        const th = (i / N) * Math.PI * 2 + spin;
        const px = R * Math.cos(th);
        const pz = R * Math.sin(th);
        const u = [-Math.sin(th), 0, Math.cos(th)]; // along the ring
        const v = i % 2 ? [0, 1, 0] : [Math.cos(th), 0, Math.sin(th)]; // upright or flat
        const centre = project(px, 0, pz);
        const sc = scatter[i];
        const offX = sc.dx * w * (1 - e);
        const offY = sc.dy * h * (1 - e);
        const rot = sc.rot * (1 - e);
        const cr = Math.cos(rot);
        const sr = Math.sin(rot);
        const pts: { x: number; y: number }[] = [];
        const ring = (ax: number, a0: number) => {
          for (let k = 0; k <= 8; k++) {
            const t = a0 + (Math.PI * k) / 8;
            const along = ax + rho * Math.cos(t);
            const across = rho * Math.sin(t);
            const X = px + u[0] * along + v[0] * across;
            const Y = u[1] * along + v[1] * across;
            const Z = pz + u[2] * along + v[2] * across;
            const p = project(X, Y, Z);
            // Tumble in from the scatter: rotate about the link's centre.
            const dx = (p.x - centre.x) * (0.45 + 0.55 * e);
            const dy = (p.y - centre.y) * (0.45 + 0.55 * e);
            pts.push({ x: centre.x + dx * cr - dy * sr + offX, y: centre.y + dx * sr + dy * cr + offY });
          }
        };
        ring(flat, -Math.PI / 2);
        ring(-flat, Math.PI / 2);
        const near = Math.max(0, Math.min(1, (pz / R + 1) / 2));
        // Copper on one side of the ring, teal on the other, gold where they meet.
        const hue = (Math.cos((i / N) * Math.PI * 2) + 1) / 2;
        const c = hue > 0.5 ? mixRGB(G, A, (hue - 0.5) * 2) : mixRGB(B, G, hue * 2);
        links.push({ pts, depth: centre.depth, near, c, s: centre.s, a: e });
      }
      links.sort((p, q) => q.depth - p.depth);

      for (const g of [gb, gf]) {
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.lineJoin = "round";
      }
      if (flash > 0.01) {
        // An ellipse that fits inside the canvas: a round glow wider than the
        // canvas is tall showed its hard edges as a faint rectangle.
        const rx = Math.min(w / 2, R * 1.2);
        const ry = h / 2;
        gb.save();
        gb.translate(cx, cy);
        gb.scale(1, ry / rx);
        const glow = gb.createRadialGradient(0, 0, rx * 0.15, 0, 0, rx);
        glow.addColorStop(0, css(G, 1, 0.32 * flash));
        glow.addColorStop(1, css(G, 1, 0));
        gb.fillStyle = glow;
        gb.fillRect(-rx, -rx, rx * 2, rx * 2);
        gb.restore();
      }
      for (const l of links) {
        const g = l.depth > F ? gb : gf; // far half behind the words
        const lw = T * l.s;
        const light = 0.55 + l.near * 0.6;
        let minY = Infinity;
        let maxY = -Infinity;
        for (const p of l.pts) {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
        const tube = g.createLinearGradient(0, minY - lw, 0, maxY + lw);
        tube.addColorStop(0, css(l.c, light * 1.35, l.a));
        tube.addColorStop(0.45, css(l.c, light, l.a));
        tube.addColorStop(1, css(l.c, light * 0.45, l.a));
        g.beginPath();
        l.pts.forEach((p, k) => (k ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
        g.closePath();
        // A dark rim first, so overlapping links separate cleanly.
        g.strokeStyle = `rgba(0,0,0,${0.35 * l.a})`;
        g.lineWidth = lw + 1.6;
        g.stroke();
        g.strokeStyle = tube;
        g.lineWidth = lw;
        g.stroke();
        // The specular line along the top of the tube.
        g.save();
        g.translate(0, -lw * 0.22);
        g.strokeStyle = `rgba(255,255,255,${(0.18 + l.near * 0.32) * l.a})`;
        g.lineWidth = lw * 0.28;
        g.stroke();
        g.restore();
      }
    };

    const progress = () => {
      const r = host.getBoundingClientRect();
      const vh = window.innerHeight;
      return Math.max(0, Math.min(1, (vh * 0.98 - r.top) / (vh * 0.62)));
    };

    const tick = (now: number) => {
      // Real elapsed time, capped only against a stalled tab: a 0.05 s cap
      // made a 3 fps device gather the chain six times slower than intended.
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      const target = progress();
      // Eased by time, not by frame, so a slow device still closes the chain.
      shown += (target - shown) * (1 - Math.exp(-dt * 5));
      if (shown > 0.985 && !fired) {
        fired = true;
        flash = 1;
        assembledCb.current?.();
      }
      if (shown < 0.5) fired = false;
      flash *= 0.94;
      spin += dt * ((Math.PI * 2) / 48) * (0.15 + 0.85 * shown);
      if (visible) draw();
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "200px" });
    io.observe(host);
    const onTheme = () => {
      colours();
      if (reduced) draw();
    };
    window.addEventListener(THEME_EVENT, onTheme);

    if (reduced) {
      draw();
      assembledCb.current?.();
      ro.disconnect();
      const ro2 = new ResizeObserver(() => {
        resize();
        draw();
      });
      ro2.observe(host);
      return () => {
        ro2.disconnect();
        io.disconnect();
        window.removeEventListener(THEME_EVENT, onTheme);
      };
    }
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener(THEME_EVENT, onTheme);
    };
  }, []);

  return (
    <div ref={wrap} className="relative mx-auto w-full" style={{ height: "clamp(220px, 36vw, 400px)" }}>
      <canvas ref={back} aria-hidden className="pointer-events-none absolute inset-0" />
      <div className="relative z-10 grid h-full place-items-center px-4">{children}</div>
      <canvas ref={front} aria-hidden className="pointer-events-none absolute inset-0 z-20" />
    </div>
  );
}
