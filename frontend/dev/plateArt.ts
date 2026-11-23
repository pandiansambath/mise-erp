// The drawn nameplates (§102.2): the page's water, stardust, the forge, liquid
// chrome, and a signal coming in. Each takes the letters as the browser set
// them (plateKit) and draws itself on one 2D canvas, every frame while it has
// something to say and fewer when it is at rest. Colours are the theme's, so
// each is at home in every theme, light ones too.

import { paintLiquidCanvas } from "./liquid";
import { blurred, edge, lay, layer, letters, mixc, outline, rgba, smooth, tinted, WHITE, wipe, type Art, type ArtFactory, type Geo, type RGB } from "./plateKit";

const TAU = Math.PI * 2;
const rnd = (a = 1, b = 0) => b + Math.random() * (a - b);

/** The theme's colours along the name, left to right. */
const along = (geo: Geo, stops: RGB[], alpha = 1) => (g: CanvasRenderingContext2D) => {
  const gr = g.createLinearGradient(geo.x0, 0, geo.x1, 0);
  stops.forEach((c, i) => gr.addColorStop(i / Math.max(1, stops.length - 1), rgba(c, alpha)));
  return gr;
};

/* ── The page's water ─────────────────────────────────────────────────────── */

/** The cards' own painted water, mirrored two by two so it tiles without a seam. */
function waterTile(root: HTMLElement): HTMLCanvasElement | null {
  const one = paintLiquidCanvas(root);
  if (!one) return null;
  const n = one.width;
  const c = document.createElement("canvas");
  c.width = c.height = n * 2;
  const g = c.getContext("2d");
  if (!g) return null;
  for (const [sx, sy] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    g.setTransform(sx, 0, 0, sy, sx < 0 ? n * 2 : 0, sy < 0 ? n * 2 : 0);
    g.drawImage(one, 0, 0);
  }
  return c;
}

