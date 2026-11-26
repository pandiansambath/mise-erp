"use client";

// The room behind the cards: water, and dust in it.
//
//   "i love these small small dust… have it in our default ui too in
//    background without any disturbance or spoiling"
//   "those stars giving a movement like zoom in… this i want in our default
//    UI too… just zooming in, no need zoom out"
//   "possible to show that kind of wave in the entire site background too in
//    a smooth way… I said to show small small dust stars in the background but
//    you did not… when we scroll we need a zooming effect in the background,
//    all should show movement in the background, dust stars etc."
//   "cursor… when cursor moves other stuffs are given some movement when
//    cursor comes near… like throwing a stone in water but in a smooth way"
//
// One WebGL layer, two things in it:
//
//   THE WATER — the same watercolour as inside the cards (pools of the
//   theme's colours folded into each other, thin bright veins where the folds
//   meet), across the whole background, flowing slowly all the time. It is
//   drawn at a fraction of the screen's resolution and stretched (it is soft
//   anyway), so it costs little. Scrolling zooms INTO it, endlessly: two
//   copies an octave apart, the nearer growing and fading as the farther
//   takes its place — never out.
//
//   THE DUST — fine motes in the theme's colours drifting towards you, faster
//   while you scroll (a zoom in, whichever way you scroll).
//
//   THE FLIGHT (§108.2) — "that zoom in when I scroll… I want it a bit more deeper, to feel more
//   like we are inside a spaceship and moving": the dust is deep now (stars, far ahead), and goes
//   by as it does from a ship: it gathers speed with the scroll and glides on when it stops; what
//   is near draws out into streaks; the view opens wider with speed, and the ship's nose dips the
//   way one scrolls. Clouds in the water's colours come up out of the distance and are passed.
//
//   THE HAND IN IT (§104.7, flow.ts) — where the pointer goes the water is
//   dragged along, eddies behind it and waves run out of it; the watercolour,
//   the blooms and the grid are carried with it, the dust too; its wake is
//   dark, and comes apart into beads that flow and come together again.
//   (Rings like a stone's, dropped wherever the pointer passed, before.)
//
// It sits over the page's vignette and under the content (the vignette used
// to sit on top of it, which is why he could not see the dust at all). The
// loop sleeps when the tab is hidden, steps at half rate when nothing is
// happening, and stands still for reduced motion.
//
// `decor` (22 Nov, late): the Chain design's room — the accents bleeding in
// from the corners, the three drifting blooms, the waves along the bottom,
// the vignette and the dot grid — painted here, under the water, instead of
// as five full-screen layers of their own. Those layers cost ~100 MB of GPU
// memory on a phone at DPR 2.75, past its tile budget: Chrome then fills what
// it cannot draw with a layer's background colour, and the orbit's chips came
// back as black boxes after a scroll. Same looks, same motion, one canvas.

import { flight } from "./flight";
import { pageY } from "./scrollPos";
import { useEffect, useRef } from "react";
import { readRGB, THEME_EVENT } from "./theme";
import { beadPoints, beadShader, COME_APART, flowTexture, SURFACE_LIGHT, water as hand } from "./flow";
import { scatterUnderHand } from "./scatter";
import { guardCanvas, quiet } from "./glGuard";
import { holder, whenOpen } from "./stage";

const RIPPLES = 6;
/** The flight's greatest speed (units of the dust's space a second). */
const FASTEST = 24;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const WATER_FRAG = /* glsl */ `
#define sq2(x) ((x) * (x))

  precision highp float;
  uniform float uTime, uZoom, uAspect, uNow, uStirOn;
  uniform vec2 uRes;
  uniform sampler2D uFlow, uSlope;
  uniform vec3 uA, uB, uC, uD;
  uniform vec4 uRipple[${RIPPLES}];
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 3; i++) {
      v += a * noise(p);
      p = r * p * 2.03 + 3.1;
      a *= 0.5;
    }
    return v;
  }
  // The cards' watercolour (liquid.ts), alive: folded twice, veins where
  // the folds meet. Premultiplied.
  vec4 water(vec2 p, float t) {
    vec2 q = vec2(fbm(p + vec2(0.0, 0.0) + 0.035 * t), fbm(p + vec2(5.2, 1.3) - 0.03 * t));
    float f = fbm(p + 2.4 * q);
    float r = 1.0 - abs(fbm(p * 2.1 + q * 3.0 + 0.025 * t) * 2.0 - 1.0);
    float vein = pow(max(r, 0.0), 8.0);
    float k = clamp((f - 0.25) * 1.9, 0.0, 1.0);
    vec3 col = k < 0.33 ? mix(uA, uC, k / 0.33) : (k < 0.66 ? mix(uC, uB, (k - 0.33) / 0.33) : mix(uB, uD, (k - 0.66) / 0.34));
    col += vein * 0.45;
    float pool = clamp((f - 0.42) * 3.2, 0.0, 1.0);
    float a = clamp(pool * 0.55 + vein * 0.6, 0.0, 1.0);
    return vec4(col * a, a);
  }
  void main() {
    vec2 c = (vUv - 0.5) * vec2(uAspect, 1.0);
    // The hand in the water: it is carried along, and bent by its own surface.
    if (uStirOn > 0.5) {
      vec2 at = vec2(vUv.x, 1.0 - vUv.y);
      vec4 fl = texture2D(uFlow, at);
      vec2 g = texture2D(uSlope, at).xy * 0.74;
      c -= vec2(fl.x, -fl.y) / uRes.y * 0.085;
      c += vec2(g.x, -g.y) * 0.05;
    }
    // The opening's burst going through it: rings, bending it as they go.
    vec2 bend = vec2(0.0);
    float crest = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipple[i];
      float age = uNow - r.z;
      if (age < 0.0 || age > 2.6) continue;
      vec2 dv = c - r.xy * 0.5 * vec2(uAspect, 1.0);
      float d = length(dv);
      float band = exp(-sq2((d - age * 0.4) * 8.0));
      float fade = exp(-age * 1.4) * r.w;
      bend += normalize(dv + 1e-5) * band * fade * 0.09;
      crest += band * fade;
    }
    c -= bend;
    // An endless zoom in: two copies an octave apart; as the near one grows
    // past its size, the far one has become what it was.
    float f = fract(uZoom);
    float n = floor(uZoom);
    float s = exp2(-f);
    vec4 A = water(c * s * 2.2 + vec2(17.3, 9.1) * n, uTime);
    vec4 B = water(c * s * 4.4 + vec2(17.3, 9.1) * (n + 1.0), uTime);
    vec4 w = mix(A, B, smoothstep(0.0, 1.0, f));
    // The crest of each ring catches light — strongly here, because the whole
    // water is laid over the page at a quiet 12%: the rings were there but
    // could not be seen (22 Nov).
    gl_FragColor = w + vec4(mix(uD, vec3(1.0), 0.3), 1.0) * crest * 0.3;
  }`;

