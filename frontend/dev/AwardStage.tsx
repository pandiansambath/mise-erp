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
          // The model ships flat-lit; give it the studio so its bands and
          // gold catch light the way the coin does.
          const mat = m.material as InstanceType<typeof THREE.MeshStandardMaterial>;
          if (mat && "envMapIntensity" in mat) mat.envMapIntensity = 1.6;
        });

        // Order matters, and getting it wrong is what made the chest vanish.
        //
        // Measure FIRST, while the holder is still identity, so every box is
        // in the model's own units. The previous version measured after
        // scaling and then applied the scale a second time to the re-parented
        // halves — so the chest ended up a fraction of its size, somewhere off
        // camera. It was still there, which is why the hammer kept hitting it.
        const holder = new THREE.Group();
        chest.add(holder);
        holder.add(root);

        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3();
        box.getSize(size);

        if (top && base) {
          // A hinge at the lid's own back edge, in model units.
          const tb = new THREE.Box3().setFromObject(top);
          hinge.position.set(0, tb.min.y, tb.min.z);
          holder.add(hinge);
          hinge.add(top);                              // keeps world transform
          top.position.sub(hinge.position);            // …minus the pivot
          holder.add(base);
        }

        // Now, and only now, size it to the frame and stand it on the floor.
        const k = 3.1 / Math.max(size.x, size.y, size.z, 0.001);
        holder.scale.setScalar(k);
        holder.position.set(
          -((box.min.x + box.max.x) / 2) * k,
          -box.min.y * k - 1.15,
          -((box.min.z + box.max.z) / 2) * k,
        );
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
      let camKick = 0;
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

      // Debris that came off something.
      //
      // Identical tetrahedra read as confetti: same shape, same size, same
      // tumble. Wreckage does not look like that. So three kinds — long
      // splinters torn along the grain, chunky iron off the bands, and coins
      // spilling from inside — each with its own mass, so heavy pieces fall
      // fast and hard while light ones hang and flutter.
      type Bit = {
        m: InstanceType<typeof THREE.Mesh>;
        v: InstanceType<typeof THREE.Vector3>;
        s: InstanceType<typeof THREE.Vector3>;
        mass: number;
      };
      const bits: Bit[] = [];
      const coinGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.022, 16);
      for (let i = 0; i < 54; i++) {
        const kind = i < 26 ? "splinter" : i < 42 ? "iron" : "coin";
        let geo: InstanceType<typeof THREE.BoxGeometry> | InstanceType<typeof THREE.CylinderGeometry>;
        let mat: InstanceType<typeof THREE.Material>;
        if (kind === "splinter") {
          geo = new THREE.BoxGeometry(0.06 + Math.random() * 0.09, 0.03, 0.28 + Math.random() * 0.5);
          mat = wood;
        } else if (kind === "iron") {
          geo = new THREE.BoxGeometry(0.1 + Math.random() * 0.12, 0.05, 0.14 + Math.random() * 0.2);
          mat = iron;
        } else {
          geo = coinGeo;
          mat = gold;
        }
        const m = new THREE.Mesh(geo, mat);
        m.visible = false;
        m.castShadow = true;
        scene.add(m);
        bits.push({
          m,
          v: new THREE.Vector3(),
          s: new THREE.Vector3(),
          mass: kind === "iron" ? 1.5 : kind === "coin" ? 1.15 : 0.72,
        });
      }

      // The shockwave, along the ground.
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffd89a, transparent: true, opacity: 0,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.62, 64), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -1.12;
      ring.visible = false;
      scene.add(ring);
      let ringT = 0;

      // Dust thrown up by the blow.
      const dustMat = new THREE.PointsMaterial({
        color: 0xc9ab7e, size: 0.16, transparent: true, opacity: 0,
        depthWrite: false, sizeAttenuation: true,
      });
      const DUST = 140;
      const dustPos = new Float32Array(DUST * 3);
      const dustVel: InstanceType<typeof THREE.Vector3>[] = [];
      for (let i = 0; i < DUST; i++) dustVel.push(new THREE.Vector3());
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
      const dust = new THREE.Points(dustGeo, dustMat);
      dust.visible = false;
      scene.add(dust);
      let dustT = 0;

      // Stars catching on the coin.
      //
      // A bare Point renders as a hard little rectangle — exactly the squares
      // he spotted. A sprite with a four-point twinkle and a soft core makes
      // the same code draw light instead of pixels.
      const starCanvas = document.createElement("canvas");
      starCanvas.width = starCanvas.height = 128;
      {
        const sg = starCanvas.getContext("2d")!;
        const core = sg.createRadialGradient(64, 64, 0, 64, 64, 26);
        core.addColorStop(0, "rgba(255,255,255,1)");
        core.addColorStop(0.35, "rgba(255,236,190,0.75)");
        core.addColorStop(1, "rgba(255,210,130,0)");
        sg.fillStyle = core;
        sg.fillRect(0, 0, 128, 128);
        sg.lineCap = "round";
        // Four spikes: the diffraction cross the eye reads as "sparkle".
        for (const [dx, dy, len, wdt] of [
          [1, 0, 58, 3], [0, 1, 58, 3], [1, 1, 30, 1.4], [1, -1, 30, 1.4],
        ] as const) {
          const grad = sg.createLinearGradient(64 - dx * len, 64 - dy * len, 64 + dx * len, 64 + dy * len);
          grad.addColorStop(0, "rgba(255,246,214,0)");
          grad.addColorStop(0.5, "rgba(255,252,236,0.95)");
          grad.addColorStop(1, "rgba(255,246,214,0)");
          sg.strokeStyle = grad;
          sg.lineWidth = wdt;
          sg.beginPath();
          sg.moveTo(64 - dx * len, 64 - dy * len);
          sg.lineTo(64 + dx * len, 64 + dy * len);
          sg.stroke();
        }
      }
      const starTex = new THREE.CanvasTexture(starCanvas);
      const sparkMat = new THREE.PointsMaterial({
        map: starTex, color: 0xfff2d0, size: 0.19, transparent: true, opacity: 0,
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
            // Everything leaves from where the lid was, and leaves OUTWARD —
            // speed falling off with mass, so iron goes low and hard while
            // splinters are thrown high and turn over as they go.
            for (const b of bits) {
              b.m.visible = true;
              b.m.position.set((Math.random() - 0.5) * 1.5, -0.15 + Math.random() * 0.5, (Math.random() - 0.5) * 0.9);
              const a = Math.random() * Math.PI * 2;
              const out = (0.06 + Math.random() * 0.16) / b.mass;
              b.v.set(Math.cos(a) * out, (0.14 + Math.random() * 0.2) / b.mass, Math.sin(a) * out * 0.7);
              b.s.set(
                (Math.random() - 0.5) * 0.5 / b.mass,
                (Math.random() - 0.5) * 0.5 / b.mass,
                (Math.random() - 0.5) * 0.5 / b.mass,
              );
              b.m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
            }
            ring.visible = true;
            ringT = 0;
            dust.visible = true;
            dustT = 0;
            for (let i = 0; i < DUST; i++) {
              const a = Math.random() * Math.PI * 2;
              const sp = 0.02 + Math.random() * 0.09;
              dustPos[i * 3] = (Math.random() - 0.5) * 0.8;
              dustPos[i * 3 + 1] = -0.6 + Math.random() * 0.5;
              dustPos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
              dustVel[i].set(Math.cos(a) * sp, 0.02 + Math.random() * 0.05, Math.sin(a) * sp);
            }
            camKick = 1;
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
          const sp = sparkPos;
          for (let i = 0; i < SPARKS; i++) {
            // Each one breathes on its own clock, so they twinkle instead of
            // pulsing together like a string of fairy lights.
            const k = 0.9 + Math.sin(t * 3.1 + sparkPhase[i]) * 0.12;
            sp[i * 3 + 2] = Math.sin(t * 1.4 + sparkPhase[i]) * 0.35;
            sparks.scale.setScalar((0.34 + openT * 0.5) * k);
          }
          sparkGeo.attributes.position.needsUpdate = true;

          for (const b of bits) {
            if (!b.m.visible) continue;
            b.v.y -= 0.0075 * b.mass;   // heavy things fall harder
            b.v.multiplyScalar(0.995);  // and the air takes a little back
            b.m.position.add(b.v);
            b.m.rotation.x += b.s.x;
            b.m.rotation.y += b.s.y;
            b.m.rotation.z += b.s.z;
            // The floor. Wreckage that falls through it is wreckage nobody
            // believes — so it bounces, loses most of its energy, and settles.
            if (b.m.position.y < -1.1) {
              b.m.position.y = -1.1;
              if (Math.abs(b.v.y) > 0.012) {
                b.v.y = -b.v.y * 0.36;
                b.v.x *= 0.72;
                b.v.z *= 0.72;
                b.s.multiplyScalar(0.55);
              } else {
                b.v.set(0, 0, 0);
                b.s.set(0, 0, 0);
              }
            }
          }

          if (ring.visible) {
            ringT = Math.min(1, ringT + dt * 1.15);
            ring.scale.setScalar(0.4 + ringT * 7);
            ringMat.opacity = (1 - ringT) * 0.7;
            if (ringT >= 1) ring.visible = false;
          }

          if (dust.visible) {
            dustT = Math.min(1, dustT + dt * 0.42);
            dustMat.opacity = Math.sin(Math.PI * dustT) * 0.4;
            for (let i = 0; i < DUST; i++) {
              dustVel[i].y -= 0.0009;      // rises, hangs, then drops
              dustVel[i].multiplyScalar(0.982);
              dustPos[i * 3] += dustVel[i].x;
              dustPos[i * 3 + 1] += dustVel[i].y;
              dustPos[i * 3 + 2] += dustVel[i].z;
            }
            dustGeo.attributes.position.needsUpdate = true;
            if (dustT >= 1) dust.visible = false;
          }
        }
        // A short kick, not a wobble. The camera is a person flinching at a
        // bang: it recovers in a few frames and then holds perfectly still.
        if (camKick > 0.001) {
          camKick *= 0.86;
          camera.position.x = Math.sin(t * 58) * camKick * 0.13;
        } else camera.position.x = 0;

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
        [wood, iron, gold, faceMat, arcMat, sparkMat, ringMat, dustMat].forEach((m) => m.dispose());
        starTex.dispose();
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