export const water: ArtFactory = (geo, pal, opts) => {
  const { W, H, base, top, x0, x1 } = geo;
  const mask = letters(geo);
  const tile = waterTile(opts.root);
  const ink = layer(geo);
  const pen = layer(geo);
  const patA = tile && ink.g.createPattern(tile, "repeat");
  const patB = tile && ink.g.createPattern(tile, "repeat");
  const rimCols = [pal.a2, pal.gold, pal.b2, pal.c];
  const rim = outline(geo, along(geo, rimCols, 0.95), geo.phone ? 1 : 1.25);
  const rimLit = outline(geo, pal.light ? rgba(pal.b2, 1) : "#fff", geo.phone ? 1.2 : 1.6);
  const ghost = outline(geo, rgba(pal.ink, 0.3), 0.8);
  const hi = edge(mask, geo, -1.1, -1.1, pal.light ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.75)");
  const lo = edge(mask, geo, 1.2, 1.4, rgba(mixc(pal.bg, [0, 0, 0], 0.5), 0.5));
  const halo = tinted(blurred(mask, geo, geo.phone ? 9 : 16), geo, rgba(pal.b, pal.light ? 0.28 : 0.42));
  const body = ink.g.createLinearGradient(0, top - 4, 0, base + 4);
  if (pal.light) {
    body.addColorStop(0, rgba(mixc(pal.b, WHITE, 0.12)));
    body.addColorStop(0.55, rgba(mixc(pal.b, pal.c, 0.2)));
    body.addColorStop(1, rgba(mixc(pal.b, [0, 0, 0], 0.35)));
  } else {
    body.addColorStop(0, rgba(mixc(pal.b2, WHITE, 0.5)));
    body.addColorStop(0.5, rgba(mixc(pal.b2, pal.b, 0.5)));
    body.addColorStop(1, rgba(mixc(pal.b, pal.bg, 0.42)));
  }
  const gap = geo.phone ? 6 : 8;
  const surf = base + gap;
  const deep = H - surf - 2;
  const splashes: { x: number; t: number; a: number }[] = [];
  const drops: { x: number; y: number; v: number }[] = [];
  const spray: { x: number; y: number; vx: number; vy: number; r: number }[] = [];
  let nextDrop = opts.t + 2.6;
  const wave = (x: number, t: number) => {
    let y = 0.55 * Math.sin(x * 0.034 + t * 1.5) + 0.35 * Math.sin(x * 0.083 - t * 2.1);
    for (const s of splashes) {
      const age = t - s.t;
      const d = Math.abs(x - s.x);
      y += s.a * Math.exp(-age * 1.5) * Math.sin(d * 0.15 - age * 10) * Math.exp(-d / (26 + age * 70));
    }
    return y;
  };
  const line = (g: CanvasRenderingContext2D, t: number) => {
    g.beginPath();
    for (let x = x0 - 14; x <= x1 + 14; x += 5) {
      const y = surf + wave(x, t);
      if (x === x0 - 14) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  };
  return {
    frame(g, t, dt, ptr) {
      // Filling: the water climbs the letters, its edge rolling.
      const f = opts.still ? 1 : smooth(0.15, 1.9, t);
      const level = base + 10 - (base - top + 24) * f;

      // The letters' water.
      wipe(ink, geo);
      const ig = ink.g;
      ig.fillStyle = body;
      ig.fillRect(0, 0, W, H);
      if (patA && patB) {
        const k = geo.phone ? 0.36 : 0.52;
        patA.setTransform(new DOMMatrix().translateSelf(t * 9, t * 3.2).rotateSelf(10 + 6 * Math.sin(t * 0.11)).scaleSelf(k, k));
        patB.setTransform(new DOMMatrix().translateSelf(-t * 12, 40 - t * 4.1).rotateSelf(188 + 8 * Math.cos(t * 0.09)).scaleSelf(k * 1.25, k * 1.25));
        ig.globalAlpha = pal.light ? 0.55 : 0.62;
        ig.fillStyle = patA;
        ig.fillRect(0, 0, W, H);
        ig.globalCompositeOperation = pal.light ? "soft-light" : "screen";
        ig.globalAlpha = pal.light ? 0.7 : 0.55;
        ig.fillStyle = patB;
        ig.fillRect(0, 0, W, H);
        ig.globalAlpha = 1;
      }
      // A slow light crossing it, and rings where it was touched.
      ig.globalCompositeOperation = pal.light ? "soft-light" : "lighter";
      const sx = x0 - 160 + ((t * 90) % (x1 - x0 + 900));
      const sheen = ig.createLinearGradient(sx, 0, sx + 130, 46);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,.34)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      ig.fillStyle = sheen;
      ig.fillRect(0, 0, W, H);
      for (const s of splashes) {
        const age = t - s.t;
        if (s.a < 2 || age > 1.4) continue;
        ig.strokeStyle = `rgba(255,255,255,${(0.5 * (1 - age / 1.4)).toFixed(3)})`;
        ig.lineWidth = 1.5;
        ig.beginPath();
        ig.arc(s.x, surf - 10, 8 + age * 130, 0, TAU);
        ig.stroke();
      }
      ig.globalCompositeOperation = "destination-in";
      lay(ig, mask, geo);
      if (f < 1) {
        // Not yet full: only below the rolling edge.
        ig.beginPath();
        ig.moveTo(0, H);
        for (let x = 0; x <= W; x += 6) ig.lineTo(x, level + Math.sin(x * 0.05 + t * 5) * 3.2 * (1 - f) + Math.sin(x * 0.021 - t * 3.4) * 2.4 * (1 - f));
        ig.lineTo(W, H);
        ig.closePath();
        ig.fill();
      }
      ig.globalCompositeOperation = "source-over";
      ig.globalAlpha = f;
      lay(ig, lo, geo);
      lay(ig, hi, geo);
      ig.globalAlpha = 1;

      // On the page: its glow, the letters, their crystal edge, a light
      // running round it.
      g.globalAlpha = f * (0.85 + 0.15 * Math.sin(t * 0.9));
      lay(g, halo, geo);
      g.globalAlpha = 1 - f * 0.8;
      lay(g, ghost, geo);
      g.globalAlpha = 1;
      lay(g, ink.c, geo);
      g.globalAlpha = 0.35 + 0.65 * f;
      lay(g, rim, geo);
      g.globalAlpha = 1;
      const run = ((t * 0.16) % 1.35) * (W + 260) - 130;
      if (run < W + 130) {
        wipe(pen, geo);
        const band = pen.g.createLinearGradient(run - 80, 0, run + 80, 0);
        band.addColorStop(0, "rgba(255,255,255,0)");
        band.addColorStop(0.5, "rgba(255,255,255,.95)");
        band.addColorStop(1, "rgba(255,255,255,0)");
        pen.g.fillStyle = band;
        pen.g.fillRect(run - 80, 0, 160, H);
        pen.g.globalCompositeOperation = "destination-in";
        lay(pen.g, rimLit, geo);
        g.globalCompositeOperation = pal.light ? "source-over" : "lighter";
        lay(g, pen.c, geo);
        g.globalCompositeOperation = "source-over";
      }

      // Its reflection in the surface, broken by the waves.
      const k = geo.dpr;
      for (let dy = 1; dy < deep; dy += 2) {
        const src = surf - gap - dy * 1.2;
        if (src < 0) break;
        const fade = Math.pow(1 - dy / deep, 1.5) * (pal.light ? 0.34 : 0.46) * f;
        if (fade < 0.01) break;
        let off = Math.sin(dy * 0.34 + t * 2.3) * (0.5 + dy * 0.075) + Math.sin(dy * 0.13 - t * 1.4) * dy * 0.05;
        for (const s of splashes) off += Math.sin(dy * 0.5 - (t - s.t) * 12) * s.a * 0.5 * Math.exp(-(t - s.t) * 1.6);
        g.globalAlpha = fade;
        g.drawImage(ink.c, 0, src * k, W * k, 1.5 * k, off, surf + dy, W, 2);
      }
      g.globalAlpha = 1;

      // The surface itself: a line of light.
      const gr = g.createLinearGradient(x0 - 14, 0, x1 + 14, 0);
      gr.addColorStop(0, rgba(pal.a, 0));
      gr.addColorStop(0.06, rgba(pal.a, 0.95));
      gr.addColorStop(0.42, rgba(pal.gold, 0.95));
      gr.addColorStop(0.8, rgba(pal.b, 0.9));
      gr.addColorStop(1, rgba(pal.b, 0));
      g.strokeStyle = gr;
      g.globalAlpha = 0.28 * f;
      g.lineWidth = 5;
      line(g, t);
      g.stroke();
      g.globalAlpha = f;
      g.lineWidth = 1.5;
      g.stroke();
      g.globalAlpha = 1;

      // Drops: now and then one falls past the letters.
      if (!opts.still) {
        if (t > nextDrop) {
          nextDrop = t + rnd(5.2, 2.8);
          drops.push({ x: rnd(x1 - 10, x0 + 10), y: 2, v: 10 });
        }
        for (const p of ptr.taps) drops.push({ x: Math.min(x1, Math.max(x0, p.x)), y: Math.min(p.y, surf - 30), v: 120 });
        ptr.taps.length = 0;
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.v += 620 * dt;
        d.y += d.v * dt;
        if (d.y > surf - 1) {
          drops.splice(i, 1);
          splashes.push({ x: d.x, t, a: 3.4 });
          for (let j = 0; j < 5; j++) spray.push({ x: d.x, y: surf, vx: rnd(50, -50), vy: -rnd(130, 60), r: rnd(1.3, 0.5) });
          continue;
        }
        g.fillStyle = rgba(pal.light ? pal.b : mixc(pal.b2, WHITE, 0.45), 0.95);
        g.beginPath();
        g.ellipse(d.x, d.y, 1.5, 2.4 + d.v * 0.005, 0, 0, TAU);
        g.fill();
      }
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i];
        const age = t - s.t;
        if (age > 2.4) {
          splashes.splice(i, 1);
          continue;
        }
        for (let q = 0; q < 3; q++) {
          const r = 5 + (age - q * 0.13) * 46;
          if (r < 5 || age > 1.5) continue;
          g.strokeStyle = rgba(pal.light ? pal.b : pal.b2, 0.6 * (1 - age / 1.5) * (1 - q * 0.28));
          g.lineWidth = 1;
          g.beginPath();
          g.ellipse(s.x, surf + 1, r, r * 0.2, 0, 0, TAU);
          g.stroke();
        }
      }
      for (let i = spray.length - 1; i >= 0; i--) {
        const p = spray[i];
        p.vy += 520 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.y > surf + 1) {
          spray.splice(i, 1);
          continue;
        }
        g.fillStyle = rgba(pal.light ? pal.b : pal.b2, 0.85);
        g.beginPath();
        g.arc(p.x, p.y, p.r, 0, TAU);
        g.fill();
      }
      return f < 1 || drops.length > 0 || splashes.length > 0;
    },
  };
};