export function DustField({ decor = false }: { decor?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      if (dead) return;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: false, powerPreference: "low-power", premultipliedAlpha: true });

      quiet(renderer);
      // Taken away by the browser (a phone's few contexts): hide, never white.
      const unguard = guardCanvas(el);
      // A phone: 1× (a soft background, the whole screen — §101.9).
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1 : 1.5));
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new THREE.PlaneGeometry(2, 2);

      const ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
      // The hand in the water.
      const flow = flowTexture(THREE);
      const offUse = still ? () => {} : hand.use();
      // (Where the browser can, the whole page comes apart under it; else this canvas and the
      // cards do, each by itself.)
      const offScatter = still ? () => {} : scatterUnderHand((el.closest(".dev-root") as HTMLElement | null) ?? document.documentElement);
      const offHand = () => {
        offScatter();
        offUse();
      };
      const stir = { uFlow: { value: flow.tex }, uSlope: { value: flow.slope }, uStirOn: { value: 0 }, uApart: { value: 1 } };
      // The finale's surface (23 Nov): where the spine's chain dips into it,
      // rings spread across the water in perspective.
      const SURF = 4;
      const surf = Array.from({ length: SURF }, () => new THREE.Vector4(0, 0, -99, 0));
      let surfI = 0;
      let surfNext = 0;
      let surfEl: HTMLElement | null = null;
      let spineEl: HTMLElement | null = null;
      // Where they are, in the page (read once a second, not every frame — a
      // layout read in the frame forces a style and layout pass: §101.9).
      let surfDoc = { top: 0, left: 0, width: 0 };
      let spineMidX = -1;
      let lookedAt = -1e9;
      let lastSurfTop = 1e9;

      // ── The water, drawn small and stretched ──
      const waterScale = phone ? 0.3 : 0.42;
      const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
      let waterTick = 0;
      let waterReady = false;
      let rippleUntil = 0;
      const waterMat = new THREE.ShaderMaterial({
        depthTest: false,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uZoom: { value: 0 },
          uAspect: { value: 1 },
          uNow: { value: 0 },
          uRipple: { value: ripples },
          ...stir,
          uRes: { value: new THREE.Vector2(1, 1) },
          uA: { value: new THREE.Color(0.85, 0.47, 0.26) },
          uB: { value: new THREE.Color(0.18, 0.83, 0.75) },
          uC: { value: new THREE.Color(0.6, 0.55, 1) },
          uD: { value: new THREE.Color(0.49, 0.94, 0.86) },
        },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: WATER_FRAG,
      });
      const waterScene = new THREE.Scene();
      waterScene.add(new THREE.Mesh(quad, waterMat));
      // Laid over the page, quiet: a breath of colour behind the words.
      const blitMat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          tMap: { value: target.texture },
          uGain: { value: 0.12 },
          /** How much nearer it has come since it was painted; how fast one flies. */
          uLag: { value: 1 },
          uFly: { value: 0 },
          uNow: { value: 0 },
          uAspect: { value: 1 },
          uRipple: { value: ripples },
          uRing: { value: new THREE.Color(0.6, 0.95, 0.9) },
          uRingGain: { value: 0.4 },
          uDecor: { value: decor ? 1 : 0 },
          uRes: { value: new THREE.Vector2(1, 1) },
          uScroll: { value: 0 },
          uClock: { value: 0 },
          uCa: { value: new THREE.Color(0.85, 0.47, 0.26) },
          uCb: { value: new THREE.Color(0.18, 0.83, 0.75) },
          uCc: { value: new THREE.Color(0.6, 0.55, 1) },
          uBg: { value: new THREE.Color(0.03, 0.04, 0.06) },
          uInk: { value: new THREE.Color(0.6, 0.65, 0.7) },
          uSurf: { value: surf },
          uSurfAt: { value: new THREE.Vector3(0, 0, 0) },
          uShock: { value: new THREE.Vector3(0, 0, -99) },
          uPull: { value: 0 },
          ...stir,
        },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
