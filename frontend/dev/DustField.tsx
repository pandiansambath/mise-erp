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
      float band = exp(-pow((d - age * 0.4) * 10.0, 2.0));
      float fade = exp(-age * 1.4) * r.w;
      bend += normalize(dv + 1e-5) * band * fade * 0.06;
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
    // The crest of each ring catches a little light.
    gl_FragColor = w + vec4(mix(uD, vec3(1.0), 0.3), 1.0) * crest * 0.22;
  }`;

export function DustField() {
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
        uniforms: { tMap: { value: target.texture }, uGain: { value: 0.12 } },
        vertexShader: FULLSCREEN_VERT,
        fragmentShader: /* glsl */ `
          uniform sampler2D tMap;
          uniform float uGain;
          varying vec2 vUv;
          void main() {
            vec2 c = vUv - 0.5;
            // A little stronger towards the edges, where nothing is written.
            float edge = 0.6 + 0.4 * smoothstep(0.15, 0.75, length(c * vec2(1.0, 1.25)));
            gl_FragColor = texture2D(tMap, vUv) * uGain * edge;
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
        if (moved > 0.06 && now - lastDrop > 110) {
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
  }, []);

  // z-[1]: over the page's vignette and colour washes (they used to sit on
  // top of it and swallowed the dust), under the content (main is z-10).
  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-[1] h-full w-full" />;
}