/* ── Stardust ─────────────────────────────────────────────────────────────── */

export const dust: ArtFactory = (geo, pal, opts) => {
  const { W, H, x0, x1, base } = geo;
  const mask = letters(geo);
  const halo = tinted(blurred(mask, geo, geo.phone ? 8 : 15), geo, along(geo, [pal.a2, pal.gold, pal.b2, pal.c], pal.light ? 0.3 : 0.42));
  const faint = tinted(mask, geo, along(geo, [pal.a2, pal.gold, pal.b2, pal.c], pal.light ? 0.42 : 0.2));
  // Where the letters have ink, a grain of dust has its home.
  const read = document.createElement("canvas");
  read.width = Math.ceil(W);
  read.height = Math.ceil(H);
  const rg = read.getContext("2d", { willReadFrequently: true })!;
  rg.drawImage(mask, 0, 0, W, H);
  const px = rg.getImageData(0, 0, read.width, read.height).data;
  const spots: number[] = [];
  for (let y = 0; y < read.height; y++) for (let x = 0; x < read.width; x++) if (px[(y * read.width + x) * 4 + 3] > 120) spots.push(x, y);
  const want = geo.phone ? 1500 : 3400;
  const N = Math.min(want, spots.length / 2);
  const cols: RGB[] = [pal.a2, mixc(pal.a2, pal.gold, 0.5), pal.gold, mixc(pal.gold, pal.b2, 0.5), pal.b2, pal.c, pal.light ? mixc(pal.ink, pal.b, 0.3) : mixc(pal.ink, WHITE, 0.6)];
  const styles = cols.map((c) => rgba(pal.light ? mixc(c, [0, 0, 0], 0.12) : mixc(c, WHITE, 0.16)));
  const hx = new Float32Array(N);
  const hy = new Float32Array(N);
  const X = new Float32Array(N);
  const Y = new Float32Array(N);
  const VX = new Float32Array(N);
  const VY = new Float32Array(N);
  const S = new Float32Array(N);
  const D = new Float32Array(N);
  const PH = new Float32Array(N);
  const C = new Uint8Array(N);
  const order = Array.from({ length: spots.length / 2 }, (_, i) => i);
  for (let i = 0; i < N; i++) {
    const j = i + Math.floor(Math.random() * (order.length - i));
    [order[i], order[j]] = [order[j], order[i]];
    hx[i] = spots[order[i] * 2] + Math.random();
    hy[i] = spots[order[i] * 2 + 1] + Math.random();
    const u = (hx[i] - x0) / Math.max(1, x1 - x0) + rnd(0.09, -0.09);
    C[i] = Math.random() < 0.15 ? 6 : Math.max(0, Math.min(5, Math.floor(u * 6)));
    S[i] = (geo.phone ? 0.85 : 1) * rnd(1.75, 0.75);
    PH[i] = Math.random() * TAU;
    D[i] = u * 0.9 + rnd(0.75);
    if (opts.still || opts.t > 3) {
      X[i] = hx[i];
      Y[i] = hy[i];
      D[i] = 0;
    } else {
      // Out of the galaxy: from the top right, in a swirl.
      const a = rnd(TAU);
      const r = rnd(150, 20);
      X[i] = W + 60 + Math.cos(a) * r;
      Y[i] = -30 + Math.sin(a) * r * 0.4;
      VX[i] = -rnd(260, 60);
      VY[i] = rnd(160, -60);
    }
  }
  // Drawn colour by colour: one fill style for each.
  const groups: number[][] = cols.map(() => []);
  for (let i = 0; i < N; i++) groups[C[i]].push(i);
  // The ring of dust under it, as the galaxy's disc lies.
  const RING = geo.phone ? 46 : 90;
  const ringR = Array.from({ length: RING }, () => ({ a: rnd(TAU), r: rnd(1.02, 0.9), s: rnd(1.5, 0.6), v: rnd(0.2, 0.11), c: Math.floor(rnd(6)) }));
  let gust = opts.t + rnd(12, 8);
  let gx = -1e9;
  return {
    frame(g, t, dt, ptr) {
      const still = opts.still;
      const step = Math.min(dt, 0.033);
      if (!still && t > gust) {
        gust = t + rnd(19, 12);
        gx = x0 - 60;
      }
      if (gx > -1e8) {
        gx += dt * 560;
        if (gx > x1 + 120) gx = -1e9;
      }
      const R = geo.phone ? 46 : 64;
      const taps = ptr.taps.splice(0);
      let moving = t < 3.4 || gx > -1e8 || taps.length > 0;
      const solid = still ? 1 : smooth(1.1, 2.8, t);
      g.globalAlpha = solid;
      lay(g, halo, geo);
      lay(g, faint, geo);
      for (let i = 0; i < N; i++) {
        if (t < D[i]) {
          X[i] += VX[i] * step * 0.12;
          Y[i] += VY[i] * step * 0.12;
          continue;
        }
        const jx = still ? 0 : Math.sin(t * 0.9 + PH[i]) * 0.45;
        const jy = still ? 0 : Math.cos(t * 0.75 + PH[i] * 1.7) * 0.45;
        const dx = hx[i] + jx - X[i];
        const dy = hy[i] + jy - Y[i];
        VX[i] += (dx * 46 - VX[i] * 9.4) * step;
        VY[i] += (dy * 46 - VY[i] * 9.4) * step;
        // The gust: lifted off and let go.
        if (gx > -1e8) {
          const q = gx - hx[i];
          if (q > 0 && q < 46) {
            VX[i] += rnd(52, 6);
            VY[i] -= rnd(46, -14);
          }
        }
        if (ptr.on) {
          const ex = X[i] - ptr.x;
          const ey = Y[i] - ptr.y;
          const d2 = ex * ex + ey * ey;
          if (d2 < R * R) {
            const d = Math.sqrt(d2) + 0.01;
            const p = (1 - d / R) * 2600 * step;
            VX[i] += (ex / d) * p;
            VY[i] += (ey / d) * p;
            moving = true;
          }
        }
        for (const tp of taps) {
          const ex = X[i] - tp.x;
          const ey = Y[i] - tp.y;
          const d = Math.hypot(ex, ey) + 0.01;
          const p = Math.max(0, 1 - d / (geo.phone ? 210 : 320)) * rnd(1050, 380);
          VX[i] += (ex / d) * p + rnd(60, -60);
          VY[i] += (ey / d) * p + rnd(60, -60);
        }
        X[i] += VX[i] * step;
        Y[i] += VY[i] * step;
      }
      if (taps.length) moving = true;
      for (let c = 0; c < groups.length; c++) {
        g.fillStyle = styles[c];
        // Two breaths of twinkle per colour.
        for (let half = 0; half < 2; half++) {
          g.globalAlpha = still ? 1 : 0.78 + 0.22 * Math.sin(t * 2.1 + c * 1.3 + half * Math.PI);
          const list = groups[c];
          for (let q = half; q < list.length; q += 2) {
            const i = list[q];
            if (t < D[i] - 0.6) continue;
            g.fillRect(X[i] - S[i] / 2, Y[i] - S[i] / 2, S[i], S[i]);
          }
        }
      }
      // The ring.
      const cy = base + (geo.phone ? 12 : 15);
      const rx = (x1 - x0) * 0.5;
      for (const d of ringR) {
        if (!still) d.a += d.v * step;
        const s = Math.sin(d.a);
        g.globalAlpha = solid * (0.35 + 0.5 * (s * 0.5 + 0.5));
        g.fillStyle = styles[d.c];
        const z = d.s * (0.75 + 0.4 * (s * 0.5 + 0.5));
        g.fillRect((x0 + x1) / 2 + Math.cos(d.a) * rx * d.r, cy + s * 5.5 * d.r, z, z);
      }
      g.globalAlpha = 1;
      return moving;
    },
  };
};

