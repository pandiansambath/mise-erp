"use client";

// The cards, drawn in WebGL — the Active Theory way.
//
//   "that card when reaching the past or coming as future is still a
//    rectangle… I want that rectangle to curve its body to adapt to the
//    rotation… only when it reaches the centre should we see a perfect
//    rectangle"
//   "that universe theme circle… is literally a perfect circle, which feels
//    artificial… give it a natural life… the universe to card transition so
//    natural that even with a very slow scroll I see the minute details"
//   "when I take my cursor inside the card towards that wave kind of liquid,
//    nothing is happening… scramble, scatter, something… place a few small
//    small dust inside… that dust can show movement towards the cursor"
//   "the lag and cards flickering when I scroll"
//
// Before this, a card's look was a pile of CSS layers (an iris, a skin scaled
// up 16× inside it, two water sheets nearly twice the card's width, a rim, a
// band of light, an orb…) — about a dozen GPU layers a card, eleven cards:
// more than the GPU's memory budget, so tiles were thrown away and painted
// again mid-scroll (the flicker), and none of it could bend or answer the
// cursor. Now each card has ONE canvas, and only the cards near the screen
// have one at all: a small pool of WebGL canvases moves from card to card.
//
// A canvas draws (cardScene.ts), for its card's place in its orbit (the same
// scroll progress the CSS orbit uses):
//   · the card — dark glass with the theme's painted water drifting in two
//     sheets, an iridescent hairline rim; flat in the centre;
//   · the ball it is when away — that same glass, wound up, the water in it,
//     drops and bubbles going round it;
//   · the change between them — the sheet winding itself up, from its right edge
//     to its left, its words on it (cardInk), until it closes (§104.1), every
//     step of it there for a slow scroll.
// Closed and come to the skeleton, the ball is the skeleton's to draw (guests.ts): it goes
// into the bones there, and comes out of them (§106.13).
// (For an evening, 24 Nov, it closed into real worlds. He hated them.) The hand
// stirs the water (flow.ts) and pulls the card's few motes of dust towards it.
//
// The CSS still moves the card round the divider (a compositor transform) and
// still shows its words in the present; this draws only what the card IS.
//
// SURFACES (22 Nov, late): the same glass and water for things that do not
// orbit — the top bar, the popups, the sound menu ("why do these cards alone
// look different, plain… the top bar is fully black… make this also like our
// card animation… so that all UI will be in sync"). A surface is always open,
// flat and in the present; it only gets the water, the rim, the cursor and the
// dust. Surfaces are served first; the pool grows to fit the cards near the
// screen and gives its GPU memory back when a design has no cards.

import type * as THREE_NS from "three";
import { paintLiquid } from "./liquid";
import { readRGB, THEME_EVENT } from "./theme";
import { GL_LOST_EVENT, claimedContexts, compiled, contextsLost, guardCanvas, quiet } from "./glGuard";
import { makeCardScene, type CardScene } from "./cardScene";
import { freshen, inkOf, keepInk, reInk } from "./cardInk";
import { covered, holder } from "./stage";
import { pageY } from "./scrollPos";
import { water } from "./flow";
import { FLAT, lifeOf, MELT, melts, MELTS, rollAt, shutAt, wayOf } from "./orbit";
import { dress, giveGuests, host, type Guest } from "./guests";

type Three = typeof THREE_NS;

type Reg = {
  card: HTMLElement;
  slot: HTMLElement;
  /** "card" orbits (CSS) and has an orb; "surface" is always open and flat. */
  kind: "card" | "surface";
  /** Corner radius in CSS px of the shape drawn. */
  radius: number;
  /** The card's own colour (CSS, e.g. var(--d-b)) and as RGB 0..1. */
  hueCss: string;
  hue: number[];
  first: boolean;
  /** The first card on a phone, once it starts to leave (its words fade). */
  away?: boolean;
  docTop: number;
  docLeft: number;
  /** A surface's place on the screen, and which move of the pointer it was asked for. */
  at: { left: number; top: number; width: number; height: number };
  asked: number;
  w: number;
  h: number;
  near: boolean;
  entry: Entry | null;
  mx: number;
  my: number;
  mAmt: number;
  open: number;
  seed: number;
  rolled?: boolean;
  /** Its turn to be drawn, among those that need not be every frame. */
  turn: number;
  /** How far the ball has turned. */
  spin: number;
  /** How far it has melted, as it is shown: it goes on in its own time, whatever the scroll; and
   *  how far the light of it in the bones has died down. */
  melt: number;
  past: number;
  /** Its words let go of. */
  offInk?: () => void;
  fresh?: boolean;
};

