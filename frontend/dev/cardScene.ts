// One card, drawn: the glass it is in the present, the world it is away, and the
// sheet rolling from the one into the other (§104.1, §104.6).
//
//   "those 2 cards… they are not curving, they still be a rectangle, shrinking,
//    and the edges curve and [it] becomes that ball… I want that rectangle to
//    curve: right whole body curve till left, until it fully becomes that ball"
//    (24 Nov)
//
// So it does, as a sheet would. Its right edge lifts towards you, curls over and
// rolls to the left, taking up the card as it goes; its top and bottom are drawn
// in to the poles as the roll tightens; and the last of it closes the globe. The
// card's face is the inside; its BACK is the surface of a world (worlds.ts), so
// what comes over with the curl is land and cloud, and nothing is faded into
// anything. It opens the same way: the globe unrolls into the card.
//
// The shape is worked out here, column by column (a sheet whose bend travels along
// it), and handed to one mesh; the same mesh, flat, is the card, and, closed, the
// world. Round it: the air seen past its edge, rings, moons, and a thin belt of dust.

import type * as THREE_NS from "three";
import { beadPoints, beadShader, COME_APART, flowTexture, SURFACE_LIGHT, water } from "./flow";
import type { World } from "./worlds";

type Three = typeof THREE_NS;
type V3 = readonly number[];

const COLS = 72;
const ROWS = 40;
const MOONS = 3;
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

const LIGHT = /* glsl */ `
  vec3 toLin(vec3 c) { return c * (c * (c * 0.305306 + 0.682171) + 0.012523); }
  vec3 film(vec3 x) {
    x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
    return pow(x, vec3(0.4545));
  }
  float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }
  float grain1(float x) { float i = floor(x); float f = x - i; return mix(hash1(i), hash1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
  // Saturn's rings, by distance from its middle: how much of them is there.
  float ringAt(float r) {
    float c = smoothstep(1.22, 1.27, r) * smoothstep(1.54, 1.5, r) * (0.12 + 0.16 * smoothstep(1.24, 1.52, r));
    float b = smoothstep(1.51, 1.55, r) * smoothstep(1.955, 1.94, r);
    b *= 0.72 + 0.28 * smoothstep(1.55, 1.75, r);
    float a = smoothstep(2.02, 2.035, r) * smoothstep(2.275, 2.262, r) * 0.62;
    a *= 1.0 - 0.95 * smoothstep(0.007, 0.002, abs(r - 2.214));
    float div = smoothstep(1.94, 1.96, r) * smoothstep(2.035, 2.01, r) * 0.07;
    float f = 0.16 * smoothstep(0.008, 0.0, abs(r - 2.33));
    float fine = 0.74 + 0.34 * grain1(r * 92.0) + 0.2 * (grain1(r * 310.0) - 0.5);
    return clamp((c + b + a + div) * fine + f, 0.0, 1.0);
  }
`;

export type CardLook = {
  w: number;
  h: number;
  /** The world's radius. */
  R: number;
  radius: number;
  /** 0: flat, the card; 1: closed, the world. */
  roll: number;
  bend: number;
  show: number;
  t: number;
  seed: number;
  /** How far the world has turned. */
  spin: number;
  /** Where it is on its way round the spine: 1 to the right of it, 0 behind it, −1 to the left. */
  side: number;
  /** It is on its way in (1) or out (−1). */
  way: number;
  mouse: readonly [number, number];
  mouseAmt: number;
  /** The hand is in the water here (flow.ts), and where the card's top left is on the screen. */
  stirred: boolean;
  place: readonly [number, number];
  hue: V3;
  /** How bright it is drawn: less where it is far behind. */
  bright: number;
  surface: boolean;
};

export type CardTheme = { base0: V3; base1: V3; rim1: V3; rim2: V3; front: V3; dust0: V3; light: number };

