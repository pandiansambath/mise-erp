"use client";

// What the hand passes over comes apart, and comes together again (§104.8).
//
//   "you [are] doing that scratching, scrambling in [the] background, not on [the] upper
//    area: the font is looking [the] same, the skeleton… the card font… I thought my photo
//    will scatter… I personally like that honeycomb style… [but Active Theory's is] more
//    realistic, literally it's like erasing something… erasing and again rejoin[ing]…
//    those small, small particles, scattering, scrambled, dispersed" (24 Nov)
//
// Nothing on a page can reach the pixels of the rest of it — but the browser can, when it
// draws a piece of glass over it. So there IS one (`lens`): a pane with no look of its own,
// whose backdrop filter moves what is behind it, whatever that is — text, the photo, the
// skeleton's canvas, the cards. A picture says by how much, pixel by pixel (feImage →
// feDisplacementMap): red how far sideways, green how far down, blue whether at all.
//
// The picture is made here, every frame there is one to make: the screen is a honeycomb of
// cells; those the water (flow.ts) has stirred hard enough let go of their piece of the
// page, which drifts with the water, crowds the rim of the hole it leaves, and comes home.
// Round them the page is dragged along with the stroke, in streaks. And over the pane a
// canvas draws what the page has not got: the dark of the hole, the light on each piece.
//
// The picture is worked out and packed in a worker (an uncompressed bitmap: nothing to
// encode), and shown in the same frame as the canvas's drawing of that same moment, or the
// pieces would slip out from under their light. It costs nothing while nothing is stirred:
// the pane and the canvas are not there.
//
// Chromium only (the others do not draw a filter of ours behind a pane): there the
// background and the cards come apart by themselves, as before (flow.ts COME_APART).
//
// A FINGER does it too (§106.11: "I also want this in mobile… if I move my touch I need to
// feel the same we have in desktop"): one that sets off sideways, and then goes where it
// likes — one that sets off up or down scrolls the page, as ever (globals.css: the page takes
// only up and down for itself) — and one that taps. On a phone the canvas over the pane is a
// plain one (its graphics can keep only a few of the other kind), drawn from four stamps.

import { readRGB, THEME_EVENT } from "./theme";
import { did } from "./did";
import { water } from "./flow";
import { atLeisure, covered } from "./stage";

/** The piece of the screen it goes on in, CSS px; a step of its picture; a cell's width; the
 *  farthest a channel of the picture reaches, and a piece may go. */
const FINGER = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
const MAP = FINGER ? 1.8 : 2.5;
const PITCH = FINGER ? 13 : 11;
const REACH = 240;
const FAR = FINGER ? 92 : 108;
const MAX = FINGER ? 620 : 1500;
/** The sizes the pane comes in (it costs by its area, and only for as long as it is there). */
const WIDE = FINGER ? [230, 310, 430] : [360, 520, 690, 860];
const TALL = FINGER ? [230, 310, 420] : [260, 390, 520];
/** A cell's hole, and a piece of it (from its middle to the middle of a side). */
const HOLE = PITCH * 0.555;
const PIECE = PITCH * 0.511;
/** What is sent to the worker for each piece, and to the canvas. */
const SENT = 5;
const DRAWN = 8;

export function canScatter(): boolean {
  if (typeof navigator === "undefined") return false;
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  return (
    !!brands?.some((b) => /Chromium/i.test(b.brand)) &&
    (FINGER || (window.matchMedia("(hover: hover) and (pointer: fine)").matches && window.matchMedia("(min-width: 1024px)").matches)) &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    CSS.supports("backdrop-filter", "url(#a)") &&
    typeof Worker !== "undefined"
  );
}