/* ── Forged ───────────────────────────────────────────────────────────────── */

/** Metal by its heat, 0 (cold) to 1 (white). */
const hot = (h: number): RGB => {
  const stops: [number, RGB][] = [
    [0, [70, 12, 4]],
    [0.25, [150, 28, 6]],
    [0.5, [236, 84, 14]],
    [0.75, [255, 176, 58]],
    [1, [255, 247, 224]],
  ];
  for (let i = 1; i < stops.length; i++) if (h <= stops[i][0]) return mixc(stops[i - 1][1], stops[i][1], (h - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  return stops[stops.length - 1][1];
};

export const forge: ArtFactory = (geo, pal, opts) => {
  const { W, H, x0, x1, top, base, glyphs } = geo;
  const mask = letters(geo);
  const gold = pal.gold;
  const dark = mixc(gold, [18, 10, 4], 0.72);
  // The cold metal: gold, with the hammer's marks in it.
  const metal = layer(geo);
  {
    const gr = metal.g.createLinearGradient(0, top - 2, 0, base + 4);
    gr.addColorStop(0, rgba(mixc(gold, WHITE, 0.62)));
    gr.addColorStop(0.3, rgba(gold));
    gr.addColorStop(0.52, rgba(mixc(gold, dark, 0.55)));
    gr.addColorStop(0.58, rgba(mixc(gold, WHITE, 0.4)));
    gr.addColorStop(1, rgba(mixc(gold, dark, 0.7)));
    metal.g.fillStyle = gr;
    metal.g.fillRect(0, 0, W, H);
    for (let i = 0; i < (geo.phone ? 240 : 620); i++) {
      const r = rnd(3.4, 0.5);
      metal.g.fillStyle = Math.random() < 0.5 ? `rgba(255,240,205,${rnd(0.18, 0.02).toFixed(3)})` : `rgba(40,18,4,${rnd(0.26, 0.03).toFixed(3)})`;
      metal.g.beginPath();
      metal.g.ellipse(rnd(W), rnd(H), r * rnd(1.8, 0.7), r, rnd(TAU), 0, TAU);
      metal.g.fill();
    }
    metal.g.globalCompositeOperation = "destination-in";
    lay(metal.g, mask, geo);
    metal.g.globalCompositeOperation = "source-over";
    lay(metal.g, edge(mask, geo, 1.3, 1.5, "rgba(38,16,2,.75)"), geo);
    lay(metal.g, edge(mask, geo, -1, -1, "rgba(255,246,220,.85)"), geo);
  }
  const glowShape = blurred(mask, geo, geo.phone ? 10 : 18);
  const shadow = tinted(blurred(mask, geo, 5), geo, pal.light ? "rgba(70,40,10,.35)" : "rgba(0,0,0,.55)");
  const work = layer(geo);
  const glow = layer(geo);
  const n = 64;
  const heat = new Float32Array(n);
  const at = (x: number) => Math.max(0, Math.min(n - 1, Math.round(((x - x0) / Math.max(1, x1 - x0)) * (n - 1))));
  const beat = 0.11;
  const strikeAt = (i: number) => 0.25 + i * beat;
  let struck = opts.still || opts.t > strikeAt(glyphs.length) ? glyphs.length : 0;
  const sparks: { x: number; y: number; vx: number; vy: number; l: number; m: number }[] = [];
  const embers: { x: number; y: number; v: number; s: number; l: number; m: number; p: number }[] = [];
  const bar = base + (geo.phone ? 8 : 11);
  const hit = (x: number, y: number, w: number, power: number) => {
    const a = at(x - w);
    const b = at(x + w);
    for (let i = a; i <= b; i++) heat[i] = Math.max(heat[i], power);
    for (let i = 0; i < 18; i++) {
      const an = -Math.PI * rnd(0.96, 0.04);
      const v = rnd(300, 90);
      sparks.push({ x, y, vx: Math.cos(an) * v, vy: Math.sin(an) * v, l: 0, m: rnd(0.75, 0.3) });
    }
  };
  let flash = 0;
  let nextEmber = 0;
  return {
    frame(g, t, dt, ptr) {
      // The smith: one letter a beat.
      while (struck < glyphs.length && t >= strikeAt(struck)) {
        const l = glyphs[struck++];
        hit(l.x + l.w / 2, base - geo.cap * 0.1, l.w * 0.62, 1);
        flash = 1;
      }
      for (const p of ptr.taps.splice(0)) {
        hit(p.x, p.y, 30, 1);
        flash = 0.7;
      }
      flash *= Math.exp(-dt * 12);
      // Heat: lost slowly; a slow breath of the fire along the name; a cursor
      // warms what it is over.
      const wave = x0 - 160 + ((t * 62) % (x1 - x0 + 760));
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + (i / (n - 1)) * (x1 - x0);
        heat[i] *= Math.exp(-dt / 1.9);
        if (!opts.still && t > 4) heat[i] = Math.max(heat[i], 0.5 * Math.exp(-(((x - wave) / 70) ** 2)));
        if (ptr.on) heat[i] = Math.max(heat[i], 0.62 * Math.exp(-(((x - ptr.x) / 34) ** 2)));
        sum += heat[i];
      }
      const strip = (c: CanvasRenderingContext2D, alpha: (h: number) => number) => {
        const gr = c.createLinearGradient(x0, 0, x1, 0);
        for (let i = 0; i < n; i += 2) gr.addColorStop(i / (n - 1), rgba(hot(Math.min(1, heat[i])), +alpha(heat[i]).toFixed(3)));
        return gr;
      };

      // Glow on the wall behind.
      if (sum > 0.2) {
        wipe(glow, geo);
        glow.g.fillStyle = strip(glow.g, (h) => Math.min(1, h * 1.5));
        glow.g.fillRect(0, 0, W, H);
        glow.g.globalCompositeOperation = "destination-in";
        lay(glow.g, glowShape, geo);
        g.globalCompositeOperation = pal.light ? "source-over" : "lighter";
        g.globalAlpha = pal.light ? 0.7 : 0.95;
        lay(g, glow.c, geo);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }

      // The metal so far, and its heat.
      wipe(work, geo);
      work.g.save();
      if (struck < glyphs.length) {
        work.g.beginPath();
        for (let i = 0; i < struck; i++) work.g.rect(glyphs[i].x - 1.5, glyphs[i].y - geo.px, glyphs[i].w + 3, geo.px * 1.4);
        work.g.clip();
      }
      lay(work.g, shadow, geo, 0, 3);
      lay(work.g, metal.c, geo);
      work.g.restore();
      if (sum > 0.06) {
        work.g.globalCompositeOperation = "source-atop";
        work.g.fillStyle = strip(work.g, (h) => Math.min(0.96, h * 1.7));
        work.g.fillRect(0, top - 6, W, base - top + 14);
      }
      lay(g, work.c, geo);
      if (flash > 0.02) {
        g.globalCompositeOperation = "source-atop";
        g.fillStyle = `rgba(255,250,235,${(flash * 0.25).toFixed(3)})`;
        g.fillRect(0, 0, W, H);
        g.globalCompositeOperation = "source-over";
      }

      // The anvil's edge: an iron bar, warm under the work.
      const grow = opts.still ? 1 : smooth(0.1, 1.4, t);
      const iron = g.createLinearGradient(0, bar - 2, 0, bar + 3);
      iron.addColorStop(0, pal.light ? "#8c8f96" : "#767b84");
      iron.addColorStop(0.4, "#3a3d44");
      iron.addColorStop(1, "#15171b");
      g.fillStyle = iron;
      g.beginPath();
      g.roundRect(x0, bar - 1.5, (x1 - x0) * 0.62 * grow, 4, 2);
      g.fill();
      if (sum > 0.06) {
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = 0.85;
        g.fillStyle = strip(g, (h) => Math.min(0.8, h));
        g.fillRect(x0, bar - 3, (x1 - x0) * 0.62 * grow, 7);
        g.globalAlpha = 1;
        g.globalCompositeOperation = "source-over";
      }

      // Sparks, and the embers that rise off anything hot.
      g.globalCompositeOperation = pal.light ? "source-over" : "lighter";
      g.lineCap = "round";
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.l += dt;
        if (s.l > s.m) {
          sparks.splice(i, 1);
          continue;
        }
        s.vy += 640 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.y > bar && s.vy > 0) {
          s.y = bar;
          s.vy *= -0.4;
          s.vx *= 0.7;
        }
        const k = 1 - s.l / s.m;
        g.strokeStyle = rgba(hot(0.35 + k * 0.65), k);
        g.lineWidth = 0.7 + k * 0.9;
        g.beginPath();
        g.moveTo(s.x, s.y);
        g.lineTo(s.x - s.vx * 0.022, s.y - s.vy * 0.022);
        g.stroke();
      }
      if (!opts.still) {
        nextEmber -= dt * (0.8 + sum * 0.9);
        if (nextEmber < 0 && embers.length < (geo.phone ? 22 : 46)) {
          nextEmber = 0.12;
          let i = Math.floor(rnd(n));
          for (let q = 0; q < 6 && heat[i] < 0.12; q++) i = Math.floor(rnd(n));
          embers.push({ x: x0 + (i / (n - 1)) * (x1 - x0), y: base - rnd(geo.cap), v: rnd(34, 12), s: rnd(1.7, 0.6), l: 0, m: rnd(2.6, 1.1), p: rnd(TAU) });
        }
      }
      for (let i = embers.length - 1; i >= 0; i--) {
        const e = embers[i];
        e.l += dt;
        if (e.l > e.m) {
          embers.splice(i, 1);
          continue;
        }
        e.y -= e.v * dt;
        e.x += Math.sin(e.l * 2.4 + e.p) * 12 * dt;
        const k = 1 - e.l / e.m;
        g.fillStyle = rgba(hot(0.3 + k * 0.5), k * (0.7 + 0.3 * Math.sin(e.l * 14 + e.p)));
        g.beginPath();
        g.arc(e.x, e.y, e.s, 0, TAU);
        g.fill();
      }
      g.globalCompositeOperation = "source-over";
      return struck < glyphs.length || sparks.length > 0 || flash > 0.02 || ptr.on;
    },
  };
};

