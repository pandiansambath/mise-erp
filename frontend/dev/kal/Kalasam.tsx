"use client";

// S1 · கலசம் (docs/temple/ART.md): who he is. His name on both sides of the great horseshoe
// window, his face in it, the stone wheel of his skills turning round his face.

import { useContext, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useDev, useNow, usePortraits, useWord, chennaiTime } from "../context";
import { did } from "../did";
import { isCoreLook } from "../portraits";
import { DEFAULT_ORBIT, DOCS, type OrbitSkill } from "../skills";
import { whenOpen, openedBefore } from "../stage";
import { cutBefore, rememberCut } from "./Hall";
import { Lamps } from "./lamps";
import type { Laid } from "./stone";
import { KalWorld } from "./context";
import type { Scene } from "./world";

/** The scene on a desktop, and on a phone: the carving, where the hub of the wheel is and how large the
 *  wheel, his name's two places, the couplet's, the lamps. In the scene's own px. */
const DESK = {
  w: 1536,
  piece: "s1" as const,
  top: 54,
  hub: { x: 768, y: 392 },
  wheel: 1,
  name: { w: 420, h: 84, fs: 74, fit: 396, a: { x: 96, y: 290, align: "right" }, b: { x: 1020, y: 290, align: "left" } },
  kural: { x: 386, y: 666, w: 764, h: 46, fs: 25, lead: 0, rows: ["தொட்டனைத் தூறும் மணற்கேணி மாந்தர்க்குக்"] },
  lamps: [
    { x: 150, y: 223, step: 58, size: 25 },
    { x: 1038, y: 223, step: 58, size: 25 },
  ],
};
const PHONE = {
  w: 393,
  piece: "s1p" as const,
  top: 52,
  hub: { x: 196.5, y: 424 },
  wheel: 0.779,
  name: { w: 349, h: 44, fs: 47, fit: 330, a: { x: 22, y: 179, align: "center" }, b: { x: 22, y: 588, align: "center" } },
  kural: { x: 24, y: 762, w: 345, h: 60, fs: 17.5, lead: 27, rows: ["தொட்டனைத் தூறும்", "மணற்கேணி மாந்தர்க்குக்"] },
  lamps: [{ x: 40, y: 127, step: 52, size: 21 }],
};
const R = 172;
const RINGS: [number, number, number] = [0.602, 0.806, 1.2];
/** Seconds a turn, of the three rings of the wheel. */
const TURN = [96, -128, 160];
/** Where the chips hang: on which ring, how far out, how many, how long a name may be. */
const SEATS = [
  { ring: 1, r: 121, n: 5, max: 6 },
  { ring: 2, r: 158, n: 8, max: 13 },
];

type Box = [number, number, number?, number?];
/** Its box on a desktop and on a phone (kal.css: .kal-at). */
const at = (d: Box, p: Box): CSSProperties => {
  const v: Record<string, string> = {};
  ["x", "y", "w", "h"].forEach((k, i) => {
    v[`--d${k}`] = d[i] === undefined ? "auto" : `calc(${d[i]} * var(--u))`;
    v[`--p${k}`] = p[i] === undefined ? "auto" : `calc(${p[i]} * var(--u))`;
  });
  return v as CSSProperties;
};

type Seat = { ring: number; r: number; phase: number; label: string; pin: boolean; max: number };

function seatsOf(list: OrbitSkill[]): { seats: Seat[]; pool: string[] } {
  const pins = list.filter((s) => s.pin).map((s) => s.name);
  const rest = list.filter((s) => !s.pin).map((s) => s.name);
  const shown = new Set<string>();
  const take = (from: string[], max: number) => {
    const n = from.find((x) => !shown.has(x) && x.length <= max);
    if (n) shown.add(n);
    return n;
  };
  const seats: Seat[] = [];
  SEATS.forEach((c) => {
    for (let i = 0; i < c.n; i++) {
      // His own first choices on every other seat.
      const own = i % 2 === 0 ? take(pins, c.max) : undefined;
      const label = own ?? take(rest, c.max) ?? take(pins, c.max);
      if (label) seats.push({ ring: c.ring, r: c.r, phase: ((i + (c.ring === 1 ? 0.5 : 0)) / c.n) * Math.PI * 2, label, pin: !!own, max: c.max });
    }
  });
  return { seats, pool: [...pins, ...rest] };
}

function Clock() {
  const now = useNow();
  return <span className="kal-clock">{now ? chennaiTime(now) : " "}</span>;
}

