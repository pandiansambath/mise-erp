"use client";

// A card's words, painted, so that they can go where its glass goes (§104.11).
//
//   "detailing missing… when the card is transforming as spiral those texts are
//    not following that… text words are not following, see" (24 Nov)
//
// A card's words are ordinary page text while it is in the present: sharp, selectable,
// links. The moment it begins to wind itself up it is WebGL alone (cardScene), and the
// browser cannot bend text with it — so a picture of the words, painted here by the same
// fonts in the same places, is on the sheet, and the page's own are put out
// (globals.css devChainReveal: in the same few pixels of scroll).
//
// What is painted is read off the card itself, once, when there is time: its boxes (a
// chip's edge and ground, a hairline), its letters line by line, its icons. It is read
// with the scroll's own animations off (data-inking), so wherever the card is, what is
// measured is the card at rest.

import { covered, whenOpen } from "./stage";

type Grad = { stops: [number, string][]; angle: number };
type Item =
  | { k: "box"; x: number; y: number; w: number; h: number; r: number; fill: string | null; grad: Grad | null; edge: string | null; ew: number; alpha: number }
  | { k: "line"; x: number; y: number; w: number; h: number; color: string; alpha: number }
  | { k: "text"; node: Text | null; x: number; y: number; s: string; tt: string; font: string; ls: string; color: string; grad: (Grad & { x: number; y: number; w: number; h: number }) | null; shadow: [string, number] | null; filter: string; alpha: number }
  | { k: "pic"; x: number; y: number; w: number; h: number; r: number; img: CanvasImageSource; filter: string; alpha: number };

export type Ink = { canvas: HTMLCanvasElement; version: number };

/** Something held at rest: where it is now and how large, and where it belongs. */
type Held = { left: number; top: number; k: number; x: number; y: number };

type Page = { card: HTMLElement; slot: HTMLElement; items: Item[] | null; ink: Ink | null; stale: boolean; dirty: boolean; w: number; h: number; watch: MutationObserver };

const pages = new Map<HTMLElement, Page>();
let queued = 0;
let pen: CanvasRenderingContext2D | null = null;
const ups = new Map<string, [number, number]>();

/** How far above and below the line a font's letters reach. */
function reach(font: string): [number, number] {
  const had = ups.get(font);
  if (had) return had;
  pen ??= document.createElement("canvas").getContext("2d");
  let out: [number, number] = [12, 4];
  if (pen) {
    pen.font = font;
    const m = pen.measureText("Hg");
    out = [m.fontBoundingBoxAscent, m.fontBoundingBoxDescent];
  }
  ups.set(font, out);
  return out;
}

/** The parts of a CSS list, split at its own commas. */
function parts(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(s.slice(from).trim());
  return out;
}

const SIDES: Record<string, number> = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };

/** The first straight gradient of a background. */
function gradient(bg: string): Grad | null {
  const m = /linear-gradient\((.*)\)/.exec(parts(bg).find((x) => x.startsWith("linear-gradient(")) ?? "");
  if (!m) return null;
  const ps = parts(m[1]);
  let angle = 180;
  if (/deg$/.test(ps[0])) angle = parseFloat(ps.shift()!);
  else if (ps[0] in SIDES) angle = SIDES[ps.shift()!];
  const stops = ps.map((p) => {
    const at = /\s(-?[\d.]+)%\s*$/.exec(p);
    return [at ? parseFloat(at[1]) / 100 : NaN, at ? p.slice(0, at.index).trim() : p] as [number, string];
  });
  if (stops.length < 2) return null;
  if (Number.isNaN(stops[0][0])) stops[0][0] = 0;
  if (Number.isNaN(stops[stops.length - 1][0])) stops[stops.length - 1][0] = 1;
  for (let i = 1; i < stops.length - 1; i++) if (Number.isNaN(stops[i][0])) stops[i][0] = i / (stops.length - 1);
  return { stops, angle };
}

