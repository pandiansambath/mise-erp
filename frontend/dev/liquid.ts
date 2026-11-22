"use client";

// The water in the crystal.
//
//   "i said we need cards like activetheory… looks like water crystal"
//
// One small picture per theme, painted here once and shared by every card
// through the --dev-liquid custom property on .dev-root: pools of the theme's
// colours folded into each other (domain-warped noise, the watercolour), thin
// bright veins where the folds meet (ridged noise, the crystal), and a little
// grain. The cards then only MOVE this picture with the scroll (globals.css
// devLiquid) — a transform on one layer per card, nothing repainted. Painting
// it costs a few milliseconds, off the first frame.

import { readRGB } from "./theme";

type RGB = [number, number, number];

/** Seeded value noise, so every visitor sees the same water for a theme. */
function makeNoise(seed: number) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t: number) => t * t * (3 - 2 * t);
  const rnd = (x: number, y: number) => perm[(perm[x & 255] + y) & 255] / 255;
  const noise = (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = rnd(xi, yi);
    const b = rnd(xi + 1, yi);
    const c = rnd(xi, yi + 1);
    const d = rnd(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x: number, y: number) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    for (let o = 0; o < 4; o++) {
      v += amp * noise(x * f, y * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return v;
  };
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function paintLiquid(root: HTMLElement): string | null {
  try {
    const N = 200;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d");
    if (!g) return null;
    const pal: RGB[] = [
      readRGB(root, "a", [217, 119, 66]),
      readRGB(root, "c", [155, 140, 255]),
      readRGB(root, "b", [45, 212, 191]),
      readRGB(root, "b2", [125, 240, 220]),
    ];
    const fbm = makeNoise(20261122);
    const img = g.createImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = (x / N) * 3;
        const v = (y / N) * 3;
        // Folded twice: the watercolour.
        const qx = fbm(u, v);
        const qy = fbm(u + 5.2, v + 1.3);
        const f = fbm(u + 2.4 * qx, v + 2.4 * qy);
        // Where the folds meet, a thin bright line: the crystal.
        const r = 1 - Math.abs(fbm(u * 2.1 + qx * 3, v * 2.1 + qy * 3) * 2 - 1);
        const vein = Math.pow(Math.max(0, r), 14);
        const t = Math.min(1, Math.max(0, (f - 0.25) * 1.9));
        const col = t < 0.33 ? mix(pal[0], pal[1], t / 0.33) : t < 0.66 ? mix(pal[1], pal[2], (t - 0.33) / 0.33) : mix(pal[2], pal[3], (t - 0.66) / 0.34);
        const grain = (Math.random() - 0.5) * 18;
        const i = (y * N + x) * 4;
        d[i] = Math.min(255, col[0] + vein * 160 + grain);
        d[i + 1] = Math.min(255, col[1] + vein * 160 + grain);
        d[i + 2] = Math.min(255, col[2] + vein * 160 + grain);
        const pool = Math.min(1, Math.max(0, (f - 0.42) * 3.2));
        d[i + 3] = Math.min(255, (pool * 0.75 + vein * 0.9) * 255);
      }
    }
    g.putImageData(img, 0, 0);
    let url = c.toDataURL("image/webp", 0.82);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
    return url;
  } catch {
    return null;
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** The orb a card becomes when it is away from the present: the same water,
 *  wound into a spiral — two arms of a logarithmic spiral, the pools folded
 *  along them, veins of light following the swirl, a bright heart, a soft
 *  rim. Painted once per theme, handed to the cards as --dev-orb.
 *
 *    "for future and past cards we need a spiral instead of a rectangle…
 *     a spiral circle which grows and shrinks accordingly" */
export function paintOrb(root: HTMLElement): string | null {
  try {
    const N = 220;
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const g = c.getContext("2d");
    if (!g) return null;
    const a = readRGB(root, "a", [217, 119, 66]);
    const cc = readRGB(root, "c", [155, 140, 255]);
    const b = readRGB(root, "b", [45, 212, 191]);
    const b2 = readRGB(root, "b2", [125, 240, 220]);
    const gold = readRGB(root, "gold", [240, 189, 106]);
    const fbm = makeNoise(20261123);
    const img = g.createImageData(N, N);
    const d = img.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = (y * N + x) * 4;
        const nx = ((x + 0.5) / N) * 2 - 1;
        const ny = ((y + 0.5) / N) * 2 - 1;
        const r = Math.hypot(nx, ny);
        if (r >= 1) {
          d[i + 3] = 0;
          continue;
        }
        const th = Math.atan2(ny, nx);
        // Wound into a spiral: the nearer the heart, the further it has turned.
        const tw = th + 3.6 * (1 - r) * (1 - r);
        const u = Math.cos(tw) * r * 2.4 + 3;
        const v = Math.sin(tw) * r * 2.4 + 3;
        const qx = fbm(u, v);
        const qy = fbm(u + 5.2, v + 1.3);
        const f = fbm(u + 1.8 * qx, v + 1.8 * qy);
        // Two arms of a logarithmic spiral.
        const arm = 0.5 + 0.5 * Math.cos(2 * (th - 2.4 * Math.log(r + 0.07)));
        const arms = Math.pow(arm, 2.4) * (0.55 + 0.45 * f);
        // Veins of light along the swirl.
        const ridge = 1 - Math.abs(fbm(u * 2.2 + qx * 2, v * 2.2 + qy * 2) * 2 - 1);
        const vein = Math.pow(Math.max(0, ridge), 12);
        const core = Math.exp(-r * r * 22);
        const t = Math.min(1, Math.max(0, (f - 0.3) * 1.8));
        let col = t < 0.5 ? mix(a, cc, t / 0.5) : mix(cc, b, (t - 0.5) / 0.5);
        col = mix(col, b2, arms * 0.55);
        col = mix(col, gold, core * 0.8);
        const lift = vein * 150 + core * 120;
        const rim = 1 - smooth(0.9, 1, r);
        const alpha = rim * Math.min(1, 0.22 + arms * 0.75 + vein * 0.8 + core * 0.9);
        d[i] = Math.min(255, col[0] + lift);
        d[i + 1] = Math.min(255, col[1] + lift);
        d[i + 2] = Math.min(255, col[2] + lift);
        d[i + 3] = alpha * 255;
      }
    }
    g.putImageData(img, 0, 0);
    let url = c.toDataURL("image/webp", 0.85);
    if (!url.startsWith("data:image/webp")) url = c.toDataURL("image/png");
    return url;
  } catch {
    return null;
  }
}
