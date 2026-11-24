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
// A canvas draws, for its card's place in its orbit (the same scroll progress
// the CSS orbit uses):
//   · the card — dark glass with the theme's painted water drifting in two
//     sheets, an iridescent hairline rim; flat in the centre, and curved like
//     a piece of the cylinder it travels round as it turns away;
//   · the orb it is when away — a wobbling sphere of the same water wound
//     into a spiral, an atmosphere of light round its edge, a soft halo and a
//     disc of bubbles circling it;
//   · the change between them — the card dissolves out from its heart along
//     a ragged, glowing front as the orb's bubbles fly outward (or gathers
//     back into it), every step of it there for a slow scroll.
// The cursor stirs the water (rings run out from it, the colours split and
// scatter near it) and pulls the card's few motes of dust towards it.
//
// The CSS still moves the card round the divider (a compositor transform) and
// still shows its words; this draws only what the card IS.
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
import { GL_LOST_EVENT, claimedContexts, contextsLost, guardCanvas } from "./glGuard";
import { holder } from "./stage";

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
  w: number;
  h: number;
  near: boolean;
  entry: Entry | null;
  mx: number;
  my: number;
  mAmt: number;
  stir: number;
  open: number;
  seed: number;
};

type Entry = {
  canvas: HTMLCanvasElement;
  /** Takes the context-loss guard off (before a deliberate forceContextLoss). */
  unguard: () => void;
  renderer: THREE_NS.WebGLRenderer;
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  panelMat: THREE_NS.ShaderMaterial;
  orb: THREE_NS.Mesh;
  orbMat: THREE_NS.ShaderMaterial;
  halo: THREE_NS.Mesh;
  haloMat: THREE_NS.ShaderMaterial;
  starMat: THREE_NS.ShaderMaterial;
  dustMat: THREE_NS.ShaderMaterial;
  texture: THREE_NS.Texture | null;
  owner: Reg | null;
  cw: number;
  ch: number;
  painted: boolean;
  /** Its shaders compiled (off the main thread) — only then is it handed out. */
  ready: boolean;
  /** When it last lost its owner (to give idle canvases back). */
  idleSince: number;
};

const MARGIN_DESK = 80;
const MARGIN_PHONE = 56;

const NOISE = /* glsl */ `
  // Simplex noise (Ashima Arts / Ian McEwan, MIT): no square grid in it, so a
  // thin glowing edge drawn on it never shows tiles or stair-steps — value
  // noise did (QA, 22 Nov).
  vec3 sPermute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = sPermute(sPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

// The panel bends round a vertical axis behind it: a piece of the cylinder
// it travels round. Shared by the card and its dust.
const BEND = /* glsl */ `
  vec3 bendPanel(vec2 p, vec2 size, float bend) {
    // The CURVATURE grows with the bend (interpolating the radius kept the
    // card flat until the very last moment — QA never saw one curve).
    float k = bend * (2.0 - bend);
    float R = size.x * 0.62 / max(k, 0.0002);
    float a = p.x / R;
    vec3 q = vec3(R * sin(a), p.y, R * (cos(a) - 1.0));
    // the corners lift a little, like a sheet in motion
    q.z -= k * 0.07 * size.x * (p.y / size.y) * (p.y / size.y) * 4.0;
    return q;
  }
