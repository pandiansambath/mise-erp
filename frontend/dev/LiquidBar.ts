"use client";

// The top menu, poured.
//
//   "still I don't accept this top menu bar… still not realistically suiting
//    the UI… not adapting to the UI perfectly… think in a unique way for this…
//    any new animation too for the top menu bar" (23 Nov)
//
// There is no bar. The buttons float as drops of the cards' own water — the
// theme's painted texture drifting inside, a rim of the theme's colours, light
// catching the upper edge — and surface tension merges them into one capsule
// (a smooth union of rounded boxes, drawn as a signed distance field):
//
//   · arriving, each drop falls in from above, one after another, and merges;
//   · the drop under the cursor swells, its neighbours a little — the same
//     swell the letters have;
//   · near the pointer the liquid's edge reaches out towards it, a bulge
//     that stretches after the cursor and lets go when it moves away;
//   · a click squashes the drop and sends a ring through the liquid;
//   · a fast scroll pulls the capsule apart into separate beads that bob, and
//     they flow back together when the page comes to rest;
//   · his name pours out of the PS drop as a capsule of its own, only when the
//     big nameplate is off the screen.
//
// One small WebGL canvas the width of the screen behind the buttons; every
// element marked data-liquid in the header is a drop. Raw WebGL — one
// fullscreen triangle and one fragment shader, no three.js. Pixels far from
// every drop leave after one look at the field, so it costs little; it runs at
// half rate when nothing is moving and stops when the tab is hidden.

import { paintLiquid } from "./liquid";
import { readRGB, THEME_EVENT } from "./theme";

const MAX = 12;

const FRAG = /* glsl */ `
precision highp float;
uniform vec2 uRes;
uniform vec4 uBox[${MAX}];
uniform float uRad[${MAX}];
uniform float uLand[${MAX}];
uniform int uCount;
uniform vec4 uBar;
uniform float uBarRad;
uniform float uBarOn;
uniform float uK;
uniform vec4 uMouse;
uniform float uTime;
uniform sampler2D uLiquid;
uniform float uHasTex;
uniform vec3 uGlass, uRimA, uRimB, uHi;
uniform float uLight;
varying vec2 vUv;

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
// The texture is 200 px — not a power of two, so WebGL 1 will not repeat it:
// mirror it here instead (seamless, whatever the painting).
vec2 mirror(vec2 u) { return 1.0 - abs(mod(u, 2.0) - 1.0); }
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}
float field(vec2 p) {
  float d = 1e5;
  if (uBarOn > 0.001) d = sdBox(p - uBar.xy, uBar.zw, uBarRad);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    vec4 b = uBox[i];
    if (b.z <= 0.01) continue;
    d = smin(d, sdBox(p - b.xy, b.zw, uRad[i]), uK);
  }
  // The liquid reaches for the cursor: a bulge drawn out of the nearest edge.
  if (uMouse.z > 0.01) d = smin(d, length(p - uMouse.xy) - uMouse.z, uMouse.w);
  // A living surface: a slow ripple along the edge.
  d += 0.55 * sin(p.x * 0.07 + uTime * 1.3) * sin(p.y * 0.11 - uTime * 0.9);
  return d;
}
void main() {
  vec2 p = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
  float d = field(p);
  // Far from every drop: nothing here (and nothing more to work out).
  if (d > 26.0) { gl_FragColor = vec4(0.0); return; }
  float inside = smoothstep(0.75, -0.75, d);
  // A soft shadow below, so it floats.
  float sd = field(p - vec2(0.0, 5.0));
  // (Faded out before the cut-off above, or a pale theme shows its edge.)
  float sh = 0.32 * exp(-max(sd, 0.0) / 8.0) * (1.0 - inside) * (1.0 - smoothstep(14.0, 25.0, d));
  vec2 e = vec2(1.0, 0.0);
  vec2 n = normalize(vec2(field(p + e.xy) - field(p - e.xy), field(p + e.yx) - field(p - e.yx)) + 1e-4);
  float edge = smoothstep(-11.0, 0.0, d);
  // The water inside, bent near the edge as through a drop.
  vec2 uv = p / 230.0 + n * edge * 0.05;
  vec3 water = vec3(0.0);
  float wA = 0.0;
  if (uHasTex > 0.5) {
    vec4 A = texture2D(uLiquid, mirror(uv + vec2(uTime * 0.012, -uTime * 0.008)));
    vec4 B = texture2D(uLiquid, mirror(-uv * 0.86 + vec2(-uTime * 0.01, uTime * 0.013)));
    water = 1.0 - (1.0 - A.rgb * A.a) * (1.0 - B.rgb * B.a * 0.6);
    wA = clamp(max(A.a, B.a * 0.6) * 1.3, 0.0, 1.0);
  }
  vec3 col = mix(uGlass, uGlass * 0.55 + water, 0.5 * wA);
  // A rim of the theme's colours, along the edge.
  vec3 rim = mix(uRimA, uRimB, clamp(p.x / uRes.x, 0.0, 1.0));
  col += rim * pow(edge, 3.0) * 0.6;
  // Light on the upper edge, the way it sits on a drop.
  col += uHi * pow(max(0.0, -n.y), 3.0) * pow(edge, 2.0) * 0.55;
  // A sheen that sweeps across now and then.
  float sweep = mod(uTime * 260.0, uRes.x + 1400.0) - 300.0;
  col += uHi * 0.16 * exp(-pow((p.x - sweep + (p.y - 30.0) * 0.6) / 26.0, 2.0)) * (1.0 - edge * 0.6);
  // Each drop, as it lands, sends a ring out through the liquid.
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= uCount) break;
    float age = uTime - uLand[i];
    if (age < 0.0 || age > 1.2) continue;
    float rr = length(p - uBox[i].xy);
    col += mix(uRimB, vec3(1.0), 0.3) * exp(-pow((rr - (6.0 + age * 46.0)) / 2.6, 2.0)) * exp(-age * 3.0) * 0.8;
  }
  float a = inside * mix(0.88, 0.82, uLight);
  gl_FragColor = vec4(col * a, a) + vec4(0.0, 0.0, 0.0, sh);
}`;

