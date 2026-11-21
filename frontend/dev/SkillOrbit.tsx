"use client";

// The masterpiece: him at the centre of his own solar system.
//
//   "the master piece of this profile site is this left side my photo + skills
//    revolving around me… photo is not placed rightly… I can see edges… some
//    skills are getting hidden behind my photo"
//
// Rebuilt in real 3D (21 Nov 2026). Each ring is a tilted ellipse — a planet's
// ring seen from slightly above — and every skill on it has a depth:
//
//   · on the FRONT half it passes in front of him, larger and brighter;
//   · on the BACK half it passes behind him, smaller and dimmer.
//
// The rings themselves are drawn twice, back half under the portrait and front
// half over it, so a ring visibly goes round him rather than past him. Sizes
// are chosen so the top of every ring clears the portrait's edge: a skill
// passes behind him, it never vanishes.
//
// Drag (or swipe) to spin it; it coasts and settles back to its own pace.
// Hover slows it so a chip can be read and clicked (each opens its docs).
// The portrait is a crisp circle in a turning rim of the theme's colours —
// the feathered, dissolving edge he could see is gone.
//
// One rAF loop writes transforms straight onto the chips: no React state per
// frame. Reduced motion gets the same system, standing still.

import { useEffect, useRef, useState } from "react";
import { DOCS, HUE_OF, ORBIT_RINGS } from "@/dev/skills";

type Ring = { items: string[]; r: number; k: number; tilt: number; period: number; dir: 1 | -1 };

// r: radius as a share of the box width · k: how flat the ellipse looks
// (the viewing angle) · tilt: the ring's own lean, in degrees.
const RINGS: Ring[] = [
  { items: ORBIT_RINGS[0].items, r: 0.27, k: 0.8, tilt: -9, period: 30, dir: 1 },
  { items: ORBIT_RINGS[1].items, r: 0.35, k: 0.64, tilt: 8, period: 46, dir: -1 },
  { items: ORBIT_RINGS[2].items, r: 0.43, k: 0.53, tilt: -3, period: 64, dir: 1 },
];
/** Portrait diameter as a share of the box width. Every ring's top (r × k,
 *  at least 0.216) clears its radius (0.18), so nothing hides behind him. */
const PHOTO = 0.36;

const CHIPS = RINGS.flatMap((ring, ri) =>
  ring.items.map((label, i) => ({ label, ri, phase: (Math.PI * 2 * i) / ring.items.length + ri * 0.7 })),
);

