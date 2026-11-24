"use client";

// The site opens by itself (§103.10).
//
//   "no need [of an] enter button, instead open [the] site automatically whenever
//    loading is completed… have a best transition when opening [the] site"
//
// What stands on the door — the lines, the bar, the count — trembles, goes to dust and
// falls, swirling, into one point, and the dust of the dark with it. A breath. Then the
// point BURSTS, and the burst is the way in: a shock front of fire runs out over the
// screen and the page is there inside it, gas and spikes and streaks flying past you;
// and the dust that hangs there afterwards spirals home into the galaxy at the head of
// the skeleton, which forms out of it (where no galaxy is in sight: into the portrait).
//
// It was drawn on a 2D canvas first. Two thousand small lines and grains a frame are two
// thousand commands a frame, 25 ms of them on his laptop, and it stuttered; so here every
// grain is moved by the graphics itself (openingArt.ts), a dozen commands a frame, and the
// processor is left to the page. One WebGL canvas, given back the moment the opening is
// over — or at once, if the browser takes one of the page's away while it waits (a phone
// keeps only a few): the page needs it more, and the door then simply fades.

import { GL_LOST_EVENT } from "./glGuard";
import { attributes, ATTRS, FS, VS, type Kind } from "./openingArt";
import { heartSpot, type Spot } from "./stage";

export type RGB = [number, number, number];
export type Tints = { a: RGB; a2: RGB; b2: RGB; c: RGB; gold: RGB; bg: RGB; light: boolean };

export type Opening = {
  /** How much of the page has come, 0–1. */
  progress(p: number): void;
  /** Whether everything it draws with is built. */
  ready(): boolean;
  /** All of it is here: what stands in `words` goes to dust and falls in. */
  fall(words: HTMLElement): void;
  /** Straight to the point of light (the door has opened before in this visit), where it
   *  waits for the page for as long as `wait` seconds. */
  point(wait: number): void;
  /** Whoever is at the door is impatient. */
  hurry(): void;
  dispose(): void;
};
export type OpeningEvents = {
  /** The words are dust now: take them off the door. */
  gone(): void;
  /** All of it is one point: the page may change behind the dark. */
  dark(): void;
  /** It bursts. */
  bang(): void;
  done(): void;
  /** The graphics were taken away: open some other way. */
  lost(): void;
};

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const TAU = Math.PI * 2;

// The clock, in seconds: the fall; the least a breath lasts, and the most it waits for
// the page to be there; the front's whole run; all of it.
const FALL = 0.86;
const BREATH = 0.2;
const WAIT = 1.2;
const RUN = 1.75;
const LAST = 4.1;

// ── the words on the door, as dust ───────────────────────────────────────────

/** Every dot of ink in `words`: where it stands about `cx`, `cy`, when it lets go, how
 *  far round it swings, its colour and how strong it is (eight numbers each). */
