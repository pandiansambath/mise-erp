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
// 22 Nov, late — every skill on his résumé, and RAG, MCP, Claude: a few chips
// per ring are pinned (the headline); the others take the next skill each
// time they pass behind him, out of sight, so the whole résumé comes round.
// Each chip sits on a pill of the cards' moving water (OrbitWater) — "the same
// consistent animation in all cards". The portrait's photos and their pace
// are his to set in the owner panel.
//
// Drag (or swipe) to spin it; it coasts and settles back to its own pace.
// Hover slows it so a chip can be read and clicked (each opens its docs).
//
// One rAF loop writes transforms straight onto the chips: no React state per
// frame. Reduced motion gets the same system, standing still.

import { useEffect, useRef, useState } from "react";
import { ALL_SKILLS, DOCS, HUE_OF, ORBIT_MAX_LEN, ORBIT_RINGS } from "@/dev/skills";
import { OrbitWater } from "./OrbitWater";
import { readRGB, THEME_EVENT } from "./theme";

type Ring = { r: number; k: number; tilt: number; period: number; dir: 1 | -1 };

// r: radius as a share of the box width · k: how flat the ellipse looks
// (the viewing angle) · tilt: the ring's own lean, in degrees.
const RINGS: Ring[] = [
  { r: 0.27, k: 0.8, tilt: -9, period: 30, dir: 1 },
  { r: 0.35, k: 0.64, tilt: 8, period: 46, dir: -1 },
  { r: 0.43, k: 0.53, tilt: -3, period: 64, dir: 1 },
];
/** Portrait diameter as a share of the box width. Every ring's top (r × k,
 *  at least 0.216) clears its radius (0.18), so nothing hides behind him. */
const PHOTO = 0.36;
/** How far the water canvas reaches past the box, for chips at the edges. */
const MARGIN = 28;

type Slot = { ri: number; phase: number; label: string; pinned: boolean };

// The starting labels: pinned ones spread round their ring, the rest from the
// résumé's skills in order — the same on the server and in the browser.
const PINNED = new Set(ORBIT_RINGS.flatMap((r) => r.pinned));
const POOL = ALL_SKILLS.filter((s) => !PINNED.has(s) && s.length <= ORBIT_MAX_LEN);
function initialSlots(): { slots: Slot[]; cursor: number } {
  const slots: Slot[] = [];
  const shown = new Set<string>();
  let cursor = 0;
  ORBIT_RINGS.forEach((cfg, ri) => {
    const pinAt = new Map<number, string>();
    cfg.pinned.forEach((lab, k) => pinAt.set(Math.round((k * cfg.slots) / cfg.pinned.length), lab));
    for (let i = 0; i < cfg.slots; i++) {
      let label = pinAt.get(i);
      if (!label) {
        for (let n = 0; n < POOL.length; n++) {
          const cand = POOL[(cursor + n) % POOL.length];
          if (cand.length <= cfg.maxLen && !shown.has(cand)) {
            label = cand;
            cursor = (cursor + n + 1) % POOL.length;
            break;
          }
        }
      }
      label = label ?? POOL[cursor++ % POOL.length];
      shown.add(label);
      slots.push({ ri, phase: (Math.PI * 2 * i) / cfg.slots + ri * 0.7, label, pinned: pinAt.has(i) });
    }
  });
  return { slots, cursor };
}
const START = initialSlots();

