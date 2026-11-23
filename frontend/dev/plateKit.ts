// What every drawn nameplate shares (§102.2): the browser lays the name out as
// real text (it can be selected, read aloud, found); this measures where each
// letter landed, in the same font, and gives a design the letters as a mask to
// draw with on one 2D canvas laid over them (2D, not WebGL: a phone keeps only
// a few WebGL contexts).

import { readRGB } from "./theme";

export type RGB = [number, number, number];

export type Pal = {
  light: boolean;
  ink: RGB;
  bg: RGB;
  bg2: RGB;
  a: RGB;
  a2: RGB;
  b: RGB;
  b2: RGB;
  c: RGB;
  d: RGB;
  gold: RGB;
};

export function readPal(root: Element): Pal {
  const bg = readRGB(root, "bg", [7, 10, 15]);
  return {
    light: (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255 > 0.5,
    ink: readRGB(root, "ink", [230, 237, 245]),
    bg,
    bg2: readRGB(root, "bg2", [11, 17, 24]),
    a: readRGB(root, "a", [217, 119, 66]),
    a2: readRGB(root, "a2", [240, 160, 100]),
    b: readRGB(root, "b", [45, 212, 191]),
    b2: readRGB(root, "b2", [125, 240, 220]),
    c: readRGB(root, "c", [155, 140, 255]),
    d: readRGB(root, "d", [244, 114, 182]),
    gold: readRGB(root, "gold", [240, 189, 106]),
  };
}

export const rgba = (c: RGB, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
export const mixc = (x: RGB, y: RGB, t: number): RGB => [x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t];
export const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
export const WHITE: RGB = [255, 255, 255];

export type Pad = { x: number; t: number; b: number };
/** One letter as the browser set it: its box's left and width, its baseline. */
export type Glyph = { ch: string; x: number; y: number; w: number };
export type Geo = {
  /** The canvas, in CSS pixels, and where it sits over the name's box. */
  W: number;
  H: number;
  left: number;
  top0: number;
  dpr: number;
  phone: boolean;
  font: string;
  px: number;
  /** The height of a capital. */
  cap: number;
  glyphs: Glyph[];
  /** Each line of the name: its ends and baseline. */
  lines: { x0: number; x1: number; base: number }[];
  /** The name's bounds: its ends, the top of its capitals, its last baseline. */
  x0: number;
  x1: number;
  top: number;
  base: number;
};

/** Where the browser put each letter of `h1`, relative to `wrap` (positioned),
 *  as a canvas with `pad` round the name sees it. */
export function measure(h1: HTMLElement, wrap: HTMLElement, pad: Pad): Geo | null {
  const node = [...h1.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) as Text | undefined;
  const text = node?.data ?? "";
  if (!node || !text.trim()) return null;
  const wr = wrap.getBoundingClientRect();
  // Under a transform (an entrance): measured back in its own pixels.
  const k = wrap.offsetWidth ? wr.width / wrap.offsetWidth : 1;
  if (!(k > 0)) return null;
  const cs = getComputedStyle(h1);
  const px = parseFloat(cs.fontSize);
  const font = `${cs.fontStyle} ${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  const probe = document.createElement("canvas").getContext("2d");
  if (!probe) return null;
  probe.font = font;
  const m = probe.measureText("H");
  const asc = m.fontBoundingBoxAscent;
  const desc = m.fontBoundingBoxDescent;
  const cap = m.actualBoundingBoxAscent;
  const range = document.createRange();
  const raw: Glyph[] = [];
  let i = 0;
  for (const ch of text) {
    range.setStart(node, i);
    range.setEnd(node, i + ch.length);
    i += ch.length;
    const r = range.getBoundingClientRect();
    if (!ch.trim() || r.width < 0.1) continue;
    raw.push({ ch, x: (r.left - wr.left) / k, w: r.width / k, y: (r.top - wr.top) / k + (asc * (r.height / k)) / (asc + desc) });
  }
  if (!raw.length) return null;
  const x0 = Math.min(...raw.map((g) => g.x));
  const x1 = Math.max(...raw.map((g) => g.x + g.w));
  const top = Math.min(...raw.map((g) => g.y)) - cap;
  const base = Math.max(...raw.map((g) => g.y));
  const left = x0 - pad.x;
  const top0 = top - pad.t;
  const glyphs = raw.map((g) => ({ ...g, x: g.x - left, y: g.y - top0 }));
  const lines: Geo["lines"] = [];
  for (const g of glyphs) {
    const l = lines.find((n) => Math.abs(n.base - g.y) < px * 0.3);
    if (l) {
      l.x0 = Math.min(l.x0, g.x);
      l.x1 = Math.max(l.x1, g.x + g.w);
    } else lines.push({ x0: g.x, x1: g.x + g.w, base: g.y });
  }
  const phone = window.matchMedia("(max-width: 767px)").matches;
  return {
    W: Math.ceil(x1 - x0 + pad.x * 2),
    H: Math.ceil(base - top + pad.t + pad.b),
    left,
    top0,
    dpr: Math.min(window.devicePixelRatio || 1, phone ? 2.25 : 2),
    phone,
    font,
    px,
    cap,
    glyphs,
    lines,
    x0: pad.x,
    x1: pad.x + (x1 - x0),
    top: pad.t,
    base: pad.t + (base - top),
  };
}

/** A rounded box's path (square on a browser without roundRect). */
export function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

export type Layer = { c: HTMLCanvasElement; g: CanvasRenderingContext2D };
/** A canvas the size of the plate, drawn in CSS pixels. */
export function layer(geo: Geo): Layer {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(geo.W * geo.dpr));
  c.height = Math.max(1, Math.round(geo.H * geo.dpr));
  const g = c.getContext("2d")!;
  g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
  return { c, g };
}
/** One layer laid on another, pixel for pixel. */
export function lay(g: CanvasRenderingContext2D, c: HTMLCanvasElement, geo: Geo, dx = 0, dy = 0) {
  g.drawImage(c, dx, dy, geo.W, geo.H);
}
export function wipe(l: Layer, geo: Geo) {
  l.g.globalCompositeOperation = "source-over";
  l.g.globalAlpha = 1;
  l.g.clearRect(0, 0, geo.W, geo.H);
}

/** The name, solid, in one colour. */
export function letters(geo: Geo, fill: string | CanvasGradient = "#fff"): HTMLCanvasElement {
  const { c, g } = layer(geo);
  g.font = geo.font;
  g.textBaseline = "alphabetic";
  g.fillStyle = fill;
  for (const l of geo.glyphs) g.fillText(l.ch, l.x, l.y);
  return c;
}
/** The name's outline. */
export function outline(geo: Geo, stroke: string | ((g: CanvasRenderingContext2D) => CanvasGradient), width: number): HTMLCanvasElement {
  const { c, g } = layer(geo);
  g.font = geo.font;
  g.textBaseline = "alphabetic";
  g.lineJoin = "round";
  g.lineWidth = width;
  g.strokeStyle = typeof stroke === "string" ? stroke : stroke(g);
  for (const l of geo.glyphs) g.strokeText(l.ch, l.x, l.y);
  return c;
}
/** A layer's shape in another fill. */
export function tinted(src: HTMLCanvasElement, geo: Geo, fill: string | ((g: CanvasRenderingContext2D) => CanvasGradient)): HTMLCanvasElement {
  const { c, g } = layer(geo);
  lay(g, src, geo);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = typeof fill === "string" ? fill : fill(g);
  g.fillRect(0, 0, geo.W, geo.H);
  return c;
}
/** A layer's shape, blurred (white): its glow. */
export function blurred(src: HTMLCanvasElement, geo: Geo, radius: number): HTMLCanvasElement {
  const { c, g } = layer(geo);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.shadowColor = "#fff";
  g.shadowBlur = radius * geo.dpr;
  // Only the shadow: the shape itself is drawn far off the canvas.
  g.shadowOffsetX = c.width * 2;
  g.drawImage(src, -c.width * 2, 0);
  return c;
}
/** The edge of a layer's shape that faces (dx, dy): a bevel's lit or dark side. */
export function edge(src: HTMLCanvasElement, geo: Geo, dx: number, dy: number, fill: string): HTMLCanvasElement {
  const { c, g } = layer(geo);
  lay(g, src, geo);
  g.globalCompositeOperation = "destination-out";
  lay(g, src, geo, -dx, -dy);
  g.globalCompositeOperation = "source-in";
  g.fillStyle = fill;
  g.fillRect(0, 0, geo.W, geo.H);
  return c;
}

/** Where a pointer is on the plate, and the taps since the last frame. */
export type Ptr = { x: number; y: number; on: boolean; taps: { x: number; y: number }[] };
/** One design: it draws itself; it says whether it needs every frame now. */
export type Art = { frame: (g: CanvasRenderingContext2D, t: number, dt: number, ptr: Ptr) => boolean };
export type ArtFactory = (geo: Geo, pal: Pal, opts: { root: HTMLElement; still: boolean; t: number }) => Art;