const WORKER = /* js */ `
let W = 0, H = 0, K = 1, w = 0, h = 0, row = 0, bmp, none, grain;
const REACH = ${REACH};
function init(m) {
  if (m.W === W && m.H === H) return;
  W = m.W; H = m.H; K = m.K;
  w = Math.round(W / K); h = Math.round(H / K); row = (w * 3 + 3) & ~3;
  bmp = new Uint8Array(54 + row * h);
  const d = new DataView(bmp.buffer);
  bmp[0] = 66; bmp[1] = 77;
  d.setUint32(2, bmp.length, true); d.setUint32(10, 54, true); d.setUint32(14, 40, true);
  d.setInt32(18, w, true); d.setInt32(22, -h, true); d.setUint16(26, 1, true); d.setUint16(28, 24, true);
  d.setUint32(34, row * h, true);
  // (Nothing moved: the middle of both channels, or between a piece and the rest of the page
  // the picture is drawn out of everything in between.)
  none = new Uint8Array(row * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) none[j * row + i * 3 + 1] = none[j * row + i * 3 + 2] = 128;
  grain = new Float32Array(4096);
  let s = 7;
  for (let i = 0; i < 4096; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; grain[i] = s / 4294967296; }
}
function noise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = grain[((j & 63) << 6) | (i & 63)], b = grain[((j & 63) << 6) | ((i + 1) & 63)];
  const c = grain[(((j + 1) & 63) << 6) | (i & 63)], e = grain[(((j + 1) & 63) << 6) | ((i + 1) & 63)];
  return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v;
}
onmessage = (ev) => {
  const m = ev.data;
  init(m);
  bmp.set(none, 54);
  // Round the hole: the page dragged along with the stroke, in streaks.
  const f = m.field, fw = m.fw, fh = m.fh;
  for (let j = 0; j < h; j++) {
    const py = (j + 0.5) * K;
    const gy = (py - m.fy) / m.cy;
    if (gy < 0 || gy >= fh - 1) continue;
    const gj = gy | 0, ty = gy - gj;
    const ey = Math.min(1, Math.min(py, H - py) / 70);
    for (let i = 0; i < w; i++) {
      const px = (i + 0.5) * K;
      const gx = (px - m.fx) / m.cx;
      if (gx < 0 || gx >= fw - 1) continue;
      const gi = gx | 0, tx = gx - gi;
      const n = (gj * fw + gi) * 3;
      const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
      const s = f[n + 2] * w00 + f[n + 5] * w10 + f[n + fw * 3 + 2] * w01 + f[n + fw * 3 + 5] * w11;
      if (s < 0.035) continue;
      const u = f[n] * w00 + f[n + 3] * w10 + f[n + fw * 3] * w01 + f[n + fw * 3 + 3] * w11;
      const v = f[n + 1] * w00 + f[n + 4] * w10 + f[n + fw * 3 + 1] * w01 + f[n + fw * 3 + 4] * w11;
      const sp = Math.sqrt(u * u + v * v);
      if (sp < 5) continue;
      const dx = u / sp, dy = v / sp, X = px + m.x, Y = py + m.y;
      const st = noise(X * 0.1, Y * 0.1) * 0.65 + noise(X * 0.27 + 9, Y * 0.27) * 0.35;
      const e = Math.min(1, Math.min(px, W - px) / 70) * ey;
      const q = Math.min(1, (s - 0.035) / 0.4);
      const L = Math.min(64, sp * 0.1) * q * (0.25 + 1.4 * st * st) * e;
      if (L < 0.7) continue;
      const o = 54 + j * row + i * 3;
      bmp[o] = Math.min(255, 255 * Math.min(1, L / 2.2));
      bmp[o + 1] = 127.5 - (dy * L * 255) / REACH + 0.5;
      bmp[o + 2] = 127.5 - (dx * L * 255) / REACH + 0.5;
    }
  }
  // The pieces.
  const b = m.pieces;
  for (let k = 0; k < m.n; k++) {
    const o5 = k * ${SENT};
    const x = b[o5], y = b[o5 + 1], a = (b[o5 + 4] + 0.9) / K;
    const r = Math.max(0, Math.min(255, 127.5 + ((b[o5 + 2] - x) * 255) / REACH + 0.5)) | 0;
    const g = Math.max(0, Math.min(255, 127.5 + ((b[o5 + 3] - y) * 255) / REACH + 0.5)) | 0;
    const cx = x / K - 0.5, cy = y / K - 0.5, tall = a * 1.1547;
    const j0 = Math.max(0, Math.ceil(cy - tall)), j1 = Math.min(h - 1, Math.floor(cy + tall));
    const i0 = Math.max(0, Math.ceil(cx - a)), i1 = Math.min(w - 1, Math.floor(cx + a));
    for (let j = j0; j <= j1; j++) {
      const dy = Math.abs(j - cy) * 0.8660254;
      for (let i = i0; i <= i1; i++) {
        const dx = Math.abs(i - cx);
        if (dx > a || dx * 0.5 + dy > a) continue;
        const o = 54 + j * row + i * 3;
        bmp[o] = 255; bmp[o + 1] = g; bmp[o + 2] = r;
      }
    }
  }
  postMessage({ id: m.id, url: URL.createObjectURL(new Blob([bmp], { type: "image/bmp" })) });
};
`;

