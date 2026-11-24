// What runs through a spine besides bone (§104.2: "even for the divider skeleton more
// detailing… but don't spoil current"): where a body has nerves and ligaments, ours has
// hair-fine threads of glass with light in them. A pair leaves the cord at every gap and
// branches, forward and back; a beaded one climbs either side; a few stretch from tip to
// tip of the blades behind. Impulses run out along them, now and then.
//
// Ribbons as wide as they are on the screen (a thread thinner than a pixel breaks into
// dots otherwise), drawn with the bone they belong to.

import type * as THREE_NS from "three";
import { BONE_PITCH, BONE_UNIT } from "./spineBone";

type Three = typeof THREE_NS;
type P3 = [number, number, number];

export type Nerves = {
  mesh: THREE_NS.InstancedMesh;
  /** One for each instance: how far it has grown (0 none, 1 whole), and its own number. */
  put: (i: number, m: THREE_NS.Matrix4, grown: number, seed: number) => void;
  done: (count: number) => void;
  set: (t: number, w: number, h: number, gain: number, power: number) => void;
  paint: (c: { thread: THREE_NS.Color; impulse: THREE_NS.Color; light: boolean }) => void;
  dispose: () => void;
};

export function makeNerves(THREE: Three, cap: number): Nerves {
  const pos: number[] = [];
  const tan: number[] = [];
  const dat: number[] = [];
  const idx: number[] = [];
  let n = 0;
  /** A thread through these points; `kind` 0 a nerve, 1 the beaded one, 2 a ligament;
   *  from `u0` along its whole (a branch begins where it leaves). */
  const thread = (pts: P3[], kind: number, seg: number, u0 = 0, seed = 0) => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
    for (let i = 0; i <= seg; i++) {
      const u = i / seg;
      const p = curve.getPoint(u);
      const t = curve.getTangent(u);
      for (const side of [-1, 1]) {
        pos.push(p.x / BONE_UNIT, p.y / BONE_UNIT, p.z / BONE_UNIT);
        tan.push(t.x, t.y, t.z);
        dat.push(side, u0 + (1 - u0) * u, kind, seed);
      }
      if (i < seg) idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3);
      n += 2;
    }
  };
  const g = BONE_PITCH / 2;
  for (const s of [-1, 1]) {
    // Out of the gap below this bone…
    const root: P3[] = [
      [s * 0.16, -g + 0.2, -1.1],
      [s * 0.5, -g + 0.02, -1.06],
      [s * 0.86, -g - 0.1, -0.92],
      [s * 1.2, -g - 0.34, -0.7],
      [s * 1.5, -g - 0.72, -0.46],
      [s * 1.64, -g - 1.16, -0.3],
    ];
    thread(root, 0, 18, 0, 0.1 + s * 0.05);
    // …a branch back, between the wings, and one that leaves the first further out.
    thread([[s * 0.72, -g - 0.04, -0.98], [s * 0.94, -g - 0.02, -1.34], [s * 1.04, -g - 0.16, -1.74], [s * 0.98, -g - 0.42, -2.08]], 0, 12, 0.4, 0.4 + s * 0.05);
    thread([[s * 1.2, -g - 0.34, -0.7], [s * 1.46, -g - 0.42, -0.86], [s * 1.72, -g - 0.66, -0.98]], 0, 9, 0.6, 0.7 + s * 0.05);
    // The beaded one, up the side of the body; a short thread ties it to the nerve.
    thread([[s * 0.98, -g, -0.5], [s * 1.04, -g * 0.4, -0.44], [s * 1.04, g * 0.4, -0.44], [s * 0.98, g, -0.5]], 1, 12, 0, 0.2 + s * 0.1);
    thread([[s * 0.86, -g - 0.1, -0.92], [s * 0.97, -g - 0.02, -0.7], [s * 0.98, -g, -0.5]], 0, 6, 0.5, 0.6);
  }
  // From this blade's tip to the next one's, below.
  for (const [x, z] of [[-0.05, 0], [0.04, -0.05], [0.0, 0.07]] as const)
    thread([[x, -0.72, -2.56 + z], [x * 2.4, -0.72 - BONE_PITCH * 0.5, -2.46 + z * 1.6], [x, -0.72 - BONE_PITCH, -2.56 + z]], 2, 10, 0, 0.3 + x * 4);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aTan", new THREE.Float32BufferAttribute(tan, 3));
  geo.setAttribute("aDat", new THREE.Float32BufferAttribute(dat, 4));
  geo.setIndex(idx);
  const own = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
  own.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("aOwn", own);
  const uniforms = {
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(300, 800) },
    uGain: { value: 1 },
    uPower: { value: 0 },
    uThread: { value: new THREE.Color(0.5, 0.95, 0.88) },
    uImpulse: { value: new THREE.Color(1, 0.85, 0.5) },
  };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec3 aTan;
      attribute vec4 aDat;
      attribute vec2 aOwn;
      uniform vec2 uRes;
      uniform float uTime;
      varying float vU, vSide, vKind, vSeed, vGrown, vFar;
      void main() {
        mat4 m = modelViewMatrix * instanceMatrix;
        // (A breath of sway, more towards its end.)
        vec3 q = position;
        float loose = aDat.z < 0.5 ? aDat.y * aDat.y : 0.0;
        q.x += sin(uTime * 0.9 + aOwn.y * 40.0 + aDat.w * 9.0) * 0.016 * loose;
        q.y += cos(uTime * 0.7 + aOwn.y * 31.0) * 0.011 * loose;
        vec4 a = projectionMatrix * m * vec4(q, 1.0);
        vec4 b = projectionMatrix * m * vec4(q + aTan * 0.012, 1.0);
        vec2 d = (b.xy / b.w - a.xy / a.w) * uRes;
        vec2 nn = vec2(-d.y, d.x) / max(length(d), 1e-4);
        float bead = aDat.z > 0.5 && aDat.z < 1.5 ? exp(-pow((aDat.y - 0.5) / 0.07, 2.0)) : 0.0;
        float w = (aDat.z > 1.5 ? 0.85 : 1.25 * (1.0 - 0.5 * aDat.y)) + bead * 1.9;
        a.xy += nn * aDat.x * w / uRes * 2.0 * a.w;
        gl_Position = a;
        vU = aDat.y;
        vSide = aDat.x;
        vKind = aDat.z;
        vSeed = fract(aOwn.y * 7.0 + aDat.w);
        vGrown = aOwn.x;
        vFar = bead;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uThread, uImpulse;
      uniform float uTime, uGain, uPower;
      varying float vU, vSide, vKind, vSeed, vGrown, vFar;
      void main() {
        float across = 1.0 - vSide * vSide;
        float root = smoothstep(0.0, 0.06, vU) * (vKind < 0.5 ? 1.0 - smoothstep(0.7, 1.0, vU) : 1.0);
        float grown = smoothstep(vGrown * 1.15 - 0.15, vGrown * 1.15 - 0.3, vU - 0.15) ;
        // An impulse: a short bright run with a tail behind it, then nothing for a while.
        float speed = vKind > 1.5 ? 0.12 : 0.24 + 0.3 * uPower;
        float ph = fract(uTime * speed * (0.7 + 0.6 * vSeed) + vSeed * 13.0) * 2.6;
        float run = ph - vU;
        float imp = run > 0.0 ? exp(-run * 13.0) : exp(run * 60.0);
        imp *= step(ph, 1.25);
        vec3 c = mix(uThread, uImpulse, clamp(imp * 1.2, 0.0, 1.0));
        float a = (0.2 + 0.1 * vFar + imp * (vKind > 1.5 ? 0.35 : 0.95) + vFar * 0.25) * across * root * grown * uGain;
        gl_FragColor = vec4(c + imp * 0.25, a);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.count = 0;
  return {
    mesh,
    put(i, m, grown, seed) {
      if (i >= cap) return;
      mesh.setMatrixAt(i, m);
      own.setXY(i, grown, seed);
    },
    done(count) {
      mesh.count = Math.min(cap, count);
      mesh.instanceMatrix.needsUpdate = true;
      own.needsUpdate = true;
    },
    set(t, w, h, gain, power) {
      uniforms.uTime.value = t;
      uniforms.uRes.value.set(w, h);
      uniforms.uGain.value = gain;
      uniforms.uPower.value = power;
    },
    paint({ thread: th, impulse, light }) {
      uniforms.uThread.value.copy(th);
      uniforms.uImpulse.value.copy(impulse);
      mat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
      mat.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      mesh.dispose();
    },
  };
}