#define sq2(x) ((x) * (x))

          uniform sampler2D tMap;
          uniform float uGain, uNow, uAspect, uRingGain, uDecor, uScroll, uClock, uLag, uFly;
          uniform vec2 uRes;
          uniform vec3 uRing, uCa, uCb, uCc, uBg, uInk;
          uniform vec4 uRipple[${RIPPLES}];
          uniform vec4 uSurf[4];
          uniform vec3 uSurfAt;
          uniform vec3 uShock;
          uniform float uPull, uStirOn, uApart;
          uniform sampler2D uFlow, uSlope;
          varying vec2 vUv;
          ${SURFACE_LIGHT}
          const float TAU = 6.2831853;
          vec4 flowAt(vec2 p) { return textureLod(uFlow, p / uRes, 0.0); }
          ${COME_APART}
          // Premultiplied "over".
          vec4 over(vec4 top, vec4 bottom) { return top + bottom * (1.0 - top.a); }
          vec4 tint(vec3 col, float a) { return vec4(col * a, a); }
          // A CSS radial-gradient(circle) bloom: 60% at the heart, 22% at 32%
          // of its farthest-corner radius, gone by 68%.
          float bloomA(vec2 P, vec2 c, float size) {
            float r = length(P - c) / (size * 0.7071);
            return r < 0.32 ? mix(0.6, 0.22, r / 0.32) : mix(0.22, 0.0, clamp((r - 0.32) / 0.36, 0.0, 1.0));
          }
          // One of the two waves along the bottom: a band filled below a sine
          // (the old SVG path: four humps a screen width, sliding sideways).
          float waveA(vec2 P, float top, float h, float T) {
            float y = (P.y - top) / h;
            if (y < 0.0 || y > 1.0) return 0.0;
            float slide = fract(uClock / T) * uRes.x;
            float x = (P.x + slide) / uRes.x * 1200.0;
            float surface = 0.6 + 0.225 * sin(TAU * x / 300.0);
            return smoothstep(surface - 1.2 / h, surface + 1.2 / h, y);
          }
          vec4 room(vec2 P) {
            vec2 W = uRes;
            vec4 col = vec4(0.0);
            // The wash: the bottom darkening, then the two accents.
            float d3 = length((P - vec2(0.5 * W.x, W.y)) / vec2(W.x, 0.7 * W.y));
            col = over(tint(uBg, 0.92 * max(0.0, 1.0 - d3 / 0.6)), col);
            float d2 = length((P - vec2(0.15 * W.x, 0.85 * W.y)) / vec2(0.9 * W.x, 0.6 * W.y));
            col = over(tint(uCb, 0.09 * max(0.0, 1.0 - d2 / 0.6)), col);
            float d1 = length((P - vec2(0.7 * W.x, 0.0)) / vec2(1.1 * W.x, 0.7 * W.y));
            col = over(tint(uCa, 0.11 * max(0.0, 1.0 - d1 / 0.55)), col);
            // The three blooms, drifting (devAurora) and rising slower than the
            // page as it scrolls.
            float lift = -uScroll * 0.06;
            for (int i = 0; i < 3; i++) {
              float fi = float(i);
              vec3 c = i == 0 ? uCa : (i == 1 ? uCb : uCc);
              float size = i == 0 ? 760.0 : (i == 1 ? 680.0 : 820.0);
              vec2 at = i == 0 ? vec2(-0.18, -0.22) : (i == 1 ? vec2(0.62, -0.10) : vec2(0.18, 0.58));
              float T = i == 0 ? 34.0 : (i == 1 ? 44.0 : 52.0);
              float ph = TAU * uClock / T + fi * 2.1;
              float sc = 1.07 + 0.07 * sin(ph);
              vec2 drift = size * vec2(0.06 * sin(ph), 0.055 * sin(ph * 0.8 + 1.3));
              vec2 centre = at * W + vec2(size * 0.5) + drift + vec2(0.0, lift);
              float amp = 0.67 + 0.13 * sin(ph + 0.7);
              col = over(tint(c, bloomA(P, centre, size * sc) * amp), col);
            }
            // The waves (bottom 42% of the screen, sinking a little with the scroll).
            float boxTop = W.y * 0.58 + uScroll * 0.04;
            float bh = W.y * 0.42;
            col = over(tint(uCa, 0.10 * waveA(P, boxTop + bh * 0.38, bh * 0.62, 28.0)), col);
            col = over(tint(uCb, 0.08 * waveA(P, boxTop + bh * 0.46, bh * 0.48, 44.0)), col);
            // The vignette: the middle of the page stays readable over all of it.
            float dv = length((P - vec2(0.5 * W.x, 0.45 * W.y)) / vec2(0.7896 * W.x, 0.7106 * W.y));
            float va = dv < 0.3 ? 0.0 : (dv < 0.78 ? mix(0.0, 0.55, (dv - 0.3) / 0.48) : mix(0.55, 0.9, clamp((dv - 0.78) / 0.22, 0.0, 1.0)));
            col = over(tint(uBg, va), col);
            // The dot grid, fading out towards the edges.
            vec2 q = mod(P, 26.0) - 13.0;
            float dot = 1.0 - smoothstep(0.9, 1.3, length(q));
            float dm = length((P - vec2(0.5 * W.x, 0.4 * W.y)) / vec2(0.8 * W.x, 0.7 * W.y));
            float mask = 1.0 - smoothstep(0.3, 0.85, dm);
            col = over(tint(uInk, 0.07 * dot * mask), col);
            return col;
          }
          void main() {
            vec2 c = vUv - 0.5;
            // A little stronger towards the edges, where nothing is written.
            float edge = 0.6 + 0.4 * smoothstep(0.15, 0.75, length(c * vec2(1.0, 1.25)));
            vec4 water = texture2D(tMap, c * uLag + 0.5) * uGain * edge * (1.0 + 1.1 * uFly);
            // What the hand does here (drawn at full resolution and its own strength: inside
            // the water, laid at a quiet 12%, it could not be seen).
            vec2 hp = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
            vec4 fl = vec4(0.0);
            vec3 sheen = vec3(0.0);
            vec4 wake = vec4(0.0);
            if (uStirOn > 0.5) {
              fl = flowAt(hp);
              sheen = surfaceLight(textureLod(uSlope, hp / uRes, 0.0).xy);
              water = mix(water, water * 2.6, smoothstep(0.05, 0.6, fl.z));
              float gone = smoothstep(0.1, 0.42, fl.z) * uApart;
              if (gone > 0.003) {
                vec2 from;
                vec3 bd = beadAt(hp, 15.0, from);
                float pick = apartRnd(from + 3.0);
                vec4 src = textureLod(tMap, vec2(from.x / uRes.x, 1.0 - from.y / uRes.y), 0.0);
                vec3 tone = mix(uRing, pick < 0.4 ? uCa : pick < 0.7 ? uCc : uRing, 0.75) * (0.22 + 0.5 * apartRnd(from.yx)) + src.rgb * 0.55;
                // The hole its wake is, and the beads in it.
                float hole = gone * 0.8;
                wake = vec4(uBg * hole, hole);
                float ba = bd.x * gone * 0.7 * smoothstep(0.16, 0.5, bd.z);
                wake = over(vec4(tone * bd.y * ba, ba), wake);
              }
            }
            vec2 cc = c * vec2(uAspect, 1.0);
            float ring = 0.0;
            for (int i = 0; i < ${RIPPLES}; i++) {
              vec4 r = uRipple[i];
              float age = uNow - r.z;
              if (age < 0.0 || age > 2.6) continue;
              float d = length(cc - r.xy * 0.5 * vec2(uAspect, 1.0));
              // a crisp ring with a fainter one just inside it, like water
              float band = exp(-sq2((d - age * 0.4) * 46.0)) + 0.4 * exp(-sq2((d - age * 0.4 + 0.03) * 56.0));
              ring += band * exp(-age * 1.5) * r.w;
            }
            float a = clamp(ring, 0.0, 1.0) * uRingGain;
            vec4 lit = water * (1.0 - a) + vec4(uRing * a, a);
            if (uDecor > 0.5) {
              // (The room is seen through the water: carried with it, a little.)
              vec2 P = hp - fl.xy * 0.055;
              lit = over(lit, room(P));
              P = hp;
              // Its surface: the lit side of a wave and its shadow, and a glint off it.
              lit = over(vec4(uBg * sheen.y * 0.5, sheen.y * 0.5), lit);
              float la = sheen.x * uRingGain * 0.55;
              lit = over(vec4(uRing * la, la), lit);
              float ga = clamp(sheen.z * 1.2, 0.0, 1.0) * uRingGain;
              lit = over(vec4(mix(uRing, vec3(1.0), 0.6) * ga, ga), lit);
              lit = over(wake, lit);
              // Rings across the finale's surface, flattened by perspective,
              // from where the chain dips in; and the light at that point.
              float rip = 0.0;
              for (int i = 0; i < 4; i++) {
                vec4 s = uSurf[i];
                float age = uNow - s.z;
                if (age < 0.0 || age > 3.2) continue;
                float dd = length((P - s.xy) * vec2(1.0, 6.2));
                float R = 10.0 + age * 220.0;
                float band = exp(-sq2((dd - R) / 5.5)) + 0.45 * exp(-sq2((dd - R + 15.0) / 6.5));
                rip += band * exp(-age * 1.05) * s.w;
              }
              float glowS = exp(-length((P - uSurfAt.xy) * vec2(1.0, 3.2)) / 52.0) * 0.32 * uSurfAt.z;
              // The finale arriving (§101.4): a shockwave across the whole
              // water and a column of light running up the chain…
              float sAge = uNow - uShock.z;
              float shock = 0.0;
              if (sAge > 0.0 && sAge < 2.2) {
                float sd = length((P - uSurfAt.xy) * vec2(1.0, 7.0));
                float SR = 20.0 + sAge * 760.0;
                shock = (exp(-sq2((sd - SR) / 22.0)) * 1.5 + 0.7 * exp(-sq2((sd - SR + 48.0) / 28.0))) * exp(-sAge * 1.2);
                // The surface line flashes along its length as it arrives.
                shock += exp(-sq2((P.y - uSurfAt.y) / 3.0)) * exp(-sAge * 2.6) * 1.2;
                float col = exp(-sq2((P.x - uSurfAt.x) / (6.0 + sAge * 10.0))) * step(P.y, uSurfAt.y + 4.0);
                float climb = smoothstep(uSurfAt.y - sAge * 900.0 - 40.0, uSurfAt.y - sAge * 900.0, P.y);
                shock += col * climb * exp(-sAge * 2.0) * 1.6;
              }
              // …and, while it pulls, light pouring down into the water.
              vec2 toE = P - uSurfAt.xy;
              float shafts = 0.0;
              if (uPull > 0.01 && toE.y < 0.0) {
                float ang = atan(toE.x, -toE.y);
                float beam = pow(0.5 + 0.5 * sin(ang * 22.0 + sin(ang * 7.0 + uClock * 0.2) * 2.0), 6.0);
                shafts = beam * exp(-length(toE) / 520.0) * smoothstep(0.0, 120.0, -toE.y) * uPull * 0.16;
              }
              float ra = clamp(rip * 0.5 + glowS + shock + shafts, 0.0, 1.0);
              // Light catching the water on a dark theme; the theme's ring
              // colour itself on a pale one, where white would vanish.
              float paleBg = step(0.5, dot(uBg, vec3(0.2126, 0.7152, 0.0722)));
              vec3 ringC = mix(mix(uRing, vec3(1.0), 0.3), uRing * 0.85, paleBg);
              lit = over(vec4(ringC * ra, ra), lit);
            }
            if (uDecor <= 0.5) lit = over(wake, lit);
            // Ahead, where it is all coming from: a light.
            if (uFly > 0.01) {
              float ahead = exp(-dot(cc, cc) * 9.0) * uFly * 0.07 * (1.0 - step(0.5, dot(uBg, vec3(0.2126, 0.7152, 0.0722))));
              lit = over(vec4(mix(uRing, vec3(1.0), 0.25) * ahead, ahead), lit);
            }
            gl_FragColor = lit;
          }`,
      });
      const blitScene = new THREE.Scene();
      blitScene.add(new THREE.Mesh(quad, blitMat));

      // ── Dust drawn into the chain (the finale, 23 Nov) ──
      // "having as many dust particles moving towards that chain… so that we
      // can still reduce the gap… still a small emptiness we can feel". While
      // the finale's surface is on screen, dust gathers from the air all round
      // the hanging chain, is drawn in to it — curling as it comes — and runs
      // down it into the water where the rings spread. Screen pixels, drawn
      // flat over the room, under the page.
      // §101.4: "the end of the chain hanging raw, an emptiness… groups of
      // dust pulled downward or upward before reaching the finale chain… and
      // a transition from this page to that page". Eight STREAMS — ribbons of
      // dust curving in from both sides over the open space, narrowing as
      // they reach the chain and plunging down it into the water — and spray
      // thrown back up the chain; all of it building as the finale comes up
      // the screen (uPull).
      const NI = still ? 0 : phone ? 420 : 900;
      const iSeed = new Float32Array(Math.max(1, NI) * 4);
      for (let i = 0; i < iSeed.length; i++) iSeed[i] = Math.random();
      const iGeo = new THREE.BufferGeometry();
      iGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, NI) * 3), 3));
      iGeo.setAttribute("seed", new THREE.BufferAttribute(iSeed, 4));
      const inflowMat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        uniforms: {
          uRes: { value: new THREE.Vector2(1, 1) },
          uE: { value: new THREE.Vector2(0, 0) },
          uTime: { value: 0 },
          uOn: { value: 0 },
          uPx: { value: 1 },
          uSpread: { value: new THREE.Vector2(500, 360) },
          uPull: { value: 0 },
          uC0: { value: new THREE.Color(0.49, 0.94, 0.86) },
          uC1: { value: new THREE.Color(0.94, 0.63, 0.39) },
          uHot: { value: new THREE.Color(0.94, 0.74, 0.42) },
          uGain: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform vec2 uRes, uE, uSpread;
          uniform float uTime, uOn, uPx, uPull;
          varying float vA;
          varying float vT;
          varying float vPick;
          vec2 bez(vec2 a, vec2 b, vec2 c, vec2 d, float u) {
            float v = 1.0 - u;
            return v * v * v * a + 3.0 * v * v * u * b + 3.0 * v * u * u * c + u * u * u * d;
          }
          vec2 bezD(vec2 a, vec2 b, vec2 c, vec2 d, float u) {
            float v = 1.0 - u;
            return 3.0 * v * v * (b - a) + 6.0 * v * u * (c - b) + 3.0 * u * u * (d - c);
          }
          void main() {
            // One in eighteen is spray (fewer: they gathered at the water).
            float sid = seed.x < 0.055 ? 8.0 : floor(seed.x / 0.945 * 8.0);
            vec2 q;
            float u;
            if (sid < 8.0) {
              // A stream: from out in the air on one side, arcing up a little,
              // in to the chain, then down it into the water.
              float side = mod(sid, 2.0) < 0.5 ? -1.0 : 1.0;
              float k = floor(sid / 2.0);
              vec2 P0 = vec2(uE.x + side * uSpread.x * (0.5 + 0.5 * fract(k * 0.37 + 0.2)), uE.y - uSpread.y * (0.3 + 0.7 * fract(k * 0.61 + 0.1)));
              vec2 P1 = vec2(uE.x + side * uSpread.x * (0.32 + 0.2 * fract(k * 0.73)), P0.y - 50.0 - 90.0 * fract(k * 0.29));
              vec2 P2 = vec2(uE.x + side * 16.0, uE.y - uSpread.y * (0.2 + 0.22 * fract(k * 0.53)));
              float life = 3.6 + fract(k * 0.77) * 1.8;
              float t = fract(uTime / life + seed.y);
              u = pow(t, 1.3);
              // Each stream meets the chain at its own height and runs down it
              // fading — ending all at one point piled the grains into a blob.
              vec2 P3 = vec2(uE.x, uE.y - 18.0 - 110.0 * fract(k * 0.41 + seed.z * 0.35));
              q = bez(P0, P1, P2, P3, u);
              vec2 tg = normalize(bezD(P0, P1, P2, P3, u) + 1e-4);
              // Across the ribbon: wide out in the air, a thread at the chain.
              q += vec2(-tg.y, tg.x) * (seed.z - 0.5) * 38.0 * pow(max(0.0, 1.0 - u), 1.4);
              q += tg * sin(t * 9.0 + seed.w * 6.2831) * 6.0 * (1.0 - u);
            } else {
              // Spray: thrown back up the chain from the water, fanning, falling.
              float t = fract(uTime / 2.4 + seed.y);
              u = t;
              q = uE + vec2((seed.z - 0.5) * 70.0 * t, -t * (110.0 + seed.w * 120.0) + t * t * (100.0 + seed.w * 60.0));
            }
            gl_Position = vec4(q.x / uRes.x * 2.0 - 1.0, 1.0 - q.y / uRes.y * 2.0, 0.0, 1.0);
            float a = smoothstep(0.0, 0.12, u) * (1.0 - smoothstep(0.72, 0.96, u));
            vA = a * uOn * (0.25 + 0.75 * uPull) * (0.6 + 0.4 * u);
            vT = u;
            vPick = seed.z;
            gl_PointSize = (1.3 + seed.w * 2.0 + u * 1.5) * uPx;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1, uHot;
          uniform float uGain;
          varying float vA;
          varying float vT;
          varying float vPick;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            // A bright grain with a soft glow round it.
            float m = smoothstep(0.5, 0.0, d) * 0.55 + smoothstep(0.22, 0.0, d) * 0.6;
            vec3 c = mix(vPick < 0.62 ? uC0 : uC1, uHot, smoothstep(0.7, 1.0, vT) * 0.6);
            float a = m * vA * uGain;
            gl_FragColor = vec4(c * a, a);
          }`,
      });
      const inflowScene = new THREE.Scene();
      const inflow = new THREE.Points(iGeo, inflowMat);
      inflow.frustumCulled = false;
      inflowScene.add(inflow);

      // ── The dust ──
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 60);
      camera.position.set(0, 0, 5);
      const FAR = 34;
      const N = still ? 420 : phone ? 1300 : 3800;
      const home = new Float32Array(N * 3);
      const seed = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        home[i * 3] = (Math.random() - 0.5) * (phone ? 12 : 30);
        home[i * 3 + 1] = (Math.random() - 0.5) * (phone ? 22 : 20);
        home[i * 3 + 2] = -FAR + Math.random() * (FAR + 4.5);
        seed[i * 4] = Math.random();
        seed[i * 4 + 1] = Math.random();
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = Math.random();
      }
      // Each a small square, or (in flight) a streak: from where it was a moment ago to where it is.
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0]), 3));
      geo.setIndex([0, 1, 2, 2, 1, 3]);
      geo.setAttribute("home", new THREE.InstancedBufferAttribute(home, 3));
      geo.setAttribute("seed", new THREE.InstancedBufferAttribute(seed, 4));
      geo.instanceCount = N;

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        defines: { FAR: `${FAR}.0` },
        uniforms: {
          uZ: { value: 0 },
          /** How far it goes while the eye's shutter is open. */
          uTrail: { value: 0 },
          uTime: { value: 0 },
          uNow: { value: 0 },
          uAspect: { value: 1 },
          uMouse: { value: new THREE.Vector2(9, 9) },
          uRipple: { value: ripples },
          ...stir,
          uHigh: { value: 800 },
          uA: { value: new THREE.Color(1, 0.6, 0.35) },
          uB: { value: new THREE.Color(1, 0.85, 0.5) },
          uC: { value: new THREE.Color(0.5, 0.95, 0.9) },
          uGain: { value: 1 },
        },
        vertexShader: /* glsl */ `
#define sq2(x) ((x) * (x))

          attribute vec3 home;
          attribute vec4 seed;
          uniform float uZ, uTrail, uTime, uNow, uAspect, uStirOn, uHigh;
          uniform sampler2D uFlow;
          uniform vec2 uMouse;
          uniform vec4 uRipple[${RIPPLES}];
          varying float vAlpha;
          varying float vPick;
          varying vec4 vAt;
          void main() {
            vec3 p = home;
            // Towards the viewer, always: wrap from the near plane to the far.
            float own = 0.6 + seed.y * 0.8;
            p.z = mod(p.z + FAR + uZ * own, FAR + 4.5) - FAR;
            p.x += sin(uTime * 0.15 + seed.x * 6.283) * 0.25;
            p.y += cos(uTime * 0.12 + seed.z * 6.283) * 0.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vec4 clip = projectionMatrix * mv;
            vec2 ndc = clip.xy / clip.w;
            // Water: carried with it, and lit where it is stirred…
            vec2 push = vec2(0.0);
            float glow = 0.0;
            for (int i = 0; i < ${RIPPLES}; i++) {
              vec4 r = uRipple[i];
              float age = uNow - r.z;
              if (age < 0.0 || age > 2.6) continue;
              vec2 dv = (ndc - r.xy) * vec2(uAspect, 1.0);
              float d = length(dv);
              float band = exp(-sq2((d - age * 0.8) * 7.0));
              float fade = exp(-age * 1.5) * r.w;
              push += normalize(dv + 1e-5) * band * fade * 0.16;
              glow += band * fade;
            }
            if (uStirOn > 0.5) {
              vec4 fl = texture2D(uFlow, vec2(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5));
              push += vec2(fl.x, -fl.y) / uHigh * (0.16 + 0.5 * seed.y);
              glow += fl.z * 0.8;
            }
            // …and a gentle parting right round the pointer itself.
            vec2 dm = (ndc - uMouse) * vec2(uAspect, 1.0);
            float lm = length(dm);
            push += normalize(dm + 1e-5) * 0.075 * exp(-lm * lm * 18.0);
            push *= vec2(1.0 / uAspect, 1.0);
            vec2 half_ = vec2(uHigh * uAspect, uHigh) * 0.5;
            vec2 head = (ndc + push) * half_;
            vec4 was = projectionMatrix * modelViewMatrix * vec4(p - vec3(0.0, 0.0, uTrail * own), 1.0);
            vec2 tail = (was.xy / was.w + push) * half_;
            float rad = (1.1 + seed.y * seed.y * 3.4) * 3.5 / max(0.6, -mv.z);
            // (Never thinner than can be drawn: fainter instead.)
            float thin = min(1.0, rad / 0.85);
            rad = max(rad, 0.85);
            vec2 d = head - tail;
            float len = length(d);
            vec2 dir = len > 0.4 ? d / len : vec2(1.0, 0.0);
            vec2 at = mix(tail - dir * rad, head + dir * rad, position.y) + vec2(-dir.y, dir.x) * position.x * rad;
            vAt = vec4(mix(-rad, len + rad, position.y), position.x * rad, len, rad);
            float far = smoothstep(-FAR, -FAR + 11.0, p.z);
            float near = 1.0 - smoothstep(2.8, 4.4, p.z);
            float twinkle = 0.7 + 0.3 * sin(uTime * 1.4 + seed.w * 6.283);
            vAlpha = (far * near * (0.38 + 0.62 * seed.z) * twinkle + glow * 1.1) * mix(1.0, 0.55, clamp(len / 90.0, 0.0, 1.0)) * mix(1.0, thin, clamp(len / 3.0, 0.0, 1.0))
              // (Streaks keep to the edges of the view: the words are in its middle.)
              * mix(1.0, smoothstep(0.18, 0.62, length(head / half_)), clamp(len / 6.0, 0.0, 1.0));
            vPick = seed.x;
            gl_Position = -mv.z > 0.3 ? vec4(at / half_, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uA, uB, uC;
          uniform float uGain;
          varying float vAlpha;
          varying float vPick;
          varying vec4 vAt;
          void main() {
            float x = clamp(vAt.x, 0.0, vAt.z);
            float d = length(vec2(vAt.x - x, vAt.y)) / vAt.w;
            float a = smoothstep(1.0, 0.1, d);
            // A streak is bright at its head.
            if (vAt.z > 1.0) a *= mix(1.0, 0.12 + 0.88 * x / vAt.z, clamp(vAt.z / 14.0, 0.0, 1.0));
            vec3 col = vPick < 0.45 ? uA : (vPick < 0.8 ? uB : uC);
            gl_FragColor = vec4(col, a * vAlpha * uGain);
          }`,
      });
      const dust = new THREE.Mesh(geo, mat);
      dust.frustumCulled = false;
      scene.add(dust);

      // ── Clouds, far ahead, and passed: painted into the water's small picture ──
      const NC = still ? 0 : phone ? 5 : 9;
      const cloudAt = new Float32Array(Math.max(1, NC) * 4);
      for (let i = 0; i < NC; i++) {
        // Round the way ahead, not on it.
        const a = i * 2.39996 + 0.6;
        const r = (phone ? 3.4 : 6.5) + 3.5 * Math.random();
        cloudAt.set([Math.cos(a) * r * (phone ? 0.7 : 1.25), Math.sin(a) * r, (i + 0.5) / Math.max(1, NC), Math.random()], i * 4);
      }
      const cloudGeo = new THREE.InstancedBufferGeometry();
      cloudGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0]), 3));
      cloudGeo.setIndex([0, 1, 2, 2, 1, 3]);
      cloudGeo.setAttribute("home", new THREE.InstancedBufferAttribute(cloudAt, 4));
      cloudGeo.instanceCount = NC;
      const cloudMat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        defines: { FAR: `${FAR}.0` },
        uniforms: { uZ: mat.uniforms.uZ, uA: waterMat.uniforms.uA, uB: waterMat.uniforms.uB, uC: waterMat.uniforms.uC, uFly: { value: 0 } },
        vertexShader: /* glsl */ `
          attribute vec4 home;
          uniform float uZ, uFly;
          varying vec2 vQ;
          varying float vA, vPick;
          void main() {
            float t = fract(home.z + uZ / (FAR * 2.2));
            float z = mix(-FAR, 3.0, t);
            vec3 c = vec3(home.xy, z);
            vec4 mv = modelViewMatrix * vec4(c, 1.0);
            mv.xy += position.xy * 5.2;
            vQ = position.xy;
            vPick = home.w;
            vA = smoothstep(0.0, 0.3, t) * smoothstep(1.0, 0.86, t) * (0.25 + 0.75 * uFly);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uA, uB, uC;
          varying vec2 vQ;
          varying float vA, vPick;
          float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
          float noise(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y); }
          void main() {
            float r = length(vQ);
            if (r > 1.0) discard;
            float n = noise(vQ * 2.2 + vPick * 37.0) * 0.6 + noise(vQ * 5.1 - vPick * 19.0) * 0.4;
            float a = smoothstep(1.0, 0.15, r) * smoothstep(0.25, 0.75, n + 0.25 * (1.0 - r)) * vA * 0.75;
            vec3 col = vPick < 0.34 ? uA : (vPick < 0.67 ? uB : uC);
            gl_FragColor = vec4(col * a, a);
          }`,
      });
      const clouds = new THREE.Mesh(cloudGeo, cloudMat);
      clouds.frustumCulled = false;
      const cloudScene = new THREE.Scene();
      cloudScene.add(clouds);

      // ── The beads the hand throws clear ──
      const bs = beadShader(`uniform vec2 uRes; vec4 put(vec2 p) { return vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0); }`);
      const beadMat = new THREE.ShaderMaterial({
        transparent: true,
        depthTest: false,
        depthWrite: false,
        uniforms: { uRes: { value: new THREE.Vector2(1, 1) }, uPx: { value: renderer.getPixelRatio() }, uShow: { value: 0.85 } },
        vertexShader: bs.vertex,
        fragmentShader: bs.fragment,
      });
      const beads = beadPoints(THREE, beadMat);
      const beadScene = new THREE.Scene();
      beadScene.add(beads.points);

      const paint = () => {
        const root = el.closest(".dev-root") ?? document.documentElement;
        const c = (role: string, fb: [number, number, number]) => {
          const [r, g, b] = readRGB(root, role, fb);
          return new THREE.Color(r / 255, g / 255, b / 255);
        };
        mat.uniforms.uA.value = c("a2", [240, 160, 100]);
        mat.uniforms.uB.value = c("gold", [240, 189, 106]);
        mat.uniforms.uC.value = c("b2", [125, 240, 220]);
        waterMat.uniforms.uA.value = c("a", [217, 119, 66]);
        waterMat.uniforms.uC.value = c("c", [155, 140, 255]);
        waterMat.uniforms.uB.value = c("b", [45, 212, 191]);
        waterMat.uniforms.uD.value = c("b2", [125, 240, 220]);
        // A light theme: the water stays a tint, the dust a little stronger
        // so it still reads against paper.
        const [br, bg, bb] = readRGB(root, "bg", [7, 10, 15]);
        const light = (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255 > 0.5;
        blitMat.uniforms.uGain.value = light ? 0.08 : 0.12;
        blitMat.uniforms.uRing.value = c("b2", [125, 240, 220]);
        blitMat.uniforms.uRingGain.value = light ? 0.26 : 0.4;
        blitMat.uniforms.uCa.value = c("a", [217, 119, 66]);
        blitMat.uniforms.uCb.value = c("b", [45, 212, 191]);
        blitMat.uniforms.uCc.value = c("c", [155, 140, 255]);
        blitMat.uniforms.uBg.value = c("bg", [7, 10, 15]);
        blitMat.uniforms.uInk.value = c("ink4", [150, 160, 170]);
        mat.uniforms.uGain.value = light ? 1.25 : 1;
        inflowMat.uniforms.uC0.value = c("b2", [125, 240, 220]);
        inflowMat.uniforms.uC1.value = c("a2", [240, 160, 100]);
        inflowMat.uniforms.uHot.value = c("gold", [240, 189, 106]);
        inflowMat.uniforms.uGain.value = light ? 0.8 : 1;
        hand.palette = (["b2", "gold", "c", "ink"] as const).map((k, i) => readRGB(root, k, ([[125, 240, 220], [240, 189, 106], [155, 140, 255], [230, 237, 245]] as [number, number, number][])[i]).map((v) => v / 255));
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      let fitted = "";
      let tall = window.innerHeight;
      let wide = window.innerWidth;
      const fit = () => {
        // A phone: the screen without its address bar, always (100lvh). The bar slides away
        // and back in the middle of a scroll, and each time the drawing surface was made
        // anew — which stops the page until the graphics have answered.
        // (And its own width: the window's has the scrollbar in it, and everything drawn was a
        // hundredth narrower than the page.)
        const w = Math.max(1, el.clientWidth || window.innerWidth);
        const h = phone ? Math.max(1, el.clientHeight) : window.innerHeight;
        if (`${w}x${h}` === fitted) return;
        wide = w;
        fitted = `${w}x${h}`;
        tall = h;
        renderer.setSize(w, h, false);
        const pr = renderer.getPixelRatio();
        target.setSize(Math.max(2, Math.round(w * pr * waterScale)), Math.max(2, Math.round(h * pr * waterScale)));
        waterReady = false;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        inflowMat.uniforms.uRes.value.set(w, h);
        inflowMat.uniforms.uPx.value = pr;
        inflowMat.uniforms.uSpread.value.set(Math.min(w * 0.44, 640), Math.min(h * 0.5, 380));
        mat.uniforms.uAspect.value = w / h;
        waterMat.uniforms.uAspect.value = w / h;
        blitMat.uniforms.uAspect.value = w / h;
        blitMat.uniforms.uRes.value.set(w, h);
        waterMat.uniforms.uRes.value.set(w, h);
        beadMat.uniforms.uRes.value.set(w, h);
        mat.uniforms.uHigh.value = h;
      };
      fit();
      window.addEventListener("resize", fit);

      // Scroll speed → zoom speed (always forward).
      let lastY = pageY();
      let lastT = performance.now();
      let scrollV = 0;
      let way = 0;
      let lean = 0;
      let painted = 0;
      let busyUntil = 0;
      const onScroll = () => {
        const now = performance.now();
        const y = pageY();
        const dy = Math.abs(y - lastY);
        const dt = Math.max(8, now - lastT);
        scrollV = Math.min(40, Math.max(scrollV * 0.6, (dy / dt) * 16));
        if (dy > 0.5) way = Math.sign(y - lastY);
        lastY = y;
        lastT = now;
        busyUntil = now + 2200;
      };
      window.addEventListener("scroll", onScroll, { passive: true });

      // (Rings: the opening's burst only.)
      let next = 0;
      const drop = (x: number, y: number, strength: number) => {
        ripples[next].set(x, y, performance.now() / 1000, strength);
        next = (next + 1) % RIPPLES;
        busyUntil = performance.now() + 2600;
        rippleUntil = busyUntil;
      };
      const toNdc = (e: PointerEvent): [number, number] => [(e.clientX / wide) * 2 - 1, -((e.clientY / tall) * 2 - 1)];
      const onMove = (e: PointerEvent) => {
        if (still) return;
        const [x, y] = toNdc(e);
        if (e.pointerType === "mouse") mat.uniforms.uMouse.value.set(x, y);
        busyUntil = Math.max(busyUntil, performance.now() + 600);
      };
      const onLeave = () => mat.uniforms.uMouse.value.set(9, 9);
      window.addEventListener("pointermove", onMove, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);

      let raf = 0;
      let prev = performance.now();
      let speed = 0;
      let skip = false;
      // The door opens (§103.10): the burst goes through the water too — rings run out
      // from the middle of it — and the dust rushes past you and settles.
      const hold = holder(6);
      let primed = false;
      let rush = 0;
      const offOpen = whenOpen((bang) => {
        if (!bang || still) return;
        rush = 1;
        busyUntil = performance.now() + 3400;
        drop(0, 0, 1);
        window.setTimeout(() => drop(0, 0, 0.8), 260);
        window.setTimeout(() => drop(0, 0, 0.6), 620);
      });
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (document.hidden) return;
        if (hold()) {
          prev = now;
          return;
        }
        const stirred = hand.active();
        // (Where the whole page comes apart by itself, its water need not be drawn every frame.)
        const busy = now < busyUntil || (stirred && hand.apart);
        // Nothing happening: half the frames are enough for a slow drift.
        if (!busy) {
          skip = !skip;
          if (skip) return;
        }
        const dt = Math.min(0.06, (now - prev) / 1000);
        prev = now;
        if (!still) {
          rush *= Math.exp(-dt * 1.5);
          // It gathers speed, and glides on when the scroll has stopped: a ship, not a wheel.
          const push = 1 - Math.exp(-scrollV / 13);
          const goal = 0.22 + FASTEST * push + rush * 17;
          speed += (goal - speed) * (1 - Math.exp(-dt * (goal > speed ? 5 : 1.9)));
          scrollV *= Math.exp(-dt * 5);
          const v = Math.min(1, Math.max(0, (speed - 0.22) / FASTEST));
          flight.z += speed * dt;
          flight.v = v;
          mat.uniforms.uZ.value += speed * dt;
          mat.uniforms.uTrail.value = Math.min(1.5, Math.max(0, speed - 2.5) * 0.068);
          mat.uniforms.uTime.value += dt;
          cloudMat.uniforms.uFly.value = v;
          blitMat.uniforms.uFly.value = v;
          // The view opens with it; its nose dips the way one scrolls, and it banks a little.
          lean += (way * push - lean) * (1 - Math.exp(-dt * 2.2));
          const t = now / 1000;
          camera.fov = 62 + 20 * v * v * (3 - 2 * v);
          camera.rotation.x = -0.075 * lean;
          camera.rotation.z = 0.035 * lean + 0.012 * Math.sin(t * 0.21) * (0.3 + v);
          camera.rotation.y = 0.02 * Math.sin(t * 0.13) * (0.3 + v);
          camera.updateProjectionMatrix();
          // The water zooms with the dust — slowly at rest, with the scroll.
          waterMat.uniforms.uZoom.value += speed * dt * 0.06;
          waterMat.uniforms.uTime.value += dt;
        }
        mat.uniforms.uNow.value = now / 1000;
        waterMat.uniforms.uNow.value = now / 1000;
        blitMat.uniforms.uNow.value = now / 1000;
        const sy = pageY();
        blitMat.uniforms.uScroll.value = sy;
        if (decor) {
          // Where the finale's surface is, and where the chain meets it.
          if (now - lookedAt > 1000) {
            surfEl = document.querySelector<HTMLElement>("[data-surface]");
            spineEl = document.querySelector<HTMLElement>("canvas.sticky");
            const r = surfEl?.getBoundingClientRect();
            surfDoc = r ? { top: r.top + window.scrollY, left: r.left, width: r.width } : { top: 0, left: 0, width: 0 };
            const k = spineEl?.getBoundingClientRect();
            spineMidX = k && k.width > 0 ? k.left + k.width / 2 : -1;
            lookedAt = now;
          }
          const at = blitMat.uniforms.uSurfAt.value as InstanceType<typeof THREE.Vector3>;
          const sr = surfDoc.width > 0 ? { top: surfDoc.top - sy, left: surfDoc.left, width: surfDoc.width } : null;
          if (sr && sr.top > -80 && sr.top < window.innerHeight + 40) {
            const x = spineMidX >= 0 ? spineMidX : sr.left + sr.width / 2;
            at.set(x, sr.top, 1);
            inflowMat.uniforms.uE.value.set(x, sr.top);
            // The pull builds as the surface comes up the screen: nothing
            // while it is below, all of it by the middle.
            const vh = window.innerHeight;
            const pull = Math.min(1, Math.max(0, (vh * 1.05 - sr.top) / (vh * 0.5)));
            inflowMat.uniforms.uPull.value = pull;
            blitMat.uniforms.uPull.value = pull;
            // The arrival: the surface rising past 72 % of the screen.
            if (!still && lastSurfTop > vh * 0.72 && sr.top <= vh * 0.72) {
              (blitMat.uniforms.uShock.value as InstanceType<typeof THREE.Vector3>).set(x, sr.top, now / 1000);
              busyUntil = Math.max(busyUntil, now + 2400);
            }
            lastSurfTop = sr.top;
            // The rings stay on the surface as it scrolls.
            for (const s of surf) {
              s.x = x;
              s.y = sr.top;
            }
            const sec = now / 1000;
            if (!still && sec > surfNext) {
              surf[surfI].set(x, sr.top, sec, 1);
              surfI = (surfI + 1) % SURF;
              surfNext = sec + 1.15;
            }
            busyUntil = Math.max(busyUntil, now + 300);
          } else {
            at.z = 0;
            lastSurfTop = 1e9;
            blitMat.uniforms.uPull.value = 0;
          }
        }
        if (!still) blitMat.uniforms.uClock.value = now / 1000;
        // The inflow follows the surface on and off the screen.
        if (NI > 0) {
          const want = decor ? (blitMat.uniforms.uSurfAt.value as InstanceType<typeof THREE.Vector3>).z : 0;
          const on = inflowMat.uniforms.uOn.value as number;
          inflowMat.uniforms.uOn.value = on + (want - on) * (1 - Math.exp(-dt * 3));
          inflowMat.uniforms.uTime.value = now / 1000;
        }
        // The water moves slowly: every other frame is enough to repaint it
        // (it is laid over the page every frame regardless).
        waterTick = (waterTick + 1) % (flight.v > 0.15 ? 3 : 2);
        stir.uStirOn.value = stirred ? 1 : 0;
        stir.uApart.value = hand.apart ? 1 : 0;
        if (stirred) {
          flow.update();
          beads.update();
        } else beads.points.visible = false;
        if (waterTick === 0 || !waterReady || now < rippleUntil || stirred) {
          renderer.setRenderTarget(target);
          renderer.clear();
          renderer.render(waterScene, flat);
          if (NC > 0) renderer.render(cloudScene, camera);
          painted = waterMat.uniforms.uZoom.value;
          waterReady = true;
        }
        // (Between two paintings of it, it comes nearer all the same.)
        blitMat.uniforms.uLag.value = Math.pow(2, painted - waterMat.uniforms.uZoom.value);
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(blitScene, flat);
        renderer.render(scene, camera);
        if (beads.points.visible || !primed) renderer.render(beadScene, flat);
        // (The finale's streams drawn once, unseen, behind the door: the first time a shader
        // is used the page stops for the graphics, and that was as the finale arrived.)
        if (NI > 0 && (!primed || (inflowMat.uniforms.uOn.value as number) > 0.01)) renderer.render(inflowScene, flat);
        primed = true;
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        unguard();
        offOpen();
        offHand();
        flow.dispose();
        beads.dispose();
        beadMat.dispose();
        iGeo.dispose();
        inflowMat.dispose();
        cancelAnimationFrame(raf);
        window.removeEventListener(THEME_EVENT, paint);
        window.removeEventListener("resize", fit);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", onMove);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        geo.dispose();
        mat.dispose();
        cloudGeo.dispose();
        cloudMat.dispose();
        quad.dispose();
        waterMat.dispose();
        blitMat.dispose();
        target.dispose();
        renderer.dispose();
        // Give the GPU memory back now, not at the next garbage collection —
        // a design switch builds the next scene straight away.
        renderer.forceContextLoss();
      };
      if (dead) cleanup();
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, [decor]);

  // z-[1]: over the page's vignette and colour washes (they used to sit on
  // top of it and swallowed the dust), under the content (main is z-10).
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[1] h-[100lvh] w-full md:h-full" />;
}