const VOID_V = `#version 300 es
in vec2 q; in vec4 a0; in vec4 a1;
uniform vec2 uSize; out vec2 vQ; out float vPx;
void main() {
  float r = ${HOLE.toFixed(3)};
  vPx = r; vQ = q * 1.22;
  vec2 p = a0.zw + q * 1.22 * r;
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const VOID_F = `#version 300 es
precision highp float;
in vec2 vQ; in float vPx; out vec4 o; uniform float uPx;
void main() {
  vec2 w = abs(vQ);
  float d = max(w.x, dot(w, vec2(0.5, 0.8660254)));
  float c = clamp((1.0 - d) * vPx * uPx + 0.5, 0.0, 1.0);
  o = vec4(0.0, 0.0, 0.0, c);
}`;
const PIECE_V = `#version 300 es
in vec2 q; in vec4 a0; in vec4 a1;
uniform vec2 uSize; uniform float uShadow;
out vec2 vQ; out float vR; out float vK; out float vS;
void main() {
  vQ = q * 1.28; vR = a1.x; vK = a1.y; vS = a1.z;
  float r = a1.x * (uShadow > 0.5 ? 1.5 : 1.0);
  vec2 p = a0.xy + q * 1.28 * r + (uShadow > 0.5 ? vec2(1.6, 2.6) * (1.0 + a1.y * 1.4) : vec2(0.0));
  gl_Position = vec4(p.x / uSize.x * 2.0 - 1.0, 1.0 - p.y / uSize.y * 2.0, 0.0, 1.0);
}`;
const PIECE_F = `#version 300 es
precision highp float;
in vec2 vQ; in float vR; in float vK; in float vS; out vec4 o; uniform float uPx, uShadow;
void main() {
  if (uShadow > 0.5) {
    o = vec4(0.0, smoothstep(1.0, 0.25, length(vQ)) * 0.42 * vK, 0.0, 0.0);
    return;
  }
  vec2 w = abs(vQ);
  float d = max(w.x, dot(w, vec2(0.5, 0.8660254)));
  float c = clamp((1.0 - d) * vR * uPx + 0.5, 0.0, 1.0);
  // A hexagon of glass over the piece of the page that is in it: lit at its upper left, dark
  // at its lower right, an edge that catches the light.
  float tip = dot(vQ, vec2(-0.55, -0.72));
  float edge = smoothstep(0.66, 0.93, d);
  float spot = smoothstep(0.5, 0.0, length(vQ - vec2(-0.32, -0.42)));
  float light = vK * (edge * (0.16 + 0.5 * max(0.0, tip)) + 0.14 * max(0.0, tip) + 0.5 * spot * spot * (0.5 + 0.5 * vS));
  float shade = vK * (0.1 + 0.42 * max(0.0, -tip) + 0.22 * smoothstep(0.86, 1.0, d));
  o = vec4(light, shade, 1.0, 1.0) * c;
}`;
const FULL_V = `#version 300 es
in vec2 q; out vec2 vUv;
void main() { vUv = q * 0.5 + 0.5; gl_Position = vec4(q, 0.0, 1.0); }`;
const LAST_F = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uPieces, uFlow;
uniform vec2 uSize, uAt, uScreen;
uniform vec3 uDeep, uHue, uLight;
uniform float uTime, uPaper;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 x) {
  vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 p = vec2(vUv.x, 1.0 - vUv.y) * uSize;
  vec4 c = texture(uPieces, vUv);
  float hole = clamp(c.a - c.b, 0.0, 1.0);
  vec2 P = p + uAt;
  vec4 f = textureLod(uFlow, P / uScreen, 0.0);
  float sp = length(f.xy);
  vec2 d = f.xy / max(sp, 1.0);
  // Where it was pulled rather than torn: dry strokes along the way it went.
  float drag = smoothstep(0.05, 0.42, f.z) * smoothstep(16.0, 190.0, sp);
  // (Grain, drawn out along the way: in the way's own coordinates it was a zebra, where the
  // water turns.)
  float st = 0.0;
  if (drag > 0.02) for (int k = -4; k <= 4; k++) st += noise((P + d * float(k) * 7.0) * vec2(0.19)) * (5.0 - abs(float(k)));
  st = st / 25.0;
  float streak = smoothstep(0.6, 0.7, st + drag * 0.13) * drag * drag * (1.0 - c.a) * 0.8;
  // The hole: deep, a little light moving far down in it; the cut of its edge, lit below
  // and to the right, in shadow above and to the left.
  vec2 e = vec2(1.0, -1.0) / uSize;
  float up = texture(uPieces, vUv - e * 2.4).a;
  float dn = texture(uPieces, vUv + e * 1.6).a;
  float cut = clamp(c.a - dn, 0.0, 1.0) * (1.0 - c.b);
  float under = clamp(1.0 - up, 0.0, 1.0);
  float n1 = noise(P * 0.028 + vec2(uTime * 0.22, -uTime * 0.1));
  float n2 = noise(P * 0.045 - vec2(uTime * 0.16, uTime * 0.2));
  float net = pow(1.0 - abs(n1 + n2 - 1.0), 9.0);
  vec3 deep = uDeep * (1.0 - 0.35 * under) + uHue * (0.014 + 0.075 * net) * (1.0 - uPaper);
  vec3 col = deep * hole + uDeep * streak + uLight * (cut * 0.3 * (1.0 - 0.6 * uPaper)) + mix(vec3(1.0), uLight, 0.35) * c.r;
  float a = clamp(hole * 0.985 + streak + c.g * (1.0 - hole), 0.0, 1.0);
  o = vec4(col, a);
}`;

type Snap = { id: number; x: number; y: number; w: number; h: number; n: number; data: Float32Array; t: number };

class Scatter {
  private W = 860;
  private H = 520;
  private lens = document.createElement("div");
  private canvas = document.createElement("canvas");
  private svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private fe: SVGElement;
  private worker: Worker;
  private gl: WebGL2RenderingContext | null = null;
  private draws: ((s: Snap) => void) | null = null;
  private px = 1;
  private dead = false;
  private off: () => void;
  // The honeycomb, and whose piece has gone (its number and one).
  private cols = 0;
  private rows = 0;
  private gone = new Int16Array(0);
  private rnd = new Uint8Array(0);
  // The pieces: where, how fast, home, size, chance, how far home, the cell.
  private n = 0;
  private x = new Float32Array(MAX);
  private y = new Float32Array(MAX);
  private vx = new Float32Array(MAX);
  private vy = new Float32Array(MAX);
  private hx = new Float32Array(MAX);
  private hy = new Float32Array(MAX);
  private chance = new Float32Array(MAX);
  private home = new Float32Array(MAX);
  private cell = new Int32Array(MAX);
  /** Where pieces may be let go (the most the pane can cover), and the pane itself. */
  private span = { x: 0, y: 0 };
  private at = { x: 0, y: 0, w: 0, h: 0 };
  private small = 0;
  private busy = false;
  private next = 1;
  private waiting: Snap | null = null;
  private urls: string[] = [];
  private shown = false;
  private t = 0;
  private deep: number[] = [0.02, 0.03, 0.04];
  private hue: number[] = [0.2, 0.8, 0.7];
  private light: number[] = [0.5, 0.95, 0.88];
  private paper = 0;