export function Kalasam() {
  const world = useContext(KalWorld)!;
  const { copy, portraits, portraitLook, openAlbum } = useDev();
  const word = useWord();
  const photos = usePortraits();
  const box = useRef<HTMLDivElement>(null);
  const hub = useRef<HTMLDivElement>(null);
  const chips = useRef<(HTMLAnchorElement | null)[]>([]);
  const plan = useMemo(() => seatsOf(copy.skills ?? DEFAULT_ORBIT), [copy.skills]);
  const [photo, setPhoto] = useState(0);
  const pace = portraits.pace ?? 1;
  const interval = portraits.interval ?? 65;
  const name = word("name").toUpperCase();
  const [first, ...more] = name.split(/\s+/);
  const last = more.join(" ");

  useEffect(() => {
    setPhoto(0);
    if (photos.length < 2) return;
    const id = setInterval(() => setPhoto((n) => (n + 1) % photos.length), Math.max(3, interval) * 1000);
    return () => clearInterval(id);
  }, [photos, interval]);

  useEffect(() => {
    const el = box.current;
    const hubEl = hub.current;
    if (!el || !hubEl) return;
    const lamps = [new Lamps(7), new Lamps(7)];
    const turn: [number, number, number] = [0, 0, 0];
    let vel = 0;
    let s = 1;
    let opened = -1;
    let raw: Laid | null = null;
    const fresh = !cutBefore("gate") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let wakeAt = Infinity;
    let reach = 1;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const seats = plan.seats.map((x) => ({ ...x, swapped: false }));
    const shown = new Set(seats.map((x) => x.label));
    let cursor = 0;

    // Out of sight behind the railing: the next of his skills takes the seat.
    const relabel = (i: number) => {
      const seat = seats[i];
      for (let n = 0; n < plan.pool.length; n++) {
        const next = plan.pool[(cursor + n) % plan.pool.length];
        if (next.length > seat.max || shown.has(next)) continue;
        cursor = (cursor + n + 1) % plan.pool.length;
        shown.delete(seat.label);
        shown.add(next);
        seat.label = next;
        const a = chips.current[i];
        const face = a?.firstElementChild;
        if (!a || !face) return;
        face.textContent = next;
        const doc = DOCS[next];
        if (doc) a.setAttribute("href", doc);
        else a.removeAttribute("href");
        a.title = doc ? `${next} — official docs` : next;
        return;
      }
    };
    const placeChips = () => {
      for (let i = 0; i < seats.length; i++) {
        const c = seats[i];
        const a = chips.current[i];
        if (!a) continue;
        const th = c.phase + turn[c.ring];
        const x = Math.cos(th) * c.r * reach;
        const y = Math.sin(th) * c.r * reach;
        const low = Math.sin(th);
        if (!c.pin && !still) {
          if (low > 0.97 && !c.swapped) {
            c.swapped = true;
            relabel(i);
          } else if (low < 0.6) c.swapped = false;
        }
        a.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) translate(-50%, -50%)`;
      }
    };

    const scene: Scene = {
      el,
      laid: [],
      front: [],
      cuts: [],
      rows: lamps.map((l) => l.row),
      lay(p, w) {
        const D = p.phone ? PHONE : DESK;
        s = p.w / D.w;
        const X = (x: number) => p.x + x * s;
        const Y = (y: number) => p.y + y * s;
        const ws = D.wheel * s;
        reach = ws;
        // Until the door has opened (the first time in a visit), all of it is raw rock but his name, the
        // slabs and the couplet, and the wheel his face is in: it lets go from the wheel outward.
        const outlines = new Float32Array(64);
        let no = 0;
        el.querySelectorAll<HTMLElement>(".kal-at").forEach((n) => {
          const b = n.getBoundingClientRect();
          const r0 = el.getBoundingClientRect();
          if (b.width < 2 || no >= 16) return;
          outlines.set([p.x + b.left - r0.left, p.y + b.top - r0.top, -b.width, b.height], no * 4);
          no++;
        });
        void Promise.all([w.piece(D.piece), w.piece("wheel"), w.piece("rail"), w.piece("rock")]).then(([s1, wh, rail, rock]) => {
          scene.laid = [
            { piece: s1, x: X(0), y: Y(D.top), s },
            { piece: wh, x: X(D.hub.x) - 176 * ws, y: Y(D.hub.y) - 176 * ws, s: ws, z: -18, rings: { r: RINGS, a: turn } },
          ];
          scene.front = [{ piece: rail, x: X(D.hub.x) - 158 * ws, y: Y(D.hub.y) + 148 * ws, s: ws, z: 12 }];
          if (fresh && (!raw || (raw.raw && raw.raw.at > 1e8))) {
            raw = { piece: rock, x: X(0), y: Y(D.top + 40), w: D.w * s, h: (D.piece === "s1" ? 636 : 760) * s, s, z: 24, raw: { at: raw?.raw?.at ?? 1e9, x: X(D.hub.x), y: Y(D.hub.y), outlines } };
          }
          if (raw) scene.front.push(raw);
          w.dirty = true;
        });
        lamps.forEach((l, i) => {
          const c = D.lamps[i];
          l.row.n = c ? l.n : 0;
          if (c) l.place(X(c.x), Y(c.y), c.step * s, c.size * s);
        });
        // His name, cut into the polished stone; and the couplet's first line.
        const css = getComputedStyle(el);
        const family = css.getPropertyValue("--kal-cut") || "Cinzel";
        const N = D.name;
        const g = document.createElement("canvas").getContext("2d")! as CanvasRenderingContext2D & { letterSpacing: string };
        g.font = `700 100px ${family}`;
        g.letterSpacing = "7px";
        const wide = Math.max(g.measureText(first).width, g.measureText(last).width, 1);
        const fs = Math.min(N.fs, (N.fit / wide) * 100) * s;
        const bw = N.w * s;
        const bh = N.h * s;
        scene.cuts = [];
        const put = (id: string, text: string, c: { x: number; y: number; align: string }) => {
          if (!text) return;
          const pad = 10 * s;
          const x = c.align === "right" ? bw - pad : c.align === "left" ? pad : bw / 2;
          const made = w.letters(id, [{ text, font: `700 ${fs.toFixed(2)}px ${family}`, spacing: 0.07 * fs, x, y: bh / 2 + fs * 0.35, align: c.align as CanvasTextAlign }], X(c.x), Y(c.y), bw, bh);
          if (made) scene.cuts.push(made);
        };
        put("name-a", first, N.a);
        put("name-b", last, N.b);
        const K = D.kural;
        const kw = K.w * s;
        const kh = K.h * s;
        const font = `700 ${(K.fs * s).toFixed(2)}px ${css.getPropertyValue("--kal-tamil") || "serif"}`;
        const kural = w.letters(
          "kural-a",
          K.rows.map((text, i) => ({ text, font, x: kw / 2, y: kh / 2 + (K.fs * 0.34 + (i - (K.rows.length - 1) / 2) * K.lead) * s, align: "center" as CanvasTextAlign })),
          X(K.x),
          Y(K.y),
          kw,
          kh,
        );
        if (kural) scene.cuts.push(kural);
        if (still) lamps.forEach((l) => l.all());
      },
      tick(t, dt, w) {
        if (opened >= 0 && wakeAt === Infinity) {
          wakeAt = t + (openedBefore() ? 0.2 : 0.4);
          if (raw?.raw) {
            raw.raw.at = wakeAt - 0.2;
            rememberCut("gate");
          }
        }
        if (raw?.raw && t - raw.raw.at > 1.5 && raw.raw.at < 1e8) {
          scene.front = scene.front.filter((l) => l !== raw);
          raw = null;
        }
        const rawBusy = !!raw?.raw && raw.raw.at < 1e8;
        let busy = false;
        const hand: [number, number] = [w.stone!.torch.x, w.stone!.torch.y];
        if (opened >= 0)
          for (const l of lamps) if (l.tick(t, hand[0], hand[1])) busy = true;
        // Molten gold is poured into his name; then the lamps catch, from the window outward.
        const a = t - wakeAt;
        for (const c of scene.cuts) {
          if (still) {
            c.pour = 1e5;
            c.wake = 1;
            continue;
          }
          const run = (a - 0.5) * 420 * s;
          c.pour = opened < 0 ? -40 : a > 5 ? 1e5 : Math.max(-40, run);
          c.wake += ((lamps[0].awake ? 1 : 0.42) - c.wake) * Math.min(1, dt * 1.5);
        }
        if ((a > 0 && a < 5) || rawBusy) busy = true;
        if (a > 1.6 && a < 1.9) {
          lamps[0].wake(t, 1);
          lamps[1].wake(t, 0);
        }
        if (!still) {
          const d = dt * (pace || 0);
          for (let i = 0; i < 3; i++) turn[i] = turn[i] + (d * Math.PI * 2) / TURN[i] + vel * dt * [0.7, 0.85, 1][i];
          vel *= Math.exp(-dt / 0.8);
          if (Math.abs(vel) > 0.02) busy = true;
        }
        return busy;
      },
      drawn: placeChips,
    };
    const off = world.add(scene);
    const offOpen = whenOpen(() => {
      opened = performance.now();
    });

    // Turned by hand: heavy, and it eases back to its calm.
    let down: { x: number; y: number; moved: number } | null = null;
    const onDown = (e: PointerEvent) => {
      down = { x: e.clientX, y: e.clientY, moved: 0 };
    };
    const onMove = (e: PointerEvent) => {
      if (!down) return;
      const r = hubEl.getBoundingClientRect();
      const ox = down.x - (r.left + r.width / 2);
      const oy = down.y - (r.top + r.height / 2);
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      down.moved += Math.hypot(dx, dy);
      if (down.moved > 6) did("orbit");
      const rr = Math.max(40 * 40, ox * ox + oy * oy);
      const da = (ox * dy - oy * dx) / rr;
      for (let i = 0; i < 3; i++) turn[i] += da * [0.7, 0.85, 1][i];
      vel = vel * 0.6 + (da / Math.max(0.008, 1 / 60)) * 0.4;
      vel = Math.max(-4, Math.min(4, vel));
      down.x = e.clientX;
      down.y = e.clientY;
      world.dirty = true;
    };
    const onUp = () => {
      setTimeout(() => (down = null), 0);
    };
    const onClick = (e: MouseEvent) => {
      if (down && down.moved > 6) {
        e.preventDefault();
        e.stopPropagation();
      } else if ((e.target as Element).closest("a")) did("orbit");
    };
    hubEl.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    hubEl.addEventListener("click", onClick, true);
    return () => {
      off();
      offOpen();
      hubEl.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      hubEl.removeEventListener("click", onClick, true);
    };
  }, [world, plan, pace, first, last]);

  return (
    <section className="kal-s1">
      <div ref={box} className="kal-s1-box">
        <h1 className="kal-name" data-hero-name data-cut>
          <span className="kal-at kal-hello" style={at([120, 282], [26, 172])}>
            {word("hello")}
          </span>
          <span className="kal-at kal-name-a" style={at([96, 290, 420, 84], [22, 179, 349, 44])}>
            {first}
          </span>{" "}
          <span className="kal-at kal-name-b" style={at([1020, 290, 420, 84], [22, 588, 349, 44])}>
            {last}
          </span>
        </h1>

        <div className="kal-at kal-slab" style={at([148, 432, 336, 62], [34, 662, 200, 68])}>
          <p className="kal-lead">{word("role")}</p>
          <p className="kal-body">
            {word("at")} {word("company")}
          </p>
        </div>
        <div className="kal-at kal-slab kal-slab-r" style={at([1052, 432, 336, 62], [219, 662, 140, 68])}>
          <p className="kal-label">{word("place")}</p>
          <Clock />
        </div>

        {/* The wheel: his face at its hub, his skills on it. */}
        <div ref={hub} className="kal-at kal-hub" style={at([768 - R, 392 - R, R * 2, R * 2], [196.5 - 134, 424 - 134, 268, 268])}>
          <div className="kal-wheel-clip">
            {plan.seats.map((c, i) => {
              const doc = DOCS[c.label];
              return (
                <a
                  key={i}
                  ref={(n) => {
                    chips.current[i] = n;
                  }}
                  href={doc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kal-seat"
                  title={doc ? `${c.label} — official docs` : c.label}
                  draggable={false}
                >
                  <span className="kal-chip">{c.label}</span>
                </a>
              );
            })}
          </div>
          <button type="button" className="kal-face" data-portrait onClick={openAlbum} aria-label="Open the photo album">
            {!isCoreLook(portraitLook) &&
              photos.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={src} src={src} alt="" className={i === photo ? "on" : undefined} draggable={false} />
              ))}
          </button>
        </div>

        <p className="kal-at kal-kural" lang="ta" style={at([386, 666, 764, 46], [24, 762, 345, 60])} data-cut>
          தொட்டனைத் தூறும் மணற்கேணி மாந்தர்க்குக்
        </p>
      </div>
    </section>
  );
}
