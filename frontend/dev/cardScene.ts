// One card, drawn: the glass it is in the present, the ball of glass it is away, and the
// sheet winding itself up from the one into the other (§104.1, §104.10–12).
//
//   "I want that rectangle to curve: right whole body curve till left, until it fully
//    becomes that ball" — "that curve card idea is good, what I'm expecting, literally
//    card spiral… [the spiral making] you can still enhance, more detailing and cool and
//    realistic… text words are not following, see… I hate that planet… previous one is
//    fine, follow that way, but more detailing… don't make [it] too bright, it's
//    attracting more… also don't make [it] too dull" (24 Nov)
//
// So: a sheet of dark glass with the theme's painted water in it, and its own words on it
// (cardInk.ts). Its right edge lifts towards you, curls over and winds to the left, turn
// upon turn, a scroll; its cut edges catch the light, the light runs along its bends,
// the roll darkens what it is rolled over, drops come off the edge that leads; then the
// scroll opens out and is drawn in to its poles, and closes as a ball of that same glass,
// the turns still there inside it, the water still running round them, drops and bubbles
// going round it. It opens the same way. (From 15:35 to 19:00 on 24 Nov it closed into
// real worlds. He found them comic, and a planet beside a skeleton awkward: do not go back.)
//
// The shape is worked out here, column by column, seen along its height, and handed to one
// mesh; that mesh, flat, is the card. Glass is seen through: what is behind its middle is
// drawn first, from the outside in, and what is before it after, from the inside out.

import type * as THREE_NS from "three";
import { beadPoints, beadShader, COME_APART, flowTexture, SURFACE_LIGHT, water } from "./flow";

type Three = typeof THREE_NS;
type V3 = readonly number[];

const COLS = 96;
const ROWS = 40;
const FOV = 22;

// The panel bends round a vertical axis behind it: a piece of the cylinder it
// travels round (only the first card on a phone, arriving).
const BEND = /* glsl */ `
  vec3 bendPanel(vec2 p, vec2 size, float bend) {
    float k = bend * (2.0 - bend);
    float R = size.x * 0.62 / max(k, 0.0002);
    float a = p.x / R;
    vec3 q = vec3(R * sin(a), p.y, R * (cos(a) - 1.0));
    q.z -= k * 0.07 * size.x * (p.y / size.y) * (p.y / size.y) * 4.0;
    return q;
  }
`;

const NOISE = /* glsl */ `
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
`;

// A column of the sheet as it lies now, and a row of it: drawn in to the axis of the roll,
// to the poles at last.
const LIE = /* glsl */ `
  uniform vec4 uProf[${COLS + 1}];
  uniform vec2 uAxis;
  uniform vec2 uSize;
  uniform float uPinch, uR;
  vec3 lie(vec4 c, float row, out vec3 n, out vec2 d) {
    float f = row * 3.14159265;
    float s = cos(f * uPinch);
    float ds = -sin(f * uPinch) * 3.14159265 * uPinch;
    float y = mix(row * uSize.y, uR * sin(f), uPinch);
    float dy = mix(uSize.y, uR * 3.14159265 * cos(f), uPinch);
    d = c.xy - uAxis;
    n = normalize(cross(vec3(c.z, 0.0, c.w), vec3(d.x * ds, dy, d.y * ds)) + 1e-6);
    return vec3(uAxis.x + d.x * s, y, uAxis.y + d.y * s);
  }
`;

export type CardLook = {
  w: number;
  h: number;
  /** The ball's radius. */
  R: number;
  radius: number;
  /** 0: flat, the card; 1: closed, the ball. */
  roll: number;
  bend: number;
  show: number;
  t: number;
  seed: number;
  /** How far the ball has turned (turns, −½ to ½). */
  spin: number;
  /** Where it is on its way round the spine: 1 to the right of it, 0 behind it, −1 to the left. */
  side: number;
  mouse: readonly [number, number];
  mouseAmt: number;
  /** The hand is in the water here (flow.ts), and where the card's top left is on the screen. */
  stirred: boolean;
  place: readonly [number, number];
  hue: V3;
  /** How bright it is drawn: less where it is far behind. */
  bright: number;
  /** How much of its words is drawn on it (0 while the page's own words show). */
  ink: number;
  surface: boolean;
};

export type CardTheme = { base0: V3; base1: V3; rim1: V3; rim2: V3; front: V3; glowA: V3; glowB: V3; dust0: V3; light: number };

