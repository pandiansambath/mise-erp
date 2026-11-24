"use client";

// What the opening (opening.ts) is made of: its shaders, and the numbers each grain is
// born with. Nothing here moves by itself: every place is a function of the clock.

export type Kind = "blit" | "noise" | "soft" | "core" | "home" | "motes" | "lanes" | "grains" | "rays" | "shell" | "dust" | "tails";

/** What each piece is fed, in the order it is bound. */
export const ATTRS: Record<Kind, [string, number][]> = {
  blit: [["aP", 2]],
  noise: [["aP", 2]],
  soft: [["aP", 2]],
  core: [["aP", 2]],
  home: [["aP", 2]],
  motes: [
    ["aA", 4],
    ["aB", 2],
  ],
  lanes: [
    ["aA", 4],
    ["aB", 4],
    ["aC", 2],
  ],
  grains: [
    ["aA", 4],
    ["aB", 4],
  ],
  rays: [
    ["aA", 4],
    ["aB", 4],
    ["aC", 2],
  ],
  shell: [["aA", 4]],
  dust: [
    ["aA", 4],
    ["aB", 4],
    ["aC", 4],
    ["aD", 4],
  ],
  tails: [
    ["aA", 4],
    ["aB", 4],
    ["aC", 4],
    ["aD", 4],
    ["aE", 2],
  ],
};

const HEAD = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define TAU 6.2831853
uniform vec2 uHalf;
uniform float uPx, uLit;
uniform vec3 uHot, uGold, uA, uA2, uB2, uC;
`;
const VERT = `precision highp float;
#define TAU 6.2831853
uniform vec2 uHalf;
uniform float uPx, uLit;
uniform vec3 uHot, uGold, uA, uA2, uB2, uC;
vec3 hue(float c) { return c < 0.5 ? uB2 : (c < 1.5 ? uA2 : (c < 2.5 ? uC : (c < 3.5 ? uGold : uHot))); }
vec4 at(vec2 p) { return vec4(p.x / uHalf.x, -p.y / uHalf.y, 0.0, 1.0); }
vec2 turned(vec2 v, float a) { float c = cos(a); float s = sin(a); return vec2(v.x * c - v.y * s, v.x * s + v.y * c); }
`;
// How far the front is from a true circle, at an angle.
const WAVE = /* glsl */ `
uniform vec3 uBent;
float wave(float a, float tau) {
  return 0.5 * sin(a * 3.0 + uBent.x + tau * 1.1) + 0.32 * sin(a * 5.0 - uBent.y - tau * 1.7) + 0.18 * sin(a * 11.0 + uBent.z + tau * 2.6);
}
`;
// Light: on a dark page it is added to what is there (no alpha of its own); on paper it
// is laid over, in its own colour.
const LIGHT = /* glsl */ `
// (A power of something negative is garbage on some phones.)
float sq(float x) { return x * x; }
vec4 shine(vec3 col, float a) { return vec4(col * a, a * uLit); }
void add(inout vec4 acc, vec3 col, float s) { acc += vec4(col * s, s); }
vec4 laid(vec4 acc) {
  if (uLit < 0.5) return vec4(acc.rgb, 0.0);
  float s = clamp(acc.a, 0.0, 1.0);
  return vec4(acc.rgb / max(acc.a, 1e-3) * s, s);
}
// A lamp: white-hot at its heart, its colour round it, nothing at its edge.
void lamp(inout vec4 acc, float x, float s, vec3 rim) {
  if (x >= 1.0 || s <= 0.0) return;
  float f = x < 0.22 ? mix(1.0, 0.62, x / 0.22) : (x < 0.5 ? mix(0.62, 0.24, (x - 0.22) / 0.28) : mix(0.24, 0.0, (x - 0.5) / 0.5));
  add(acc, mix(uHot, rim, smoothstep(0.2, 0.5, x)), f * s);
}
`;
// The soft edge of a line `w` wide, `d` from its middle.
const LINE = /* glsl */ `
float lineCover(float d, float w) { return 1.0 - smoothstep(max(0.0, w * 0.5 - 0.4), w * 0.5 + 0.8, abs(d)); }
`;
const DUST = /* glsl */ `
attribute vec4 aA, aB, aC, aD;
uniform float uTau, uDepth, uHas;
uniform vec4 uHome;
// Where a grain is: thrown out, hanging, turning; then home by a spiral.
vec2 place(float tau, out float p, out float h) {
  float o = 1.0 - exp(-tau * aB.x);
  float ca = cos(tau * 0.1);
  float sa = sin(tau * 0.1);
  float X = (aA.x * ca - aA.z * sa) * aA.w * o;
  float Z = (aA.x * sa + aA.z * ca) * aA.w * o;
  float Y = aA.y * aA.w * o + sin(tau * 1.5 + aB.z) * 6.0 * o;
  p = clamp(1.0 / max(0.2, 1.0 - Z / uDepth), 0.45, 2.6);
  vec2 s = vec2(X, Y) * p;
  h = 0.0;
  if (aB.w * uHas > 0.5) {
    h = clamp((tau - aC.x) / aC.y, 0.0, 1.0);
    float m = h * h * (0.35 + 0.65 * h);
    float a = aC.w + tau;
    vec2 to = uHome.xy + vec2(cos(a), sin(a) * mix(0.26, 1.0, uHome.w)) * uHome.z * mix(0.9 * aD.x, 1.0, uHome.w);
    s = to + turned(s - to, m * aC.z) * (1.0 - m);
  }
  return s;
}
`;

const SHEET = `attribute vec2 aP;
varying vec2 vP;
void main() { vP = aP; gl_Position = vec4(aP, 0.0, 1.0); }`;

export const VS: Record<Kind, string> = {
  blit: `precision highp float;\n${SHEET}`,
  noise: `precision highp float;\n${SHEET}`,
  soft: `${VERT}
