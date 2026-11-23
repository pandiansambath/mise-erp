"use client";

// Every piece of text answers the cursor.
//
//   "see the word 'System Engineer'… I placed the cursor… that G shown as big,
//    which is the cursor font animation, right… that animation we need in all
//    the fonts, at least a minute movement when the cursor hovers over any
//    font" (22 Nov)
//
// The swell on "System Engineer" comes from <Wave>, which splits a word into
// one box per letter. Doing that to every paragraph on the page would mean
// rewriting text React owns (the clock alone updates every second). So this
// leaves the page's text alone and works over it:
//
//   · it finds the letter under the pointer (caretRangeFromPoint),
//   · makes that letter and its two neighbours on each side transparent with a
//     CSS Custom Highlight — the text node itself is never touched,
//   · and draws those five letters in an overlay, in the same font, size,
//     weight, spacing and colour, exactly where they were — then swells them
//     the way Wave does (the letter under the cursor most, its neighbours
//     less), and lets them settle back when the pointer moves on.
//
// Only for a real hovering pointer, never on touch; nothing for reduced
// motion; skipped where a letter already moves (Wave), inside inputs, in SVG,
// on gradient-filled text (no colour to copy), and wherever data-noswell is.

import { THEME_EVENT } from "./theme";

type Glyph = {
  node: Text;
  i: number;
  range: Range;
  el: HTMLSpanElement;
  leaving: number | null;
  /** Where its letter was on the screen. */
  x: number;
  y: number;
};

const SKIP = "input, textarea, select, [contenteditable], .dev-wave, [data-noswell], svg, canvas, script, style";
// The scale, lift and sideways lean (em) for the letter under the cursor and
// its neighbours — Wave's swell, with the neighbours leaning aside so the
// swelled letter does not crowd them (QA, 23 Nov).
const SHAPE: Record<number, [number, number, number]> = {
  0: [1.32, -0.13, 0],
  1: [1.15, -0.06, 0.07],
  2: [1.05, 0, 0.035],
};

