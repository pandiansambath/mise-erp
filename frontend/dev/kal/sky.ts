// The sky over the temple: dusk over Chennai, a few stars, tonight's own moon. Painted once.

/** The moon's age as a share of its round (0 new, .5 full). */
export function moonPhase(now: Date): number {
  const synodic = 29.530588853;
  const days = now.getTime() / 86_400_000 - 10962.6; // 2000-01-06 18:14 UT, a new moon
  return (((days / synodic) % 1) + 1) % 1;
}

export function paintSky(c: HTMLCanvasElement, now: Date) {
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (!w || !h) return;
  const k = Math.min(1.5, window.devicePixelRatio || 1);
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  const g = c.getContext("2d");
  if (!g) return;
  g.scale(k, k);
  const sky = g.createLinearGradient(0, 0, 0, h);
  for (const [o, col] of [
    [0, "#080b1e"],
    [0.1, "#0d1330"],
    [0.22, "#1d1c45"],
    [0.36, "#3a274f"],
    [0.5, "#5a304e"],
    [0.62, "#7d3f45"],
    [0.72, "#a3563a"],
    [1, "#2a1512"],
  ] as const)
    sky.addColorStop(o, col);
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  let seed = 396;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Thin cloud, lit from under where the sun went.
  for (let i = 0; i < 26; i++) {
    const y = h * (0.12 + 0.34 * rnd());
    const x = w * rnd();
    const rx = w * (0.08 + 0.16 * rnd());
    const ry = 3 + 9 * rnd();
    g.save();
    g.translate(x, y);
    g.scale(1, ry / rx);
    const f = g.createRadialGradient(0, 0, 0, 0, 0, rx);
    const warm = y / h > 0.26;
    f.addColorStop(0, warm ? "rgba(214,128,96,.10)" : "rgba(150,140,200,.06)");
    f.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = f;
    g.fillRect(-rx, -rx, rx * 2, rx * 2);
    g.restore();
  }
  // Stars: few, of three sizes; none where it is still light.
  const n = Math.round(w / 9);
  for (let i = 0; i < n; i++) {
    const x = w * rnd();
    const u = rnd();
    const y = h * 0.34 * u * u;
    const b = (1 - y / (h * 0.36)) * (0.25 + 0.75 * rnd());
    const r = rnd() > 0.93 ? 1.25 : rnd() > 0.7 ? 0.85 : 0.55;
    g.fillStyle = `rgba(${rnd() > 0.8 ? "255,226,190" : "214,226,255"},${(b * 0.85).toFixed(2)})`;
    g.beginPath();
    g.arc(x, y, r, 0, 7);
    g.fill();
  }
  // Tonight's moon: its lit limb an arc, its shadowed part just to be seen.
  const p = moonPhase(now);
  const R = Math.max(11, Math.min(17, w / 92));
  const mx = w * (w < 768 ? 0.86 : 0.79);
  const my = w < 768 ? 96 : Math.max(60, h * 0.1);
  const halo = g.createRadialGradient(mx, my, R * 0.6, mx, my, R * 7);
  const lit = (1 - Math.cos(p * Math.PI * 2)) / 2;
  halo.addColorStop(0, `rgba(196,212,255,${(0.1 + 0.16 * lit).toFixed(2)})`);
  halo.addColorStop(1, "rgba(196,212,255,0)");
  g.fillStyle = halo;
  g.fillRect(mx - R * 7, my - R * 7, R * 14, R * 14);
  g.save();
  g.translate(mx, my);
  g.rotate(0.42);
  g.fillStyle = "rgba(150,160,200,.1)";
  g.beginPath();
  g.arc(0, 0, R, 0, 7);
  g.fill();
  const waxing = p < 0.5;
  const e = Math.cos(p * Math.PI * 2);
  g.beginPath();
  // The lit half's limb, and the terminator: half an ellipse.
  g.arc(0, 0, R, -Math.PI / 2, Math.PI / 2, !waxing);
  g.ellipse(0, 0, Math.abs(e) * R, R, 0, Math.PI / 2, -Math.PI / 2, waxing === e > 0);
  const face = g.createRadialGradient(-R * 0.2, -R * 0.3, 0, 0, 0, R);
  face.addColorStop(0, "#fffaf0");
  face.addColorStop(1, "#d8dcec");
  g.fillStyle = face;
  g.fill();
  g.globalCompositeOperation = "source-atop";
  g.restore();
}
