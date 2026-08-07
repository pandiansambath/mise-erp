"use client";

// A chest, a hammer, and lightning.
//
// His brief: "when we hit with hammer we need a Thor effect — if he hits,
// lightning will spread across… with sound effects… a best UI/UX animation".
//
// Everything here is built or synthesised, nothing downloaded: geometry for
// the chest, a canvas for the wood and for the engraving, WebAudio for the
// impact. What sells it is not polygon count — it is that the light, the
// sound and the motion all arrive on the SAME frame as the blow. A hit that
// only moves the mesh feels like a click; a hit that flashes the room, cracks
// in your ears and shoves the object feels like a hit.
//
// three.js is imported inside the effect, so none of it reaches anybody who
// does not open the case.

import { useCallback, useEffect, useRef, useState } from "react";
import { medalFace, playBreak, playHit, woodTexture } from "./chestBits";

export function ChestScene({ onOpened }: { onOpened?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  const api = useRef<{ hit: (power: number) => void } | null>(null);
  const last = useRef(0);

  const strike = useCallback(() => {
    if (done) return;
    // Blows landed quickly count for more, so hammering hard genuinely
    // breaks it sooner — the part he actually asked for.
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

      const size = () => ({ w: host.clientWidth || 360, h: host.clientHeight || 360 });
      const { w, h } = size();

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
      const place = () => {
        // Pull back on a narrow screen, or the chest runs off the sides.
        const narrow = host.clientWidth < 420;
        camera.position.set(0, narrow ? 2.0 : 1.7, narrow ? 8.4 : 6.6);
        camera.lookAt(0, 0.1, 0);
      };
      place();

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      host.appendChild(renderer.domElement);

      // ── light ──────────────────────────────────────────────────────────
      scene.add(new THREE.AmbientLight(0xffe6c0, 0.4));
      const key = new THREE.DirectionalLight(0xfff0d0, 2.6);
      key.position.set(3.5, 6, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      scene.add(key);
      const rim = new THREE.PointLight(0xffb45c, 26, 20);
      rim.position.set(-3.6, 1.8, -2.6);
      scene.add(rim);
      // The storm light: dark until a blow lands, then it screams.
      const bolt = new THREE.PointLight(0x9fd4ff, 0, 26);
      bolt.position.set(0, 2.6, 1.6);
      scene.add(bolt);

      // ── materials ──────────────────────────────────────────────────────
      const woodTex = new THREE.CanvasTexture(woodTexture());
      woodTex.wrapS = woodTex.wrapT = THREE.RepeatWrapping;
      const wood = new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.82, metalness: 0.06 });
      const iron = new THREE.MeshStandardMaterial({ color: 0x6b5433, metalness: 1, roughness: 0.38 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.18 });

      // ── chest ──────────────────────────────────────────────────────────
      const chest = new THREE.Group();
      scene.add(chest);

      const body = new THREE.Mesh(new THREE.BoxGeometry(2.7, 1.35, 1.85), wood);
      body.position.y = -0.4;
      body.castShadow = body.receiveShadow = true;
      chest.add(body);

      // Iron straps and corner brackets — what stops it reading as a crate.
      for (const x of [-0.92, 0.92]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.42, 1.92), iron);
        strap.position.set(x, -0.4, 0);
        strap.castShadow = true;
        chest.add(strap);
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const corner = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.4, 0.16), iron);
          corner.position.set(sx * 1.33, -0.4, sz * 0.91);
          chest.add(corner);
        }
      }
      // Rivets.
      for (let i = 0; i < 12; i++) {
        const r = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 10), iron);
        r.position.set(-1.2 + (i % 6) * 0.48, i < 6 ? 0.14 : -0.92, 0.94);
        chest.add(r);
      }
      const lock = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.52, 0.14), gold);
      lock.position.set(0, -0.2, 0.96);
      lock.castShadow = true;
      chest.add(lock);
      const keyhole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12), iron);
      keyhole.rotation.x = Math.PI / 2;
      keyhole.position.set(0, -0.2, 1.03);
      chest.add(keyhole);

      // The lid is a HALF CYLINDER, not a slab — a domed lid is the single
      // strongest cue that this is a treasure chest and not a box.
      const hinge = new THREE.Group();
      hinge.position.set(0, 0.27, -0.92);
      chest.add(hinge);
      const dome = new THREE.Mesh(
        new THREE.CylinderGeometry(0.92, 0.92, 2.7, 28, 1, false, 0, Math.PI),
        wood,
      );
      dome.rotation.z = Math.PI / 2;
      dome.position.set(0, 0, 0.92);
      dome.castShadow = true;
      hinge.add(dome);
      for (const x of [-0.92, 0.92]) {
        const band = new THREE.Mesh(
          new THREE.TorusGeometry(0.93, 0.055, 10, 24, Math.PI),
          iron,
        );
        band.rotation.y = Math.PI / 2;
        band.position.set(x, 0, 0.92);
        hinge.add(band);
      }

      // ── the medal, engraved ────────────────────────────────────────────
      const faceTex = new THREE.CanvasTexture(medalFace());
      const face = new THREE.MeshStandardMaterial({ map: faceTex, metalness: 0.95, roughness: 0.22 });
      const medal = new THREE.Group();
      medal.position.set(0, -0.3, 0);
      medal.visible = false;
      scene.add(medal);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.11, 64), [gold, face, face]);
      disc.rotation.x = Math.PI / 2;
      disc.castShadow = true;
      medal.add(disc);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.075, 20, 64), gold);
      medal.add(ring);

      // ── the hammer ─────────────────────────────────────────────────────
      const hammer = new THREE.Group();
      hammer.position.set(2.1, 2.5, 1.4);
      hammer.rotation.z = -0.5;
      scene.add(hammer);
      const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.7, 16), wood);
      haft.position.y = -0.75;
      haft.castShadow = true;
      hammer.add(haft);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.42), iron);
      head.castShadow = true;
      hammer.add(head);
      const collar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.46, 0.46), gold);
      collar.position.x = -0.34;
      hammer.add(collar);

      // ── lightning ──────────────────────────────────────────────────────
      // Jagged polylines struck outward from the point of impact. Rebuilt on
      // every blow, because a bolt that repeats is a decoration.
      const arcs: InstanceType<typeof THREE.Line>[] = [];
      const arcMat = new THREE.LineBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0 });
      for (let i = 0; i < 9; i++) {
        const geo = new THREE.BufferGeometry().setFromPoints(
          Array.from({ length: 9 }, () => new THREE.Vector3()),
        );
        const line = new THREE.Line(geo, arcMat);
        line.visible = false;
        scene.add(line);
        arcs.push(line);
      }
      const strikeArcs = () => {
        arcs.forEach((line, i) => {
          const a = (i / arcs.length) * Math.PI * 2 + Math.random();
          const pts: InstanceType<typeof THREE.Vector3>[] = [];
          let p = new THREE.Vector3(0, 0.3, 0.9);
          for (let k = 0; k < 9; k++) {
            pts.push(p.clone());
            p = p.clone().add(
              new THREE.Vector3(
                Math.cos(a) * 0.42 + (Math.random() - 0.5) * 0.5,
                Math.sin(a) * 0.42 + (Math.random() - 0.5) * 0.5,
                (Math.random() - 0.5) * 0.3,
              ),
            );
          }
          line.geometry.setFromPoints(pts);
          line.visible = true;
        });
        arcMat.opacity = 1;
      };

      // ── loop state ─────────────────────────────────────────────────────
      let shake = 0;
      let flash = 0;
      let damage = 0;
      let opened = false;
      let openT = 0;
      let swing = 0;

      const shards: { m: InstanceType<typeof THREE.Mesh>; v: InstanceType<typeof THREE.Vector3>; s: InstanceType<typeof THREE.Vector3> }[] = [];
      for (let i = 0; i < 30; i++) {
        const m = new THREE.Mesh(
          new THREE.TetrahedronGeometry(0.1 + Math.random() * 0.18),
          i % 4 === 0 ? iron : wood,
        );
        m.visible = false;
        m.castShadow = true;
        scene.add(m);
        shards.push({ m, v: new THREE.Vector3(), s: new THREE.Vector3() });
      }

      const burst = () => {
        opened = true;
        playBreak();
        for (const s of shards) {
          s.m.visible = true;
          s.m.position.set((Math.random() - 0.5) * 2.4, 0, (Math.random() - 0.5) * 1.5);
          s.v.set((Math.random() - 0.5) * 0.16, 0.1 + Math.random() * 0.15, (Math.random() - 0.5) * 0.16);
          s.s.set(Math.random() * 0.24, Math.random() * 0.24, Math.random() * 0.24);
        }
        medal.visible = true;
      };

      api.current = {
        hit: (power) => {
          if (opened) return;
          playHit(power);
          shake = 0.5 * power;
          flash = 1;
          swing = 1;
          damage += power;
          hinge.rotation.x = -Math.min(0.4, damage * 0.11);
          strikeArcs();
          if (damage >= 3.4) burst();
        },
      };

      let raf = 0;
      const clock = new THREE.Clock();
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.getElapsedTime();

        // The hammer falls, then lifts back out of shot.
        if (swing > 0.001) {
          swing = Math.max(0, swing - dt * 3.4);
          const s = 1 - swing;
          hammer.position.set(2.1 - s * 1.5, 2.5 - s * 1.9, 1.4 - s * 0.3);
          hammer.rotation.z = -0.5 + s * 1.5;
          hammer.visible = true;
        } else {
          hammer.visible = false;
        }

        if (flash > 0.001) {
          flash *= 0.82;
          bolt.intensity = flash * 90;
          arcMat.opacity = flash;
          if (flash < 0.08) arcs.forEach((a) => (a.visible = false));
        } else {
          bolt.intensity = 0;
        }

        if (shake > 0.001) {
          chest.position.x = Math.sin(t * 74) * shake * 0.22;
          chest.position.y = Math.sin(t * 96) * shake * 0.1;
          chest.rotation.z = Math.sin(t * 62) * shake * 0.05;
          shake *= 0.85;
        } else {
          chest.position.set(0, 0, 0);
          chest.rotation.z = 0;
        }

        if (!opened) {
          chest.rotation.y = Math.sin(t * 0.35) * 0.14;
        } else {
          openT = Math.min(1, openT + dt * 0.85);
          hinge.rotation.x = -0.4 - openT * 1.9;
          chest.position.y = -openT * 2.6;
          chest.rotation.y += dt * 0.25;

          medal.position.y = -0.3 + openT * 1.15;
          medal.rotation.y += dt * 1.15;
          medal.scale.setScalar(0.35 + openT * 0.85);

          for (const s of shards) {
            if (!s.m.visible) continue;
            s.v.y -= 0.006;
            s.m.position.add(s.v);
            s.m.rotation.x += s.s.x;
            s.m.rotation.y += s.s.y;
            if (s.m.position.y < -3.4) s.m.visible = false;
          }
        }

        renderer.render(scene, camera);
      };
      tick();

      const onResize = () => {
        const n = size();
        camera.aspect = n.w / n.h;
        place();
        camera.updateProjectionMatrix();
        renderer.setSize(n.w, n.h);
      };
      window.addEventListener("resize", onResize);

      cleanup = () => {
        cancelAnimationFrame(raf);
        window.removeEventListener("resize", onResize);
        scene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (m.geometry) m.geometry.dispose();
        });
        [wood, iron, gold, face, arcMat].forEach((m) => m.dispose());
        woodTex.dispose();
        faceTex.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
    };
  }, []);

  return (
    <div className="relative select-none">
      <div
        ref={mount}
        onPointerDown={strike}
        // Touch has no cursor, so the prompt below carries the instruction on
        // a phone. `touch-none` stops a tap being read as the start of a drag.
        className={`mx-auto h-[17rem] w-full max-w-md touch-none sm:h-[22rem] ${
          done ? "" : "cursor-[url(/dev/hammer.svg)_18_18,pointer]"
        }`}
      />
      {!done && (
        <p className="mt-1 font-mono text-[10px] tracking-[0.3em] text-[#c08a4e]">
          {hits === 0 ? "STRIKE IT" : hits < 2 ? "AGAIN" : "IT IS GIVING…"}
        </p>
      )}
    </div>
  );
}
