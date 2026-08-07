"use client";

// The award, on its own screen.
//
// A chest in the middle of a glowing room. Hit it until it breaks, and a
// glowing gold coin is inside. One screen, no scrolling, nothing hidden.
//
// The camera is positioned THE MOMENT it is created, before anything is
// measured. That is not a detail — the previous version only positioned it
// once a resize measurement succeeded, so when the measurement came back
// empty the camera sat at the origin, INSIDE the chest, and you got a
// screenful of plank. A safe view first, refined after.

import { useCallback, useEffect, useRef, useState } from "react";
import { coinFace, playBreak, playHit, primeSounds, studioEnv, woodTexture } from "./chestBits";

export function AwardStage({ onOpened }: { onOpened?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  const api = useRef<{ hit: (p: number) => void } | null>(null);
  const last = useRef(0);

  const strike = useCallback(() => {
    if (done) return;
    primeSounds(); // first gesture: browsers allow audio from here on
    const now = performance.now();
    const gap = now - last.current;
    last.current = now;
    const power = gap < 300 ? 1.7 : gap < 650 ? 1.25 : 1;
    api.current?.hit(power);
    setHits((h) => {
      const next = h + power;
      if (next >= 3.4) {
        setDone(true);
        onOpened?.();
      }
      return next;
    });
  }, [done, onOpened]);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import("three");
      if (!alive || !mount.current) return;
      const host = mount.current;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
      // Positioned NOW. Whatever happens with measurement, the view is sane.
      camera.position.set(0, 1.15, 7.4);
      camera.lookAt(0, -0.15, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
      host.appendChild(renderer.domElement);

      // ── light ─────────────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0xffe0b0, 0.5));
      const key = new THREE.DirectionalLight(0xfff2d8, 2.8);
      key.position.set(4, 7, 5);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);
      const warm = new THREE.PointLight(0xffa848, 34, 24);
      warm.position.set(-4, 2, -3);
      scene.add(warm);
      const storm = new THREE.PointLight(0xaadcff, 0, 30);
      storm.position.set(0, 2.4, 2);
      scene.add(storm);
      // The glow the coin sits in once it is out.
      const halo = new THREE.PointLight(0xffcf7a, 0, 14);
      halo.position.set(0, 0.6, 1.6);
      scene.add(halo);

      // Give the metal a room to reflect. Without this a metalness:1 surface
      // renders nearly black and has to be faked with emissive — which is
      // exactly why the coin read as flat yellow plastic.
      const envTex = new THREE.CanvasTexture(studioEnv());
      envTex.mapping = THREE.EquirectangularReflectionMapping;
      envTex.colorSpace = THREE.SRGBColorSpace;
      scene.environment = envTex;

      const woodTex = new THREE.CanvasTexture(woodTexture());
      const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.8, metalness: 0.05 });
      const iron = new THREE.MeshStandardMaterial({ color: 0x5c4a2e, metalness: 1, roughness: 0.4 });
      // Low roughness so the reflection stays a sharp highlight rather than a
      // smear, and envMapIntensity above 1 so the studio reads hot on the rim.
      const gold = new THREE.MeshStandardMaterial({
        color: 0xffcf76, metalness: 1, roughness: 0.09, envMapIntensity: 2.1,
      });

      // ── chest ─────────────────────────────────────────────────────────
      // A real pirate chest, not a box I built. CC0 from Poly Pizza (see
      // public/dev/models/CREDITS.md) and chosen because its lid is a
      // SEPARATE node — `Chest_Top` beside `Chest_Base` — which is what
      // lets it be hinged and thrown open. A chest welded into one mesh
      // would have had to be faked.
      const chest = new THREE.Group();
      scene.add(chest);
      const hinge = new THREE.Group();
      chest.add(hinge);

      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync("/dev/models/chest.glb").catch(() => null);
      if (!alive) return;
      if (gltf) {
        const root = gltf.scene;
        const base = root.getObjectByName("Chest_Base");
        const top = root.getObjectByName("Chest_Top");

        root.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (!m.isMesh) return;
          m.castShadow = m.receiveShadow = true;
          // The model ships flat-lit materials; give them the studio so the
          // metal bands and gold catch light like the coin does.
          const mat = m.material as InstanceType<typeof THREE.MeshStandardMaterial>;
          if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 1.5;
        });

        // Sit it on the floor of the shot and scale it to the frame the
        // camera was set up for, whatever units the artist worked in.
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);
        const k = 2.6 / Math.max(size.x, 0.001);
        root.scale.setScalar(k);

        if (top && base) {
          // Re-parent the lid onto a hinge at its own back edge.
          const tb = new THREE.Box3().setFromObject(top);
          hinge.position.set(0, tb.min.y * k, tb.min.z * k);
          top.position.multiplyScalar(1);
          hinge.add(top);
          top.position.sub(new THREE.Vector3(0, tb.min.y, tb.min.z));
          chest.add(base);
          base.scale.setScalar(k);
          top.scale.setScalar(k);
        } else {
          chest.add(root);
        }
        const after = new THREE.Box3().setFromObject(chest);
        chest.position.y -= after.min.y + 1.1;
      }

      // ── the coin ──────────────────────────────────────────────────────
      const faceTex = new THREE.CanvasTexture(coinFace());
      faceTex.anisotropy = 8; // the lettering is read at an angle; without
      faceTex.colorSpace = THREE.SRGBColorSpace; // this it smears as it turns
      const faceMat = new THREE.MeshStandardMaterial({
        map: faceTex, metalness: 0.94, roughness: 0.16, envMapIntensity: 1.9,
        emissiveMap: faceTex, emissive: 0xffffff, emissiveIntensity: 0,
      });
      const coin = new THREE.Group();
      coin.position.set(0, -0.3, 0);
      coin.visible = false;
      scene.add(coin);
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.1, 72), gold);
      edge.rotation.x = Math.PI / 2;
      edge.castShadow = true;
      coin.add(edge);
      for (const side of [1, -1]) {
        const f = new THREE.Mesh(new THREE.CircleGeometry(0.8, 72), faceMat);
        f.position.z = side * 0.051;
        if (side === -1) f.rotation.y = Math.PI;
        coin.add(f);
      }

      // ── hammer ────────────────────────────────────────────────────────
      const hammer = new THREE.Group();
      hammer.visible = false;
      scene.add(hammer);
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 1.6, 16), wood);
      haft.position.y = -0.72;
      hammer.add(haft);
      hammer.add(new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.4, 0.4), iron));
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.44, 0.44), gold);
      collar.position.x = -0.32;
      hammer.add(collar);

      // ── lightning ─────────────────────────────────────────────────────
      const arcMat = new THREE.LineBasicMaterial({ color: 0xcfeaff, transparent: true, opacity: 0 });
      const arcs: InstanceType<typeof THREE.Line>[] = [];
      for (let i = 0; i < 12; i++) {
        const g = new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 10 }, () => new THREE.Vector3()),
        );
        const l = new THREE.Line(g, arcMat);
        l.visible = false;
        scene.add(l);
        arcs.push(l);
      }
      let big = false;
      const throwArcs = () => {
        const reach = big ? 1.05 : 0.45;
        arcs.forEach((l, i) => {
          const a = (i / arcs.length) * Math.PI * 2 + Math.random();
          const pts: InstanceType<typeof THREE.Vector3>[] = [];
          let p = new THREE.Vector3(0, 0.25, 0.9);
          for (let k = 0; k < 10; k++) {
            pts.push(p.clone());
            p = p.clone().add(new THREE.Vector3(
              Math.cos(a) * reach + (Math.random() - 0.5) * 0.6,
              Math.sin(a) * reach + (Math.random() - 0.5) * 0.6,
              (Math.random() - 0.5) * 0.35,
            ));
          }
          l.geometry.setFromPoints(pts);
          l.visible = true;
        });
        arcMat.opacity = 1;
      };

      const shards: { m: InstanceType<typeof THREE.Mesh>; v: InstanceType<typeof THREE.Vector3>; s: InstanceType<typeof THREE.Vector3> }[] = [];
      for (let i = 0; i < 32; i++) {
        const m = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.09 + Math.random() * 0.18),
          i % 4 === 0 ? iron : wood,
        );
        m.visible = false;
        scene.add(m);
        shards.push({ m, v: new THREE.Vector3(), s: new THREE.Vector3() });
      }

      // Sparks catching on the coin. Tiny additive points that pop and fade
      // at their own rates — a glint reads as light on metal only if the
      // glints are not in step with each other.
      const sparkMat = new THREE.PointsMaterial({
        color: 0xfff0c0, size: 0.075, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
      });
      const SPARKS = 90;
      const sparkPos = new Float32Array(SPARKS * 3);
      const sparkPhase = new Float32Array(SPARKS);
      for (let i = 0; i < SPARKS; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 0.55 + Math.random() * 0.9;
        sparkPos[i * 3] = Math.cos(a) * r;
        sparkPos[i * 3 + 1] = Math.sin(a) * r * 0.9;
        sparkPos[i * 3 + 2] = (Math.random() - 0.5) * 0.7;
        sparkPhase[i] = Math.random() * Math.PI * 2;
      }
      const sparkGeo = new THREE.BufferGeometry();
      sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
      const sparks = new THREE.Points(sparkGeo, sparkMat);
      sparks.visible = false;
      scene.add(sparks);

      let shake = 0, flash = 0, damage = 0, swing = 0, openT = 0;
      let opened = false;

      api.current = {
        hit: (power) => {
          if (opened) return;
          playHit(power);
          shake = 0.5 * power;
          flash = 1;
          swing = 1;
          damage += power;
          hinge.rotation.x = -Math.min(0.4, damage * 0.11);
          throwArcs();
          if (damage >= 3.4) {
            opened = true;
            big = true;
            flash = 2;
            throwArcs();
            playBreak();
            for (const s of shards) {
              s.m.visible = true;
              s.m.position.set((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 1.5);
              s.v.set((Math.random() - 0.5) * 0.17, 0.1 + Math.random() * 0.16, (Math.random() - 0.5) * 0.17);
              s.s.set(Math.random() * 0.25, Math.random() * 0.25, Math.random() * 0.25);
            }
            coin.visible = true;
            sparks.visible = true;
          }
        },
      };

      let raf = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.getElapsedTime();

        if (swing > 0.001) {
          swing = Math.max(0, swing - dt * 3.6);
          const s = 1 - swing;
          hammer.visible = true;
          hammer.position.set(2.2 - s * 1.6, 2.6 - s * 2.0, 1.5 - s * 0.4);
          hammer.rotation.z = -0.55 + s * 1.55;
        } else hammer.visible = false;

        if (flash > 0.001) {
          flash *= 0.83;
          storm.intensity = flash * 110;
          arcMat.opacity = Math.min(1, flash);
          if (flash < 0.07) arcs.forEach((a) => (a.visible = false));
        } else storm.intensity = 0;

        if (shake > 0.001) {
          chest.position.x = Math.sin(t * 76) * shake * 0.22;
          chest.position.y = Math.sin(t * 98) * shake * 0.1;
          shake *= 0.85;
        } else chest.position.set(0, 0, 0);

        if (!opened) {
          chest.rotation.y = Math.sin(t * 0.32) * 0.13;
        } else {
          openT = Math.min(1, openT + dt * 0.8);
          hinge.rotation.x = -0.4 - openT * 1.9;
          chest.position.y = -openT * 3;
          coin.position.y = -0.3 + openT * 0.95;
          coin.position.z = openT * 1.5;
          coin.scale.setScalar(0.34 + openT * 0.5);
          coin.rotation.y += dt * (3.4 - openT * 2.6);
          // It lights up as it comes: gold that emits reads as gold in a
          // spotlight, which is what "super shining" actually looks like.
          // A whisper of glow only. The shine should come from the
          // reflection; emissive past this point flattens the engraving.
          faceMat.emissiveIntensity = openT * 0.1;
          halo.intensity = openT * 26;

          sparks.position.copy(coin.position);
          sparks.scale.setScalar(0.34 + openT * 0.5);
          sparkMat.opacity = openT * 0.9;
          const sp = sparkGeo.attributes.position.array as Float32Array;
          for (let i = 0; i < SPARKS; i++) {
            // Each one breathes on its own clock, so they twinkle instead of
            // pulsing together like a string of fairy lights.
            const k = 0.9 + Math.sin(t * 3.1 + sparkPhase[i]) * 0.12;
            sp[i * 3 + 2] = Math.sin(t * 1.4 + sparkPhase[i]) * 0.35;
            sparks.scale.setScalar((0.34 + openT * 0.5) * k);
          }
          sparkGeo.attributes.position.needsUpdate = true;

          for (const s of shards) {
            if (!s.m.visible) continue;
            s.v.y -= 0.006;
            s.m.position.add(s.v);
            s.m.rotation.x += s.s.x;
            s.m.rotation.y += s.s.y;
            if (s.m.position.y < -3.6) s.m.visible = false;
          }
        }
        renderer.render(scene, camera);
      };
      tick();

      const fit = () => {
        const w = host.clientWidth, h = host.clientHeight;
        if (w < 2 || h < 2) return;
        camera.aspect = w / h;
        // Far enough back for the chest's height AND its width at this shape.
        const vf = (camera.fov * Math.PI) / 180;
        const forH = 1.9 / Math.tan(vf / 2);
        const forW = 1.8 / Math.tan(vf / 2) / Math.max(0.4, w / h);
        if (!opened) camera.position.set(0, 1.15, Math.max(forH, forW) * 1.2);
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      };
      const ro = new ResizeObserver(fit);
      ro.observe(host);
      fit();

      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (m.geometry) m.geometry.dispose();
        });
        [wood, iron, gold, faceMat, arcMat, sparkMat].forEach((m) => m.dispose());
        envTex.dispose();
        woodTex.dispose();
        faceTex.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => { alive = false; cleanup?.(); };
  }, []);

  return (
    <div className="absolute inset-0">
      <div
        ref={mount}
        onPointerDown={strike}
        className={`h-full w-full touch-none ${done ? "" : "cursor-[url(/dev/hammer.svg)_18_18,pointer]"}`}
      />
      {!done && (
        <p className="pointer-events-none absolute inset-x-0 bottom-24 text-center font-mono text-[11px] tracking-[0.34em] text-[#e0a95c] sm:bottom-28">
          {hits === 0 ? "STRIKE THE CHEST" : hits < 2 ? "AGAIN" : "IT IS BREAKING…"}
        </p>
      )}
    </div>
  );
}
