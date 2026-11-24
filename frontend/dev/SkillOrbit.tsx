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
// THE CHIPS (§101.7): "the wave detailing inside makes the view awkward and
// clumsy… I can't even read the skills clearly". Each chip is a crisp dark-glass
// pill with the skill bright in the middle; the cards' water runs only in a thin
// liquid rim round its edge (painted — no WebGL under the chips any more).
// Before that: each chip sat on a pill of the cards' moving water — "the same
// consistent animation in all cards". The portrait's photos and their pace
// are his to set in the owner panel.
//
// Drag (or swipe) to spin it; it coasts and settles back to its own pace.
// Hover slows it so a chip can be read and clicked (each opens its docs).
//
// One rAF loop writes transforms straight onto the chips: no React state per
// frame. Reduced motion gets the same system, standing still.

import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_ORBIT, DOCS, hueOf, ORBIT_RINGS, type OrbitSkill } from "@/dev/skills";
import { useDev } from "./context";
import { PortraitCore } from "./PortraitCore";
import { framed, PortraitBackdrop, PortraitPhoto } from "./PortraitDesign";
import { isCoreLook } from "./portraits";
import { water } from "./flow";
import { holder } from "./stage";
import { THEME_EVENT } from "./theme";

type Ring = { r: number; k: number; tilt: number; period: number; dir: 1 | -1 };

// r: radius as a share of the box width · k: how flat the ellipse looks
// (the viewing angle) · tilt: the ring's own lean, in degrees · period: seconds a turn
// at the pace he left it at (PS → portrait; a sixth slower than it was: "make the
// movement [a] bit slower… not much, just slightly", 24 Nov).
const RINGS: Ring[] = [
  { r: 0.27, k: 0.8, tilt: -9, period: 36, dir: 1 },
  { r: 0.35, k: 0.64, tilt: 8, period: 55, dir: -1 },
  { r: 0.43, k: 0.53, tilt: -3, period: 77, dir: 1 },
];
/** The owner's panel, trying a pace. */
export const PACE_EVENT = "dev-orbit-pace";
/** Portrait diameter as a share of the box width. Every ring's top (r × k,
 *  at least 0.216) clears its radius (0.18), so nothing hides behind him. */
const PHOTO = 0.36;

type Slot = { ri: number; phase: number; label: string; pinned: boolean };
type Plan = { id: string; slots: Slot[]; cursor: number; pool: string[] };

/** The seats, from his list of skills (§102.6; by default the résumé's,
 *  DEFAULT_ORBIT) — the same on the server and in the browser. Twenty seats on
 *  the three rings, or (a short list) one per skill. The pinned ones are spread
 *  round the rings three, three and two, as the résumé's headline sits (a long
 *  name skips the small inner ring); any more pinned than that come round
 *  first. Every other seat takes the next skill short enough for its ring, and
 *  takes the next one each time it passes behind him. */
function planOrbit(list: OrbitSkill[]): Plan {
  let id = 5381;
  for (const sk of list) for (const ch of (sk.pin ? "*" : "") + sk.name + "|") id = ((id * 33) ^ ch.charCodeAt(0)) >>> 0;
  const base = ORBIT_RINGS.map((r) => r.slots);
  const total = base.reduce((x, y) => x + y, 0);
  let seatsPer = base.slice();
  if (list.length < total) {
    seatsPer = base.map((n) => Math.floor((n * list.length) / total));
    let left = list.length - seatsPer.reduce((x, y) => x + y, 0);
    for (let ri = base.length - 1; left > 0; ri = (ri + base.length - 1) % base.length) {
      seatsPer[ri]++;
      left--;
    }
  }
  const pinCap = ORBIT_RINGS.map((r, ri) => Math.min(seatsPer[ri], Math.max(r.pinned.length, 2)));
  const pinnedOf: string[][] = ORBIT_RINGS.map(() => []);
  const extra: string[] = [];
  for (const sk of list) {
    if (!sk.pin) continue;
    const ri = pinnedOf.findIndex((p, k) => p.length < pinCap[k] && !(k === 0 && sk.name.length > ORBIT_RINGS[0].maxLen + 1));
    if (ri < 0) extra.push(sk.name);
    else pinnedOf[ri].push(sk.name);
  }
  const pool = [...extra, ...list.filter((sk) => !sk.pin).map((sk) => sk.name)];
  const slots: Slot[] = [];
  const shown = new Set<string>();
  let cursor = 0;
  ORBIT_RINGS.forEach((cfg, ri) => {
    const count = seatsPer[ri];
    const pins = pinnedOf[ri];
    const pinAt = new Map<number, string>();
    pins.forEach((lab, k) => pinAt.set(Math.round((k * count) / pins.length), lab));
    for (let i = 0; i < count; i++) {
      let label = pinAt.get(i);
      // The first not yet showing that fits this ring — from the top of the
      // list every time, so what he has just added (it goes first) is seen at
      // once even if its name is too long for the inner ring. Failing that (a
      // short list), the first not yet showing.
      for (const strict of [true, false]) {
        for (let n = 0; n < pool.length && !label; n++) {
          if ((strict && pool[n].length > cfg.maxLen) || shown.has(pool[n])) continue;
          label = pool[n];
          cursor = Math.max(cursor, n + 1);
        }
      }
      if (!label) continue;
      shown.add(label);
      slots.push({ ri, phase: (Math.PI * 2 * i) / count + ri * 0.7, label, pinned: pinAt.has(i) });
    }
  });
  return { id: id.toString(36), slots, cursor: pool.length ? cursor % pool.length : 0, pool };
}