`;

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
  private pSpeed = 0;
  private pType = "mouse";
  private reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  private phone = window.matchMedia("(max-width: 767px)").matches;
  /** Canvases given up for good because the device ran out of WebGL contexts
   *  (each loss anywhere on the page takes one off the cap). */
  private capCut = 0;
  private onGlLost = () => {
    this.capCut = Math.min(this.capCut + 1, 6);
  };
  private wide = window.matchMedia("(min-width: 1024px)").matches;
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
          for (const r of this.regs) if (r.card === e.target) r.near = e.isIntersecting;
        }
      },
      { rootMargin: "15% 0px 15% 0px" },
    );
    this.ro = new ResizeObserver(() => {
      this.layoutDirty = true;
    });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", this.onPointer, { passive: true });
    window.addEventListener("pointerdown", this.onPointer, { passive: true });
    window.addEventListener(THEME_EVENT, this.onTheme);
    window.addEventListener(GL_LOST_EVENT, this.onGlLost);
    void this.boot();
  }

  private onResize = () => {
    this.layoutDirty = true;
    this.wide = window.matchMedia("(min-width: 1024px)").matches;
  };
  private onPointer = (e: PointerEvent) => {
    const now = performance.now();
    const d = Math.hypot(e.clientX - this.px, e.clientY - this.py);
    const dt = Math.max(8, now - this.pLast);
    this.pSpeed = Math.min(1.5, this.pSpeed * 0.6 + (d / dt) * 0.12);
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
    // Two to begin with (the top bar and the first card); more are made as
    // they are needed, one a frame, up to the most that can be on screen at
    // once — cards turning away at the edges, the bar, a popup.
    for (let i = 0; i < 2; i++) {
      const e = this.makeEntry(THREE);
      if (!e) {
        // No WebGL here: the cards wear plain glass instead (globals.css).
        this.root().dataset.nogl = "";
        break;
      }
      this.entries.push(e);
    }
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
    for (const r of this.regs) this.resolveHue(r);
    for (const e of this.entries) this.applyTheme(e);
  }

  private applyTheme(e: Entry) {
    const THREE = this.THREE;
    if (!THREE) return;
    const k = this.colors;
    const set = (m: THREE_NS.ShaderMaterial, name: string, v: number[]) => (m.uniforms[name].value as THREE_NS.Color).setRGB(v[0], v[1], v[2]);
    set(e.panelMat, "uBase0", k.base0);
    set(e.panelMat, "uBase1", k.base1);
    set(e.panelMat, "uRim0", k.rim0);
    set(e.panelMat, "uRim1", k.rim1);
    set(e.panelMat, "uRim2", k.rim2);
    set(e.panelMat, "uFront", k.front);
    e.panelMat.uniforms.uLight.value = k.light;
    set(e.orbMat, "uGlowA", k.glowA);
    set(e.orbMat, "uGlowB", k.glowB);
    set(e.haloMat, "uGlowA", k.glowA);
    set(e.haloMat, "uGlowB", k.glowB);
    set(e.starMat, "uC0", k.rim2);
    set(e.starMat, "uC1", k.front);
    set(e.starMat, "uC2", k.rim1);
    set(e.dustMat, "uC0", k.rim2);
    set(e.dustMat, "uC1", k.front);
    const blend = k.light ? THREE.NormalBlending : THREE.AdditiveBlending;
    for (const m of [e.haloMat, e.starMat, e.dustMat]) {
      m.blending = blend;
      m.needsUpdate = true;
    }
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
        e.panelMat.uniforms.uLiquid.value = tex;
        e.orbMat.uniforms.uLiquid.value = tex;
      };
      img.src = url;
    }
  }

  private makeEntry(THREE: Three): Entry | null {
    const canvas = document.createElement("canvas");
    canvas.className = "dev-glcanvas";
    let renderer: THREE_NS.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance", premultipliedAlpha: true });
    } catch {
      return null;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.phone ? 1.25 : 1.35));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 6000);
    const col = () => new THREE.Color();

    // ── the card ──
    const panelMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLiquid: { value: null },
        uSize: { value: new THREE.Vector2(300, 200) },
        uTime: { value: 0 },
        uOpen: { value: 1 },
        uShow: { value: 1 },
        uBend: { value: 0 },
        uScale: { value: 1 },
        uRadius: { value: 16 },
        uMouse: { value: new THREE.Vector2(-9, -9) },
        uMouseAmt: { value: 0 },
        uStir: { value: 0 },
        uSeed: { value: 0 },
        uLight: { value: 0 },
        uBase0: { value: col() },
        uBase1: { value: col() },
        uRim0: { value: col() },
        uRim1: { value: col() },
        uRim2: { value: col() },
        uFront: { value: col() },
      },
      vertexShader: /* glsl */ `
        uniform vec2 uSize;
        uniform float uBend, uScale;
        varying vec2 vUv;
        ${BEND}
        void main() {
          vUv = uv;
          // It grows out of the orb: small and round at first, the full card
          // only at the end (uScale; the corners in the fragment).
          vec2 size = uSize * uScale;
          vec3 q = bendPanel(position.xy * size, size, uBend);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uLiquid;
        uniform vec2 uSize, uMouse;
        uniform float uTime, uOpen, uShow, uBend, uMouseAmt, uStir, uSeed, uLight, uScale, uRadius;
        uniform vec3 uBase0, uBase1, uRim0, uRim1, uRim2, uFront;
        varying vec2 vUv;
        ${NOISE}
        mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
        void main() {
          // Its shape: round while it grows out of the orb, its corners
          // tightening to the card's 16 px only as it reaches full size.
          vec2 size = uSize * uScale;
          vec2 px = (vUv - 0.5) * size;
          float corner = mix(min(size.x, size.y) * 0.5, uRadius, smoothstep(0.6, 1.0, uOpen));
          vec2 q = abs(px) - (size * 0.5 - corner);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
          float inside = smoothstep(0.8, -0.8, sd);

          // The cursor: rings run out from it, the water is pushed aside —
          // measured in pixels, so a short wide card ripples as much as a
          // tall one.
          float asp = uSize.x / uSize.y;
          vec2 dp = (vUv - uMouse) * uSize;
          float rp = length(dp);
          float rm = rp / uSize.y;
          float stir = uMouseAmt * (0.85 + uStir * 1.6);
          float rings = sin(rp * 0.11 - uTime * 6.5) * exp(-rp / 150.0);
          vec2 push = normalize(dp + 1e-5) * (rings * 0.045 + exp(-(rp / 90.0) * (rp / 90.0)) * 0.12) * stir;

          // The water: two sheets of the theme's painted texture, drifting
          // against each other all the time.
          float span = max(asp, 1.0);
          vec2 base = (vUv - 0.5) * vec2(asp, 1.0) / span * 0.92;
          vec2 u1 = rot(0.18 * sin(uTime * 0.05 + uSeed)) * base * 1.05 + 0.5 + vec2(0.07 * sin(uTime * 0.13 + uSeed), 0.06 * cos(uTime * 0.11)) + push;
          vec2 u2 = rot(3.14159 + 0.2 * cos(uTime * 0.04 + uSeed)) * base * 1.18 + 0.5 + vec2(-0.06 * cos(uTime * 0.09), 0.07 * sin(uTime * 0.12 + uSeed)) - push * 0.6;
          vec4 A = texture2D(uLiquid, u1);
          vec4 B = texture2D(uLiquid, u2);
          // Near the cursor the colours split and scatter.
          float split = exp(-(rp / 120.0) * (rp / 120.0)) * 0.026 * stir;
          float Ar = texture2D(uLiquid, u1 + vec2(split, split * 0.4)).r;
          float Ab = texture2D(uLiquid, u1 - vec2(split, split * 0.4)).b;
          vec3 wa = vec3(Ar, A.g, Ab) * A.a;
          vec3 wb = B.rgb * B.a * 0.6;
          vec3 water = 1.0 - (1.0 - wa) * (1.0 - wb);
          float wA = clamp(max(A.a, B.a * 0.6) * 1.35, 0.0, 1.0);

          vec3 glass = mix(uBase1, uBase0, vUv.y * 0.85 + 0.1);
          vec3 col = mix(glass, glass * 0.55 + water, 0.42 * wA);
          float alpha = mix(0.9, 0.86, uLight);
          // an inner light at the top edge
          col += vec3(0.07) * smoothstep(uSize.y * 0.5 - 2.5, uSize.y * 0.5, px.y + 0.5) * inside;

          // Where the cursor touches the glass, a soft light — and the crests
          // of its rings catch it.
          float crestLine = pow(max(sin(rp * 0.11 - uTime * 6.5), 0.0), 10.0) * exp(-rp / 170.0);
          col += mix(uRim2, vec3(1.0), 0.35) * (exp(-(rp / 70.0) * (rp / 70.0)) * 0.5 + crestLine * 0.48) * uMouseAmt;

          // The rim: a hairline whose colour turns round the card.
          float ang = atan(px.y, px.x);
          vec3 rim = mix(mix(uRim0, uRim1, 0.5 + 0.5 * sin(ang + uTime * 0.25)), uRim2, 0.5 + 0.5 * sin(ang * 2.0 - uTime * 0.18));
          float rimBand = smoothstep(1.6, 0.0, abs(sd + 1.0));
          col = mix(col, rim, rimBand * 0.65);

          // Coming to be, and going: out from the heart, ragged, with a
          // glowing front — every step of it there for a slow scroll.
          float radial = length(px / (size * 0.5)) * 0.7071;
          vec2 nuv = vUv * vec2(asp, 1.0);
          float nn = (snoise(nuv * 3.2 + uTime * 0.1 + uSeed) * 0.5 + 0.5) * 0.5 + (snoise(nuv * 11.0 - uTime * 0.18) * 0.5 + 0.5) * 0.22;
          float level = radial * 0.78 + nn * 0.5;
          float reach = uOpen * 1.62;
          float keep = smoothstep(reach + 0.01, reach - 0.05, level);
          float front = smoothstep(reach - 0.22, reach - 0.015, level) * keep * (1.0 - uOpen * uOpen);
          col += uFront * front * 1.8;
          // While it forms it is water and light, not yet glass: the dark body
          // fills in only as it completes, as its words arrive — never a
          // finished, empty slab (QA, 22 Nov).
          float solid = smoothstep(0.72, 1.0, uOpen);
          alpha *= mix(0.32 + 0.5 * wA, 1.0, solid);
          alpha = max(alpha, front);

          float a = alpha * inside * keep * uShow;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 72, 36), panelMat);
    panel.renderOrder = 2;
    scene.add(panel);

    // ── the orb ──
    const orbMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: {
        uLiquid: { value: null },
        uTime: { value: 0 },
        uR: { value: 90 },
        uAlpha: { value: 1 },
        uSeed: { value: 0 },
        uGlowA: { value: col() },
        uGlowB: { value: col() },
      },
      vertexShader: /* glsl */ `
        uniform float uTime, uR, uSeed;
        varying vec3 vDir;
        varying float vFres;
        ${NOISE}
        void main() {
          vec3 n = normalize(position);
          // A living surface: it breathes and ripples, never a perfect ball.
          float w = noise3(n * 2.2 + vec3(uTime * 0.35, uSeed, -uTime * 0.2)) - 0.5;
          float w2 = noise3(n * 6.5 - vec3(0.0, uTime * 0.6, uSeed)) - 0.5;
          vec3 p = n * uR * (1.0 + 0.16 * w + 0.06 * w2);
          vDir = n;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          vec3 vn = normalize(normalMatrix * n);
          vFres = 1.0 - abs(dot(vn, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uLiquid;
        uniform float uTime, uAlpha, uSeed;
        uniform vec3 uGlowA, uGlowB;
        varying vec3 vDir;
        varying float vFres;
        void main() {
          // The water wound into a spiral round the orb's axis.
          float lat = asin(clamp(vDir.y, -1.0, 1.0));
          float lon = atan(vDir.z, vDir.x);
          float k = 1.0 - abs(lat) / 1.5708;
          float sw = lon + uTime * 0.3 + k * 2.6 + uSeed;
          vec2 uv = vec2(0.5 + 0.42 * cos(sw) * k, 0.5 + 0.42 * sin(sw) * k);
          vec4 t = texture2D(uLiquid, uv);
          vec3 col = t.rgb * (0.35 + 0.9 * t.a);
          // an atmosphere of light round its edge
          vec3 glow = mix(uGlowA, uGlowB, 0.5 + 0.5 * vDir.y);
          col += glow * pow(vFres, 1.8) * 1.5;
          float a = clamp(0.55 + 0.45 * t.a + pow(vFres, 2.0) * 0.4, 0.0, 1.0) * uAlpha;
          gl_FragColor = vec4(col, a);
        }`,
    });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), orbMat);
    orb.renderOrder = 1;
    scene.add(orb);

    // A soft halo behind it, ragged with rays, so its edge is never a line.
    const haloMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uGlowA: { value: col() }, uGlowB: { value: col() } },
      vertexShader: /* glsl */ `
        varying vec2 vP;
        void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform float uTime, uAlpha, uSeed;
        uniform vec3 uGlowA, uGlowB;
        varying vec2 vP;
        ${NOISE}
        void main() {
          float r = length(vP);
          float a = atan(vP.y, vP.x);
          float rays = noise(vec2(a * 3.0 + uSeed, uTime * 0.25)) * 0.6 + noise(vec2(a * 9.0, -uTime * 0.4 + uSeed)) * 0.4;
          float g = exp(-pow(max(r - 0.32, 0.0) * (3.2 - rays * 1.6), 2.0) * 3.0) * smoothstep(0.5, 0.33, r * 0.5 + 0.1);
          vec3 c = mix(uGlowA, uGlowB, rays);
          gl_FragColor = vec4(c, g * 0.55 * uAlpha);
        }`,
    });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMat);
    halo.renderOrder = 0;
    scene.add(halo);

    // ── the bubbles circling the orb (a galaxy's disc) ──
    const S = this.phone ? 240 : 420;
    const sSeed = new Float32Array(S * 4);
    for (let i = 0; i < S * 4; i++) sSeed[i] = Math.random();
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(S * 3), 3));
    sGeo.setAttribute("seed", new THREE.BufferAttribute(sSeed, 4));
    const starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uR: { value: 90 },
        uOpen: { value: 0 },
        uShow: { value: 1 },
        uRatio: { value: renderer.getPixelRatio() },
        uDist: { value: 1000 },
        uC0: { value: col() },
        uC1: { value: col() },
        uC2: { value: col() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uR, uOpen, uRatio, uDist;
        varying float vA;
        varying float vPick;
        varying float vRing;
        void main() {
          // A tilted disc of bubbles and a looser shell: inner ones turn faster.
          float shell = step(0.72, seed.w);
          float r = uR * mix(1.12 + pow(seed.x, 1.4) * 1.5, 1.05 + seed.x * 0.9, shell);
          r *= 1.0 + uOpen * (1.6 + seed.y * 2.2);
          float speed = mix(0.9, 0.35, shell) / sqrt(max(r / uR, 0.4));
          float a = seed.z * 6.2831 + uTime * speed * 0.45;
          float h = (seed.y - 0.5) * uR * mix(0.18, 1.6, shell);
          vec3 p = vec3(cos(a) * r, h, sin(a) * r);
          // the disc leans towards you
          float c = cos(0.42); float s = sin(0.42);
          p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (1.6 + seed.y * seed.y * 7.0) * uRatio * (uDist / -mv.z);
          float twinkle = 0.7 + 0.3 * sin(uTime * 2.2 + seed.z * 40.0);
          vA = twinkle * (0.45 + 0.55 * seed.x) * pow(1.0 - uOpen, 2.0);
          vPick = seed.w;
          vRing = step(0.66, seed.y);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC0, uC1, uC2;
        uniform float uShow;
        varying float vA;
        varying float vPick;
        varying float vRing;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          // some are bubbles (a bright ring), some soft motes
          float mote = smoothstep(0.5, 0.0, d);
          float bubble = smoothstep(0.5, 0.42, d) * smoothstep(0.26, 0.38, d) + smoothstep(0.22, 0.0, d) * 0.25;
          float a = mix(mote, bubble, vRing);
          vec3 col = vPick < 0.4 ? uC0 : vPick < 0.7 ? uC1 : uC2;
          gl_FragColor = vec4(col, a * vA * uShow);
        }`,
    });
    const stars = new THREE.Points(sGeo, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 3;
    scene.add(stars);

    // ── the card's own few motes of dust, drawn to the cursor ──
    const D = this.phone ? 22 : 38;
    const dSeed = new Float32Array(D * 4);
    for (let i = 0; i < D * 4; i++) dSeed[i] = Math.random();
    const dGeo = new THREE.BufferGeometry();
    dGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(D * 3), 3));
    dGeo.setAttribute("seed", new THREE.BufferAttribute(dSeed, 4));
    const dustMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uSize: { value: new THREE.Vector2(300, 200) },
        uBend: { value: 0 },
        uScale: { value: 1 },
        uOpen: { value: 1 },
        uShow: { value: 1 },
        uMouse: { value: new THREE.Vector2(-9, -9) },
        uMouseAmt: { value: 0 },
        uRatio: { value: renderer.getPixelRatio() },
        uC0: { value: col() },
        uC1: { value: col() },
      },
      vertexShader: /* glsl */ `
        attribute vec4 seed;
        uniform float uTime, uBend, uOpen, uMouseAmt, uRatio, uScale;
        uniform vec2 uSize, uMouse;
        varying float vA;
        varying float vPick;
        ${BEND}
        void main() {
          // Drifting slowly through the card…
          vec2 home = (seed.xy - 0.5) * (uSize * uScale - 36.0);
          vec2 drift = vec2(sin(uTime * (0.12 + seed.z * 0.1) + seed.w * 6.28), cos(uTime * (0.1 + seed.w * 0.08) + seed.z * 6.28)) * vec2(uSize.x * 0.06, uSize.y * 0.08);
          vec2 p = home + drift;
          // …and drawn to the cursor, circling it.
          vec2 m = (uMouse - 0.5) * uSize;
          vec2 toM = m - p;
          float d = length(toM);
          float pull = uMouseAmt * smoothstep(max(240.0, min(uSize.x, uSize.y) * 0.9), 0.0, d);
          vec2 swirl = vec2(-toM.y, toM.x) / max(d, 1.0);
          p += toM * pull * (0.55 + seed.z * 0.3) + swirl * pull * 40.0 * (seed.w - 0.5);
          vec3 q = bendPanel(p, uSize * uScale, uBend);
          q.z += 2.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
          gl_PointSize = (2.0 + seed.z * 2.6 + pull * 4.5) * uRatio;
          vA = (0.45 + 0.4 * seed.w + pull * 1.2) * uOpen * uOpen * (0.7 + 0.3 * sin(uTime * 1.7 + seed.x * 30.0));
          vPick = seed.y;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uC0, uC1;
        uniform float uShow;
        varying float vA;
        varying float vPick;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          gl_FragColor = vec4(vPick < 0.6 ? uC0 : uC1, smoothstep(0.5, 0.0, d) * vA * uShow);
        }`,
    });
    const dust = new THREE.Points(dGeo, dustMat);
    dust.frustumCulled = false;
    dust.renderOrder = 4;
    scene.add(dust);

    const e: Entry = { canvas, unguard: () => {}, renderer, scene, camera, panelMat, orb, orbMat, halo, haloMat, starMat, dustMat, texture: null, owner: null, cw: 0, ch: 0, painted: false, ready: false, idleSince: performance.now() };
    // Its shaders compiled in the background (KHR_parallel_shader_compile),
    // not in the frame that first draws it.
    const done = () => {
      e.ready = true;
    };
    try {
      void renderer.compileAsync(scene, camera).then(done, done);
    } catch {
      done();
    }
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
      w: card.offsetWidth,
      h: card.offsetHeight,
      near: false,
      entry: null,
      mx: -9,
      my: -9,
      mAmt: 0,
      stir: 0,
      open: 1,
      seed: Math.random() * 20,
    };
    card.dataset.gl = "none";
    this.resolveHue(r);
    this.regs.add(r);
    this.io.observe(card);
    this.ro.observe(card);
    this.layoutDirty = true;
    return () => {
      this.io.unobserve(card);
      this.ro.unobserve(card);
      if (r.entry) this.release(r);
      delete card.dataset.gl;
      this.regs.delete(r);
      if (this.regs.size === 0) this.onEmpty();
    };
  }

  private release(r: Reg) {
    const e = r.entry;
    if (!e) return;
    e.owner = null;
    e.painted = false;
    e.idleSince = performance.now();
    e.canvas.remove();
    r.entry = null;
    r.card.dataset.gl = "none";
  }

  private measure() {
    this.layoutDirty = false;
    for (const r of this.regs) {
      let y = 0;
      let el: HTMLElement | null = r.card;
      while (el) {
        y += el.offsetTop;
        el = el.offsetParent as HTMLElement | null;
      }
      r.docTop = y;
      r.w = r.card.offsetWidth;
      r.h = r.card.offsetHeight;
    }
  }

  private hold = holder(24, 700);
  private loop = (now: number) => {
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden || !this.THREE) return;
    const dt = Math.min(0.06, (now - this.prev) / 1000);
    this.prev = now;
    if (!this.reduced) this.t += dt;
    if (this.layoutDirty) this.measure();
    const vh = window.innerHeight;
    const sy = window.scrollY;
    this.pSpeed *= Math.exp(-dt * 3);

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
    if (this.entries.length < cap && this.THREE) {
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
    const want = new Set(ordered.slice(0, this.entries.length));
    for (const r of this.regs) if (r.entry && !want.has(r)) this.release(r);
    for (const r of want) {
      if (r.entry) continue;
      const free = this.entries.find((e) => !e.owner && e.ready);
      if (!free) break;
      free.owner = r;
      r.entry = free;
      r.slot.appendChild(free.canvas);
    }

    // (Behind the door, and while it opens: still, once the pool is made and warm.)
    if (this.entries.length >= cap && this.hold()) return;
    for (const r of want) {
      const e = r.entry;
      if (!e) continue;
      this.frame(r, e, vh, sy, dt);
    }
  };

  private frame(r: Reg, e: Entry, vh: number, sy: number, dt: number) {
    const surface = r.kind === "surface";
    if (surface) {
      // A surface can change size at any time (a popup's content, the bar on
      // a resize) and is not measured with the cards.
      r.w = r.card.offsetWidth;
      r.h = r.card.offsetHeight;
    }
    const margin = surface ? 0 : this.phone ? MARGIN_PHONE : MARGIN_DESK;
    const cw = r.w + margin * 2;
    const ch = r.h + margin * 2;
    if (cw !== e.cw || ch !== e.ch) {
      e.cw = cw;
      e.ch = ch;
      e.renderer.setSize(cw, ch, false);
      e.camera.aspect = cw / ch;
      const dist = ch / 2 / Math.tan((15 * Math.PI) / 180);
      e.camera.position.set(0, 0, dist);
      e.camera.near = Math.max(1, dist - 2000);
      e.camera.far = dist + 2000;
      e.camera.updateProjectionMatrix();
      e.starMat.uniforms.uDist.value = dist;
    }

    // Where the card is in its orbit: the same progress as its CSS timeline.
    const top = r.docTop - sy;
    let a = (vh - top) / (vh + r.h);
    // The first card is already in the present when the page opens on a
    // desktop; it only leaves, once its top passes the top of the screen —
    // the second half of the life, like its CSS (exit -20% → exit 100%).
    if (r.first && this.wide) a = 0.6 + 0.4 * Math.min(1, Math.max(0, (0.2 * r.h - top) / (1.2 * r.h)));
    a = Math.min(1, Math.max(0, a));
    // It forms only as its words arrive (they fade in over 0.34-0.40), so it
    // is never a finished, empty slab waiting for them; on the way out it
    // dissolves after they have gone (0.60-0.66). Flat only in the present.
    // Near full size only while its words show (they are whole over
    // 0.40-0.60 and fading over 0.36-0.40 / 0.60-0.64): grown by 0.40 and
    // nine-tenths grown only from 0.36; shrinking below that from 0.64.
    let open = Math.min(smooth(0.27, 0.4, a), 1 - smooth(0.6, 0.73, a));
    let bend = Math.max(1 - smooth(0.22, 0.4, a), smooth(0.6, 0.78, a));
    // The first card on a phone is below the portrait when the page opens: a
    // curved card with its words from the start, never an orb (it leaves like
    // the rest) — "instead of showing that bubble".
    if (r.first && !this.wide && a < 0.5) {
      open = 1;
      bend = (1 - smooth(0.05, 0.4, a)) * 0.75;
    }
    if (r.first && !this.wide && r.away !== a > 0.6) {
      r.away = a > 0.6;
      if (r.away) r.card.dataset.away = "";
      else delete r.card.dataset.away;
    }
    let show = smooth(0, 0.06, a) * (1 - smooth(0.94, 1, a));
    if (this.reduced || surface) {
      open = 1;
      bend = 0;
      show = 1;
    }
    r.open = open;

    // The cursor, in the card's own coordinates.
    const rect = r.card.getBoundingClientRect();
    const inX = this.px >= rect.left - 30 && this.px <= rect.right + 30;
    const inY = this.py >= rect.top - 30 && this.py <= rect.bottom + 30;
    // A finger does not hover: on touch the water answers a fresh touch and
    // settles a moment later, instead of rippling for ever round the last
    // place it was tapped.
    const fresh = this.pType === "mouse" || performance.now() - this.pLast < 900;
    const over = inX && inY && open > 0.9 && fresh;
    if (over) {
      r.mx = (this.px - rect.left) / rect.width;
      r.my = 1 - (this.py - rect.top) / rect.height;
    }
    r.mAmt += ((over ? 1 : 0) - r.mAmt) * (1 - Math.exp(-dt * 5));
    r.stir += (this.pSpeed - r.stir) * (1 - Math.exp(-dt * 6));

    const orbR = Math.max(this.phone ? 44 : 58, Math.min(this.phone ? 92 : 118, Math.min(r.w, r.h) * 0.36));
    const t = this.t;
    // It grows out of the orb: from the orb's own size to the full card.
    const s0 = Math.min(0.7, Math.max(0.12, (orbR * 2.1) / Math.max(r.w, r.h)));
    // Eased in and out, so it reaches its full size just as its words arrive
    // (eased out, it was nearly full size and still wordless for a stretch).
    const grow = open * open * (3 - 2 * open);
    const scale = s0 + (1 - s0) * grow;
    const pm = e.panelMat.uniforms;
    pm.uSize.value.set(r.w, r.h);
    pm.uScale.value = surface ? 1 : scale;
    pm.uRadius.value = r.radius;
    e.dustMat.uniforms.uScale.value = scale;
    pm.uTime.value = t;
    pm.uOpen.value = open;
    pm.uShow.value = show;
    pm.uBend.value = bend;
    pm.uMouse.value.set(r.mx, r.my);
    pm.uMouseAmt.value = r.mAmt;
    pm.uStir.value = r.stir;
    pm.uSeed.value = r.seed;
    (pm.uRim0.value as THREE_NS.Color).setRGB(r.hue[0], r.hue[1], r.hue[2]);
    (e.orbMat.uniforms.uGlowB.value as THREE_NS.Color).setRGB(r.hue[0], r.hue[1], r.hue[2]);
    (e.haloMat.uniforms.uGlowB.value as THREE_NS.Color).setRGB(r.hue[0], r.hue[1], r.hue[2]);

    // The orb: whole while away, swelling and dissolving as the card opens.
    // The orb hands over to the card as the card grows out of it.
    const orbOn = surface ? 0 : 1 - smooth(0.05, 0.5, open);
    e.orb.visible = orbOn > 0.01;
    e.halo.visible = e.orb.visible;
    const swell = 1 + open * 0.5;
    e.orbMat.uniforms.uR.value = orbR * swell;
    e.orbMat.uniforms.uTime.value = t;
    e.orbMat.uniforms.uAlpha.value = orbOn * show;
    e.orbMat.uniforms.uSeed.value = r.seed;
    e.orb.rotation.set(0.35, t * 0.15 + r.seed, 0);
    e.halo.scale.setScalar(orbR * 2.4 * swell);
    e.haloMat.uniforms.uTime.value = t;
    e.haloMat.uniforms.uAlpha.value = orbOn * show;
    e.haloMat.uniforms.uSeed.value = r.seed;
    const sm = e.starMat.uniforms;
    sm.uTime.value = t + r.seed;
    sm.uR.value = orbR;
    sm.uOpen.value = open;
    sm.uShow.value = show;
    const dm = e.dustMat.uniforms;
    dm.uTime.value = t + r.seed;
    dm.uSize.value.set(r.w, r.h);
    dm.uBend.value = bend;
    dm.uOpen.value = open;
    dm.uShow.value = show;
    dm.uMouse.value.set(r.mx, r.my);
    dm.uMouseAmt.value = r.mAmt;

    e.renderer.render(e.scene, e.camera);
    if (!e.painted) {
      e.painted = true;
      r.card.dataset.gl = "on";
    }
  }

  private dispose(e: Entry) {
    this.entries = this.entries.filter((x) => x !== e);
    e.unguard();
    e.canvas.remove();
    e.scene.traverse((o) => {
      const m = o as THREE_NS.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE_NS.Material | undefined;
      mat?.dispose();
    });
    e.texture?.dispose();
    e.renderer.dispose();
    e.renderer.forceContextLoss();
  }

  destroy() {
    this.dead = true;
    cancelAnimationFrame(this.raf);
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
      e.scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE_NS.Material | undefined;
        mat?.dispose();
      });
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
