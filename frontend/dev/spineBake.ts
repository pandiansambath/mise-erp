// The spine's material, worked out once (§102.7).
//
// At a phone's full resolution the bones and the hanging chain cost the GPU
// three times what they did (10.1 ms a frame against 3.5 on a laptop's chip;
// the empty canvas 1.2): every pixel worked out a thin film's rainbow, a second
// gloss and three reflections of the room from nothing. But the camera never
// turns, so all of that depends on ONE thing — which way the surface faces. So
// it is drawn once per theme, by the very same material, onto a small picture
// of every direction a surface can face (a light probe of the material itself),
// and a pixel looks its direction up. The lights that drift up and down the
// bone are still worked out live (the rainbow on it never stands still): the
// same gloss and clear coat as three's, the film's colour looked up by angle.
//
// Everywhere now (§103.6): the bones are large and finely detailed, and what that
// detail needs — their grain, how occluded and how thin each point is, light through
// them — is worked out here on top of it.

import { compiled } from "./glGuard";
import type * as THREE_NS from "three";

type T = typeof THREE_NS;
type Color = THREE_NS.Color;

/** The film's reflectance by the angle it is seen at — three's own
 *  (iridescence_fragment.glsl.js, after Belcour & Barla 2017), on the CPU. */
export function film(cos1: number, ior: number, thickness: number, base: [number, number, number]): [number, number, number] {
  const sq = (x: number) => x * x;
  const schlick = (f0: number, c: number) => f0 + (1 - f0) * Math.pow(1 - c, 5);
  const c2sq = 1 - sq(1 / ior) * (1 - sq(cos1));
  if (c2sq < 0) return [1, 1, 1];
  const cos2 = Math.sqrt(c2sq);
  const r12 = schlick(sq((ior - 1) / (ior + 1)), cos1);
  const t121 = 1 - r12;
  const opd = 2 * ior * thickness * cos2;
  const pi = Math.PI;
  const baseIor = base.map((f) => (1 + Math.sqrt(Math.min(0.9999, Math.max(0, f)))) / (1 - Math.sqrt(Math.min(0.9999, Math.max(0, f)))));
  const r23 = baseIor.map((n) => schlick(sq((n - ior) / (n + ior)), cos2));
  const phi = baseIor.map((n) => pi + (n < ior ? pi : 0));
  const r123 = r23.map((r) => Math.min(0.9999, Math.max(1e-5, r12 * r)));
  const rs = r23.map((r, i) => (sq(t121) * r) / (1 - r123[i]));
  const sens = (o: number, sh: number[]) => {
    const ph = 2 * pi * o * 1e-9;
    const val = [5.4856e-13, 4.4201e-13, 5.2481e-13];
    const pos = [1.681e6, 1.7953e6, 2.2084e6];
    const vr = [4.3278e9, 9.3046e9, 6.6121e9];
    const xyz = val.map((v, i) => v * Math.sqrt(2 * pi * vr[i]) * Math.cos(pos[i] * ph + sh[i]) * Math.exp(-sq(ph) * vr[i]));
    xyz[0] += 9.747e-14 * Math.sqrt(2 * pi * 4.5282e9) * Math.cos(2.2399e6 * ph + sh[0]) * Math.exp(-4.5282e9 * sq(ph));
    const [x, y, z] = xyz.map((v) => v / 1.0685e-7);
    return [3.2404542 * x - 1.5371385 * y - 0.4985314 * z, -0.969266 * x + 1.8760108 * y + 0.041556 * z, 0.0556434 * x - 0.2040259 * y + 1.0572252 * z];
  };
  const out = rs.map((r) => r12 + r);
  let cm = rs.map((r) => r - t121);
  for (let m = 1; m <= 2; m++) {
    cm = cm.map((v, i) => v * Math.sqrt(r123[i]));
    const s = sens(m * opd, phi.map((p) => m * p));
    for (let i = 0; i < 3; i++) out[i] += cm[i] * 2 * s[i];
  }
  return out.map((v) => Math.min(1, Math.max(0, v))) as [number, number, number];
}

