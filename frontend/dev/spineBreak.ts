// The skeleton, touched (§104.3).
//
//   "when I touch that skeleton, like that galaxy burst, here also it needs some
//    animation… its bones need to break, crack and burst, and then again
//    rejoining, like a birth till death and again birth… in a realistic way… so
//    realistic way please" (24 Nov)
//
// Struck, a bone cracks — it really is in pieces (modelled so, dev/art/fracture.py:
// nineteen to a vertebra, whose rough broken faces fit each other), and the light of
// the cord shows through the cracks. The cracks run up and down the column, from bone
// to bone; then it bursts, the struck bone first, pieces and splinters and powder
// thrown out and tumbling. The light dies. They hang there, sinking, in the dark.
// Then a heart beats where the cord was — twice, and again — and the pieces are drawn
// in, spiralling, each to its own place; the cracks close over the light, and the
// surge of it climbs the whole bone.
//
// What each piece does is in the bones' own shader (spineBake, SHATTER); here is the
// time of it all, bone by bone, the powder, the flash and the cord's light.

import type * as THREE_NS from "three";

type Three = typeof THREE_NS;

/** Seconds. The cracks' run from a bone to the next, the first burst and its run, how
 *  long they hang, the call home and its run, the way home, the healing; how many bones
 *  up and down it reaches. */
export const BREAK = { crack: 0.05, first: 0.62, run: 0.07, rest: 3.3, call: 0.085, home: 1.5, heal: 1.1, reach: 12, done: 0 };
BREAK.done = BREAK.rest + BREAK.reach * BREAK.call + BREAK.home + BREAK.heal;
/** The heart's beats, and how strong. */
export const BEATS: [number, number][] = [
  [2.3, 0.45],
  [2.54, 0.8],
  [3.2, 0.65],
  [3.44, 1.1],
  [4.1, 0.75],
  [4.34, 1.2],
];

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** A bone `d` away from the one struck, `st` seconds after: how far apart its pieces are
 *  (px), how long they have flown, how far home they are, how much light is in them — or
 *  null while it is whole. */
export function boneLife(st: number, d: number): [number, number, number, number] | null {
  if (d > BREAK.reach) return null;
  const c = st - d * BREAK.crack;
  if (c <= 0) return null;
  const b = st - (BREAK.first + d * BREAK.run);
  const h = st - (BREAK.rest + d * BREAK.call);
  if (h >= BREAK.home + BREAK.heal) return null;
  if (b < 0) {
    const k = clamp(c / (BREAK.first + d * (BREAK.run - BREAK.crack)));
    return [2.6 * k * k * k + 0.35 * Math.min(1, k * 4), 0, 0, Math.min(1, k * 2.2) * (0.7 + 0.3 * Math.sin(st * 51 + d)) * (0.55 + 0.75 * k)];
  }
  const home = clamp(h / BREAK.home);
  const heal = clamp((h - BREAK.home) / BREAK.heal);
  const hot = h < 0 ? 1.7 * Math.exp(-b * 2.7) : 0;
  return [2.6 * (1 - smooth(0, 0.55, heal)), Math.max(0, b), home, hot + smooth(0.3, 0.95, home) * 1.35 * (1 - smooth(0.25, 1, heal))];
}

/** How it shakes before it goes (px). */
export const tremble = (st: number, d: number) => {
  const left = BREAK.first + d * BREAK.run - st;
  return left > 0 && st > d * BREAK.crack ? 1.5 * smooth(0.55, 0, left) : 0;
};

/** The light of it all: the cord's, the crystal's own, the room's. */
export function breakLight(st: number): { core: number; inner: number; room: number } {
  let core: number;
  let inner: number;
  let room: number;
  if (st < BREAK.first) {
    const k = st / BREAK.first;
    core = 1 + 1.6 * k * k;
    inner = 1 + 0.7 * k * k;
    room = 1;
  } else {
    const k = st - BREAK.first;
    const back = smooth(BREAK.rest + 0.4, BREAK.done - 0.9, st);
    core = Math.max(0.03 + 3.6 * Math.exp(-k * 3.1), back);
    inner = Math.max(0.2 + 1.3 * Math.exp(-k * 2.2), back);
    room = Math.max(0.6 + 0.55 * Math.exp(-k * 1.9), 0.6 + 0.4 * back);
  }
  let beat = 0;
  for (const [t, k] of BEATS) beat += k * Math.exp(-(((st - t) / 0.09) ** 2));
  return { core: core + beat * 2.3, inner: inner + beat * 1.5, room: room + beat * 0.22 };
}

