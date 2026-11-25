// Letters cut into the stone (docs/temple/ART.md 5.3): drawn by the browser, so that every script is
// shaped right, and turned into distances from their edges: sharp at any size, filled by the shader.

const INF = 1e20;

/** Distances along one line (Felzenszwalb). */
function line(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = 0;
    do {
      const r = v[k];
      s = (f[q] - f[r] + q * q - r * r) / (q - r) / 2;
    } while (s <= z[k] && --k > -1);
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const r = v[k];
    d[q] = (q - r) * (q - r) + f[r];
  }
}

function edt(g: Float64Array, w: number, h: number) {
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = g[y * w + x];
    line(f, h, d, v, z);
    for (let y = 0; y < h; y++) g[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = g[y * w + x];
    line(f, w, d, v, z);
    for (let x = 0; x < w; x++) g[y * w + x] = d[x];
  }
}

export type Sheet = { data: Uint8Array; w: number; h: number; spread: number; cssW: number; cssH: number };

/** Lines of text, each at its place (CSS px), as distances told `spread` CSS px either way. */
export function cutLetters(lines: { text: string; x: number; y: number; font: string; spacing?: number; align?: CanvasTextAlign }[], cssW: number, cssH: number, k: number, spread: number): Sheet {
  const w = Math.max(2, Math.ceil(cssW * k));
  const h = Math.max(2, Math.ceil(cssH * k));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.scale(k, k);
  g.fillStyle = "#fff";
  g.textBaseline = "alphabetic";
  for (const l of lines) {
    g.font = l.font;
    g.textAlign = l.align ?? "left";
    (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${l.spacing ?? 0}px`;
    g.fillText(l.text, l.x, l.y);
  }
  const px = g.getImageData(0, 0, w, h).data;
  const out = new Float64Array(w * h);
  const ins = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3] / 255;
    out[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    ins[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt(out, w, h);
  edt(ins, w, h);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const d = (Math.sqrt(ins[i]) - Math.sqrt(out[i])) / k;
    data[i] = Math.max(0, Math.min(255, Math.round((d / spread) * 127.5 + 127.5)));
  }
  return { data, w, h, spread, cssW, cssH };
}