/** One gloss lobe, as three's: GGX, height-correlated Smith. */
export const LOBE = /* glsl */ `
  float lobe(float a, float nl, float nv, float nh) {
    float a2 = a * a;
    float d = nh * nh * (a2 - 1.0) + 1.0;
    float v = 0.5 / max(nl * sqrt(a2 + (1.0 - a2) * nv * nv) + nv * sqrt(a2 + (1.0 - a2) * nl * nl), 1e-4);
    return a2 * 0.3183099 / (d * d) * v;
  }`;

/** A picture of a material by the way it faces. */
export function capTarget(THREE: T, renderer: THREE_NS.WebGLRenderer, size: number): THREE_NS.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(size, size, {
    // (Small floats where they can be drawn to: read at twice the speed of half floats.)
    ...(renderer.extensions.has("EXT_color_buffer_float") ? { format: THREE.RGBFormat, internalFormat: "R11F_G11F_B10F" as const } : {}),
    type: THREE.HalfFloatType,
    depthBuffer: false,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
  });
}
/** Every direction a surface can face, as a flat sheet with those normals: the
 *  physical material shades it as it would a ball, with no dark edge. */
export function facingSheet(THREE: T): THREE_NS.BufferGeometry {
  const sheet = new THREE.PlaneGeometry(2, 2, 96, 96);
  const p = sheet.getAttribute("position");
  const nn = sheet.getAttribute("normal");
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / 0.99;
    const y = p.getY(i) / 0.99;
    const r = Math.hypot(x, y);
    if (r < 0.9999) nn.setXYZ(i, x, y, Math.sqrt(1 - r * r));
    else nn.setXYZ(i, x / r, y / r, 0.004);
  }
  return sheet;
}

