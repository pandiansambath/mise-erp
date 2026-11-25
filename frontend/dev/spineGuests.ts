// A ball that has come to the skeleton, and goes into it (§106.13).
//
//   "the ball… when I scroll, that ball is disappearing: instead make that ball dissolve
//    inside the skeleton… now our skeleton is bit big, so we can clearly show that dissolve
//    effect in a cool way, with [a] super cool transition, with more realistic detailing"
//    (24 Nov)
//
// It is the card's own ball (cardScene), drawn here to a small picture. The first evening it was
// hung among the bones as deep as a ball is, and eaten away there from its rim: "I can still see
// that ball inside the skeleton… it needs to dissolve in a smooth way" (25 Nov). Then it stopped at
// their edge and let go there: "that ball dissolve effect is happening outside the skeleton, which
// is making [it] worse… perfectly dissolved smoothly inside the skeleton… likewise from [the]
// bottom when revealing… dissolve should come from [the] skeleton… clearly, visibly" (25 Nov, §108.1).
//
// So: it comes to the bones, and they draw it in. As it goes in it stops being a ball: its skin
// lets go, the side that enters first, and what was in it is a liquid that winds round the cord,
// before the bones and behind them (sheets of one cloud, each as deep as it is: the bones stand in
// it), drawn out up and down them in threads, and with it hundreds of drops, each on its own turn
// round the cord; and all of it soaks into the bone, whose veins and nerves take its light, and
// carry it on, and let it die down. Where one has scrolled says whether it melts; the melting
// itself is its own (CardGL `melt`): begun, it goes on to its end. It runs backwards, too: light
// gathers in the bones, seeps out of them, winds together into a ball among them, and that comes
// out, and unwinds into the next card.

import type * as THREE_NS from "three";
import { makeCardScene } from "./cardScene";
import { dress, guestsAt, host, type Guest } from "./guests";
import { compiled } from "./glGuard";

type Three = typeof THREE_NS;

/** How many there can be at once. */
export const GUESTS = 3;
/** How far past its edge a ball's sheet reaches (of its radius). */
const PAD = 2.1;
/** …and its picture. */
const PIC = 1.17;
/** The ball itself is gone by here (of its melting): from then on it is what was in it. */
const SKIN = 0.64;

export type GuestUniforms = {
  /** Where (scene), and its radius (0: none). */
  uG: { value: THREE_NS.Vector4[] };
  /** Its colour, and how much of it is in the bone. */
  uGc: { value: THREE_NS.Vector4[] };
  /** (unused) · how much of it is still a ball · its own number · how far it has run in the bone
   *  (in its radii). */
  uGd: { value: THREE_NS.Vector4[] };
  uGt: { value: number };
};