function paintOf(c: CanvasRenderingContext2D, g: Grad, x: number, y: number, w: number, h: number): CanvasGradient {
  const a = ((g.angle - 90) * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const mx = x + w / 2;
  const my = y + h / 2;
  const out = c.createLinearGradient(mx - dx * half, my - dy * half, mx + dx * half, my + dy * half);
  for (const [at, color] of g.stops) {
    try {
      out.addColorStop(Math.min(1, Math.max(0, at)), color);
    } catch {
      /* a colour the pen does not know */
    }
  }
  return out;
}

const NONE = /^(transparent|rgba\(\d+, \d+, \d+, 0\)|color\(srgb [\d.e-]+ [\d.e-]+ [\d.e-]+ \/ 0\))$/;

/** An inline drawing, as a picture (its colours are the page's, so they are written into it). */
async function drawn(svg: SVGSVGElement, w: number, h: number): Promise<HTMLImageElement | null> {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll<SVGElement>("*")];
  const to = [copy, ...copy.querySelectorAll<SVGElement>("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const t = to[i];
    t.removeAttribute("class");
    for (const p of ["fill", "stroke", "strokeWidth", "strokeLinecap", "strokeLinejoin", "opacity", "color"] as const) t.style[p] = cs[p];
  });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  copy.setAttribute("width", `${w * 2}`);
  copy.setAttribute("height", `${h * 2}`);
  copy.style.transform = "none";
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Everything that is written and drawn on a card, with its place on it. */
async function read(p: Page): Promise<void> {
  const { card, slot } = p;
  const items: Item[] = [];
  const later: Promise<void>[] = [];
  card.dataset.inking = "";
  const at = card.getBoundingClientRect();
  const sit = (b: DOMRect, held: Held | null) =>
    held
      ? { left: held.x + (b.left - held.left) / held.k, top: held.y + (b.top - held.top) / held.k, width: b.width / held.k, height: b.height / held.k }
      : { left: b.left - at.left, top: b.top - at.top, width: b.width, height: b.height };
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  // Something on it that is coming on, or beats, is read as it is at rest.
  const restOf = (el: HTMLElement): [number, number] | null => {
    let x = 0;
    let y = 0;
    let e: HTMLElement | null = el;
    while (e && e !== card) {
      const up = e.offsetParent as HTMLElement | null;
      x += e.offsetLeft + (up?.clientLeft ?? 0);
      y += e.offsetTop + (up?.clientTop ?? 0);
      e = up;
    }
    return e === card ? [x, y] : null;
  };
  const walk = (el: Element, alpha: number, clip: (Grad & { x: number; y: number; w: number; h: number }) | null, filter: string, held: Held | null) => {
    if (el === slot) return;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const now = el.getBoundingClientRect();
    if (el !== card && cs.animationName !== "none" && el instanceof HTMLElement) {
      const rest = restOf(el);
      if (rest) held = { left: now.left, top: now.top, k: Math.max(0.05, now.width / Math.max(1, el.offsetWidth)), x: rest[0], y: rest[1] };
    }
    const o = alpha * (el !== card && cs.animationName !== "none" ? 1 : parseFloat(cs.opacity || "1"));
    if (o < 0.01) return;
    if (el !== card && cs.filter !== "none") filter = cs.filter;
    const r = sit(now, held);
    const x = r.left;
    const y = r.top;
    if (el instanceof SVGSVGElement) {
      const item: Item = { k: "pic", x, y, w: r.width, h: r.height, r: 0, img: null as unknown as CanvasImageSource, filter, alpha: o };
      later.push(
        drawn(el, r.width, r.height).then((img) => {
          if (img) item.img = img;
        }),
      );
      items.push(item);
      return;
    }
    if (el instanceof HTMLCanvasElement) return;
    const round = parseFloat(cs.borderTopLeftRadius) || 0;
    if (el instanceof HTMLImageElement) {
      if (el.complete && el.naturalWidth) items.push({ k: "pic", x, y, w: r.width, h: r.height, r: round, img: el, filter, alpha: o });
      return;
    }
    if (el !== card) {
      const letters = cs.backgroundClip === "text" || cs.webkitBackgroundClip === "text";
      const grad = cs.backgroundImage !== "none" ? gradient(cs.backgroundImage) : null;
      if (letters && grad) clip = { ...grad, x, y, w: r.width, h: r.height };
      const fill = NONE.test(cs.backgroundColor) ? null : cs.backgroundColor;
      const ws = [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth].map((v) => parseFloat(v) || 0);
      const styles = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
      const colors = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
      const on = ws.map((v, i) => v > 0 && styles[i] !== "none" && styles[i] !== "hidden" && !NONE.test(colors[i]));
      const all = on.every(Boolean) && colors.every((c) => c === colors[0]);
      if (fill || (grad && !letters) || all) items.push({ k: "box", x, y, w: r.width, h: r.height, r: round, fill, grad: letters ? null : grad, edge: all ? colors[0] : null, ew: ws[0], alpha: o });
      if (!all) {
        if (on[0]) items.push({ k: "line", x, y, w: r.width, h: ws[0], color: colors[0], alpha: o });
        if (on[1]) items.push({ k: "line", x: x + r.width - ws[1], y, w: ws[1], h: r.height, color: colors[1], alpha: o });
        if (on[2]) items.push({ k: "line", x, y: y + r.height - ws[2], w: r.width, h: ws[2], color: colors[2], alpha: o });
        if (on[3]) items.push({ k: "line", x, y, w: ws[3], h: r.height, color: colors[3], alpha: o });
      }
    }
    for (const c of el.childNodes) {
      if (c instanceof Element) walk(c, o, clip, filter, held);
      else if (c instanceof Text && c.data.trim()) letter(c, cs, o, clip, filter, held);
    }
  };
  const letter = (node: Text, cs: CSSStyleDeclaration, alpha: number, clip: (Grad & { x: number; y: number; w: number; h: number }) | null, filter: string, held: Held | null) => {
    const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const [up, down] = reach(font);
    const ls = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
    const fill = cs.webkitTextFillColor || cs.color;
    const cut = clip && NONE.test(fill) ? clip : null;
    if (NONE.test(fill) && !cut) return;
    const sh = /^(rgba?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)) 0px 0px ([\d.]+)px/.exec(cs.textShadow);
    const shadow: [string, number] | null = sh && !cut ? [sh[1], parseFloat(sh[2])] : null;
    const range = document.createRange();
    const put = (s: string, box: DOMRect, whole: boolean) => {
      const r = sit(box, held);
      items.push({ k: "text", node: whole ? node : null, x: r.left, y: r.top + (r.height - up - down) / 2 + up, s, tt: cs.textTransform, font, ls, color: fill, grad: cut, shadow, filter, alpha });
    };
    // (From its first letter to its last: a space before it is not where it begins.)
    range.setStart(node, Math.max(0, node.data.search(/\S/)));
    range.setEnd(node, node.data.trimEnd().length);
    const lines = range.getClientRects();
    if (lines.length === 0) return;
    if (lines.length === 1) {
      put(node.data.replace(/\s+/g, " ").trim(), lines[0], true);
      return;
    }
    // Over several lines: word by word, those that stand on one line together.
    const words = /\S+/g;
    let m: RegExpExecArray | null;
    let line = "";
    let first: DOMRect | null = null;
    while ((m = words.exec(node.data))) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (first && Math.abs(r.top - first.top) < 3) line += ` ${m[0]}`;
      else {
        if (first) put(line, first, false);
        line = m[0];
        first = r;
      }
    }
    if (first) put(line, first, false);
  };
  try {
    walk(card, 1, null, "none", null);
  } finally {
    delete card.dataset.inking;
  }
  p.w = w;
  p.h = h;
  await Promise.all(later);
  p.items = items.filter((i) => i.k !== "pic" || i.img);
}