  constructor(private root: HTMLElement) {
    const ns = "http://www.w3.org/2000/svg";
    this.svg.setAttribute("aria-hidden", "true");
    this.svg.setAttribute("style", "position:absolute;width:0;height:0;pointer-events:none");
    this.fe = document.createElementNS(ns, "feImage");
    this.lens.className = "dev-scatter";
    this.canvas.className = "dev-scatter";
    this.lens.setAttribute("aria-hidden", "true");
    this.canvas.setAttribute("aria-hidden", "true");
    // (Said here, not in the stylesheet: what builds it rewrites or drops what it does not know.)
    this.lens.style.setProperty("backdrop-filter", "url(#dev-scatter)");
    this.build();
    document.body.append(this.svg, this.lens, this.canvas);
    const src = URL.createObjectURL(new Blob([WORKER], { type: "text/javascript" }));
    this.worker = new Worker(src);
    URL.revokeObjectURL(src);
    this.worker.onmessage = (e) => this.back(e.data as { id: number; url: string });
    this.fit();
    window.addEventListener("resize", this.fit);
    window.addEventListener(THEME_EVENT, this.theme);
    this.theme();
    this.start();
    this.off = water.hear(this.step);
    water.apart = false;
    this.warm();
  }

  /** All of it done once, unseen (one piece, in its place): the first time a browser draws
   *  such a filter, and each of these shaders, the page stands still — not in a stroke. */
  private warm() {
    const { W, H } = this;
    const x = Math.round((water.w - W) / 2);
    const y = Math.round((water.h - H) / 2);
    const m = [W / 2, H / 2];
    this.busy = true;
    this.waiting = { id: this.next++, x, y, w: W, h: H, n: 1, data: new Float32Array([m[0], m[1], m[0], m[1], PIECE, 0, 0, 0]), t: 0 };
    this.warming = this.waiting.id;
    this.worker.postMessage({ id: this.waiting.id, W, H, K: MAP, pieces: new Float32Array([m[0], m[1], m[0], m[1], PIECE]), n: 1, x, y, field: new Float32Array(12), fw: 2, fh: 2, fx: 0, fy: 0, cx: 10, cy: 10 });
  }
  /** Which picture that is (until it has been drawn). */
  private warming = 0;

  private later = false;

  /** Its picture has come: drawn, above the site's door (what is behind it the browser does not
   *  draw) — and wiped, so nothing of it is seen — and put away. Should it come only after the
   *  door has opened: at leisure, some seconds on. */
  private warmed(snap: Snap, url: string) {
    this.warming = 0;
    if (!covered() && !this.later) {
      this.later = true;
      URL.revokeObjectURL(url);
      atLeisure(() => {
        if (!this.dead && !this.n && !this.busy) this.warm();
      }, 600_000);
      return;
    }
    const top = (z: string) => {
      this.lens.style.zIndex = this.canvas.style.zIndex = z;
    };
    top("2147483000");
    this.size(snap.w, snap.h);
    this.fe.setAttribute("href", url);
    this.show(snap.x, snap.y);
    this.draws?.(snap);
    this.wipe?.();
    // (For as many frames as it takes to have been drawn: a page that is loading draws few.)
    const since = performance.now();
    let frames = 0;
    const look = () => {
      if (!this.dead && (++frames < 9 || performance.now() - since < 700)) {
        requestAnimationFrame(look);
        return;
      }
      top("");
      if (!this.n) this.hide();
      URL.revokeObjectURL(url);
    };
    requestAnimationFrame(look);
  }
  /** The canvas over it, emptied. */
  private wipe: (() => void) | null = null;

  private filter: SVGElement | null = null;
  private cut = "";
  /** The filter, and the pane, at this size. */
  private size(w: number, h: number) {
    const key = `${w}x${h}`;
    if (this.cut === key) return;
    this.cut = key;
    for (const el of [this.filter, this.fe]) {
      el?.setAttribute("width", `${w}`);
      el?.setAttribute("height", `${h}`);
    }
    this.lens.style.width = `${w}px`;
    this.lens.style.height = `${h}px`;
  }

