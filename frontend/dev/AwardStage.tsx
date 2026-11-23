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
import { CHEST_GLTF, FLOOR_TEX, HAMMER_GLTF } from "./awardFiles";
import { coinFace, playBreak, playClank, playClink, playHit, primeSounds, unlockSound } from "./chestBits";
import { claimContext, guardCanvas } from "./glGuard";
import { pixelRatio, watchGpu } from "./sharp";

export function AwardStage({ onOpened }: { onOpened?: () => void }) {
  const mount = useRef<HTMLDivElement>(null);
  const [hits, setHits] = useState(0);
  const [done, setDone] = useState(false);
  // Nothing is shown until the whole scene is ready — chest, coin, light —
  // and drawn once: "box not loading then loaded then the glow not loading
  // then the coin not loading". Blows before that are ignored, not queued.
  const [ready, setReady] = useState(false);
  // WebGL can be missing or blocked (Brave's shields can do this). His
  // screenshot showed exactly that: the glow, and no chest. Then the medal is
  // shown without the chest, rather than an empty room.
  const [noGL, setNoGL] = useState(false);
  // The scene's one handle: a blow of this power, aimed at this point of the
  // canvas (-1..1); false if the hammer could not take it (mid-swing, broken).
  const api = useRef<{ hit: (p: number, nx?: number, ny?: number) => boolean } | null>(null);
  const last = useRef(0);

  // Told AFTER the render that opened it. It used to be called from inside a
  // state updater, which updates the page while this component is still
  // rendering — React logs that as an error.
  useEffect(() => {
    if (done || noGL) onOpened?.();
  }, [done, noGL, onOpened]);

  const strike = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (done || !ready) return;
    unlockSound(); // the gesture browsers require; the audio is already decoded
    const now = performance.now();
    const gap = now - last.current;
    const power = gap < 300 ? 1.7 : gap < 650 ? 1.25 : 1;
    // The hammer lands where the tap did.
    const r = e.currentTarget.getBoundingClientRect();
    const ok = api.current?.hit(power, ((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    if (!ok) return;
    last.current = now;
    setHits((h) => {
      const next = h + power;
      if (next >= 3.4) setDone(true);
      return next;
    });
  }, [done, ready]);

  // Fetch and decode the audio the moment the scene mounts, so the first
  // blow plays from memory instead of starting a download.
  // Arriving from the profile page by a click, the page already has the user's
  // gesture, so the audio can wake now rather than on the first blow (whose
  // sound used to wait for it). The intro screen decoded the sounds already.
  useEffect(() => {
    void primeSounds();
    unlockSound();
  }, []);

  // The room, built REAL (§102.1: "currently somewhat I can feel it's
  // literally a cartoon kind of feel… make it more and more realistic… with
  // no delay to sound hitting and animation"). Everything that read as a
  // cartoon is gone — the low-poly stylised chest, the box-and-stick hammer,
  // the 1-px lightning lines, the flat painted rays, the box splinters — for:
  //   · a photo-scanned chest and an antique cross-pein hammer (Poly Haven,
  //     CC0: real colour, normal and roughness maps), in a studio's light
  //     (RoomEnvironment through PMREM), warm key and cool rim, soft shadows
  //     and a contact shadow so it stands on the floor; seen three-quarters;
  //   · the hammer waits, raised, over the chest (on a desktop it follows
  //     where you point); a tap swings it down on an arc from the hand, onto
  //     the very spot you tapped, in 75 ms — and the blow's sound is scheduled
  //     on the audio clock to be heard on that frame (the speakers' own
  //     latency taken off): hot spark streaks off the iron, a puff of wood
  //     dust, the sparks' own small light, a dent left in the wood, the chest
  //     jolting, the hammer stopped dead for an instant and thrown back up;
  //   · the last blow: the lock snaps off and falls, clanking where it lands;
  //     the lid bursts open on its hinge with an overshoot; the gold piled
  //     inside lights up, coins leap out, bounce and settle on the stone; light
  //     pours out in a beam with dust drifting through it; his coin rises out
  //     of the glow with real relief in its engraving;
  //   · all of it on a real stone floor (Poly Haven, CC0), fading to dark.
  useEffect(() => {
    let alive = true;
    let cleanup: (() => void) | undefined;
    // Its context is claimed first, so the card pool makes room (a phone).
    const unclaim = claimContext();

    (async () => {
      // A frame or two for the pool to give a canvas back.
      await new Promise((r) => setTimeout(r, 120));
      const THREE = await import("three");
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
      const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
      if (!alive || !mount.current) return;
      const host = mount.current;
      const phone = window.matchMedia("(max-width: 767px)").matches;
      const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
      type V3 = InstanceType<typeof THREE.Vector3>;
      type Mesh = InstanceType<typeof THREE.Mesh>;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
      // Positioned NOW. Whatever happens with measurement, the view is sane.
      camera.position.set(0, 1.05, 7.2);
      const look = new THREE.Vector3(0, -0.35, 0);
      camera.lookAt(look);

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
      } catch {
        setNoGL(true);
        return;
      }
      // Taken away by the browser (a phone's few contexts): hide, never white.
      const unguard = guardCanvas(renderer.domElement);
      renderer.setPixelRatio(pixelRatio("award", phone));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.VSMShadowMap;
      renderer.shadowMap.autoUpdate = !phone;
      renderer.shadowMap.needsUpdate = true;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.style.cssText = "display:block;width:100%;height:100%;opacity:0;transition:opacity .8s ease";
      host.appendChild(renderer.domElement);
      const bail = () => {
        unguard();
        renderer.dispose();
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };

      // A real room to reflect — soft studio panels — kept low, so the key
      // light models the wood rather than a flat white wash.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
      scene.environment = envRT.texture;
      scene.environmentIntensity = 0.36;

      // ── light ─────────────────────────────────────────────────────────
      const key = new THREE.DirectionalLight(0xffd3a0, 2.7);
      key.position.set(3.4, 6.4, 4.6);
      key.castShadow = true;
      // A phone: a smaller shadow, refreshed every second frame (its blur is
      // most of what the room costs the GPU, and a soft shadow hides both).
      key.shadow.mapSize.set(phone ? 512 : 2048, phone ? 512 : 2048);
      Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 22 });
      key.shadow.radius = phone ? 5 : 10;
      key.shadow.blurSamples = phone ? 8 : 16;
      key.shadow.bias = -0.0006;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x9fc4ff, 1.8);
      rim.position.set(-4.2, 3.2, -5);
      scene.add(rim);
      scene.add(new THREE.HemisphereLight(0xbccbff, 0x2b1d11, 0.28));
      // The gold inside, waiting.
      const inner = new THREE.PointLight(0xffb24a, 0, 8, 2);
      scene.add(inner);
      // The flash where a blow lands.
      const flashL = new THREE.PointLight(0xffa85c, 0, 2.6, 2);
      scene.add(flashL);

      // The floor: only its shadow, and a soft contact shadow right under the
      // chest, so it STANDS rather than floats.
      const FLOOR_Y = -1.15;
      // Stone: lit, shadowed, catching the gold; fading into the dark all round.
      const fadeTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 256;
        const g = c.getContext("2d")!;
        const gr = g.createRadialGradient(128, 128, 10, 128, 128, 128);
        gr.addColorStop(0, "#fff");
        gr.addColorStop(0.35, "#cfcfcf");
        gr.addColorStop(0.7, "#3a3a3a");
        gr.addColorStop(1, "#000");
        g.fillStyle = gr;
        g.fillRect(0, 0, 256, 256);
        return new THREE.CanvasTexture(c);
      })();
      const floorMat = new THREE.MeshStandardMaterial({ color: 0x7d6b56, roughness: 1, metalness: 0, transparent: true, alphaMap: fadeTex, depthWrite: false });
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(11, 11), floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.renderOrder = -2;
      floor.position.y = FLOOR_Y;
      floor.receiveShadow = true;
      scene.add(floor);
      const soft = (inner0: string, w = 256) => {
        const c = document.createElement("canvas");
        c.width = c.height = w;
        const g = c.getContext("2d")!;
        const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
        gr.addColorStop(0, inner0);
        gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr;
        g.fillRect(0, 0, w, w);
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      };
      const contactTex = soft("rgba(0,0,0,0.9)");
      const contactMat = new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, opacity: 0.8 });
      const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMat);
      contact.renderOrder = -1;
      contact.rotation.x = -Math.PI / 2;
      contact.position.y = FLOOR_Y + 0.003;
      scene.add(contact);

      // ── the chest and the hammer (Poly Haven, CC0) ─────────────────────
      const loader = new GLTFLoader();
      const pictures = new THREE.TextureLoader();
      const [chestG, hammerG, fDiff, fNor, fArm] = await Promise.all([
        loader.loadAsync(CHEST_GLTF).catch(() => null),
        loader.loadAsync(HAMMER_GLTF).catch(() => null),
        pictures.loadAsync(FLOOR_TEX.diff).catch(() => null),
        pictures.loadAsync(FLOOR_TEX.nor).catch(() => null),
        pictures.loadAsync(FLOOR_TEX.arm).catch(() => null),
      ]);
      const aniso = renderer.capabilities.getMaxAnisotropy();
      for (const tx of [fDiff, fNor, fArm]) {
        if (!tx) continue;
        tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
        tx.repeat.set(1.7, 1.7);
        tx.rotation = 0.12;
        tx.anisotropy = Math.min(8, aniso);
      }
      if (fDiff) fDiff.colorSpace = THREE.SRGBColorSpace;
      Object.assign(floorMat, { map: fDiff, normalMap: fNor, roughnessMap: fArm, aoMap: fArm });
      floorMat.needsUpdate = true;
      if (!alive) {
        bail();
        return;
      }
      if (!chestG) {
        bail();
        setNoGL(true);
        return;
      }
      const chest = new THREE.Group();
      // Three-quarters on: its side shows, so it reads as a solid thing.
      const YAW = -0.32;
      chest.rotation.y = YAW;
      scene.add(chest);
      const root = chestG.scene;
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      const lid = root.getObjectByName("treasure_chest_lid");
      const lock = root.getObjectByName("treasure_chest_lock");
      // Measure in the model's own units, then size it to the frame.
      const box = new THREE.Box3().setFromObject(root);
      const size = box.getSize(new THREE.Vector3());
      const centre = box.getCenter(new THREE.Vector3());
      const k = 2.7 / Math.max(size.x, 0.001);
      // How far the lock's back is behind its origin (it comes to rest on it).
      let lockBack = 0;
      if (lock) {
        const lb = new THREE.Box3().setFromObject(lock);
        lockBack = (lock.getWorldPosition(new THREE.Vector3()).z - lb.min.z) * k;
      }
      root.scale.setScalar(k);
      root.position.set(-centre.x * k, FLOOR_Y - box.min.y * k, -centre.z * k);
      chest.add(root);
      const W = size.x * k;
      const H = size.y * k;
      const D = size.z * k;
      const TOP = FLOOR_Y + H;
      chest.updateMatrixWorld(true);
      const RIM = lid ? lid.getWorldPosition(new THREE.Vector3()).y : FLOOR_Y + H * 0.62;
      contact.scale.set(W * 1.3, D * 1.55, 1);
      inner.position.set(0, TOP - 0.25 * H, 0);
      // What a blow is aimed at: a plain box round the chest (twelve
      // triangles, not the scan's hundred thousand), turned with it.
      const proxy = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshBasicMaterial({ visible: false }));
      proxy.position.set(0, FLOOR_Y + H / 2, 0);
      chest.add(proxy);
      // By default a blow lands on the front of the lid, right of the lock.
      const homeLocal = new THREE.Vector3(0.22 * W, TOP - 0.1 * H, D * 0.5);
      const ray = new THREE.Raycaster();
      const ndc = new THREE.Vector2();
      const toCam = new THREE.Vector3();
      const aimAt = (nx: number | undefined, ny: number | undefined, outP: V3, outN: V3) => {
        chest.updateMatrixWorld(true);
        if (nx !== undefined && ny !== undefined) {
          ray.setFromCamera(ndc.set(nx, ny), camera);
          const hit = ray.intersectObject(proxy, false)[0];
          if (hit?.face) {
            outP.copy(hit.point);
            outN.copy(hit.face.normal).transformDirection(proxy.matrixWorld);
            if (outN.dot(toCam.copy(camera.position).sub(outP)) < 0) outN.negate();
            // A blow on the top lands on the lid's curve, not above it.
            if (outN.y > 0.7) outP.y -= H * 0.03;
            return;
          }
        }
        outP.copy(homeLocal).applyMatrix4(chest.matrixWorld);
        outN.set(0, 0, 1).transformDirection(chest.matrixWorld);
      };
      // Aimed (the target) and as the hammer follows it (smoothed).
      const tgt = new THREE.Vector3();
      const tgtN = new THREE.Vector3();
      aimAt(undefined, undefined, tgt, tgtN);
      const cur = tgt.clone();
      const curN = tgtN.clone();

      // The hammer: built so the head's centre is at its origin, the handle
      // runs down -Y and the head lies along X.
      const hammer = new THREE.Group();
      hammer.visible = false;
      scene.add(hammer);
      let headHalf = 0.1;
      let grip = 1;
      if (hammerG) {
        const h = hammerG.scene;
        h.traverse((o) => {
          const m = o as Mesh;
          if (m.isMesh) m.castShadow = true;
        });
        const hb = new THREE.Box3().setFromObject(h);
        const hs = hb.getSize(new THREE.Vector3());
        const axes = ["x", "y", "z"] as const;
        const axis = axes.reduce((a, b) => (hs[b] > hs[a] ? b : a));
        const [o1, o2] = axes.filter((a) => a !== axis);
        const headAxis = hs[o1] >= hs[o2] ? o1 : o2;
        const thin = Math.min(hs[o1], hs[o2]);
        // Which end carries the head: the end whose cross-section is wider.
        const lo = hb.min[axis];
        const hi = hb.max[axis];
        let spreadLo = 0;
        let spreadHi = 0;
        h.updateMatrixWorld(true);
        const tmp = new THREE.Vector3();
        const c0 = hb.getCenter(new THREE.Vector3());
        h.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const pos = m.geometry.getAttribute("position");
          for (let i = 0; i < pos.count; i += 3) {
            tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
            const along = (tmp[axis] - lo) / Math.max(1e-6, hi - lo);
            const across = Math.abs(tmp[headAxis] - c0[headAxis]);
            if (along < 0.15) spreadLo = Math.max(spreadLo, across);
            if (along > 0.85) spreadHi = Math.max(spreadHi, across);
          }
        });
        const headAtHi = spreadHi >= spreadLo;
        const len = phone ? 1.6 : 1.5;
        const kh = len / hs[axis];
        h.scale.setScalar(kh);
        headHalf = (hs[headAxis] / 2) * kh;
        grip = len * 0.86;
        const headC = c0.clone();
        headC[axis] = headAtHi ? hi - thin / 2 : lo + thin / 2;
        const holder = new THREE.Group();
        holder.add(h);
        h.position.copy(headC).multiplyScalar(-kh);
        const down = new THREE.Vector3();
        down[axis] = headAtHi ? -1 : 1;
        holder.quaternion.setFromUnitVectors(down, new THREE.Vector3(0, -1, 0));
        const headDir = new THREE.Vector3();
        headDir[headAxis] = 1;
        headDir.applyQuaternion(holder.quaternion);
        holder.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(headDir.z, headDir.x)));
        hammer.add(holder);
        hammer.visible = true;
      }
      // Its swing: about the hand, on an arc. θ = 0 is the head on the chest;
      // θ > 0 lifts it back off the surface.
      const SWING = hammerG ? 0.075 : 0;
      const READY = 0.82;
      const contactPos = new THREE.Vector3();
      const contactQ = new THREE.Quaternion();
      const hand = new THREE.Vector3();
      const hinge = new THREE.Vector3();
      const ax = new THREE.Vector3();
      const ay = new THREE.Vector3();
      const az = new THREE.Vector3();
      const basis = new THREE.Matrix4();
      const aimPose = () => {
        // As if you held it: the handle runs from your hand — towards you, a
        // little right and low — to the spot; the head square to the handle,
        // driving down and into the surface.
        ay.copy(camera.position).sub(cur).normalize().multiplyScalar(0.8);
        ay.x += 0.56;
        ay.y -= 0.36;
        ay.normalize().negate();
        ax.copy(curN).multiplyScalar(-0.7);
        ax.y -= 0.75;
        ax.addScaledVector(ay, -ax.dot(ay)).normalize();
        az.crossVectors(ax, ay).normalize();
        contactQ.setFromRotationMatrix(basis.makeBasis(ax, ay, az));
        contactPos.copy(cur).addScaledVector(ax, -headHalf);
        hand.copy(contactPos).addScaledVector(ay, -grip);
        hinge.copy(az);
      };
      const qa = new THREE.Quaternion();
      const placeHammer = (theta: number) => {
        qa.setFromAxisAngle(hinge, theta);
        hammer.position.copy(contactPos).sub(hand).applyQuaternion(qa).add(hand);
        hammer.quaternion.copy(qa).multiply(contactQ);
      };
      const hold = { theta: READY, vel: 0, phase: "ready" as "ready" | "swing" | "recoil", t: 0, from: READY, stop: 0 };
      let pending = { power: 1, breaks: false };
      let away = 0;
      // Where the pointer is over the chest (a desktop): the hammer follows.
      const hover = { x: 0, y: 0, dirty: false };
      const onMove = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        hover.x = ((e.clientX - r.left) / r.width) * 2 - 1;
        hover.y = -(((e.clientY - r.top) / r.height) * 2 - 1);
        hover.dirty = true;
      };
      if (fine) host.addEventListener("pointermove", onMove);

      // ── the coin ──────────────────────────────────────────────────────
      const faceCanvas = coinFace();
      const faceTex = new THREE.CanvasTexture(faceCanvas);
      faceTex.anisotropy = 8;
      faceTex.colorSpace = THREE.SRGBColorSpace;
      // Relief from the engraving itself: a normal map made from its light
      // and dark (a Sobel pass over the face), so the letters stand up.
      const normalTex = (() => {
        const w = faceCanvas.width;
        const src = faceCanvas.getContext("2d")!.getImageData(0, 0, w, w).data;
        const out = document.createElement("canvas");
        out.width = out.height = w;
        const og = out.getContext("2d")!;
        const img = og.createImageData(w, w);
        const L = (x: number, y: number) => {
          const i = (Math.min(w - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4;
          return (src[i] + src[i + 1] + src[i + 2]) / 765;
        };
        for (let y = 0; y < w; y++) {
          for (let x = 0; x < w; x++) {
            const dx = (L(x + 1, y - 1) + 2 * L(x + 1, y) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x - 1, y) - L(x - 1, y + 1)) * 2.2;
            const dy = (L(x - 1, y + 1) + 2 * L(x, y + 1) + L(x + 1, y + 1) - L(x - 1, y - 1) - 2 * L(x, y - 1) - L(x + 1, y - 1)) * 2.2;
            const inv = 1 / Math.hypot(dx, dy, 1);
            const i = (y * w + x) * 4;
            img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
            img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
            img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
            img.data[i + 3] = 255;
          }
        }
        og.putImageData(img, 0, 0);
        return new THREE.CanvasTexture(out);
      })();
      const faceMat = new THREE.MeshStandardMaterial({ map: faceTex, normalMap: normalTex, normalScale: new THREE.Vector2(1.1, 1.1), metalness: 1, roughness: 0.24, envMap: envRT.texture, envMapIntensity: 1.15 });
      const gold = new THREE.MeshStandardMaterial({ color: 0xffcf76, metalness: 1, roughness: 0.16, envMap: envRT.texture, envMapIntensity: 1.2 });

      // ── the gold inside: a heaped mound, coins lying all over it, and the
      // ones that leap out when it opens ───────────────────────────────────
      const pileMat = new THREE.MeshStandardMaterial({ color: 0xe0a648, metalness: 1, roughness: 0.34, envMap: envRT.texture, envMapIntensity: 0.75 });
      const pile = new THREE.Group();
      chest.add(pile);
      const PX = W * 0.41;
      const PZ = D * 0.37;
      const heap = (x: number, z: number) => RIM - 0.2 + 0.2 * Math.max(0, 1 - (x / PX) ** 2) * Math.max(0, 1 - (z / PZ) ** 2) + Math.sin(x * 9.1 + z * 4.3) * 0.012 + Math.sin(z * 11.7 - x * 5.2) * 0.012;
      const moundGeo = new THREE.PlaneGeometry(PX * 2, PZ * 2, 36, 18);
      moundGeo.rotateX(-Math.PI / 2);
      const mp = moundGeo.getAttribute("position");
      for (let i = 0; i < mp.count; i++) mp.setY(i, heap(mp.getX(i), mp.getZ(i)) - 0.02);
      moundGeo.computeVertexNormals();
      const mound = new THREE.Mesh(moundGeo, pileMat);
      mound.receiveShadow = true;
      pile.add(mound);
      const coinMat = new THREE.MeshStandardMaterial({ color: 0xe2a336, metalness: 1, roughness: 0.3, envMap: envRT.texture, envMapIntensity: 0.8 });
      const coinGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.012, 26);
      const LYING = phone ? 190 : 340;
      const lying = new THREE.InstancedMesh(coinGeo, coinMat, LYING);
      const o3 = new THREE.Object3D();
      for (let i = 0; i < LYING; i++) {
        const x = (Math.random() * 2 - 1) * PX * 0.95;
        const z = (Math.random() * 2 - 1) * PZ * 0.93;
        o3.position.set(x, heap(x, z) + Math.random() * 0.02, z);
        o3.rotation.set((Math.random() - 0.5) * 0.9, Math.random() * 6.28, (Math.random() - 0.5) * 0.9);
        o3.updateMatrix();
        lying.setMatrixAt(i, o3.matrix);
      }
      lying.receiveShadow = true;
      pile.add(lying);
      const LEAP = phone ? 10 : 16;
      const leaping = new THREE.InstancedMesh(coinGeo, coinMat, LEAP);
      leaping.castShadow = true;
      leaping.frustumCulled = false;
      leaping.visible = false;
      scene.add(leaping);
      const leap = Array.from({ length: LEAP }, () => ({
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        q: new THREE.Quaternion(),
        w: new THREE.Vector3(),
        flat: new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.06, Math.random() * 6.28, 0)),
        n: 0,
        rest: false,
      }));
      const spinQ = new THREE.Quaternion();
      const spinE = new THREE.Euler();

      // ── the marks a blow leaves in the wood ─────────────────────────────
      const dentTex = (() => {
        const c = document.createElement("canvas");
        c.width = c.height = 128;
        const g = c.getContext("2d")!;
        const r0 = g.createRadialGradient(64, 64, 4, 64, 64, 58);
        r0.addColorStop(0, "rgba(16,8,4,.92)");
        r0.addColorStop(0.32, "rgba(28,15,8,.72)");
        r0.addColorStop(0.62, "rgba(40,22,12,.28)");
        r0.addColorStop(1, "rgba(40,22,12,0)");
        g.fillStyle = r0;
        g.fillRect(0, 0, 128, 128);
        // Fibres torn along the grain: pale new wood, and the cracks between.
        for (let i = 0; i < 34; i++) {
          const y = 64 + (Math.random() - 0.5) * 62;
          const len = (1 - Math.abs(y - 64) / 46) * (14 + Math.random() * 40);
          const x = 64 + (Math.random() - 0.5) * 26;
          g.strokeStyle = Math.random() < 0.45 ? `rgba(226,178,126,${0.35 + Math.random() * 0.4})` : `rgba(8,4,2,${0.5 + Math.random() * 0.4})`;
          g.lineWidth = 0.6 + Math.random() * 1.5;
          g.beginPath();
          g.moveTo(x - len, y + (Math.random() - 0.5) * 4);
          g.quadraticCurveTo(x, y + (Math.random() - 0.5) * 5, x + len, y + (Math.random() - 0.5) * 4);
          g.stroke();
        }
        const t = new THREE.CanvasTexture(c);
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })();
      const dentMat = new THREE.MeshStandardMaterial({ map: dentTex, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const dentGeo = new THREE.PlaneGeometry(1, 1);
      const dent = (at: V3, nrm: V3, power: number) => {
        const m = new THREE.Mesh(dentGeo, dentMat);
        m.position.copy(at).addScaledVector(nrm, 0.012);
        m.lookAt(at.clone().addScaledVector(nrm, 1));
        // Along the grain, give or take.
        m.rotateZ((Math.random() - 0.5) * 0.3);
        m.scale.set(0.3 * (0.85 + power * 0.25), 0.2 * (0.85 + power * 0.25), 1);
        scene.add(m);
        // It belongs to what it marked: the lid swings away with its dents.
        (at.y > RIM && lid ? lid : root).attach(m);
      };
      const coin = new THREE.Group();
      coin.visible = false;
      scene.add(coin);
      const edge = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.1, 96), gold);
      edge.rotation.x = Math.PI / 2;
      edge.castShadow = true;
      coin.add(edge);
      for (const side of [1, -1]) {
        const f = new THREE.Mesh(new THREE.CircleGeometry(0.8, 96), faceMat);
        f.position.z = side * 0.051;
        if (side === -1) f.rotation.y = Math.PI;
        coin.add(f);
      }
      const glowTex = soft("rgba(255,214,140,0.85)");
      const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false });
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(3.2);
      scene.add(glow);

      // ── the light that pours out: a beam, and dust drifting through it ──
      const beamMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: { uOpen: { value: 0 }, uTime: { value: 0 }, uC: { value: new THREE.Color(1, 0.76, 0.4) } },
        vertexShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main() {
            vUv = uv;
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uOpen, uTime; uniform vec3 uC;
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main() {
            float h = vUv.y;
            float face = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
            float shafts = 0.7 + 0.3 * sin(vUv.x * 40.0 + uTime * 0.6) * sin(vUv.x * 17.0 - uTime * 0.4);
            float a = pow(1.0 - h, 1.6) * face * shafts * uOpen * 0.4;
            gl_FragColor = vec4(uC * a, a);
          }`,
      });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(W * 0.6, W * 0.34, 3.4, 48, 1, true), beamMat);
      beam.position.set(0, TOP + 1.7, 0);
      beam.visible = false;
      scene.add(beam);
      const MOTES = phone ? 70 : 140;
      const motePos = new Float32Array(MOTES * 3);
      const moteSeed = new Float32Array(MOTES * 3);
      for (let i = 0; i < moteSeed.length; i++) moteSeed[i] = Math.random();
      const moteGeo = new THREE.BufferGeometry();
      moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
      const moteTex = soft("rgba(255,236,190,1)", 64);
      const moteMat = new THREE.PointsMaterial({ map: moteTex, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xffd38a });
      const motes = new THREE.Points(moteGeo, moteMat);
      motes.visible = false;
      scene.add(motes);

      // The air: a little dust always hanging in the light.
      const AIR = phone ? 40 : 80;
      const airPos = new Float32Array(AIR * 3);
      const airSeed = Float32Array.from({ length: AIR * 4 }, () => Math.random());
      const airGeo = new THREE.BufferGeometry();
      airGeo.setAttribute("position", new THREE.BufferAttribute(airPos, 3));
      const airMat = new THREE.PointsMaterial({ map: moteTex, size: 0.026, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.4, color: 0xffd9a8 });
      const air = new THREE.Points(airGeo, airMat);
      air.frustumCulled = false;
      scene.add(air);

      // ── a blow: hot spark streaks (a bright head and its tail), a puff of
      // wood dust — thrown off the surface the hammer struck ──────────────
      const SP = 96;
      const spPos = new Float32Array(SP * 6);
      const spHeat = new Float32Array(SP * 2);
      const hdPos = new Float32Array(SP * 3);
      const hdHeat = new Float32Array(SP);
      const spVel: V3[] = Array.from({ length: SP }, () => new THREE.Vector3());
      const spP: V3[] = Array.from({ length: SP }, () => new THREE.Vector3());
      const spLife = new Float32Array(SP);
      let spNext = 0;
      const spGeo = new THREE.BufferGeometry();
      spGeo.setAttribute("position", new THREE.BufferAttribute(spPos, 3));
      spGeo.setAttribute("heat", new THREE.BufferAttribute(spHeat, 1));
      const sparkFrag = /* glsl */ `varying float vH;
          void main() { vec3 c = mix(vec3(1.0, 0.36, 0.06), vec3(1.0, 0.95, 0.82), vH * vH); gl_FragColor = vec4(c * vH * 1.5, vH); }`;
      const spMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `attribute float heat; varying float vH;
          void main() { vH = heat; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: sparkFrag,
      });
      const sparks = new THREE.LineSegments(spGeo, spMat);
      sparks.frustumCulled = false;
      scene.add(sparks);
      const hdGeo = new THREE.BufferGeometry();
      hdGeo.setAttribute("position", new THREE.BufferAttribute(hdPos, 3));
      hdGeo.setAttribute("heat", new THREE.BufferAttribute(hdHeat, 1));
      const hdMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uFocal: { value: 1000 } },
        vertexShader: /* glsl */ `attribute float heat; uniform float uFocal; varying float vH;
          void main() {
            vH = heat;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = (0.014 + 0.026 * heat) * uFocal / -mv.z;
          }`,
        fragmentShader: /* glsl */ `varying float vH;
          void main() {
            float m = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
            vec3 c = mix(vec3(1.0, 0.4, 0.08), vec3(1.0, 0.97, 0.88), vH * vH);
            gl_FragColor = vec4(c * m * vH * 1.7, m * vH);
          }`,
      });
      const heads = new THREE.Points(hdGeo, hdMat);
      heads.frustumCulled = false;
      scene.add(heads);
      const PUFF = 64;
      const puffPos = new Float32Array(PUFF * 3);
      const puffVel: V3[] = Array.from({ length: PUFF }, () => new THREE.Vector3());
      const puffGeo = new THREE.BufferGeometry();
      puffGeo.setAttribute("position", new THREE.BufferAttribute(puffPos, 3));
      const puffTex = soft("rgba(255,255,255,0.5)", 64);
      const puffMat = new THREE.PointsMaterial({ map: puffTex, size: 0.22, transparent: true, depthWrite: false, opacity: 0, color: 0xb99f80 });
      const puff = new THREE.Points(puffGeo, puffMat);
      puff.frustumCulled = false;
      scene.add(puff);
      let puffT = 1;
      const rnd = new THREE.Vector3();
      const throwSparks = (n: number, power: number, at: V3, nrm: V3) => {
        for (let j = 0; j < n; j++) {
          const i = spNext;
          spNext = (spNext + 1) % SP;
          spP[i].copy(at);
          rnd.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          spVel[i].copy(rnd).multiplyScalar(0.9).add(nrm).normalize().multiplyScalar((2.2 + Math.random() * 3) * power);
          spVel[i].y += 1.3 * power;
          spLife[i] = 0.6 + Math.random() * 0.45;
        }
      };
      const throwPuff = (at: V3, nrm: V3) => {
        puffT = 0;
        for (let i = 0; i < PUFF; i++) {
          puffPos[i * 3] = at.x + (Math.random() - 0.5) * 0.2;
          puffPos[i * 3 + 1] = at.y + (Math.random() - 0.5) * 0.12;
          puffPos[i * 3 + 2] = at.z + (Math.random() - 0.5) * 0.2;
          rnd.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
          puffVel[i].copy(rnd).multiplyScalar(0.5).addScaledVector(nrm, 0.35).multiplyScalar(0.6 + Math.random() * 0.8);
          puffVel[i].y += 0.2;
        }
        puffGeo.attributes.position.needsUpdate = true;
      };

      // ── state ─────────────────────────────────────────────────────────
      let opened = false;
      let broken = false;
      let flash = 0;
      let damage = 0;
      let openT = 0;
      // Springs: the chest's jolt (along the blow), the lid.
      const jolt = { x: 0, vx: 0, r: 0, vr: 0 };
      const joltDir = new THREE.Vector3(0, 0, 1);
      const lidS = { a: 0, v: 0, target: 0 };
      // The lock, once it has snapped off.
      const lockS = { on: false, v: new THREE.Vector3(), w: new THREE.Vector3(), bounces: 0 };
      const lockFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.5 + Math.random() * 0.8));
      let camKick = 0;

      // The moment the hammer lands (its sound was scheduled for this frame).
      const land = (power: number, breaks: boolean) => {
        // (A mark, so the sound can be measured against it.)
        performance.mark("award-land");
        flash = Math.min(1.4, 0.8 + power * 0.3);
        joltDir.copy(curN);
        jolt.vx -= 1.6 * power;
        jolt.vr += 0.9 * power * (Math.random() < 0.5 ? -1 : 1);
        // The lid jumps on its hinge and drops back.
        lidS.v -= 2.6 * power;
        throwSparks(Math.round(16 + power * 12), 0.8 + power * 0.25, cur, curN);
        throwPuff(cur, curN);
        dent(cur, curN, power);
        camKick = 0.25 * power;
        if (!breaks) return;
        opened = true;
        flash = 2.6;
        camKick = 0.9;
        leaping.visible = true;
        for (const c of leap) {
          c.p.set((Math.random() - 0.5) * PX * 1.1, RIM + 0.05 + Math.random() * 0.1, (Math.random() - 0.2) * PZ * 0.8);
          c.v.set((Math.random() - 0.5) * 2.6, 2.6 + Math.random() * 1.5, 0.75 + Math.random() * 0.65);
          c.w.set((Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22);
          c.q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
        }
        throwSparks(44, 1.4, cur, curN);
        // The lock snaps off and is thrown out to one side, down to the floor.
        if (lock) {
          scene.attach(lock);
          lockS.on = true;
          const side = Math.random() < 0.5 ? -1 : 1;
          lockS.v.set(side * (0.9 + Math.random() * 0.6), 1.5, 0.6 + Math.random() * 0.35);
          lockS.w.set(4 + Math.random() * 4, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8);
        }
        // The lid bursts open (a spring with an overshoot).
        lidS.target = -1.95;
        lidS.v = -9;
        coin.visible = true;
        coin.position.set(0, TOP - 0.4, 0);
        coin.scale.setScalar(0.34);
        beam.visible = true;
        motes.visible = true;
      };

      api.current = {
        hit: (power, nx, ny) => {
          if (broken || hold.phase === "swing") return false;
          const breaks = damage + power >= 3.4;
          damage += power;
          broken = breaks;
          // Aimed at the spot tapped (or the lid's front), straight away.
          aimAt(nx, ny, tgt, tgtN);
          cur.copy(tgt);
          curN.copy(tgtN);
          // Its sound, scheduled on the audio clock to be heard as it lands.
          playHit(power, SWING);
          if (breaks) playBreak(SWING);
          if (SWING === 0) {
            land(power, breaks);
            return true;
          }
          // The hammer swings from wherever it is.
          hold.phase = "swing";
          hold.t = 0;
          hold.from = Math.max(0.4, hold.theta);
          pending = { power, breaks };
          return true;
        },
      };

      let raf = 0;
      let shown = false;
      const clock = new THREE.Clock();
      const camBase = new THREE.Vector3();
      let camOpen = 8;
      let frameNo = 0;
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        const t = clock.getElapsedTime();

        // The chest's jolt (a damped spring: a few quick shakes, then
        // still), its slow sway while it waits.
        jolt.vx += (-jolt.x * 520 - jolt.vx * 16) * dt;
        jolt.x += jolt.vx * dt;
        jolt.vr += (-jolt.r * 420 - jolt.vr * 14) * dt;
        jolt.r += jolt.vr * dt;
        chest.position.copy(joltDir).multiplyScalar(jolt.x * 0.04);
        chest.position.y = 0;
        chest.rotation.y = YAW + (opened ? 0 : Math.sin(t * 0.3) * 0.06) + jolt.r * 0.03;

        // The hammer: raised and waiting, aimed where you point (smoothly);
        // on a blow, down onto the chest in SWING seconds, thrown back up.
        if (hammerG) {
          if (hover.dirty && hold.phase === "ready" && !broken) {
            hover.dirty = false;
            aimAt(hover.x, hover.y, tgt, tgtN);
          }
          if (hold.phase === "ready" && !broken) {
            if (!fine) aimAt(undefined, undefined, tgt, tgtN);
            const f = 1 - Math.exp(-dt * 9);
            cur.lerp(tgt, f);
            curN.lerp(tgtN, f).normalize();
          }
          aimPose();
          if (hold.phase === "swing") {
            hold.t += dt;
            const u = Math.min(1, hold.t / SWING);
            hold.theta = hold.from * (1 - u * u);
            if (u >= 1) {
              hold.phase = "recoil";
              hold.theta = 0;
              hold.vel = 8 + 3 * pending.power;
              // Dead stop for a blink: that is what gives a blow its weight.
              hold.stop = 0.04;
              land(pending.power, pending.breaks);
            }
          } else if (hold.phase === "recoil" && hold.stop > 0) {
            hold.stop -= dt;
          } else if (hold.phase === "recoil") {
            const goal = opened ? READY * 1.5 : READY;
            hold.vel += (-(hold.theta - goal) * 130 - hold.vel * 15) * dt;
            hold.theta += hold.vel * dt;
            if (Math.abs(hold.theta - goal) < 0.01 && Math.abs(hold.vel) < 0.05) hold.phase = "ready";
          } else hold.theta = READY + Math.sin(t * 1.7) * 0.035;
          placeHammer(hold.theta);
          // Once it is open, the hammer is done: down and away, out of frame.
          if (opened) {
            away = Math.min(1, away + dt * 0.8);
            hammer.position.x += away * away * 3;
            hammer.position.y -= away * away * 3.5;
            hammer.visible = away < 1;
          }
        }

        // The flash where it landed.
        flash *= Math.exp(-dt * 16);
        flashL.position.copy(cur).addScaledVector(curN, 0.35);
        flashL.intensity = flash * 5.5;

        // The lid on its hinge.
        lidS.v += ((lidS.target - lidS.a) * (opened ? 55 : 260) - lidS.v * (opened ? 6.5 : 16)) * dt;
        lidS.a += lidS.v * dt;
        if (!opened) lidS.a = Math.max(-0.16, Math.min(0, lidS.a));
        if (lid) lid.rotation.x = lidS.a;

        // The lock, falling, bouncing, coming to rest.
        if (lock && lockS.on) {
          lockS.v.y -= 9.8 * dt;
          lock.position.addScaledVector(lockS.v, dt);
          lock.rotation.x += lockS.w.x * dt;
          lock.rotation.y += lockS.w.y * dt;
          lock.rotation.z += lockS.w.z * dt;
          if (lockS.bounces > 0) lock.quaternion.slerp(lockFlat, 1 - Math.exp(-dt * 7));
          if (lock.position.y < FLOOR_Y + lockBack) {
            lock.position.y = FLOOR_Y + lockBack;
            if (Math.abs(lockS.v.y) > 0.8 && lockS.bounces < 4) {
              playClank(Math.min(1.4, Math.abs(lockS.v.y) / 3));
              lockS.v.y = -lockS.v.y * 0.32;
              lockS.v.x *= 0.6;
              lockS.v.z *= 0.6;
              lockS.w.multiplyScalar(0.45);
              lockS.bounces++;
            } else {
              lockS.v.set(0, 0, 0);
              lockS.w.multiplyScalar(0.9);
            }
          }
        }

        // The coins that leapt out: thrown, spinning, bouncing on the stone,
        // each bounce heard, then lying down flat.
        if (opened) {
          for (let i = 0; i < LEAP; i++) {
            const c = leap[i];
            if (!c.rest) {
              c.v.y -= 9.8 * dt;
              c.p.addScaledVector(c.v, dt);
              spinE.set(c.w.x * dt, c.w.y * dt, c.w.z * dt);
              c.q.multiply(spinQ.setFromEuler(spinE));
              const floorAt = FLOOR_Y + (c.n > 2 ? 0.009 : 0.04);
              if (c.p.y < floorAt) {
                c.p.y = floorAt;
                if (Math.abs(c.v.y) > 0.45 && c.n < 5) {
                  if (c.n < 3) playClink(Math.min(1.3, Math.abs(c.v.y) / 4));
                  c.v.y = -c.v.y * (0.36 + Math.random() * 0.1);
                  c.v.x = c.v.x * 0.62 + (Math.random() - 0.5) * 0.3;
                  c.v.z = c.v.z * 0.62 + (Math.random() - 0.5) * 0.3;
                  c.w.multiplyScalar(0.55);
                  c.n++;
                } else {
                  c.n = 9;
                  c.v.set(c.v.x * 0.86, 0, c.v.z * 0.86);
                  c.w.multiplyScalar(0.8);
                  c.q.slerp(c.flat, 1 - Math.exp(-dt * 11));
                  if (c.v.lengthSq() < 0.0004 && c.q.angleTo(c.flat) < 0.02) c.rest = true;
                }
              } else if (c.n > 1) c.q.slerp(c.flat, 1 - Math.exp(-dt * 4));
            }
            o3.position.copy(c.p);
            o3.quaternion.copy(c.q);
            o3.scale.setScalar(1);
            o3.updateMatrix();
            leaping.setMatrixAt(i, o3.matrix);
          }
          leaping.instanceMatrix.needsUpdate = true;
        }

        // The dust in the air, drifting.
        for (let i = 0; i < AIR; i++) {
          const s0 = airSeed[i * 4];
          const s1 = airSeed[i * 4 + 1];
          airPos[i * 3] = (s0 - 0.5) * 6 + Math.sin(t * 0.12 + s1 * 20) * 0.5;
          airPos[i * 3 + 1] = FLOOR_Y + ((airSeed[i * 4 + 2] + t * 0.012 * (0.4 + s1)) % 1) * 4;
          airPos[i * 3 + 2] = (airSeed[i * 4 + 3] - 0.35) * 4.5;
        }
        airGeo.attributes.position.needsUpdate = true;

        // Sparks: falling, cooling, each a bright head with its streak.
        for (let i = 0; i < SP; i++) {
          if (spLife[i] <= 0) {
            spHeat[i * 2] = spHeat[i * 2 + 1] = 0;
            hdHeat[i] = 0;
            continue;
          }
          spLife[i] -= dt * 1.5;
          spVel[i].y -= 6.5 * dt;
          spVel[i].multiplyScalar(Math.exp(-dt * 0.6));
          spP[i].addScaledVector(spVel[i], dt);
          const hh = Math.max(0, spLife[i]);
          spPos.set([spP[i].x, spP[i].y, spP[i].z, spP[i].x - spVel[i].x * 0.05, spP[i].y - spVel[i].y * 0.05, spP[i].z - spVel[i].z * 0.05], i * 6);
          hdPos.set([spP[i].x, spP[i].y, spP[i].z], i * 3);
          spHeat[i * 2] = hh;
          spHeat[i * 2 + 1] = hh * 0.15;
          hdHeat[i] = hh;
        }
        spGeo.attributes.position.needsUpdate = true;
        spGeo.attributes.heat.needsUpdate = true;
        hdGeo.attributes.position.needsUpdate = true;
        hdGeo.attributes.heat.needsUpdate = true;

        // The puff of wood dust: drifting out, slowing, thinning away.
        if (puffT < 1) {
          puffT = Math.min(1, puffT + dt * 0.85);
          puffMat.opacity = Math.min(1, puffT * 14) * 0.34 * (1 - puffT) ** 1.4;
          puffMat.size = 0.18 + puffT * 0.55;
          for (let i = 0; i < PUFF; i++) {
            puffVel[i].multiplyScalar(Math.exp(-dt * 2.2));
            puffPos[i * 3] += puffVel[i].x * dt;
            puffPos[i * 3 + 1] += puffVel[i].y * dt;
            puffPos[i * 3 + 2] += puffVel[i].z * dt;
          }
          puffGeo.attributes.position.needsUpdate = true;
        } else puffMat.opacity = 0;

        if (opened) {
          openT = Math.min(1, openT + dt * 0.55);
          const e = 1 - Math.pow(1 - openT, 3);
          inner.intensity = e * 16 * (0.92 + 0.08 * Math.sin(t * 9.0) * Math.sin(t * 5.3));
          beamMat.uniforms.uOpen.value = e;
          beamMat.uniforms.uTime.value = t;
          moteMat.opacity = e * 0.85;
          for (let i = 0; i < MOTES; i++) {
            const rise = (moteSeed[i * 3] + t * (0.05 + moteSeed[i * 3 + 1] * 0.08)) % 1;
            const r = (0.25 + rise * 0.75) * W * 0.5 * moteSeed[i * 3 + 2];
            const a = moteSeed[i * 3 + 1] * 40 + t * 0.15;
            motePos[i * 3] = Math.cos(a) * r;
            motePos[i * 3 + 1] = TOP + rise * 3.1;
            motePos[i * 3 + 2] = Math.sin(a) * r * 0.6;
          }
          moteGeo.attributes.position.needsUpdate = true;
          // The coin rises out of the glow, turning, and comes to you.
          const c = Math.max(0, Math.min(1, (openT - 0.12) / 0.88));
          const ce = 1 - Math.pow(1 - c, 3);
          coin.position.set(0, TOP - 0.4 + ce * 1.25, ce * 1.1);
          coin.scale.setScalar(0.34 + ce * 0.3);
          coin.rotation.y += dt * (3.0 - ce * 2.4);
          glow.position.copy(coin.position).add(new THREE.Vector3(0, 0, -0.3));
          glowMat.opacity = ce * 0.5;
          glow.scale.setScalar(2.4 + ce * 1.4);
        }

        // The camera: a flinch at each blow; after the break, easing in a
        // little (not so far that the words below are crowded).
        camKick *= Math.exp(-dt * 9);
        const back = opened ? 1 - Math.pow(1 - openT, 3) : 0;
        camera.position.set(camBase.x + Math.sin(t * 61) * camKick * 0.05, camBase.y + back * 0.12 + Math.sin(t * 47) * camKick * 0.03, camBase.z + (camOpen - camBase.z) * back);
        camera.lookAt(look.x, look.y + back * 0.5, look.z);

        if (phone && (frameNo++ & 1) === 0) renderer.shadowMap.needsUpdate = true;
        gpu.begin();
        renderer.render(scene, camera);
        gpu.end();
        // The first complete frame: everything appears together.
        if (!shown) {
          shown = true;
          renderer.domElement.style.opacity = "1";
          setReady(true);
        }
      };

      const fit = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w < 2 || h < 2) return;
        camera.aspect = w / h;
        // Far enough back for the chest's height AND its width at this shape,
        // with room above it for what comes out.
        const vf = (camera.fov * Math.PI) / 180;
        const asp = Math.max(0.4, w / h);
        const t2 = Math.tan(vf / 2);
        camBase.set(0, TOP + 0.5, Math.max((H * 1.42) / t2, (W * 0.76) / t2 / asp) + D * 0.5);
        camOpen = Math.max((H * 1.85) / t2, (W * 0.84) / t2 / asp) + D * 0.5;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        // The sparks' heads: world size to pixels.
        hdMat.uniforms.uFocal.value = (h * renderer.getPixelRatio()) / 2 / Math.tan(vf / 2);
      };
      const gpu = watchGpu(renderer, "award", phone, (ratio) => {
        renderer.setPixelRatio(ratio);
        fit();
      });
      const ro = new ResizeObserver(fit);
      ro.observe(host);
      fit();
      // Its shaders compiled in the background, then the first frame.
      try {
        await renderer.compileAsync(scene, camera);
      } catch {
        /* compiled on the first frame instead */
      }
      if (!alive) {
        ro.disconnect();
        host.removeEventListener("pointermove", onMove);
        bail();
        return;
      }
      // Everything the blows and the break will need, drawn once unseen (the
      // canvas is still transparent): its shaders built, its pictures and
      // shapes sent to the GPU. The first blow used to wait ~280 ms for the
      // dent it was about to leave (measured) — no delay means none.
      const dress = new THREE.Mesh(dentGeo, dentMat);
      dress.position.set(0, RIM, 0);
      scene.add(dress);
      const held = [coin, beam, motes, leaping];
      for (const o of held) o.visible = true;
      inner.intensity = 0.01;
      flashL.intensity = 0.01;
      for (const o of [coin, leaping, dress]) o.traverse((m) => (m.frustumCulled = false));
      renderer.render(scene, camera);
      scene.remove(dress);
      for (const o of held) o.visible = false;
      inner.intensity = 0;
      flashL.intensity = 0;
      clock.getDelta();
      tick();

      cleanup = () => {
        unguard();
        gpu.dispose();
        cancelAnimationFrame(raf);
        ro.disconnect();
        host.removeEventListener("pointermove", onMove);
        scene.traverse((o) => {
          const m = o as Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as InstanceType<typeof THREE.MeshStandardMaterial> | undefined;
          if (mat && "map" in mat) {
            mat.map?.dispose();
            mat.normalMap?.dispose();
            mat.roughnessMap?.dispose();
            mat.metalnessMap?.dispose();
            mat.aoMap?.dispose();
          }
          mat?.dispose?.();
        });
        [floorMat, contactMat, faceMat, gold, coinMat, pileMat, dentMat, glowMat, beamMat, moteMat, airMat, spMat, hdMat, puffMat].forEach((m) => m.dispose());
        [contactTex, faceTex, normalTex, glowTex, moteTex, puffTex, dentTex, fadeTex, fDiff, fNor, fArm].forEach((tx) => tx?.dispose());
        dentGeo.dispose();
        coinGeo.dispose();
        envRT.dispose();
        pmrem.dispose();
        renderer.dispose();
        // Free the context NOW: a closed award room must not keep holding one
        // of the phone's few (it used to linger until garbage collection).
        renderer.forceContextLoss();
        if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
      };
    })();

    return () => {
      alive = false;
      cleanup?.();
      unclaim();
    };
  }, []);

  if (noGL) return <Medal />;

  return (
    <div className="absolute inset-0">
      <div
        ref={mount}
        onPointerDown={strike}
        className={`h-full w-full touch-none ${done ? "" : "cursor-[url(/dev/hammer.svg)_18_18,pointer]"}`}
      />
      {!ready && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" role="status" aria-label="Opening the award">
          <div className="flex flex-col items-center gap-4">
            <span className="block h-14 w-14 rounded-full border-2 border-[#e0a95c]/25 border-t-[#f2c765]" style={{ animation: "devSpin 1.1s linear infinite" }} />
            <span className="text-[11px] tracking-[0.4em] text-[#e0a95c]">UNSEALING THE CHEST…</span>
          </div>
        </div>
      )}
      {ready && !done && (
        <p className="pointer-events-none absolute inset-x-0 bottom-24 text-center text-[11px] tracking-[0.34em] text-[#e0a95c] sm:bottom-28">
          {hits === 0 ? "STRIKE THE CHEST" : hits < 2 ? "AGAIN" : "IT IS BREAKING…"}
        </p>
      )}
    </div>
  );
}