export type Powder = {
  object: THREE_NS.Group;
  set: (o: { st: number; y0: number; x0: number; pitch: number; H: number; dist: number; ratio: number; radius: number }) => void;
  paint: (c: { powder: THREE_NS.Color; a: THREE_NS.Color; b: THREE_NS.Color; gold: THREE_NS.Color; light: boolean }) => void;
  dispose: () => void;
};

/** Splinters' dust and glitter off every bone as it goes, the flash, and the motes that
 *  come in before the pieces do. */
export function makePowder(THREE: Three, phone: boolean): Powder {
  const N = phone ? 520 : 1300;
  const seed = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seed[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute("seed", new THREE.BufferAttribute(seed, 4));
  const uniforms = {
    uT: { value: -1 },
    uY0: { value: 0 },
    uPitch: { value: 55 },
    uH: { value: 800 },
    uDist: { value: 1500 },
    uRatio: { value: 1 },
    uR: { value: 39 },
    uGain: { value: 1 },
    uCp: { value: new THREE.Color(0.8, 0.86, 0.9) },
    uCa: { value: new THREE.Color(1, 0.6, 0.4) },
    uCb: { value: new THREE.Color(0.5, 0.95, 0.88) },
    uCg: { value: new THREE.Color(0.94, 0.74, 0.42) },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 seed;
      uniform float uT, uY0, uPitch, uH, uDist, uRatio, uR;
      varying float vA, vKind, vPick;
      float h1(float n) { return fract(sin(n * 127.1 + 3.7) * 43758.5453); }
      void main() {
        float k1 = h1(seed.x * 71.0 + seed.w);
        float k2 = h1(seed.y * 53.0 + seed.z);
        float k3 = h1(seed.z * 37.0 + seed.x);
        // Each is dust off one place on the column, thrown when that bone goes.
        float y = (seed.y - 0.5) * uH;
        float d = abs(y - uY0) / uPitch;
        float tau = uT - (${BREAK.first.toFixed(3)} + d * ${BREAK.run.toFixed(3)});
        float a = seed.z * 6.2832;
        float rad = uR * (0.3 + 1.5 * seed.w);
        vec3 p = vec3(cos(a) * rad, y, sin(a) * rad * 0.8);
        // Powder (slow, soft, most of it), splinters' glitter, a few embers.
        vKind = seed.x < 0.6 ? 0.0 : seed.x < 0.9 ? 1.0 : 2.0;
        float fast = vKind < 0.5 ? 0.45 : 1.0;
        vec3 v = vec3(cos(a) * (90.0 + 520.0 * k1 * k1), (k2 - 0.45) * 360.0 + sign(y - uY0) * 70.0, sin(a) * 260.0 + 150.0 * k3) * fast;
        float drag = vKind < 0.5 ? 2.6 : 1.5;
        float alive = 0.0;
        float size = 0.0;
        if (tau > 0.0) {
          float f = (1.0 - exp(-drag * tau)) / drag;
          p += v * f;
          p.y -= (vKind < 0.5 ? 9.0 : 46.0) * tau * tau;
          p.x += sin(tau * 2.1 + seed.w * 30.0) * 9.0 * tau;
          float life = vKind < 0.5 ? 1.6 + 2.0 * k3 : 1.2 + 1.9 * k3;
          alive = smoothstep(0.0, 0.05, tau) * (1.0 - smoothstep(life * 0.35, life, tau));
          size = vKind < 0.5 ? 7.0 + 22.0 * k2 * smoothstep(0.0, 1.2, tau) : 1.5 + 2.6 * k2;
          if (vKind > 0.5) alive *= 0.35 + 0.65 * pow(0.5 + 0.5 * sin(tau * (9.0 + 9.0 * k1) + seed.w * 50.0), 2.0);
          if (vKind < 0.5) alive *= 0.15;
        }
        // Then, in the dark, some of it comes back: motes, drawn in round the axis.
        float back = uT - (2.35 + 2.4 * k1);
        if (vKind > 0.5 && back > 0.0 && back < 1.6) {
          float q = back / 1.6;
          float e = q * q;
          float r = mix(150.0 + 260.0 * k2, 5.0, e);
          float b = a + 3.6 * e;
          p = vec3(cos(b) * r, y + (k3 - 0.5) * 160.0 * (1.0 - e), sin(b) * r * 0.7);
          alive = smoothstep(0.0, 0.25, q) * (1.0 - smoothstep(0.85, 1.0, q)) * (0.35 + 0.65 * q);
          size = 1.4 + 2.2 * k3;
        }
        vA = alive;
        vPick = k2;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = alive > 0.002 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = size * uRatio * (uDist / -mv.z);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uCp, uCa, uCb, uCg;
      uniform float uGain;
      varying float vA, vKind, vPick;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float m = vKind < 0.5 ? exp(-d * d * 3.2) - 0.04 : smoothstep(1.0, 0.15, d);
        vec3 c = vKind < 0.5 ? uCp : vKind < 1.5 ? (vPick < 0.4 ? uCb : vPick < 0.7 ? vec3(1.0) : uCa) : uCg;
        gl_FragColor = vec4(c, max(0.0, m) * vA * uGain);
      }`,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 4;
  const flashU = { uK: { value: 0 }, uCa: uniforms.uCg, uCb: uniforms.uCb };
  const flashMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: flashU,
    vertexShader: /* glsl */ `
      varying vec2 vQ;
      void main() { vQ = position.xy * 2.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uK;
      uniform vec3 uCa, uCb;
      varying vec2 vQ;
      void main() {
        float d = length(vQ);
        float g = exp(-d * d * 7.0) + 0.22 * exp(-d * d * 2.2);
        gl_FragColor = vec4(mix(uCb, vec3(1.0, 0.96, 0.88), exp(-d * d * 12.0)) , g * uK * smoothstep(1.0, 0.7, d));
      }`,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), flashMat);
  flash.renderOrder = 3;
  flash.frustumCulled = false;
  const object = new THREE.Group();
  object.add(points, flash);
  object.visible = false;
  return {
    object,
    set({ st, y0, x0, pitch, H, dist, ratio, radius }) {
      object.visible = st >= 0 && st < BREAK.done;
      if (!object.visible) return;
      uniforms.uT.value = st;
      uniforms.uY0.value = y0;
      uniforms.uPitch.value = pitch;
      uniforms.uH.value = H;
      uniforms.uDist.value = dist;
      uniforms.uRatio.value = ratio;
      uniforms.uR.value = radius;
      const k = st - BREAK.first;
      const first = k < 0 ? 0.12 * smooth(0.1, BREAK.first, st) : 1.15 * Math.exp(-k * 5.2);
      // …and a glow where the heart beats.
      let beat = 0;
      for (const [t, g] of BEATS) beat += g * Math.exp(-(((st - t) / 0.11) ** 2));
      flashU.uK.value = first + beat * 0.42;
      flash.visible = flashU.uK.value > 0.004;
      const s = k < 0 ? 150 : k < 1.2 ? 170 + 620 * (1 - Math.exp(-k * 6)) : 430;
      flash.position.set(x0 * (k < 1.2 ? 1 : 0), y0, 40);
      flash.scale.set(s, s * (k < 1.2 ? 1 : 1.5), 1);
    },
    paint({ powder, a, b, gold, light }) {
      uniforms.uCp.value.copy(powder);
      uniforms.uCa.value.copy(a);
      uniforms.uCb.value.copy(b);
      uniforms.uCg.value.copy(gold);
      uniforms.uGain.value = light ? 0.8 : 1;
      const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.blending = blend;
      flashMat.blending = blend;
      mat.needsUpdate = true;
      flashMat.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      flash.geometry.dispose();
      flashMat.dispose();
    },
  };
}