attribute vec2 aP;
varying vec2 vP;
void main() { vP = vec2(aP.x, -aP.y) * uHalf; gl_Position = vec4(aP, 0.0, 1.0); }`,
  core: `${VERT}
attribute vec2 aP;
uniform vec2 uBox;
varying vec2 vP;
void main() { vP = aP * uBox; gl_Position = at(vP); }`,
  home: `${VERT}
attribute vec2 aP;
uniform vec4 uHome;
varying vec2 vP;
void main() { vP = aP * max(64.0, uHome.z * 1.35); gl_Position = at(uHome.xy + vP); }`,
  motes: `${VERT}
attribute vec4 aA;
attribute vec2 aB;
uniform float uFar, uDrift, uTime, uMuch;
varying vec4 vC;
void main() {
  float r = 44.0 + mod(aA.y - 44.0 - aA.z * uDrift, uFar - 44.0);
  float th = aA.x + 1.15 * log(uFar / r);
  float a = smoothstep(44.0, 150.0, r) * (1.0 - smoothstep(0.78, 1.0, r / uFar));
  a *= (0.2 + 0.25 * (0.5 + 0.5 * sin(aB.x + 1.7 * uTime))) * (0.6 + 0.8 * uMuch);
  gl_Position = at(vec2(cos(th), sin(th)) * r);
  gl_PointSize = max(2.0, aA.w * 1.7 * uPx);
  vC = vec4(hue(aB.y), a);
}`,
  lanes: `${VERT}