export function installLetterSwell(): () => void {
  if (typeof window === "undefined") return () => {};
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return () => {};
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
  const HighlightCtor = (window as unknown as { Highlight?: new () => { add: (r: Range) => void; delete: (r: Range) => void; clear: () => void } }).Highlight;
  if (!registry || !HighlightCtor) return () => {};
  const caretAt = (x: number, y: number): { node: Node; offset: number } | null => {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    if (d.caretPositionFromPoint) {
      const p = d.caretPositionFromPoint(x, y);
      return p ? { node: p.offsetNode, offset: p.offset } : null;
    }
    if (d.caretRangeFromPoint) {
      const r = d.caretRangeFromPoint(x, y);
      return r ? { node: r.startContainer, offset: r.startOffset } : null;
    }
    return null;
  };

  const highlight = new HighlightCtor();
  registry.set("dev-swell", highlight);
  // The rule that hides the page's own letters while they are drawn above.
  // Added here, not in globals.css: the build's CSS minifier does not know
  // ::highlight and drops it.
  const rule = document.createElement("style");
  rule.textContent = "::highlight(dev-swell){color:transparent;text-shadow:none}";
  document.head.appendChild(rule);
  const layer = document.createElement("div");
  layer.className = "dev-swell-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);

  const glyphs = new Map<string, Glyph>();
  const ids = new WeakMap<Text, number>();
  let nextId = 1;
  const keyOf = (node: Text, i: number) => {
    let id = ids.get(node);
    if (!id) {
      id = nextId++;
      ids.set(node, id);
    }
    return `${id}:${i}`;
  };

  // The accent the letter under the cursor turns, like Wave's hover colour.
  let accent = "";
  const readAccent = () => {
    const root = document.querySelector<HTMLElement>(".dev-root");
    accent = root ? getComputedStyle(root).getPropertyValue("--d-b2").trim() : "";
  };
  readAccent();

  const charRect = (node: Text, i: number): DOMRect | null => {
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    const rect = r.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  };

  const drop = (g: Glyph, k: string) => {
    if (g.leaving) window.clearTimeout(g.leaving);
    g.el.remove();
    highlight.delete(g.range);
    glyphs.delete(k);
  };
  const clearAll = () => {
    glyphs.forEach((g, k) => drop(g, k));
  };

  // While any letter is lifted: its text must still be there, and where it
  // was. A popup closed by a key, a line growing above it — with the mouse
  // still, nothing said so, and the letters stayed behind (QA, §102).
  let watch = 0;
  const check = () => {
    glyphs.forEach((g, k) => {
      const r = g.node.isConnected && g.i < g.node.data.length ? charRect(g.node, g.i) : null;
      if (!r || Math.abs(r.left - g.x) > 1.5 || Math.abs(r.top - g.y) > 1.5) drop(g, k);
    });
    if (!glyphs.size) {
      window.clearInterval(watch);
      watch = 0;
    }
  };

  const make = (node: Text, i: number, style: CSSStyleDeclaration): Glyph | null => {
    const rect = charRect(node, i);
    if (!rect) return null;
    const range = document.createRange();
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const el = document.createElement("span");
    el.className = "dev-swell-glyph";
    el.textContent = node.data[i];
    const s = el.style;
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.height = `${rect.height}px`;
    s.lineHeight = `${rect.height}px`;
    s.fontFamily = style.fontFamily;
    s.fontSize = style.fontSize;
    s.fontWeight = style.fontWeight;
    s.fontStyle = style.fontStyle;
    s.fontStretch = style.fontStretch;
    s.fontVariant = style.fontVariant;
    s.fontFeatureSettings = style.fontFeatureSettings;
    s.fontVariationSettings = style.fontVariationSettings;
    s.letterSpacing = style.letterSpacing;
    s.textTransform = style.textTransform;
    s.color = style.color;
    s.textShadow = style.textShadow;
    layer.appendChild(el);
    highlight.add(range);
    if (!watch) watch = window.setInterval(check, 140);
    return { node, i, range, el, leaving: null, x: rect.left, y: rect.top };
  };

  let raf = 0;
  let px = 0;
  let py = 0;
  const update = () => {
    raf = 0;
    const hit = caretAt(px, py);
    const want = new Map<string, number>();
    let node: Text | null = null;
    let style: CSSStyleDeclaration | null = null;
    if (hit && hit.node.nodeType === Node.TEXT_NODE) {
      const t = hit.node as Text;
      const parent = t.parentElement;
      if (parent && !parent.closest(SKIP) && parent.closest(".dev-root, .dev-popup-host")) {
        // The caret falls between letters: take the one the pointer is over.
        let i = -1;
        for (const c of [hit.offset, hit.offset - 1]) {
          if (c < 0 || c >= t.data.length) continue;
          const r = charRect(t, c);
          if (r && px >= r.left - 1 && px <= r.right + 1 && py >= r.top - 2 && py <= r.bottom + 2) {
            i = c;
            break;
          }
        }
        if (i >= 0 && /\S/.test(t.data[i])) {
          const cs = getComputedStyle(parent);
          // Gradient-filled text has no colour to copy; tiny text gains nothing.
          const transparent = /rgba\([^)]*,\s*0\)$/.test(cs.color) || cs.webkitTextFillColor === "transparent" || cs.color === "transparent";
          if (!transparent && parseFloat(cs.fontSize) >= 9) {
            node = t;
            style = cs;
            for (let d = -2; d <= 2; d++) {
              const j = i + d;
              if (j < 0 || j >= t.data.length || !/\S/.test(t.data[j])) continue;
              want.set(keyOf(t, j), d);
            }
          }
        }
      }
    }
    // Letters leaving the swell settle back, then hand the page its letter back.
    glyphs.forEach((g, k) => {
      if (want.has(k) || g.leaving) return;
      g.el.style.transform = "none";
      g.el.style.color = "";
      g.leaving = window.setTimeout(() => drop(g, k), 300);
    });
    if (!node || !style) return;
    want.forEach((dist, k) => {
      let g = glyphs.get(k);
      const j = Number(k.split(":")[1]);
      if (!g) {
        const made = make(node!, j, style!);
        if (!made) return;
        g = made;
        glyphs.set(k, g);
        // The swell on the next frame, so it animates from the letter's size.
        const gg = g;
        requestAnimationFrame(() => apply(gg, dist, style!));
      } else {
        if (g.leaving) {
          window.clearTimeout(g.leaving);
          g.leaving = null;
        }
        apply(g, dist, style);
      }
    });
  };
  const apply = (g: Glyph, dist: number, style: CSSStyleDeclaration) => {
    const [scale, lift, lean] = SHAPE[Math.abs(dist)] ?? [1, 0, 0];
    g.el.style.transform = `translate(${Math.sign(dist) * lean}em, ${lift}em) scale(${scale})`;
    g.el.style.color = dist === 0 && accent ? accent : style.color;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    px = e.clientX;
    py = e.clientY;
    if (!raf) raf = requestAnimationFrame(update);
  };
  // The letters sit where the text was; when the page moves, let go at once.
  const onScroll = () => clearAll();
  const onLeave = () => clearAll();
  const onTheme = () => readAccent();
  window.addEventListener("pointermove", onMove, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onScroll);
  document.documentElement.addEventListener("pointerleave", onLeave);
  window.addEventListener(THEME_EVENT, onTheme);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    window.clearInterval(watch);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onScroll);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    window.removeEventListener(THEME_EVENT, onTheme);
    clearAll();
    registry.delete("dev-swell");
    rule.remove();
    layer.remove();
  };
}