function dustOf(words: HTMLElement, cx: number, cy: number, cap: number): Float32Array {
  const none = new Float32Array(0);
  const box = words.getBoundingClientRect();
  const w = Math.ceil(box.width);
  const h = Math.ceil(box.height);
  if (w < 2 || h < 2) return none;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d", { willReadFrequently: true });
  if (!g) return none;
  g.textBaseline = "alphabetic";
  const range = document.createRange();
  const walk = document.createTreeWalker(words, NodeFilter.SHOW_TEXT);
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    const el = node.parentElement;
    const text = node.nodeValue ?? "";
    if (!el || !text.trim()) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || Number(cs.opacity) < 0.05) continue;
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    g.fillStyle = cs.color;
    const m = g.measureText("Hg");
    const up = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
    const down = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === " ") continue;
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const q = range.getBoundingClientRect();
      if (q.width > 0) g.fillText(text[i], q.left - box.left, q.top - box.top + (q.height - up - down) / 2 + up);
    }
  }
  // …and what is drawn there: the bar.
  for (const el of words.querySelectorAll<HTMLElement>("[data-ink]")) {
    const q = el.getBoundingClientRect();
    const gr = g.createLinearGradient(q.left - box.left, 0, q.right - box.left, 0);
    const cs = getComputedStyle(el);
    try {
      gr.addColorStop(0, cs.getPropertyValue("--tw-gradient-from").trim() || "#fff");
      gr.addColorStop(1, cs.getPropertyValue("--tw-gradient-to").trim() || "#fff");
    } catch {
      gr.addColorStop(0, "#fff");
    }
    g.fillStyle = gr;
    g.fillRect(q.left - box.left, q.top - box.top, q.width, Math.max(2, q.height));
  }
  const data = g.getImageData(0, 0, w, h).data;
  let at: number[] = [];
  for (let k = 0; k < w * h; k++) if (data[k * 4 + 3] > 64) at.push(k);
  if (at.length > cap) at = at.filter(() => Math.random() < cap / at.length);
  let far = 1;
  for (const k of at) far = Math.max(far, Math.hypot(box.left + (k % w) - cx, box.top + Math.floor(k / w) - cy));
  const out = new Float32Array(at.length * 8);
  at.forEach((k, i) => {
    const x = box.left + (k % w) + 0.5 - cx;
    const y = box.top + Math.floor(k / w) + 0.5 - cy;
    const away = Math.hypot(x, y) / far;
    // The nearest go first; each by its own little while.
    out.set([x, y, 0.1 + 0.28 * away + Math.random() * 0.12, 1.5 + Math.random() * 1.3 + 0.8 * (1 - away), data[k * 4] / 255, data[k * 4 + 1] / 255, data[k * 4 + 2] / 255, (0.35 + 0.65 * (data[k * 4 + 3] / 255)) * (0.9 + Math.random() * 0.2)], i * 8);
  });
  return out;
}

// ── the opening itself ───────────────────────────────────────────────────────

type Piece = { prog: WebGLProgram; at: Map<string, WebGLUniformLocation | null>; sizes: number[]; stride: number };
type Mesh = { buf: WebGLBuffer; n: number };