attribute vec4 aA, aB;
attribute vec2 aC;
uniform float uQ;
varying vec4 vC;
varying vec2 vS;
void main() {
  float e = clamp((uQ - aA.w) / (1.0 - aA.w), 0.0, 1.0);
  float eb = max(0.0, e - 0.06);
  float k = e * e * e;
  float kb = eb * eb * eb;
  float ang = aA.x + aA.z * pow(k, 1.2);
  float angb = aA.x + aA.z * pow(kb, 1.2);
  vec2 head = vec2(cos(ang), sin(ang)) * aA.y * (1.0 - k);
  vec2 tail = vec2(cos(angb), sin(angb)) * aA.y * (1.0 - kb);
  vec2 d = normalize(head - tail + vec2(1e-4, 0.0));
  float hw = aB.x * 0.5 + 0.8;
  gl_Position = at(mix(tail, head, aC.x) + vec2(-d.y, d.x) * aC.y * hw);
  float on = e > 0.0 && e < 1.0 ? 1.0 : 0.0;
  vC = vec4(hue(aB.y), aB.z * smoothstep(0.0, 0.2, e) * on * mix(0.1, 1.0, aC.x));
  vS = vec2(aC.y * hw, aB.x);
}`,
  grains: `${VERT}
attribute vec4 aA, aB;
uniform float uQ, uTime;
varying vec4 vC;
void main() {
  float e = clamp((uQ - aA.z) / (0.97 - aA.z), 0.0, 1.0);
  vec2 p = aA.xy;
  if (e <= 0.0) {
    float k = 0.95 * smoothstep(0.0, 0.3, uQ);
    p += (vec2(fract(sin(dot(aA.xy, vec2(12.9898, 78.233)) + uTime * 43.7) * 4375.85), fract(sin(dot(aA.yx, vec2(39.3468, 11.135)) + uTime * 37.3) * 2463.46)) - 0.5) * k;
  } else {
    float f = pow(e, 2.5);
    p = turned(p, aA.w * pow(f, 1.25)) * (1.0 - f);
  }
  float heat = smoothstep(0.48, 0.76, e);
  vC = vec4(mix(aB.rgb, uHot, heat), aB.w * (e < 1.0 ? 1.0 : 0.0));
  gl_Position = at(p);
  gl_PointSize = max(1.0, (1.08 - 0.25 * e + 0.8 * heat * (1.0 - e)) * uPx);
}`,
  rays: `${VERT}${WAVE}
attribute vec4 aA, aB;
attribute vec2 aC;
uniform float uTau, uR, uFar, uRun;
varying vec4 vC;
varying vec2 vS;
void main() {
  float th = aA.y;
  float w = aB.y;
  float r0 = 0.0;
  float r1 = 0.0;
  float a = 0.0;
  vec3 col = hue(aB.z);
  if (aA.x < 0.5) {
    // A spike of light: broad at the heart, nothing at its end.
    th += uTau * 0.16;
    float L = uFar * (0.25 + 1.05 * (1.0 - exp(-uTau * 3.4)));
    r1 = L * aA.w;
    w = aA.z * 2.0 * (1.0 - aC.x);
    float x = aC.x * aA.w;
    a = smoothstep(0.0, 0.05, uTau) * exp(-uTau * 3.1) * (aC.x > 0.5 ? 0.02 : 0.62);
    col = mix(uHot, uGold, aC.x);
  } else if (aA.x < 1.5) {
    // A finger of fire, at the front.
    r0 = uR * aA.z * (1.0 + 0.04 * wave(th, uTau));
    r1 = r0 + uR * aA.w;
    a = 0.75 * uRun * (1.0 - 0.8 * aC.x);
  } else {
    // A streak, flying past you.
    float age = uTau - aA.z;
    float s = min(max(age, 0.0), 1.2);
    r1 = aA.w * (exp(s * aB.x) - 1.0);
    r0 = aA.w * (exp(max(0.0, s - 0.03 - 0.05 * age) * aB.x) - 1.0);
    w *= 0.5 + 1.7 * clamp(r1 / uFar, 0.0, 1.0);
    a = (age > 0.0 && r0 < uFar * 1.6 ? 1.0 : 0.0) * smoothstep(0.0, 0.08, age) * (1.0 - smoothstep(1.0, 1.6, uTau)) * (0.25 + 0.75 * smoothstep(20.0, uFar * 0.6, r1)) * mix(0.12, 1.0, aC.x);
    r1 = min(r1, uFar * 2.0);
  }
  vec2 d = vec2(cos(th), sin(th));
  float hw = w * 0.5 + 0.8;
  gl_Position = at(d * mix(r0, r1, aC.x) + vec2(-d.y, d.x) * aC.y * hw);
  vC = vec4(col, a);
  vS = vec2(aC.y * hw, w);
}`,
  shell: `${VERT}${WAVE}