const VERT = /* glsl */ `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

type Drop = {
  el: HTMLElement;
  name: boolean;
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  rad: number;
  swell: number;
  swellV: number;
  hover: boolean;
  fall: number;
  fallV: number;
  delay: number;
  /** When it landed (a ring runs out from it). */
  landAt: number;
};

const spring = (x: number, v: number, target: number, k: number, damp: number, dt: number): [number, number] => {
  const a = (target - x) * k - v * damp;
  v += a * dt;
  x += v * dt;
  return [x, v];
};

export class LiquidBar {
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private tex: WebGLTexture | null = null;
  private hasTex = false;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private drops: Drop[] = [];
  private raf = 0;
  private dead = false;
  private t = 0;
  private prev = performance.now();
  private w = 1;
  private h = 1;
  private dpr = 1;
  private mouse = { x: -999, y: -999, s: 0, sv: 0 };
  /** The bulge that reaches for the cursor: where it is, and its velocity. */
  private reach = { x: -999, y: -999, vx: 0, vy: 0, r: 0, k: 0 };
  private sep = 0;
  private sepV = 0;
  private lastY = 0;
  /** Pixels scrolled since the last frame, and the scroll's smoothed speed
   *  (px/s): only a fast flick parts the capsule — a reading scroll does
   *  not (anything it did on every scroll would read as unsteady). */
  private scrolled = 0;
  private speed = 0;
  private nameOn = 0;
  private nameV = 0;
  private nameWant = 0;
  private entered = false;
  private enterAt = 0;
  private skip = false;
  private colors = { glass: [0.05, 0.07, 0.1], rimA: [0.94, 0.63, 0.39], rimB: [0.49, 0.94, 0.86], hi: [0.9, 0.95, 1], light: 0 };
  private ro: ResizeObserver;
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private canvas: HTMLCanvasElement,
    private host: HTMLElement,
  ) {
    this.ro = new ResizeObserver(() => this.measure());
    this.ro.observe(host);
  }

  /** False without WebGL: the header then gives the buttons plain glass. */
  init(): boolean {
    const gl = this.canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: false });
    if (!gl) return false;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["uRes", "uBox", "uRad", "uLand", "uCount", "uBar", "uBarRad", "uBarOn", "uK", "uMouse", "uTime", "uLiquid", "uHasTex", "uGlass", "uRimA", "uRimB", "uHi", "uLight"]) {
      this.loc[n] = gl.getUniformLocation(prog, n);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.tex = gl.createTexture();
    this.paint();
    this.measure();
    window.addEventListener(THEME_EVENT, this.onTheme);
    window.addEventListener("pointermove", this.onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onLeave);
    window.addEventListener("scroll", this.onScroll, { passive: true });
    this.lastY = window.scrollY;
    this.raf = requestAnimationFrame(this.loop);
    return true;
  }

  /** The intro has been passed: the drops fall in. */
  enter() {
    if (this.entered) return;
    this.entered = true;
    this.enterAt = this.t;
  }

  /** His name's capsule: poured out (true) or drawn back in. */
  setName(on: boolean) {
    this.nameWant = on ? 1 : 0;
  }

  private onTheme = () => window.setTimeout(() => this.paint(), 140);

  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    const r = this.host.getBoundingClientRect();
    this.mouse.x = e.clientX - r.left;
    this.mouse.y = e.clientY - r.top;
  };

  private onLeave = () => {
    this.mouse.x = this.mouse.y = -999;
  };

  private onScroll = () => {
    const y = window.scrollY;
    this.scrolled += Math.abs(y - this.lastY);
    this.lastY = y;
  };

  private paint() {
    const gl = this.gl;
    if (!gl) return;
    const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
    const c = (role: string, fb: [number, number, number]) => readRGB(root, role, fb).map((v) => v / 255);
    const [br, bg, bb] = readRGB(root, "bg", [7, 10, 15]);
    this.colors = {
      glass: c("bg2", [11, 17, 24]),
      rimA: c("a2", [240, 160, 100]),
      rimB: c("b2", [125, 240, 220]),
      hi: c("ink", [230, 237, 245]),
      light: (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255 > 0.5 ? 1 : 0,
    };
    const url = paintLiquid(root);
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      if (this.dead || !this.gl || !this.tex) return;
      const g = this.gl;
      g.bindTexture(g.TEXTURE_2D, this.tex);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      // Not a power of two: clamp here, and the shader mirrors it.
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      this.hasTex = true;
    };
    img.src = url;
  }

  /** An element's layout box in the header's coordinates — offsets, not
   *  getBoundingClientRect, so the icons' arrival pop (a scale) does not
   *  shrink their drops. */
  private boxOf(el: HTMLElement): { x: number; y: number; w: number; h: number } {
    let x = 0;
    let y = 0;
    let n: HTMLElement | null = el;
    while (n && n !== this.host) {
      x += n.offsetLeft;
      y += n.offsetTop;
      n = n.offsetParent as HTMLElement | null;
    }
    return { x, y, w: el.offsetWidth, h: el.offsetHeight };
  }

  /** Where every drop sits, from the layout (the header's own coordinates). */
  measure() {
    this.w = Math.max(1, this.host.offsetWidth);
    this.h = Math.max(1, this.host.offsetHeight);
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    const old = new Map(this.drops.map((d) => [d.el, d]));
    const els = [...this.host.querySelectorAll<HTMLElement>("[data-liquid]")].slice(0, MAX);
    // The arrival order skips his name (it pours out, it does not fall).
    let order = 0;
    this.drops = els.map((el) => {
      const isName = el.dataset.liquid === "name";
      const b = this.boxOf(el);
      const keep = old.get(el);
      const hx = b.w / 2;
      const hy = b.h / 2;
      const d: Drop = keep ?? {
        el,
        name: isName,
        cx: 0,
        cy: 0,
        hx: 0,
        hy: 0,
        rad: 0,
        swell: 0,
        swellV: 0,
        hover: false,
        fall: this.reduced ? 0 : 1,
        fallV: 0,
        // Its place in the arrival: TopBar's pop(i) for its icon, which
        // pops as the drop lands (about 0.22 s after it starts to fall).
        delay: (isName ? 0 : order) * 0.07,
        landAt: -9,
      };
      d.cx = b.x + hx;
      d.cy = b.y + hy;
      d.hx = hx;
      d.hy = hy;
      d.rad = Math.min(hx, hy, Number(el.dataset.liquidRadius ?? 999));
      if (!keep) {
        el.addEventListener("pointerenter", () => (d.hover = true));
        el.addEventListener("pointerleave", () => (d.hover = false));
        // A click squashes the drop and sends a ring through the liquid.
        el.addEventListener("pointerdown", () => {
          d.swellV -= 34;
          d.landAt = this.t;
        });
      }
      if (!isName) order++;
      return d;
    });
  }

  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    const gl = this.gl;
    if (!gl || !this.prog || document.hidden) return;
    // Real time, in steps of at most 1/60 s: on a busy page (the entry is
    // the busiest moment) a slow frame rate must not let the drops fall
    // behind their icons, which pop on the clock (CSS).
    const real = Math.min(0.25, Math.max(0, (now - this.prev) / 1000));
    this.prev = now;
    const steps = Math.max(1, Math.ceil(real * 60));
    const dt = real / steps;
    // The scroll's speed: rises quickly with a flick, settles more slowly.
    const inst = real > 0 ? Math.min(8000, this.scrolled / real) : 0;
    this.scrolled = 0;
    this.speed += (inst - this.speed) * (1 - Math.exp(-real * (inst > this.speed ? 14 : 5)));
    // Merged below ~900 px/s (reading); fully parted from ~2700 (a flick).
    const sepTarget = this.reduced ? 0 : Math.min(1, Math.max(0, (this.speed - 900) / 1800));
    let busy = false;
    // The pointer near the drops: the liquid reaches only for a cursor that
    // comes close to it (no stray drop trailing the mouse across the screen).
    let gap = 1e9;
    let ex = 0;
    let ey = 0;
    for (const d of this.drops) {
      if (d.hx <= 0 || (d.name && this.nameOn < 0.5)) continue;
      const qx = Math.abs(this.mouse.x - d.cx) - d.hx;
      const qy = Math.abs(this.mouse.y - d.cy) - d.hy;
      const g = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
      if (g < gap) {
        gap = g;
        // The nearest point of its edge.
        ex = Math.min(d.cx + d.hx, Math.max(d.cx - d.hx, this.mouse.x));
        ey = Math.min(d.cy + d.hy, Math.max(d.cy - d.hy, this.mouse.y));
      }
    }
    const near = this.reduced || gap < 0 ? 0 : gap < 10 ? 1 : gap > 46 ? 0 : (46 - gap) / 36;
    // The bulge: drawn out of that edge towards the cursor, never so far that
    // it parts from the liquid (its neck stays inside the softness).
    const len = Math.hypot(this.mouse.x - ex, this.mouse.y - ey) || 1;
    const out = Math.min(Math.max(gap, 0) * 0.45, 12);
    const tx = ex + ((this.mouse.x - ex) / len) * out;
    const ty = ey + ((this.mouse.y - ey) / len) * out;
    if (this.reach.x < -900 || this.mouse.s < 0.02) {
      this.reach.x = tx;
      this.reach.y = ty;
    }
    for (let i = 0; i < steps; i++) {
      this.t += dt;
      // Scroll pulls the capsule apart into beads; at rest they flow back.
      [this.sep, this.sepV] = spring(this.sep, this.sepV, sepTarget, 60, 11, dt);
      [this.mouse.s, this.mouse.sv] = spring(this.mouse.s, this.mouse.sv, near, 90, 14, dt);
      [this.reach.x, this.reach.vx] = spring(this.reach.x, this.reach.vx, tx, 220, 18, dt);
      [this.reach.y, this.reach.vy] = spring(this.reach.y, this.reach.vy, ty, 220, 18, dt);
      [this.nameOn, this.nameV] = spring(this.nameOn, this.nameV, this.nameWant, 70, 12, dt);
      for (const d of this.drops) {
        // Falling in on arrival, one after another.
        const start = this.entered && this.t - this.enterAt > d.delay ? 0 : 1;
        [d.fall, d.fallV] = spring(d.fall, d.fallV, this.reduced ? 0 : start, 120, 13, dt);
        if (d.landAt < 0 && start === 0 && d.fall < 0.04) d.landAt = this.t;
        [d.swell, d.swellV] = spring(d.swell, d.swellV, d.hover ? 1 : 0, 160, 12, dt);
      }
    }
    this.reach.r = (4 + 3 * near) * Math.min(1, this.mouse.s * 1.5);
    this.reach.k = 10 + 8 * near;
    if (Math.abs(this.sepV) > 0.01 || this.sep > 0.01 || Math.abs(this.nameV) > 0.01 || this.mouse.s > 0.02) busy = true;
    for (const d of this.drops) if (Math.abs(d.fallV) > 0.01 || Math.abs(d.swellV) > 0.01 || this.t - d.landAt < 1.3) busy = true;
    const boxes = new Float32Array(MAX * 4);
    const rads = new Float32Array(MAX);
    const lands = new Float32Array(MAX).fill(-9);
    let minX = 1e9;
    let maxX = -1e9;
    let barY = 0;
    let barH = 0;
    let navCount = 0;
    this.drops.forEach((d, i) => {
      const neighbour = this.drops.reduce((m, o, j) => (o.hover && Math.abs(j - i) === 1 ? 1 : m), 0);
      const grow = Math.max(-6, d.swell * 5 + neighbour * 1.6);
      const bob = Math.sin(this.t * 7 + i * 1.3) * 3 * this.sep;
      const scale = d.name ? this.nameOn : 1;
      // His name grows out of the PS drop: anchored at its left edge.
      const hx = Math.max(0, (d.hx + grow) * scale);
      const cx = d.name ? d.cx - d.hx + hx : d.cx;
      boxes[i * 4] = cx;
      boxes[i * 4 + 1] = d.cy - d.fall * (d.cy + 60) + bob;
      boxes[i * 4 + 2] = d.name && scale < 0.02 ? 0 : hx;
      boxes[i * 4 + 3] = d.hy + grow;
      rads[i] = Math.min(d.rad + grow, d.hy + grow);
      lands[i] = d.landAt;
      if (!d.name && d.el.closest("nav")) {
        minX = Math.min(minX, d.cx - d.hx);
        maxX = Math.max(maxX, d.cx + d.hx);
        barY = d.cy;
        barH = Math.max(barH, d.hy);
        navCount++;
      }
    });
    // Every other frame when nothing is moving: the slow ripple needs no more.
    if (!busy) {
      this.skip = !this.skip;
      if (this.skip) return;
    }
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const L = this.loc;
    gl.uniform2f(L.uRes, this.w, this.h);
    gl.uniform4fv(L.uBox, boxes);
    gl.uniform1fv(L.uRad, rads);
    gl.uniform1fv(L.uLand, lands);
    gl.uniform1i(L.uCount, this.drops.length);
    // The capsule's floor joining the drops, thinning as they part.
    const allIn = this.drops.every((d) => d.name || d.fall < 0.05) ? 1 : 0;
    const barOn = navCount > 1 ? (1 - this.sep) * allIn : 0;
    gl.uniform4f(L.uBar, (minX + maxX) / 2, barY, Math.max(0, (maxX - minX) / 2 - 6), Math.max(0, barH - 3) * (1 - this.sep * 0.9));
    gl.uniform1f(L.uBarRad, Math.max(0, barH - 3));
    gl.uniform1f(L.uBarOn, barOn);
    gl.uniform1f(L.uK, 12 - this.sep * 9);
    gl.uniform4f(L.uMouse, this.reach.x, this.reach.y, this.mouse.s > 0.02 ? this.reach.r : 0, this.reach.k);
    gl.uniform1f(L.uTime, this.reduced ? 0 : this.t);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(L.uLiquid, 0);
    gl.uniform1f(L.uHasTex, this.hasTex ? 1 : 0);
    const k = this.colors;
    gl.uniform3fv(L.uGlass, k.glass);
    gl.uniform3fv(L.uRimA, k.rimA);
    gl.uniform3fv(L.uRimB, k.rimB);
    gl.uniform3fv(L.uHi, k.hi);
    gl.uniform1f(L.uLight, k.light);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  dispose() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    window.removeEventListener(THEME_EVENT, this.onTheme);
    window.removeEventListener("pointermove", this.onMove);
    document.documentElement.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("scroll", this.onScroll);
    const gl = this.gl;
    if (gl) {
      if (this.tex) gl.deleteTexture(this.tex);
      if (this.prog) gl.deleteProgram(this.prog);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
}