  private build() {
    const ns = "http://www.w3.org/2000/svg";
    const { W, H } = this;
    const f = document.createElementNS(ns, "filter");
    this.filter = f;
    this.cut = `${W}x${H}`;
    const attrs = (el: Element, o: Record<string, string>) => {
      for (const k in o) el.setAttribute(k, o[k]);
      return el;
    };
    attrs(f, { id: "dev-scatter", x: "0", y: "0", width: `${W}`, height: `${H}`, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" });
    attrs(this.fe, { x: "0", y: "0", width: `${W}`, height: `${H}`, preserveAspectRatio: "none", result: "m" });
    const mask = attrs(document.createElementNS(ns, "feColorMatrix"), { in: "m", type: "matrix", values: "0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 2.2 0 -0.75", result: "a" });
    const move = attrs(document.createElementNS(ns, "feDisplacementMap"), { in: "SourceGraphic", in2: "m", scale: `${REACH}`, xChannelSelector: "R", yChannelSelector: "G", result: "d" });
    const cut = attrs(document.createElementNS(ns, "feComposite"), { in: "d", in2: "a", operator: "in" });
    // (What it showed before may be gone.)
    this.fe.removeAttribute("href");
    f.append(this.fe, mask, move, cut);
    this.svg.replaceChildren(f);
  }

  private fit = () => {
    this.W = Math.min(WIDE[WIDE.length - 1], document.documentElement.clientWidth);
    this.H = Math.min(TALL[TALL.length - 1], window.innerHeight);
    this.px = Math.min(FINGER ? 2 : 1.25, window.devicePixelRatio || 1);
    this.cols = Math.ceil(water.w / PITCH) + 2;
    this.rows = Math.ceil(water.h / (PITCH * 0.8660254)) + 2;
    this.gone = new Int16Array(this.cols * this.rows);
    this.rnd = new Uint8Array(this.cols * this.rows);
    let s = 11;
    for (let i = 0; i < this.rnd.length; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      this.rnd[i] = s >>> 24;
    }
    this.n = 0;
    this.build();
    for (const el of [this.lens, this.canvas]) {
      el.style.width = `${this.W}px`;
      el.style.height = `${this.H}px`;
    }
    this.canvas.width = Math.round(this.W * this.px);
    this.canvas.height = Math.round(this.H * this.px);
    this.at = { x: 0, y: 0, w: this.W, h: this.H };
    this.hide();
    this.draws = null;
    if (this.gl || FINGER) this.start();
  };

  private theme = () => {
    window.setTimeout(() => {
      if (this.dead) return;
      const c = (role: string, fb: [number, number, number]) => readRGB(this.root, role, fb).map((v) => v / 255);
      const bg = c("bg", [7, 10, 15]);
      const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
      this.paper = lum > 0.5 ? 1 : 0;
      this.deep = this.paper ? bg.map((v) => v * 0.9) : bg.map((v) => v * 0.32);
      this.hue = c("b", [45, 212, 191]);
      this.light = c("b2", [125, 240, 220]);
      if (FINGER) this.start();
    }, 160);
  };

  /** The pieces let go, carried, brought home: after each step of the water. */
  private step = (dt: number) => {
    if (this.dead) return;
    this.t += dt;
    if (dt > 0) {
      // (Not the site's door, while it loads.)
      if (!covered()) this.letGo();
      if (this.n > 24) did("hand");
      this.carry(dt);
    }
    if (!this.n) {
      this.hide();
      return;
    }
    if (document.hidden) return;
    if (FINGER && this.tooSlow()) return;
    this.send(dt);
  };

  // A phone that cannot (most frames late while it is on): never again, and what could
  // come apart before does.
  private gapAt = 0;
  private gaps = 0;
  private late = 0;
  private tooSlow(): boolean {
    const now = performance.now();
    const gap = now - this.gapAt;
    this.gapAt = now;
    if (gap > 300) return false;
    this.gaps++;
    if (gap > 52) this.late++;
    if (this.gaps < 100) return false;
    const bad = this.late > 60;
    this.gaps = this.late = 0;
    if (bad) this.destroy();
    return bad;
  }

  private letGo() {
    const b = water.box;
    if (b.x1 <= b.x0) return;
    const h = PITCH * 0.8660254;
    const { W, H, cols, rows, gone, rnd } = this;
    const [mx, my] = water.where;
    if (!this.n) {
      this.span.x = Math.min(water.w - W, Math.max(0, mx - W / 2));
      this.span.y = Math.min(water.h - H, Math.max(0, my - H / 2));
    }
    const x0 = Math.max(0, this.span.x, b.x0);
    const x1 = Math.min(water.w, this.span.x + W, b.x1);
    const j0 = Math.max(0, Math.floor(Math.max(0, this.span.y, b.y0) / h));
    const j1 = Math.min(rows - 1, Math.ceil(Math.min(water.h, this.span.y + H, b.y1) / h));
    for (let j = j0; j <= j1; j++) {
      const shift = j & 1 ? PITCH / 2 : 0;
      const i0 = Math.max(0, Math.floor((x0 - shift) / PITCH));
      const i1 = Math.min(cols - 1, Math.ceil((x1 - shift) / PITCH));
      for (let i = i0; i <= i1; i++) {
        const k = j * cols + i;
        if (gone[k] || this.n >= MAX) continue;
        const cx = i * PITCH + shift;
        const cy = j * h;
        const f = water.at(cx, cy);
        const r = rnd[k] / 255;
        if (f[2] < 0.28 + 0.26 * r) continue;
        const n = this.n++;
        const a = r * 43 + i;
        const out = 16 + 90 * rnd[(k * 7 + 3) % rnd.length] * (1 / 255);
        this.x[n] = this.hx[n] = cx;
        this.y[n] = this.hy[n] = cy;
        this.vx[n] = f[0] * (0.35 + 0.5 * r) + Math.cos(a) * out;
        this.vy[n] = f[1] * (0.35 + 0.5 * r) + Math.sin(a) * out;
        this.chance[n] = rnd[(k * 13 + 5) % rnd.length] / 255;
        this.home[n] = 0;
        this.cell[n] = k;
        gone[k] = n + 1;
      }
    }
  }

  private carry(dt: number) {
    const { x, y, vx, vy, hx, hy, chance, home } = this;
    const [mx, my] = water.where;
    const hand = water.moving && water.pace > 260 ? 1 : 0;
    for (let n = 0; n < this.n; n++) {
      const c = chance[n];
      let f = water.at(x[n], y[n]);
      const stir = Math.min(1, f[2] * 2.4);
      // With the water, and as it swirls; out of the hand's way.
      const turn = Math.sin(x[n] * 0.031 + this.t * 2.1 + c * 9) + Math.cos(y[n] * 0.037 - this.t * 1.7);
      const gain = 0.75 + 0.6 * c;
      const wantX = (f[0] * gain - turn * 34 * c) * stir;
      const wantY = (f[1] * gain + turn * 30 * (1 - c)) * stir;
      const keep = 1 - Math.exp(-dt * (3.2 + 2.6 * c));
      vx[n] += (wantX - vx[n]) * keep;
      vy[n] += (wantY - vy[n]) * keep;
      if (hand) {
        const px = x[n] - mx;
        const py = y[n] - my;
        const d = Math.sqrt(px * px + py * py);
        if (d < 46 && d > 0.5) {
          const push = (1 - d / 46) * 1500 * dt;
          vx[n] += (px / d) * push;
          vy[n] += (py / d) * push;
        }
      }
      // Home again, once it is calm there (each in its own time).
      f = water.at(hx[n], hy[n]);
      const calm = f[2] < 0.15 + 0.09 * c;
      home[n] = calm ? Math.min(1, home[n] + dt * (1.5 + 1.6 * c)) : Math.max(0, home[n] - dt * 5);
      const pull = home[n] * home[n];
      const ease = 1 - Math.exp(-dt * pull * 13);
      vx[n] *= Math.exp(-dt * pull * 9);
      vy[n] *= Math.exp(-dt * pull * 9);
      x[n] += vx[n] * dt + (hx[n] - x[n]) * ease;
      y[n] += vy[n] * dt + (hy[n] - y[n]) * ease;
      const ox = x[n] - hx[n];
      const oy = y[n] - hy[n];
      const o = Math.sqrt(ox * ox + oy * oy);
      if (o > FAR) {
        x[n] = hx[n] + (ox / o) * FAR;
        y[n] = hy[n] + (oy / o) * FAR;
      }
      if (home[n] > 0.75 && o < 0.8) {
        // Come home: it is the page again.
        this.gone[this.cell[n]] = 0;
        const l = --this.n;
        if (l !== n) {
          for (const a of [x, y, vx, vy, hx, hy, chance, home]) a[n] = a[l];
          this.cell[n] = this.cell[l];
          this.gone[this.cell[n]] = n + 1;
          n--;
        }
      }
    }
  }

  /** Where the pane lies: round what is going on, no larger than that, and the hand always
   *  well inside what it can cover. */
  private place(dt: number) {
    const [mx, my] = water.where;
    let x0 = 1e9;
    let x1 = -1e9;
    let y0 = 1e9;
    let y1 = -1e9;
    for (let n = 0; n < this.n; n++) {
      x0 = Math.min(x0, this.hx[n], this.x[n]);
      x1 = Math.max(x1, this.hx[n], this.x[n]);
      y0 = Math.min(y0, this.hy[n], this.y[n]);
      y1 = Math.max(y1, this.hy[n], this.y[n]);
    }
    const { W, H, at, span } = this;
    const most = (lo: number, hi: number, m: number, size: number, all: number) => {
      const mid = Math.min(m + size * 0.2, Math.max(m - size * 0.2, (lo + hi) / 2));
      return Math.round(Math.min(all - size, Math.max(0, mid - size / 2)));
    };
    span.x = most(x0, x1, mx, W, water.w);
    span.y = most(y0, y1, my, H, water.h);
    // (Its edges are where pieces are home already: room for that, round them.)
    const step = (steps: number[], need: number, size: number) => Math.min(size, steps.find((v) => v >= need) ?? size);
    let w = step(WIDE, Math.min(x1, span.x + W) - Math.max(x0, span.x) + 170, W);
    let h = step(TALL, Math.min(y1, span.y + H) - Math.max(y0, span.y) + 170, H);
    // (Smaller again only when it has been enough for a while.)
    const less = w < at.w || h < at.h;
    this.small = less ? this.small + dt : 0;
    if (less && this.small < 0.35 && this.shown) {
      w = Math.max(w, at.w);
      h = Math.max(h, at.h);
    }
    const put = (lo: number, hi: number, s: number, size: number, big: number) => Math.round(Math.min(s + big - size, Math.max(s, (Math.max(lo, s) + Math.min(hi, s + big)) / 2 - size / 2)));
    at.x = put(x0, x1, span.x, w, W);
    at.y = put(y0, y1, span.y, h, H);
    at.w = w;
    at.h = h;
  }

  private send(dt: number) {
    this.place(dt);
    if (this.busy) return;
    const { x: X, y: Y, w: W, h: H } = this.at;
    const sent = new Float32Array(this.n * SENT);
    const drawn = new Float32Array(this.n * DRAWN);
    let m = 0;
    for (let n = 0; n < this.n; n++) {
      const hx = this.hx[n] - X;
      const hy = this.hy[n] - Y;
      // (Towards the pane's edges they have come home already: nothing ends in a line.)
      const e = Math.min(1, Math.max(0, (Math.min(hx, W - hx, hy, H - hy) - 14) / 64));
      if (e <= 0.02) continue;
      const ox = (this.x[n] - this.hx[n]) * e;
      const oy = (this.y[n] - this.hy[n]) * e;
      const k = Math.min(1, Math.max(0, (Math.abs(ox) + Math.abs(oy) - 1.2) / 11));
      const c = this.chance[n];
      const r = PIECE * (1 - k * (0.06 + 0.56 * c * c * c));
      const s = m * SENT;
      const d = m * DRAWN;
      sent[s] = drawn[d] = hx + ox;
      sent[s + 1] = drawn[d + 1] = hy + oy;
      sent[s + 2] = drawn[d + 2] = hx;
      sent[s + 3] = drawn[d + 3] = hy;
      sent[s + 4] = drawn[d + 4] = r;
      drawn[d + 5] = k;
      drawn[d + 6] = c;
      m++;
    }
    const crop = water.crop(X, Y, W, H);
    this.busy = true;
    const id = this.next++;
    this.waiting = { id, x: X, y: Y, w: W, h: H, n: m, data: drawn, t: this.t };
    const data = sent.slice(0, m * SENT);
    this.worker.postMessage({ id, W, H, K: MAP, pieces: data, n: m, x: X, y: Y, field: crop.data, fw: crop.w, fh: crop.h, fx: crop.x - X, fy: crop.y - Y, cx: crop.cx, cy: crop.cy }, [data.buffer, crop.data.buffer]);
  }

  private back(m: { id: number; url: string }) {
    const snap = this.waiting;
    if (this.dead || !snap || snap.id !== m.id) {
      URL.revokeObjectURL(m.url);
      this.busy = false;
      return;
    }
    const img = new Image();
    const done = () => {
      this.busy = false;
      this.waiting = null;
      if (this.dead) return;
      if (snap.id === this.warming) {
        this.warmed(snap, m.url);
        return;
      }
      // (All home while it was being made: it is put away already, and stays so.)
      if (!this.n) {
        URL.revokeObjectURL(m.url);
        return;
      }
      // The picture and the drawing of the same moment, in the same frame.
      this.size(snap.w, snap.h);
      this.fe.setAttribute("href", m.url);
      this.show(snap.x, snap.y);
      this.draws?.(snap);
      this.urls.push(m.url);
      while (this.urls.length > 3) URL.revokeObjectURL(this.urls.shift()!);
    };
    img.onload = done;
    img.onerror = () => {
      this.busy = false;
      URL.revokeObjectURL(m.url);
    };
    img.src = m.url;
  }

  private show(x: number, y: number) {
    const t = `translate(${x}px,${y}px)`;
    this.lens.style.transform = t;
    this.canvas.style.transform = t;
    if (this.shown) return;
    this.shown = true;
    this.lens.style.display = this.canvas.style.display = "block";
  }
  private hide() {
    if (!this.shown && this.lens.style.display === "none") return;
    this.shown = false;
    this.waiting = null;
    this.lens.style.display = this.canvas.style.display = "none";
  }

  /* ── the canvas over it ── */
  /** On a phone: four stamps (a hole, a shadow, what is cut out again, the light on a piece). */
  private stamps() {
    const g = this.canvas.getContext("2d");
    if (!g) return;
    const A = 26;
    const stamp = (paint: (q: CanvasRenderingContext2D) => void): { src: CanvasImageSource } => {
      const c = document.createElement("canvas");
      c.width = c.height = 72;
      const q = c.getContext("2d")!;
      q.translate(36, 36);
      paint(q);
      const out: { src: CanvasImageSource } = { src: c };
      void createImageBitmap(c).then((b) => (out.src = b), () => {});
      return out;
    };
    const hex = (q: CanvasRenderingContext2D, r: number) => {
      q.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        q.lineTo((Math.cos(a) * r) / 0.8660254, (Math.sin(a) * r) / 0.8660254);
      }
      q.closePath();
    };
    const rgb = (v: number[]) => `rgb(${v.map((x) => Math.round(x * 255)).join(",")})`;
    // (As the other canvas lights it: white, with some of the theme's light in it.)
    const lit = (a: number) => `rgba(${this.light.map((v) => Math.round((0.65 + v * 0.35) * 255)).join(",")},${a})`;
    const hole = stamp((q) => {
      hex(q, A);
      q.fillStyle = rgb(this.deep.map((v, i) => v + this.hue[i] * 0.014));
      q.fill();
    });
    const cut = stamp((q) => {
      hex(q, A);
      q.fillStyle = "#fff";
      q.fill();
    });
    const shadow = stamp((q) => {
      const gr = q.createRadialGradient(0, 0, 4, 0, 0, 34);
      gr.addColorStop(0, "rgba(0,0,0,.46)");
      gr.addColorStop(0.5, "rgba(0,0,0,.2)");
      gr.addColorStop(1, "rgba(0,0,0,0)");
      q.fillStyle = gr;
      q.fillRect(-36, -36, 72, 72);
    });
    const light = stamp((q) => {
      hex(q, A);
      q.clip();
      const gr = q.createLinearGradient(-17, -22, 17, 22);
      gr.addColorStop(0, lit(0.13));
      gr.addColorStop(0.45, lit(0));
      gr.addColorStop(0.5, "rgba(0,0,0,.09)");
      gr.addColorStop(1, "rgba(0,0,0,.46)");
      q.fillStyle = gr;
      q.fillRect(-36, -36, 72, 72);
      const spot = q.createRadialGradient(-8, -11, 0, -8, -11, 14);
      spot.addColorStop(0, lit(0.46));
      spot.addColorStop(0.3, lit(0.23));
      spot.addColorStop(0.65, lit(0.06));
      spot.addColorStop(1, lit(0));
      q.fillStyle = spot;
      q.fillRect(-36, -36, 72, 72);
      const e = q.createLinearGradient(-17, -22, 17, 22);
      e.addColorStop(0, lit(0.62));
      e.addColorStop(0.55, lit(0.15));
      e.addColorStop(1, lit(0.13));
      q.strokeStyle = e;
      for (const [w, a] of [
        [9, 0.3],
        [5, 0.5],
        [2, 1],
      ]) {
        hex(q, A - w * 0.36);
        q.globalAlpha = a;
        q.lineWidth = w;
        q.stroke();
      }
    });
    // Far down in the holes, a little light that moves.
    const N = 128;
    const tile = document.createElement("canvas");
    tile.width = tile.height = N;
    const tq = tile.getContext("2d")!;
    const bits = tq.createImageData(N, N);
    const near = (p: number, q: number) => Math.sin(p * 2 + Math.sin(q + 1.3) * 1.6) + Math.sin(q * 2 + Math.sin(p * 2 - 0.7) * 1.4) + Math.sin(p + q + Math.sin(q * 3) * 0.6);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const v = Math.pow(Math.max(0, 1 - Math.abs(near((i / N) * Math.PI * 2, (j / N) * Math.PI * 2)) * 0.62), 5);
        for (let k = 0; k < 3; k++) bits.data[(j * N + i) * 4 + k] = this.hue[k] * 255;
        bits.data[(j * N + i) * 4 + 3] = v * (this.paper ? 0 : 34);
      }
    tq.putImageData(bits, 0, 0);
    const net = g.createPattern(tile, "repeat");
    this.wipe = () => g.clearRect(0, 0, this.W, this.H);
    this.draws = (s) => {
      const d = s.data;
      const n = s.n * DRAWN;
      g.setTransform(this.px, 0, 0, this.px, 0, 0);
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
      g.clearRect(0, 0, this.W, this.H);
      const put = (src: CanvasImageSource, x: number, y: number, r: number) => {
        const h = (36 * r) / A;
        g.drawImage(src, x - h, y - h, h * 2, h * 2);
      };
      g.globalAlpha = 0.985;
      for (let o = 0; o < n; o += DRAWN) put(hole.src, d[o + 2], d[o + 3], HOLE + 0.4);
      if (net) {
        g.globalCompositeOperation = "source-atop";
        g.globalAlpha = 1;
        net.setTransform(new DOMMatrix([1.4, 0, 0, 1.4, -s.x + s.t * 6, -s.y - s.t * 4]));
        g.fillStyle = net;
        g.fillRect(0, 0, s.w, s.h);
        g.globalCompositeOperation = "source-over";
      }
      for (let o = 0; o < n; o += DRAWN) {
        g.globalAlpha = d[o + 5];
        put(shadow.src, d[o] + 1.6, d[o + 1] + 2.6, d[o + 4] * 1.2);
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "destination-out";
      for (let o = 0; o < n; o += DRAWN) put(cut.src, d[o], d[o + 1], d[o + 4]);
      g.globalCompositeOperation = "source-over";
      for (let o = 0; o < n; o += DRAWN) {
        g.globalAlpha = d[o + 5];
        put(light.src, d[o], d[o + 1], d[o + 4]);
      }
    };
  }

  private start() {
    if (FINGER) {
      this.stamps();
      return;
    }
    const gl = this.gl ?? this.canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "high-performance" });
    this.gl = gl;
    if (!gl) return;
    const make = (v: string, f: string) => {
      const p = gl.createProgram()!;
      for (const [type, src] of [
        [gl.VERTEX_SHADER, v],
        [gl.FRAGMENT_SHADER, f],
      ] as const) {
        const s = gl.createShader(type)!;
        gl.shaderSource(s, src);
        gl.compileShader(s);
        gl.attachShader(p, s);
      }
      gl.bindAttribLocation(p, 0, "q");
      gl.bindAttribLocation(p, 1, "a0");
      gl.bindAttribLocation(p, 2, "a1");
      gl.linkProgram(p);
      return p;
    };
    const holes = make(VOID_V, VOID_F);
    const pieces = make(PIECE_V, PIECE_F);
    const last = make(FULL_V, LAST_F);
    const uni = (p: WebGLProgram, n: string) => gl.getUniformLocation(p, n);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const inst = gl.createBuffer();
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, inst);
    gl.bufferData(gl.ARRAY_BUFFER, MAX * DRAWN * 4, gl.DYNAMIC_DRAW);
    for (const [loc, off] of [
      [1, 0],
      [2, 16],
    ] as const) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, DRAWN * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const flow = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, flow);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.enable(gl.BLEND);
    gl.viewport(0, 0, cw, ch);
    this.wipe = () => {
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    this.draws = (s) => {
      if (gl.isContextLost()) return;
      gl.bindVertexArray(vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      // (Only as much of it as the pane covers.)
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(0, Math.max(0, ch - Math.ceil(s.h * this.px)), Math.ceil(s.w * this.px), Math.ceil(s.h * this.px));
      if (s.n) {
        gl.bindBuffer(gl.ARRAY_BUFFER, inst);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, s.data, 0, s.n * DRAWN);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(holes);
        gl.uniform2f(uni(holes, "uSize"), this.W, this.H);
        gl.uniform1f(uni(holes, "uPx"), this.px);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.n);
        gl.useProgram(pieces);
        gl.uniform2f(uni(pieces, "uSize"), this.W, this.H);
        gl.uniform1f(uni(pieces, "uPx"), this.px);
        gl.uniform1f(uni(pieces, "uShadow"), 1);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.n);
        gl.uniform1f(uni(pieces, "uShadow"), 0);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, s.n);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.SCISSOR_TEST);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, flow);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, water.cols, water.rows, 0, gl.RGBA, gl.HALF_FLOAT, water.data);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.useProgram(last);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.uniform1i(uni(last, "uPieces"), 0);
      gl.uniform1i(uni(last, "uFlow"), 1);
      gl.uniform2f(uni(last, "uSize"), this.W, this.H);
      gl.uniform2f(uni(last, "uAt"), s.x, s.y);
      gl.uniform2f(uni(last, "uScreen"), water.w, water.h);
      gl.uniform3f(uni(last, "uDeep"), this.deep[0], this.deep[1], this.deep[2]);
      gl.uniform3f(uni(last, "uHue"), this.hue[0], this.hue[1], this.hue[2]);
      gl.uniform3f(uni(last, "uLight"), this.light[0], this.light[1], this.light[2]);
      gl.uniform1f(uni(last, "uTime"), s.t);
      gl.uniform1f(uni(last, "uPaper"), this.paper);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
  }

  destroy() {
    this.dead = true;
    this.off();
    water.apart = true;
    window.removeEventListener("resize", this.fit);
    window.removeEventListener(THEME_EVENT, this.theme);
    this.worker.terminate();
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.svg.remove();
    this.lens.remove();
    this.canvas.remove();
    this.gl?.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** The page comes apart under the hand, from now on. Returns the function that stops it. */
export function scatterUnderHand(root: HTMLElement): () => void {
  if (!canScatter()) return () => {};
  const s = new Scatter(root);
  return () => s.destroy();
}