attribute vec4 aA;
uniform float uTau, uR, uRun;
varying vec3 vS;
varying vec3 vC;
void main() {
  float a = aA.x;
  float k = uR * (1.0 - aA.z * 0.03 + 0.04 * wave(a, uTau) + 0.005 * sin(a * 41.0 + aA.z * 2.0));
  gl_Position = at(vec2(cos(a), sin(a)) * (k + aA.y * 10.0));
  float bright = smoothstep(-0.3, 0.6, sin(a * 2.0 + uBent.x * (1.0 + aA.z) + uTau) + 0.8 * sin(a * 5.0 - uBent.y - aA.z * 2.0));
  vS = vec3(aA.y * 10.0, bright, (aA.z < 0.5 ? 1.7 : 1.1) * (1.0 + 1.2 * exp(-uTau * 4.0)));
  vC = aA.z < 0.5 ? uHot : (aA.z < 1.5 ? uGold : uB2);
}`,
  dust: `${VERT}${DUST}
varying vec4 vC;
void main() {
  float p;
  float h;
  vec2 s = place(uTau, p, h);
  float a = smoothstep(0.0, 0.07, uTau) * (0.7 + 0.3 * sin(uTau * 8.0 + aB.z));
  float grow = 1.0;
  if (aB.w * uHas > 0.5) {
    float m = h * h * (0.35 + 0.65 * h);
    grow = 1.0 - 0.4 * m;
    a = mix(a, 1.0, smoothstep(0.0, 0.4, h)) * (1.0 - smoothstep(0.9, 1.0, h));
  } else a *= 1.0 - smoothstep(aD.y, aD.y + 0.9, uTau);
  gl_Position = at(s);
  gl_PointSize = a < 0.01 ? 0.0 : clamp(aB.y * p * grow * (1.0 + 1.1 * exp(-uTau * 3.6)) * uPx, 1.5, 60.0);
  vC = vec4(hue(aD.z), a);
}`,
  tails: `${VERT}${DUST}
attribute vec2 aE;
varying vec4 vC;
varying vec2 vS;
void main() {
  float p;
  float h;
  float pb;
  float hb;
  vec2 head = place(uTau, p, h);
  vec2 tail = place(max(0.0, uTau - (uTau < 0.5 ? 0.04 : 0.1)), pb, hb);
  float early = uTau < 0.5 ? (1.0 - uTau / 0.5) * 0.75 * smoothstep(0.0, 0.07, uTau) : 0.0;
  float late = smoothstep(0.1, 0.5, h) * (1.0 - smoothstep(0.92, 1.0, h)) * 0.6;
  float a = max(early, late);
  float w = aB.y * 0.16 * mix(1.0, p, step(uTau, 0.5));
  vec2 d = head - tail;
  float l = length(d);
  d = l > 0.01 ? d / l : vec2(1.0, 0.0);
  if (a < 0.01 || l < 0.8) { gl_Position = vec4(2.0, 2.0, 0.0, 1.0); vC = vec4(0.0); vS = vec2(0.0, 1.0); return; }
  float hw = w * 0.5 + 0.8;
  gl_Position = at(mix(tail, head, aE.x) + vec2(-d.y, d.x) * aE.y * hw);
  vC = vec4(hue(aD.z), a * mix(0.0, 1.0, aE.x));
  vS = vec2(aE.y * hw, w);
}`,
};

// The gas and the fire are cut from one sheet of cloud: four clouds in one picture, each
// smooth and without a seam, painted once (by the graphics) while the page loads. Worked
// out afresh at every point of every frame it was most of what the burst cost.
const CLOUD = /* glsl */ `
vec2 way(vec2 i, float per, float seed) {
  i = mod(i, per);
  float a = fract(sin(dot(i, vec2(127.1, 311.7)) + seed) * 43758.547) * 6.2831853;
  return vec2(cos(a), sin(a));
}
float grad(vec2 p, float per, float seed) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 s = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(way(i, per, seed), f);
  float b = dot(way(i + vec2(1.0, 0.0), per, seed), f - vec2(1.0, 0.0));
  float c = dot(way(i + vec2(0.0, 1.0), per, seed), f - vec2(0.0, 1.0));
  float d = dot(way(i + vec2(1.0, 1.0), per, seed), f - vec2(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}
float cloud(vec2 uv, float seed) {
  vec2 p = uv * 8.0;
  float v = 0.5 * grad(p, 8.0, seed);
  v += 0.3 * grad(p * 2.0, 16.0, seed + 11.3);
  v += 0.19 * grad(p * 4.0, 32.0, seed + 23.7);
  v += 0.12 * grad(p * 8.0, 64.0, seed + 37.1);
  return clamp(0.5 + v * 0.96, 0.0, 1.0);
}
`;
const FROM_CLOUD = /* glsl */ `
uniform sampler2D tCloud;
vec4 cloudAt(vec2 p) { return texture2D(tCloud, p * 0.125); }
`;
const POINT = (soft: string) => `${HEAD}${LIGHT}
varying vec4 vC;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  ${soft}
}`;
const STRIP = `${HEAD}${LIGHT}${LINE}
varying vec4 vC;
varying vec2 vS;
void main() { gl_FragColor = shine(vC.rgb, vC.a * lineCover(vS.x, vS.y)); }`;

export const FS: Record<Kind, string> = {
  blit: `precision mediump float;
