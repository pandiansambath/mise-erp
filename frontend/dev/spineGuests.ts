// A ball that has come to the skeleton, and goes into it (§106.13).
//
//   "the ball… when I scroll, that ball is disappearing: instead make that ball dissolve
//    inside the skeleton… now our skeleton is bit big, so we can clearly show that dissolve
//    effect in a cool way, with [a] super cool transition, with more realistic detailing"
//    (24 Nov)
//
// It is the card's own ball (cardScene), drawn here to a small picture. The first evening it was
// hung among the bones as deep as a ball is, bones standing in it, and eaten away there from its
// rim: "that ball dissolve and evolve is not so natural… I can still see that ball inside the
// skeleton, why… it needs to dissolve in a smooth way" (25 Nov). So it never goes in. It comes to
// the bones' edge and stops; and it lets go there, the side that touches first, softly, in the
// pattern of its own water, on through it to the far side; what lets go is fine drops, hundreds,
// drawn in among the bones on curved ways, each with its own light; the rest of it thins, and
// leans to them, and is gone. In the bones the light of it runs up and down, in their veins and
// the nerves, and dies down. Where one has scrolled says whether it melts; the melting itself is
// its own (CardGL `melt`): begun, it goes on to its end, a flick of the wheel does not cut it short
// and stopping does not leave it half done. It runs backwards, too: light gathers, drops come out and come together, and there is a ball, which unwinds into
// the next card.

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
          // It is drawn to the bone: it leans to it, and the side that faces it reaches out a little.
          float away = -uWay * q.x;
          float touch = smoothstep(0.0, 0.25, D) * (1.0 - smoothstep(0.8, 1.0, D));
          vec2 s = q / (1.0 - 0.2 * smoothstep(0.1, 1.0, D));
          s.x += uWay * 0.3 * smoothstep(0.15, 1.0, D);
          s.x *= 1.0 - 0.2 * touch * smoothstep(0.1, 1.2, away) * (0.3 + 1.3 * smoothstep(0.4, 0.62, grain(vec2(q.y * 0.13 + uSeed * 3.0, uTime * 0.003))));
          s += (vec2(n1, n2) - 0.5) * 0.3 * smoothstep(0.02, 0.5, D);
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
          // As deep as its middle: behind the bones it comes to (before them, on a phone).
          float vz = uHere.z - uP.z;
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

  /* ── what lets go of it: fine drops, drawn in among the bones ── */
  const EACH = phone ? 320 : 900;
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
        float t0 = clamp((1.95 - away) / 3.75 - 0.15 + 0.2 * (seed.w - 0.5), 0.0, 0.62);
        float tt = clamp((go.x - t0) / (0.26 + 0.12 * seed.y), 0.0, 1.0);
        float e = tt * tt * (3.0 - 2.0 * tt);
        float shrink = 1.0 - 0.2 * smoothstep(0.1, 1.0, go.x);
        vec3 from = vec3(G.x - go.y * 0.3 * G.w * smoothstep(0.15, 1.0, go.x) + disc.x * G.w * shrink, G.y + disc.y * G.w * shrink, G.z);
        // Into the bones: a place along the cord, round it, up or down from there.
        float ta = seed.w * 6.2832 + a0;
        float along = (seed.y - 0.5) * 2.0;
        vec3 to = vec3(cos(ta) * uUnit * (0.2 + 0.7 * seed.x), G.y + (disc.y * 0.5 + along * (0.5 + 0.9 * seed.w)) * G.w, sin(ta) * uUnit * (0.3 + 0.6 * seed.x));
        vec3 p = mix(from, to, e);
        // On a curved way, with the water.
        float arc = sin(3.14159 * tt);
        p.y += arc * G.w * (seed.y - 0.5) * 0.7;
        p.x += arc * sin(a0 * 3.0 + uTime * 0.8) * 7.0;
        p.z += arc * (seed.w - 0.3) * uUnit * 0.9;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = G.w > 0.5 && tt > 0.001 && tt < 0.999 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        float big = seed.y * seed.y * seed.y;
        gl_PointSize = (1.3 + 5.4 * big * seed.x) * (1.0 - 0.4 * e) * uRatio * (uDist / -mv.z);
        vA = smoothstep(0.0, 0.16, tt) * (1.0 - smoothstep(0.66, 1.0, tt)) * (0.5 + 0.5 * seed.x) * (0.82 + 0.18 * sin(uTime * 2.0 + seed.z * 40.0)) * go.z;
        vRing = step(0.8, seed.y);
        vC = mix(mix(seed.w < 0.6 ? uC0 : uC1, uGc[w].rgb, 0.6), vec3(1.0), 0.25 + 0.25 * arc);
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
        // Behind the bones it comes to, on a desktop; on a phone before them (its card is).
        const z = (phone ? 1.6 : -1.3) * g.r;
        const way = x >= 0 ? 1 : -1;
        const whole = (1 - smooth(0.2, 0.9, d)) * (phone ? g.come : 1) * (g.ball ? 1 : 0);
        const soak = smooth(0.04, 0.6, d) * (1 - smooth(0, 1, g.past));
        at.set(x, y, z, g.r);
        u.uGc.value[i].set(g.hue[0], g.hue[1], g.hue[2], soak * (p.light ? 0.75 : 1));
        u.uGd.value[i].set(0, whole * smooth(170, 70, Math.abs(x)), g.seed, 0.2 + 1.7 * smooth(0, 1, d) + 1.5 * g.past);
        (dropMat.uniforms.uGo.value as THREE_NS.Vector4[])[i].set(d, way, (p.light ? 0.85 : 1) * g.bright, 0);
        mesh.visible = g.ball && d < 1;
        mesh.position.set(x, y, 0);
        mesh.scale.setScalar(g.r);
        const m = mesh.material.uniforms;
        m.uHere.value.set(x, y, z, g.r);
        m.uHue.value.setRGB(g.hue[0], g.hue[1], g.hue[2]);
        m.uD.value = d;
        m.uWay.value = way;
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
        if (!g || !g.ball || g.d > 0.97 || ((tick + i) % 2 && g.key === painted[i])) return;
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