export function SkillOrbit({ photos, onOpenAlbum }: { photos: string[]; onOpenAlbum: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLAnchorElement | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [photo, setPhoto] = useState(0);

  // Two portraits, crossfading every 65 s — his "don't swap like a raw".
  useEffect(() => {
    if (photos.length < 2) return;
    const id = setInterval(() => setPhoto((n) => (n + 1) % photos.length), 65_000);
    return () => clearInterval(id);
  }, [photos.length]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The motion: angle per chip, depth from the angle, all written to the DOM.
  useEffect(() => {
    const el = box.current;
    if (!el || !size.w) return;
    const W = size.w;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let clock = 0; // seconds of orbit, advanced at `speed`
    let speed = 1;
    let target = 1;
    let spin = 0; // extra angle from dragging
    let vel = 0;

    const place = () => {
      for (let i = 0; i < CHIPS.length; i++) {
        const c = CHIPS[i];
        const node = chips.current[i];
        if (!node) continue;
        const ring = RINGS[c.ri];
        const th = c.phase + ring.dir * ((clock * Math.PI * 2) / ring.period) + spin * (1 - c.ri * 0.18);
        const R = ring.r * W;
        const lx = R * Math.cos(th);
        const ly = R * ring.k * Math.sin(th);
        const t = (ring.tilt * Math.PI) / 180;
        const x = lx * Math.cos(t) - ly * Math.sin(t);
        const y = lx * Math.sin(t) + ly * Math.cos(t);
        const z = Math.sin(th); // +1 nearest, -1 farthest
        const near = (z + 1) / 2;
        node.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${(0.74 + near * 0.36).toFixed(3)})`;
        node.style.opacity = (0.5 + near * 0.5).toFixed(3);
        node.style.zIndex = String(z > 0 ? 30 + Math.round(near * 10) : 10 + Math.round(near * 5));
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      speed += (target - speed) * 0.06;
      clock += dt * speed;
      spin += vel;
      vel *= 0.94;
      place();
      raf = requestAnimationFrame(tick);
    };

    // Drag to spin. Horizontal only, so a vertical swipe still scrolls the page.
    let down: { x: number; moved: boolean } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const dx = e.clientX - down.x;
      if (Math.abs(dx) > 6) down.moved = true;
      vel = dx * 0.0016;
      spin += dx * 0.004;
      down.x = e.clientX;
    };
    const onUp = () => {
      setTimeout(() => (down = null), 0);
    };
    // A drag that ends on a chip must not open its docs.
    const onClick = (e: MouseEvent) => {
      if (down?.moved) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const slow = () => (target = 0.22);
    const fast = () => (target = 1);

    place();
    if (!reduced) {
      raf = requestAnimationFrame(tick);
      el.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      el.addEventListener("click", onClick, true);
      el.addEventListener("pointerenter", slow);
      el.addEventListener("pointerleave", fast);
    }
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("pointerenter", slow);
      el.removeEventListener("pointerleave", fast);
    };
  }, [size.w]);

  const { w, h } = size;
  const cx = w / 2;
  const cy = h / 2;
  const ringPath = (ring: Ring, front: boolean) => {
    const rx = ring.r * w;
    const ry = rx * ring.k;
    // The front half is the lower half of the ellipse (towards the viewer).
    return front
      ? `M ${cx - rx} ${cy} A ${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`
      : `M ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy}`;
  };

  const rings = (front: boolean) =>
    w > 0 && (
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-visible"
        width={w}
        height={h}
        style={{ zIndex: front ? 25 : 5 }}
      >
        <defs>
          <linearGradient id={`orbit-${front ? "f" : "b"}`} x1="0" x2="1">
            <stop offset="0" stopColor="var(--d-a)" />
            <stop offset="0.5" stopColor="var(--d-gold)" />
            <stop offset="1" stopColor="var(--d-b)" />
          </linearGradient>
        </defs>
        {RINGS.map((ring, i) => (
          <path
            key={i}
            d={ringPath(ring, front)}
            transform={`rotate(${ring.tilt} ${cx} ${cy})`}
            fill="none"
            stroke={`url(#orbit-${front ? "f" : "b"})`}
            strokeWidth={front ? 1.4 : 1}
            strokeOpacity={front ? 0.55 : 0.22}
            strokeDasharray={i === 1 ? "2 5" : undefined}
          />
        ))}
      </svg>
    );

  return (
    // The wrapper is the size container: `cqw` in the box's own height must
    // resolve against something ABOVE it — with no container it falls back to
    // the viewport, and the orbit came out 760px tall on a desktop.
    <div className="w-full [container-type:inline-size]">
    <div
      ref={box}
      className="relative w-full touch-pan-y select-none [container-type:inline-size]"
      style={{ height: "calc(50cqw + 44px)", minHeight: 240 }}
    >
      {/* Light behind him, in the theme's colours. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{ width: "56cqw", height: "34cqw", background: "radial-gradient(closest-side, var(--d-a), var(--d-b) 55%, transparent)" }}
      />

      {rings(false)}

      {/* The star: him. */}
      <button
        type="button"
        onClick={onOpenAlbum}
        aria-label="Open the photo album"
        title="Open the album"
        className="group absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ width: `${PHOTO * 100}cqw`, height: `${PHOTO * 100}cqw` }}
      >
        {/* The rim: the theme's colours, slowly turning. */}
        <span
          aria-hidden
          className="absolute -inset-[3px] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, var(--d-a), var(--d-gold), var(--d-b), var(--d-c), var(--d-a))",
            animation: "devSpin 9s linear infinite",
          }}
        />
        <span aria-hidden className="absolute -inset-4 rounded-full opacity-50 blur-xl" style={{ background: "conic-gradient(from 90deg, var(--d-a), var(--d-b), var(--d-a))" }} />
        <span className="absolute inset-0 overflow-hidden rounded-full bg-[var(--d-bg2)] ring-2 ring-[var(--d-bg)]">
          {photos.map((src, n) => (
            // eslint-disable-next-line @next/next/no-img-element -- served from the private bucket through the backend
            <img
              key={src}
              src={src}
              alt={n === 0 ? "Pandian Sambath" : ""}
              aria-hidden={n !== 0}
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover transition-[opacity,transform] duration-[1600ms] ease-out group-hover:scale-[1.05]"
              style={{ objectPosition: "50% 30%", opacity: n === photo ? 1 : 0 }}
            />
          ))}
          {/* A soft light from above, so the photo sits in the room. */}
          <span aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(120% 90% at 30% 10%, rgba(255,255,255,.12), transparent 55%)" }} />
        </span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-6 whitespace-nowrap text-center font-mono text-[10px] text-[var(--d-ink5)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        >
          ⌗ open the album
        </span>
      </button>

      {rings(true)}

      {/* The planets: every skill, each opening its official docs. */}
      {CHIPS.map((c, i) => {
        const hue = HUE_OF[c.label] ?? "var(--d-ink4)";
        return (
          <a
            key={c.label}
            ref={(el) => {
              chips.current[i] = el;
            }}
            href={DOCS[c.label] ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            title={`${c.label} — official docs`}
            draggable={false}
            className="absolute left-1/2 top-1/2 block whitespace-nowrap rounded-full border px-2 py-[3px] font-mono text-[9px] tracking-wide backdrop-blur-sm transition-[box-shadow,filter] duration-300 will-change-transform hover:brightness-150 hover:shadow-[0_0_18px_-2px_currentColor] sm:px-2.5 sm:py-1 sm:text-[11px]"
            style={{
              color: hue,
              borderColor: `color-mix(in srgb, ${hue} 35%, transparent)`,
              background: "color-mix(in srgb, var(--d-bg2) 88%, transparent)",
              opacity: w ? undefined : 0,
            }}
          >
            {c.label}
          </a>
        );
      })}
    </div>
    </div>
  );
}