type Entry = {
  canvas: HTMLCanvasElement;
  /** Takes the context-loss guard off (before a deliberate forceContextLoss). */
  unguard: () => void;
  renderer: THREE_NS.WebGLRenderer;
  card: CardScene;
  /** The words on it: whose they are, and as painted when. */
  words: THREE_NS.CanvasTexture | null;
  wordsOf: Reg | null;
  wordsAt: number;
  texture: THREE_NS.Texture | null;
  owner: Reg | null;
  /** The card it draws, with its margin… */
  cw: number;
  ch: number;
  /** …and its drawing surface, which may be larger (never made smaller). */
  bw: number;
  bh: number;
  painted: boolean;
  /** Its shaders compiled (off the main thread) — only then is it handed out. */
  ready: boolean;
  /** Drawn once, unseen. */
  warm: boolean;
  /** Emptied: the skeleton draws its card's ball (§106.13). */
  blank: boolean;
  /** When it last lost its owner (to give idle canvases back). */
  idleSince: number;
};

const MARGIN_DESK = 80;
const MARGIN_PHONE = 56;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

class Pool {
  private regs = new Set<Reg>();
  private entries: Entry[] = [];
  private THREE: Three | null = null;
  private io: IntersectionObserver;
  private ro: ResizeObserver;
  private raf = 0;
  private dead = false;
  private liquidUrl: string | null = null;
  private px = -9999;
  private py = -9999;
  private pLast = 0;
  private pType = "mouse";
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** The browser moves the cards (globals.css devRevolve): only then is a ball where orbit.ts
   *  says it is. */
  private orbits = typeof CSS !== "undefined" && CSS.supports("animation-timeline", "view()");
  private phone = window.matchMedia("(max-width: 767px)").matches;
  /** Canvases given up for good because the device ran out of WebGL contexts
   *  (each loss anywhere on the page takes one off the cap). */
  private capCut = 0;
  private onGlLost = () => {
    this.capCut = Math.min(this.capCut + 1, 6);
  };
  private wide = window.matchMedia("(min-width: 1024px)").matches;
  /** Half the gap between the columns (globals.css --d-half-gap), and the screen's height. */
  private gap = 64;
  /** …and that less how far from the cord a ball stops (--d-melt). */
  private reach = 64;
  private vh = window.innerHeight;
  private t = 0;
  private prev = performance.now();
  private colors = {
    base0: [0.05, 0.07, 0.1],
    base1: [0.03, 0.04, 0.06],
    rim0: [0.85, 0.47, 0.26],
    rim1: [0.61, 0.55, 1],
    rim2: [0.49, 0.94, 0.86],
    front: [0.94, 0.74, 0.42],
    glowA: [0.49, 0.94, 0.86],
    glowB: [0.94, 0.63, 0.39],
    light: 0,
  };
  private layoutDirty = true;
  onEmpty: () => void = () => {};

