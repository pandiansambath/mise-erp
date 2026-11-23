// The galaxy's easter egg (§102.5). His words: "when we touch that galaxy,
// drastically it needs to expand and burst and rejoin kind of animation…
// likewise in mobile if I touch that galaxy centre point… just a hidden easter
// egg kind of animation".
//
// Touched at its heart (CrystalSpine), the galaxy draws in, SWELLS — the whole
// spiral, spinning up, several times its size — then BURSTS: its dust flies out
// across the page in streaks, hangs there as a slow cloud, and spirals home
// into the disc, and the galaxy is itself again. The galaxy's own canvas is the
// spine's narrow lane (240–300 px), far too small for that, so all of it after
// the draw-in is drawn on a 2D canvas laid over the page for those few seconds
// (2D: no WebGL context — a phone keeps only a few) and removed the moment the
// dust is home. It follows the heart if the page scrolls meanwhile.

/** The burst's clock, in seconds from the touch: drawn in; swollen, and it
 *  bursts; the dust is coming home and the galaxy re-forms; all over.
 *  CrystalSpine plays the galaxy's half to the same clock. */
export const BURST = { inhale: 0.2, burst: 0.85, reform: 3.3, done: 5.2 };

type RGB = [number, number, number];

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function burstGalaxy(at: () => { x: number; y: number; r: number }, cols: RGB[], light: boolean, phone: boolean): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.25 : 1.5);
  const cv = document.createElement("canvas");
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  cv.setAttribute("aria-hidden", "true");
  cv.dataset.galaxyBurst = "";
  cv.style.cssText = `position:fixed;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none;z-index:70`;
  const g = cv.getContext("2d");
  if (!g) return;
  document.body.appendChild(cv);
  const palette: RGB[] = cols.length ? cols : [[125, 240, 220], [240, 160, 100], [155, 140, 255], [240, 189, 106]];
  const gold = palette[3] ?? palette[0];
  const teal = palette[0];

  // A soft grain in each colour, white-hot at its centre (on paper, its own
  // colour: white vanishes on white) — drawn once.
  const grain = palette.map(([r, gg, b]) => {
    const s = document.createElement("canvas");
    s.width = s.height = 32;
    const c = s.getContext("2d")!;
    const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, light ? `rgba(${r},${gg},${b},1)` : "rgba(255,252,240,1)");
    gr.addColorStop(0.2, `rgba(${r},${gg},${b},0.95)`);
    gr.addColorStop(0.55, `rgba(${r},${gg},${b},0.26)`);
    gr.addColorStop(1, `rgba(${r},${gg},${b},0)`);
    c.fillStyle = gr;
    c.fillRect(0, 0, 32, 32);
    return s;
  });
  const streak = palette.map(([r, gg, b]) => `rgb(${r},${gg},${b})`);

  // The dust: each grain has its place in the spiral (two arms and a haze, as
  // the galaxy's own), and where the burst throws it — out along the disc's
  // plane mostly, some above and below it and towards you, as far as most of
  // the page.
  const N = phone ? 340 : 820;
  const F = Math.min(W * 0.85, H * 0.72);
  const R0 = Math.max(40, at().r);
  const dust = Array.from({ length: N }, () => {
    const u = Math.random() * Math.PI * 2;
    const cz = Math.random() * 2 - 1;
    const sz = Math.sqrt(1 - cz * cz);
    const rr = 0.07 + 0.93 * Math.pow(Math.random(), 0.75);
    const arm = Math.random() < 0.66 ? (Math.random() < 0.5 ? 0 : Math.PI) + (Math.random() - 0.5) * 0.9 : u;
    return {
      rr,
      th: arm + Math.pow(1 - rr, 1.4) * 3.3,
      x: Math.cos(u) * sz,
      y: cz * 0.6,
      z: Math.sin(u) * sz,
      far: F * (0.16 + 0.84 * Math.pow(Math.random(), 0.55)),
      k: 3.2 + Math.random() * 3.6,
      home: 1.25 + Math.random() * 0.8,
      dur: 1.2 + Math.random() * 0.6,
      swirl: 2.2 + Math.random() * 1.8,
      size: 3 + Math.random() * 6.5,
      c: Math.floor(Math.random() * palette.length),
      tw: Math.random() * 40,
      px: NaN,
      py: NaN,
    };
  });
  const last = Math.max(...dust.map((d) => d.home + d.dur));
  const end = BURST.burst + last + 0.4;

  const ring = (cx: number, cy: number, rx: number, col: RGB, a: number, w: number) => {
    if (a <= 0.004 || rx < 1) return;
    g.strokeStyle = `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})`;
    g.lineWidth = w;
    g.beginPath();
    g.ellipse(cx, cy, rx, rx * 0.26, 0, 0, Math.PI * 2);
    g.stroke();
  };
  const glow = (cx: number, cy: number, rad: number, col: RGB, a: number, flat = 1) => {
    if (a <= 0.004) return;
    g.save();
    g.translate(cx, cy);
    g.scale(1, flat);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, rad);
    gr.addColorStop(0, light ? `rgba(${col[0]},${col[1]},${col[2]},${a.toFixed(3)})` : `rgba(255,248,228,${a.toFixed(3)})`);
    gr.addColorStop(0.35, `rgba(${col[0]},${col[1]},${col[2]},${(a * 0.55).toFixed(3)})`);
    gr.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
    g.fillStyle = gr;
    g.fillRect(-rad, -rad, rad * 2, rad * 2);
    g.restore();
  };

  const t0 = performance.now();
  const depth = F * 3;
  const frame = (now: number) => {
    const t = (now - t0) / 1000;
    if (t > end) {
      cv.remove();
      return;
    }
    requestAnimationFrame(frame);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // The draw-in is the galaxy's own (CrystalSpine).
    if (t < BURST.inhale) return;
    const { x: cx, y: cy } = at();
    g.globalCompositeOperation = light ? "source-over" : "lighter";

    // The swell: out past its size and a little more (it strains), spinning up.
    const s = Math.min(1, (t - BURST.inhale) / (BURST.burst - BURST.inhale));
    const swell = 0.5 + 3.1 * (1 - Math.pow(1 - s, 3)) + Math.sin(s * Math.PI * 7) * 0.05 * s;
    const spin = s * s * 2.8;
    const tau = t - BURST.burst;
    if (tau < 0) glow(cx, cy, R0 * (0.5 + swell * 0.5), gold, 0.25 + 0.45 * s, 0.4);
    else {
      // The flash, and two shockwaves running out across the disc's plane.
      glow(cx, cy, 60 + tau * 420, gold, 0.95 * Math.exp(-tau * 5));
      if (tau < 1.1) ring(cx, cy, F * 1.25 * (1 - (1 - tau / 1.1) ** 3), gold, 0.85 * (1 - tau / 1.1) ** 1.6, 3.4 - 2 * tau);
      const t2 = (tau - 0.1) / 1.1;
      if (t2 > 0 && t2 < 1) ring(cx, cy, F * 0.9 * (1 - (1 - t2) ** 3), teal, 0.55 * (1 - t2) ** 1.6, 2.2 - t2);
    }

    // The dust: in the swelling spiral; thrown out (in streaks at first),
    // slowing, drifting round as a cloud; then pulled home, slowly at first,
    // faster and faster, swinging round as it falls (a spiral, never a
    // straight line back) into its place in the disc.
    for (const d of dust) {
      const out = tau > 0 ? 1 - Math.exp(-tau * d.k) : 0;
      const h = Math.min(1, Math.max(0, (tau - d.home) / d.dur));
      const he = h * h * h;
      const th = d.th + spin + Math.max(0, tau) * 0.3;
      const disc = R0 * d.rr * (he > 0 ? 1 : swell);
      const dx = Math.cos(th) * disc;
      const dz = Math.sin(th) * disc;
      const a = he * d.swirl + Math.max(0, tau) * 0.16;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const fx = d.x * d.far * ca - d.z * d.far * sa;
      const fz = d.x * d.far * sa + d.z * d.far * ca;
      const m = out * (1 - he);
      const X = dx * (1 - m) + fx * m;
      const Z = dz * (1 - m) + fz * m;
      const Y = d.y * d.far * m + Math.sin(t * 1.6 + d.tw) * 5 * m;
      const p = Math.min(2.4, Math.max(0.45, 1 / (1 - Z / depth)));
      const sx = cx + X * p;
      const sy = cy - Y * p + Z * 0.24 * p;
      const alpha = Math.min(1, (t - BURST.inhale) * 9) * (0.72 + 0.28 * Math.sin(t * 8 + d.tw)) * (1 - smooth(0.86, 1, h));
      // The first instants of the burst: streaks.
      if (tau > 0 && tau < 0.5 && d.px === d.px) {
        g.globalAlpha = alpha * (1 - tau / 0.5) * 0.7;
        g.strokeStyle = streak[d.c];
        g.lineWidth = d.size * 0.18 * p;
        g.beginPath();
        g.moveTo(d.px, d.py);
        g.lineTo(sx, sy);
        g.stroke();
      }
      d.px = sx - (sx - cx) * 0.02;
      d.py = sy - (sy - cy) * 0.02;
      if (alpha < 0.01) continue;
      const size = d.size * p * (tau < 0 ? 0.8 + 0.3 * s : 1 + 1.2 * Math.exp(-tau * 4));
      g.globalAlpha = alpha;
      g.drawImage(grain[d.c], sx - size / 2, sy - size / 2, size, size);
    }
    g.globalAlpha = 1;

    // Home: a light gathering at the heart as the dust comes in.
    const back = smooth(BURST.reform - 0.9, BURST.reform + 0.3, t) * (1 - smooth(end - 0.9, end - 0.1, t));
    glow(cx, cy, 80, gold, 0.55 * back, 0.6);
  };
  requestAnimationFrame(frame);
}