export type CardScene = {
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  /** Its view of a card in a surface of this size. */
  view: (cw: number, ch: number) => void;
  theme: (k: CardTheme) => void;
  liquid: (t: THREE_NS.Texture) => void;
  /** Its words, painted (null: not yet). */
  ink: (t: THREE_NS.Texture | null) => void;
  look: (l: CardLook) => void;
  dispose: () => void;
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export function makeCardScene(THREE: Three, ratio: number, phone: boolean): CardScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 9000);
  const col = () => ({ value: new THREE.Color() });
  const body = new THREE.Group();
  scene.add(body);
  const sun = new THREE.Vector3(-0.8, 0.35, 0.55);
  const center = new THREE.Vector3();
  const at = new THREE.Vector3();
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;
  const prof = new Float32Array((COLS + 1) * 4);
  const axis = new THREE.Vector2();
  const size = new THREE.Vector2(300, 200);
  const flow = flowTexture(THREE);
  const shared = {
    uTime: { value: 0 },
    uShow: { value: 1 },
    uSun: { value: sun },
    uHue: col(),
    uCenter: { value: center },
    uProf: { value: prof },
    uAxis: { value: axis },
    uSize: { value: size },
    uPinch: { value: 0 },
    uR: { value: 100 },
    uRoll: { value: 0 },
    uBall: { value: 0 },
    uSeed: { value: 0 },
    uBright: { value: 1 },
    uRim1: col(),
    uRim2: col(),
    uGlowA: col(),
    uGlowB: col(),
  };

  /* ── the sheet ── */
  const outIn = new THREE.PlaneGeometry(1, 1, COLS, ROWS);
  // Its faces column by column: from its left edge (the outside of the roll) in, and back.
  const faces = (inward: boolean) => {
    const ix: number[] = [];
    for (let c = 0; c < COLS; c++) {
      const i = inward ? c : COLS - 1 - c;
      for (let j = 0; j < ROWS; j++) {
        const a = j * (COLS + 1) + i;
        const b = a + COLS + 1;
        ix.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    return new THREE.BufferAttribute(new Uint16Array(ix), 1);
  };
  outIn.setIndex(faces(true));
  const inOut = new THREE.BufferGeometry();
  inOut.setAttribute("position", outIn.getAttribute("position"));
  inOut.setAttribute("uv", outIn.getAttribute("uv"));
  inOut.setIndex(faces(false));
  const pu = {
    ...shared,
    uBend: { value: 0 },
    uRadius: { value: 16 },
    uLiquid: { value: blank as THREE_NS.Texture },
    uInk: { value: blank as THREE_NS.Texture },
    uInkOn: { value: 0 },
    uMouse: { value: new THREE.Vector2(-9, -9) },
    uMouseAmt: { value: 0 },
    uFlow: { value: flow.tex as THREE_NS.Texture },
    uSlope: { value: flow.slope as THREE_NS.Texture },
    uFlowOn: { value: 0 },
    uPlace: { value: new THREE.Vector2() },
    uScreen: { value: new THREE.Vector2(1, 1) },
    uLight: { value: 0 },
    uBase0: col(),
    uBase1: col(),
    uFront: col(),
  };
  const panelOf = (half: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      depthWrite: false,
      depthTest: false,
      defines: { HALF: half },
      uniforms: pu,
      vertexShader: /* glsl */ `
        ${LIE}
        uniform vec3 uCenter;
        uniform float uRoll, uBend, uBall, uTime, uSeed;
        varying vec2 vUv;
        varying vec3 vN, vP, vRel;
        varying float vOff, vD;
        ${BEND}
        ${NOISE}
        void main() {
          vUv = uv;
          vec3 q, n;
          vOff = 9.0;
          vD = 1.0;
          if (uRoll < 0.0005) {
            q = bendPanel(position.xy * uSize, uSize, uBend);
            n = vec3(0.0, 0.0, 1.0);
          } else {
            vec2 d;
            q = lie(uProf[int(uv.x * ${COLS}.0 + 0.5)], position.y, n, d);
            vOff = d.x / uR;
            vD = length(d) / uR;
            if (uBall > 0.001) {
              // Closed, it lives: it swells and sinks a little, never a perfect ball.
              vec3 o = normalize(vec3(q.x - uAxis.x, q.y, q.z - uAxis.y) + 1e-4);
              float w = noise3(o * 1.9 + vec3(uTime * 0.28, uSeed, -uTime * 0.2)) - 0.5;
              float w2 = noise3(o * 5.2 - vec3(0.0, uTime * 0.42, uSeed)) - 0.5;
              q += o * uR * uBall * (0.06 * w + 0.016 * w2);
            }
          }
          vec4 w4 = modelMatrix * vec4(q, 1.0);
          vRel = w4.xyz - uCenter;
          vec4 mv = viewMatrix * w4;
          vP = mv.xyz;
          vN = normalize(normalMatrix * n);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D uLiquid, uInk, uFlow, uSlope;
        uniform vec2 uSize, uMouse, uPlace, uScreen;
        uniform vec3 uBase0, uBase1, uRim1, uRim2, uFront, uHue, uSun, uGlowA, uGlowB;
        uniform float uTime, uShow, uMouseAmt, uFlowOn, uSeed, uLight, uRadius, uRoll, uBall, uR, uInkOn, uBright;
        varying vec2 vUv;
        varying vec3 vN, vP, vRel;
        varying float vOff, vD;
        // What the water does here (px from the card's top left).
        vec4 flowAt(vec2 p) { return textureLod(uFlow, (uPlace + p) / uScreen, 0.0); }
        ${COME_APART}
        ${SURFACE_LIGHT}
        mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }
        float sq(float x) { return x * x; }
        vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
        // Air in the glass: a bubble here and there (x: its skin, y: the light in it).
        vec2 bubbleAt(vec2 p, float cell, float keep) {
          vec2 g = p / cell;
          vec2 id = floor(g);
          vec2 r = hash2(id);
          if (r.x > keep) return vec2(0.0);
          float rad = mix(0.05, 0.2, r.y * r.y);
          vec2 c = 0.5 + (hash2(id + 7.0) - 0.5) * (0.92 - 2.0 * rad);
          vec2 f = fract(g) - c;
          float d = length(f) / rad;
          float px = fwidth(g.x) / rad;
          float skin = smoothstep(1.0 + px, 1.0 - px, d) * (0.22 + 0.78 * smoothstep(0.45, 0.95, d));
          float hi = smoothstep(0.42, 0.1, length(f / rad - vec2(-0.36, 0.4)));
          return vec2(skin, hi * step(d, 1.0));
        }

        void main() {
        #if HALF == 1
          if (uRoll > 0.0005 && vRel.z >= 0.0) discard;
        #else
          if (vRel.z < 0.0) discard;
        #endif
          // Its outline: the card's, its corners gone by the time it closes.
          vec2 px = (vUv - 0.5) * uSize;
          float corner = uRadius * (1.0 - smoothstep(0.62, 0.94, uRoll));
          vec2 q = abs(px) - (uSize * 0.5 - corner);
          float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
          // (As soft as a pixel is wide: the sheet is seen from its edge, too.)
          float aa = clamp(fwidth(sd), 0.8, 12.0);
          float inside = max(smoothstep(aa, -aa, sd), smoothstep(0.96, 1.0, uRoll));
          if (inside < 0.01) discard;
          vec3 n = normalize(vN);
          vec3 v = normalize(-vP);
          bool back = !gl_FrontFacing;
          if (back) n = -n;
          float T = smoothstep(0.0, 0.22, uRoll);
          float wound = smoothstep(0.3, 0.9, uRoll);

          /* ── dark glass, and the water in it ── */
          float asp = uSize.x / uSize.y;
          vec2 dp = (vUv - uMouse) * uSize;
          float rp = length(dp);
          // The hand in it (flow.ts): the water is carried along, and bent by its surface.
          vec2 hp = vec2(vUv.x, 1.0 - vUv.y) * uSize;
          vec4 fl = vec4(0.0);
          vec2 slope = vec2(0.0);
          if (uFlowOn > 0.5) {
            fl = flowAt(hp);
            slope = textureLod(uSlope, (uPlace + hp) / uScreen, 0.0).xy;
          }
          vec2 push = (vec2(-fl.x, fl.y) * 0.085 + vec2(slope.x, -slope.y) * 18.0) / max(uSize.x, uSize.y);
          // (Wound up, it runs along the turns.)
          push.x += uTime * 0.014 * uBall;
          // The water: two sheets of the theme's painted texture, drifting against each
          // other all the time.
          float span = max(asp, 1.0);
          vec2 base = (vUv - 0.5) * vec2(asp, 1.0) / span * 0.92;
          vec2 u1 = rot(0.18 * sin(uTime * 0.05 + uSeed)) * base * 1.05 + 0.5 + vec2(0.07 * sin(uTime * 0.13 + uSeed), 0.06 * cos(uTime * 0.11)) + push;
          vec2 u2 = rot(3.14159 + 0.2 * cos(uTime * 0.04 + uSeed)) * base * 1.18 + 0.5 + vec2(-0.06 * cos(uTime * 0.09), 0.07 * sin(uTime * 0.12 + uSeed)) - push * 0.6;
          vec4 A = texture2D(uLiquid, u1);
          vec4 B = texture2D(uLiquid, u2);
          // Where it is stirred the colours split and scatter; on a bend, a little.
          float split = min(1.0, fl.z * 1.2 + length(slope) * 0.4) * 0.024 + 0.004 * T;
          float Ar = texture2D(uLiquid, u1 + vec2(split, split * 0.4)).r;
          float Ab = texture2D(uLiquid, u1 - vec2(split, split * 0.4)).b;
          vec3 wa = vec3(Ar, A.g, Ab) * A.a;
          vec3 wb = B.rgb * B.a * 0.6;
          vec3 wat = 1.0 - (1.0 - wa) * (1.0 - wb);
          float wA = clamp(max(A.a, B.a * 0.6) * 1.35, 0.0, 1.0);
          vec3 glass = mix(uBase1, uBase0, vUv.y * 0.85 + 0.1);
          vec3 colr = mix(glass, glass * 0.55 + wat, (0.42 + 0.3 * smoothstep(0.02, 0.4, fl.z)) * wA);
          float alpha = mix(0.9, 0.86, uLight);
          // an inner light at the top edge
          colr += vec3(0.07) * smoothstep(uSize.y * 0.5 - 2.5, uSize.y * 0.5, px.y + 0.5) * inside * (1.0 - T);
          // Where the hand is over the glass, a soft light — and the water's slopes catch it.
          vec3 sheen = uFlowOn > 0.5 ? surfaceLight(slope) : vec3(0.0);
          colr *= 1.0 - 0.55 * sheen.y;
          colr += mix(uRim2, vec3(1.0), 0.35) * (exp(-(rp / 70.0) * (rp / 70.0)) * 0.16 * uMouseAmt + sheen.x * 0.24 + sheen.z * 0.6);
          // …and where it has been stirred the card comes apart: a dark wake, and beads of it
          // that flow there and close up again.
          float gone = smoothstep(0.1, 0.46, fl.z);
          if (gone > 0.003) {
            vec2 from;
            vec3 bd = beadAt(hp, 13.0, from);
            vec2 fb = (vec2(from.x / uSize.x, 1.0 - from.y / uSize.y) - 0.5) * vec2(asp, 1.0) / span * 0.92;
            vec4 fw = textureLod(uLiquid, rot(0.18 * sin(uTime * 0.05 + uSeed)) * fb * 1.05 + 0.5 + vec2(0.07 * sin(uTime * 0.13 + uSeed), 0.06 * cos(uTime * 0.11)), 0.0);
            float rr = apartRnd(from.yx + 5.0);
            vec3 tone = glass * 1.5 + fw.rgb * fw.a * 0.85 + mix(uHue, uRim2, rr) * (0.1 + 0.22 * rr);
            // (Hardly apart, it is still the card itself.)
            vec3 piece = mix(colr, tone * bd.y, smoothstep(0.08, 0.5, bd.z));
            colr = mix(colr, mix(uBase1 * 0.28, piece, bd.x), gone);
            alpha = mix(alpha, mix(0.62, 0.96, bd.x), gone);
          }
          // Its words, on it: they go where it goes, and melt into the water as it closes.
          float said = 0.0;
          if (uInkOn > 0.002) {
            float melt = smoothstep(0.5, 0.92, uRoll);
            vec2 iu = vUv + (A.rg - 0.35) * vec2(0.03, 0.05) * melt;
            vec4 ink = texture2D(uInk, iu);
            float k = uInkOn * (1.0 - melt) * (back ? 0.4 : 1.0);
            colr = colr * (1.0 - ink.a * k) + ink.rgb * k;
            said = ink.a * k;
          }
          // The rim: a hairline whose colour turns round the card.
          float ang = atan(px.y, px.x);
          vec3 rim = mix(mix(uHue, uRim1, 0.5 + 0.5 * sin(ang + uTime * 0.25)), uRim2, 0.5 + 0.5 * sin(ang * 2.0 - uTime * 0.18));
          float rimBand = smoothstep(1.6, 0.0, abs(sd + 1.0)) * smoothstep(5.0, 1.6, aa);
          colr = mix(colr, rim, rimBand * 0.65 * (1.0 - T));

          if (uRoll > 0.0005) {
            /* ── it bends: glass, lit by the spine ── */
            // (The water in it is not flat: its folds tip the light a little.)
            vec3 ripple = vec3(dFdx(A.a), dFdy(A.a), 0.0) * 1.6 * T;
            vec3 nn = normalize(n + clamp(ripple, vec3(-0.14), vec3(0.14)));
            float face = max(0.0, dot(nn, v));
            float f1 = 1.0 - face;
            float lam = dot(nn, uSun);
            vec3 key = mix(vec3(0.86, 0.97, 1.0), uGlowA, 0.22);
            vec3 warm = mix(uGlowB, uHue, 0.45);
            // How much light falls on it; on its far side a little comes through.
            float lit = 0.5 + 0.6 * smoothstep(-0.4, 0.95, lam);
            colr *= mix(1.0, lit, T);
            // (Lit from the spine, the water in it glows a little, whichever side one sees.)
            colr += wat * wA * (0.10 + 0.16 * smoothstep(-0.6, 0.8, lam) + 0.16 * wound + 0.1 * uBall) * T;
            colr += uHue * (0.012 + 0.05 * f1) * T;
            // What it mirrors: the spine's cord, a strip of light beside it; a paler sky; the warm side.
            vec3 r = reflect(-v, nn);
            float strip = exp(-sq((r.x - uSun.x * 0.66) / 0.12)) * (0.3 + 0.7 * smoothstep(1.0, 0.0, abs(r.y - 0.1)));
            float wide = exp(-sq((r.x - uSun.x * 0.5) / 0.42));
            float sky = smoothstep(0.25, 0.95, r.y);
            float low = exp(-sq((r.x + uSun.x * 0.7) / 0.34)) * smoothstep(0.7, -0.4, r.y);
            float fr = 0.06 + 0.94 * f1 * f1 * f1 * f1;
            vec3 mirror = key * (strip * 1.0 + wide * 0.12) + key * sky * 0.16 + warm * low * 0.2;
            colr += mirror * mix(0.34, 1.0, fr) * T * 0.62 * mix(1.0, 0.7, uBall);
            float nh = max(0.0, dot(nn, normalize(uSun + v)));
            colr += key * (pow(nh, 170.0) * 0.6 + pow(nh, 26.0) * 0.1) * T;
            // Thin as it is, its colours turn with the angle.
            vec3 film = mix(mix(uRim1, uRim2, 0.5 + 0.5 * cos(6.2832 * (face * 1.3 + A.a * 0.4) + uTime * 0.1)), uHue, 0.35);
            colr += film * (0.035 + 0.42 * f1 * f1) * T * 0.5;
            // Air in it.
            vec2 bp = vec2(vUv.x * uSize.x - uTime * 2.0, px.y - uTime * 3.2);
            vec2 air = bubbleAt(bp, 46.0, 0.34) + bubbleAt(bp + 19.0, 23.0, 0.26) * 0.7;
            colr += key * (air.x * 0.13 + air.y * 0.5) * T * (0.35 + 0.65 * wound);

            // Under the roll, and inside it, it is dark.
            float near = exp(-max(0.0, -vOff) * 1.7) * smoothstep(0.1, 0.4, uRoll) * (1.0 - smoothstep(0.55, 0.85, uRoll));
            colr *= 1.0 - (back ? 0.0 : 0.62) * near;
            float deep = 1.0 - smoothstep(0.35, 0.95, vD);
            colr *= 1.0 - 0.3 * deep * wound;

            // Its cut edges, lit along the glass: the scroll's turns, seen from above; the edge
            // that leads, and the one it comes to.
            float cut = smoothstep(2.6, 0.2, abs(sd + 1.2)) * smoothstep(9.0, 2.0, aa);
            float glint = 0.3 + 0.7 * smoothstep(-0.3, 0.9, dot(normalize(vec3(nn.xy, 0.25)), uSun)) + 0.17 * sin(vUv.x * 21.0 - uTime * 0.7);
            vec3 cutc = mix(rim, vec3(1.0), 0.34);
            float open = 1.0 - smoothstep(0.8, 0.98, uRoll);
            colr += cutc * cut * glint * 0.62 * T * open;
            float lead = exp(-(1.0 - vUv.x) * uSize.x / 3.2);
            float tail = exp(-vUv.x * uSize.x / 2.4);
            colr += mix(uFront, cutc, 0.4) * lead * 0.5 * T * (1.0 - 0.55 * uBall);
            colr += cutc * tail * 0.42 * smoothstep(0.3, 0.75, uRoll);

            /* ── closed: the ball ── */
            vec3 o = normalize(vRel);
        #if HALF == 1
            // The light that went through it, gathered on its far side.
            float thru = pow(max(0.0, dot(o, normalize(vec3(-uSun.x, -uSun.y * 1.2, -uSun.z)))), 2.2);
            float net = smoothstep(0.25, 0.95, B.a) * 0.75 + 0.25;
            colr += (warm * 0.6 + key * 0.3) * thru * net * uBall * 0.6;
        #endif
            float rimlight = pow(f1, 2.6);
            vec3 air2 = mix(uGlowA, uGlowB, 0.5 + 0.5 * o.y) * 0.6 + uHue * 0.4;
            colr += air2 * rimlight * uBall * (0.2 + 0.5 * smoothstep(-0.5, 0.9, dot(o, uSun)));
            // (Just inside its edge glass is dark.)
            colr *= 1.0 - 0.3 * uBall * smoothstep(0.5, 0.2, face) * smoothstep(0.02, 0.16, face);

            // Glass is seen through, less so where one looks along it.
            float body = 0.4 + 0.46 * f1 + wA * 0.3 + cut * 0.5 + lead * 0.6 + tail * 0.4 + air.x * 0.2;
        #if HALF == 1
            float far = 0.93;
        #else
            float far = clamp(body, 0.0, 0.96);
        #endif
            alpha = mix(mix(alpha, 0.95, T), far, wound);
            alpha = max(alpha, said);
            colr *= uBright * mix(1.0, 1.2, uBall);
          }
          gl_FragColor = vec4(colr, alpha * inside * uShow);
        }`,
    });
  const farMesh = new THREE.Mesh(outIn, panelOf(1));
  farMesh.frustumCulled = false;
  farMesh.renderOrder = 2;
  const nearMesh = new THREE.Mesh(inOut, panelOf(2));
  nearMesh.frustumCulled = false;
  nearMesh.renderOrder = 4;
  body.add(farMesh, nearMesh);

  /* ── the air past its edge ── */
  const haloMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // (Light only: it adds to the page and covers nothing.)
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    uniforms: { ...shared, uAmt: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vQ;
      void main() { vQ = position.xy * 2.1; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uAmt, uShow, uSeed;
      uniform vec3 uHue, uGlowA, uGlowB, uSun;
      varying vec2 vQ;
      ${NOISE}
      void main() {
        float r = length(vQ);
        float o = max(r - 0.84, 0.0);
        vec2 d = vQ / max(r, 1e-3);
        float lit = smoothstep(-0.8, 0.9, dot(d, uSun.xy) + uSun.z * 0.3);
        // Ragged: its edge is never a line.
        float rag = noise3(vec3(d * 2.6, uTime * 0.16 + uSeed)) * 0.6 + noise3(vec3(d * 6.5, -uTime * 0.22 + uSeed)) * 0.4;
        vec3 c = mix(uGlowA, uGlowB, rag) * 0.55 + uHue * 0.45;
        c *= exp(-o * (6.0 - 3.0 * rag)) * 0.14 + exp(-o * 13.0) * 0.14;
        c *= (0.5 + 0.5 * lit) * smoothstep(2.1, 1.4, r);
        gl_FragColor = vec4(c * uAmt * uShow, 0.0);
      }`,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMat);
  halo.renderOrder = 0;
  scene.add(halo);

  /* ── the drops: they come off the edge that leads as it winds, and go round the ball ── */
  const S = phone ? 150 : 340;
  const sSeed = new Float32Array(S * 4);
  for (let i = 0; i < S * 4; i++) sSeed[i] = Math.random();
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(S * 3), 3));
  sGeo.setAttribute("seed", new THREE.BufferAttribute(sSeed, 4));
  const dropUniforms = { ...shared, uRatio: { value: ratio }, uDist: { value: 1000 }, uC0: col(), uC1: col() };
  const dropsOf = (half: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: false,
      defines: { HALF: half },
      uniforms: dropUniforms,
      vertexShader: /* glsl */ `
        ${LIE}
        attribute vec4 seed;
        uniform float uTime, uRatio, uDist, uRoll, uBall, uSeed;
        uniform vec3 uCenter, uSun;
        varying float vA, vRing, vPick;
        void main() {
          // Its place in the disc round the ball: inner ones quicker, some stray above and below.
          float stray = step(0.76, seed.w);
          float r = uR * (1.2 + pow(seed.x, 1.6) * mix(1.05, 0.7, stray));
          float a = seed.z * 6.2832 + uTime * 0.36 / pow(r / uR, 1.5) + uSeed;
          vec3 disc = vec3(cos(a) * r, (seed.y - 0.5) * uR * mix(0.1, 1.35, stray) + sin(a) * r * 0.075, sin(a) * r);
          disc += vec3(uAxis.x, 0.0, uAxis.y);
          // Before that: a drop on the edge that leads, shaken off it as it goes over.
          vec4 c = uProf[${COLS}];
          vec2 d;
          vec3 n;
          vec3 edge = lie(c, seed.y - 0.5, n, d);
          float leave = smoothstep(0.1 + seed.x * 0.5, 0.45 + seed.x * 0.5, uRoll);
          vec3 fly = edge + vec3(c.z, 0.0, c.w) * (6.0 + 90.0 * leave * (0.3 + seed.w)) + n * (30.0 * leave * (seed.z - 0.3)) + vec3(0.0, (seed.w - 0.4) * 50.0 * leave, 0.0);
          float home = smoothstep(0.4 + seed.x * 0.42, 0.72 + seed.x * 0.27, uRoll);
          vec3 p = mix(fly, disc, home);
          vec4 w = modelMatrix * vec4(p, 1.0);
          vec3 rel = w.xyz - uCenter;
          vec4 mv = viewMatrix * w;
          gl_Position = projectionMatrix * mv;
          bool nearer = rel.z >= 0.0;
        #if HALF == 1
          if (nearer) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #else
          if (!nearer) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        #endif
          float big = seed.y * seed.y * seed.y * seed.y;
          gl_PointSize = (1.2 + big * 6.6) * uRatio * (uDist / -mv.z);
          float lit = 0.4 + 0.6 * smoothstep(-0.6, 0.8, dot(normalize(rel), uSun));
          vA = (0.3 + 0.5 * seed.x) * lit * (0.8 + 0.2 * sin(uTime * 1.5 + seed.z * 40.0)) * smoothstep(0.06 + seed.x * 0.34, 0.2 + seed.x * 0.42, uRoll);
          vRing = step(0.5, seed.y);
          vPick = seed.w;
        }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform vec3 uC0, uC1;
        uniform float uShow, uBright;
        varying float vA, vRing, vPick;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p) * 2.0;
          if (d > 1.0) discard;
          // Small ones are motes; a larger one is a drop: a skin, and the light in it.
          float mote = smoothstep(1.0, 0.1, d);
          float skin = smoothstep(1.0, 0.86, d) * (0.16 + 0.84 * smoothstep(0.35, 0.95, d));
          float hi = smoothstep(0.34, 0.05, length(p * 2.0 - vec2(-0.36, -0.38)));
          float low = smoothstep(0.6, 0.0, length(p * 2.0 - vec2(0.3, 0.36))) * 0.35;
          vec3 c = mix(vPick < 0.6 ? uC0 : uC1, vec3(1.0), 0.25);
          vec3 drop = c * (skin * 0.75 + low) + vec3(hi);
          float a = mix(mote, clamp(skin * 0.75 + hi + low, 0.0, 1.0), vRing);
          gl_FragColor = vec4(mix(c, drop / max(a, 0.05), vRing) * uBright, a * vA * uShow);
        }`,
    });
  const dropsFar = new THREE.Points(sGeo, dropsOf(1));
  const dropsNear = new THREE.Points(sGeo, dropsOf(2));
  dropsFar.frustumCulled = dropsNear.frustumCulled = false;
  dropsFar.renderOrder = 1;
  dropsNear.renderOrder = 5;
  body.add(dropsFar, dropsNear);

  /* ── the card's own few motes of dust, drawn to the cursor ── */
  const D = phone ? 22 : 38;
  const dSeed = new Float32Array(D * 4);
  for (let i = 0; i < D * 4; i++) dSeed[i] = Math.random();
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(D * 3), 3));
  dGeo.setAttribute("seed", new THREE.BufferAttribute(dSeed, 4));
  const dustMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      ...shared,
      uBend: { value: 0 },
      uOpen: { value: 1 },
      uMouse: { value: new THREE.Vector2(-9, -9) },
      uMouseAmt: { value: 0 },
      uRatio: { value: ratio },
      uC0: col(),
      uC1: col(),
    },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uBend, uOpen, uMouseAmt, uRatio;
      uniform vec2 uSize, uMouse;
      varying float vA;
      varying float vPick;
      ${BEND}
      void main() {
        // Drifting slowly through the card…
        vec2 home = (seed.xy - 0.5) * (uSize - 36.0);
        vec2 drift = vec2(sin(uTime * (0.12 + seed.z * 0.1) + seed.w * 6.28), cos(uTime * (0.1 + seed.w * 0.08) + seed.z * 6.28)) * vec2(uSize.x * 0.06, uSize.y * 0.08);
        vec2 p = home + drift;
        // …and drawn to the cursor, circling it.
        vec2 m = (uMouse - 0.5) * uSize;
        vec2 toM = m - p;
        float d = length(toM);
        float pull = uMouseAmt * smoothstep(max(240.0, min(uSize.x, uSize.y) * 0.9), 0.0, d);
        vec2 swirl = vec2(-toM.y, toM.x) / max(d, 1.0);
        p += toM * pull * (0.55 + seed.z * 0.3) + swirl * pull * 40.0 * (seed.w - 0.5);
        vec3 q = bendPanel(p, uSize, uBend);
        q.z += 2.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(q, 1.0);
        gl_PointSize = (2.0 + seed.z * 2.6 + pull * 4.5) * uRatio;
        vA = (0.45 + 0.4 * seed.w + pull * 1.2) * uOpen * (0.7 + 0.3 * sin(uTime * 1.7 + seed.x * 30.0));
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
  dust.renderOrder = 6;
  scene.add(dust);

  /* ── the beads the hand throws clear, over this card ── */
  const bs = beadShader(`uniform vec2 uMid; vec4 put(vec2 p) { return projectionMatrix * modelViewMatrix * vec4(p.x - uMid.x, uMid.y - p.y, 3.0, 1.0); }`);
  const beadMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    uniforms: { uMid: { value: new THREE.Vector2() }, uPx: { value: ratio }, uShow: shared.uShow },
    vertexShader: bs.vertex,
    fragmentShader: bs.fragment,
  });
  const beads = beadPoints(THREE, beadMat);
  beads.points.renderOrder = 7;
  scene.add(beads.points);

  let dist = 1000;
  let reachX = 1;
  let reachY = 1;

  /** The sheet, seen along its height: flat on its left, and wound up from its right edge as
   *  far as it has come — a scroll, whose turns lie one round another. */
  const rolled = (roll: number, L: number, R: number, spin: number, t: number): [number, number] => {
    const p = smooth(0, 0.8, roll);
    // (Wound small at first; opened out to the ball as it closes.)
    const c = smooth(0.52, 1, roll);
    const ra = R * mix(0.21, 0.46, c);
    const rb = R * mix(0.57, 1, c);
    const soft = mix(0.17, 0.05, smooth(0.5, 0.9, roll));
    const front = p * (1 + soft);
    const ds = L / COLS;
    // (The rest of it is not left flat: the whole body bows, and the pull runs through it.)
    const pull = Math.sin(Math.PI * Math.min(1, roll * 1.1));
    const ripple = (pull * 0.4) / L;
    const bow = pull / L;
    let th = -bow * L * (1 - p) * 0.42;
    let x = 0;
    let z = 0;
    let ax = 0;
    let az = 0;
    let n = 0;
    for (let i = 0; i <= COLS; i++) {
      const o = i * 4;
      prof[o] = x;
      prof[o + 1] = z;
      prof[o + 2] = Math.cos(th);
      prof[o + 3] = Math.sin(th);
      const u = (i + 0.5) / COLS;
      // How far from its right edge, and how tight the scroll is there.
      const s = Math.max(0, 1 - u);
      const on = smooth(front, front - soft, s);
      const r = Math.sqrt(ra * ra + (rb * rb - ra * ra) * s);
      const k = on / r + (1 - on) * (bow + ripple * Math.sin(u * 9 - t * 1.4));
      // The middle of the bend here: the scroll's axis is the middle of all of them.
      if (on > 0.9) {
        ax += x - Math.sin(th) * r;
        az += z + Math.cos(th) * r;
        n++;
      }
      const m = th + (k * ds) / 2;
      x += Math.cos(m) * ds;
      z += Math.sin(m) * ds;
      th += k * ds;
    }
    if (n) {
      ax /= n;
      az /= n;
    } else {
      ax = prof[COLS * 4];
      az = prof[COLS * 4 + 1] + ra;
    }
    // Its middle stays in the middle: of the card at first, of the ball at last.
    const sx = L / 2 + (ax - L / 2) * p;
    const sz = az * smooth(0.15, 1, p);
    // …and, all but closed, it turns about its axis.
    const a = spin * smooth(0.72, 1, roll);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (let i = 0; i <= COLS; i++) {
      const o = i * 4;
      const dx = prof[o] - ax;
      const dz = prof[o + 1] - az;
      prof[o] = dx * ca - dz * sa + ax - sx;
      prof[o + 1] = dx * sa + dz * ca + az - sz;
      const tx = prof[o + 2];
      const tz = prof[o + 3];
      prof[o + 2] = tx * ca - tz * sa;
      prof[o + 3] = tx * sa + tz * ca;
    }
    return [ax - sx, az - sz];
  };

  const set = (u: { value: THREE_NS.Color }, v: V3) => u.value.setRGB(v[0], v[1], v[2]);

  return {
    scene,
    camera,
    view(cw, ch) {
      camera.aspect = cw / ch;
      dist = ch / 2 / Math.tan((FOV / 2) * (Math.PI / 180));
      camera.position.set(0, 0, dist);
      camera.near = Math.max(1, dist - 2000);
      camera.far = dist + 2000;
      camera.updateProjectionMatrix();
      dropUniforms.uDist.value = dist;
      reachY = Math.tan((FOV / 2) * (Math.PI / 180));
      reachX = reachY * camera.aspect;
    },
    theme(k) {
      set(pu.uBase0, k.base0);
      set(pu.uBase1, k.base1);
      set(shared.uRim1, k.rim1);
      set(shared.uRim2, k.rim2);
      set(shared.uGlowA, k.glowA);
      set(shared.uGlowB, k.glowB);
      set(pu.uFront, k.front);
      pu.uLight.value = k.light;
      set(dropUniforms.uC0, k.rim2);
      set(dropUniforms.uC1, k.front);
      set(dustMat.uniforms.uC0 as { value: THREE_NS.Color }, k.dust0);
      set(dustMat.uniforms.uC1 as { value: THREE_NS.Color }, k.front);
      dustMat.blending = k.light ? THREE.NormalBlending : THREE.AdditiveBlending;
      dustMat.needsUpdate = true;
      // (On a light ground there is no light to add.)
      haloMat.visible = !k.light;
    },
    liquid(t) {
      pu.uLiquid.value = t;
    },
    ink(t) {
      pu.uInk.value = t ?? blank;
    },
    look(l) {
      const { roll } = l;
      shared.uTime.value = l.t;
      shared.uShow.value = l.show;
      set(shared.uHue, l.hue);
      size.set(l.w, l.h);
      pu.uRadius.value = l.radius;
      pu.uBend.value = l.bend;
      shared.uRoll.value = roll;
      pu.uMouse.value.set(l.mouse[0], l.mouse[1]);
      pu.uMouseAmt.value = l.mouseAmt;
      shared.uSeed.value = l.seed;
      pu.uInkOn.value = l.ink;
      const hand = l.stirred && roll < 0.0005;
      pu.uFlowOn.value = hand ? 1 : 0;
      beads.points.visible = false;
      if (hand) {
        pu.uPlace.value.set(l.place[0], l.place[1]);
        pu.uScreen.value.set(water.w, water.h);
        flow.update();
        beadMat.uniforms.uMid.value.set(l.place[0] + l.w / 2, l.place[1] + l.h / 2);
        beads.update();
      }
      const du = dustMat.uniforms;
      du.uBend.value = l.bend;
      du.uOpen.value = 1 - smooth(0, 0.2, roll);
      du.uMouse.value.set(l.mouse[0], l.mouse[1]);
      du.uMouseAmt.value = l.mouseAmt;
      dust.visible = roll < 0.2;

      // The light is the spine's: from the left of it, from the right, or (behind it)
      // from in front.
      const side = Math.max(-1, Math.min(1, l.side));
      const behind = 1 - Math.abs(side);
      sun.set(-0.88 * side - 0.42 * behind, 0.34 + 0.16 * behind, 0.3 + 0.34 * behind).normalize();

      const ball = smooth(0.66, 1, roll);
      shared.uBall.value = ball;
      shared.uBright.value = l.bright;
      const bent = roll >= 0.0005;
      nearMesh.visible = bent;
      halo.visible = bent && !l.surface && ball > 0.002;
      dropsFar.visible = dropsNear.visible = bent && !l.surface;
      if (!bent) {
        body.rotation.set(0, 0, 0);
        body.position.set(0, 0, 0);
        body.scale.setScalar(1);
        shared.uPinch.value = 0;
        return;
      }

      // Long enough for a turn and a half round the ball.
      const need = Math.PI * 1.46 * l.R * 1.5;
      const L = l.w + Math.max(0, need - l.w) * smooth(0.35, 0.95, roll);
      const [ax, az] = rolled(roll, L, l.R, l.spin * Math.PI * 2, l.t + l.seed);
      const pinch = smooth(0.34, 0.88, roll);
      axis.set(ax, az);
      shared.uPinch.value = pinch;
      shared.uR.value = l.R;

      // It turns as it winds, and you look down into it; closed, it leans on its own axis.
      const turn = Math.sin(Math.PI * Math.min(1, roll));
      body.rotation.set(0.5 * smooth(0, 0.34, roll) * (1 - 0.42 * smooth(0.6, 1, roll)), -0.26 * turn, -0.2 * smooth(0.5, 1, roll), "ZXY");
      body.position.set(0, 0, 0);
      body.scale.setScalar(1);
      body.updateMatrixWorld();
      // Never past its canvas's edges: what comes nearest to them says how much smaller it
      // must be drawn.
      let most = 0;
      const tall = (l.h / 2) * Math.cos((Math.PI / 2) * pinch * 0.9);
      for (let i = 0; i <= COLS; i += COLS >> 3) {
        for (const y of [tall, -tall]) {
          at.set(prof[i * 4], y, prof[i * 4 + 1]).applyMatrix4(body.matrixWorld);
          most = Math.max(most, Math.abs(at.x) / ((dist - at.z) * reachX), Math.abs(at.y) / ((dist - at.z) * reachY));
        }
      }
      if (most > 0.97) {
        body.scale.setScalar(0.97 / most);
        body.updateMatrixWorld();
      }
      center.set(ax, 0, az).applyMatrix4(body.matrixWorld);
      halo.position.copy(center);
      halo.position.z -= 2;
      halo.scale.setScalar(l.R * body.scale.x * 2.1 * 1.02);
      haloMat.uniforms.uAmt.value = ball;
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (m.geometry) m.geometry.dispose();
        (m.material as THREE_NS.Material | undefined)?.dispose();
      });
      flow.dispose();
      beads.dispose();
      blank.dispose();
    },
  };
}
