// KAL's world: the one canvas that rides with the page, the light one carries, and the scenes.
//
// A scene (a React component's own) says what stands on its piece of the page, in page px; the
// world lays it out when the page's measures change, and draws what is in the window: every frame
// while something moves, thirty times a second for the flames, not at all when nobody can see it.

import { guardCanvas } from "../glGuard";
import { pageY } from "../scrollPos";
import { cutLetters } from "./letters";
import MAPS from "./map.json";
import { Stone, type Cut, type Laid, type Piece, type PieceMap, type Row } from "./stone";

export type PieceName = keyof typeof MAPS;

/** Where a scene's element lies on the page, and what the page is. */
export type Place = { x: number; y: number; w: number; h: number; vw: number; vh: number; dpr: number; phone: boolean };

export type Scene = {
  el: HTMLElement;
  laid: Laid[];
  front: Laid[];
  cuts: Cut[];
  rows: Row[];
  /** What stands where: asked again whenever the page's measures change. */
  lay: (p: Place, w: World) => void;
  /** Each frame it can be seen; true: something moved. */
  tick?: (t: number, dt: number, w: World) => boolean;
  /** Just before it is drawn. */
  drawn?: () => void;
  /** Its place, as last measured. */
  at?: Place;
};

export type CutLine = { text: string; x: number; y: number; font: string; spacing?: number; align?: CanvasTextAlign };

const MARGIN = 170;
const EYE: [number, number] = [34, 20];

export class World {
  stone: Stone | null = null;
  /** The light: where the hand is (client px) and where the flame is by now. */
  hand = { x: -1, y: -1, in: false };
  /** Somebody has moved it: until then it waits where the page put it. */
  carried = false;
  home: [number, number] = [0.5, 0.45];
  phone = false;
  reduced = false;
  dead = false;
  /** Something changed: draw. */
  dirty = true;
  private scenes: Scene[] = [];
  private pieces = new Map<string, Promise<Piece>>();
  private cutAt = new Map<string, { key: string; cut: Cut }>();
  private off: (() => void)[] = [];
  private root: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private tx = -1;
  private ty = -1;
  private vw = 0;
  private vh = 0;
  private dpr = 1;
  private lastY = -1;
  private lastDraw = 0;
  private began = 0;
  private eye: [number, number] = [0, 0];
  private measured = false;
  private onLive: ((live: boolean) => void) | null = null;

  add(s: Scene): () => void {
    this.scenes.push(s);
    this.measured = false;
    return () => {
      this.scenes = this.scenes.filter((x) => x !== s);
      this.measured = false;
    };
  }

  /** A piece of carving (once each). */
  piece(name: PieceName): Promise<Piece> {
    let p = this.pieces.get(name);
    if (!p) {
      p = this.stone ? this.stone.load(name, MAPS[name] as PieceMap) : Promise.reject(new Error("kal: no stone"));
      this.pieces.set(name, p);
    }
    return p;
  }

  /** Cut letters, made once for each size and text; their box is at (x, y) on the page, w × h px. */
  letters(id: string, lines: CutLine[], x: number, y: number, w: number, h: number): Cut | null {
    if (!this.stone) return null;
    const key = JSON.stringify([lines, Math.round(w * 10), Math.round(h * 10), this.dpr]);
    let c = this.cutAt.get(id);
    if (!c || c.key !== key) {
      const old = c?.cut;
      if (old) this.stone.forget(old.tex);
      const spread = 7;
      const sh = cutLetters(lines, w, h, Math.min(3, this.dpr * 1.3), spread);
      c = { key, cut: { tex: this.stone.sdf(sh.data, sh.w, sh.h), x, y, w, h, spread, wake: old?.wake ?? 0.6, pour: old?.pour ?? 1e5, from: 0 } };
      this.cutAt.set(id, c);
    }
    Object.assign(c.cut, { x, y, w, h, from: x });
    return c.cut;
  }

