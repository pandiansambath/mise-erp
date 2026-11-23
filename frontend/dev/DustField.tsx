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
//   while you scroll (a zoom in, whichever way you scroll). Where the pointer
//   moves, or a finger taps, rings run out like a stone dropped in water: the
//   dust is pushed aside and the watercolour itself bends and catches light
//   along each ring, and they die away. (The dust alone was too sparse for
//   the rings to read — 94.12.)
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

import { useEffect, useRef } from "react";
import { readRGB, THEME_EVENT } from "./theme";

const RIPPLES = 6;

const FULLSCREEN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }`;

const WATER_FRAG = /* glsl */ `
  precision highp float;
  uniform float uTime, uZoom, uAspect, uNow;
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
    // A stone in the water: where the pointer passed, rings run out through
    // the watercolour itself, bending it as they go, and fade (the same
    // ripples that push the dust aside).
    vec2 bend = vec2(0.0);
    float crest = 0.0;
    for (int i = 0; i < ${RIPPLES}; i++) {
      vec4 r = uRipple[i];
      float age = uNow - r.z;
      if (age < 0.0 || age > 2.6) continue;
      vec2 dv = c - r.xy * 0.5 * vec2(uAspect, 1.0);
      float d = length(dv);
      float band = exp(-pow((d - age * 0.4) * 8.0, 2.0));
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
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.autoClear = false;
      renderer.setClearColor(0x000000, 0);
      const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const quad = new THREE.PlaneGeometry(2, 2);

      const ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
      // The finale's surface (23 Nov): where the spine's chain dips into it,
      // rings spread across the water in perspective.
      const SURF = 4;
      const surf = Array.from({ length: SURF }, () => new THREE.Vector4(0, 0, -99, 0));
      let surfI = 0;
      let surfNext = 0;
      let surfEl: HTMLElement | null = null;
      let spineEl: HTMLElement | null = null;
      let lookedAt = -1e9;

      // ── The water, drawn small and stretched ──
      const waterScale = phone ? 0.3 : 0.42;
      const target = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
      let waterTick = false;
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
        },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
          uniform sampler2D tMap;
          uniform float uGain, uNow, uAspect, uRingGain, uDecor, uScroll, uClock;
          uniform vec2 uRes;
          uniform vec3 uRing, uCa, uCb, uCc, uBg, uInk;
          uniform vec4 uRipple[${RIPPLES}];
          uniform vec4 uSurf[4];
          uniform vec3 uSurfAt;
          varying vec2 vUv;
          const float TAU = 6.2831853;
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
            vec4 water = texture2D(tMap, vUv) * uGain * edge;
            // The stone in the water: the rings' light, drawn here at full
            // resolution and its own strength — inside the water it was cut
            // to the water's quiet 12% and could not be seen (QA, 22 Nov).
            vec2 cc = c * vec2(uAspect, 1.0);
            float ring = 0.0;
            for (int i = 0; i < ${RIPPLES}; i++) {
              vec4 r = uRipple[i];
              float age = uNow - r.z;
              if (age < 0.0 || age > 2.6) continue;
              float d = length(cc - r.xy * 0.5 * vec2(uAspect, 1.0));
              // a crisp ring with a fainter one just inside it, like water
              float band = exp(-pow((d - age * 0.4) * 46.0, 2.0)) + 0.4 * exp(-pow((d - age * 0.4 + 0.03) * 56.0, 2.0));
              ring += band * exp(-age * 1.5) * r.w;
            }
            float a = clamp(ring, 0.0, 1.0) * uRingGain;
            vec4 lit = water * (1.0 - a) + vec4(uRing * a, a);
            if (uDecor > 0.5) {
              vec2 P = vec2(vUv.x * uRes.x, (1.0 - vUv.y) * uRes.y);
              lit = over(lit, room(P));
              // Rings across the finale's surface, flattened by perspective,
              // from where the chain dips in; and the light at that point.
              float rip = 0.0;
              for (int i = 0; i < 4; i++) {
                vec4 s = uSurf[i];
                float age = uNow - s.z;
                if (age < 0.0 || age > 3.2) continue;
                float dd = length((P - s.xy) * vec2(1.0, 4.4));
                float R = 10.0 + age * 220.0;
                float band = exp(-pow((dd - R) / 5.5, 2.0)) + 0.45 * exp(-pow((dd - R + 15.0) / 6.5, 2.0));
                rip += band * exp(-age * 1.05) * s.w;
              }
              float glowS = exp(-length((P - uSurfAt.xy) * vec2(1.0, 3.2)) / 52.0) * 0.32 * uSurfAt.z;
              float ra = clamp(rip * 0.5 + glowS, 0.0, 1.0);
              // Light catching the water on a dark theme; the theme's ring
              // colour itself on a pale one, where white would vanish.
              float paleBg = step(0.5, dot(uBg, vec3(0.2126, 0.7152, 0.0722)));
              vec3 ringC = mix(mix(uRing, vec3(1.0), 0.3), uRing * 0.85, paleBg);
              lit = over(vec4(ringC * ra, ra), lit);
            }
            gl_FragColor = lit;
          }`,
      });
      const blitScene = new THREE.Scene();
      blitScene.add(new THREE.Mesh(quad, blitMat));

      // ── The dust ──
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 60);
      camera.position.set(0, 0, 5);
      const N = still ? 300 : phone ? 900 : 2200;
      const pos = new Float32Array(N * 3);
      const seed = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = (Math.random() - 0.5) * 26;
        pos[i * 3 + 1] = (Math.random() - 0.5) * 17;
        pos[i * 3 + 2] = -19 + Math.random() * 23.5;
        seed[i * 4] = Math.random();
        seed[i * 4 + 1] = Math.random();
        seed[i * 4 + 2] = Math.random();
        seed[i * 4 + 3] = Math.random();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      geo.setAttribute("seed", new THREE.BufferAttribute(seed, 4));

      const mat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uZ: { value: 0 },
          uTime: { value: 0 },
          uNow: { value: 0 },
          uRatio: { value: renderer.getPixelRatio() },
          uAspect: { value: 1 },
          uMouse: { value: new THREE.Vector2(9, 9) },
          uRipple: { value: ripples },
          uA: { value: new THREE.Color(1, 0.6, 0.35) },
          uB: { value: new THREE.Color(1, 0.85, 0.5) },
          uC: { value: new THREE.Color(0.5, 0.95, 0.9) },
          uGain: { value: 1 },
        },
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform float uZ, uTime, uNow, uRatio, uAspect;
          uniform vec2 uMouse;
          uniform vec4 uRipple[${RIPPLES}];
          varying float vAlpha;
          varying float vPick;
          void main() {
            vec3 p = position;
            // Towards the viewer, always: wrap from the near plane to the far.
            p.z = mod(p.z + 19.0 + uZ * (0.6 + seed.y * 0.8), 23.5) - 19.0;
            p.x += sin(uTime * 0.15 + seed.x * 6.283) * 0.25;
            p.y += cos(uTime * 0.12 + seed.z * 6.283) * 0.2;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            vec4 clip = projectionMatrix * mv;
            vec2 ndc = clip.xy / clip.w;
            // Water: rings widening from where the pointer passed.
            vec2 push = vec2(0.0);
            float glow = 0.0;
            for (int i = 0; i < ${RIPPLES}; i++) {
              vec4 r = uRipple[i];
              float age = uNow - r.z;
              if (age < 0.0 || age > 2.6) continue;
              vec2 dv = (ndc - r.xy) * vec2(uAspect, 1.0);
              float d = length(dv);
              float band = exp(-pow((d - age * 0.8) * 7.0, 2.0));
              float fade = exp(-age * 1.5) * r.w;
              push += normalize(dv + 1e-5) * band * fade * 0.16;
              glow += band * fade;
            }
            // …and a gentle parting right round the pointer itself.
            vec2 dm = (ndc - uMouse) * vec2(uAspect, 1.0);
            float lm = length(dm);
            push += normalize(dm + 1e-5) * 0.075 * exp(-lm * lm * 18.0);
            clip.xy += push * vec2(1.0 / uAspect, 1.0) * clip.w;
            gl_Position = clip;
            float far = smoothstep(-19.0, -10.0, p.z);
            float near = 1.0 - smoothstep(2.8, 4.4, p.z);
            float twinkle = 0.7 + 0.3 * sin(uTime * 1.4 + seed.w * 6.283);
            vAlpha = far * near * (0.38 + 0.62 * seed.z) * twinkle + glow * 1.1;
            vPick = seed.x;
            gl_PointSize = (1.1 + seed.y * seed.y * 3.4) * uRatio * (7.0 / max(0.6, -mv.z));
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uA, uB, uC;
          uniform float uGain;
          varying float vAlpha;
          varying float vPick;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.05, d);
            vec3 col = vPick < 0.45 ? uA : (vPick < 0.8 ? uB : uC);
            gl_FragColor = vec4(col, a * vAlpha * uGain);
          }`,
      });
      scene.add(new THREE.Points(geo, mat));

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
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      const fit = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);
        const pr = renderer.getPixelRatio();
        target.setSize(Math.max(2, Math.round(w * pr * waterScale)), Math.max(2, Math.round(h * pr * waterScale)));
        waterReady = false;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        mat.uniforms.uAspect.value = w / h;
        waterMat.uniforms.uAspect.value = w / h;
        blitMat.uniforms.uAspect.value = w / h;
        blitMat.uniforms.uRes.value.set(w, h);
      };
      fit();
      window.addEventListener("resize", fit);

      // Scroll speed → zoom speed (always forward).
      let lastY = window.scrollY;
      let lastT = performance.now();
      let scrollV = 0;
      let busyUntil = 0;
      const onScroll = () => {
        const now = performance.now();
        const dy = Math.abs(window.scrollY - lastY);
        const dt = Math.max(8, now - lastT);
        scrollV = Math.min(30, (dy / dt) * 16);
        lastY = window.scrollY;
        lastT = now;
        busyUntil = now + 900;
      };
      window.addEventListener("scroll", onScroll, { passive: true });

      // The pointer stirs the water; a tap drops a stone.
      let next = 0;
      let lastDrop = 0;
      let lx = 9;
      let ly = 9;
      const drop = (x: number, y: number, strength: number) => {
        ripples[next].set(x, y, performance.now() / 1000, strength);
        next = (next + 1) % RIPPLES;
        busyUntil = performance.now() + 2600;
        rippleUntil = busyUntil;
      };
      const toNdc = (e: PointerEvent): [number, number] => [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)];
      const onMove = (e: PointerEvent) => {
        if (still) return;
        const [x, y] = toNdc(e);
        if (e.pointerType === "mouse") mat.uniforms.uMouse.value.set(x, y);
        const now = performance.now();
        const moved = Math.hypot(x - lx, y - ly);
        if (moved > 0.08 && now - lastDrop > 170) {
          drop(x, y, Math.min(1, 0.5 + moved * 3));
          lx = x;
          ly = y;
          lastDrop = now;
        }
        busyUntil = Math.max(busyUntil, now + 600);
      };
      const onDown = (e: PointerEvent) => {
        if (still) return;
        const [x, y] = toNdc(e);
        drop(x, y, 1);
      };
      const onLeave = () => mat.uniforms.uMouse.value.set(9, 9);
      window.addEventListener("pointermove", onMove, { passive: true });
      window.addEventListener("pointerdown", onDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", onLeave);

      let raf = 0;
      let prev = performance.now();
      let speed = 0;
      let skip = false;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        if (document.hidden) return;
        const busy = now < busyUntil;
        // Nothing happening: half the frames are enough for a slow drift.
        if (!busy) {
          skip = !skip;
          if (skip) return;
        }
        const dt = Math.min(0.06, (now - prev) / 1000);
        prev = now;
        if (!still) {
          const goal = 0.22 + scrollV * 0.55;
          speed += (goal - speed) * (1 - Math.exp(-dt * (goal > speed ? 6 : 2.2)));
          scrollV *= Math.exp(-dt * 5);
          mat.uniforms.uZ.value += speed * dt;
          mat.uniforms.uTime.value += dt;
          // The water zooms with the dust — slowly at rest, with the scroll.
          waterMat.uniforms.uZoom.value += speed * dt * 0.045;
          waterMat.uniforms.uTime.value += dt;
        }
        mat.uniforms.uNow.value = now / 1000;
        waterMat.uniforms.uNow.value = now / 1000;
        blitMat.uniforms.uNow.value = now / 1000;
        blitMat.uniforms.uScroll.value = window.scrollY;
        if (decor) {
          // Where the finale's surface is, and where the chain meets it.
          if (now - lookedAt > 1000) {
            surfEl = document.querySelector<HTMLElement>("[data-surface]");
            spineEl = document.querySelector<HTMLElement>("canvas.sticky");
            lookedAt = now;
          }
          const at = blitMat.uniforms.uSurfAt.value as InstanceType<typeof THREE.Vector3>;
          const sr = surfEl?.getBoundingClientRect();
          if (sr && sr.width > 0 && sr.top > -80 && sr.top < window.innerHeight + 40) {
            const kr = spineEl?.getBoundingClientRect();
            const x = kr && kr.width > 0 ? kr.left + kr.width / 2 : sr.left + sr.width / 2;
            at.set(x, sr.top, 1);
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
          } else at.z = 0;
        }
        if (!still) blitMat.uniforms.uClock.value = now / 1000;
        // The water moves slowly: every other frame is enough to repaint it
        // (it is laid over the page every frame regardless).
        waterTick = !waterTick;
        if (waterTick || !waterReady || now < rippleUntil) {
          renderer.setRenderTarget(target);
          renderer.clear();
          renderer.render(waterScene, flat);
          waterReady = true;
        }
        renderer.setRenderTarget(null);
        renderer.clear();
        renderer.render(blitScene, flat);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener(THEME_EVENT, paint);
        window.removeEventListener("resize", fit);
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerdown", onDown);
        document.documentElement.removeEventListener("pointerleave", onLeave);
        geo.dispose();
        mat.dispose();
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
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[1] h-full w-full" />;
}
