"use client";

// Dust, in the room behind the cards.
//
//   "i love these small small dust… have it in our default ui too in
//    background without any disturbance or spoiling"
//   "those stars giving a movement like zoom in… this i want in our default
//    UI too… just zooming in, no need zoom out"
//   "cursor… when cursor moves other stuffs are given some movement when
//    cursor comes near… like throwing a stone in water but in a smooth way"
//
// One quiet WebGL layer of fine motes in the theme's colours. They drift
// slowly towards you all the time and faster while you scroll — always
// towards you, whichever way you scroll: a zoom IN, never out. Where the
// pointer moves (or a finger taps) the dust nearest it is pushed aside in
// widening rings that die away, like the surface of water. A few thousand
// points in one draw call; the loop sleeps when the tab is hidden, steps at
// half rate when nothing is happening, and stands still for reduced motion.

import { useEffect, useRef } from "react";
import { readRGB, THEME_EVENT } from "./theme";

const RIPPLES = 6;

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

      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: false, powerPreference: "low-power" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 60);
      camera.position.set(0, 0, 5);

      const N = still ? 260 : phone ? 700 : 1600;
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

      const ripples = Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0));
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
              if (age < 0.0 || age > 2.4) continue;
              vec2 dv = (ndc - r.xy) * vec2(uAspect, 1.0);
              float d = length(dv);
              float band = exp(-pow((d - age * 0.85) * 8.0, 2.0));
              float fade = exp(-age * 1.7) * r.w;
              push += normalize(dv + 1e-5) * band * fade * 0.07;
              glow += band * fade;
            }
            // …and a gentle parting right round the pointer itself.
            vec2 dm = (ndc - uMouse) * vec2(uAspect, 1.0);
            float lm = length(dm);
            push += normalize(dm + 1e-5) * 0.035 * exp(-lm * lm * 26.0);
            clip.xy += push * vec2(1.0 / uAspect, 1.0) * clip.w;
            gl_Position = clip;
            float far = smoothstep(-19.0, -11.0, p.z);
            float near = 1.0 - smoothstep(2.6, 4.4, p.z);
            float twinkle = 0.75 + 0.25 * sin(uTime * 1.4 + seed.w * 6.283);
            vAlpha = far * near * (0.28 + 0.6 * seed.z) * twinkle + glow * 0.55;
            vPick = seed.x;
            gl_PointSize = (0.9 + seed.y * seed.y * 2.6) * uRatio * (6.5 / max(0.6, -mv.z));
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
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      const fit = () => {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        mat.uniforms.uAspect.value = w / h;
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
        busyUntil = performance.now() + 2400;
      };
      const toNdc = (e: PointerEvent): [number, number] => [(e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1)];
      const onMove = (e: PointerEvent) => {
        if (still) return;
        const [x, y] = toNdc(e);
        if (e.pointerType === "mouse") mat.uniforms.uMouse.value.set(x, y);
        const now = performance.now();
        const moved = Math.hypot(x - lx, y - ly);
        if (moved > 0.07 && now - lastDrop > 120) {
          drop(x, y, Math.min(1, 0.45 + moved * 3));
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
          const target = 0.22 + scrollV * 0.55;
          speed += (target - speed) * (1 - Math.exp(-dt * (target > speed ? 6 : 2.2)));
          scrollV *= Math.exp(-dt * 5);
          mat.uniforms.uZ.value += speed * dt;
          mat.uniforms.uTime.value += dt;
        }
        mat.uniforms.uNow.value = now / 1000;
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

  return <canvas ref={canvas} aria-hidden className="pointer-events-none fixed inset-0 z-0 h-full w-full" />;
}
