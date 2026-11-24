// A ball that has come to the skeleton, and goes into it (§106.13).
//
//   "the ball… when I scroll, that ball is disappearing: instead make that ball dissolve
//    inside the skeleton… now our skeleton is bit big, so we can clearly show that dissolve
//    effect in a cool way, with [a] super cool transition, with more realistic detailing"
//    (24 Nov)
//
// It is the card's own ball (cardScene), drawn here to a small picture, and that picture is
// hung in the skeleton's scene as a ball: at every pixel as deep as the ball is there, so it
// and the bones pass THROUGH one another — a bone stands in it, larger, as in a drop of water,
// with the light in moving nets on it; where it stands out, the water's skin runs round it
// (spineBake GUESTS). It is drawn to the bone before it touches; then it soaks in: thins,
// falls into threads along the cord, is eaten away from its rim inwards in the pattern of its
// own water, every edge of that alight, while what has gone in runs up and down the skeleton
// in the bone's veins, with the nerves; and its drops go round the bones, closer and closer,
// and into them. All of it a matter of how far one has scrolled, and so it runs backwards,
// too: that is how the next card comes out.

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

export type GuestUniforms = {
  /** Where (scene), and its radius (0: none). */
  uG: { value: THREE_NS.Vector4[] };
  /** Its colour, and how much of it is in the bone. */
  uGc: { value: THREE_NS.Vector4[] };
  /** How much it magnifies, how much of it is still water, its own number, how far it has run
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
    dropMat.uniforms.uC0.value.setRGB(...(dress.theme.rim2 as [number, number, number]));
    dropMat.uniforms.uC1.value.setRGB(...(dress.theme.front as [number, number, number]));
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
        /** How near the cord it is (0…1), and which way that is. */
        uSunk: { value: 0 },
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
        uniform float uD, uSunk, uWay, uTime, uSeed, uLight;
        varying vec2 vQ;
        #define sq2(x) ((x) * (x))
        float grain(vec2 p) { return texture2D(tGrain, p).z; }
        void main() {
          vec2 q = vQ;
          float D = uD;
          // Its water, moving: two sheets of it.
          float n1 = grain(q * 0.085 + vec2(uTime * 0.006 + uSeed, -uTime * 0.004));
          float n2 = grain(q * 0.21 - vec2(uTime * 0.011, uTime * 0.008 - uSeed));
          float n3 = grain(q * 0.47 + vec2(uTime * 0.013, uSeed - uTime * 0.016));
          float n = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
          // Near the bone it is drawn to it, at the gaps more than elsewhere: the side that
          // faces it reaches out, in fingers.
          float finger = grain(vec2(q.y * 0.16 + uSeed * 3.0, uTime * 0.004 + 0.3));
          float feel = sin(3.14159 * clamp(uSunk, 0.0, 1.0)) * (1.0 - D);
          float facing = smoothstep(-0.1, 1.0, q.x * uWay);
          vec2 s = q;
          s.x /= 1.0 + feel * facing * (0.1 + 0.9 * smoothstep(0.46, 0.66, finger)) * 0.5;
          // In the bone: squeezed to the cord, drawn out along it, falling into threads.
          float m = smoothstep(0.08, 0.95, D);
          float thread = smoothstep(0.36, 0.68, grain(vec2(q.x * 0.3 + uSeed, q.y * 0.045 - uTime * 0.003)));
          s.x *= 1.0 + m * (0.3 + 1.3 * finger + 1.2 * smoothstep(0.7, 1.7, abs(q.y)));
          s.y *= 1.0 - m * (0.12 + 0.4 * thread);
          s += (vec2(n2, n3) - 0.5) * (0.12 + 0.5 * m) * min(1.0, D * 6.0 + feel * 0.5);
          float rs = length(s);
          vec4 b = rs < ${PIC.toFixed(2)} ? texture2D(tBall, s * ${(0.5 / PIC).toFixed(5)} + 0.5) : vec4(0.0);
          // It is eaten away, its rim first, in the pattern of its water…
          float whole = n + (1.0 - rs) * 0.34;
          float th = mix(0.1, 1.02, pow(D, 0.82));
          float keep = D < 0.001 ? 1.0 : smoothstep(th - 0.03, th + 0.05, whole);
          // …and every edge of that is alight; behind it goes a thinner film.
          // (A line, as wide on the screen wherever it runs: by how far it is, not by how much.)
          float far = (whole - th) / max(0.004, fwidth(whole));
          float burn = D < 0.001 ? 0.0 : exp(-sq2(far / 1.7)) + 0.22 * exp(-sq2(far / 7.0));
          float film = smoothstep(th - 0.2, th, whole) * (1.0 - keep);
          // Glass among the bones is clear: what stands in it is seen.
          float body = mix(1.0, 0.4, uSunk * (1.0 - 0.2 * D));
          float lum = dot(b.rgb, vec3(0.333));
          vec3 col = b.rgb * keep * mix(1.0, 0.8, uSunk) + b.rgb * film * 0.3;
          float a = b.a * keep * body + lum * film * 0.3;
          col += (uHue * 0.62 + vec3(0.2)) * burn * b.a * smoothstep(0.0, 0.12, D) * (1.0 - 0.5 * smoothstep(0.7, 1.0, D));
          a += burn * b.a * 0.2;
          // The air past its edge (as on its card).
          float r = length(q);
          float o = max(r - 0.84, 0.0);
          vec2 dir = q / max(r, 0.001);
          float rag = grain(dir * 0.16 + vec2(uTime * 0.005, uSeed));
          vec3 air = mix(uGlowA, uGlowB, rag) * 0.55 + uHue * 0.45;
          air *= (exp(-o * (6.0 - 3.0 * rag)) * 0.14 + exp(-o * 13.0) * 0.14) * smoothstep(2.1, 1.4, r) * 0.8;
          // (Behind it: it is not seen through a ball that is whole.)
          col += air * (1.0 - smoothstep(0.0, 0.55, D)) * (1.0 - uLight) * (1.0 - b.a * keep);
          if (a < 0.002 && max(col.r, max(col.g, col.b)) < 0.002) discard;
          // As deep as the ball is here (its middle, its radius); it sinks as it goes.
          float front = sqrt(max(0.0, 1.0 - rs * rs));
          float z = uHere.z + uHere.w * (front * (1.0 - 0.25 * m) - 0.5 * m);
          float vz = z - uP.z;
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

  /* ── its drops: round it, round the bones, and into them ── */
  const EACH = phone ? 90 : 170;
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
      /** How far gone, how near the cord, its drops' light. */
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
        // Its place in the disc round the ball, as on its card; nearer the cord, the tighter.
        float stray = step(0.76, seed.w);
        float tight = 1.0 - 0.62 * go.y;
        float r0 = 1.2 + pow(seed.x, 1.6) * mix(1.05, 0.7, stray) * tight;
        float a = seed.z * 6.2832 + uTime * 0.36 / pow(r0, 1.5) + uGd[w].z;
        // Then each in its turn lets itself be drawn in: round and round the bone…
        float tt = clamp((go.x - seed.x * 0.42 - seed.y * 0.06) / 0.46, 0.0, 1.0);
        float e = tt * tt * (3.0 - 2.0 * tt);
        float bone = uUnit * (0.62 + 0.75 * seed.w) / G.w;
        float r = mix(r0, mix(bone, 0.12, smoothstep(0.55, 1.0, tt)), e) * G.w;
        a += e * (3.0 + 4.0 * seed.w) * (seed.y > 0.5 ? 1.0 : 0.75);
        float y0 = (seed.y - 0.5) * G.w * mix(0.1, 1.35, stray) + sin(a) * r * 0.1;
        // …and up, or down, along it.
        float along = (seed.z > 0.5 ? 1.0 : -1.0) * (0.4 + 2.4 * seed.w) * G.w;
        vec3 p = vec3(G.x * (1.0 - e * 0.9) + cos(a) * r, G.y + mix(y0, y0 + along, e * e), G.z * (1.0 - e) + sin(a) * r);
        // Some are not drops but air: where it soaks into the bone it fizzes, and they rise.
        float fizz = step(0.62, fract(seed.x * 7.31 + seed.w * 3.7));
        float up = fract(uTime * (0.16 + 0.3 * seed.y) + seed.z);
        float fa = seed.w * 6.2832;
        float fr = uUnit * (0.5 + 0.85 * seed.x);
        vec3 air = vec3(cos(fa) * fr + sin(uTime * 2.1 + seed.z * 30.0) * 2.5, G.y + (seed.x - 0.62) * 1.5 * G.w + up * G.w * 0.8, sin(fa) * fr);
        float fizzing = smoothstep(0.02, 0.16, go.x) * (1.0 - smoothstep(0.62, 0.9, go.x)) * smoothstep(0.0, 0.12, up) * (1.0 - smoothstep(0.65, 1.0, up));
        p = mix(p, air, fizz);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = G.w > 0.5 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        float big = seed.y * seed.y * seed.y * seed.y;
        gl_PointSize = mix((1.5 + big * 6.4) * mix(1.0, 0.8, tt), 1.6 + 3.4 * seed.y * seed.y, fizz) * uRatio * (uDist / -mv.z);
        float hot = exp(-pow((tt - 0.62) / 0.22, 2.0));
        vA = (0.42 + 0.5 * seed.x) * (0.8 + 0.2 * sin(uTime * 1.5 + seed.z * 40.0)) * go.z * mix((1.0 - smoothstep(0.78, 1.0, tt)) * (0.55 + 0.7 * hot), fizzing * 0.9, fizz);
        vRing = max(step(0.5, seed.y), fizz);
        vC = mix(mix(seed.w < 0.6 ? uC0 : uC1, uGc[w].rgb, 0.35 + 0.4 * tt), vec3(1.0), 0.22 + 0.3 * hot);
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
  drops.renderOrder = 4;
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
        const x = g.x - p.mid;
        const y = p.H * 0.5 - (g.y - p.top);
        const off = Math.abs(x) / g.r;
        // On a desktop it comes from behind the bones, on a phone from before them.
        const sunk = phone ? smooth(0.75, 0.04, off) * g.come : smooth(0.82, 0.03, off);
        const z = (phone ? 1.5 : -1.35) * g.r * (1 - sunk);
        const r = g.r * (1 - 0.1 * smooth(0.1, 0.9, d));
        const whole = (1 - smooth(0.3, 0.86, d)) * smooth(0.12, 0.6, sunk);
        const soak = smooth(0.02, 0.36, d) * (1 - smooth(0.66, 1, d));
        at.set(x, y, z, r);
        u.uGc.value[i].set(g.hue[0], g.hue[1], g.hue[2], soak * (p.light ? 0.75 : 1));
        u.uGd.value[i].set(0.2 * whole * smooth(0.4, 1, sunk), whole, g.seed, 0.35 + 4.4 * Math.pow(d, 1.35));
        (dropMat.uniforms.uGo.value as THREE_NS.Vector4[])[i].set(d, sunk, (p.light ? 0.8 : 1) * g.bright, 0);
        mesh.position.set(x, y, 0);
        mesh.scale.setScalar(g.r);
        const m = mesh.material.uniforms;
        m.uHere.value.set(x, y, z, g.r);
        m.uHue.value.setRGB(g.hue[0], g.hue[1], g.hue[2]);
        m.uD.value = d;
        m.uSunk.value = sunk;
        m.uWay.value = x > 0 ? -1 : 1;
        m.uSeed.value = g.seed * 0.137;
        m.uP.value.set(pm[10], pm[14], camera.position.z);
      });
      drops.visible = n > 0;
      if (prime > 0) {
        prime--;
        drops.visible = true;
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
        if (!g || g.d > 0.94 || ((tick + i) % 2 && g.key === painted[i])) return;
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
      const all = compiled(renderer, group, camera);
      skins.forEach((m) => (m.visible = false));
      drops.visible = false;
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
    },
  };
}