export function SkillOrbit({ photos, interval = 65, onOpenAlbum }: { photos: string[]; interval?: number; onOpenAlbum: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const waterCanvas = useRef<HTMLCanvasElement>(null);
  const chips = useRef<(HTMLAnchorElement | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [photo, setPhoto] = useState(0);
  const [waterOn, setWaterOn] = useState(false);
  const water = useRef<OrbitWater | null>(null);
  // Which skill each seat carries now: kept across re-runs of the motion (a
  // resize), so what is drawn always matches what is written.
  const seats = useRef<{ slots: (Slot & { swapped: boolean })[]; shown: Set<string>; cursor: number } | null>(null);

  // His photos, crossfading at his pace ("don't swap like a raw").
  useEffect(() => {
    setPhoto(0);
    if (photos.length < 2) return;
    const id = setInterval(() => setPhoto((n) => (n + 1) % photos.length), Math.max(3, interval) * 1000);
    return () => clearInterval(id);
  }, [photos, interval]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The water under the chips.
  useEffect(() => {
    const c = waterCanvas.current;
    if (!c) return;
    const w = new OrbitWater(c, START.slots.length);
    let live = true;
    void w.init().then((ok) => {
      if (!live) return;
      if (ok) {
        water.current = w;
        setWaterOn(true);
      } else w.dispose();
    });
    return () => {
      live = false;
      water.current = null;
      w.dispose();
    };
  }, []);

  // The motion: angle per chip, depth from the angle, all written to the DOM.
  useEffect(() => {
    const el = box.current;
    if (!el || !size.w) return;
    const W = size.w;
    const H = size.h;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let last = performance.now();
    let clock = 0; // seconds of orbit, advanced at `speed`
    let speed = 1;
    let target = 1;
    let spin = 0; // extra angle from dragging
    let vel = 0;
    let t = 0;
    let visible = true;

    // Each seat's skill, as it is now, and the chips' laid-out sizes.
    if (seats.current == null) {
      seats.current = {
        slots: START.slots.map((x) => ({ ...x, swapped: false })),
        shown: new Set(START.slots.map((x) => x.label)),
        cursor: START.cursor,
      };
    }
    const seat = seats.current;
    const slots = seat.slots;
    const shown = seat.shown;
    const dims = slots.map((_, i) => {
      const n = chips.current[i];
      return n ? [n.offsetWidth, n.offsetHeight] : [60, 20];
    });

    // The chips' colours as numbers, for the water's rims.
    const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
    let rgb = new Map<string, [number, number, number]>();
    const readHues = () => {
      rgb = new Map();
      for (const hue of new Set(Object.values(HUE_OF))) {
        const role = /--d-([a-z0-9]+)/.exec(hue)?.[1] ?? "b";
        const [r, g, b] = readRGB(root, role, [125, 240, 220]);
        rgb.set(hue, [r / 255, g / 255, b / 255]);
      }
    };
    readHues();
    const hueOf = (label: string): [number, number, number] => rgb.get(HUE_OF[label] ?? "") ?? [0.5, 0.9, 0.85];

    const relabel = (i: number) => {
      const s = slots[i];
      const cfg = ORBIT_RINGS[s.ri];
      let next = "";
      for (let n = 0; n < POOL.length; n++) {
        const cand = POOL[(seat.cursor + n) % POOL.length];
        if (cand.length <= cfg.maxLen && !shown.has(cand)) {
          next = cand;
          seat.cursor = (seat.cursor + n + 1) % POOL.length;
          break;
        }
      }
      if (!next) return;
      shown.delete(s.label);
      shown.add(next);
      s.label = next;
      const node = chips.current[i];
      if (!node) return;
      node.textContent = next;
      const doc = DOCS[next];
      if (doc) node.setAttribute("href", doc);
      else node.removeAttribute("href");
      node.title = `${next} — official docs`;
      const hue = HUE_OF[next] ?? "var(--d-ink4)";
      node.style.color = hue;
      node.style.borderColor = `color-mix(in srgb, ${hue} 35%, transparent)`;
      dims[i] = [node.offsetWidth, node.offsetHeight];
    };

    const place = () => {
      const w = water.current;
      if (w) w.resize(W + MARGIN * 2, H + MARGIN * 2);
      for (let i = 0; i < slots.length; i++) {
        const c = slots[i];
        const node = chips.current[i];
        if (!node) continue;
        const ring = RINGS[c.ri];
        const th = c.phase + ring.dir * ((clock * Math.PI * 2) / ring.period) + spin * (1 - c.ri * 0.18);
        const R = ring.r * W;
        const lx = R * Math.cos(th);
        const ly = R * ring.k * Math.sin(th);
        const tt = (ring.tilt * Math.PI) / 180;
        const x = lx * Math.cos(tt) - ly * Math.sin(tt);
        const y = lx * Math.sin(tt) + ly * Math.cos(tt);
        const z = Math.sin(th); // +1 nearest, -1 farthest
        // Behind him, out of sight: the next skill takes the seat.
        if (!c.pinned && !reduced) {
          if (z < -0.96 && !c.swapped) {
            c.swapped = true;
            relabel(i);
          } else if (z > -0.5) c.swapped = false;
        }
        const near = (z + 1) / 2;
        const scale = 0.74 + near * 0.36;
        const alpha = 0.5 + near * 0.5;
        node.style.transform = `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
        node.style.opacity = alpha.toFixed(3);
        node.style.zIndex = String(z > 0 ? 30 + Math.round(near * 10) : 10 + Math.round(near * 5));
        if (w) w.set(i, W / 2 + x + MARGIN, H / 2 + y + MARGIN, dims[i][0] * scale, dims[i][1] * scale, alpha, hueOf(c.label));
      }
      if (w && visible) w.render(t);
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
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
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const onTheme = () =>
      window.setTimeout(() => {
        readHues();
        if (reduced) place();
      }, 160);
    window.addEventListener(THEME_EVENT, onTheme);

    place();
    // The water arrives a moment later (three.js loads); draw it once then.
    const late = reduced ? window.setTimeout(place, 1200) : 0;
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
      window.clearTimeout(late);
      io.disconnect();
      window.removeEventListener(THEME_EVENT, onTheme);
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.removeEventListener("click", onClick, true);
      el.removeEventListener("pointerenter", slow);
      el.removeEventListener("pointerleave", fast);
    };
  }, [size.w, size.h]);

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
      data-orbit-gl={waterOn ? "" : undefined}
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

      {/* The chips' water: under the portrait and the chips, over the back
          of the rings. */}
      <canvas
        ref={waterCanvas}
        aria-hidden
        className="pointer-events-none absolute"
        style={{ left: -MARGIN, top: -MARGIN, width: `calc(100% + ${MARGIN * 2}px)`, height: `calc(100% + ${MARGIN * 2}px)`, zIndex: 6 }}
      />

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

      {/* The planets: his skills, each opening its official docs. */}
      {START.slots.map((c, i) => {
        const hue = HUE_OF[c.label] ?? "var(--d-ink4)";
        return (
          <a
            key={i}
            ref={(el) => {
              chips.current[i] = el;
            }}
            href={DOCS[c.label] ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            title={`${c.label} — official docs`}
            draggable={false}
            className="dev-orbit-chip absolute left-1/2 top-1/2 block whitespace-nowrap rounded-full border px-2 py-[3px] font-mono text-[9px] tracking-wide transition-[box-shadow,filter] duration-300 will-change-transform hover:brightness-150 hover:shadow-[0_0_18px_-2px_currentColor] sm:px-2.5 sm:py-1 sm:text-[11px]"
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
