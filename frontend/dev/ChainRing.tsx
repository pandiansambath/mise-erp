"use client";

// The finale's chain, forged out of light.
//
//   "this chain also i want in active theory kind style instead of plain
//    chain… like crystal water liquid etc kind of animation"
//   "the chain area… on mobile I see a completely different chain, I love the
//    mobile one… but still enhance both… I'm still expecting something unique
//    and cool… chain needed to showcase that slogan, but in a unique way…
//    new unique animation effects"
//
// A ring of real 3D links in iridescent chrome, lit by the theme's colours,
// alternate links at right angles so the loops read as a chain. What is new
// is how it comes to be: every link is made of light first. As the section
// scrolls in, thousands of sparks stream up from below — "all moving from
// down into the air" — swirl round the ring's axis and settle onto the shape
// of one link after another; each link sets solid with a flash as the last
// of its light arrives, a little overshoot as it locks in — one link at a
// time, which is what the words under it say. Scrubbed by the scroll, so you
// forge the chain yourself, and can unmake it by scrolling back.
//
// When the last link closes, the ring flashes, light rays open behind it, the
// slogan's words arrive (onAssembled) and it starts to turn: a pulse of light
// keeps running round it link to link — the chain reaction — and a few
// sparks keep lifting off the metal into the air. The pointer leans it; a
// drag spins it.
//
// One WebGL canvas behind the words. It only draws while it is on screen,
// eases by time (a slow device still closes the chain), gives its GPU memory
// back on the way out, and stands still — forged — for reduced motion.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { readRGB, THEME_EVENT } from "./theme";
import { guardCanvas } from "./glGuard";
import { bakedRing } from "./ringBake";
import { pixelRatio, watchGpu } from "./sharp";

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Past the mark and back: a link locking into place. */
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
};