uniform sampler2D tSoft;
varying vec2 vP;
void main() { gl_FragColor = texture2D(tSoft, vP * 0.5 + 0.5); }`,
  noise: `${HEAD}${CLOUD}
varying vec2 vP;
void main() {
  vec2 uv = vP * 0.5 + 0.5;
  gl_FragColor = vec4(cloud(uv, 0.0), cloud(uv, 57.0), cloud(uv, 113.0), cloud(uv, 171.0));
}`,
  soft: `${HEAD}${FROM_CLOUD}${WAVE}${LIGHT}
varying vec2 vP;
uniform float uTau, uR, uFar, uRun, uGas, uReach, uOpen;
uniform vec3 uBg, uFlash;
uniform vec4 uBlade;
void main() {
  vec4 acc = vec4(0.0);
  float r = length(vP);
  float a = atan(vP.y, vP.x);
  vec2 dir = vP / max(r, 1.0);
  float w = wave(a, uTau);
  float k = uR * (1.0 + 0.04 * w);
  float x = r / max(k, 1.0);
  // The dark, and the hole the front has burnt in it.
  float cover = uOpen > 0.5 ? 0.0 : pow(smoothstep(0.58, 1.0, x), 1.35);
  if (uRun > 0.01 && x > 0.42 && x < 1.3) {
    // The front: fire, uneven, with a bright lip, and cloud rolling in it.
    float n = cloudAt(dir * 2.2 + vec2(x * 1.6 - uTau * 0.9, uBent.x)).r;
    float n2 = cloudAt(dir * 4.4 - vec2(uTau * 1.3, x * 3.0 + uBent.y)).g;
    float e = 1.0 + 0.06 * (n - 0.5);
    float body = exp(-sq((x - 0.95 * e) / 0.055));
    float lip = exp(-sq((x - e) / 0.017));
    float ahead = exp(-sq((x - 1.06 * e) / 0.06));
    float inside = exp(-sq((x - 0.83) / 0.15));
    add(acc, uGold, uRun * body * (0.12 + 0.85 * n2));
    add(acc, uHot, uRun * lip * (0.1 + 1.25 * n * n2 * 1.6));
    add(acc, uB2, uRun * ahead * 0.4 * n2);
    add(acc, uA2, uRun * inside * 0.2 * n);
    vec2 q = vP / max(uR, 1.0) * 1.9 + uBent.xy;
    float c1 = cloudAt(q + uTau * 0.15).b;
    float c2 = cloudAt(q * 1.7 + c1 * 1.5 + 4.0).a;
    float dens = smoothstep(0.36, 0.78, c2) * smoothstep(0.5, 0.88, x) * (1.0 - smoothstep(0.98, 1.16, x));
    add(acc, mix(mix(uA, uGold, clamp(c1 * 1.8 - 0.4, 0.0, 1.0)), mix(uC, uB2, c1), smoothstep(0.46, 0.6, n)), uRun * 0.8 * dens);
  }
  if (uGas > 0.012) {
    // Gas, thrown out behind it, thinning as it goes.
    vec2 g = vP / uReach * vec2(uHalf.x > uHalf.y ? 0.82 : 1.2, uHalf.x > uHalf.y ? 1.15 : 0.86);
    float gr = length(g);
    if (gr < 1.5) {
      float g1 = cloudAt(g * 1.6 + uBent.yz).r;
      float g2 = cloudAt(g * 2.2 + g1 * 1.7 - uTau * 0.12).g;
      float vein = pow(max(0.0, 1.0 - abs(2.0 * cloudAt(g * 2.4 + g2 * 1.4).b - 1.0)), 7.0);
      float gd = (smoothstep(0.34, 0.84, g2) + 0.55 * vein) * (1.0 - smoothstep(0.3, 1.25, gr + (g1 - 0.5) * 0.7));
      vec3 gt = mix(mix(uC, uA2, smoothstep(0.34, 0.62, g1)), uB2, smoothstep(0.56, 0.74, g2) * 0.8);
      add(acc, gt, uGas * gd * 0.85);
    }
  }
  // The flash, over all of it, and its blade across the whole width.
  lamp(acc, r / uFlash.y, uFlash.x, uGold);
  if (uFlash.z > 0.004) {
    float f = r / uFar;
    add(acc, f < 0.35 ? mix(uHot, uGold, f / 0.35) : mix(uGold, uA, clamp((f - 0.35) / 0.65, 0.0, 1.0)), uFlash.z * mix(0.55, 0.2, smoothstep(0.0, 0.8, f)));
  }
  float bx = max(0.0, 1.0 - abs(vP.x) / uBlade.x);
  add(acc, mix(uGold, uHot, bx), uBlade.z * bx * exp(-sq(vP.y / uBlade.y)));
  add(acc, uA2, uBlade.w * bx * bx * exp(-sq(vP.y / 9.0)));
  vec4 base = vec4(uBg * cover, cover);
  if (uLit < 0.5) gl_FragColor = vec4(base.rgb + acc.rgb, base.a);
  else {
    float s = clamp(acc.a, 0.0, 1.0) * 0.92;
    gl_FragColor = vec4(acc.rgb / max(acc.a, 1e-3) * s + base.rgb * (1.0 - s), s + base.a * (1.0 - s));
  }
}`,
  core: `${HEAD}${LIGHT}