export function guestUniforms(THREE: Three): GuestUniforms {
  const set = () => ({ value: Array.from({ length: GUESTS }, () => new THREE.Vector4()) });
  return { uG: set(), uGc: set(), uGd: set(), uGt: { value: 0 } };
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export type Place = {
  /** The page's scroll, the canvas's middle and top on the screen, its size. */
  sy: number;
  mid: number;
  top: number;
  W: number;
  H: number;
  /** A bone's unit (px), the clock, and whether the theme is a light one. */
  unit: number;
  t: number;
  light: boolean;
};

export type SpineGuests = {
  group: THREE_NS.Group;
  /** Where they are now: before anything is drawn. How many. */
  place: (p: Place) => number;
  /** Their pictures (drawn to their own small targets). */
  paint: () => void;
  ratio: (r: number) => void;
  /** Its shaders built, and everything drawn once, unseen. */
  warm: () => Promise<void>;
  dispose: () => void;
};

export function makeGuests(THREE: Three, renderer: THREE_NS.WebGLRenderer, camera: THREE_NS.PerspectiveCamera, u: GuestUniforms, grain: THREE_NS.Texture, phone: boolean): SpineGuests {
  const group = new THREE.Group();
  let dpr = renderer.getPixelRatio();
  /* ── their pictures ── */
  const ball = makeCardScene(THREE, 1, phone);
  const side = () => Math.min(448, Math.ceil(((phone ? 66 : 70) * 2 * PIC * dpr) / 16) * 16);
  const target = () => new THREE.WebGLRenderTarget(side(), side(), { samples: 4, depthBuffer: false, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const pics = Array.from({ length: GUESTS }, target);
  let dressed = -1;
  let water: THREE_NS.Texture | null = null;
  const wear = () => {
    if (dressed === dress.version || !dress.theme) return;
    dressed = dress.version;
    ball.theme(dress.theme);
    skins.forEach((m) => {
      m.material.uniforms.uLight.value = dress.theme?.light ?? 0;
      m.material.uniforms.uGlowA.value.setRGB(...(dress.theme!.glowA as [number, number, number]));
      m.material.uniforms.uGlowB.value.setRGB(...(dress.theme!.glowB as [number, number, number]));
    });
    for (const m of [dropMat, cloudMat]) {
      m.uniforms.uC0.value.setRGB(...(dress.theme.rim2 as [number, number, number]));
      m.uniforms.uC1.value.setRGB(...(dress.theme.front as [number, number, number]));
    }
    cloudMat.uniforms.uLight.value = dress.theme.light ?? 0;
    const url = dress.liquid;
    if (!url) return;
    const img = new Image();
    img.onload = () => {
      const tex = new THREE.Texture(img);
      tex.wrapS = tex.wrapT = THREE.MirroredRepeatWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.needsUpdate = true;
      water?.dispose();
      water = tex;
      ball.liquid(tex);
    };
    img.src = url;
  };

  /* ── the ball, among the bones ── */
  const sheet = new THREE.PlaneGeometry(2 * PAD, 2 * PAD);
  const skinOf = (i: number) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // (Its picture is premultiplied: light, and how much of what is behind it is hidden.)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        tBall: { value: pics[i].texture },
        tGrain: { value: grain },
        uHere: { value: new THREE.Vector4() },
        uHue: { value: new THREE.Color() },
        uGlowA: { value: new THREE.Color(0.49, 0.94, 0.86) },
        uGlowB: { value: new THREE.Color(0.94, 0.63, 0.39) },
        uD: { value: 0 },
        /** Which side of the cord it is on (1 or −1; 0: before it, on a phone). */
        uWay: { value: 0 },
        uTime: u.uGt,
        uSeed: { value: 0 },
        uLight: { value: 0 },
        uP: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec2 vQ;
        void main() { vQ = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D tBall, tGrain;
        uniform vec4 uHere;
        uniform vec3 uHue, uGlowA, uGlowB, uP;
        uniform float uD, uWay, uTime, uSeed, uLight;
        varying vec2 vQ;
        #define sq2(x) ((x) * (x))
        float grain(vec2 p) { return texture2D(tGrain, p).z; }
        void main() {
          vec2 q = vQ;
          float D = uD;
          // Its water, moving: two sheets of it.
          float n1 = grain(q * 0.07 + vec2(uTime * 0.006 + uSeed, -uTime * 0.004));
          float n2 = grain(q * 0.17 - vec2(uTime * 0.011, uTime * 0.008 - uSeed));
          float n = n1 * 0.6 + n2 * 0.4;
          // It is drawn in: longer towards the cord, and round it, as a drop is into a stream; and what
          // is in it turns.
          float away = -uWay * q.x;
          float go = smoothstep(0.0, 1.0, D);
          vec2 s = q;
          s.y *= 1.0 + 0.3 * go * smoothstep(-0.4, 1.2, away);
          s.x *= 1.0 - 0.24 * go * smoothstep(0.0, 1.3, away);
          float wind = 2.4 * go * go * exp(-1.2 * dot(s, s)) * (uWay == 0.0 ? 1.0 : uWay);
          float cw = cos(wind), sw = sin(wind);
          s = vec2(cw * s.x - sw * s.y, sw * s.x + cw * s.y);
          s += (vec2(n1, n2) - 0.5) * 0.55 * smoothstep(0.02, 0.7, D);
          float rs = length(s);
          vec4 b = rs < ${PIC.toFixed(2)} ? texture2D(tBall, s * ${(0.5 / PIC).toFixed(5)} + 0.5) : vec4(0.0);
          // It lets go: the side that meets the bones first, and on through it, softly (on a phone,
          // before them: from its rim in).
          // (Its edge is not a line: it is drops already, smaller and smaller.)
          float n3 = grain(q * 0.52 + vec2(uSeed - uTime * 0.006, uTime * 0.005));
          float n4 = grain(q * 1.13 - vec2(uTime * 0.008, uSeed));
          float at_ = (uWay == 0.0 ? rs * 1.6 - 0.75 : -uWay * s.x) + (n - 0.5) * 1.15 + ((n3 - 0.5) * 0.95 + (n4 - 0.5) * 0.42) * smoothstep(0.0, 0.2, D);
          float edge = mix(1.95, -1.8, D);
          float keep = D < 0.001 ? 1.0 : 1.0 - smoothstep(edge - 0.36, edge + 0.36, at_);
          // …and all of it thins.
          float thin = 1.0 - smoothstep(0.5, 1.0, D);
          float lets = keep * (1.0 - keep) * 4.0;
          vec3 col = b.rgb * keep * thin;
          float a = b.a * keep * thin * (1.0 - 0.4 * smoothstep(0.1, 0.8, D));
          // What lets go has its light.
          col += (uHue * 0.5 + vec3(0.12)) * lets * thin * smoothstep(1.0, 0.75, rs) * 0.34 * (1.0 - 0.5 * uLight);
          // The air past its edge (as on its card).
          float r = length(q);
          float o = max(r - 0.84, 0.0);
          vec2 dir = q / max(r, 0.001);
          float rag = grain(dir * 0.16 + vec2(uTime * 0.005, uSeed));
          vec3 air = mix(uGlowA, uGlowB, rag) * 0.55 + uHue * 0.45;
          air *= (exp(-o * (6.0 - 3.0 * rag)) * 0.14 + exp(-o * 13.0) * 0.14) * smoothstep(2.1, 1.4, r) * 0.8;
          col += air * thin * (1.0 - smoothstep(0.0, 0.5, D)) * (1.0 - uLight) * (1.0 - b.a * keep);
          if (a < 0.002 && max(col.r, max(col.g, col.b)) < 0.002) discard;
          // As deep as it is, round: the bones it comes among stand in it, and out of it.
          float vz = uHere.z + 0.7 * uHere.w * sqrt(max(0.0, 1.0 - dot(q, q))) - uP.z;
          float ndc = (uP.x * vz + uP.y) / -vz;
          gl_FragDepth = clamp(ndc * 0.5 + 0.5, 0.0, 1.0);
          gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
        }`,
    });
  const skins = Array.from({ length: GUESTS }, (_, i) => {
    const m = new THREE.Mesh(sheet, skinOf(i));
    m.frustumCulled = false;
    m.renderOrder = 3;
    m.visible = false;
    group.add(m);
    return m;
  });

  /* ── what was in it: a liquid that winds round the cord ── */
  const SHEETS = phone ? 6 : 9;
  const cloudGeo = new THREE.InstancedBufferGeometry();
  cloudGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
  cloudGeo.setIndex([0, 1, 2, 2, 1, 3]);
  const at = new Float32Array(SHEETS * GUESTS * 2);
  // From the farthest to the nearest.
  for (let k = 0, o = 0; k < SHEETS; k++)
    for (let w = 0; w < GUESTS; w++, o += 2) {
      at[o] = ((k + 0.5) / SHEETS) * 2 - 1;
      at[o + 1] = w;
    }
  cloudGeo.setAttribute("at", new THREE.InstancedBufferAttribute(at, 2));
  cloudGeo.instanceCount = SHEETS * GUESTS;
  const cloudMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    defines: { GUESTS: `${GUESTS}`, SHEETS: `${SHEETS}.0` },
    uniforms: {
      uG: u.uG,
      uGc: u.uGc,
      /** Its middle, from the cord (in its radii), how far it has melted, its own number, its light. */
      uV: { value: Array.from({ length: GUESTS }, () => new THREE.Vector4()) },
      uW: { value: Array.from({ length: GUESTS }, () => new THREE.Vector4()) },
      uTime: u.uGt,
      uLight: { value: 0 },
      tGrain: { value: grain },
      uC0: { value: new THREE.Color(0.49, 0.94, 0.86) },
      uC1: { value: new THREE.Color(0.94, 0.74, 0.42) },
    },
    vertexShader: /* glsl */ `
      attribute vec2 at;
      uniform vec4 uG[GUESTS], uGc[GUESTS], uV[GUESTS], uW[GUESTS];
      varying vec3 vP;
      varying vec4 vV;
      varying vec3 vHue;
      varying vec2 vW;
      void main() {
        int w = int(at.y + 0.5);
        vec4 G = uG[w];
        vV = uV[w];
        vW = uW[w].xy;
        vHue = uGc[w].rgb;
        float D = vV.y;
        // (No larger than it is.)
        float wide = mix(1.25, 2.2, smoothstep(0.05, 0.4, D)) - 0.75 * smoothstep(0.6, 0.95, D);
        vec2 box = vec2(wide + abs(vV.x) * 0.5, mix(1.25, 3.5, smoothstep(0.1, 1.0, D)));
        float deep = mix(1.05, 1.8, smoothstep(0.05, 0.45, D)) - 0.5 * smoothstep(0.6, 0.95, D);
        vP = vec3(position.x * box.x + vV.x * 0.5, position.y * box.y, at.x * deep + vW.x * (1.0 - smoothstep(0.1, 0.6, D)));
        vec3 p = vec3(vP.x * G.w, G.y + vP.y * G.w, vP.z * G.w);
        gl_Position = G.w > 0.5 && D > 0.05 && D < 0.98 ? projectionMatrix * viewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D tGrain;
      uniform float uTime, uLight;
      uniform vec3 uC0, uC1;
      varying vec3 vP;
      varying vec4 vV;
      varying vec3 vHue;
      varying vec2 vW;
      #define sq2(x) ((x) * (x))
      void main() {
        float D = vV.y;
        float seed = vV.z;
        vec3 P = vP;
        // Wound round the cord: the nearer to it the more.
        float rho = length(P.xz);
        float turn = 6.5 * D * D * exp(-0.55 * rho) * vW.y;
        float c = cos(turn), s = sin(turn);
        vec3 p = vec3(c * P.x - s * P.z, P.y, s * P.x + c * P.z);
        vec4 g1 = texture2D(tGrain, vec2(p.x * 0.085 + p.z * 0.061 + seed, p.y * 0.06 - p.z * 0.047 - uTime * 0.012));
        vec4 g2 = texture2D(tGrain, vec2(p.z * 0.19 - p.x * 0.15, p.y * 0.13 + p.x * 0.06 + uTime * 0.02) + seed * 1.7);
        // It is in motion: each part of it has been carried there.
        float amp = smoothstep(0.02, 0.85, D);
        vec3 from = p + amp * (vec3(g1.z, g2.z, g1.x) - 0.5) * vec3(1.9, 2.4, 1.3);
        // Drawn to the cord, and out along it.
        from.xz *= 1.0 - 0.34 * smoothstep(0.08, 0.5, D) + 1.1 * smoothstep(0.6, 1.0, D);
        from.y /= 1.0 + 1.7 * smoothstep(0.15, 1.0, D);
        from.x -= vV.x;
        from.z -= vW.x;
        float body = smoothstep(-0.02, 0.36, 1.0 - length(from));
        if (body < 0.004) discard;
        float n = g1.z * 0.55 + g2.z * 0.45;
        // It thins to threads: what is left of it is less and less.
        float th = mix(0.2, 0.66, smoothstep(0.08, 1.0, D));
        float den = body * smoothstep(th - 0.14, th + 0.1, n);
        // Fine lines of light in it, as there are in the ball's water.
        float f1 = g2.z * 0.7 + g1.z * 0.3;
        float w1 = fwidth(f1) * 1.1 + 0.004, w2 = fwidth(n) * 1.1 + 0.004;
        float lines = exp(-sq2((f1 - 0.5) / w1)) * smoothstep(th - 0.22, th, n) + 0.8 * exp(-sq2((n - th - 0.02) / w2));
        float soft = exp(-sq2((n - th - 0.015) / 0.03)) + 0.6 * exp(-sq2((f1 - 0.5) / 0.03)) * smoothstep(th - 0.2, th, n);
        float thread = body * (soft * 0.55 + lines * 1.5);
        float seen = smoothstep(0.06, 0.34, D) * (1.0 - smoothstep(0.7, 1.0, D)) * vV.w;
        float each = 9.0 / SHEETS;
        vec3 tone = mix(vHue, mix(uC0, uC1, smoothstep(0.35, 0.65, g1.z)), 0.4);
        vec3 col = tone * den * 0.15 + mix(tone, vec3(1.0), 0.32) * thread * 0.32;
        float a = den * 0.13 + thread * 0.08;
        col *= mix(1.0, 0.75, uLight);
        a *= mix(1.0, 1.5, uLight);
        gl_FragColor = vec4(col, a) * seen * each;
      }`,
  });
  const cloud = new THREE.Mesh(cloudGeo, cloudMat);
  cloud.frustumCulled = false;
  cloud.renderOrder = 4;
  cloud.visible = false;
  group.add(cloud);

  /* ── what lets go of it: fine drops, drawn in among the bones ── */
  const EACH = phone ? 420 : 1100;
  const N = EACH * GUESTS;
  const seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  const whose = new Float32Array(N);
  for (let i = 0; i < N; i++) whose[i] = i % GUESTS;
  const dropGeo = new THREE.BufferGeometry();
  dropGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  dropGeo.setAttribute("seed", new THREE.BufferAttribute(seeds, 4));
  dropGeo.setAttribute("whose", new THREE.BufferAttribute(whose, 1));
  const dropMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    defines: { GUESTS: `${GUESTS}` },
    uniforms: {
      uG: u.uG,
      uGc: u.uGc,
      uGd: u.uGd,
      uTime: u.uGt,
      /** How far it has melted, which side it is on (0: before the cord), its light. */
      uGo: { value: Array.from({ length: GUESTS }, () => new THREE.Vector4()) },
      uUnit: { value: 39 },
      uRatio: { value: dpr },
      uDist: { value: 1400 },
      uC0: { value: new THREE.Color(0.49, 0.94, 0.86) },
      uC1: { value: new THREE.Color(0.94, 0.74, 0.42) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      attribute float whose;
      uniform vec4 uG[GUESTS], uGc[GUESTS], uGd[GUESTS], uGo[GUESTS];
      uniform float uTime, uUnit, uRatio, uDist;
      uniform vec3 uC0, uC1;
      varying float vA, vRing;
      varying vec3 vC;
      void main() {
        int w = int(whose + 0.5);
        vec4 G = uG[w];
        vec4 go = uGo[w];
        // Its place in the ball…
        float a0 = seed.z * 6.2832;
        vec2 disc = vec2(cos(a0), sin(a0)) * sqrt(seed.x) * 0.96;
        // …whose side that meets the bone lets go first (before the cord: its rim).
        float away = go.y == 0.0 ? length(disc) * 1.6 - 0.75 : -disc.x * go.y;
        float t0 = clamp((1.6 - away) / 5.4 + 0.12 * (seed.w - 0.5), 0.02, 0.56);
        float tt = clamp((go.x - t0) / (0.3 + 0.16 * seed.y), 0.0, 1.0);
        float e = tt * tt * (3.0 - 2.0 * tt);
        float shrink = 1.0 - 0.3 * smoothstep(0.1, 0.7, go.x);
        vec3 from = vec3(G.x + disc.x * G.w * shrink, G.y + disc.y * G.w * shrink, G.z + (seed.y - 0.5) * G.w);
        // Round the cord, and into the bone: nearer to it with every turn, up or down along it.
        float r0 = max(length(from.xz), uUnit * 0.5);
        float th0 = atan(from.z, from.x);
        float r1 = uUnit * (0.3 + 1.2 * seed.x * seed.x);
        float ring = mix(r0, r1, e * e) + sin(3.14159 * tt) * uUnit * (0.7 + 1.3 * seed.w);
        float turn = th0 + go.w * (2.4 + 4.6 * seed.y) * pow(tt, 1.8);
        float along = (seed.z - 0.5) * 2.0;
        vec3 p;
        p.x = cos(turn) * ring;
        p.z = sin(turn) * ring;
        p.y = from.y + e * (along * (0.35 + 1.5 * seed.w) * G.w - disc.y * G.w * 0.55) + sin(3.14159 * tt) * G.w * (seed.y - 0.5) * 0.5;
        p = mix(from, p, smoothstep(0.0, 0.22, tt));
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = G.w > 0.5 && tt > 0.001 && tt < 0.999 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        float big = seed.y * seed.y * seed.y;
        gl_PointSize = (1.3 + 6.6 * big * seed.x) * (1.0 - 0.45 * e) * uRatio * (uDist / -mv.z);
        vA = smoothstep(0.0, 0.16, tt) * (1.0 - smoothstep(0.66, 1.0, tt)) * (0.5 + 0.5 * seed.x) * (0.82 + 0.18 * sin(uTime * 2.0 + seed.z * 40.0)) * go.z;
        vRing = step(0.8, seed.y);
        vC = mix(mix(seed.w < 0.6 ? uC0 : uC1, uGc[w].rgb, 0.6), vec3(1.0), 0.25 + 0.25 * sin(3.14159 * tt));
      }`,
    fragmentShader: /* glsl */ `
      precision highp float;
      varying float vA, vRing;
      varying vec3 vC;
      void main() {
        vec2 p = gl_PointCoord - 0.5;
        float d = length(p) * 2.0;
        if (d > 1.0) discard;
        float mote = smoothstep(1.0, 0.1, d);
        float skin = smoothstep(1.0, 0.86, d) * (0.16 + 0.84 * smoothstep(0.35, 0.95, d));
        float hi = smoothstep(0.34, 0.05, length(p * 2.0 - vec2(-0.36, -0.38)));
        float low = smoothstep(0.6, 0.0, length(p * 2.0 - vec2(0.3, 0.36))) * 0.35;
        vec3 drop = vC * (skin * 0.75 + low) + vec3(hi);
        float a = mix(mote, clamp(skin * 0.75 + hi + low, 0.0, 1.0), vRing);
        gl_FragColor = vec4(mix(vC, drop / max(a, 0.05), vRing), a * vA);
      }`,
  });
  const drops = new THREE.Points(dropGeo, dropMat);
  drops.frustumCulled = false;
  drops.renderOrder = 5;
  drops.visible = false;
  group.add(drops);

  /** Frames still to be drawn with everything in it, out of sight: the first time a thing is
   *  drawn the page stands still. */
  let prime = 0;
  let here: (Guest | null)[] = Array.from({ length: GUESTS }, () => null);
  /** Whose picture is in each target (a place given to another is drawn at once). */
  const painted: (object | null)[] = Array.from({ length: GUESTS }, () => null);
  let tick = 0;

  return {
    group,
    place(p) {
      wear();
      u.uGt.value = p.t;
      const list = host.ready ? guestsAt(p.sy) : [];
      // Each keeps its place from frame to frame (its picture, its drops).
      const next: (Guest | null)[] = here.map((g) => (g && list.find((x) => x.key === g.key)) || null);
      for (const g of list) {
        if (next.includes(g)) continue;
        const free = next.indexOf(null);
        if (free >= 0) next[free] = g;
      }
      here = next;
      let n = 0;
      const pm = camera.projectionMatrix.elements;
      here.forEach((g, i) => {
        const at = u.uG.value[i];
        const mesh = skins[i];
        mesh.visible = !!g;
        if (!g) {
          at.set(0, 0, 0, 0);
          u.uGc.value[i].set(0, 0, 0, 0);
          u.uGd.value[i].set(0, 0, 0, 0);
          (dropMat.uniforms.uGo.value as THREE_NS.Vector4[])[i].set(0, 0, 0, 0);
          return;
        }
        n++;
        const d = g.d;
        const x0 = g.x - p.mid;
        const y = p.H * 0.5 - (g.y - p.top);
        // Behind the bones it comes to, on a desktop; on a phone before them (its card is). And as it
        // melts they draw it in: to the cord, and among them.
        const pull = smooth(0, 0.58, d);
        const x = x0 * (1 - pull);
        const z = (phone ? 1.6 : -1.1) * g.r * (1 - smooth(0.02, 0.5, d));
        const way = x0 >= 0 ? 1 : -1;
        const whole = (1 - smooth(0.2, 0.75, d)) * (phone ? g.come : 1) * (g.ball ? 1 : 0);
        const soak = smooth(0.16, 0.72, d) * (1 - smooth(0, 1, g.past));
        at.set(x, y, z, g.r);
        u.uGc.value[i].set(g.hue[0], g.hue[1], g.hue[2], soak * (p.light ? 0.75 : 1));
        u.uGd.value[i].set(0, whole * smooth(170, 70, Math.abs(x)), g.seed, 0.35 + 2.1 * smooth(0.2, 1, d) + 1.7 * g.past);
        (dropMat.uniforms.uGo.value as THREE_NS.Vector4[])[i].set(d, phone ? 0 : way, (p.light ? 0.85 : 1) * g.bright, way);
        (cloudMat.uniforms.uV.value as THREE_NS.Vector4[])[i].set(x / g.r, d, (g.seed * 0.173) % 1, g.bright);
        (cloudMat.uniforms.uW.value as THREE_NS.Vector4[])[i].set(z / g.r, way, 0, 0);
        mesh.visible = g.ball && d < SKIN;
        mesh.position.set(x, y, 0);
        mesh.scale.setScalar(g.r);
        const m = mesh.material.uniforms;
        m.uHere.value.set(x, y, z, g.r);
        m.uHue.value.setRGB(g.hue[0], g.hue[1], g.hue[2]);
        m.uD.value = Math.min(1, d / SKIN);
        m.uWay.value = way * (phone ? 0 : 1);
        m.uSeed.value = g.seed * 0.137;
        m.uP.value.set(pm[10], pm[14], camera.position.z);
      });
      drops.visible = n > 0;
      cloud.visible = here.some((g) => g && g.d > 0.01 && g.d < 0.999);
      if (prime > 0) {
        prime--;
        drops.visible = true;
        cloud.visible = true;
        skins.forEach((m) => {
          if (!m.visible) m.position.set(0, 1e5, 0);
          m.visible = true;
        });
      }
      dropMat.uniforms.uUnit.value = p.unit;
      dropMat.uniforms.uDist.value = camera.position.z;
      return n;
    },
    paint() {
      tick++;
      const was = renderer.getRenderTarget();
      here.forEach((g, i) => {
        // (What is in a closed ball changes slowly: every other frame, in turn — and once it
        // is all but gone, not at all.)
        if (!g || !g.ball || g.d > SKIN || ((tick + i) % 2 && g.key === painted[i])) return;
        painted[i] = g.key;
        const side = 560;
        ball.view(side, side);
        const cut = 2 * PIC * g.R;
        ball.camera.setViewOffset(side, side, (side - cut) / 2, (side - cut) / 2, cut, cut);
        ball.look({ w: g.w, h: g.h, R: g.R, radius: 16, roll: 1, bend: 0, show: 1, t: g.t, seed: g.seed, spin: g.spin - 0.5, side: g.side, mouse: [-9, -9], mouseAmt: 0, stirred: false, place: [0, 0], hue: g.hue, bright: g.bright, ink: 0, surface: false, pull: 0, bare: true });
        renderer.setRenderTarget(pics[i]);
        renderer.render(ball.scene, ball.camera);
      });
      renderer.setRenderTarget(was);
    },
    ratio(r) {
      dpr = r;
      dropMat.uniforms.uRatio.value = r;
      const s = side();
      pics.forEach((t) => t.setSize(s, s));
    },
    async warm() {
      wear();
      skins.forEach((m) => (m.visible = true));
      drops.visible = true;
      cloud.visible = true;
      const all = compiled(renderer, group, camera);
      skins.forEach((m) => (m.visible = false));
      drops.visible = false;
      cloud.visible = false;
      await all;
      // (Built for the target it is drawn to.)
      const to = renderer.getRenderTarget();
      renderer.setRenderTarget(pics[0]);
      const its = compiled(renderer, ball.scene, ball.camera);
      renderer.setRenderTarget(to);
      await its;
      ball.view(560, 560);
      ball.look({ w: 500, h: 300, R: 100, radius: 16, roll: 1, bend: 0, show: 1, t: 0, seed: 1, spin: 0, side: 1, mouse: [-9, -9], mouseAmt: 0, stirred: false, place: [0, 0], hue: [0.2, 0.8, 0.7], bright: 1, ink: 0, surface: false, pull: 0, bare: true });
      const was = renderer.getRenderTarget();
      renderer.setRenderTarget(pics[0]);
      renderer.render(ball.scene, ball.camera);
      renderer.setRenderTarget(was);
      prime = 3;
    },
    dispose() {
      pics.forEach((t) => t.dispose());
      ball.dispose();
      water?.dispose();
      sheet.dispose();
      skins.forEach((m) => m.material.dispose());
      dropGeo.dispose();
      dropMat.dispose();
      cloudGeo.dispose();
      cloudMat.dispose();
    },
  };
}
