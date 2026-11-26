// KAL's stone (docs/temple/ART.md 1.9): one canvas, and it rides with the page.
//
// It lies inside the page (not fixed over it), a little taller than the screen; when the scroll
// has moved it is put where the screen is and drawn for there. Between two drawings the browser
// itself carries it along with the words, so stone and words can never slide against each other.
//
// What is drawn are PIECES of carving (dev/art/bake_kal.py: slopes, openness, wear, height, what
// it is made of), each laid on the page at its place. A piece is lit as relief: by the light one
// carries, with the carving's own shadow marched across it; by rows of small lamps; by the moon
// and the dusk. Polished black granite takes words: it stays dark whatever the light does.
//
// Raw WebGL 2: no library to wait for.

import { compileAll, type Linked } from "./gl";

/** A piece's size (its own px), its pictures' px for one of those, how low and high it goes; `tile`: it
 *  repeats (that way); `nine`: a frame, with corners so large, its sides repeating between them. */
export type PieceMap = { w: number; h: number; k: number; lo: number; hi: number; tile?: string; nine?: number };
export type Piece = { map: PieceMap; n: WebGLTexture; h: WebGLTexture; m: WebGLTexture };
/** A piece on the page: where (page px), how large a px of it is there, how deep it lies; `rings`: it
 *  turns in rings (their outer radii, shares of its half; and how far each has turned). */
export type Laid = {
  piece: Piece;
  x: number;
  y: number;
  s: number;
  /** How large it is there, if it repeats (page px). */
  w?: number;
  h?: number;
  z?: number;
  rings?: { r: [number, number, number]; a: [number, number, number] };
  /** Whole turn (radians): a piece hung, or set going. */
  turn?: number;
  /** Turned round, left for right. */
  flip?: boolean;
  /** All of it metal (0–1). */
  gild?: number;
  /** What is told as metal is not, but a colour laid on (rice flour, a petal); or it is light. */
  matte?: number;
  emit?: [number, number, number];
  /** Raw rock over what is carved, letting go (docs/temple/ART.md 1.9.5): since when (s), from where
   *  (page px); and the outlines of what is inside it (x, y, w, h; a negative w: words, never covered). */
  raw?: { at: number; x: number; y: number; outlines: Float32Array };
  /** A chain: where its first link's middle is, from one to the next (its own px), and what each is made
   *  of (colour and how much of it is metal; less than 0: as far as it has been cut; −1: not there). */
  chain?: { x0: number; pitch: number; links: Float32Array; hot: { i: number; v: number } };
  /** What its metal is (gold, where not told). */
  metal?: [number, number, number];
};
/** Cut letters: a picture of distances, laid on the page. `wake`: how awake its gold is; `pour`: how
 *  far (px, page) molten gold has run, from where. */
export type Cut = { tex: WebGLTexture; x: number; y: number; w: number; h: number; spread: number; wake: number; pour: number; from: number };
/** A row of lamps: the first one's middle, the step, how many (page px). */
export type Row = { x: number; y: number; step: number; n: number; lit: Float32Array; size: number };