varying vec2 vP;
uniform float uGather, uShut, uQ, uBeat;
uniform vec2 uBlade;
void main() {
  vec4 acc = vec4(0.0);
  float r = length(vP);
  if (uBeat < 0.0) {
    lamp(acc, r / ((26.0 + 130.0 * uGather) * (1.0 - 0.86 * uShut)), 0.85 * uGather, uGold);
    lamp(acc, r / ((6.0 + 16.0 * uGather) * (1.0 - 0.6 * uShut)), uGather, uGold);
    if (r < 120.0) {
      // Rings of fire, turning: each brightest at its head.
      float c = cos(0.28);
      float s = sin(0.28);
      vec2 e = vec2(vP.x * c - vP.y * s, (vP.x * s + vP.y * c) / 0.34);
      float re = length(e);
      float ang = atan(e.y, e.x);
      float flat_ = 0.34 + 0.66 * abs(cos(ang));
      for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float rr = (30.0 + fi * 17.0) * (0.5 + 0.5 * uGather) * (1.0 - 0.94 * uShut);
        float from = uQ * (15.0 - fi * 2.2) + fi * 1.9;
        float len = 4.3 - fi * 0.5;
        float along = mod(ang - from, TAU);
        float seg = along < len ? smoothstep(0.0, len, along) : 0.0;
        float d = (re - rr) * flat_;
        add(acc, i == 0 ? uHot : (i == 1 ? uGold : (i == 2 ? uB2 : uC)), (0.95 - fi * 0.16) * uGather * seg * (exp(-d * d / 0.9) + 0.18 * exp(-d * d / 16.0)));
      }
    }
  } else {
    lamp(acc, r / (34.0 + 10.0 * uBeat), 0.55 + 0.2 * uBeat, uGold);
    lamp(acc, r / 8.0, 1.0, uGold);
  }
  if (uBlade.y > 0.004) {
    float bx = max(0.0, 1.0 - abs(vP.x) / max(1.0, uBlade.x));
    add(acc, mix(uGold, uHot, bx), uBlade.y * bx * exp(-vP.y * vP.y / 0.8));
  }
  gl_FragColor = laid(acc);
}`,
  home: `${HEAD}${LIGHT}