/** The medal, without WebGL: struck gold with an engraved rank, hung on a
 *  ribbon in the page's copper and teal, and a light crossing it the way it
 *  crosses metal you turn in your hand (the same sweep as the gold text). */
function Medal() {
  return (
    <div className="absolute inset-0 grid place-items-center pb-16">
      <div className="relative mt-24" style={{ animation: "devFadeUp 1s .2s ease-out both" }}>
        {/* The ribbon: two straps meeting behind the disc. */}
        <div aria-hidden className="absolute bottom-[78%] left-1/2 flex -translate-x-1/2">
          {[-15, 15].map((deg) => (
            <span
              key={deg}
              className="block h-[150px] w-[46px] sm:h-[180px] sm:w-[54px]"
              style={{
                transform: `rotate(${deg}deg)`,
                transformOrigin: deg < 0 ? "100% 100%" : "0% 100%",
                background:
                  "linear-gradient(90deg, #8a4a22 0 18%, #d97742 18% 34%, #2dd4bf 34% 66%, #d97742 66% 82%, #8a4a22 82%)",
                boxShadow: "inset 0 -30px 40px -20px rgba(0,0,0,.6)",
              }}
            />
          ))}
        </div>
        {/* The disc. */}
        <div
          className="relative grid h-[210px] w-[210px] place-items-center overflow-hidden rounded-full sm:h-[260px] sm:w-[260px]"
          style={{
            background:
              "radial-gradient(circle at 34% 28%, #fff7dc 0%, #ffd987 16%, #e3a640 42%, #a96a1d 70%, #6a3c0d 100%)",
            boxShadow:
              "0 34px 90px -24px rgba(255,180,80,.6), inset 0 0 0 5px rgba(255,236,180,.55), inset 0 0 0 13px rgba(140,82,18,.55), inset 0 0 0 15px rgba(255,226,160,.35), inset 0 -14px 34px rgba(70,35,0,.55)",
          }}
        >
          <div className="relative text-center" style={{ color: "#5a340b", textShadow: "0 1px 0 rgba(255,242,205,.75), 0 -1px 0 rgba(60,30,0,.35)" }}>
            <div className="text-[13px] tracking-[0.42em] sm:text-[14px]">RANK</div>
            <div className="text-[76px] font-bold leading-[0.95] sm:text-[94px]">17</div>
            <div className="mt-1 text-[9px] tracking-[0.3em] sm:text-[10px]">ANNA UNIVERSITY</div>
          </div>
          {/* The light crossing the metal. */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(105deg, transparent 30%, rgba(255,250,235,.55) 46%, rgba(255,250,235,0) 58%)",
              backgroundSize: "300% 100%",
              mixBlendMode: "soft-light",
              animation: "devGoldSweep 6s ease-in-out infinite",
            }}
          />
        </div>
      </div>
    </div>
  );
}
