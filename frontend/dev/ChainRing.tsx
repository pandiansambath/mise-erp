"use client";

// The finale's chain, in crystal.
//
//   "this chain also i want in active theory kind style instead of plain
//    chain… like crystal water liquid etc kind of animation"
//
// A ring of real 3D links in iridescent chrome — the same metal as Ember's
// chain — lit by the theme's own colours, with motes of light drifting round
// it like dust in water. Alternate links stand at right angles to their
// neighbours, which is what makes loops read as a chain.
//
// The arrival is unchanged in spirit: as the section scrolls in, the links fly
// in from scattered places, tumbling, and gather into the ring one after
// another — scrubbed by the scroll, so you pull the chain together. When the
// last link closes the ring flashes once, the slogan's words arrive
// (onAssembled), and it starts to turn. The pointer leans it; a drag spins it.
//
// One WebGL canvas behind the words. It only draws while it is on screen,
// eases by time (a slow device still closes the chain), gives its GPU memory
// back on the way out, and stands still — assembled — for reduced motion.

import { useEffect, useRef, type ReactNode } from "react";
import { readRGB, THEME_EVENT } from "./theme";

function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function ChainRing({ children, onAssembled }: { children: ReactNode; onAssembled?: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const assembledCb = useRef(onAssembled);
  useEffect(() => {
    assembledCb.current = onAssembled;
  }, [onAssembled]);

  useEffect(() => {
    const host = wrap.current;
    const el = canvas.current;
    if (!host || !el) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (dead) return;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: !phone, alpha: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone ? 1.5 : 1.75));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
      const pmrem = new THREE.PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

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
      const geo = new THREE.TubeGeometry(new Stadium(0.2, gap * 0.56), phone ? 64 : 96, 0.075, phone ? 10 : 14, true);
      const metal = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.12,
        iridescence: 1,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [140, 1000],
        clearcoat: 1,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.4,
      });
      const ring = new THREE.Group();
      scene.add(ring);
      const rnd = seeded(7);
      type Link = { mesh: InstanceType<typeof THREE.Mesh>; slot: InstanceType<typeof THREE.Vector3>; q: InstanceType<typeof THREE.Quaternion>; from: InstanceType<typeof THREE.Vector3>; spinFrom: InstanceType<typeof THREE.Euler> };
      const links: Link[] = [];
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const mesh = new THREE.Mesh(geo, metal);
        const slot = new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R);
        // Long axis along the ring; every other link stood on its edge.
        const o = new THREE.Object3D();
        o.position.copy(slot);
        o.lookAt(0, 0, 0);
        o.rotateY(Math.PI / 2);
        if (i % 2) o.rotateX(Math.PI / 2);
        const q = o.quaternion.clone();
        const from = new THREE.Vector3((rnd() - 0.5) * 16, (rnd() - 0.5) * 9 - 1.5, (rnd() - 0.5) * 8 + 3);
        const spinFrom = new THREE.Euler((rnd() - 0.5) * 9, (rnd() - 0.5) * 9, (rnd() - 0.5) * 9);
        mesh.position.copy(from);
        ring.add(mesh);
        links.push({ mesh, slot, q, from, spinFrom });
      }

      // Light in the theme's colours, so the chrome carries them.
      const keyA = new THREE.PointLight(0xffffff, 60, 18);
      keyA.position.set(-4, 3, 4);
      const keyB = new THREE.PointLight(0xffffff, 55, 18);
      keyB.position.set(4, 2, -3);
      const under = new THREE.PointLight(0xffffff, 35, 14);
      under.position.set(0, -3, 2);
      scene.add(keyA, keyB, under);

      // Motes drifting round the ring, like dust in water.
      const M = phone ? 160 : 320;
      const mp = new Float32Array(M * 3);
      const ms = new Float32Array(M * 2);
      for (let i = 0; i < M; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = R + (rnd() - 0.5) * 2.2;
        mp[i * 3] = Math.cos(a) * rr;
        mp[i * 3 + 1] = (rnd() - 0.5) * 1.6;
        mp[i * 3 + 2] = Math.sin(a) * rr;
        ms[i * 2] = rnd();
        ms[i * 2 + 1] = rnd();
      }
      const moteGeo = new THREE.BufferGeometry();
      moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
      moteGeo.setAttribute("seed", new THREE.BufferAttribute(ms, 2));
      const moteMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: { value: 0 }, uShow: { value: 0 }, uRatio: { value: renderer.getPixelRatio() }, uA: { value: new THREE.Color(1, 0.7, 0.4) }, uB: { value: new THREE.Color(0.5, 1, 0.9) } },
        vertexShader: /* glsl */ `
          attribute vec2 seed;
          uniform float uTime, uShow, uRatio;
          varying float vS;
          void main() {
            vec3 p = position;
            float a = uTime * (0.05 + seed.x * 0.08);
            p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;
            p.y += sin(uTime * 0.7 + seed.y * 6.283) * 0.15;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (1.4 + seed.y * 3.0) * uRatio * (10.0 / -mv.z) * uShow;
            vS = seed.x;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uA, uB;
          varying float vS;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(mix(uA, uB, vS), smoothstep(0.5, 0.0, d) * 0.8);
          }`,
      });
      ring.add(new THREE.Points(moteGeo, moteMat));

      const paint = () => {
        const c = (role: string, fb: [number, number, number]) => {
          const [r, g, b] = readRGB(host, role, fb);
          return new THREE.Color(r / 255, g / 255, b / 255);
        };
        keyA.color = c("a2", [240, 160, 100]);
        keyB.color = c("b", [45, 212, 191]);
        under.color = c("c", [155, 140, 255]);
        moteMat.uniforms.uA.value = c("gold", [240, 189, 106]);
        moteMat.uniforms.uB.value = c("b2", [125, 240, 220]);
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      const fit = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        // Frame the ring: wide screens see it whole, narrow ones a little closer.
        const dist = camera.aspect < 1.2 ? 15.5 : 11.8;
        camera.userData.dist = dist;
        camera.updateProjectionMatrix();
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(host);

      // The pointer leans the ring; a drag spins it.
      let tilt = 0.42;
      let tiltT = 0.42;
      let dragV = 0;
      let dragging = false;
      let lastX = 0;
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        if (e.pointerType === "mouse") tiltT = 0.3 + ((e.clientY - r.top) / r.height) * 0.3;
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
      let spin = 0;
      let t = 0;
      let last = performance.now();
      let raf = 0;
      const tmpQ = new THREE.Quaternion();
      const tmpE = new THREE.Quaternion();
      const eul = new THREE.Euler();
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.5, (now - last) / 1000);
        last = now;
        if (!visible || document.hidden) return;
        t += dt;
        if (!reduced) shown += (progress() - shown) * (1 - Math.exp(-dt * 5));
        if (shown > 0.985 && !fired) {
          fired = true;
          flash = 1;
          assembledCb.current?.();
        }
        flash *= Math.exp(-dt * 2.4);
        // Each link arrives in its turn and tumbles into place.
        for (let i = 0; i < N; i++) {
          const L = links[i];
          const k = Math.max(0, Math.min(1, (shown - (i / N) * 0.55) / 0.45));
          const e = 1 - Math.pow(1 - k, 3);
          L.mesh.position.lerpVectors(L.from, L.slot, e);
          eul.set(L.spinFrom.x * (1 - e), L.spinFrom.y * (1 - e), L.spinFrom.z * (1 - e));
          tmpE.setFromEuler(eul);
          tmpQ.copy(L.q).multiply(tmpE);
          L.mesh.quaternion.copy(tmpQ);
          L.mesh.scale.setScalar(0.3 + 0.7 * e);
        }
        if (!reduced) {
          spin += dt * (fired ? 0.22 : 0.06) + dragV * dt * 60 * 0.016;
          dragV *= Math.exp(-dt * 2.5);
        }
        ring.rotation.y = spin;
        tilt += (tiltT - tilt) * (1 - Math.exp(-dt * 3));
        const dist = camera.userData.dist as number;
        camera.position.set(0, Math.sin(tilt) * dist, Math.cos(tilt) * dist);
        camera.lookAt(0, -0.2, 0);
        metal.envMapIntensity = 1.4 + flash * 2.6;
        moteMat.uniforms.uTime.value = t;
        moteMat.uniforms.uShow.value = Math.max(0, (shown - 0.6) / 0.4);
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);
      if (reduced) assembledCb.current?.();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener(THEME_EVENT, paint);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointerup", onUp);
        geo.dispose();
        metal.dispose();
        moteGeo.dispose();
        moteMat.dispose();
        scene.environment?.dispose();
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
  }, []);

  return (
    <div ref={wrap} className="relative mx-auto w-full touch-pan-y select-none" style={{ height: "clamp(240px, 38vw, 420px)" }}>
      <canvas ref={canvas} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
      <div className="relative z-10 grid h-full place-items-center px-4">{children}</div>
    </div>
  );
}