varying vec2 vP;
uniform float uTau, uCome;
uniform vec4 uHome;
void main() {
  vec4 acc = vec4(0.0);
  lamp(acc, length(vP) / max(60.0, uHome.z * 1.3), 0.42 * uCome, uGold);
  float k = mix(0.26, 1.0, uHome.w);
  vec2 e = vec2(vP.x, vP.y / k);
  float re = length(e);
  float ang = atan(e.y, e.x);
  float flat_ = k + (1.0 - k) * abs(cos(ang));
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float from = uTau * (5.5 - fi) + fi * 2.1;
    float along = mod(ang - from, TAU);
    float seg = along < 3.6 ? smoothstep(0.0, 3.6, along) : 0.0;
    float d = (re - uHome.z * mix(0.4 + fi * 0.32, 1.02 + fi * 0.05, uHome.w)) * flat_;
    add(acc, i == 0 ? uHot : (i == 1 ? uGold : uB2), 0.6 * uCome * seg * exp(-d * d / 1.1));
  }
  gl_FragColor = laid(acc);
}`,
  motes: POINT("gl_FragColor = shine(vC.rgb, vC.a * (1.0 - smoothstep(0.35, 1.0, d)));"),
  lanes: STRIP,
  grains: `${HEAD}
varying vec4 vC;
void main() { gl_FragColor = vec4(vC.rgb * vC.a, vC.a); }`,
  rays: STRIP,
  shell: `${HEAD}${LIGHT}
