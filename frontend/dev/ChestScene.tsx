"use client";

// A real 3D chest, and a hammer.
//
// He asked for this twice: "there will be a treasure box and we will break
// that treasure box with hammer — how hard we hitting it will break and show
// the medal", and "css is not impressive… the showcase coin also not 3d".
// Fair. Flat gradients cannot do what light does to metal.
//
// Built in geometry rather than downloaded. Free chest models are mostly
// low-poly game assets — the exact "looks cartoon" problem that got WebGL
// thrown off the landing page once already — and they carry attribution
// terms. What actually sells metal is the LIGHTING, not the mesh: a real
// specular highlight that moves as the object turns is something no texture
// can fake, and that comes free once the scene is lit properly.
//
// three.js is imported inside the effect, so it is code-split: the page still
// loads without a renderer, and the ~150KB only arrives if somebody opens the
// case. A portfolio that takes three seconds to appear has already lost.

import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "sealed" | "broken";

export function ChestScene({ onOpened }: { onOpened?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState(0);
  const [phase, setPhase] = useState<Phase>("sealed");
  // The scene writes here; React never re-renders on a frame.
  const api = useRef<{ hit: (power: number) => void; dispose: () => void } | null>(null);
  const lastHit = useRef(0);

  const strike = useCallback(() => {
    // How hard you hit it: rapid blows land heavier, so hammering fast
    // genuinely breaks it sooner — which is what he described.
    const now = performance.now();
    const gap = now - lastHit.current;
    lastHit.current = now;
    const power = gap < 320 ? 1.6 : gap < 700 ? 1.2 : 1;

    api.current?.hit(power);
    setHits((h) => {
      const next = h + power;
      if (next >= 3 && phase === "sealed") {
        setPhase("broken");
        onOpened?.();
      }
      return next;
    });
  }, [phase, onOpened]);

  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;

    (async () => {
      const THREE = await import("three");
      if (!alive || !mount.current) return;

      const host = mount.current;
      const w = host.clientWidth || 420;
      const h = host.clientHeight || 420;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
      camera.position.set(0, 1.5, 6.2);
      camera.lookAt(0, 0.2, 0);

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(renderer.domElement);

      // ── light ────────────────────────────────────────────────────────────
      // A key, a warm rim and a cool fill. The rim is what draws a bright
      // edge down the side of the gold and stops it reading as a flat shape.
      scene.add(new THREE.AmbientLight(0xffe6c0, 0.35));
      const key = new THREE.DirectionalLight(0xfff0d0, 2.4);
      key.position.set(3, 6, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);
      const rim = new THREE.PointLight(0xffb45c, 22, 18);
      rim.position.set(-3.4, 1.6, -2.4);
      scene.add(rim);
      const fill = new THREE.PointLight(0x6ec6ff, 8, 16);
      fill.position.set(2.6, -1.2, 3);
      scene.add(fill);

      const gold = new THREE.MeshStandardMaterial({
        color: 0xd9a441, metalness: 1, roughness: 0.22,
      });
      const darkGold = new THREE.MeshStandardMaterial({
        color: 0x8a5a22, metalness: 1, roughness: 0.36,
      });
      const wood = new THREE.MeshStandardMaterial({
        color: 0x4a2b10, metalness: 0.15, roughness: 0.75,
      });

      // ── the chest ────────────────────────────────────────────────────────
      const chest = new THREE.Group();
      scene.add(chest);

      const base = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.3, 1.8), wood);
      base.position.y = -0.35;
      base.castShadow = base.receiveShadow = true;
      chest.add(base);

      // Bands across the body — the detail that says "chest" instantly.
      for (const x of [-0.85, 0.85]) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.36, 1.86), darkGold);
        band.position.set(x, -0.35, 0);
        band.castShadow = true;
        chest.add(band);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.16), gold);
      lock.position.set(0, -0.18, 0.94);
      lock.castShadow = true;
      chest.add(lock);

      // The lid, hinged at the BACK edge. Its pivot is an empty group, so the
      // mesh can be offset inside it and still rotate about the hinge.
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.3, -0.9);
      chest.add(hinge);
      const lid = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 1.8), wood);
      lid.position.set(0, 0.12, 0.9);
      lid.castShadow = true;
      hinge.add(lid);
      const lidBand = new THREE.Mesh(new THREE.BoxGeometry(2.68, 0.14, 1.88), darkGold);
      lidBand.position.set(0, 0.36, 0.9);
      hinge.add(lidBand);

      // ── the medal, waiting inside ────────────────────────────────────────
      const medal = new THREE.Group();
      medal.position.set(0, -0.2, 0);
      medal.visible = false;
      scene.add(medal);

      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.78, 0.78, 0.1, 64), gold);
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = true;
      medal.add(disc);
      const rimRing = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.07, 20, 64), darkGold);
      medal.add(rimRing);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.025, 16, 64), gold);
      inner.position.z = 0.055;
      medal.add(inner);

      // ── shards, for when it gives way ────────────────────────────────────
      const shards: { mesh: InstanceType<typeof THREE.Mesh>; vel: InstanceType<typeof THREE.Vector3>; spin: InstanceType<typeof THREE.Vector3> }[] = [];
      for (let i = 0; i < 26; i++) {
        const s = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.1 + Math.random() * 0.16),
          i % 3 === 0 ? darkGold : wood,
        );
        s.visible = false;
        s.castShadow = true;
        scene.add(s);
        shards.push({
          mesh: s,
          vel: new THREE.Vector3(),
          spin: new THREE.Vector3(),
        });
      }

      // ── state the loop reads ─────────────────────────────────────────────
      let shake = 0;
      let damage = 0;
      let opened = false;
      let openT = 0;

      const burst = () => {
        opened = true;
        for (const s of shards) {
          s.mesh.visible = true;
          s.mesh.position.set((Math.random() - 0.5) * 2.2, 0.1, (Math.random() - 0.5) * 1.4);
          s.vel.set((Math.random() - 0.5) * 0.14, 0.09 + Math.random() * 0.13, (Math.random() - 0.5) * 0.14);
          s.spin.set(Math.random() * 0.2, Math.random() * 0.2, Math.random() * 0.2);
        }
        medal.visible = true;
      };

      api.current = {
        hit: (power) => {
          shake = 0.42 * power;
          damage += power;
          // Each blow leaves the lid a little more askew — visible progress,
          // so you can see it giving before it goes.
          hinge.rotation.x = -Math.min(0.34, damage * 0.1);
          if (damage >= 3 && !opened) burst();
        },
        dispose: () => {},
      };

      let raf = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = clock.getDelta();
        const t = clock.getElapsedTime();

        if (shake > 0.001) {
          // Decaying jolt, on the CHEST only — the camera stays still,
          // because shaking the camera reads as an earthquake, not a blow.
          chest.position.x = Math.sin(t * 70) * shake * 0.22;
          chest.position.y = Math.sin(t * 90) * shake * 0.1;
          chest.rotation.z = Math.sin(t * 60) * shake * 0.05;
          shake *= 0.86;
        } else {
          chest.position.set(0, 0, 0);
          chest.rotation.z = 0;
        }

        if (!opened) {
          chest.rotation.y = Math.sin(t * 0.4) * 0.16;
        } else {
          openT = Math.min(1, openT + dt * 0.9);
          hinge.rotation.x = -0.34 - openT * 1.9;
          chest.position.y = -openT * 2.4;
          chest.rotation.y += dt * 0.2;

          medal.position.y = -0.2 + openT * 1.1;
          medal.rotation.y += dt * 1.1;
          medal.scale.setScalar(0.4 + openT * 0.75);

          for (const s of shards) {
            if (!s.mesh.visible) continue;
            s.vel.y -= 0.0055; // gravity
            s.mesh.position.add(s.vel);
            s.mesh.rotation.x += s.spin.x;
            s.mesh.rotation.y += s.spin.y;
            if (s.mesh.position.y < -3) s.mesh.visible = false;
          }
        }

        renderer.render(scene, camera);
      };
      tick();

      const onResize = () => {
        const nw = host.clientWidth || 420;
        const nh = host.clientHeight || 420;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        renderer.dispose();
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (m.geometry) m.geometry.dispose();
        });
        gold.dispose();
        darkGold.dispose();
        wood.dispose();
        host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);

  return (
    <div className="relative">
      <div
        ref={mount}
        onClick={phase === "sealed" ? strike : undefined}
        className={`mx-auto h-[22rem] w-full max-w-md ${
          phase === "sealed" ? "cursor-[url(/dev/hammer.svg)_16_16,pointer]" : ""
        }`}
      />
      {phase === "sealed" && (
        <p className="mt-1 animate-pulse font-mono text-[10px] tracking-[0.3em] text-[#c08a4e]">
          {hits === 0 ? "HIT IT" : hits < 2 ? "AGAIN — IT IS GIVING" : "ONE MORE"}
        </p>
      )}
    </div>
  );
}