/* ── Liquid chrome ────────────────────────────────────────────────────────── */

export const chrome: ArtFactory = (geo, pal, opts) => {
  const { W, H, x0, x1, top, base, glyphs } = geo;
  const mask = letters(geo);
  // The room it reflects: a sky in one of the theme's lights, a black horizon
  // with a white edge, a floor in the other.
  const room = document.createElement("canvas");
  room.width = 4;
  room.height = 512;
  {
    const rg = room.getContext("2d")!;
    const gr = rg.createLinearGradient(0, 0, 0, 512);
    const k = (t: number, c: RGB) => gr.addColorStop(t, rgba(c));
    const night: RGB = [6, 8, 13];
    const silver: RGB = [214, 222, 232];
    k(0, mixc(silver, pal.b2, 0.35));
    k(0.1, WHITE);
    k(0.2, mixc(silver, pal.b2, 0.28));
    k(0.32, mixc(silver, pal.b, 0.45));
    k(0.43, mixc(mixc(silver, pal.b, 0.55), night, 0.35));
    k(0.475, mixc(pal.c, night, 0.62));
    k(0.495, mixc(night, pal.c, 0.12));
    k(0.508, WHITE);
    k(0.56, mixc(silver, pal.a2, 0.25));
    k(0.66, mixc(silver, pal.a2, 0.55));
    k(0.78, mixc(mixc(silver, pal.a, 0.6), night, 0.28));
    k(0.86, mixc(silver, pal.gold, 0.4));
    k(0.93, WHITE);
    k(1, mixc(silver, pal.b2, 0.35));
    rg.fillStyle = gr;
    rg.fillRect(0, 0, 4, 512);
  }
  const ink = layer(geo);
  const hi = edge(mask, geo, -1.1, -1.2, "rgba(255,255,255,.95)");
  const lo = edge(mask, geo, 1, 1.1, "rgba(10,14,22,.6)");
  const rim = outline(geo, pal.light ? "rgba(20,24,30,.6)" : "rgba(255,255,255,.28)", 0.7);
  const shadow = tinted(blurred(mask, geo, geo.phone ? 6 : 10), geo, pal.light ? "rgba(15,20,30,.4)" : rgba(mixc(pal.b, [0, 0, 0], 0.55), 0.7));
  const cells = glyphs.map((l) => [l.x, l.w] as const);
  const step = geo.phone ? 2 : 3;
  const spans: { x: number; bulge: number }[] = [];
  for (let x = x0 - 2; x < x1 + 2; x += step) {
    const c = cells.find(([gx, gw]) => x >= gx && x < gx + gw);
    // Each letter is round across, so the room bends in it.
    const u = c ? (x - c[0]) / c[1] : 0.5;
    spans.push({ x, bulge: Math.sin(u * Math.PI) });
  }
  const points = glyphs.flatMap((l) => [
    { x: l.x + l.w * 0.2, y: l.y - geo.cap * 0.96 },
    { x: l.x + l.w * 0.75, y: l.y - geo.cap * 0.55 },
  ]);
  const glints: { x: number; y: number; t: number; s: number }[] = [];
  let next = opts.t + 1.4;
  let shiftX = 0;
  let shiftY = 0;
  let wob = 0;
  return {
    frame(g, t, dt, ptr) {
      const enter = opts.still ? 1 : smooth(0.1, 1.5, t);
      const k = 1 - Math.exp(-dt * 5);
      shiftX += ((ptr.on ? (ptr.x - (x0 + x1) / 2) / (x1 - x0) : 0) - shiftX) * k;
      shiftY += ((ptr.on ? (ptr.y - (top + base) / 2) / H : 0) - shiftY) * k;
      if (ptr.taps.length) {
        wob = 1;
        for (const p of ptr.taps.splice(0)) glints.push({ x: p.x, y: p.y, t, s: 1.5 });
      }
      wob *= Math.exp(-dt * 2.4);
      const tall = (base - top) * 2.3;
      wipe(ink, geo);
      for (const s of spans) {
        const x = s.x;
        const flow = Math.sin(x * 0.017 + t * 0.62) * 0.16 + Math.sin(x * 0.041 - t * 0.93 + 1.7) * 0.085 + Math.sin(x * 0.11 + t * 1.5) * 0.02 + wob * Math.sin(x * 0.09 - t * 16) * 0.16;
        const y = (top + base) / 2 - tall * (0.5 + flow + shiftY * 0.35 + (s.bulge - 0.5) * 0.17 + shiftX * Math.sin(x * 0.012) * 0.3 + (1 - enter) * 0.7);
        ink.g.drawImage(room, 0, 0, 4, 512, x, y, step + 0.6, tall);
      }
      ink.g.globalCompositeOperation = "destination-in";
      lay(ink.g, mask, geo);
      ink.g.globalCompositeOperation = "source-over";
      lay(ink.g, lo, geo);
      lay(ink.g, hi, geo);
      // A hard light crossing it.
      const sx = x0 - 120 + ((t * 170) % (x1 - x0 + 1300));
      ink.g.globalCompositeOperation = "source-atop";
      const sheen = ink.g.createLinearGradient(sx, 0, sx + 70, 26);
      sheen.addColorStop(0, "rgba(255,255,255,0)");
      sheen.addColorStop(0.5, "rgba(255,255,255,.7)");
      sheen.addColorStop(1, "rgba(255,255,255,0)");
      ink.g.fillStyle = sheen;
      ink.g.fillRect(0, 0, W, H);

      g.globalAlpha = enter;
      lay(g, shadow, geo, 0, 4);
      lay(g, ink.c, geo);
      lay(g, rim, geo);
      // On a black floor: its reflection, fading.
      const gap = geo.phone ? 4 : 5;
      const deep = H - base - gap;
      for (let dy = 0; dy < deep; dy += 2) {
        const a = Math.pow(1 - dy / deep, 2) * (pal.light ? 0.2 : 0.34) * enter;
        if (a < 0.01) break;
        g.globalAlpha = a;
        g.drawImage(ink.c, 0, (base - dy * 1.1) * geo.dpr, W * geo.dpr, 2 * geo.dpr, 0, base + gap + dy, W, 2);
      }
      g.globalAlpha = 1;

      // Glints, at the letters' shoulders.
      if (!opts.still && t > next) {
        next = t + rnd(1.5, 0.55);
        const p = points[Math.floor(rnd(points.length))];
        glints.push({ x: p.x, y: p.y, t, s: rnd(1, 0.5) });
      }
      g.globalCompositeOperation = "lighter";
      for (let i = glints.length - 1; i >= 0; i--) {
        const q = glints[i];
        const u = (t - q.t) / 0.75;
        if (u >= 1) {
          glints.splice(i, 1);
          continue;
        }
        const a = Math.sin(u * Math.PI);
        const len = (geo.phone ? 13 : 22) * q.s * a;
        g.save();
        g.translate(q.x, q.y);
        g.rotate(u * 0.5);
        for (let r = 0; r < 4; r++) {
          g.rotate(Math.PI / 2);
          const gr = g.createLinearGradient(0, 0, len * (r % 2 ? 0.6 : 1), 0);
          gr.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`);
          gr.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = gr;
          g.beginPath();
          g.moveTo(0, -1.1);
          g.lineTo(len, 0);
          g.lineTo(0, 1.1);
          g.fill();
        }
        g.restore();
      }
      g.globalCompositeOperation = "source-over";
      return enter < 1 || glints.length > 0 || wob > 0.02 || ptr.on;
    },
  };
};

/* ── A signal coming in ───────────────────────────────────────────────────── */

export const signal: ArtFactory = (geo, pal, opts) => {
  const { W, H, x0, x1, top, base } = geo;
  const mask = letters(geo);
  const parts: RGB[] = pal.light
    ? [
        [0, 170, 190],
        [214, 20, 130],
        [214, 176, 0],
      ]
    : [
        [255, 70, 84],
        [70, 255, 150],
        [92, 120, 255],
      ];
  const chan = parts.map((c) => tinted(mask, geo, rgba(c)));
  const solid = tinted(mask, geo, (g) => {
    const gr = g.createLinearGradient(x0, 0, x1, 0);
    gr.addColorStop(0, rgba(pal.ink));
    gr.addColorStop(0.5, rgba(mixc(pal.ink, pal.b2, pal.light ? 0.5 : 0.35)));
    gr.addColorStop(1, rgba(pal.ink));
    return gr;
  });
  const halo = tinted(blurred(mask, geo, geo.phone ? 7 : 12), geo, rgba(pal.b, pal.light ? 0.16 : 0.34));
  let until = opts.still ? -1 : opts.t < 1.6 ? 1.6 : -1;
  let next = opts.t + 4.5;
  let reseed = 0;
  let strength = 1;
  let cuts: { y: number; h: number; dx: number; split: number }[] = [];
  let lastX = 0;
  let pull = 0;
  return {
    frame(g, t, dt, ptr) {
      if (!opts.still && t > next) {
        next = t + rnd(7.5, 3.8);
        until = t + rnd(0.5, 0.26);
        strength = rnd(1, 0.45);
      }
      for (const p of ptr.taps.splice(0)) {
        until = t + 0.55;
        strength = 1.2;
        lastX = p.x;
      }
      pull += ((ptr.on ? Math.min(6, Math.abs(ptr.x - lastX) * 0.5) : 0) - pull) * Math.min(1, dt * 10);
      lastX = ptr.x;
      const on = t < until;
      const lock = t < 1.6 && !opts.still ? 1 - t / 1.6 : 0;
      const amt = on ? Math.max(strength * 0.8, lock * 1.6) : 0;
      if (on && t > reseed) {
        reseed = t + 0.05;
        const n = 4 + Math.floor(rnd(8));
        cuts = Array.from({ length: n }, () => ({ y: rnd(base + 6, top - 10), h: rnd(15, 2), dx: rnd(46, -46) * amt, split: rnd(9, -9) * amt }));
      }
      const roll = lock > 0 ? ((lock * lock * 190) % (H + 40)) : 0;
      const breathe = 0.5 + 0.28 * Math.sin(t * 1.3) + pull;
      const paint = (sx: number, sy: number, w: number, h: number, dx: number, split: number, dy = 0) => {
        const k = geo.dpr;
        g.globalCompositeOperation = pal.light ? "multiply" : "lighter";
        chan.forEach((c, i) => g.drawImage(c, sx * k, sy * k, w * k, h * k, sx + dx + (i - 1) * split, sy + dy, w, h));
        g.globalCompositeOperation = "source-over";
      };
      g.globalAlpha = 1 - lock * 0.4;
      lay(g, halo, geo);
      g.globalAlpha = 1;
      if (!on) {
        paint(0, 0, W, H, 0, breathe);
        g.globalAlpha = 0.55;
        lay(g, solid, geo);
        g.globalAlpha = 1;
      } else {
        // Torn: the whole picture a little split, and the slices out of place.
        const bands = [...cuts].sort((p, q) => p.y - q.y);
        let y = 0;
        for (const b of [...bands, { y: H, h: 0, dx: 0, split: 0 }]) {
          if (b.y > y) paint(0, y, W, b.y - y, 0, 1 + amt * 1.6, roll > 2 ? ((y + roll) % H) - y : 0);
          if (b.h && b.y >= y) {
            paint(0, b.y, W, Math.min(b.h, H - b.y), b.dx, b.split + 2, 0);
            y = b.y + b.h;
          } else y = Math.max(y, b.y);
        }
        // Static.
        g.fillStyle = pal.light ? "rgba(20,24,32,.5)" : "rgba(255,255,255,.55)";
        for (let i = 0; i < 26 * amt; i++) g.fillRect(rnd(x1, x0), rnd(base + 8, top - 8), rnd(22, 2), 1);
      }
      // The scan lines, and the bright line running down it.
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = "rgba(0,0,0,.22)";
      for (let y = (t * 9) % 3; y < H; y += 3) g.fillRect(0, y, W, 1);
      g.globalCompositeOperation = "source-atop";
      const sy = ((t * 46) % (H + 90)) - 45;
      const gr = g.createLinearGradient(0, sy - 18, 0, sy + 18);
      gr.addColorStop(0, "rgba(255,255,255,0)");
      gr.addColorStop(0.5, "rgba(255,255,255,.5)");
      gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr;
      g.fillRect(0, sy - 18, W, 36);
      g.globalCompositeOperation = "source-over";
      return on || ptr.on;
    },
  };
};

export const ARTS: Record<string, { art: ArtFactory; pad: (phone: boolean) => { x: number; t: number; b: number } }> = {
  water: { art: water, pad: (p) => ({ x: p ? 14 : 22, t: p ? 14 : 20, b: p ? 34 : 46 }) },
  dust: { art: dust, pad: (p) => ({ x: p ? 16 : 60, t: p ? 26 : 46, b: p ? 30 : 46 }) },
  forge: { art: forge, pad: (p) => ({ x: p ? 16 : 34, t: p ? 34 : 54, b: p ? 22 : 30 }) },
  chrome: { art: chrome, pad: (p) => ({ x: p ? 14 : 26, t: p ? 14 : 22, b: p ? 24 : 34 }) },
  signal: { art: signal, pad: (p) => ({ x: p ? 16 : 52, t: p ? 10 : 14, b: p ? 12 : 16 }) },
};
export type { Art };