export function ChainRing({ children, onAssembled }: { children: ReactNode; onAssembled?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const rays = useRef<HTMLDivElement>(null);
  const assembledCb = useRef(onAssembled);
  useEffect(() => {
    assembledCb.current = onAssembled;
  }, [onAssembled]);

  // A WebGL context from the first time the finale comes within a couple of
  // screens (§100.2: a phone has only a few for the whole page), then kept.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const host = wrap.current;
    if (!host) return;
    // Built the first time the finale comes near, then KEPT (§101.9: built
    // and dropped on every pass, it froze a phone each time it came back).
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setNear(true);
      },
      { rootMargin: "160% 0px" },
    );
    io.observe(host);
    // …or sooner, in the browser's idle time once the page has settled: its
    // setup (the links, the reflections) is the one long task left, and it
    // should not land mid-scroll (§101.9).
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const early = window.setTimeout(() => {
      if (w.requestIdleCallback) w.requestIdleCallback(() => setNear(true), { timeout: 4000 });
      else setNear(true);
    }, 5000);
    return () => {
      io.disconnect();
      window.clearTimeout(early);
    };
  }, []);

  useEffect(() => {
    const host = wrap.current;
    const el = canvas.current;
    if (!near || !host || !el) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      if (dead) return;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      // Anti-aliased on a phone too (§102.7): without it, and at 1.25 pixels per
      // CSS pixel, the links' edges broke into white steps on his screen.
      const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true, powerPreference: "high-performance" });
      // Taken away by the browser (a phone's few contexts): hide, never white.
      const unguard = guardCanvas(el);
      renderer.setPixelRatio(pixelRatio("ring", phone));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      // What the metal reflects: not a white room (that made it plain silver)
      // but the dark, with panels of the theme's light in it, so the links
      // throw coloured light like the crystal spine (re-lit per theme in
      // paint()).
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x030307);
      const envPanel = (w: number, h: number, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        envScene.add(m);
        return m.material as InstanceType<typeof THREE.MeshBasicMaterial>;
      };
      const envA = envPanel(3, 7, -5, 2, 3);
      const envB = envPanel(3, 7, 5, 1, -2);
      const envC = envPanel(8, 2, 0, 6, 0);
      const envD = envPanel(6, 1.5, 0, -5, 3);
      const envGlint = envPanel(1.2, 1.2, 2, 3, 6);
      let envTex: InstanceType<typeof THREE.Texture> | null = null;

      // One stadium link, shared by every link in the ring.
      class Stadium extends THREE.Curve<InstanceType<typeof THREE.Vector3>> {
        constructor(private r: number, private half: number) {
          super();
        }
        getPoint(t: number, target = new THREE.Vector3()) {
          const { r, half } = this;
          const straight = 2 * half;
          const arc = Math.PI * r;
          const total = 2 * straight + 2 * arc;
          let d = t * total;
          if (d < straight) return target.set(-half + d, r, 0);
          d -= straight;
          if (d < arc) {
            const a = Math.PI / 2 - d / r;
            return target.set(half + r * Math.cos(a), r * Math.sin(a), 0);
          }
          d -= arc;
          if (d < straight) return target.set(half - d, -r, 0);
          d -= straight;
          const a = -Math.PI / 2 - d / r;
          return target.set(-half + r * Math.cos(a), r * Math.sin(a), 0);
        }
      }
      const N = phone ? 22 : 28;
      const R = 3.2;
      // A link is longer than the gap between slots, so neighbours pass
      // through each other's loops — interlocked, as real links are.
      const gap = (2 * Math.PI * R) / N;
      const geo = new THREE.TubeGeometry(new Stadium(0.21, gap * 0.6), phone ? 72 : 120, 0.078, phone ? 12 : 18, true);
      // Not plain silver: metal under a thin film that throws rainbow, each
      // link tinted along a gradient of the theme's colours round the ring
      // (paint()), reflecting the coloured dark above.
      const metal = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.16,
        iridescence: 1,
        iridescenceIOR: 1.9,
        iridescenceThicknessRange: [220, 820],
        clearcoat: 0.8,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.7,
      });
      const ring = new THREE.Group();
      scene.add(ring);
      const rnd = seeded(7);
      type Link = { mesh: InstanceType<typeof THREE.Mesh>; mat: InstanceType<typeof THREE.MeshPhysicalMaterial>; delay: number; angle: number; q: InstanceType<typeof THREE.Quaternion>; base: InstanceType<typeof THREE.Vector3> };
      const links: Link[] = [];
      const one = new THREE.Vector3(1, 1, 1);
      const m4 = new THREE.Matrix4();
      const slots: InstanceType<typeof THREE.Matrix4>[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        // Its own material, so each link can flash and carry the pulse.
        const mat = metal.clone();
        const mesh = new THREE.Mesh(geo, mat);
        // Long axis ALONG the ring (lookAt points the link's +z at the centre,
        // so its x, the long axis, is the ring's tangent), every other link
        // turned a quarter round that axis: each passes through its
        // neighbours' loops, as a real chain's links do. (They were turned
        // another quarter about y, which stood them radially like spokes:
        // "the chain is not linked with each other".)
        const o = new THREE.Object3D();
        o.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
        o.lookAt(0, 0, 0);
        if (i % 2) o.rotateX(Math.PI / 2);
        mesh.position.copy(o.position);
        mesh.quaternion.copy(o.quaternion);
        mesh.scale.setScalar(0.0001);
        mesh.visible = false;
        slots.push(m4.clone().compose(o.position, o.quaternion, one));
        if (!phone) ring.add(mesh);
        links.push({ mesh, mat, delay: (i / N) * 0.55, angle: a, q: o.quaternion.clone(), base: o.position.clone() });
      }

      // Light in the theme's colours, so the chrome carries them.
      const keyA = new THREE.PointLight(0xffffff, 60, 18);
      keyA.position.set(-4, 3, 4);
      const keyB = new THREE.PointLight(0xffffff, 55, 18);
      keyB.position.set(4, 2, -3);
      const under = new THREE.PointLight(0xffffff, 35, 14);
      under.position.set(0, -3, 2);
      scene.add(keyA, keyB, under);
      // A phone, drawn sharp: the metal worked out once a theme, the links one
      // draw (ringBake; §102.7).
      const baked = phone ? bakedRing(THREE, renderer, geo, metal, N, [keyA, keyB, under]) : null;
      if (baked) ring.add(baked.mesh);
      // Where the camera stands (the loop keeps it there), known before the
      // metal is drawn: it reflects the room as this camera sees it.
      camera.position.set(0, Math.sin(0.38) * 11.5, Math.cos(0.38) * 11.5);
      camera.lookAt(0, -0.2, 0);
      camera.updateMatrixWorld();

      // ── The forge: every link is light before it is metal ──
      const K = phone ? 90 : 130;
      const F = N * K;
      const fFrom = new Float32Array(F * 3);
      const fTo = new Float32Array(F * 3);
      const fSeed = new Float32Array(F * 4);
      const gp = geo.getAttribute("position");
      const gn = geo.getAttribute("normal");
      const v = new THREE.Vector3();
      const vn = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < K; j++) {
          const n = i * K + j;
          // Where it lands: just inside the surface of its link — the light
          // becomes the metal. (On the surface itself, half of every grain
          // stood out past the link's outline: a fringe of white specks.)
          const at = Math.floor(rnd() * gp.count);
          v.fromBufferAttribute(gp, at).addScaledVector(vn.fromBufferAttribute(gn, at), -0.045).applyMatrix4(slots[i]);
          fTo[n * 3] = v.x;
          fTo[n * 3 + 1] = v.y;
          fTo[n * 3 + 2] = v.z;
          // Where it starts: low down, all round — below the frame.
          const a = rnd() * Math.PI * 2;
          const rr = R * (0.5 + rnd() * 1.9);
          fFrom[n * 3] = Math.cos(a) * rr;
          fFrom[n * 3 + 1] = -2.8 - rnd() * 3.4;
          fFrom[n * 3 + 2] = Math.sin(a) * rr;
          fSeed[n * 4] = links[i].delay + rnd() * 0.06;
          fSeed[n * 4 + 1] = rnd();
          fSeed[n * 4 + 2] = rnd();
          fSeed[n * 4 + 3] = rnd();
        }
      }
      const forgeGeo = new THREE.BufferGeometry();
      forgeGeo.setAttribute("position", new THREE.BufferAttribute(fFrom, 3));
      forgeGeo.setAttribute("target", new THREE.BufferAttribute(fTo, 3));
      forgeGeo.setAttribute("seed", new THREE.BufferAttribute(fSeed, 4));
      const forgeMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uShow: { value: 0 },
          uTime: { value: 0 },
          uRatio: { value: renderer.getPixelRatio() },
          uFlash: { value: 0 },
          uDone: { value: 0 },
          uWaveA: { value: 0 },
          uWaveT: { value: 0 },
          uGain: { value: 1 },
          uC0: { value: new THREE.Color(0.94, 0.74, 0.42) },
          uC1: { value: new THREE.Color(0.5, 0.95, 0.88) },
          uC2: { value: new THREE.Color(1, 0.6, 0.4) },
          uC3: { value: new THREE.Color(0.6, 0.55, 1) },
        },
        vertexShader: /* glsl */ `
          attribute vec3 target;
          attribute vec4 seed;
          uniform float uShow, uTime, uRatio, uFlash, uDone, uWaveA, uWaveT;
          varying float vA;
          varying float vPick;
          void main() {
            float k = clamp((uShow - seed.x) / 0.4, 0.0, 1.0);
            float e = 1.0 - pow(1.0 - k, 3.0);
            // Up from below, swirling round the ring's axis, onto its link.
            vec3 p = mix(position, target, e);
            float swirl = (1.0 - e) * (3.2 + seed.y * 2.6);
            float cs = cos(swirl);
            float sn = sin(swirl);
            p.xz = mat2(cs, -sn, sn, cs) * p.xz;
            p.y += sin(e * 3.14159) * (0.9 + seed.z * 0.8);
            // home on its link, it rides the chain's wave
            p.y += uWaveA * sin(3.0 * atan(target.z, target.x) - uWaveT) * smoothstep(0.75, 1.0, k);
            // Once the ring is whole, a few lift off the metal into the air.
            float spark = step(0.84, seed.w) * uDone;
            float life = fract(uTime * (0.1 + seed.y * 0.12) + seed.z);
            p.y += spark * life * 4.0;
            p.xz *= 1.0 + spark * life * 0.3;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float travel = 1.0 - e;
            gl_PointSize = (1.6 + seed.y * 3.2) * (0.75 + travel * 1.4 + uFlash * 0.8) * uRatio * (10.0 / -mv.z);
            // Home: its link is solid now, the light dims to a glimmer.
            float home = mix(1.0, 0.16, smoothstep(0.75, 1.0, k));
            float lift = mix(1.0, (1.0 - life) * 0.9, spark);
            // Fade in over the bottom of the frame: no line where they appear.
            float bottom = smoothstep(-1.0, -0.72, gl_Position.y / gl_Position.w);
            vA = step(0.0001, k + uDone) * home * lift * bottom * (0.55 + 0.45 * seed.z) + uFlash * 0.45;
            vPick = seed.y;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1, uC2, uC3;
          uniform float uGain;
          varying float vA;
          varying float vPick;
          void main() {
            // A soft hexagon of light.
            vec2 q = abs((gl_PointCoord - 0.5) * 2.0);
            float h = max(dot(q, vec2(0.8660254, 0.5)), q.y);
            float a = smoothstep(1.0, 0.7, h);
            vec3 col = vPick < 0.3 ? uC0 : vPick < 0.6 ? uC1 : vPick < 0.82 ? uC2 : uC3;
            gl_FragColor = vec4(col + smoothstep(0.5, 0.0, h) * 0.4, a * vA * uGain);
          }`,
      });
      const forge = new THREE.Points(forgeGeo, forgeMat);
      forge.frustumCulled = false;
      ring.add(forge);

      // The colour each link carries when it flashes or the pulse passes.
      const glowA = new THREE.Color();
      const glowB = new THREE.Color();
      let light = false;
      const paint = () => {
        const c = (role: string, fb: [number, number, number]) => {
          const [r, g, b] = readRGB(host, role, fb);
          return new THREE.Color(r / 255, g / 255, b / 255);
        };
        keyA.color = c("a2", [240, 160, 100]);
        keyB.color = c("b", [45, 212, 191]);
        under.color = c("c", [155, 140, 255]);
        forgeMat.uniforms.uC0.value = c("gold", [240, 189, 106]);
        forgeMat.uniforms.uC1.value = c("b2", [125, 240, 220]);
        forgeMat.uniforms.uC2.value = c("a2", [240, 160, 100]);
        forgeMat.uniforms.uC3.value = c("c", [155, 140, 255]);
        glowA.copy(c("gold", [240, 189, 106]));
        glowB.copy(c("b2", [125, 240, 220]));
        links.forEach((L, i) => L.mat.emissive.copy(i % 2 ? glowB : glowA));
        // A gradient of the theme round the ring, mixed toward white so the
        // metal stays bright: a2, gold, b2, c and back.
        const stops = [c("a2", [240, 160, 100]), c("gold", [240, 189, 106]), c("b2", [125, 240, 220]), c("c", [155, 140, 255])];
        links.forEach((L, i) => {
          const u = (i / N) * stops.length;
          const k0 = Math.floor(u) % stops.length;
          const k1 = (k0 + 1) % stops.length;
          L.mat.color.copy(stops[k0]).lerp(stops[k1], u - Math.floor(u)).lerp(new THREE.Color(1, 1, 1), 0.45);
        });
        // The dark the metal reflects, lit in this theme's colours.
        envA.color = c("a2", [240, 160, 100]).multiplyScalar(2.4);
        envB.color = c("b2", [125, 240, 220]).multiplyScalar(2.4);
        envC.color = c("c", [155, 140, 255]).multiplyScalar(2);
        envD.color = c("gold", [240, 189, 106]).multiplyScalar(1.6);
        envGlint.color = new THREE.Color(1, 1, 1).multiplyScalar(3);
        envTex?.dispose();
        envTex = pmrem.fromScene(envScene, 0.02).texture;
        scene.environment = envTex;
        baked?.bake(
          envTex,
          stops.map((x) => x.clone().lerp(new THREE.Color(1, 1, 1), 0.45)),
          camera,
        );
        const [br, bg, bb] = readRGB(host, "bg", [7, 10, 15]);
        light = (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255 > 0.5;
        // Added light vanishes on paper: there the sparks are painted.
        forgeMat.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        forgeMat.needsUpdate = true;
      };
      // Its shaders built off the main thread before the first bake draws.
      if (baked) {
        const room = pmrem.fromScene(envScene, 0.02).texture;
        await baked.warm(room, camera).catch(() => {});
        room.dispose();
        if (dead) {
          unguard();
          baked.dispose();
          pmrem.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          return;
        }
      }
      paint();
      window.addEventListener(THEME_EVENT, paint);

      // Frame the ring round the WORDS: the slogan sits in the ring's hole
      // on every screen. The phone always did (he loves that one); on a wide
      // screen the words were wider than the ring and its links crossed
      // them. So the camera comes as close as it takes for the hole to clear
      // the longest line, and no closer than keeps the whole ring in frame.
      // By layout, not by the boxes on screen: the words are hidden (and
      // shrunk) until the ring closes, which made them measure narrow.
      const textWidth = () => {
        const h2 = host.querySelector("h2");
        if (!h2) return 0;
        let widest = 0;
        h2.querySelectorAll(":scope > span").forEach((line) => {
          const words = line.querySelectorAll<HTMLElement>(":scope > span");
          if (!words.length) return;
          const first = words[0];
          const last = words[words.length - 1];
          widest = Math.max(widest, last.offsetLeft + last.offsetWidth - first.offsetLeft);
        });
        return widest;
      };
      const HOLE = 5.0; // the hole the words can use, in scene units (measured on screen)
      const gpu = watchGpu(renderer, "ring", phone, (ratio) => {
        renderer.setPixelRatio(ratio);
        forgeMat.uniforms.uRatio.value = ratio;
      });
      const fit = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        const tw = textWidth();
        // Pixels per scene unit at the ring's depth: enough for the hole to
        // clear the words with room to spare, but the whole ring — its near
        // side magnified by perspective — still inside the frame.
        // The near links swell with perspective, so the frame allows for
        // them: 7.6 units across, 4.2 high.
        const ppu = Math.min(tw > 0 ? (tw * 1.25) / HOLE : h / 6.77, (w * 0.92) / 7.6, (h * 0.9) / 4.2);
        // The camera keeps the phone's distance on every screen — the depth
        // he loves in the phone's chain — and the lens narrows to frame the
        // ring: a close camera on a desktop swelled the near links out of
        // the frame.
        const dist = 11.5;
        camera.fov = (2 * Math.atan(h / (2 * ppu * dist)) * 180) / Math.PI;
        camera.userData.dist = dist;
        camera.updateProjectionMatrix();
        host.dataset.frame = `${Math.round(w)}x${Math.round(h)} text ${Math.round(tw)} ppu ${ppu.toFixed(1)} fov ${camera.fov.toFixed(1)}`;
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(host);
      // Web fonts change the line's width once they arrive.
      document.fonts?.ready.then(() => !dead && fit());

      // The pointer leans the ring; a drag spins it.
      let tilt = 0.38;
      let tiltT = 0.38;
      let dragV = 0;
      let dragging = false;
      let lastX = 0;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        if (e.pointerType === "mouse") tiltT = 0.3 + ((e.clientY - r.top) / r.height) * 0.18;
        if (dragging) {
          dragV += (e.clientX - lastX) * 0.004;
          lastX = e.clientX;
        }
      };
      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
      };
      const onUp = () => {
        dragging = false;
      };
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerdown", onDown);
      window.addEventListener("pointerup", onUp);

      let visible = true;
      const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "200px" });
      io.observe(host);

      const progress = () => {
        const r = host.getBoundingClientRect();
        const vh = window.innerHeight;
        return Math.max(0, Math.min(1, (vh * 0.98 - r.top) / (vh * 0.62)));
      };

      let shown = reduced ? 1 : 0;
      let fired = false;
      let flash = 0;
      let done = reduced ? 1 : 0;
      let spin = 0;
      let t = 0;
      let last = performance.now();
      let raf = 0;
      const tilt3 = new THREE.Quaternion();
      const zAxis = new THREE.Vector3(0, 0, 1);
      const fire = () => {
        fired = true;
        flash = 1;
        if (rays.current) rays.current.dataset.on = "";
        assembledCb.current?.();
      };
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.5, (now - last) / 1000);
        last = now;
        if (!visible || document.hidden) return;
        t += dt;
        if (!reduced) shown += (progress() - shown) * (1 - Math.exp(-dt * 5));
        if (shown > 0.985 && !fired) fire();
        flash *= Math.exp(-dt * 2.4);
        done += ((fired ? 1 : 0) - done) * (1 - Math.exp(-dt * 1.5));
        // The pulse: once the ring is whole, a light running round it.
        const pulseAt = t * 1.7;
        // And the chain breathes: a slow wave runs round it, each link riding
        // it and tilting with its slope, like a heavy chain moving.
        const waveA = reduced ? 0 : 0.17 * done;
        const waveT = t * 1.3;
        for (let i = 0; i < N; i++) {
          const L = links[i];
          const k = clamp01((shown - L.delay - 0.03) / 0.4);
          // The link sets solid as the last of its light arrives…
          const f = clamp01((k - 0.62) / 0.38);
          L.mesh.visible = f > 0;
          L.mesh.scale.setScalar(f > 0 ? Math.max(0.0001, easeOutBack(f)) : 0.0001);
          if (waveA > 0.001) {
            const ph = 3 * L.angle - waveT;
            L.mesh.position.set(L.base.x, waveA * Math.sin(ph), L.base.z);
            // the slope along the ring, as a tilt about the link's radial axis
            tilt3.setFromAxisAngle(zAxis, Math.atan((waveA * 3 * Math.cos(ph)) / R));
            L.mesh.quaternion.copy(L.q).multiply(tilt3);
          }
          // …with a flash as it forms.
          const forming = Math.sin(Math.PI * clamp01((k - 0.7) / 0.3));
          let d = (((L.angle - pulseAt) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
          d = Math.abs(d);
          const pulse = Math.exp(-(d / 0.34) * (d / 0.34)) * done;
          L.mat.emissiveIntensity = forming * 1.3 + pulse * (light ? 0.6 : 1.25) + flash * 0.8;
          L.mat.envMapIntensity = 1.4 + flash * 2.6;
          baked?.set(i, L.mesh, L.mat.emissive, L.mat.emissiveIntensity);
        }
        baked?.flush();
        if (!reduced) {
          spin += dt * (fired ? 0.22 : 0.06) + dragV * dt * 60 * 0.016;
          dragV *= Math.exp(-dt * 2.5);
        }
        ring.rotation.y = spin;
        tilt += (tiltT - tilt) * (1 - Math.exp(-dt * 3));
        const dist = camera.userData.dist as number;
        camera.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist);
        camera.lookAt(0, -0.2, 0);
        forgeMat.uniforms.uShow.value = shown;
        forgeMat.uniforms.uTime.value = t;
        forgeMat.uniforms.uFlash.value = flash;
        forgeMat.uniforms.uDone.value = done;
        forgeMat.uniforms.uWaveA.value = waveA;
        forgeMat.uniforms.uWaveT.value = waveT;
        gpu.begin();
        renderer.render(scene, camera);
        gpu.end();
      };
      // Its shaders compiled in the background before the first frame draws…
      try {
        await renderer.compileAsync(scene, camera);
      } catch {
        /* drawn (and compiled) on its first frame instead */
      }
      if (dead) return;
      // …and one frame drawn now, unseen, so its textures and buffers are on
      // the GPU before it comes into view (its first visible frame cost a
      // phone ~0.7 s at the page's end — mobile QA, §101.9).
      try {
        renderer.render(scene, camera);
      } catch {
        /* nothing to warm */
      }
      raf = requestAnimationFrame(loop);
      if (reduced) fire();

      cleanup = () => {
        unguard();
        gpu.dispose();
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener(THEME_EVENT, paint);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        geo.dispose();
        metal.dispose();
        baked?.dispose();
        envTex?.dispose();
        envScene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as InstanceType<typeof THREE.Material>).dispose();
          }
        });
        links.forEach((L) => L.mat.dispose());
        forgeGeo.dispose();
        forgeMat.dispose();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      if (dead) cleanup();
    })();
    return () => {
      dead = true;
      cleanup();
    };
  }, [near]);

  return (
    <div ref={wrap} className="relative mx-auto w-full touch-pan-y select-none" style={{ height: "clamp(260px, 40vw, 560px)" }}>
      {/* Rays of light that open behind the ring the moment it closes. */}
      <div ref={rays} aria-hidden className="dev-rays" />
      {near && <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />}
      <div className="relative z-10 grid h-full place-items-center px-4">{children}</div>
    </div>
  );
}