const VERT = /* glsl */ `
  varying vec3 vNw;
  varying vec3 vPw;
  #ifdef LINK
  varying vec3 vTint;
  #endif
  #ifdef BONE
  attribute vec4 aBake;
  varying vec3 vO, vNo, vBake, vR0, vR1, vR2;
  #endif
  #ifdef GUESTS
  // The balls that have come to the skeleton (§106.13, spineGuests): this bone answers the
  // nearest of them (it is the same for the whole bone).
  uniform vec4 uG[GUESTS], uGc[GUESTS], uGd[GUESTS];
  varying vec4 vG, vGc, vGd;
  #endif
  #ifdef SHATTER
  // A bone in pieces (§104.3). Each piece is rigid: where it flies, how it tumbles and the
  // way it comes home are worked out here, from which bone it is of and which piece.
  // aLife: how far apart (px) · how long it has flown (s) · how far home (0–1) · its light
  attribute vec4 aLife;
  attribute float aSeed;
  uniform vec4 uCents[24];
  uniform vec3 uBlast;
  uniform float uUnit, uFall;
  varying vec2 vIn;
  vec3 rnd3(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
    q += dot(q, q.yxz + 33.33);
    return fract((q.xxy + q.yxx) * q.zyx);
  }
  vec3 turned(vec3 v, vec3 ax, float a) { float c = cos(a); return v * c + cross(ax, v) * sin(a) + ax * dot(ax, v) * (1.0 - c); }
  #endif
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vec4 wp = m * vec4(position, 1.0);
    vNw = mat3(m) * normal;
    #ifdef BONE
    vO = position;
    vNo = normal;
    vBake = aBake.xyz;
    vR0 = normalize(m[0].xyz);
    vR1 = normalize(m[1].xyz);
    vR2 = normalize(m[2].xyz);
    #endif
    #ifdef SHATTER
    float code = floor(aBake.w * 255.0 + 0.5);
    float piece = floor(code * 0.5);
    vec4 cv = uCents[int(piece)];
    vec3 cen = (m * vec4(cv.xyz, 1.0)).xyz;
    vec3 mid = (m * vec4(0.0, 0.0, -0.24, 1.0)).xyz;
    vec3 r = rnd3(vec2(piece * 7.31 + 1.0, aSeed * 97.0));
    vec3 r2 = rnd3(vec2(piece * 3.17 + 41.0, aSeed * 61.0 + 5.0));
    vec3 out3 = normalize(cen - mid + (r - 0.5) * uUnit * 0.3 + 1e-3);
    // Out from the bone's own middle, and away from where it was struck; the small ones
    // the faster.
    float small = clamp(1.25 - cv.w * 3.4, 0.45, 1.25);
    vec3 hit = cen - uBlast;
    float hd = length(hit);
    vec3 vel = out3 * mix(120.0, 520.0, r.x * r.x) * small;
    vel += hit / max(hd, 1.0) * 560.0 * exp(-hd / (uUnit * 4.2)) * (0.5 + 0.5 * r.y);
    vel += (r2 - vec3(0.5, 0.42, 0.34)) * vec3(190.0, 260.0, 420.0);
    float tau = aLife.y;
    float flown = (1.0 - exp(-1.75 * tau)) / 1.75;
    vec3 off = vel * flown;
    off.y -= uFall * tau * tau * (0.55 + 0.9 * r.y);
    float spin = (1.5 + 9.0 * r.z * small) * flown * (r2.x > 0.5 ? 1.0 : -1.0);
    vec3 ax = normalize(r2 - 0.5 + 1e-3);
    // Home: the spiral drawn in, each a little after the last.
    float h = clamp(aLife.z * 1.35 - r.y * 0.35, 0.0, 1.0);
    float e = h * h * h * (h * (h * 6.0 - 15.0) + 10.0);
    float s = sin(3.1 * e), c = cos(3.1 * e);
    off = vec3(off.x * c + off.z * s, off.y, -off.x * s + off.z * c) * (1.0 - e);
    spin *= 1.0 - e;
    float apart = aLife.x;
    off += out3 * apart * (0.45 + 0.9 * r.x);
    spin += apart * 0.022 * (r.z - 0.5);
    wp.xyz = cen + turned(wp.xyz - cen, ax, spin) + off;
    vNw = turned(vNw, ax, spin);
    vR0 = turned(vR0, ax, spin);
    vR1 = turned(vR1, ax, spin);
    vR2 = turned(vR2, ax, spin);
    vIn = vec2(code - piece * 2.0, aLife.w);
    #endif
    #ifdef GUESTS
    vG = vGc = vGd = vec4(0.0);
    float best = 7.0;
    for (int i = 0; i < GUESTS; i++) {
      float far = uG[i].w > 0.5 ? abs(m[3].y - uG[i].y) / uG[i].w : 9.0;
      if (far < best) {
        best = far;
        vG = uG[i];
        vGc = uGc[i];
        vGd = uGd[i];
      }
    }
    #endif
    vPw = wp.xyz;
    #ifdef LINK
    vTint = instanceColor;
    #endif
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const FRAG = /* glsl */ `
#define sq2(x) ((x) * (x))

  uniform sampler2D uCap;
  uniform sampler2D uFilm;
  uniform float uRough, uCoat, uCoatRough, uRow;
  uniform vec3 uLP0, uLP1, uLC0, uLC1, uRimD, uRimC;
  #ifdef LINK
  uniform sampler2D uCap1;
  uniform float uRow1, uL0, uL1;
  varying vec3 vTint;
  #else
  uniform float uLine, uLit, uPulseY, uPulse;
  uniform vec3 uLitCol, uPulseCol;
  #endif
  #ifdef BONE
  uniform sampler2D tGrain, uFilmB;
  uniform vec3 uInner;
  uniform float uGrain, uNearY, uNear;
  varying vec3 vO, vNo, vBake, vR0, vR1, vR2;
  #endif
  #ifdef SHATTER
  varying vec2 vIn;
  #endif
  #ifdef GUESTS
  uniform float uGt;
  varying vec4 vG, vGc, vGd;
  #endif
  varying vec3 vNw;
  varying vec3 vPw;
  ${LOBE}
  void main() {
    #ifdef BONE
    // The bone's grain, laid on from three sides, in the bone's own space.
    vec3 no = normalize(vNo);
    vec3 w3 = no * no;
    w3 *= w3;
    w3 /= w3.x + w3.y + w3.z;
    vec3 q = vO * 3.0;
    vec3 gx = texture2D(tGrain, q.zy * 0.62).xyz;
    vec3 gy = texture2D(tGrain, q.xz * 0.62 + 0.37).xyz;
    vec3 gz = texture2D(tGrain, q.xy * 0.62 + 0.71).xyz;
    float marble = gx.z * w3.x + gy.z * w3.y + gz.z * w3.z;
    vec3 bump = vec3(0.0, gx.y - 0.5, gx.x - 0.5) * w3.x + vec3(gy.x - 0.5, 0.0, gy.y - 0.5) * w3.y + vec3(gz.x - 0.5, gz.y - 0.5, 0.0) * w3.z;
    no = normalize(no + bump * uGrain);
    vec3 n = normalize(vR0 * no.x + vR1 * no.y + vR2 * no.z);
    float ao = vBake.x * vBake.x;
    float thin = vBake.y;
    float edge = vBake.z;
    #ifdef SHATTER
    // (A broken face: dark, deep, like the glass it is, not pale.)
    ao *= 1.0 - 0.6 * vIn.x;
    thin *= 1.0 - 0.75 * vIn.x;
    #endif
    #else
    vec3 n = normalize(vNw);
    #endif
    vec3 v = normalize(cameraPosition - vPw);
    // Where this direction is on the picture of the material.
    vec3 x = normalize(vec3(v.z, 0.0, -v.x));
    vec3 y = cross(v, x);
    vec2 uv = vec2(dot(x, n), dot(y, n)) * 0.495 + 0.5;
    float nv = clamp(dot(n, v), 0.001, 1.0);
    #ifdef BONE
    // The film is thicker here and thinner there, so its colours drift over the
    // bone like oil on water, not by angle alone.
    float lay = clamp(0.5 + (marble - 0.5) * 1.9 + 0.16 * sin(q.y * 2.1 + q.x * 1.3) + (1.0 - ao) * 0.18, 0.02, 0.98);
    vec3 f = texture2D(uFilmB, vec2(nv, lay)).rgb;
    vec3 hue = f / max(0.05, dot(f, vec3(0.3333)));
    hue = max(vec3(0.0), mix(vec3(1.0), hue, 1.6));
    vec3 hue2 = hue.zxy;
    vec3 col = texture2D(uCap, uv).rgb * mix(0.16, 1.0, ao) * mix(vec3(1.0), hue, 0.85);
    // Glass: what is behind it, bent through it…
    float fres = (1.0 - nv) * (1.0 - nv) * (1.0 - nv);
    vec3 rf = refract(-v, n, 0.7);
    col += texture2D(uCap, vec2(dot(x, -rf), dot(y, -rf)) * 0.44 + 0.5).rgb * hue2 * (1.0 - fres) * (0.3 + 0.4 * thin) * mix(0.4, 1.0, ao);
    #ifdef FINE
    // …flaws deep in it, that glint and go as it turns (§104.2)…
    vec2 iu = vec2(q.x + q.z * 0.8, q.y) * 1.1 + vec2(dot(x, rf), dot(y, rf)) * 0.55;
    vec2 flaw = texture2D(tGrain, iu).xy - 0.5;
    float glint = smoothstep(0.2, 0.42, length(flaw)) * smoothstep(0.1, 0.9, dot(normalize(vec3(flaw, 0.25)), vec3(dot(x, n), dot(y, n), nv)));
    col += (hue2 * 0.3 + uInner * 0.22) * glint * (1.0 - fres) * mix(0.25, 1.0, ao);
    #endif
    // …the cord's light shining through where it is thin, and its sharp edges
    // catching the film.
    col += uInner * (0.34 * thin * thin + 0.4 * thin * fres) * (0.4 + 0.6 * marble) * (0.35 + 0.65 * ao);
    col += hue * (0.05 + 0.2 * fres) * edge * edge * edge * ao;
    // Its outline, lit by the room behind it.
    col += hue * hue * (uLC0 + uLC1) * (0.003 + 0.085 * fres) * ao;
    #else
    vec3 col = texture2D(uCap, uv).rgb;
    vec3 f = texture2D(uFilm, vec2(nv, uRow)).rgb;
    #endif
    #ifdef LINK
    float l = dot(vTint, vec3(0.3333));
    float metal = clamp((l - uL0) / max(0.001, uL1 - uL0), 0.0, 1.0);
    float boost = max(1.0, l / uL1);
    col = mix(col, texture2D(uCap1, uv).rgb, metal) * boost;
    f = mix(f, texture2D(uFilm, vec2(nv, uRow1)).rgb, metal) * boost;
    #endif
    // The lights that move. The finer than a pixel, the softer the gloss (or
    // it breaks into sparkles).
    vec3 dn = max(abs(dFdx(n)), abs(dFdy(n)));
    float grain = max(max(dn.x, dn.y), dn.z);
    float a = sq2(min(1.0, uRough + grain));
    float ac = sq2(min(1.0, uCoatRough + grain));
    float gz1 = 1.0 - nv;
    float gz2 = gz1 * gz1;
    float coat = uCoat * (0.04 + 0.96 * gz2 * gz2 * gz1);
    #ifdef BONE
    // The two that drift up and down it. The same gloss and clear coat, with Kelemen's
    // visibility (no roots) instead of Smith's: at a phone's full sharpness the lights were
    // nearly half of what the whole skeleton cost. (The third stands behind it: what it
    // touches is the outline, drawn above.) And a broad sheen under the sharp gloss, in
    // the film's colours.
    float a2 = a * a;
    float ac2 = ac * ac;
    vec3 under = f * ((1.0 - coat) * mix(0.25, 1.0, ao));
    float over = uCoat * mix(0.25, 1.0, ao);
    vec3 sheen = hue * hue * (0.0026 * ao);
    for (int i = 0; i < 2; i++) {
      vec3 ld = normalize((i == 0 ? uLP0 : uLP1) - vPw);
      float nl = max(0.0, dot(n, ld));
      vec3 h = normalize(ld + v);
      float nh = max(0.0, dot(n, h));
      float vh = max(0.12, dot(v, h));
      float nh2 = nh * nh;
      float d1 = nh2 * (a2 - 1.0) + 1.0;
      float d2 = nh2 * (ac2 - 1.0) + 1.0;
      float s1 = 1.0 - vh;
      float s2 = s1 * s1;
      float k = nl * 0.0925 / (vh * vh);
      col += (i == 0 ? uLC0 : uLC1) * (under * (a2 / (d1 * d1) * k) + vec3(over * (0.04 + 0.96 * s2 * s2 * s1) * ac2 / (d2 * d2) * k) + sheen * (nl * nh2 * nh2 * nh2 * 7.0));
    }
    #else
    for (int i = 0; i < 3; i++) {
      vec3 ld = i == 0 ? normalize(uLP0 - vPw) : i == 1 ? normalize(uLP1 - vPw) : uRimD;
      vec3 lc = i == 0 ? uLC0 : i == 1 ? uLC1 : uRimC;
      float nl = dot(n, ld);
      if (nl <= 0.0) continue;
      vec3 h = normalize(ld + v);
      float nh = clamp(dot(n, h), 0.0, 1.0);
      float vh = clamp(dot(v, h), 0.0, 1.0);
      col += lc * nl * (f * lobe(a, nl, nv, nh) * (1.0 - coat) + uCoat * (0.04 + 0.96 * pow(max(0.0, 1.0 - vh), 5.0)) * lobe(ac, nl, nv, nh));
    }
    #endif
    #ifndef LINK
    float litAbove = smoothstep(uLine - 40.0, uLine + 40.0, vPw.y);
    float surge = exp(-sq2((vPw.y - uPulseY) / 44.0)) * uPulse;
    #ifdef BONE
    // (Lit from within: the thin parts and the edges first.)
    float glowIn = 0.12 + 1.1 * thin * thin + 0.55 * fres * ao;
    col += uLitCol * litAbove * uLit * glowIn + uPulseCol * surge * glowIn;
    // Near the cursor it wakes a little: it can be touched (§104.3).
    col += uInner * (uNear * exp(-sq2((vPw.y - uNearY) / 52.0)) * (0.1 + 0.9 * glowIn));
    #ifdef SHATTER
    // Inside: crystal, freshly broken — clear, bright-edged, and lit by what still burns
    // in it; outside, the cracks let that light through.
    col = mix(col, col * 0.95 + hue * hue * (0.02 + 0.3 * fres) + uInner * (0.02 + 0.05 * marble * marble), vIn.x);
    float veins = smoothstep(0.42, 0.72, marble);
    col += (uInner * 0.95 + uPulseCol * 0.22) * vIn.y * (vIn.x * (0.07 + 0.42 * veins + 0.3 * edge * edge) + edge * edge * 0.1 + thin * thin * 0.16);
    #endif
    #ifdef GUESTS
    if (vG.w > 0.5) {
      vec3 rel = (vPw - vG.xyz) / vG.w;
      float ds = length(rel);
      vec3 hueB = vGc.rgb;
      float whole = vGd.y;
      float soak = vGc.a;
      float tall = abs(rel.y);
      // The ball's own light, on the bones it comes to.
      float lam = max(0.0, dot(n, -rel / max(ds, 0.001)));
      col += hueB * lam * (0.25 + 0.75 * ao) / (1.0 + 1.8 * ds * ds) * 0.3 * whole;
      // What has gone into the bone: its light runs up and down it, in its veins first, softly, and
      // dies down.
      float run = vGd.w;
      float ragged = (marble - 0.5) * 0.9;
      float here = smoothstep(run + 0.8, run - 1.1, tall + ragged);
      float fine2 = soak > 0.002 ? texture2D(tGrain, q.xy * 1.9 + 0.2).z * w3.z + texture2D(tGrain, q.zy * 1.9 + 0.2).z * (1.0 - w3.z) : 0.5;
      float vein = smoothstep(0.07, 0.0, abs(marble - 0.5 + (fine2 - 0.5) * 0.42 + 0.02 * sin(uGt * 0.5 + q.y * 2.0))) + 0.45 * smoothstep(0.05, 0.0, abs(fine2 - 0.5));
      col += hueB * soak * here * (0.015 + 0.26 * vein + 0.13 * thin * thin + 0.04 * edge * edge + 0.06 * fres) * mix(0.35, 1.0, ao);
    }
    #endif
    #else
    col += uLitCol * litAbove * uLit + uPulseCol * surge;
    #endif
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export type BakedSpine = {
  bone: THREE_NS.ShaderMaterial;
  /** The bone's, for one in pieces: their middles, and their sizes. */
  broken: (cents: Float32Array) => THREE_NS.ShaderMaterial;
  link: THREE_NS.ShaderMaterial;
  /** Draw the pictures again (a theme's colours, its room). */
  bake: () => void;
  /** Their shaders, built off the main thread first. */
  warm: () => Promise<void>;
  dispose: () => void;
};

export function bakedSpine(
  THREE: T,
  renderer: THREE_NS.WebGLRenderer,
  src: {
    bone: THREE_NS.MeshPhysicalMaterial;
    link: THREE_NS.MeshPhysicalMaterial;
    glow: Record<string, { value: unknown }>;
    lights: { a: THREE_NS.PointLight; b: THREE_NS.PointLight; rim: THREE_NS.DirectionalLight };
    tints: { dark: Color; bright: Color };
    room: () => THREE_NS.Texture | null;
    /** The bones' grain, and how finely it is drawn. */
    grain: THREE_NS.Texture;
    inner: { value: Color };
    /** Where the cursor is by it (scene y), and how near. */
    near: { uNearY: { value: number }; uNear: { value: number } };
    /** Where it was struck, its size, how fast its pieces sink. */
    blast: { uBlast: { value: THREE_NS.Vector3 }; uUnit: { value: number }; uFall: { value: number } };
    /** The balls that have come to it (spineGuests), and how many there can be. */
    guests?: { uniforms: Record<string, { value: unknown }>; many: number };
    fine: boolean;
  },
): BakedSpine {
  const { bone, link, glow, lights, tints } = src;
  const capBone = capTarget(THREE, renderer, 256);
  const capDark = capTarget(THREE, renderer, 256);
  const capBright = capTarget(THREE, renderer, 256);
  // The film by angle: bone, dark link, bright link.
  const FN = 64;
  const filmData = new Uint8Array(FN * 3 * 4);
  const filmTex = new THREE.DataTexture(filmData, FN, 3, THREE.RGBAFormat, THREE.UnsignedByteType);
  filmTex.minFilter = filmTex.magFilter = THREE.LinearFilter;

  const sheet = facingSheet(THREE);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  cam.position.z = 5;
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.06));
  const boneCopy = bone.clone();
  const linkCopy = link.clone();
  // A touch softer: on a bone a few pixels across, the real gloss is (three
  // widens it by how fast the surface turns under a pixel).
  for (const m of [boneCopy, linkCopy]) {
    m.roughness += 0.05;
    m.clearcoatRoughness += 0.05;
  }
  const mesh = new THREE.Mesh<THREE_NS.BufferGeometry, THREE_NS.Material>(sheet, boneCopy);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const lightUniforms = {
    uLP0: { value: lights.a.position },
    uLP1: { value: lights.b.position },
    uLC0: { value: new THREE.Color() },
    uLC1: { value: new THREE.Color() },
    uRimD: { value: lights.rim.position.clone().normalize() },
    uRimC: { value: new THREE.Color() },
    uFilm: { value: filmTex },
  };
  const make = (m: THREE_NS.MeshPhysicalMaterial, cap: THREE_NS.WebGLRenderTarget, row: number, extra: Record<string, { value: unknown }>, defines: Record<string, string>) =>
    new THREE.ShaderMaterial({
      defines,
      uniforms: {
        ...lightUniforms,
        ...extra,
        uCap: { value: cap.texture },
        uRow: { value: (row + 0.5) / 3 },
        uRough: { value: Math.max(0.0525, m.roughness) },
        uCoat: { value: m.clearcoat },
        uCoatRough: { value: Math.max(0.0525, m.clearcoatRoughness) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
  const boneSet = { ...glow, ...src.near, tGrain: { value: src.grain }, uFilmB: { value: null as THREE_NS.Texture | null }, uInner: src.inner, uGrain: { value: src.fine ? 1.5 : 1.2 } };
  const boneDef: Record<string, string> = src.fine ? { BONE: "", FINE: "" } : { BONE: "" };
  const boneOut = make(bone, capBone, 0, { ...boneSet, ...src.guests?.uniforms }, src.guests ? { ...boneDef, GUESTS: `${src.guests.many}` } : boneDef);
  const brokenOut: THREE_NS.ShaderMaterial[] = [];
  const linkOut = make(link, capDark, 1, { uCap1: { value: capBright.texture }, uRow1: { value: 2.5 / 3 }, uL0: { value: 0.1 }, uL1: { value: 0.9 } }, { LINK: "" });

  const base = (m: THREE_NS.MeshPhysicalMaterial, c: Color): [number, number, number] => {
    const f = (v: number) => 0.04 * (1 - m.metalness) + v * m.metalness;
    return [f(c.r), f(c.g), f(c.b)];
  };
  // The bones' film: by angle and by its thickness.
  const BN = 20;
  const filmBData = new Uint8Array(FN * BN * 4);
  const filmB = new THREE.DataTexture(filmBData, FN, BN, THREE.RGBAFormat, THREE.UnsignedByteType);
  filmB.minFilter = filmB.magFilter = THREE.LinearFilter;
  const sheetOfFilm = (m: THREE_NS.MeshPhysicalMaterial, c: Color) => {
    const b = base(m, c);
    for (let j = 0; j < BN; j++)
      for (let i = 0; i < FN; i++) {
        const f = film((i + 0.5) / FN, m.iridescenceIOR, 230 + (j / (BN - 1)) * 560, b);
        const o = (j * FN + i) * 4;
        for (let k = 0; k < 3; k++) filmBData[o + k] = Math.round(f[k] * 255);
        filmBData[o + 3] = 255;
      }
    filmB.needsUpdate = true;
  };
  boneOut.uniforms.uFilmB.value = filmB;
  const row = (n: number, m: THREE_NS.MeshPhysicalMaterial, c: Color) => {
    const b = base(m, c);
    for (let i = 0; i < FN; i++) {
      const f = film((i + 0.5) / FN, m.iridescenceIOR, m.iridescenceThicknessRange[1], b);
      for (let k = 0; k < 3; k++) filmData[(n * FN + i) * 4 + k] = Math.round(f[k] * 255);
      filmData[(n * FN + i) * 4 + 3] = 255;
    }
  };
  const shoot = (to: THREE_NS.WebGLRenderTarget, m: THREE_NS.MeshPhysicalMaterial) => {
    mesh.material = m;
    renderer.setRenderTarget(to);
    renderer.render(scene, cam);
  };
  const bake = () => {
    const room = src.room();
    if (!room) return;
    scene.environment = room;
    const was = renderer.getRenderTarget();
    boneCopy.color.copy(bone.color);
    shoot(capBone, boneCopy);
    linkCopy.color.copy(tints.dark);
    shoot(capDark, linkCopy);
    linkCopy.color.copy(tints.bright);
    shoot(capBright, linkCopy);
    renderer.setRenderTarget(was);
    row(0, bone, bone.color);
    sheetOfFilm(bone, bone.color);
    row(1, link, tints.dark);
    row(2, link, tints.bright);
    filmTex.needsUpdate = true;
    lightUniforms.uLC0.value.copy(lights.a.color).multiplyScalar(lights.a.intensity);
    lightUniforms.uLC1.value.copy(lights.b.color).multiplyScalar(lights.b.intensity);
    lightUniforms.uRimC.value.copy(lights.rim.color).multiplyScalar(lights.rim.intensity);
    const lum = (c: Color) => (c.r + c.g + c.b) / 3;
    linkOut.uniforms.uL0.value = lum(tints.dark);
    linkOut.uniforms.uL1.value = lum(tints.bright);
  };
  return {
    bone: boneOut,
    broken: (cents) => {
      const m = make(bone, capBone, 0, { ...boneSet, ...src.blast, uCents: { value: cents } }, { ...boneDef, SHATTER: "" });
      brokenOut.push(m);
      return m;
    },
    link: linkOut,
    bake,
    warm: async () => {
      const room = src.room();
      if (!room) return;
      scene.environment = room;
      for (const m of [boneCopy, linkCopy]) {
        mesh.material = m;
        await compiled(renderer, scene, cam);
      }
    },
    dispose: () => {
      for (const t of [capBone, capDark, capBright]) t.dispose();
      filmTex.dispose();
      filmB.dispose();
      sheet.dispose();
      for (const m of [boneCopy, linkCopy, boneOut, linkOut, ...brokenOut]) m.dispose();
    },
  };
}