export function SkillOrbit({ photos, interval = 65, pace = 1, onOpenAlbum }: { photos: string[]; interval?: number; pace?: number; onOpenAlbum: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLAnchorElement | null)[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [photo, setPhoto] = useState(0);
  // The portrait's design (his choice, behind the PS door): a photo design,
  // or — with no photo — a living 3D piece in its place (PortraitCore).
  const { portraitLook: look, copy } = useDev();
  const core = isCoreLook(look);
  // His skills (owner panel → Template), or the résumé's: re-planned only when
  // the list itself changes.
  const plan = useMemo(() => planOrbit(copy.skills ?? DEFAULT_ORBIT), [copy.skills]);
  // Which skill each seat carries now: kept across re-runs of the motion (a
  // resize), so what is drawn always matches what is written.
  const seats = useRef<{ plan: Plan; slots: (Slot & { swapped: boolean })[]; shown: Set<string>; cursor: number } | null>(null);

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

  // How fast it goes round: his, and as he tries another.
  const paced = useRef(pace);
  useEffect(() => {
    paced.current = pace;
    const onPace = (e: Event) => {
      const v = (e as CustomEvent<number>).detail;
      paced.current = typeof v === "number" && v >= 0 && v <= 2 ? v : pace;
    };
    window.addEventListener(PACE_EVENT, onPace);
    return () => window.removeEventListener(PACE_EVENT, onPace);
  }, [pace]);

  // The chips' liquid rims are a plain gradient now (globals.css): the painted
  // water was a 51 KB data URL in a custom property, and restyling 20 chips a
  // frame through it cost ~60 ms a chip on a phone (mobile QA, §101.9).

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
    let visible = true;

    // Each seat's skill, as it is now.
    if (seats.current == null || seats.current.plan !== plan) {
      seats.current = {
        plan,
        slots: plan.slots.map((x) => ({ ...x, swapped: false })),
        shown: new Set(plan.slots.map((x) => x.label)),
        cursor: plan.cursor,
      };
    }
    const POOL = plan.pool;
    const seat = seats.current;
    const slots = seat.slots;
    const shown = seat.shown;

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
      const face = node?.firstElementChild as HTMLElement | null;
      if (!node || !face) return;
      face.textContent = next;
      const doc = DOCS[next];
      if (doc) node.setAttribute("href", doc);
      else node.removeAttribute("href");
      node.title = doc ? `${next} — official docs` : next;
      const hue = hueOf(next);
      face.style.color = hue;
      face.style.borderColor = `color-mix(in srgb, ${hue} 35%, transparent)`;
    };

    const lastO: string[] = [];
    const lastZ: number[] = [];
    // Where its middle is on the screen (asked for when the pointer moves, and not again for a while).
    let midX = -1e4;
    let midY = -1e4;
    let asked = 0;
    const onStir = () => {
      const now = performance.now();
      if (now - asked < 350 || !visible) return;
      asked = now;
      const r = el.getBoundingClientRect();
      midX = r.left + r.width / 2;
      midY = r.top + r.height / 2;
    };
    const place = () => {
      const wet = !reduced && water.active();
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
        // The hand in the water (flow.ts): it bobs aside as it passes, and back.
        let ox = 0;
        let oy = 0;
        if (wet) {
          const f = water.at(midX + x, midY + y);
          const k = 0.03 + near * 0.035;
          ox = Math.max(-26, Math.min(26, f[0] * k));
          oy = Math.max(-26, Math.min(26, f[1] * k));
        }
        const scale = 0.74 + near * 0.36;
        const alpha = 0.5 + near * 0.5;
        node.style.transform = `translate(-50%, -50%) translate3d(${(x + ox).toFixed(1)}px, ${(y + oy).toFixed(1)}px, 0) scale(${(scale / ss).toFixed(3)})`;
        // Only what changed: every style write restyles the chip (§101.9).
        const o = alpha.toFixed(2);
        if (lastO[i] !== o) {
          lastO[i] = o;
          node.style.opacity = o;
        }
        const zi = z > 0 ? 30 + Math.round(near * 4) : 10 + Math.round(near * 2);
        if (lastZ[i] !== zi) {
          lastZ[i] = zi;
          node.style.zIndex = String(zi);
        }
      }
    };

    const hold = holder(1, 450);
    // How much larger than life a chip is laid out (and drawn): a browser draws a moving
    // layer once, at its own size, and stretches that — so a near chip's letters, 1.1 times
    // their size, were soft (24 Nov). Now it is always made smaller, never larger.
    const ss = parseFloat(getComputedStyle(el).getPropertyValue("--chip-ss")) || 1;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // Off screen (a phone scrolls past it), or behind the door: nothing to move.
      if (!visible || document.hidden || hold()) {
        raf = requestAnimationFrame(tick);
        return;
      }
      speed += (target - speed) * 0.06;
      clock += dt * speed * paced.current;
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
        if (reduced) place();
      }, 160);
    window.addEventListener(THEME_EVENT, onTheme);

    place();
    // Once more a moment later, when the chips' sizes have settled.
    const late = reduced ? window.setTimeout(place, 1200) : 0;
    if (!reduced) {
      raf = requestAnimationFrame(tick);
      el.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      el.addEventListener("click", onClick, true);
      el.addEventListener("pointerenter", slow);
      el.addEventListener("pointerleave", fast);
      window.addEventListener("pointermove", onStir, { passive: true });
      window.addEventListener("click", onStir, { passive: true });
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
      window.removeEventListener("pointermove", onStir);
      window.removeEventListener("click", onStir);
    };
  }, [size.w, size.h, plan]);

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
      className="dev-orbit relative w-full touch-pan-y select-none [container-type:inline-size]"
      style={{ height: "calc(50cqw + 44px)", minHeight: 240 }}
    >
      {/* Light behind him, in the theme's colours. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-60 blur-3xl"
        style={{ width: "56cqw", height: "34cqw", background: "radial-gradient(closest-side, var(--d-a), var(--d-b) 55%, transparent)" }}
      />

      {/* Immersive: him, large and soft, behind the rings. */}
      {look === "immersive" && <PortraitBackdrop photos={photos} active={photo} />}

      {rings(false)}

      {/* The star: him. */}
      <button
        type="button"
        onClick={onOpenAlbum}
        aria-label="Open the photo album"
        title="Open the album"
        data-portrait
        className="group absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ width: `${PHOTO * 100}cqw`, height: `${PHOTO * 100}cqw` }}
      >
        {core ? (
          // No photo: a living piece in his place, larger than the frame so
          // its light can spill (it draws in its own canvas).
          <span key={look} className="pointer-events-none absolute -inset-[48%]" style={{ animation: "devLookIn 1s ease both" }}>
            <PortraitCore look={look} />
          </span>
        ) : (
          <span key={look} className="absolute inset-0" style={{ animation: "devLookIn .9s ease both" }}>
            {framed(look) && (
              <>
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
              </>
            )}
            <span className={`absolute inset-0 ${framed(look) ? "overflow-hidden rounded-full bg-[var(--d-bg2)] ring-2 ring-[var(--d-bg)]" : ""}`}>
              <PortraitPhoto photos={photos} active={photo} look={look} />
            </span>
          </span>
        )}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 -bottom-6 whitespace-nowrap text-center font-mono text-[10px] text-[var(--d-ink5)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        >
          ⌗ open the album
        </span>
      </button>

      {rings(true)}

      {/* The planets: his skills, each opening its official docs. */}
      {plan.slots.map((c, i) => {
        const hue = hueOf(c.label);
        return (
          <a
            key={`${plan.id}-${i}`}
            ref={(el) => {
              chips.current[i] = el;
            }}
            href={DOCS[c.label] ?? undefined}
            target="_blank"
            rel="noreferrer noopener"
            title={DOCS[c.label] ? `${c.label} — official docs` : c.label}
            draggable={false}
            // What moves carries nothing: its look is its child's. Restyled every frame, a
            // chip with its gradients cost a third of a millisecond each, twenty of them, on
            // a slow machine (24 Nov).
            className="absolute left-1/2 top-1/2 block will-change-transform"
            style={{ opacity: w ? undefined : 0 }}
          >
            <span
              className="dev-orbit-chip block whitespace-nowrap rounded-full border font-mono tracking-wide transition-[box-shadow,filter] duration-300 hover:brightness-150"
              style={{ color: hue, borderColor: `color-mix(in srgb, ${hue} 35%, transparent)`, background: "color-mix(in srgb, var(--d-bg2) 88%, transparent)" }}
            >
              {c.label}
            </span>
          </a>
        );
      })}
    </div>
    </div>
  );
}