const said = (s: string, tt: string) => (tt === "uppercase" ? s.toUpperCase() : tt === "lowercase" ? s.toLowerCase() : tt === "capitalize" ? s.replace(/(^|\s)\S/g, (m) => m.toUpperCase()) : s);

function paint(p: Page) {
  if (!p.items || !p.w || !p.h) return;
  const k = Math.min(window.devicePixelRatio || 1, 1.5);
  const canvas = p.ink?.canvas ?? document.createElement("canvas");
  const cw = Math.ceil(p.w * k);
  const ch = Math.ceil(p.h * k);
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
  }
  const c = canvas.getContext("2d");
  if (!c) return;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cw, ch);
  c.setTransform(k, 0, 0, k, 0, 0);
  c.textBaseline = "alphabetic";
  for (const i of p.items) {
    c.globalAlpha = i.alpha;
    c.filter = "filter" in i && i.filter !== "none" ? i.filter : "none";
    if (i.k === "box") {
      const round = Math.min(i.r, i.w / 2, i.h / 2);
      c.beginPath();
      c.roundRect(i.x, i.y, i.w, i.h, round);
      if (i.fill) {
        c.fillStyle = i.fill;
        c.fill();
      }
      if (i.grad) {
        c.fillStyle = paintOf(c, i.grad, i.x, i.y, i.w, i.h);
        c.fill();
      }
      if (i.edge) {
        c.beginPath();
        c.roundRect(i.x + i.ew / 2, i.y + i.ew / 2, i.w - i.ew, i.h - i.ew, Math.max(0, round - i.ew / 2));
        c.strokeStyle = i.edge;
        c.lineWidth = i.ew;
        c.stroke();
      }
    } else if (i.k === "line") {
      c.fillStyle = i.color;
      c.fillRect(i.x, i.y, i.w, i.h);
    } else if (i.k === "pic") {
      c.save();
      if (i.r) {
        c.beginPath();
        c.roundRect(i.x, i.y, i.w, i.h, Math.min(i.r, i.w / 2, i.h / 2));
        c.clip();
      }
      try {
        c.drawImage(i.img, i.x, i.y, i.w, i.h);
      } catch {
        /* a picture that is not whole */
      }
      c.restore();
    } else {
      // (What counts on, counts on: a lone run of text is read afresh.)
      const s = said(i.node ? i.node.data.replace(/\s+/g, " ").trim() || i.s : i.s, i.tt);
      c.font = i.font;
      (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = i.ls;
      c.fillStyle = i.grad ? paintOf(c, i.grad, i.grad.x, i.grad.y, i.grad.w, i.grad.h) : i.color;
      if (i.shadow) {
        c.shadowColor = i.shadow[0];
        c.shadowBlur = i.shadow[1] * k * 1.4;
      }
      c.fillText(s, i.x, i.y);
      c.shadowBlur = 0;
    }
  }
  c.globalAlpha = 1;
  c.filter = "none";
  p.ink = { canvas, version: (p.ink?.version ?? 0) + 1 };
  p.dirty = false;
}