export type CardScene = {
  scene: THREE_NS.Scene;
  camera: THREE_NS.PerspectiveCamera;
  /** Its view of a card in a surface of this size. */
  view: (cw: number, ch: number) => void;
  theme: (k: CardTheme) => void;
  liquid: (t: THREE_NS.Texture) => void;
  /** Which world it is, its pictures (null: not here yet). */
  world: (w: World, map: THREE_NS.Texture | null, extra: THREE_NS.Texture | null) => void;
  look: (l: CardLook) => void;
  dispose: () => void;
};

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function makeCardScene(THREE: Three, ratio: number, phone: boolean): CardScene {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 9000);
  const col = () => ({ value: new THREE.Color() });
  const body = new THREE.Group();
  scene.add(body);
  const sun = new THREE.Vector3(-0.8, 0.35, 0.55);
  const center = new THREE.Vector3();
  const at = new THREE.Vector3();
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blank.needsUpdate = true;
  const prof = new Float32Array((COLS + 1) * 4);
  const flow = flowTexture(THREE);
  const shared = {
    uTime: { value: 0 },
    uShow: { value: 1 },
    uSun: { value: sun },
    uHue: col(),
  };

  /* ── the sheet ── */
  const sheet = new THREE.PlaneGeometry(1, 1, COLS, ROWS);
  const panelMat = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    forceSinglePass: true,
    depthWrite: true,
    uniforms: {
      ...shared,
      uProf: { value: prof },
      uAxis: { value: new THREE.Vector2() },
      uPinch: { value: 0 },
      uRoll: { value: 0 },
      uR: { value: 100 },
      uRs: { value: 100 },
      uBend: { value: 0 },
      uSize: { value: new THREE.Vector2(300, 200) },
      uRadius: { value: 16 },
      uCenter: { value: center },
      uLiquid: { value: blank as THREE_NS.Texture },
      uMouse: { value: new THREE.Vector2(-9, -9) },
      uMouseAmt: { value: 0 },
      uFlow: { value: flow.tex as THREE_NS.Texture },
      uSlope: { value: flow.slope as THREE_NS.Texture },
      uFlowOn: { value: 0 },
      uPlace: { value: new THREE.Vector2() },
      uScreen: { value: new THREE.Vector2(1, 1) },
      uSeed: { value: 0 },
      uLight: { value: 0 },
      uBase0: col(),
      uBase1: col(),
      uRim1: col(),
      uRim2: col(),
      uFront: col(),
      uMap: { value: blank as THREE_NS.Texture },
      uExtra: { value: blank as THREE_NS.Texture },
      uHas: { value: 0 },
      uExtraOn: { value: 0 },
      uSpin: { value: 0 },
      uAir: { value: new THREE.Color(1, 1, 1) },
      uAirK: { value: 0 },
      uBump: { value: 0 },
      uWinds: { value: 0 },
      uSea: { value: 0 },
      uAurora: { value: 0 },
      uGain: { value: 1 },
      uMoons: { value: Array.from({ length: MOONS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uRingN: { value: new THREE.Vector3(0, 1, 0) },
      uRing: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uProf[${COLS + 1}];
      uniform vec2 uSize, uAxis;
      uniform vec3 uCenter;
      uniform float uPinch, uRoll, uR, uBend;
      varying vec2 vUv;
      varying vec3 vN, vP, vRel;
      varying float vOff;
      ${BEND}
      void main() {
        vUv = uv;
        vec3 q, n;
        vOff = 9.0;
        if (uRoll < 0.0005) {
          q = bendPanel(position.xy * uSize, uSize, uBend);
          n = vec3(0.0, 0.0, 1.0);
        } else {
          // This column of the sheet, as it lies now…
          vec4 c = uProf[int(uv.x * ${COLS}.0 + 0.5)];
          // …and this row: drawn in to the axis of the roll, to the poles at last.
          float f = position.y * 3.14159265;
          float s = cos(f * uPinch);
          float ds = -sin(f * uPinch) * 3.14159265 * uPinch;
          float y = mix(position.y * uSize.y, uR * sin(f), uPinch);
          float dy = mix(uSize.y, uR * 3.14159265 * cos(f), uPinch);
          vec2 d = c.xy - uAxis;
          q = vec3(uAxis.x + d.x * s, y, uAxis.y + d.y * s);
          n = normalize(cross(vec3(c.z, 0.0, c.w), vec3(d.x * ds, dy, d.y * ds)));
          vOff = d.x / uR;
        }
        vec4 w = modelMatrix * vec4(q, 1.0);
        vRel = w.xyz - uCenter;
        vec4 mv = viewMatrix * w;
        vP = mv.xyz;
        vN = normalize(normalMatrix * n);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uLiquid, uMap, uExtra, uFlow, uSlope;
      uniform vec2 uSize, uMouse, uPlace, uScreen;
      uniform vec3 uBase0, uBase1, uRim1, uRim2, uFront, uHue, uSun, uAir, uRingN;
      uniform vec4 uMoons[${MOONS}];
      uniform float uTime, uShow, uMouseAmt, uFlowOn, uSeed, uLight, uRadius, uRoll, uR, uHas, uExtraOn, uSpin, uAirK, uBump, uWinds, uSea, uAurora, uGain, uRing, uRs;
      varying vec2 vUv;
      varying vec3 vN, vP, vRel;
      varying float vOff;
      ${LIGHT}
      const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
      // What the water does here (px from the card's top left).
      vec4 flowAt(vec2 p) { return textureLod(uFlow, (uPlace + p) / uScreen, 0.0); }
      ${COME_APART}
      ${SURFACE_LIGHT}
      mat2 rot(float a) { float c = cos(a); float s = sin(a); return mat2(c, -s, s, c); }

      vec3 world(vec3 n, vec3 v) {
        vec2 st = vec2(1.0 - vUv.x + uSpin, vUv.y);
        vec3 c;
        if (uHas < 0.5) {
          c = texture2D(uLiquid, st * vec2(2.0, 1.0)).rgb * 0.5 + 0.12;
        } else if (uWinds > 0.0) {
          // Its winds: the bands slide past one another (two pictures of it, each drawn
          // on a little way and begun again while the other covers for it).
          float la = (vUv.y - 0.5) * 3.14159;
          float jet = (sin(la * 11.0) * 0.6 + sin(la * 23.0 + 1.3) * 0.4) * uWinds * cos(la) * 0.05;
          float f1 = fract(uTime * 0.04);
          float f2 = fract(uTime * 0.04 + 0.5);
          c = mix(texture2D(uMap, st + vec2(jet * (f1 - 0.5), 0.0)).rgb, texture2D(uMap, st + vec2(jet * (f2 - 0.5), 0.0)).rgb, abs(f1 * 2.0 - 1.0));
        } else {
          c = texture2D(uMap, st).rgb;
        }
        vec3 N = n;
        vec3 T = vec3(0.0);
        vec3 B = vec3(0.0);
        if (uBump > 0.0) {
          // Relief, from the map's own light and dark.
          vec2 e = vec2(1.6 / 1024.0, 1.6 / 512.0);
          float h = dot(c, LUM);
          float hx = dot(texture2D(uMap, st + vec2(e.x, 0.0)).rgb, LUM) - h;
          float hy = dot(texture2D(uMap, st + vec2(0.0, e.y)).rgb, LUM) - h;
          vec3 d1 = dFdx(vP);
          vec3 d2 = dFdy(vP);
          vec2 s1 = dFdx(st);
          vec2 s2 = dFdy(st);
          float det = s1.x * s2.y - s2.x * s1.y;
          T = (d1 * s2.y - d2 * s1.y) * sign(det);
          B = (d2 * s1.x - d1 * s2.x) * sign(det);
          float inv = inversesqrt(max(max(dot(T, T), dot(B, B)), 1e-12));
          T *= inv;
          B *= inv;
          N = normalize(n - (T * hx + B * hy) * uBump * 2.6);
        }
        float cloud = 0.0;
        float under = 0.0;
        float city = 0.0;
        if (uExtraOn > 0.5) {
          vec2 cs = vec2(st.x + uTime * 0.0016, clamp(vUv.y, 0.004, 0.996) * 0.5 + 0.5);
          cloud = texture2D(uExtra, cs).r;
          under = texture2D(uExtra, cs + vec2(dot(uSun, T) * 0.007, dot(uSun, B) * 0.005)).r;
          city = texture2D(uExtra, vec2(st.x, clamp(vUv.y, 0.004, 0.996) * 0.5)).r;
        }

        float g = dot(n, uSun);
        // (Through air, and over cloud, dusk is wide; on bare rock it is a line.)
        float wrap = 0.04 + 0.12 * uAirK + 0.2 * min(1.0, uWinds);
        float day = max(0.0, (dot(N, uSun) + wrap) / (1.0 + wrap));
        day = day * mix(1.0, day, 0.35) * 1.18 * smoothstep(-0.05 - wrap, 0.1, g);
        // Shadows: of its moons, and of its rings.
        for (int i = 0; i < ${MOONS}; i++) {
          vec3 m = uMoons[i].xyz - vRel;
          float along = dot(m, uSun);
          if (uMoons[i].w > 0.0 && along > 0.0) day *= 1.0 - 0.94 * smoothstep(uMoons[i].w * 1.2, uMoons[i].w * 0.55, length(m - uSun * along));
        }
        if (uRing > 0.0) {
          float k = -dot(vRel, uRingN) / dot(uSun, uRingN);
          if (k > 0.0) day *= 1.0 - 0.78 * uRing * ringAt(length(vRel + uSun * k) / uRs);
        }

        vec3 alb = toLin(c) * (1.0 - 0.55 * under * (1.0 - cloud));
        // Dusk: through so much air the light comes red.
        vec3 sunlight = vec3(1.0, 0.965, 0.91) * 2.05 * mix(vec3(1.0), vec3(1.0, 0.5, 0.24), uAirK * 0.8 * exp(-max(g, 0.0) * 6.5));
        vec3 hue = toLin(uHue);
        vec3 back = normalize(vec3(-uSun.x, -0.25, 0.3));
        vec3 amb = vec3(0.010, 0.012, 0.018) + hue * (0.012 + 0.075 * max(0.0, dot(N, back)));
        vec3 colr = alb * (sunlight * day + amb);
        // Water: the sun in it, and the sky.
        float sea = uSea * smoothstep(0.02, 0.09, c.b - max(c.r, c.g) * 1.05) * (1.0 - cloud);
        if (sea > 0.0) {
          float nh = max(0.0, dot(n, normalize(uSun + v)));
          colr += sunlight * day * sea * (pow(nh, 90.0) * 0.5 + pow(nh, 14.0) * 0.07);
        }
        colr = mix(colr, vec3(0.86) * (sunlight * max(0.0, (g + 0.12) / 1.12) * smoothstep(-0.2, 0.1, g) * (0.75 + 0.25 * dot(N, uSun)) + amb * 1.4), cloud);
        float night = 1.0 - smoothstep(-0.1, 0.1, g);
        colr += vec3(1.0, 0.56, 0.2) * city * (0.4 + city) * night * (1.0 - cloud * 0.85) * 1.5;
        // Towards its edge: gas goes dark; air lights up.
        float nv = max(0.0, dot(n, v));
        colr *= mix(1.0, pow(nv + 0.02, 0.42), min(1.0, uWinds) * 0.75);
        float f = 1.0 - nv;
        colr += toLin(uAir) * uAirK * (f * f * f * 1.1 + f * f * 0.08) * smoothstep(-0.3, 0.6, g) * 1.3;
        colr += hue * f * f * f * (0.07 + 0.13 * (1.0 - smoothstep(-0.3, 0.3, g)));
        if (uAurora > 0.0) {
          float al = abs(vUv.y - 0.5) * 2.0;
          float lon = st.x * 6.2832;
          float band = exp(-pow((al - 0.755 - 0.018 * sin(lon * 3.0 + uTime * 0.2)) / 0.03, 2.0));
          float curtain = 0.5 + 0.5 * sin(lon * 17.0 + uTime * 0.8 + 2.0 * sin(lon * 5.0 - uTime * 0.5));
          colr += mix(vec3(0.1, 1.0, 0.5), vec3(0.5, 0.3, 1.0), curtain * 0.4) * band * (0.25 + 0.75 * curtain) * (1.0 - smoothstep(-0.25, 0.2, g)) * uAurora * 0.5 * smoothstep(0.86, 1.0, uRoll);
        }
        return film(colr * uGain);
      }

      void main() {
        // Its outline: the card's, its corners gone by the time it closes.
        vec2 px = (vUv - 0.5) * uSize;
        float corner = uRadius * (1.0 - smoothstep(0.7, 0.96, uRoll));
        vec2 q = abs(px) - (uSize * 0.5 - corner);
        float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;
        // (As soft as a pixel is wide: the sheet is seen from its edge, too.)
        float aa = clamp(fwidth(sd), 0.8, 12.0);
        float inside = max(smoothstep(aa, -aa, sd), smoothstep(0.94, 1.0, uRoll));
        if (inside < 0.01) discard;
        vec3 n = normalize(vN);
        vec3 v = normalize(-vP);
        float mid = smoothstep(0.0, 0.12, uRoll) * (1.0 - smoothstep(0.82, 0.98, uRoll));

        // The edges as it rolls: the one that leads (its right), and the one it comes to.
        float lead = exp(-(1.0 - vUv.x) * uSize.x / 4.5);
        float tail = exp(-vUv.x * uSize.x / 4.5) * smoothstep(0.4, 0.8, uRoll);
        float edge = (lead + tail * 0.8) * mid;
        float rimBand = smoothstep(1.6, 0.0, abs(sd + 1.0)) * smoothstep(5.0, 1.6, aa);

        vec3 colr;
        float alpha;
        if (uRoll > 0.0005 && !gl_FrontFacing) {
          // ── its back: the world ──
          n = -n;
          colr = world(n, v);
          // The sheet has a thickness: its crust, lit along the cut.
          float crust = smoothstep(-7.0, -0.5, sd) * (1.0 - smoothstep(0.8, 0.96, uRoll));
          colr *= 1.0 - 0.55 * crust;
          colr += mix(uFront, uHue, 0.35) * rimBand * 0.6 * (1.0 - smoothstep(0.75, 0.95, uRoll));
          colr += uFront * edge * 1.25;
          alpha = 1.0;
        } else {
          // ── its face: dark glass, and the water in it ──
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
          // The water: two sheets of the theme's painted texture, drifting against each
          // other all the time.
          float span = max(asp, 1.0);
          vec2 base = (vUv - 0.5) * vec2(asp, 1.0) / span * 0.92;
          vec2 u1 = rot(0.18 * sin(uTime * 0.05 + uSeed)) * base * 1.05 + 0.5 + vec2(0.07 * sin(uTime * 0.13 + uSeed), 0.06 * cos(uTime * 0.11)) + push;
          vec2 u2 = rot(3.14159 + 0.2 * cos(uTime * 0.04 + uSeed)) * base * 1.18 + 0.5 + vec2(-0.06 * cos(uTime * 0.09), 0.07 * sin(uTime * 0.12 + uSeed)) - push * 0.6;
          vec4 A = texture2D(uLiquid, u1);
          vec4 B = texture2D(uLiquid, u2);
          // Where it is stirred the colours split and scatter.
          float split = min(1.0, fl.z * 1.2 + length(slope) * 0.4) * 0.024;
          float Ar = texture2D(uLiquid, u1 + vec2(split, split * 0.4)).r;
          float Ab = texture2D(uLiquid, u1 - vec2(split, split * 0.4)).b;
          vec3 wa = vec3(Ar, A.g, Ab) * A.a;
          vec3 wb = B.rgb * B.a * 0.6;
          vec3 water = 1.0 - (1.0 - wa) * (1.0 - wb);
          float wA = clamp(max(A.a, B.a * 0.6) * 1.35, 0.0, 1.0);
          vec3 glass = mix(uBase1, uBase0, vUv.y * 0.85 + 0.1);
          colr = mix(glass, glass * 0.55 + water, (0.42 + 0.3 * smoothstep(0.02, 0.4, fl.z)) * wA);
          alpha = mix(0.9, 0.86, uLight);
          // an inner light at the top edge
          colr += vec3(0.07) * smoothstep(uSize.y * 0.5 - 2.5, uSize.y * 0.5, px.y + 0.5) * inside;
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
          // The rim: a hairline whose colour turns round the card.
          float ang = atan(px.y, px.x);
          vec3 rim = mix(mix(uHue, uRim1, 0.5 + 0.5 * sin(ang + uTime * 0.25)), uRim2, 0.5 + 0.5 * sin(ang * 2.0 - uTime * 0.18));
          colr = mix(colr, rim, rimBand * 0.65);
          if (uRoll > 0.0005) {
            // It bends, and the light runs along the bend; under the roll it is dark.
            float face = abs(dot(n, v));
            float turned = smoothstep(0.0, 0.25, uRoll);
            colr *= mix(1.0, 0.35 + 0.65 * face, turned);
            float nh = max(0.0, dot(n, normalize(uSun + v)));
            colr += (vec3(0.9, 0.96, 1.0) * pow(nh, 70.0) * 0.5 + rim * pow(nh, 12.0) * 0.16) * turned;
            colr += rim * pow(1.0 - face, 3.0) * 0.5 * turned;
            float near = exp(-max(0.0, -vOff) * 1.5) * smoothstep(0.12, 0.45, uRoll);
            colr *= 1.0 - 0.62 * near;
            colr += uAir * uAirK * 0.06 * near;
            colr += uFront * edge;
            alpha = mix(alpha, 0.97, turned);
          }
        }
        gl_FragColor = vec4(colr, alpha * inside * uShow);
      }`,
  });
  const panel = new THREE.Mesh(sheet, panelMat);
  panel.frustumCulled = false;
  panel.renderOrder = 2;
  body.add(panel);

  /* ── the air past its edge (and a plume) ── */
  const haloMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    // (Light only: it adds to the page and covers nothing.)
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: true,
    uniforms: { ...shared, uAmt: { value: 0 }, uAir: { value: new THREE.Color(1, 1, 1) }, uAirK: { value: 0 }, uPlume: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vQ;
      void main() { vQ = position.xy * 2.1; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uTime, uAmt, uShow, uAirK, uPlume;
      uniform vec3 uHue, uAir, uSun;
      varying vec2 vQ;
      ${LIGHT}
      void main() {
        float r = length(vQ);
        float o = max(r - 0.985, 0.0);
        vec2 d = vQ / max(r, 1e-3);
        float lit = smoothstep(-0.7, 0.9, dot(d, uSun.xy) + uSun.z * 0.3);
        float thin = exp(-o * 26.0) * 0.8 + exp(-o * 8.0) * 0.2;
        vec3 c = uAir * uAirK * thin * lit * 0.7 + uHue * (exp(-o * 4.2) * 0.07 + exp(-o * 12.0) * 0.06) * (0.35 + 0.65 * lit);
        if (uPlume > 0.0) {
          // Water, thrown out of the south into the dark, and lit there.
          float down = -vQ.y - 0.86;
          float fan = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            float x = vQ.x - (fi - 1.5) * 0.12 - down * (fi - 1.5) * 0.16;
            float w = 0.02 + down * 0.16;
            fan += exp(-(x * x) / (w * w)) * (0.6 + 0.4 * grain1(down * 9.0 - uTime * (0.7 + fi * 0.13) + fi * 7.0));
          }
          c += vec3(0.72, 0.9, 1.0) * fan * smoothstep(0.0, 0.1, down) * exp(-down * 2.3) * 0.32 * uPlume;
        }
        c *= smoothstep(2.1, 1.5, r);
        gl_FragColor = vec4(c * uAmt * uShow, 0.0);
      }`,
  });
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), haloMat);
  halo.renderOrder = 0;
  scene.add(halo);

  /* ── rings ── */
  const ringMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: { ...shared, uAmt: { value: 0 }, uR: { value: 100 }, uCenter: { value: center } },
    vertexShader: /* glsl */ `
      uniform vec3 uCenter;
      varying vec3 vL, vRel;
      void main() {
        vL = position;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vRel = w.xyz - uCenter;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uAmt, uShow, uR;
      uniform vec3 uSun;
      varying vec3 vL, vRel;
      ${LIGHT}
      void main() {
        float r = length(vL.xz);
        float d = ringAt(r);
        float along = dot(vRel, uSun);
        float off = length(vRel - uSun * along) / uR;
        float shade = along < 0.0 ? smoothstep(0.94, 1.02, off) : 1.0;
        vec3 tone = mix(vec3(0.40, 0.33, 0.25), vec3(0.93, 0.85, 0.71), smoothstep(1.3, 1.7, r) * (0.75 + 0.25 * grain1(r * 60.0)));
        vec3 c = film(toLin(tone) * (0.03 + 1.75 * shade));
        gl_FragColor = vec4(c, d * uAmt * uShow);
      }`,
  });
  const ringGeo = new THREE.RingGeometry(1.2, 2.36, phone ? 72 : 112, 1);
  ringGeo.rotateX(-Math.PI / 2);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.frustumCulled = false;
  ring.renderOrder = 3;
  body.add(ring);

  /* ── moons ── */
  const moonMat = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { ...shared, uAmt: { value: 0 }, uTint: col(), uSeed: { value: 0 }, uR: { value: 100 }, uCenter: { value: center } },
    vertexShader: /* glsl */ `
      uniform vec3 uCenter;
      varying vec3 vN, vD, vRel;
      void main() {
        vD = position;
        vN = normalize(normalMatrix * position);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vRel = w.xyz - uCenter;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform float uAmt, uShow, uSeed, uR;
      uniform vec3 uTint, uSun, uHue;
      varying vec3 vN, vD, vRel;
      ${LIGHT}
      float h3(vec3 p) { p = fract(p * 0.3183 + 0.1 + uSeed); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float n3(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      void main() {
        float m = n3(vD * 3.0) * 0.55 + n3(vD * 7.0) * 0.3 + n3(vD * 16.0) * 0.15;
        vec3 n = normalize(vN);
        float along = dot(vRel, uSun);
        float shade = along < 0.0 ? smoothstep(0.9, 1.02, length(vRel - uSun * along) / uR) : 1.0;
        vec3 c = toLin(uTint) * (0.35 + 1.1 * m) * (vec3(2.3, 2.2, 2.05) * max(0.0, dot(n, uSun)) * shade + 0.01 + toLin(uHue) * 0.015);
        gl_FragColor = vec4(film(c), uAmt * uShow);
      }`,
  });
  const ballGeo = new THREE.IcosahedronGeometry(1, 4);
  const moons = Array.from({ length: MOONS }, (_, i) => {
    const mat = moonMat.clone();
    Object.assign(mat.uniforms, { uTime: shared.uTime, uShow: shared.uShow, uSun: shared.uSun, uHue: shared.uHue, uCenter: { value: center } });
    mat.uniforms.uSeed.value = i * 0.37;
    const m = new THREE.Mesh(ballGeo, mat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    body.add(m);
    return { m, mat };
  });

  /* ── a thin belt of dust round it, lit, and dark where the world's shadow falls ── */
  const S = phone ? 150 : 300;
  const sSeed = new Float32Array(S * 4);
  for (let i = 0; i < S * 4; i++) sSeed[i] = Math.random();
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(S * 3), 3));
  sGeo.setAttribute("seed", new THREE.BufferAttribute(sSeed, 4));
  const beltMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...shared, uR: { value: 100 }, uRs: { value: 100 }, uAmt: { value: 0 }, uOut: { value: 0 }, uRatio: { value: ratio }, uDist: { value: 1000 }, uC0: col(), uC1: col(), uCenter: { value: center } },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uTime, uR, uRs, uRatio, uDist, uOut;
      uniform vec3 uSun, uCenter;
      varying float vA, vPick;
      void main() {
        // A disc of grains, the inner ones quicker; some stray above it and below.
        float far = step(0.82, seed.w);
        float r = uR * (1.32 + pow(seed.x, 1.5) * mix(1.15, 0.8, far)) * (1.0 + uOut * (0.5 + seed.y * 1.8));
        float a = seed.z * 6.2832 + uTime * 0.34 / pow(r / uR, 1.5);
        float y = (seed.y - 0.5) * uR * mix(0.05, 1.3, far);
        vec4 w = modelMatrix * vec4(cos(a) * r, y, sin(a) * r, 1.0);
        vec3 rel = w.xyz - uCenter;
        float along = dot(rel, uSun);
        float shade = along < 0.0 ? smoothstep(0.85, 1.05, length(rel - uSun * along) / uRs) : 1.0;
        vec4 mv = viewMatrix * w;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.1 + seed.y * seed.y * seed.y * 2.6) * uRatio * (uDist / -mv.z);
        vA = (0.22 + 0.5 * seed.x * seed.x) * (0.12 + 0.88 * shade) * (0.75 + 0.25 * sin(uTime * 1.6 + seed.z * 40.0));
        vPick = seed.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC0, uC1;
      uniform float uAmt, uShow;
      varying float vA, vPick;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        vec3 c = vPick < 0.5 ? vec3(0.95, 0.92, 0.86) : vPick < 0.75 ? uC0 : uC1;
        gl_FragColor = vec4(c, smoothstep(0.5, 0.1, d) * vA * uAmt * uShow);
      }`,
  });
  const belt = new THREE.Points(sGeo, beltMat);
  belt.frustumCulled = false;
  belt.renderOrder = 4;
  body.add(belt);

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
      uSize: { value: new THREE.Vector2(300, 200) },
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
  dust.renderOrder = 5;
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
  beads.points.renderOrder = 6;
  scene.add(beads.points);

  let which: World | null = null;
  let dist = 1000;
  let reachX = 1;
  let reachY = 1;

  /** The sheet, seen along its height: flat on its left, its bend begun somewhere and
   *  as tight as the world from there to its right edge. */
  const rolled = (roll: number, L: number, t: number): [number, number, number, number] => {
    const p = smooth(0, 0.88, roll);
    const soft = 0.2 - 0.08 * p;
    const front = 1 - p * (1 + soft);
    const tight = (Math.PI * 2) / L;
    const ds = L / COLS;
    // (The rest of it is not left flat: the whole body bows, and the pull runs through it.)
    const pull = Math.sin(Math.PI * Math.min(1, roll * 1.1));
    const ripple = (pull * 0.4) / L;
    const bow = (pull * 1.15) / L;
    let th = -bow * L * (1 - p) * 0.42;
    let x = 0;
    let z = 0;
    for (let i = 0; i <= COLS; i++) {
      prof[i * 4] = x;
      prof[i * 4 + 1] = z;
      prof[i * 4 + 2] = Math.cos(th);
      prof[i * 4 + 3] = Math.sin(th);
      const u = (i + 0.5) / COLS;
      const on = smooth(front, front + soft, u);
      const k = tight * on + (1 - on) * (bow + ripple * Math.sin(u * 9 - t * 1.4));
      const m = th + (k * ds) / 2;
      x += Math.cos(m) * ds;
      z += Math.sin(m) * ds;
      th += k * ds;
    }
    // The roll's own axis: the middle of the bend its right edge is on.
    const Re = L / (Math.PI * 2);
    const ax = prof[COLS * 4] - prof[COLS * 4 + 3] * Re;
    const az = prof[COLS * 4 + 1] + prof[COLS * 4 + 2] * Re;
    // Its middle stays in the middle: of the card at first, of the world at last.
    const sx = L / 2 + (ax - L / 2) * p;
    const sz = az * smooth(0.15, 1, p);
    for (let i = 0; i <= COLS; i++) {
      prof[i * 4] -= sx;
      prof[i * 4 + 1] -= sz;
    }
    return [ax - sx, az - sz, p, Re];
  };

  const set = (u: { value: THREE_NS.Color }, v: V3) => u.value.setRGB(v[0], v[1], v[2]);
  const pu = panelMat.uniforms;

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
      beltMat.uniforms.uDist.value = dist;
      reachY = Math.tan((FOV / 2) * (Math.PI / 180));
      reachX = reachY * camera.aspect;
    },
    theme(k) {
      set(pu.uBase0 as { value: THREE_NS.Color }, k.base0);
      set(pu.uBase1 as { value: THREE_NS.Color }, k.base1);
      set(pu.uRim1 as { value: THREE_NS.Color }, k.rim1);
      set(pu.uRim2 as { value: THREE_NS.Color }, k.rim2);
      set(pu.uFront as { value: THREE_NS.Color }, k.front);
      pu.uLight.value = k.light;
      set(beltMat.uniforms.uC0 as { value: THREE_NS.Color }, k.rim2);
      set(beltMat.uniforms.uC1 as { value: THREE_NS.Color }, k.front);
      set(dustMat.uniforms.uC0 as { value: THREE_NS.Color }, k.dust0);
      set(dustMat.uniforms.uC1 as { value: THREE_NS.Color }, k.front);
      const blend = k.light ? THREE.NormalBlending : THREE.AdditiveBlending;
      for (const m of [beltMat, dustMat]) {
        m.blending = blend;
        m.needsUpdate = true;
      }
    },
    liquid(t) {
      pu.uLiquid.value = t;
    },
    world(w, map, extra) {
      which = w;
      pu.uMap.value = map ?? blank;
      pu.uExtra.value = extra ?? blank;
      pu.uHas.value = map ? 1 : 0;
      pu.uExtraOn.value = map && extra ? 1 : 0;
      (pu.uAir.value as THREE_NS.Color).setRGB(...w.air);
      pu.uAirK.value = w.airK;
      pu.uBump.value = map ? w.bump : 0;
      pu.uWinds.value = w.winds;
      pu.uSea.value = w.sea;
      pu.uAurora.value = w.aurora;
      pu.uGain.value = w.gain;
      (haloMat.uniforms.uAir.value as THREE_NS.Color).setRGB(...w.air);
      haloMat.uniforms.uAirK.value = w.airK;
      haloMat.uniforms.uPlume.value = w.plume;
    },
    look(l) {
      const { roll } = l;
      shared.uTime.value = l.t;
      shared.uShow.value = l.show;
      set(shared.uHue, l.hue);
      pu.uSize.value.set(l.w, l.h);
      pu.uRadius.value = l.radius;
      pu.uBend.value = l.bend;
      pu.uRoll.value = roll;
      pu.uMouse.value.set(l.mouse[0], l.mouse[1]);
      pu.uMouseAmt.value = l.mouseAmt;
      pu.uSeed.value = l.seed;
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
      du.uSize.value.set(l.w, l.h);
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

      const ball = smooth(0.62, 1, roll);
      const round = !l.surface && ball > 0.002;
      halo.visible = round;
      belt.visible = round;
      ring.visible = round && !!which?.rings;
      if (roll < 0.0005) {
        body.rotation.set(0, 0, 0);
        body.position.set(0, 0, 0);
        for (const { m } of moons) m.visible = false;
        for (const m of pu.uMoons.value as THREE_NS.Vector4[]) m.w = 0;
        pu.uRing.value = 0;
        return;
      }

      const girth = Math.PI * 2 * l.R;
      const L = l.w + (girth - l.w) * smooth(0.3, 0.95, roll);
      const [ax, az, , Re] = rolled(roll, L, l.t + l.seed);
      const pinch = smooth(0.3, 1, roll);
      pu.uAxis.value.set(ax, az);
      pu.uPinch.value = pinch;
      pu.uR.value = Re;
      pu.uSpin.value = l.spin;
      pu.uGain.value = (which?.gain ?? 1) * l.bright;

      // It turns as it rolls, and you look down into it a little; closed, it leans on
      // its own axis.
      const turn = Math.sin(Math.PI * Math.min(1, roll));
      const lean = which?.lean ?? 0.1;
      body.rotation.set(0.42 * smooth(0, 0.4, roll) * (1 - 0.5 * smooth(0.6, 1, roll)), -0.3 * turn, -lean * smooth(0.55, 1, roll), "ZXY");
      body.position.set(0, 0, 0);
      body.scale.setScalar(1);
      body.updateMatrixWorld();
      // Never past its canvas's edges: what comes nearest to them (the sheet's two ends, the
      // roll's sides) says how much smaller it must be drawn.
      let most = 0;
      const tall = (l.h / 2) * Math.cos((Math.PI / 2) * pinch * 0.9);
      for (const i of [0, COLS >> 1, COLS]) {
        for (const y of [tall, -tall]) {
          at.set(prof[i * 4], y, prof[i * 4 + 1]).applyMatrix4(body.matrixWorld);
          most = Math.max(most, Math.abs(at.x) / ((dist - at.z) * reachX), Math.abs(at.y) / ((dist - at.z) * reachY));
        }
      }
      for (const dx of [-Re, Re]) {
        at.set(ax + dx, 0, az).applyMatrix4(body.matrixWorld);
        most = Math.max(most, Math.abs(at.x) / ((dist - at.z) * reachX));
      }
      if (most > 0.97) {
        body.scale.setScalar(0.97 / most);
        body.updateMatrixWorld();
      }
      center.set(ax, 0, az).applyMatrix4(body.matrixWorld);

      halo.position.copy(center);
      halo.position.z -= 2;
      const k = body.scale.x;
      halo.scale.setScalar(Re * k * 2.1 * 1.02);
      haloMat.uniforms.uAmt.value = ball;
      const out = 1 - ball;
      ring.position.set(ax, 0, az);
      ring.scale.setScalar(Re * (1 + out * 0.7));
      ringMat.uniforms.uAmt.value = ball * ball;
      ringMat.uniforms.uR.value = Re * k;
      const rn = pu.uRingN.value as THREE_NS.Vector3;
      rn.set(0, 1, 0).transformDirection(body.matrixWorld);
      pu.uRing.value = ring.visible ? ball * ball : 0;
      pu.uRs.value = Re * k;
      belt.position.set(ax, 0, az);
      beltMat.uniforms.uR.value = Re;
      beltMat.uniforms.uRs.value = Re * k;
      beltMat.uniforms.uAmt.value = ball * (which?.rings ? 0.35 : 1);
      beltMat.uniforms.uOut.value = out;
      const ms = pu.uMoons.value as THREE_NS.Vector4[];
      moons.forEach(({ m, mat }, i) => {
        const mo = which?.moons[i];
        m.visible = round && !!mo;
        ms[i].w = 0;
        if (!mo || !round) return;
        const a = (mo.at + l.t * mo.speed) * Math.PI * 2 + l.seed;
        const d = mo.d * Re * (1 + out * 0.9);
        const y = Math.sin(a) * Math.sin(mo.tilt);
        m.position.set(ax + Math.cos(a) * d, y * d, az + Math.sin(a) * Math.cos(mo.tilt) * d);
        m.scale.setScalar(mo.r * Re * (0.4 + 0.6 * ball));
        mat.uniforms.uAmt.value = ball;
        mat.uniforms.uR.value = Re * k;
        set(mat.uniforms.uTint as { value: THREE_NS.Color }, mo.tint);
        at.copy(m.position).applyMatrix4(body.matrixWorld).sub(center);
        ms[i].set(at.x, at.y, at.z, mo.r * Re * k * ball);
      });
    },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE_NS.Mesh;
        if (m.geometry) m.geometry.dispose();
        (m.material as THREE_NS.Material | undefined)?.dispose();
      });
      moonMat.dispose();
      flow.dispose();
      beads.dispose();
      blank.dispose();
    },
  };
}