uniform float uRun;
varying vec3 vS;
varying vec3 vC;
void main() {
  float w = mix(0.7, vS.z, vS.y);
  float d = vS.x / w;
  gl_FragColor = shine(vC, uRun * (mix(0.16, 0.95, vS.y) * exp(-d * d) + 0.16 * vS.y * exp(-vS.x * vS.x / 22.0)));
}`,
  // A grain: white-hot at its heart (on paper its own colour: white is lost there).
  dust: POINT("gl_FragColor = shine(mix(vC.rgb, uHot, (1.0 - uLit) * (1.0 - smoothstep(0.0, 0.34, d))), vC.a * (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - 0.45 * d));"),
  tails: STRIP,
};

const R = Math.random;
const TAU = Math.PI * 2;
/** The two triangles of a strip: how far along it, and which side. */
const CORNERS = [
  [0, -1],
  [1, -1],
  [0, 1],
  [0, 1],
  [1, -1],
  [1, 1],
];

export const attributes = {
  /** The dust of the dark, drawing in. */
  motes(n: number, far: number): Float32Array {
    const out = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) out.set([R() * TAU, 60 + (far - 60) * Math.sqrt(R()), 9 + R() * 16, 0.8 + R() * 1.1, R() * TAU, i % 4], i * 6);
    return out;
  },
  /** …falling: from where it is now; and more of it, called in from outside. */
  lanes(motes: Float32Array, drift: number, far: number, called: number): Float32Array {
    const rows: number[][] = [];
    for (let i = 0; i < motes.length; i += 6) {
      const span = far - 44;
      const r = 44 + ((((motes[i + 1] - 44 - motes[i + 2] * drift) % span) + span) % span);
      rows.push([motes[i] + 1.15 * Math.log(far / r), r, 1.9, R() * 0.3, motes[i + 3], motes[i + 5], 0.85, 0]);
    }
    for (let i = 0; i < called; i++) rows.push([R() * TAU, far * (0.5 + R() * 0.75), 1.2 + R() * 1.2, 0.1 + R() * 0.42, 0.6 + R() * 1.0, i % 4, 0.62, 0]);
    const out = new Float32Array(rows.length * 60);
    rows.forEach((row, i) => CORNERS.forEach((c, j) => out.set([...row, ...c], i * 60 + j * 10)));
    return out;
  },
  /** Spikes out of the heart, fingers at the front, streaks flying past. */
  rays(beams: number, fingers: number, streaks: number): Float32Array {
    const rows: number[][] = [];
    for (let i = 0; i < beams; i++) rows.push([0, R() * TAU, 1 + R() * 4.5, 0.3 + 0.7 * Math.pow(R(), 1.4), 0, 0, 0, 0]);
    for (let i = 0; i < fingers; i++) rows.push([1, R() * TAU, 0.87 + R() * 0.12, 0.015 + 0.16 * Math.pow(R(), 2.4), 0, 0.5 + R() * 1.1, i % 5, 0]);
    for (let i = 0; i < streaks; i++) rows.push([2, R() * TAU, R() * 0.46, 14 + R() * 60, 4.4 + R() * 2.6, 0.6 + R() * 1.4, i % 5, 0]);
    const out = new Float32Array(rows.length * 60);
    rows.forEach((row, i) => CORNERS.forEach((c, j) => out.set([...row, ...c], i * 60 + j * 10)));
    return out;
  },
  /** The front's bright edge: a ribbon round it, as many as there are. */
  shell(seg: number, n: number): Float32Array {
    const out = new Float32Array(n * seg * 6 * 4);
    let o = 0;
    for (let s = 0; s < n; s++) {
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * TAU;
        const b = ((i + 1) / seg) * TAU;
        for (const [x, side] of [
          [a, -1],
          [b, -1],
          [a, 1],
          [a, 1],
          [b, -1],
          [b, 1],
        ]) {
          out.set([x, side, s, 0], o);
          o += 4;
        }
      }
    }
    return out;
  },
  /** The dust of the burst, `far` it flies: each grain once as a point, once with a tail. */
  dust(n: number, far: number, wide: boolean): { points: Float32Array; tails: Float32Array } {
    const points = new Float32Array(n * 16);
    const tails = new Float32Array(n * 6 * 18);
    for (let i = 0; i < n; i++) {
      const a = R() * TAU;
      const z = R() * 2 - 1;
      const q = Math.sqrt(1 - z * z);
      const row = [
        ...[Math.cos(a) * q * (wide ? 1.25 : 0.8), z * (wide ? 0.7 : 1.15), Math.sin(a) * q, far * (0.12 + 0.88 * Math.pow(R(), 0.6))],
        ...[2.1 + R() * 2.6, 2.4 + 6.4 * Math.pow(R(), 1.5), R() * 40, R() < 0.8 ? 1 : 0],
        ...[0.8 + R() * 0.85, 1.1 + R() * 0.65, 2.1 + R() * 1.8, R() * TAU],
        ...[0.12 + 0.88 * Math.sqrt(R()), 1.2 + R() * 1.2, i % 4, 0],
      ];
      points.set(row, i * 16);
      CORNERS.forEach((c, j) => tails.set([...row, ...c], (i * 6 + j) * 18));
    }
    return { points, tails };
  },
};