/** The work still to do, a card at a time, when the page has time for it. */
function next() {
  queued = 0;
  for (const p of pages.values()) {
    if (p.stale) {
      p.stale = false;
      void read(p).then(() => {
        paint(p);
        later();
      });
      return;
    }
  }
}
function later(wait = 120) {
  if (queued) return;
  const go = () => {
    // (Behind the site's door there is time for all of them, one after another.)
    if (!covered() && "requestIdleCallback" in window) window.requestIdleCallback(next, { timeout: 900 });
    else next();
  };
  queued = window.setTimeout(go, covered() ? 24 : wait);
}

/** Have a card's words painted, and kept so. Returns the function that lets go of them. */
export function keepInk(card: HTMLElement, slot: HTMLElement): () => void {
  const p: Page = { card, slot, items: null, ink: null, stale: true, dirty: false, w: 0, h: 0, watch: new MutationObserver(() => {}) };
  // (A clock on it ticks: painted again when it is about to be needed, not every second.)
  p.watch = new MutationObserver((ms) => {
    for (const m of ms) {
      if (slot.contains(m.target)) continue;
      if (m.type === "characterData") p.dirty = true;
      else if ((m.addedNodes.length || m.removedNodes.length) && m.target !== card) {
        p.stale = true;
        later(600);
      }
    }
  });
  p.watch.observe(card, { characterData: true, childList: true, subtree: true });
  pages.set(card, p);
  later();
  // (What comes on as the site opens, a month's block at a time, is on it soon after.)
  const off = whenOpen(() => window.setTimeout(() => reInk(card, true), 1200));
  return () => {
    off();
    p.watch.disconnect();
    pages.delete(card);
  };
}

/** Its words, painted (null: not yet). */
export function inkOf(card: HTMLElement): Ink | null {
  return pages.get(card)?.ink ?? null;
}

/** What has been counting on it is painted as it is now. */
export function freshen(card: HTMLElement) {
  const p = pages.get(card);
  if (p?.dirty && p.items) paint(p);
}

/** Its size, its colours or its fonts have changed: read again (all of them, or one). */
export function reInk(card?: HTMLElement, anyway = false) {
  for (const p of pages.values()) {
    if (card && p.card !== card) continue;
    if (card && !anyway && p.items && p.w === card.offsetWidth && p.h === card.offsetHeight) continue;
    p.stale = true;
  }
  later(260);
}