  constructor() {
    this.io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          for (const r of this.regs)
            if (r.card === e.target) {
              // (Come back into sight: as it ought to be there, at once.)
              if (e.isIntersecting && !r.near) r.melt = -1;
              r.near = e.isIntersecting;
            }
        }
      },
      { rootMargin: "15% 0px 15% 0px" },
    );
    this.ro = new ResizeObserver(() => {
      this.layoutDirty = true;
      for (const r of this.regs) r.asked = -1;
    });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("pointerdown", this.onPointer, { passive: true });
    window.addEventListener(THEME_EVENT, this.onTheme);
    window.addEventListener(GL_LOST_EVENT, this.onGlLost);
    giveGuests(this.theirs);
    void document.fonts?.ready.then(() => reInk());
    document.fonts?.addEventListener?.("loadingdone", this.onFonts);
    void this.boot();
  }

  private onFonts = () => reInk();

  private onResize = () => {
    this.layoutDirty = true;
    this.wide = window.matchMedia("(min-width: 1024px)").matches;
    this.vh = window.innerHeight;
  };
  private onPointer = (e: PointerEvent) => {
    const now = performance.now();
    this.px = e.clientX;
    this.py = e.clientY;
    this.pLast = now;
    this.pType = e.pointerType;
  };
  private onTheme = () => {
    window.setTimeout(() => this.paint(), 140);
  };

  private async boot() {
    const THREE = await import("three");
    if (this.dead) return;
    this.THREE = THREE;
    this.paint();
    // One to begin with; more are made when it is ready, one after another, up to the most
    // that can be on screen at once — cards turning away at the edges, the bar, a popup.
    // (All of them at once build the same shaders each for itself, seconds of it on a slow
    // machine; after the first, the graphics have them.)
    const e = this.makeEntry(THREE);
    if (e) this.entries.push(e);
    // No WebGL here: the cards wear plain glass instead (globals.css).
    else this.root().dataset.nogl = "";
    this.raf = requestAnimationFrame(this.loop);
  }

  private root(): HTMLElement {
    return (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
  }

  private paint() {
    const root = this.root();
    const c = (role: string, fb: [number, number, number]) => readRGB(root, role, fb).map((v) => v / 255);
    const [br, bg, bb] = readRGB(root, "bg", [7, 10, 15]);
    const light = (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255 > 0.5;
    this.colors = {
      base0: c("bg2", [11, 17, 24]),
      base1: c("bg", [7, 10, 15]),
      rim0: c("a", [217, 119, 66]),
      rim1: c("c", [155, 140, 255]),
      rim2: c("b2", [125, 240, 220]),
      front: c("gold", [240, 189, 106]),
      glowA: c("b2", [125, 240, 220]),
      glowB: c("a2", [240, 160, 100]),
      light: light ? 1 : 0,
    };
    this.liquidUrl = paintLiquid(root);
    // (What the skeleton's own ball wears: §106.13.)
    const k = this.colors;
    dress.theme = { base0: k.base0, base1: k.base1, rim1: k.rim1, rim2: k.rim2, front: k.front, glowA: k.glowA, glowB: k.glowB, dust0: k.rim2, light: k.light };
    dress.liquid = this.liquidUrl;
    dress.version++;
    for (const r of this.regs) this.resolveHue(r);
    for (const e of this.entries) this.applyTheme(e);
    reInk();
  }

  private applyTheme(e: Entry) {
    const THREE = this.THREE;
    if (!THREE) return;
    const k = this.colors;
    e.card.theme({ base0: k.base0, base1: k.base1, rim1: k.rim1, rim2: k.rim2, front: k.front, glowA: k.glowA, glowB: k.glowB, dust0: k.rim2, light: k.light });
    if (this.liquidUrl) {
      const url = this.liquidUrl;
      const img = new Image();
      img.onload = () => {
        if (this.dead) return;
        const tex = new THREE.Texture(img);
        tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
        tex.colorSpace = THREE.NoColorSpace;
        tex.needsUpdate = true;
        e.texture?.dispose();
        e.texture = tex;
        e.card.liquid(tex);
      };
      img.src = url;
    }
  }

  private makeEntry(THREE: Three): Entry | null {
    const canvas = document.createElement("canvas");
    canvas.className = "dev-glcanvas";
    let renderer: THREE_NS.WebGLRenderer;
    try {
      // (No depth: what is drawn is drawn in its order. That is a third of its memory, spent on
      // pixels instead: words on a sheet that stands still half wound must be as sharp as the
      // page's own.)
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, depth: false, stencil: false, powerPreference: "high-performance", premultipliedAlpha: true });
      quiet(renderer);
    } catch {
      return null;
    }
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(this.phone ? Math.min(dpr, 2) : Math.min(dpr * 1.28, 1.75));
    renderer.setClearColor(0x000000, 0);
    const card = makeCardScene(THREE, renderer.getPixelRatio(), this.phone);
    const e: Entry = { canvas, unguard: () => {}, renderer, card, words: null, wordsOf: null, wordsAt: 0, texture: null, owner: null, cw: 0, ch: 0, bw: 0, bh: 0, painted: false, ready: false, warm: false, blank: false, idleSince: performance.now() };
    // Its shaders compiled in the background (KHR_parallel_shader_compile),
    // not in the frame that first draws it.
    const done = () => {
      e.ready = true;
    };
    void compiled(renderer, card.scene, card.camera).then(done, done);
    // Taken away by the browser: it hides (globals.css) and leaves the pool;
    // its card shows its plain glass until a canvas is free.
    e.unguard = guardCanvas(canvas, () => {
      if (e.owner) this.release(e.owner);
      this.entries = this.entries.filter((x) => x !== e);
      e.canvas.remove();
    });
    this.applyTheme(e);
    return e;
  }

  private resolveHue(r: Reg) {
    try {
      const probe = document.createElement("span");
      probe.style.color = r.hueCss;
      probe.style.display = "none";
      r.card.appendChild(probe);
      const m = getComputedStyle(probe).color.match(/[\d.]+/g);
      probe.remove();
      if (m && m.length >= 3) r.hue = [+m[0] / 255, +m[1] / 255, +m[2] / 255];
    } catch {
      /* keep the last colour */
    }
  }

  add(card: HTMLElement, slot: HTMLElement, hueCss: string, kind: "card" | "surface" = "card", radius = 16): () => void {
    const r: Reg = {
      card,
      slot,
      kind,
      radius,
      hueCss,
      hue: [0.85, 0.47, 0.26],
      first: card.dataset.link === "first",
      docTop: 0,
      docLeft: 0,
      at: { left: 0, top: 0, width: 1, height: 1 },
      asked: -1,
      w: card.offsetWidth,
      h: card.offsetHeight,
      near: false,
      entry: null,
      mx: -9,
      my: -9,
      mAmt: 0,
      open: 1,
      seed: Math.random() * 20,
      spin: Math.random(),
      melt: -1,
      past: 1,
      turn: this.regs.size,
    };
    card.dataset.gl = "none";
    this.resolveHue(r);
    this.regs.add(r);
    this.io.observe(card);
    this.ro.observe(card);
    this.layoutDirty = true;
    if (kind === "card" && !this.reduced) r.offInk = keepInk(card, slot);
    return () => {
      r.offInk?.();
      this.io.unobserve(card);
      this.ro.unobserve(card);
      if (r.entry) this.release(r);
      delete card.dataset.gl;
      delete card.dataset.rolled;
      this.regs.delete(r);
      if (this.regs.size === 0) this.onEmpty();
    };
  }

  private release(r: Reg) {
    const e = r.entry;
    if (!e) return;
    e.owner = null;
    e.painted = false;
    e.blank = false;
    e.idleSince = performance.now();
    e.canvas.remove();
    r.entry = null;
    r.card.dataset.gl = "none";
  }

  private measure() {
    this.layoutDirty = false;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const xl = window.matchMedia("(min-width: 1280px)").matches;
    this.gap = (xl ? 4 : 2.75) * rem;
    this.reach = this.gap - (xl ? MELT.xl : MELT.lg) * rem;
    for (const r of this.regs) {
      let y = 0;
      let x = 0;
      let el: HTMLElement | null = r.card;
      while (el) {
        y += el.offsetTop;
        x += el.offsetLeft;
        el = el.offsetParent as HTMLElement | null;
      }
      r.docTop = y;
      r.docLeft = x;
      r.w = r.card.offsetWidth;
      r.h = r.card.offsetHeight;
      if (r.kind === "card") r.card.style.setProperty("--half", `${lifeOf(this.vh, r.h, this.wide) / 2}px`);
      if (r.offInk) reInk(r.card);
    }
  }

  /** The card's words put on the canvas that draws it (once they are painted). */
  private dress(e: Entry, r: Reg) {
    const ink = inkOf(r.card);
    if (e.wordsOf === r && e.wordsAt === (ink?.version ?? 0)) return;
    const THREE = this.THREE;
    if (!THREE) return;
    e.words?.dispose();
    e.words = null;
    if (ink) {
      const t = new THREE.CanvasTexture(ink.canvas);
      t.colorSpace = THREE.NoColorSpace;
      t.premultiplyAlpha = true;
      t.generateMipmaps = true;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = Math.min(16, e.renderer.capabilities.getMaxAnisotropy());
      e.words = t;
    }
    e.card.ink(e.words);
    e.wordsOf = r;
    e.wordsAt = ink?.version ?? 0;
  }

  private hold = holder(24, 700);
  private tick = 0;
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.THREE) return;
    const dt = Math.min(0.06, (now - this.prev) / 1000);
    this.prev = now;
    if (!this.reduced) this.t += dt;
    if (this.layoutDirty) this.measure();
    const vh = (this.vh = window.innerHeight);
    const sy = pageY();

    // Who gets a canvas: the surfaces on screen first, then the cards near the
    // screen, closest to the middle first.
    const near = [...this.regs].filter((r) => r.near);
    const surfaces = near.filter((r) => r.kind === "surface");
    const cards = near.filter((r) => r.kind === "card");
    cards.sort((a, b) => Math.abs(a.docTop - sy + a.h / 2 - vh / 2) - Math.abs(b.docTop - sy + b.h / 2 - vh / 2));
    const ordered = [...surfaces, ...cards];
    // Grow the pool towards what is wanted (one new canvas a frame, so a
    // shader compile never lands as one long frame), up to the cap.
    // A phone has only a few live WebGL contexts for the whole page (the
    // background, the spine and the finale need theirs): four cards' worth,
    // fewer once the device has shown it cannot spare even that.
    // …and one fewer for each canvas that has claimed one of its own (the
    // finale's ring, the award room) while it holds it.
    // §101.9: a FIXED, WARM pool — made up to its cap from the start (during
    // the intro, one a frame) and never retired while scrolling: every new
    // canvas compiles shaders, a 1–4 s freeze on a phone each time the old
    // pool rebuilt one. Three on a phone (with the background, the spine and
    // the finale's ring: six live contexts of its ~eight).
    // (Down to one canvas where very few are kept alive: the portrait's piece and the
    // skeleton come before a second card's water.)
    const cap = Math.max(contextsLost() >= 3 ? 1 : 2, (this.phone ? 3 : 8) - this.capCut - claimedContexts());
    if (this.entries.length < cap && this.THREE && this.entries.every((x) => x.ready)) {
      const made = this.makeEntry(this.THREE);
      if (made) this.entries.push(made);
    }
    // Over a cap that has just been cut: give back the canvas furthest down
    // the list at once.
    if (this.entries.length > cap) {
      const spare = this.entries.find((x) => !x.owner) ?? this.entries[this.entries.length - 1];
      if (spare.owner) this.release(spare.owner);
      this.dispose(spare);
    }
    if (covered()) this.presize();
    const want = new Set(ordered.slice(0, this.entries.length));
    for (const r of this.regs) if (r.entry && !want.has(r)) this.release(r);
    for (const r of want) {
      if (r.entry) continue;
      const free = this.freeFor(r);
      if (!free) break;
      free.owner = r;
      r.entry = free;
      r.slot.appendChild(free.canvas);
    }

    // (A ball turns, and melts, whoever draws it.)
    if (!this.reduced)
      for (const r of cards) {
        const { a } = this.life(r, sy);
        r.spin = (r.spin + dt * 0.035 * rollAt(a, this.wide)) % 1;
        // Once begun it goes on to its end, whatever the scroll: never too fast to be seen, never
        // left half done.
        const to = !(r.first && a < 0.5) && melts(a + (r.first && this.wide ? 0.014 : 0), this.wide) ? 1 : 0;
        if (r.melt < 0) {
          r.melt = to;
          r.past = to;
        }
        // (Unwinding already — a flick of the wheel —, it is there at once: its words are.)
        const b = Math.max(a, 1 - a);
        const step = dt / (to === 0 && b < shutAt(this.wide) ? 0.3 : MELTS);
        r.melt = to === 0 && b < FLAT ? 0 : r.melt + Math.min(step, Math.max(-step, to - r.melt));
        const died = r.melt > 0.97 ? 1 : 0;
        r.past += (died - r.past) * (1 - Math.exp(-dt * (died ? 2.6 : 9)));
        if (Math.abs(died - r.past) < 0.006) r.past = died;
      }
    this.tick++;
    water.over = null;
    // (Behind the door, and while it opens: still, once the pool is made and warm.)
    if (this.entries.length >= cap && this.hold()) return;
    for (const r of want) {
      const e = r.entry;
      if (!e) continue;
      this.frame(r, e, vh, sy, dt);
    }
  };

  // Making a drawing surface another size stops the whole page until the graphics
  // have answered (50–90 ms on a laptop, each time a card came near and took a canvas
  // over from a card of another size: the hitches in the scroll, 24 Nov). So a surface
  // is never made smaller, only drawn in as far as its card needs; they are made large
  // enough for the cards of this page behind the door; and a card takes the smallest
  // free one it fits in.
  private need(r: Reg): [number, number] {
    const margin = r.kind === "surface" ? 0 : this.phone ? MARGIN_PHONE : MARGIN_DESK;
    return [r.w + margin * 2, r.h + margin * 2];
  }

  private freeFor(r: Reg): Entry | undefined {
    const [w, h] = this.need(r);
    let best: Entry | undefined;
    let least = Infinity;
    for (const e of this.entries) {
      if (e.owner || !e.ready) continue;
      const area = e.bw * e.bh;
      // Those it fits in, the smallest first; failing that the largest there is.
      const score = e.bw >= w && e.bh >= h ? area : 1e9 - area;
      if (score < least) {
        least = score;
        best = e;
      }
    }
    return best;
  }

  private size(e: Entry, w: number, h: number) {
    e.bw = Math.max(e.bw, w);
    e.bh = Math.max(e.bh, h);
    e.renderer.setSize(e.bw, e.bh, false);
    const st = e.canvas.style;
    st.right = st.bottom = "auto";
    st.width = `${e.bw}px`;
    st.height = `${e.bh}px`;
    e.cw = e.ch = 0;
  }

  /** Its view of a card of this size, at the surface's top left (GL counts from below). */
  private place(e: Entry, cw: number, ch: number) {
    e.cw = cw;
    e.ch = ch;
    e.renderer.setViewport(0, e.bh - ch, cw, ch);
    e.card.view(cw, ch);
  }

  /** One surface a frame: the largest card's first, and so on (a phone has so few that
   *  each must hold any card) — and everything on it drawn once, unseen: the first time a
   *  shader is used the page stops until the graphics have said it is good (35–100 ms a
   *  canvas, in the middle of a scroll). */
  private presize() {
    const cards = [...this.regs].filter((r) => r.kind === "card" && r.w > 0);
    const sizes = cards.map((r) => this.need(r)).sort((a, b) => b[0] * b[1] - a[0] * a[1]);
    if (!sizes.length) return;
    const r0 = cards[0];
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const [w, h] = this.phone ? sizes[0] : sizes[Math.min(i, sizes.length - 1)];
      if (!e.ready || (e.warm && e.bw >= w && e.bh >= h)) continue;
      if (e.bw < w || e.bh < h) this.size(e, w, h);
      if (!e.owner) {
        // (Flat, and closed: everything it can draw, drawn.)
        this.place(e, e.bw, e.bh);
        for (const roll of [0.1, 1]) {
          e.card.look({ w: 300, h: 200, R: 80, radius: 16, roll, bend: 0, show: 1, t: 0, seed: 0, spin: 0, side: 1, mouse: [-9, -9], mouseAmt: 0, stirred: false, place: [0, 0], hue: r0.hue, bright: 1, ink: 1, surface: false, pull: 0 });
          e.renderer.render(e.card.scene, e.card.camera);
        }
        e.cw = e.ch = 0;
      }
      e.warm = true;
      return;
    }
  }

  /** Where the card is in its orbit: the same progress as its CSS timeline. */
  private life(r: Reg, sy: number): { a: number; gone: number } {
    const top = r.docTop - sy;
    let a = 0.5 + (this.vh / 2 - top - r.h / 2) / lifeOf(this.vh, r.h, this.wide);
    let gone = 0;
    // The first card is already in the present when the page opens on a
    // desktop; it only leaves, once its top passes the top of the screen —
    // the second half of the life, like its CSS (exit -20% → exit 100%).
    if (r.first && this.wide) {
      gone = Math.min(1, Math.max(0, (0.2 * r.h - top) / (1.2 * r.h)));
      a = FLAT + (1 - FLAT) * gone;
    }
    return { a: Math.min(1, Math.max(0, a)), gone };
  }

  private ballOf(r: Reg): number {
    return Math.min(this.phone ? 78 : 106, r.w * 0.2, this.need(r)[1] * 0.32);
  }

  /** The skeleton has its ball (§106.13): it is closed, and has come within the skeleton's
   *  lane (guests.ts). */
  private handed(r: Reg, sy: number): Guest | null {
    if (!host.ready || !this.orbits || this.reduced || r.kind !== "card") return null;
    const { a } = this.life(r, sy);
    const b = Math.max(a, 1 - a);
    const closed = b >= shutAt(this.wide);
    if ((!closed && (r.melt <= 0 || b < FLAT)) || (r.first && a < 0.5)) return null;
    const way = wayOf(a, r.w, r.h, this.reach, this.wide);
    const R = this.ballOf(r);
    const off = Math.abs(this.wide ? way.x + r.w / 2 + this.gap : way.x);
    if (closed && off + R * way.s * 1.1 > host.half) return null;
    return {
      key: r,
      x: r.docLeft + r.w / 2 + way.x,
      y: r.docTop - sy + r.h / 2 + way.y,
      r: R * way.s,
      d: r.melt,
      past: r.past,
      ball: closed,
      come: smooth(shutAt(this.wide), shutAt(this.wide) + 0.03, b),
      hue: r.hue,
      seed: r.seed,
      spin: r.spin,
      side: Math.max(0.5, way.side),
      bright: this.brightAt(way.side),
      t: this.t,
      w: r.w,
      h: r.h,
      R,
    };
  }
  private theirs = (sy: number): Guest[] => {
    const out: Guest[] = [];
    if (!this.dead)
      for (const r of this.regs) {
        const g = r.near ? this.handed(r, sy) : null;
        if (g && g.past < 1) out.push(g);
      }
    return out;
  };
  private brightAt(side: number) {
    return this.wide ? 0.86 + 0.14 * smooth(0, 0.8, side) : 0.95;
  }

  private frame(r: Reg, e: Entry, vh: number, sy: number, dt: number) {
    const surface = r.kind === "surface";
    const [cw, ch] = this.need(r);
    if (cw > e.bw || ch > e.bh) this.size(e, cw, ch);
    if (cw !== e.cw || ch !== e.ch) this.place(e, cw, ch);

    const top = r.docTop - sy;
    const { a, gone } = this.life(r, sy);
    const way = wayOf(a, r.w, r.h, this.reach, this.wide);
    // It is the card up to FLAT (and from as far before its middle), its words the page's own;
    // either side of that it unwinds, or winds up, its words on it (globals.css puts the page's own
    // out in the same few pixels of scroll: devChainReveal).
    let roll = rollAt(a, this.wide);
    let bend = 0;
    // The first card on a phone is below the portrait when the page opens: a
    // curved card with its words from the start, never an orb (it leaves like
    // the rest) — "instead of showing that bubble".
    if (r.first && !this.wide && a < 0.5) {
      roll = 0;
      bend = (1 - smooth(0.05, 1 - FLAT, a)) * 0.75;
    }
    if (r.first && !this.wide && r.away !== a > FLAT) {
      r.away = a > FLAT;
      if (r.away) r.card.dataset.away = "";
      else delete r.card.dataset.away;
    }
    // (The skeleton takes it in. Where there is none to, it fades there.)
    let show = 1 - smooth(0.05, 0.85, r.melt);
    if (r.first && a < 0.5) show = smooth(0, 0.06, a);
    if (this.reduced || surface) {
      roll = 0;
      bend = 0;
      show = 1;
    }
    // (The one or the other, never both: where they were both there they were seen double. The
    // first card waits at exactly FLAT from the start: it goes by its own leaving.)
    let ink = r.first && this.wide ? smooth(0.002, 0.007, gone) : smooth(FLAT - 0.0004, FLAT + 0.0012, Math.max(a, 1 - a));
    if (surface || this.reduced || (r.first && a < 0.5)) ink = 0;
    // (What counts on it has counted on: painted as it is now, just before it is needed.)
    const soon = a > FLAT - 0.05 && a < FLAT;
    if (soon && !r.fresh && r.offInk) freshen(r.card);
    r.fresh = soon;
    r.open = 1 - roll;
    // Rolled up, its box takes no touch: what is under it may (a phone's skeleton).
    if (!surface && r.rolled !== roll > 0.35) {
      r.rolled = roll > 0.35;
      if (r.rolled) r.card.dataset.rolled = "";
      else delete r.card.dataset.rolled;
    }
    // Its ball is the skeleton's now: nothing of it is drawn here.
    if (roll === 1 && this.handed(r, sy)?.ball) {
      if (!e.blank) e.renderer.clear();
      e.blank = true;
      if (!e.painted) r.card.dataset.gl = "on";
      e.painted = true;
      r.mAmt = 0;
      return;
    }

    // The cursor, in the card's own coordinates.
    // (Nothing is asked of the page here: each question makes the browser work its layout
    // out on the spot, 10 ms of a frame on a slow machine. A card in the present is where it
    // was laid out; a surface is asked for now and then while the pointer moves.)
    if (surface && (r.asked < 0 || (this.pLast > r.asked && this.pLast - r.asked > 400))) {
      r.asked = this.pLast;
      r.at = r.card.getBoundingClientRect();
    }
    const rect = surface ? r.at : { left: r.docLeft, top, width: r.w, height: r.h };
    const inX = this.px >= rect.left - 30 && this.px <= rect.left + rect.width + 30;
    const inY = this.py >= rect.top - 30 && this.py <= rect.top + rect.height + 30;
    // A finger does not hover: on touch the water answers a fresh touch and
    // settles a moment later, instead of rippling for ever round the last
    // place it was tapped.
    const fresh = this.pType === "mouse" || performance.now() - this.pLast < 900;
    const over = inX && inY && r.open > 0.9 && fresh;
    if (over) {
      r.mx = (this.px - rect.left) / rect.width;
      r.my = 1 - (this.py - rect.top) / rect.height;
    }
    r.mAmt += ((over ? 1 : 0) - r.mAmt) * (1 - Math.exp(-dt * 5));
    if (over) water.over = r.hue;
    const stirred = !this.reduced && roll === 0 && water.stirs(rect.left - 60, rect.top - 60, rect.width + 120, rect.height + 120);

    if (!surface && !this.reduced) this.dress(e, r);
    // Drawn every frame only while it winds, or the cursor is in it. The browser moves its
    // canvas; what is in it changes slowly: water at rest, half the frames; a ball that is
    // closed, a third.
    const every = !e.painted || e.blank || (roll > 0 && roll < 1) || (stirred && water.apart) ? 1 : roll === 1 ? 3 : 2;
    if ((this.tick + r.turn) % every !== 0) return;
    e.card.look({
      w: r.w,
      h: r.h,
      R: this.ballOf(r),
      radius: r.radius,
      roll,
      bend,
      show,
      t: this.t,
      seed: r.seed,
      spin: r.spin - 0.5,
      side: Math.max(0.5, way.side),
      mouse: [r.mx, r.my],
      mouseAmt: r.mAmt,
      stirred,
      place: [rect.left, rect.top],
      hue: r.hue,
      bright: this.brightAt(way.side),
      ink,
      surface,
      pull: smooth(shutAt(this.wide) - 0.05, shutAt(this.wide) - 0.005, Math.max(a, 1 - a)),
    });
    e.blank = false;

    e.renderer.render(e.card.scene, e.card.camera);
    if (!e.painted) {
      e.painted = true;
      r.card.dataset.gl = "on";
    }
  }

  private dispose(e: Entry) {
    this.entries = this.entries.filter((x) => x !== e);
    e.unguard();
    e.canvas.remove();
    e.card.dispose();
    e.words?.dispose();
    e.texture?.dispose();
    e.renderer.dispose();
    e.renderer.forceContextLoss();
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    giveGuests(null);
    document.fonts?.removeEventListener?.("loadingdone", this.onFonts);
    this.io.disconnect();
    this.ro.disconnect();
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("pointermove", this.onPointer);
    window.removeEventListener("pointerdown", this.onPointer);
    window.removeEventListener(THEME_EVENT, this.onTheme);
    window.removeEventListener(GL_LOST_EVENT, this.onGlLost);
    for (const e of this.entries) {
      e.unguard();
      e.canvas.remove();
      e.card.dispose();
      e.words?.dispose();
      e.texture?.dispose();
      e.renderer.dispose();
      e.renderer.forceContextLoss();
    }
    this.entries = [];
  }
}

let pool: Pool | null = null;

/** Give a card its WebGL look. Returns the function that takes it back. */
function ensurePool(): Pool {
  if (!pool) {
    pool = new Pool();
    pool.onEmpty = () => {
      // The last card and surface went: give the GPU back.
      const p = pool;
      pool = null;
      p?.destroy();
    };
  }
  return pool;
}

/** Give a non-orbiting element (the top bar, a popup, a menu) the cards' glass
 *  and water. `radius` is its corner radius in CSS px. */
export function registerSurface(el: HTMLElement, slot: HTMLElement, opts: { radius?: number; hue?: string } = {}): () => void {
  return ensurePool().add(el, slot, opts.hue ?? "var(--d-b)", "surface", opts.radius ?? 16);
}

export function registerCard(card: HTMLElement, slot: HTMLElement, hue = "var(--d-a)"): () => void {
  return ensurePool().add(card, slot, hue);
}