const PIECE_V = /* glsl */ `#version 300 es
in vec2 q;
uniform vec4 uBox, uSub;
uniform vec2 uCam, uView, uQuad, uPivot;
uniform float uZ, uWhole;
uniform vec2 uEye;
out vec2 vP;
out vec2 vPage;
void main() {
  vec2 e = uSub.xy + q * uSub.zw;
  vP = e * uQuad;
  vPage = uBox.xy + e * uBox.zw;
  if (uWhole != 0.0) {
    vec2 o = vPage - uPivot;
    vPage = uPivot + vec2(cos(uWhole) * o.x - sin(uWhole) * o.y, sin(uWhole) * o.x + cos(uWhole) * o.y);
  }
  vec2 p = vPage + uEye * uZ / 1100.0 - uCam;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;

const LIGHT = /* glsl */ `
precision highp float;
#define sq2(x) ((x) * (x))
uniform vec4 uTorch;
uniform vec3 uTorchC, uAmb, uMoon, uLampC;
uniform vec4 uRow[2];
uniform vec2 uBase;
uniform float uLit[64];
uniform float uT, uLight;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
// A light at L (page px, towards you): how much of it falls here (x), and its gleam (y).
vec2 from(vec3 P, vec3 N, vec3 L, float soft, float shin) {
  vec3 d = (L - P) / 140.0;
  float r2 = dot(d, d);
  vec3 l = d / sqrt(max(r2, 1e-4));
  float fall = 1.0 / (soft + r2) - 0.043;
  if (fall <= 0.0) return vec2(0.0);
  float lam = max(0.0, dot(N, l));
  vec3 hv = normalize(l + vec3(0.0, 0.0, 1.0));
  return vec2(lam * fall, pow(max(0.0, dot(N, hv)), shin) * fall * step(0.001, lam));
}
// The lamps: of a row the two nearest.
vec2 row(vec4 R, float base, vec3 P, vec3 N, float shin) {
  float f = (P.x - R.x) / R.z;
  float i0 = clamp(floor(f), 0.0, R.w - 1.0);
  float i1 = clamp(i0 + 1.0, 0.0, R.w - 1.0);
  vec2 a = vec2(0.0);
  float l0 = uLit[int(base + i0 + 0.5)], l1 = uLit[int(base + i1 + 0.5)];
  if (l0 > 0.003) a += l0 * from(P, N, vec3(R.x + i0 * R.z, R.y - 9.0, 66.0), 0.22, shin);
  if (i1 != i0 && l1 > 0.003) a += l1 * from(P, N, vec3(R.x + i1 * R.z, R.y - 9.0, 66.0), 0.22, shin);
  return a;
}
vec2 lamps(vec3 P, vec3 N, float shin) {
  vec2 a = vec2(0.0);
  if (uRow[0].w > 0.5) a += row(uRow[0], uBase.x, P, N, shin);
  if (uRow[1].w > 0.5) a += row(uRow[1], uBase.y, P, N, shin);
  return a;
}
vec3 developed(vec3 c) {
  c *= 1.0;
  c = (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
  return pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2)) + (hash(gl_FragCoord.xy + fract(uT) * 61.0) - 0.5) * 0.012;
}`;

const PIECE_F = /* glsl */ `#version 300 es
${LIGHT}
in vec2 vP;
in vec2 vPage;
uniform sampler2D tN, tH, tM, tStone, tNoise;
uniform vec2 uSize, uEye, uQuad;
uniform vec2 uHR;
uniform vec4 uBox;
uniform vec3 uMetal;
uniform float uS, uZ, uWet, uMode, uBorder, uWhole, uFlip, uGild;
uniform vec4 uChain, uLinks[12];
uniform vec3 uEmit;
uniform float uMatte;
uniform vec4 uRaw, uOut[16];
// Raw rock: its cells (as a mason breaks it), the distance to a cell's edge, its own number.
vec3 cells(vec2 p) {
  vec2 g = floor(p), f = fract(p);
  float d1 = 9.0, d2 = 9.0;
  vec2 best = vec2(0.0);
  for (int j = -1; j <= 1; j++)
    for (int i = -1; i <= 1; i++) {
      vec2 o = vec2(float(i), float(j));
      vec2 c = o + 0.15 + 0.7 * vec2(hash(g + o), hash(g + o + 17.3));
      float d = length(c - f);
      if (d < d1) { d2 = d1; d1 = d; best = g + o; } else if (d < d2) d2 = d;
    }
  return vec3(d2 - d1, hash(best + 3.1), hash(best * 1.7 + 9.2));
}
uniform vec4 uRings;
uniform vec3 uTurn;
out vec4 o;
// Where in the piece: itself; a frame's corner, or its side over and over; or it repeats.
vec2 inPiece(vec2 p) {
  if (uMode < 0.5) return p;
  vec2 I = uSize - 2.0 * uBorder, Q = uQuad - 2.0 * uBorder;
  vec2 n = max(vec2(1.0), floor(Q / I + 0.5));
  vec2 mid = uBorder + fract(clamp((p - uBorder) / Q, 0.0, 0.9999) * n) * I;
  return mix(mix(p, mid, step(vec2(uBorder), p)), p - uQuad + uSize, step(uQuad - uBorder, p));
}
float high(vec2 p) { return uHR.x + uHR.y * textureLod(tH, inPiece(p) / uSize, 0.0).r; }
void main() {
  vec2 p = vP;
  if (uFlip > 0.5) p.x = uQuad.x - p.x;
  // (A wheel, turned in rings: each is looked up where it was, and its slopes turned with it.)
  float turn = 0.0;
  if (uRings.w > 0.5) {
    vec2 d = p - uSize * 0.5;
    float rr = length(d) / (uSize.x * 0.5);
    turn = rr < uRings.x ? uTurn.x : rr < uRings.y ? uTurn.y : uTurn.z;
    float c = cos(turn), s = sin(turn);
    p = uSize * 0.5 + vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  } else {
    // What stands out of the wall is seen where it stands.
    p -= uEye * vec2(1.0 - 2.0 * uFlip, 1.0) * high(p) / 1100.0;
  }
  // Raw rock: what is cut out of it is under it. It lets go cell by cell from where it was struck,
  // each cell's edges darkening a moment before; never over words; the masons' red lines on it.
  float red = 0.0, last = 0.0;
  if (uRaw.w > 0.5) {
    vec3 cl = cells(vPage / 58.0);
    vec2 cc = floor(vPage / 58.0) * 58.0 + 29.0;
    float when = 0.55 * clamp(length(cc - uRaw.yz) / 900.0, 0.0, 1.0) + 0.3 * cl.y + 0.15 * cl.z;
    float age = uRaw.x - when * 1.15;
    if (age > 0.0) discard;
    last = smoothstep(-0.16, 0.0, age);
    for (int i = 0; i < 16; i++) {
      vec4 r = uOut[i];
      if (r.z == 0.0) continue;
      vec2 a = vec2(r.x, r.y), b = vec2(r.x + abs(r.z), r.y + r.w);
      vec2 dd = max(a - vPage, vPage - b);
      float sd = max(dd.x, dd.y);
      if (r.z < 0.0 && sd < 10.0) discard;
      red = max(red, smoothstep(1.4, 0.4, abs(sd + 1.0)) * (0.55 + 0.45 * hash(floor(vPage * 0.4))));
    }
  }
  vec2 uv = inPiece(p) / uSize;
  vec2 gx = dFdx(vP) / uSize, gy = dFdy(vP) / uSize;
  vec3 m = textureGrad(tM, uv, gx, gy).rgb;
  float alpha = smoothstep(0.42, 0.58, m.b);
  if (alpha < 0.004) discard;
  vec4 re = textureGrad(tN, uv, gx, gy);
  float h = high(p);
  vec2 rn = re.rg * 2.0 - 1.0;
  float ao = re.b;
  float worn = (re.a - 0.502) * 2.0;
  float gold = max(m.r * smoothstep(0.35, 0.65, m.r), uGild);
  vec4 link = vec4(0.0);
  float hot = 0.0;
  float fresh = 0.0;
  if (uChain.y > 0.0) {
    // (Every other link is marked: so each is told from the one it goes through.)
    float odd = step(0.5, m.r);
    float i = clamp(odd + 2.0 * floor(((vP.x - uChain.x) / uChain.y - odd) * 0.5 + 0.5), 0.0, 11.0);
    link = uLinks[int(i + 0.5)];
    float along = (vP.x - uChain.x - i * uChain.y) / uChain.y / 1.3 + 0.5;
    if (link.a < -0.5 || (link.a < 0.0 && along > link.r)) discard;
    gold = max(link.a, 0.0);
    fresh = link.a < 0.0 ? exp(-max(link.r - along, 0.0) * 14.0) : 0.0;
    hot = abs(i - uChain.z) < 0.5 ? uChain.w : 0.0;
  }
  float pol = smoothstep(0.4, 0.6, m.g);
  // (The grain, and the weather, go on from one piece to the next.)
  vec2 gp = uRings.w > 0.5 || uWhole != 0.0 ? p : p + uBox.xy / uS;
  vec2 suv = gp / 330.0 + vec2(0.13, 0.31);
  vec4 gr = texture(tStone, suv);
  vec2 sn = (gr.rg * 2.0 - 1.0) * 1.6;
  vec3 alb = gr.b * gr.b * mix(vec3(0.86, 0.79, 0.68), vec3(1.0, 0.76, 0.54), gr.a);
  float flatN = 1.0 - smoothstep(0.02, 0.3, length(rn));
  vec3 N = normalize(vec3(rn + sn * vec2(1.0, -1.0) * mix(0.16, 0.34, flatN) * (1.0 - pol) * (1.0 - 0.7 * gold), sqrt(max(0.05, 1.0 - dot(rn, rn)))));
  N.x *= 1.0 - 2.0 * uFlip;
  if (turn != 0.0) { float c = cos(turn), s = sin(turn); N.xy = vec2(c * N.x - s * N.y, s * N.x + c * N.y); }
  if (uWhole != 0.0) { float c = cos(uWhole), s = sin(uWhole); N.xy = vec2(c * N.x - s * N.y, s * N.x + c * N.y); }
  // (Slopes are told with y down the page.)
  vec3 P = vec3(vPage, uZ + h * uS);
  // Time: edges rubbed pale, hollows dark; dust where it can lie; soot; a little moss low down.
  alb *= 1.0 + 0.7 * max(worn, 0.0);
  alb *= 1.0 - 0.55 * max(-worn, 0.0);
  vec4 ns = texture(tNoise, gp * 0.0026 + 0.11);
  float n1 = ns.r, n2 = ns.g;
  alb *= 0.72 + 0.5 * n1 * n2 + 0.12 * n2;
  alb = mix(alb, vec3(0.17, 0.145, 0.11), 0.3 * smoothstep(0.2, 0.8, -N.y) * (0.4 + 0.6 * n2));
  float run = texture(tNoise, vec2(gp.x * 0.0031, gp.y * 0.00027 + 0.4)).b;
  alb *= 1.0 - 0.3 * smoothstep(0.45, 0.8, run);
  // The light one carries, and the carving's own shadow in it.
  float shin = mix(16.0 + 8.0 * max(worn, 0.0), 46.0, gold);
  shin = mix(shin, 90.0, pol);
  vec2 t = uTorch.w > 0.0 ? from(P, N, uTorch.xyz, 0.32, shin) * uTorch.w : vec2(0.0);
  float sh = 1.0;
  if (t.x > 0.025 && pol < 0.5) {
    vec2 to = uTorch.xy - P.xy;
    float ll = length(to);
    vec2 dir = to / max(ll, 1.0);
    dir.x *= 1.0 - 2.0 * uFlip;
    float all_ = turn + uWhole;
    if (all_ != 0.0) { float c = cos(all_), s = sin(all_); dir = vec2(c * dir.x + s * dir.y, -s * dir.x + c * dir.y); }
    float rise = (uTorch.z - P.z) / max(ll, 1.0);
    float far = min(ll, 64.0 / max(rise, 0.12)) / uS;
    far = min(far, 120.0);
    float occ = 0.0;
    float j = hash(gl_FragCoord.xy);
    for (int i = 0; i < MARCH; i++) {
      float s = far * (float(i) + 0.6 + 0.5 * (j - 0.5)) / float(MARCH);
      float over = high(p + dir * s) - (h + s * rise);
      occ = max(occ, over / (1.6 + s * 0.1));
    }
    sh = 1.0 - smoothstep(0.1, 1.0, occ) * 0.92;
  }
  vec2 l = lamps(P, N, shin);
  // (Lamplight comes from above the eave: what is under it lies in its shade.)
  float moon = max(0.0, dot(N, vec3(0.45, -0.65, 0.62)));
  vec3 dif = uTorchC * t.x * sh + uLampC * l.x * 0.34 + uMoon * moon;
  vec3 spe = uTorchC * t.y * sh + uLampC * l.y * 0.34;
  vec3 ga = uChain.y > 0.0 ? link.rgb : uMetal;
  vec3 body = mix(alb, ga * mix(0.34, 0.6, uMatte), gold);
  vec3 col = body * (dif + uAmb * (0.62 + 0.38 * N.z)) * mix(1.0, ao * mix(1.0, ao, 0.5), 1.0);
  col += (mix(vec3(0.022 + 0.02 * max(worn, 0.0)), ga * 1.5 * (1.0 - 0.94 * uMatte), gold)) * spe * ao;
  col += ga * gold * 0.05 * ao;
  col += uEmit * gold * (0.7 + 0.3 * n1) * (0.9 + 0.1 * sin(uT * 3.1 + vPage.x * 0.02) * sin(uT * 1.7));
  // (The one that is pointed at; and stone as it is just cut.)
  col += body * hot * 0.5 * (0.4 + 0.6 * N.z) * ao + vec3(0.3, 0.27, 0.23) * fresh * 0.12 * ao;
  // Polished black granite: words stand on it. Its flecks; a soft streak of the light; never bright.
  vec3 black = vec3(0.0058, 0.005, 0.0046) + vec3(0.012) * smoothstep(0.985, 1.0, hash(floor(p * 1.6)));
  black += (vec3(0.3, 0.2, 0.12) * t.x * 0.012 + uLampC * l.x * 0.004 + uMoon * 0.02);
  black += uTorchC * t.y * 0.012;
  black = min(black, vec3(0.026, 0.024, 0.022));
  col = mix(col, black * (0.7 + 0.3 * ao), pol);
  if (uRaw.w > 0.5) {
    col = mix(col, vec3(0.42, 0.075, 0.03) * (0.25 + 0.75 * (dif.r + uAmb.r * 4.0)), red * 0.8);
    col *= 1.0 - 0.75 * last;
  }
  o = vec4(developed(col) * alpha, alpha);
}`;

const CUT_F = /* glsl */ `#version 300 es
${LIGHT}
in vec2 vP;
in vec2 vPage;
uniform sampler2D tSdf;
uniform vec2 uSize;
uniform float uSpread, uWake, uPour, uFrom, uPx;
out vec4 o;
void main() {
  vec2 uv = vP / uSize;
  float d = (texture(tSdf, uv).r - 0.5) * 2.0 * uSpread;
  vec2 px = 1.0 / vec2(textureSize(tSdf, 0));
  vec2 g = vec2(texture(tSdf, uv + vec2(px.x, 0.0)).r - texture(tSdf, uv - vec2(px.x, 0.0)).r, texture(tSdf, uv + vec2(0.0, px.y)).r - texture(tSdf, uv - vec2(0.0, px.y)).r);
  g /= max(length(g), 1e-4);
  // FILLED, whole letters of gold; the bevel and the rim only add to it (§107.5).
  float fill = smoothstep(-0.5, 0.5, d * uPx);
  float contact = smoothstep(-3.4, -0.2, d) * (1.0 - fill);
  float wall = exp(-sq2((d - 0.9) / 1.3));
  vec3 N = normalize(vec3(g * wall * 1.5, 1.0));
  vec3 P = vec3(vPage, -1.0);
  vec2 t = uTorch.w > 0.0 ? from(P, N, uTorch.xyz, 0.32, 40.0) * uTorch.w : vec2(0.0);
  vec2 l = lamps(P, N, 40.0);
  float leaf = vnoise(vPage * 0.35) * 0.6 + vnoise(vPage * 1.3) * 0.4;
  vec3 gold = mix(vec3(0.385, 0.21, 0.045), vec3(0.72, 0.42, 0.1), uWake) * (0.86 + 0.28 * leaf);
  float lit = dot(g, normalize(vec2(-0.45, -0.75)));
  vec3 col = gold * (0.62 + 0.4 * smoothstep(-0.2, 1.0, lit * wall) - 0.42 * smoothstep(0.1, 1.0, -lit * wall));
  col += vec3(1.0, 0.66, 0.26) * (t.x * 0.16 + t.y * 0.5 + l.x * 0.05 + l.y * 0.16) * (0.5 + 0.5 * uWake);
  // Poured, and not yet set: white-hot at its front, orange behind.
  float run = uPour - (vPage.x - uFrom);
  float poured = smoothstep(0.0, 14.0, run + 6.0 * (vnoise(vPage * 0.2) - 0.5));
  float hot = exp(-max(run, 0.0) / 110.0) * step(0.0, uPour) * step(uPour, 9000.0);
  col = mix(col, mix(vec3(1.0, 0.28, 0.03), vec3(1.3, 1.0, 0.7), exp(-max(run, 0.0) / 26.0)) * 1.3, hot * poured);
  // (Before the gold: the bare cut.)
  vec3 bare = vec3(0.03, 0.022, 0.016) * (0.7 + 0.8 * smoothstep(-0.2, 1.0, lit * wall));
  col = mix(bare, col, poured);
  float a = max(fill, contact * 0.75);
  col = mix(vec3(0.002), col, fill);
  o = vec4(developed(col) * a, a);
}`;

const FLAME_V = /* glsl */ `#version 300 es
in vec2 q;
in vec4 a0;
uniform vec2 uCam, uView, uEye;
uniform float uSize;
out vec2 vQ;
out float vLit, vSeed;
void main() {
  vQ = (q - vec2(0.5, 1.0)) * vec2(2.0, 1.0);
  vLit = a0.z;
  vSeed = a0.w;
  vec2 p = a0.xy + (q - vec2(0.5, 0.86)) * vec2(1.0, 1.5) * uSize + uEye * 60.0 / 1100.0 - uCam;
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
}`;
const FLAME_F = /* glsl */ `#version 300 es
precision highp float;
in vec2 vQ;
in float vLit, vSeed;
uniform float uT;
out vec4 o;
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
void main() {
  // vQ: x −1…1, y 0 (foot) … −1 (top).
  float y = -vQ.y;
  // The clay bowl.
  float by = (y - 0.12) / 0.1;
  float bw = 0.44 * sqrt(max(0.0, 1.0 - (by < 0.0 ? by * by : 0.0)));
  float bowl = step(abs(vQ.x), bw * (by < 1.0 ? 1.0 : 0.0)) * step(0.02, y) * step(y, 0.2);
  vec3 clay = vec3(0.2, 0.085, 0.04) * (0.5 + 0.8 * max(0.0, 1.0 - abs(vQ.x + 0.1) * 2.0)) * (0.4 + 0.8 * y * 5.0);
  clay += vec3(0.9, 0.4, 0.12) * vLit * smoothstep(0.1, 0.2, y) * 0.35;
  // The flame.
  float f = (y - 0.2) / 0.62;
  float sway = (vnoise(vec2(uT * 1.7 + vSeed * 9.0, f * 1.4)) - 0.5) * 0.28 * f + (vnoise(vec2(uT * 3.1 + vSeed * 31.0, 4.0)) - 0.5) * 0.14 * f * f;
  float w = 0.24 * sin(3.14159 * pow(clamp(f, 0.0, 1.0), 0.62)) * (1.0 - 0.25 * f);
  float d = abs(vQ.x - sway) / max(w, 1e-3);
  float body = smoothstep(1.0, 0.35, d) * step(0.0, f) * step(f, 1.0) * smoothstep(0.0, 0.35, vLit);
  vec3 c = mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.82, 0.5), smoothstep(1.0, 0.25, d));
  c = mix(c, vec3(0.16, 0.22, 0.9), smoothstep(0.2, 0.0, f) * 0.5);
  float glow = exp(-dot(vec2(vQ.x * 1.2, (y - 0.48) * 1.25), vec2(vQ.x * 1.2, (y - 0.48) * 1.25)) * 7.0) * 0.4 * vLit;
  vec3 col = clay * bowl + c * body * 1.1 * vLit + vec3(1.0, 0.5, 0.16) * glow;
  o = vec4(col, max(bowl, body * 0.9 * vLit));
}`;

const COMBINE_V = /* glsl */ `#version 300 es
in vec2 q; out vec2 u; void main() { u = q; gl_Position = vec4(q * 2.0 - 1.0, 0.0, 1.0); }`;
const COMBINE_F = /* glsl */ `#version 300 es
precision highp float;
in vec2 u; out vec4 o;
uniform sampler2D tX, tY, tC;
float g(float v) { float t = v * 2.0 - 1.0; return sign(t) * t * t * 4.0; }
void main() {
  vec3 n = normalize(vec3(-g(texture(tX, u).r), -g(texture(tY, u).r), 1.0));
  float y = clamp(u.y, 0.001, 0.999) * 0.5;
  o = vec4(n.xy * 0.5 + 0.5, texture(tC, vec2(u.x, y)).r, texture(tC, vec2(u.x, 0.5 + y)).r);
}`;

// The grain of the rock, in one picture: its slopes (two sizes of them), how light it is, how warm.
const GRAIN_F = /* glsl */ `#version 300 es
precision highp float;
in vec2 u; out vec4 o;
uniform sampler2D tD, tN;
void main() {
  vec3 c = texture(tD, u).rgb;
  vec2 n = texture(tN, u).xy * 2.0 - 1.0 + (texture(tN, u * 4.0 + 0.37).xy * 2.0 - 1.0) * 0.55;
  o = vec4(n / 1.6 * 0.5 + 0.5, dot(c, vec3(0.36, 0.5, 0.14)), clamp((c.r - c.b) / max(c.r, 0.02) * 1.6, 0.0, 1.0));
}`;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function bitmap(url: string): Promise<ImageBitmap> {
  for (let n = 0; ; n++) {
    try {
      const r = await fetch(url, n ? { cache: "reload" } : undefined);
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await createImageBitmap(await r.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    } catch (e) {
      if (n >= 3) throw e;
      await wait(400 * 2 ** n);
    }
  }
}

/** A unit of light (px); how many of them a light reaches; a tile (px). */
const LU = 140;
const REACH = 4.8;
const TILE = 200;
const NOROWS = new Float32Array(8);
const GOLD: [number, number, number] = [0.86, 0.56, 0.16];

export class Stone {
  gl: WebGL2RenderingContext;
  laid: Laid[] = [];
  front: Laid[] = [];
  cuts: Cut[] = [];
  rows: Row[] = [];
  /** The light one carries: page px, how high over the wall, how strong. */
  torch = { x: 0, y: 0, z: 150, on: 0 };
  colors = { torch: [2.2, 1.29, 0.6], amb: [0.058, 0.064, 0.092], moon: [0.1, 0.118, 0.152], lamp: [1.15, 0.64, 0.25] };
  eye: [number, number] = [0, 0];
  /** The window, on the page. */
  view = { y: 0, w: 0, h: 0 };
  ready = false;
  private litNow = new Float32Array(64);
  /** The clock of the frame being drawn. */
  time = 0;
  private torchNow = 0;
  private piece!: Linked;
  private cut!: Linked;
  private flame!: Linked;
  private combine!: Linked;
  private grain!: Linked;
  private quad: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private fvao: WebGLVertexArrayObject;
  private fbuf: WebGLBuffer;
  private stoneT!: WebGLTexture;
  private noiseT!: WebGLTexture;
  private trash: WebGLTexture[] = [];

  constructor(
    public canvas: HTMLCanvasElement,
    private phone: boolean,
  ) {
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: "high-performance" });
    if (!gl) throw new Error("kal: no webgl2");
    this.gl = gl;
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fvao = gl.createVertexArray()!;
    gl.bindVertexArray(this.fvao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fbuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fbuf);
    gl.bufferData(gl.ARRAY_BUFFER, 64 * 16, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
  }

  async boot() {
    const gl = this.gl;
    const M = `#define MARCH ${this.phone ? 5 : 6}\n`;
    const frag = (s: string) => s.replace("#version 300 es\n", `#version 300 es\n${M}`);
    [this.piece, this.cut, this.flame, this.combine, this.grain] = await compileAll(gl, [
      [PIECE_V, frag(PIECE_F)],
      [PIECE_V, frag(CUT_F)],
      [FLAME_V, FLAME_F],
      [COMBINE_V, COMBINE_F],
      [COMBINE_V, GRAIN_F],
    ]);
    const [a, b] = await Promise.all([bitmap("/dev/award/stone_diff.webp"), bitmap("/dev/award/stone_nor.webp")]);
    const d = this.tile(a);
    const n = this.tile(b);
    this.stoneT = this.plain(null, "rgb", 1024, 1024, true);
    this.into(this.grain, this.stoneT, 1024, 1024, [
      ["tD", d],
      ["tN", n],
    ]);
    gl.bindTexture(gl.TEXTURE_2D, this.stoneT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.trash.push(this.stoneT);
    gl.deleteTexture(d);
    gl.deleteTexture(n);
    this.noiseT = this.noise();
    this.ready = true;
  }

  /** Weather, as a picture: wide patches, small ones, and what rain has run down. */
  private noise(): WebGLTexture {
    const n = 256;
    const data = new Uint8Array(n * n * 4);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const field = (c: number, d = c) => {
      const g = Float32Array.from({ length: c * d }, rnd);
      return (x: number, y: number) => {
        const fx = (x / n) * c;
        const fy = (y / n) * d;
        const i = Math.floor(fx);
        const j = Math.floor(fy);
        let u = fx - i;
        let v = fy - j;
        u = u * u * (3 - 2 * u);
        v = v * v * (3 - 2 * v);
        const at = (a: number, b: number) => g[(a % c) + (b % d) * c];
        return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
      };
    };
    const a = field(8);
    const b = field(27);
    const c1 = field(19);
    const c2 = field(45);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const o = (y * n + x) * 4;
        data[o] = a(x, y) * 255;
        data[o + 1] = b(x, y) * 255;
        data[o + 2] = (0.6 * c1(x, y) + 0.4 * c2(x, y)) * 255;
        data[o + 3] = 255;
      }
    const gl = this.gl;
    const t = gl.createTexture()!;
    this.trash.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return t;
  }

  private tile(b: ImageBitmap): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, b);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    b.close();
    return t;
  }
  private plain(b: ImageBitmap | null, fmt: "r" | "rgb", w = 0, h = 0, mips = false): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    if (b) gl.texImage2D(gl.TEXTURE_2D, 0, fmt === "r" ? gl.R8 : gl.RGB8, fmt === "r" ? gl.RED : gl.RGB, gl.UNSIGNED_BYTE, b);
    else gl.texStorage2D(gl.TEXTURE_2D, mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    b?.close();
    return t;
  }

  /** A picture made of others, once. */
  private into(L: Linked, to: WebGLTexture, w: number, h: number, from: [string, WebGLTexture][]) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, to, 0);
    gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND);
    gl.useProgram(L.p);
    from.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(L.u(name), i);
    });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fbo);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, to);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }

  /** A piece of carving, its pictures loaded and put together. */
  async load(name: string, map: PieceMap, base = "/dev/kal"): Promise<Piece> {
    const gl = this.gl;
    const [x, y, c, h, m] = await Promise.all(["x", "y", "c", "h", "m"].map((k) => bitmap(`${base}/kal_${name}_${k}.webp`)));
    const W = x.width;
    const H = x.height;
    const tx = this.plain(x, "r");
    const ty = this.plain(y, "r");
    const tc = this.plain(c, "r");
    const n = this.plain(null, "rgb", W, H, true);
    this.into(this.combine, n, W, H, [
      ["tX", tx],
      ["tY", ty],
      ["tC", tc],
    ]);
    [tx, ty, tc].forEach((t) => gl.deleteTexture(t));
    const piece = { map, n, h: this.plain(h, "r"), m: this.plain(m, "rgb") };
    for (const t of [piece.n, piece.h, piece.m]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (map.tile?.includes("x")) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      if (map.tile?.includes("y")) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    }
    this.trash.push(piece.n, piece.h, piece.m);
    return piece;
  }

  /** Distances (letters), as a picture. */
  sdf(data: Uint8Array, w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    this.trash.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return t;
  }
  forget(t: WebGLTexture) {
    this.gl.deleteTexture(t);
  }

  private light(L: Linked, cam: [number, number], vw: number, vh: number, t: number) {
    const gl = this.gl;
    const c = this.colors;
    const flick = 1 + 0.05 * Math.sin(t * 9.3) * Math.sin(t * 3.7) + 0.03 * Math.sin(t * 17.1);
    gl.uniform2f(L.u("uCam"), cam[0], cam[1]);
    gl.uniform2f(L.u("uView"), vw, vh);
    gl.uniform2f(L.u("uEye"), this.eye[0], this.eye[1]);
    gl.uniform3f(L.u("uTorchC"), c.torch[0], c.torch[1], c.torch[2]);
    gl.uniform3f(L.u("uAmb"), c.amb[0], c.amb[1], c.amb[2]);
    gl.uniform3f(L.u("uMoon"), c.moon[0], c.moon[1], c.moon[2]);
    gl.uniform3f(L.u("uLampC"), c.lamp[0], c.lamp[1], c.lamp[2]);
    gl.uniform1f(L.u("uT"), t);
    gl.uniform1fv(L.u("uLit[0]"), this.litNow);
    this.torchNow = this.torch.on * flick;
  }

  /** What shines on this part of the page (px): the rows near it, and the torch if it comes so far. */
  private near(L: Linked, x: number, y: number, w: number, h: number) {
    const gl = this.gl;
    const R = LU * REACH;
    const rows = NOROWS;
    rows.fill(0);
    const base = [0, 0];
    let n = 0;
    let o = 0;
    for (const r of this.rows) {
      const lit = r.lit;
      let any = false;
      for (let k = 0; k < r.n && !any; k++) any = lit[k] > 0.003 && Math.abs(r.x + k * r.step - (x + w / 2)) < w / 2 + R;
      if (any && n < 2 && r.y > y - R && r.y < y + h + R) {
        rows.set([r.x, r.y, r.step, r.n], n * 4);
        base[n++] = o;
      }
      o += r.n;
    }
    gl.uniform4fv(L.u("uRow[0]"), rows);
    gl.uniform2f(L.u("uBase"), base[0], base[1]);
    const t = this.torch;
    const dx = Math.max(0, x - t.x, t.x - x - w);
    const dy = Math.max(0, y - t.y, t.y - y - h);
    gl.uniform4f(L.u("uTorch"), t.x, t.y, t.z, dx * dx + dy * dy < R * R ? this.torchNow : 0);
  }

  private lay(list: Laid[], cam: [number, number], vw: number, vh: number, above: number, below: number) {
    const gl = this.gl;
    const L = this.piece;
    const y0 = cam[1] + above - 8;
    const y1 = cam[1] + vh - below + 8;
    for (const q of list) {
      const { map } = q.piece;
      const w = q.w ?? map.w * q.s;
      const h = q.h ?? map.h * q.s;
      if (q.y + h < y0 || q.y > y1 || q.x > cam[0] + vw + 60 || q.x + w < cam[0] - 60) continue;
      [q.piece.n, q.piece.h, q.piece.m].forEach((t, i) => {
        gl.activeTexture(gl.TEXTURE0 + i);
        gl.bindTexture(gl.TEXTURE_2D, t);
      });
      gl.uniform4f(L.u("uBox"), q.x, q.y, w, h);
      gl.uniform2f(L.u("uSize"), map.w, map.h);
      gl.uniform2f(L.u("uQuad"), w / q.s, h / q.s);
      gl.uniform1f(L.u("uMode"), map.nine ? 1 : 0);
      gl.uniform1f(L.u("uBorder"), map.nine ?? 0);
      gl.uniform1f(L.u("uWhole"), q.turn ?? 0);
      gl.uniform2f(L.u("uPivot"), q.x + w / 2, q.y + h / 2);
      gl.uniform1f(L.u("uFlip"), q.flip ? 1 : 0);
      gl.uniform1f(L.u("uGild"), q.gild ?? 0);
      const ch = q.chain;
      gl.uniform4f(L.u("uChain"), ch?.x0 ?? 0, ch?.pitch ?? 0, ch?.hot.i ?? -1, ch?.hot.v ?? 0);
      if (ch) gl.uniform4fv(L.u("uLinks[0]"), ch.links);
      gl.uniform1f(L.u("uMatte"), q.matte ?? 0);
      const raw = q.raw;
      gl.uniform4f(L.u("uRaw"), raw ? this.time - raw.at : 0, raw?.x ?? 0, raw?.y ?? 0, raw ? 1 : 0);
      if (raw) gl.uniform4fv(L.u("uOut[0]"), raw.outlines);
      gl.uniform3f(L.u("uEmit"), q.emit?.[0] ?? 0, q.emit?.[1] ?? 0, q.emit?.[2] ?? 0);
      const ga = q.metal ?? GOLD;
      gl.uniform3f(L.u("uMetal"), ga[0], ga[1], ga[2]);
      gl.uniform2f(L.u("uHR"), map.lo, map.hi - map.lo);
      gl.uniform1f(L.u("uS"), q.s);
      gl.uniform1f(L.u("uZ"), q.z ?? 0);
      const r = q.rings;
      gl.uniform4f(L.u("uRings"), r?.r[0] ?? 0, r?.r[1] ?? 0, r?.r[2] ?? 0, r ? 1 : 0);
      gl.uniform3f(L.u("uTurn"), r?.a[0] ?? 0, r?.a[1] ?? 0, r?.a[2] ?? 0);
      // In tiles, so that each pays only for the light that reaches it.
      const nx = q.turn ? 1 : Math.max(1, Math.round(w / TILE));
      const ny = q.turn ? 1 : Math.max(1, Math.round(h / TILE));
      for (let j = 0; j < ny; j++) {
        const y = q.y + (h * j) / ny;
        if (y + h / ny < y0 || y > y1) continue;
        for (let i = 0; i < nx; i++) {
          const x = q.x + (w * i) / nx;
          if (x + w / nx < cam[0] - 60 || x > cam[0] + vw + 60) continue;
          gl.uniform4f(L.u("uSub"), i / nx, j / ny, 1 / nx, 1 / ny);
          this.near(L, x, y, w / nx, h / ny);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }
    }
  }

  /** Drawn for a window of the page: its top left (page px), its size (CSS px), t in s; and how much
   *  of it above and below need not be. */
  draw(cam: [number, number], vw: number, vh: number, dpr: number, t: number, above = 0, below = 0) {
    const gl = this.gl;
    if (!this.ready || gl.isContextLost()) return;
    const W = Math.round(vw * dpr);
    const H = Math.round(vh * dpr);
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    this.time = t;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    let o = 0;
    this.litNow.fill(0);
    for (const r of this.rows) for (let i = 0; i < r.n && o < 64; i++, o++) this.litNow[o] = r.lit[i] * (1 + 0.07 * Math.sin(t * 5.1 + o * 2.3) * Math.sin(t * 2.3 + o));
    const P = this.piece;
    gl.useProgram(P.p);
    this.light(P, cam, vw, vh, t);
    ["tN", "tH", "tM", "tStone", "tNoise"].forEach((n, i) => gl.uniform1i(P.u(n), i));
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.stoneT);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.noiseT);
    this.lay(this.laid, cam, vw, vh, above, below);
    // What is in front of the wheel.
    this.lay(this.front, cam, vw, vh, above, below);
    if (this.cuts.length) {
      const C = this.cut;
      gl.useProgram(C.p);
      this.light(C, cam, vw, vh, t);
      gl.uniform1i(C.u("tSdf"), 0);
      gl.uniform1f(C.u("uZ"), 0);
      gl.activeTexture(gl.TEXTURE0);
      for (const c of this.cuts) {
        if (c.y + c.h < cam[1] || c.y > cam[1] + vh) continue;
        gl.bindTexture(gl.TEXTURE_2D, c.tex);
        gl.uniform4f(C.u("uBox"), c.x, c.y, c.w, c.h);
        gl.uniform4f(C.u("uSub"), 0, 0, 1, 1);
        this.near(C, c.x, c.y, c.w, c.h);
        gl.uniform2f(C.u("uSize"), c.w, c.h);
        gl.uniform2f(C.u("uQuad"), c.w, c.h);
        gl.uniform1f(C.u("uSpread"), c.spread);
        gl.uniform1f(C.u("uWake"), c.wake);
        gl.uniform1f(C.u("uPour"), c.pour);
        gl.uniform1f(C.u("uFrom"), c.from);
        gl.uniform1f(C.u("uPx"), dpr);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }
    // The flames.
    let n = 0;
    const inst = new Float32Array(64 * 4);
    let size = 30;
    for (const r of this.rows) {
      if (r.y < cam[1] - 80 || r.y > cam[1] + vh + 80) continue;
      size = r.size;
      for (let k = 0; k < r.n && n < 64; k++, n++) inst.set([r.x + k * r.step, r.y, r.lit[k], n * 0.37], n * 4);
    }
    if (n) {
      const F = this.flame;
      gl.useProgram(F.p);
      gl.uniform2f(F.u("uCam"), cam[0], cam[1]);
      gl.uniform2f(F.u("uView"), vw, vh);
      gl.uniform2f(F.u("uEye"), this.eye[0], this.eye[1]);
      gl.uniform1f(F.u("uSize"), size);
      gl.uniform1f(F.u("uT"), t);
      gl.bindVertexArray(this.fvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst, 0, n * 4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindVertexArray(this.vao);
    }
  }

  dispose() {
    this.trash.forEach((t) => this.gl.deleteTexture(t));
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