  async open(root: HTMLElement, canvas: HTMLCanvasElement, onLive: (live: boolean) => void): Promise<void> {
    this.root = root;
    this.canvas = canvas;
    this.onLive = onLive;
    this.dead = false;
    this.began = performance.now();
    this.phone = window.matchMedia("(pointer: coarse)").matches;
    this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.stone = new Stone(canvas, this.phone);
    this.off.push(
      guardCanvas(canvas, () => {
        this.dead = true;
        onLive(false);
      }),
    );
    await this.stone.boot();
    if (this.dead) return;
    const ro = new ResizeObserver(this.again);
    ro.observe(root);
    this.off.push(() => ro.disconnect());
    const on = <K extends keyof WindowEventMap>(k: K, f: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(k, f, { passive: true });
      this.off.push(() => window.removeEventListener(k, f));
    };
    const to = (e: PointerEvent) => {
      this.hand = { x: e.clientX, y: e.clientY, in: true };
      this.carried = true;
    };
    on("resize", this.again);
    on("pointermove", (e) => {
      if (e.pointerType !== "touch" || this.hand.in) to(e);
    });
    on("pointerdown", to);
    const gone = (e: PointerEvent) => {
      if (e.pointerType === "touch") this.hand.in = false;
    };
    on("pointerup", gone);
    on("pointercancel", gone);
    void document.fonts?.ready.then(this.again);
    let raf = 0;
    const loop = (now: number) => {
      if (this.dead) return;
      this.frame(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    this.off.push(() => cancelAnimationFrame(raf));
    onLive(true);
  }

  private measure() {
    const root = this.root!;
    const r = root.getBoundingClientRect();
    this.vw = root.clientWidth;
    this.vh = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.phone ? 2.75 : 2);
    for (const s of this.scenes) {
      const b = s.el.getBoundingClientRect();
      s.at = { x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height, vw: this.vw, vh: this.vh, dpr: this.dpr, phone: window.matchMedia("(max-width: 1023px)").matches };
      s.lay(s.at, this);
    }
    const c = this.canvas!;
    c.style.width = `${this.vw}px`;
    c.style.height = `${this.vh + MARGIN * 2}px`;
    this.measured = true;
    this.dirty = true;
  }

  /** Something has come (a piece, a font), or the page has changed: lay it out again. */
  again = () => {
    this.measured = false;
  };

  private frame(now: number) {
    const st = this.stone;
    // (Behind a popup, which holds the page still, nothing of it is seen.)
    if (!st || document.hidden || document.documentElement.style.overflow === "hidden") return;
    if (!this.measured) this.measure();
    const t = (now - this.began) / 1000;
    const y = pageY();
    const scrolling = Math.abs(y - this.lastY) > 0.2;
    const dt = Math.min(0.1, (now - this.lastDraw) / 1000);
    // The light.
    const free = !this.hand.in && (this.phone || !this.carried);
    const gx = free ? this.vw * (this.home[0] + 0.05 * Math.sin(t * 0.37)) : this.hand.x;
    const gy = free ? this.vh * (this.home[1] + 0.04 * Math.sin(t * 0.53 + 1)) : this.hand.y;
    if (this.tx < 0) {
      this.tx = gx;
      this.ty = gy;
    }
    const k = 1 - Math.pow(0.5, dt / (free ? 0.4 : 0.07));
    const px = this.tx;
    const py = this.ty;
    this.tx += (gx - this.tx) * k;
    this.ty += (gy - this.ty) * k;
    let moving = scrolling || this.dirty || Math.abs(this.tx - px) + Math.abs(this.ty - py) > 0.4;
    // The scenes in the window.
    const near = this.scenes.filter((s) => s.at && s.at.y < y + this.vh + MARGIN && s.at.y + s.at.h > y - MARGIN);
    for (const s of near) if (s.tick?.(t, dt, this)) moving = true;
    if (!moving && (this.reduced || now - this.lastDraw < 31)) return;
    this.lastY = y;
    this.dirty = false;
    for (const s of near) s.drawn?.();
    st.laid = near.flatMap((s) => s.laid);
    st.front = near.flatMap((s) => s.front);
    st.cuts = near.flatMap((s) => s.cuts);
    st.rows = near.flatMap((s) => s.rows);
    const u = this.reduced ? 0 : 1.4;
    st.torch.x = this.tx + u * Math.sin(t * 7.1);
    st.torch.y = this.ty + y + u * Math.sin(t * 8.7);
    st.torch.on = 1;
    const e = this.eye;
    const ek = 1 - Math.pow(0.5, dt / 0.35);
    e[0] += ((0.5 - this.tx / Math.max(1, this.vw)) * 2 * EYE[0] - e[0]) * ek;
    e[1] += ((0.5 - this.ty / Math.max(1, this.vh)) * 2 * EYE[1] - e[1]) * ek;
    st.eye = [e[0], e[1]];
    const top = y - MARGIN;
    this.canvas!.style.transform = `translate3d(0, ${top.toFixed(2)}px, 0)`;
    const spare = scrolling ? 0 : MARGIN - 70;
    st.draw([0, top], this.vw, this.vh + MARGIN * 2, this.dpr, t, spare, spare);
    this.lastDraw = now;
  }

  close() {
    this.dead = true;
    this.off.forEach((f) => f());
    this.off = [];
    this.onLive?.(false);
    this.stone?.dispose();
    this.stone = null;
    this.pieces.clear();
    this.cutAt.clear();
  }
}