export function makeOpening(cv: HTMLCanvasElement, t: Tints, on: OpeningEvents, phone: boolean): Opening | null {
  const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" };
  const got = (cv.getContext("webgl2", opts) ?? cv.getContext("webgl", opts)) as WebGLRenderingContext | null;
  if (!got) return null;
  const gl: WebGLRenderingContext = got;
  let dead = false;
  let raf = 0;
  const taken = () => {
    if (dead) return;
    stop();
    on.lost();
  };
  const crowded = () => {
    if (mode === "load") taken();
  };
  cv.addEventListener("webglcontextlost", taken);
  window.addEventListener(GL_LOST_EVENT, crowded);

  let W = 1;
  let H = 1;
  let far = 1;
  const dpr = Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.25);

  // ── the programs: all asked for at once, waited for only when they are needed ──
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const pieces = {} as Record<Kind, Piece>;
  for (const k of Object.keys(VS) as Kind[]) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS[k]));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS[k]));
    ATTRS[k].forEach(([name], i) => gl.bindAttribLocation(prog, i, name));
    gl.linkProgram(prog);
    const sizes = ATTRS[k].map(([, n]) => n);
    pieces[k] = { prog, at: new Map(), sizes, stride: sizes.reduce((x, y) => x + y, 0) };
  }
  const par = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  let built = false;
  /** Whether they are all ready (never waits, where the browser can say). */
  const ready = () => {
    if (built) return true;
    if (par) for (const p of Object.values(pieces)) if (!gl.getProgramParameter(p.prog, par.COMPLETION_STATUS_KHR)) return false;
    built = Object.values(pieces).every((p) => gl.getProgramParameter(p.prog, gl.LINK_STATUS));
    if (!built && !gl.isContextLost()) {
      // A graphics driver that will not have it: the door fades instead.
      stop();
      on.lost();
    }
    return built;
  };

  const mesh = (data: Float32Array, stride: number, old?: Mesh): Mesh => {
    const buf = old?.buf ?? gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return { buf, n: data.length / stride };
  };
  let using: Piece = pieces.blit;
  const take = (k: Kind) => {
    using = pieces[k];
    gl.useProgram(using.prog);
  };
  const u = (name: string, ...v: number[]) => {
    let loc = using.at.get(name);
    if (loc === undefined) using.at.set(name, (loc = gl.getUniformLocation(using.prog, name)));
    if (loc === null) return;
    if (v.length === 1) gl.uniform1f(loc, v[0]);
    else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]);
    else gl.uniform4f(loc, v[0], v[1], v[2], v[3]);
  };
  const draw = (m: Mesh, how: number) => {
    if (!m.n) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, m.buf);
    let off = 0;
    for (let i = 0; i < 6; i++) {
      if (i < using.sizes.length) {
        gl.enableVertexAttribArray(i);
        gl.vertexAttribPointer(i, using.sizes[i], gl.FLOAT, false, using.stride * 4, off * 4);
        off += using.sizes[i];
      } else gl.disableVertexAttribArray(i);
    }
    gl.drawArrays(how, 0, m.n);
  };

  // The colours, 0–1.
  const one = (c: RGB): [number, number, number] => [c[0] / 255, c[1] / 255, c[2] / 255];
  const bg = one(t.bg);
  const hot: [number, number, number] = t.light ? one(t.a) : [1, 0.965, 0.88];
  const tint = { a: one(t.a), a2: one(t.a2), b2: one(t.b2), c: one(t.c), gold: one(t.gold) };
  const colours = () => {
    u("uHot", ...hot);
    u("uGold", ...tint.gold);
    u("uA", ...tint.a);
    u("uA2", ...tint.a2);
    u("uB2", ...tint.b2);
    u("uC", ...tint.c);
    u("uLit", t.light ? 1 : 0);
    u("uHalf", W / 2, H / 2);
    u("uPx", dpr);
  };

  // ── what there is of everything ──
  const sheet = mesh(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), 2);
  const bent = [Math.random() * TAU, Math.random() * TAU, Math.random() * TAU];
  let lanes: Mesh = { buf: gl.createBuffer()!, n: 0 };
  let grains: Mesh = { buf: gl.createBuffer()!, n: 0 };

  // The soft part of the burst (the dark, the front's fire, gas, the flash) is drawn at
  // half the sharpness and laid over the page: nothing in it has an edge.
  const soft = gl.createFramebuffer()!;
  const softTex = gl.createTexture()!;
  let sw = 1;
  let shh = 1;
  const fit = () => {
    W = window.innerWidth;
    H = window.innerHeight;
    far = Math.hypot(W, H) / 2;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    sw = Math.max(2, Math.round(W * dpr * 0.5));
    shh = Math.max(2, Math.round(H * dpr * 0.5));
    gl.bindTexture(gl.TEXTURE_2D, softTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, shh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, soft);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, softTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  fit();
  // The sheet of cloud the fire and the gas are cut from.
  const CLOUD = phone ? 256 : 512;
  const cloud = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, cloud);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CLOUD, CLOUD, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const paintCloud = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, soft);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cloud, 0);
    gl.viewport(0, 0, CLOUD, CLOUD);
    gl.disable(gl.BLEND);
    take("noise");
    draw(sheet, gl.TRIANGLES);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, softTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };
  const reach = Math.min(Math.max(W, H) * 0.62, 900);
  let moteData = attributes.motes(phone ? 90 : 220, far);
  let motes = mesh(moteData, pieces.motes.stride);
  const rays = mesh(attributes.rays(phone ? 34 : 64, phone ? 130 : 300, phone ? 120 : 260), pieces.rays.stride);
  const shell = mesh(attributes.shell(phone ? 120 : 220, phone ? 2 : 3), pieces.shell.stride);
  const grown = attributes.dust(phone ? 520 : 1300, reach, W > H);
  const dust = mesh(grown.points, pieces.dust.stride);
  const tails = mesh(grown.tails, pieces.tails.stride);
  const onResize = () => {
    fit();
    if (mode !== "load") return;
    moteData = attributes.motes(phone ? 90 : 220, far);
    motes = mesh(moteData, pieces.motes.stride, motes);
  };
  window.addEventListener("resize", onResize);

  let last = 0;
  let mode: "load" | "fall" | "breath" | "bang" = "load";
  let clock = 0;
  let time = 0;
  let much = 0;
  let wantMuch = 0;
  let drift = 0;
  let haste = 1;
  let patience = WAIT;
  let quiet = 0;
  let told = false;
  let half = false;

  const begin = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    // Premultiplied; a light with no alpha of its own is simply added.
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  };

  const drawMotes = (dt: number) => {
    much += (wantMuch - much) * Math.min(1, dt * 2.5);
    drift += (0.5 + 1.3 * much) * dt;
    time += dt;
    take("motes");
    colours();
    u("uFar", far);
    u("uDrift", drift);
    u("uTime", time);
    u("uMuch", much);
    draw(motes, gl.POINTS);
  };

  /** The point all of it falls into: rings of fire turning about it, a blade of light. */
  const drawCore = (gather: number, shut: number, q: number, beat: number, blade: number, bladeA: number) => {
    take("core");
    colours();
    u("uBox", W * 0.5, 230);
    u("uGather", gather);
    u("uShut", shut);
    u("uQ", q);
    u("uBeat", beat);
    u("uBlade", blade, bladeA);
    draw(sheet, gl.TRIANGLES);
  };

  const drawFall = (q: number) => {
    take("lanes");
    colours();
    u("uQ", q);
    draw(lanes, gl.TRIANGLES);
    take("grains");
    colours();
    u("uQ", q);
    u("uTime", time);
    draw(grains, gl.POINTS);
    const shut = smooth(0.84, 1, q);
    drawCore(smooth(0.2, 0.92, q), shut, q, -1, W * 0.34 * shut, 0.8 * shut);
  };

  const drawBreath = (b: number) => {
    const k = smooth(0, 0.3, b);
    drawCore(1, 1, 1, 0.5 + 0.5 * Math.sin(b * 21), W * (0.34 - 0.2 * k), 0.8 - 0.45 * k);
  };

  // Where the dust goes home to: looked up a few times a second.
  let home: Spot | null = null;
  let inPortrait = 0;
  let homeAt = -1e9;
  const findHome = (now: number) => {
    if (now - homeAt < 160) return;
    homeAt = now;
    const h = heartSpot();
    if (h && h.x > -20 && h.x < W + 20 && h.y > 10 && h.y < H - 10) {
      home = { x: h.x, y: h.y, r: h.r };
      inPortrait = 0;
      return;
    }
    const r = document.querySelector("[data-portrait]")?.getBoundingClientRect();
    home = r && r.width > 20 && r.bottom > 40 && r.top < H - 40 ? { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 } : null;
    inPortrait = 1;
  };

  const drawBang = (tau: number, now: number) => {
    const x = clamp(tau / RUN);
    const R = far * 1.42 * (1 - Math.pow(1 - x, 2.15)) + 6;
    const open = R * 0.78 > far;
    const run = smooth(0, 0.04, tau) * Math.exp(-tau * 1.5);
    const gas = smooth(0, 0.1, tau) * Math.exp(-tau * 1.75) * (t.light ? 0.55 : 1) * (0.45 + 0.55 * smooth(0.08, 0.34, tau));
    const flash = Math.exp(-tau * 7.5);
    const all = () => {
      colours();
      u("uTau", tau);
      u("uR", R);
      u("uFar", far);
      u("uRun", run);
      u("uBent", bent[0], bent[1], bent[2]);
    };
    if (!open || gas > 0.012 || run > 0.012) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, soft);
      gl.viewport(0, 0, sw, shh);
      gl.disable(gl.BLEND);
      take("soft");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, cloud);
      all();
      u("uBg", ...bg);
      u("uOpen", open ? 1 : 0);
      u("uGas", gas);
      u("uReach", 60 + Math.min(far * 0.86, 720) * (1 - Math.exp(-tau * 2.4)));
      u("uFlash", flash, 70 + Math.min(far * 1.1, tau * 2600 + 150 * flash), smooth(0, 0.02, tau) * Math.exp(-tau * 10));
      u("uBlade", W * 0.62, 3.2 * Math.exp(-tau * 3) + 0.9, 0.95 * Math.exp(-tau * 4.6), 0.28 * Math.exp(-tau * 5));
      draw(sheet, gl.TRIANGLES);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cv.width, cv.height);
      gl.enable(gl.BLEND);
      take("blit");
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, softTex);
      draw(sheet, gl.TRIANGLES);
    }
    if (tau < 1.9) {
      take("rays");
      all();
      draw(rays, gl.TRIANGLES);
    }
    if (run > 0.01 && R < far * 1.4) {
      take("shell");
      all();
      draw(shell, gl.TRIANGLES);
    }
    if (tau > 0.6) findHome(now);
    const hx = home ? home.x - W / 2 : 0;
    const hy = home ? home.y - H / 2 : 0;
    for (const k of ["tails", "dust"] as const) {
      take(k);
      all();
      u("uHome", hx, hy, home ? home.r : 0, inPortrait);
      u("uHas", home ? 1 : 0);
      u("uDepth", reach * 2.4);
      draw(k === "dust" ? dust : tails, k === "dust" ? gl.POINTS : gl.TRIANGLES);
    }
    // A light where it comes home.
    const come = home ? smooth(1.5, 2.6, tau) * (1 - smooth(2.9, 3.8, tau)) : 0;
    if (home && come > 0.01) {
      take("home");
      all();
      u("uHome", hx, hy, home.r, inPortrait);
      u("uCome", come);
      draw(sheet, gl.TRIANGLES);
    }
  };

  // Each of them drawn once while the page loads, where nothing can be seen of it: the
  // first time a thing is drawn costs the graphics a moment, and no such moment should
  // fall in the burst.
  let warmed = false;
  const warm = () => {
    warmed = true;
    paintCloud();
    begin();
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, 1, 1);
    drawFall(0.66);
    drawBang(0.3, 0);
    take("home");
    colours();
    u("uHome", 0, 0, 10, 0);
    u("uCome", 0);
    draw(sheet, gl.TRIANGLES);
    gl.disable(gl.SCISSOR_TEST);
  };

  const enter = (m: typeof mode) => {
    mode = m;
    clock = 0;
  };
  const loop = (now: number) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const gap = last ? (now - last) / 1000 : 0.016;
    last = now;
    if (gl.isContextLost()) return;
    if (mode === "load") {
      // A phone, and a machine busy loading: thirty a second are plenty for this.
      half = !half;
      clock += Math.min(gap, 0.06);
      if (half || !ready()) return;
      const dt = clock;
      clock = 0;
      begin();
      if (!warmed) warm();
      drawMotes(dt);
      return;
    }
    const dt = Math.min(gap, 0.05);
    clock += dt * (mode === "bang" ? 1 : haste);
    time += dt;
    begin();
    if (mode === "fall") {
      if (clock < FALL) {
        drawFall(clock / FALL);
        return;
      }
      enter("breath");
    }
    if (mode === "breath") {
      drawBreath(clock);
      if (!told) {
        // The page changes behind the dark: whatever that costs is spent here, where
        // nothing but a point of light can be seen to wait.
        told = true;
        quiet = 0;
        on.dark();
        return;
      }
      quiet = gap < 0.038 ? quiet + 1 : 0;
      if (!((clock > BREATH / haste && quiet >= 3) || clock > patience)) return;
      enter("bang");
      begin();
      drawBang(0, now);
      on.bang();
      return;
    }
    if (clock > LAST) {
      stop();
      on.done();
      return;
    }
    drawBang(clock, now);
  };
  function stop() {
    if (dead) return;
    dead = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", onResize);
    window.removeEventListener(GL_LOST_EVENT, crowded);
    cv.removeEventListener("webglcontextlost", taken);
    cv.style.visibility = "hidden";
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
  raf = requestAnimationFrame(loop);

  return {
    progress(p) {
      wantMuch = clamp(p);
    },
    ready: () => !dead && ready(),
    fall(el) {
      if (mode !== "load" || dead) return;
      grains = mesh(dustOf(el, W / 2, H / 2, phone ? 3600 : 6500), pieces.grains.stride, grains);
      lanes = mesh(attributes.lanes(moteData, drift, far, phone ? 120 : 320), pieces.lanes.stride, lanes);
      enter("fall");
      on.gone();
    },
    point(wait) {
      if (mode !== "load" || dead) return;
      patience = wait;
      on.gone();
      enter("breath");
    },
    hurry() {
      haste = 2.4;
    },
    dispose() {
      stop();
    },
  };
}
