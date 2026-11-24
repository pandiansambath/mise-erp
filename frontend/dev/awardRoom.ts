// The award room's scene, by itself: built off screen, ready before it is shown
// (§103.2: "please try to load before itself, before entering this area, in a
// smooth way"). The profile page builds it in its idle moments on a desktop; a
// phone builds it behind the doors. AwardStage puts its canvas on the page.
//
// What is in it (§102.1, §103.3, §103.5):
//   · a photo-scanned chest and an antique cross-pein hammer (Poly Haven, CC0),
//     standing in a dark temple hall lit by the light you carry (awardHall);
//   · the hammer waits, raised, over the chest (on a desktop it follows where you
//     point); a tap swings it down on an arc from the hand, onto the very spot you
//     tapped, in 75 ms — and the blow's sound is scheduled on the audio clock to be
//     heard on that frame: hot spark streaks off the iron, a puff of wood dust, a
//     dent left in the wood, the chest jolting, the hammer stopped dead for an
//     instant and thrown back up;
//   · the last blow: the lock snaps off and falls, clanking where it lands; the lid
//     bursts open on its hinge with an overshoot; the gold piled inside lights up,
//     coins leap out, bounce and settle on the stone; light pours out, the lamps
//     catch one by one, the gold in the carvings wakes; and his coin (awardCoin)
//     rises out of the glow and comes to you, large.
//
// The camera is positioned THE MOMENT it is created, before anything is
// measured: a safe view first, refined after.

import type { GLTF, GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { Mesh as Mesh3, MeshStandardMaterial, Texture } from "three";
import { ask } from "./ask";
import { CHEST_GLTF, COIN_TEX, ENV_TEX, FLOOR_TEX, HALL_TEX, HAMMER_GLTF, wallTex } from "./awardFiles";
import { buildCoin, strikeFace } from "./awardCoin";
import { buildHall, carveWall, FLOOR_Y, softTexture, WALL_Z, type Relief, type T3 } from "./awardHall";
import { buildLens, type Lens } from "./awardLens";
import { playBreak, playClank, playClink, playFire, playHit } from "./chestBits";
import { guardCanvas, quiet } from "./glGuard";
import { pixelRatio, watchGpu } from "./sharp";

export type CoinBox = { x: number; y: number; r: number; on: boolean };

export type RoomEvents = {
  /** Its first frame on the page. */
  ready: () => void;
  lost: () => void;
  /** All four lamps lit. */
  awake?: () => void;
  coin: (c: CoinBox) => void;
};

export type Room = {
  canvas: HTMLCanvasElement;
  /** Into the page: it runs from now on. `ready` at its first frame there. */
  attach: (host: HTMLElement, on: RoomEvents) => void;
  /** A blow of this power, aimed at this point of the canvas (-1..1): the hammer
   *  struck, could not (mid-swing, broken), or the point is nowhere near the chest. */
  hit: (power: number, nx?: number, ny?: number) => "hit" | "busy" | "miss";
  /** The light, to where the pointer (or a finger) is. */
  point: (nx: number, ny: number, touch: boolean) => void;
  /** Whether the pointer is on the coin. */
  hold: (on: boolean) => void;
  /** The coin turned by hand: taken; moved by so much of its own radius; let go. */
  turn: (what: "take" | "move" | "let", dx?: number, dy?: number) => void;
  /** How far down the words at the top reach (CSS px): the coin hangs below them. */
  under: (px: number) => void;
  /** The point is on the verse in the wall. */
  onVerse: (nx: number, ny: number) => boolean;
  /** Its graphics taken away. */
  lost: () => boolean;
  dispose: () => void;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A picture, decoded off the page's own thread where the browser can. */
async function picture(THREE: T3, url: string, flip = true, side = 0, gray = false): Promise<Texture> {
  for (let n = 0; ; n++) {
    // (Anew where it could not be read: what the browser has kept may be half of it. Or the
    // phone was short of memory just then.)
    const blob = await ask(url, (r) => r.blob(), n > 0);
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: flip ? "flipY" : "none", premultiplyAlpha: "none", colorSpaceConversion: "none", ...(side ? { resizeWidth: side, resizeHeight: side, resizeQuality: "high" as const } : {}) });
      const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
      t.flipY = false;
      // (One number a pixel: a quarter of the memory.)
      if (gray) t.format = THREE.RedFormat;
      t.needsUpdate = true;
      return t;
    } catch {
      /* the plain way */
    }
    const src = URL.createObjectURL(blob);
    try {
      const t = await new THREE.TextureLoader().loadAsync(src);
      t.flipY = flip;
      return t;
    } catch (e) {
      if (n >= 2) throw e;
      await wait(300 * (n + 1));
    } finally {
      URL.revokeObjectURL(src);
    }
  }
}

/** A model, its pictures loaded as all the others are (the loader itself asks for each of them
 *  once, and where one does not come leaves that thing plain white). Should one still not come,
 *  what it is of is `plain`. */
async function model(THREE: T3, loader: GLTFLoader, url: string, plain: number): Promise<GLTF> {
  const g = await loader.loadAsync(url);
  const bare = new Set<MeshStandardMaterial>();
  g.scene.traverse((c) => {
    const m = (c as Mesh3).material as MeshStandardMaterial | undefined;
    if (m?.isMeshStandardMaterial && !m.map) bare.add(m);
  });
  for (const m of bare) {
    m.color.set(plain);
    if (!m.metalnessMap) Object.assign(m, { metalness: 0.05, roughness: 0.82 });
  }
  return g;
}

/** What the metal reflects: a dark hall, a shaft of day above, fires at the sides,
 *  a warm dusk where you stand. (Gold is mostly its surroundings; bright narrow
 *  things in a dark room are what make it look like gold.) Prefiltered offline
 *  (three's own atlas): doing it here took three seconds of shader building on a
 *  first visit. The picture holds mantissas in its left half, exponents in its
 *  right. */
function surroundings(THREE: T3, renderer: InstanceType<T3["WebGLRenderer"]>, pic: Texture): Relief {
  const W = 384;
  const H = 512;
  pic.minFilter = pic.magFilter = THREE.NearestFilter;
  pic.generateMipmaps = false;
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  rt.texture.mapping = THREE.CubeUVReflectionMapping;
  const mat = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: { t: { value: pic } },
    vertexShader: "void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D t;
      void main() {
        ivec2 p = ivec2(gl_FragCoord.xy);
        vec3 m = texelFetch(t, p, 0).rgb;
        float e = texelFetch(t, p + ivec2(${W}, 0), 0).r * 255.0 / 8.0 - 16.0;
        gl_FragColor = vec4(m * m * exp2(e), 1.0);
      }`,
  });
  const s = new THREE.Scene();
  const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  q.frustumCulled = false;
  s.add(q);
  const c = new THREE.Camera();
  renderer.setRenderTarget(rt);
  const built = renderer.compileAsync(s, c);
  renderer.setRenderTarget(null);
  const ready = built
    .catch(() => {})
    .then(() => {
      renderer.setRenderTarget(rt);
      renderer.render(s, c);
      renderer.setRenderTarget(null);
      q.geometry.dispose();
      mat.dispose();
    });
  return { rt, ready };
}

/** Everything the room is made of, read and decoded: no graphics yet. Asked for the
 *  moment somebody is on the way in, so it is done by the time they are there. */
type Stock = [GLTF | null, GLTF | null, ...(Texture | null)[]];
let stock: { at: number; got: Promise<Stock> } | null = null;
let coming: ((p: number) => void) | null = null;
export function stockRoom(): Promise<Stock> {
  if (stock && performance.now() - stock.at < 60_000) return stock.got;
  const got = (async () => {
    const THREE = await import("three");
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const phone = window.matchMedia("(max-width: 767px)").matches;
    const loader = new GLTFLoader();
    type Parser = { json: { images: { uri: string }[]; textures: { source: number }[] }; options: { path: string } };
    loader.register((parser) => {
      const { json, options } = parser as unknown as Parser;
      return {
        name: "its pictures",
        loadTexture: (i: number) =>
          picture(THREE, THREE.LoaderUtils.resolveURL(json.images[json.textures[i].source].uri, options.path), false)
            .then((t) => {
              t.wrapS = t.wrapT = THREE.RepeatWrapping;
              return t;
            })
            .catch(() => null) as Promise<Texture>,
      };
    });
    let n = 0;
    const come = <X>(x: Promise<X>): Promise<X | null> =>
      x
        .catch(() => null)
        .then((v) => {
          n++;
          coming?.((n / 18) * 0.6);
          return v;
        });
    const pics = [FLOOR_TEX.diff, FLOOR_TEX.nor, FLOOR_TEX.arm, HALL_TEX.stone, HALL_TEX.stoneN];
    const w = wallTex(phone);
    return (await Promise.all([
      come(model(THREE, loader, CHEST_GLTF, 0x6a3a24)),
      come(model(THREE, loader, HAMMER_GLTF, 0x5a4030)),
      ...pics.map((u) => come(picture(THREE, u))),
      ...[w.x, w.y, w.c, w.h, w.gold, w.verse].map((u) => come(picture(THREE, u, true, 0, true))),
      w.tiny ? come(picture(THREE, w.tiny, true, 0, true)) : Promise.resolve(null),
      ...[COIN_TEX.front, COIN_TEX.back].map((u) => come(picture(THREE, u, true, phone ? 1024 : 0))),
      come(picture(THREE, ENV_TEX, false)),
    ])) as Stock;
  })();
  stock = { at: performance.now(), got };
  return got;
}

const ease = (t: number) => t * t * (3 - 2 * t);

/** Build it. `calm` is awaited between steps (idle moments, on the profile page);
 *  `alive` is asked after each wait. Throws if there can be no room (no WebGL, no
 *  chest): the medal stands in. */
export async function buildRoom(o: { lite: boolean; calm: () => Promise<void>; alive: () => boolean; gentle?: boolean; progress?: (p: number) => void }): Promise<Room> {
  const gone = () => {
    if (!o.alive()) throw new Error("award: no longer wanted");
  };
  const THREE = await import("three");
  gone();
  await o.calm();
  const lite = o.lite;
  const phone = window.matchMedia("(max-width: 767px)").matches;
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  type V3 = InstanceType<T3["Vector3"]>;
  type Mesh = InstanceType<T3["Mesh"]>;
  type M3 = { dispose: () => void };

  // Every file at once (they were warmed long ago, or are on their way).
  coming = o.progress ?? null;
  const files = stockRoom();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050406);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 60);
  camera.position.set(0, 1.05, 7.2);
  const look = new THREE.Vector3(0, -0.35, 0);
  camera.lookAt(look);

  const renderer = new THREE.WebGLRenderer({ antialias: phone, alpha: false, powerPreference: "high-performance" });

  quiet(renderer);
  const canvas = renderer.domElement;
  // A desktop's picture is developed (awardLens); a phone draws straight.
  const lens: Lens | null = phone || lite ? null : buildLens(THREE, renderer);
  let dead = false;
  let onLost: (() => void) | null = null;
  const unguard = guardCanvas(canvas, () => window.setTimeout(() => onLost?.(), 0));
  const bail = () => {
    dead = true;
    unguard();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
  try {
    renderer.setPixelRatio(lite ? 1 : pixelRatio("award", phone));
    renderer.shadowMap.enabled = !lite;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    canvas.style.cssText = "display:block;width:100%;height:100%";

    const [chestG, hammerG, fDiff, fNor, fArm, tStone, tStoneN, tWx, tWy, tWc, tWh, tGold, tVerse, tTiny, tFront, tBack, tEnv] = await files;
    coming = null;
    stock = null; // (they are this room's now)
    gone();
    if (!chestG || !fDiff || !fNor || !fArm || !tWx || !tWy || !tWc || !tWh || !tVerse || !tGold || !tStone || !tStoneN || !tFront || !tBack || !tEnv) throw new Error("award: files");
    await o.calm();
    // (Drawn in the background, all of them, while the rest is put together.)
    const around = surroundings(THREE, renderer, tEnv);
    const envRT = around.rt;
    const env = envRT.texture;
    scene.environment = env;
    scene.environmentIntensity = 0.5;
    await o.calm();
    gone();
    // Each picture to the GPU by itself, so no one moment carries them all.
    for (const t of [fDiff, fNor, fArm, tStone, tStoneN, tGold, tWh, tVerse, tTiny, tWx, tWy, tWc]) {
      if (!t) continue;
      const tiled = t === fDiff || t === fNor || t === fArm || t === tStone || t === tStoneN;
      t.wrapS = t.wrapT = tiled ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      if (t === tWh) t.wrapS = THREE.MirroredRepeatWrapping;
      if (t === tWx || t === tWy || t === tWc) {
        t.generateMipmaps = false;
        t.minFilter = THREE.LinearFilter;
      }
      renderer.initTexture(t);
      await o.calm();
      gone();
    }

    o.progress?.(0.66);
    // The carvings and the coin's faces: heights made into normals.
    const carved = carveWall(THREE, renderer, { x: tWx, y: tWy, c: tWc }, phone);
    await o.calm();
    const struckA = strikeFace(THREE, renderer, tFront, phone);
    await o.calm();
    const struckB = strikeFace(THREE, renderer, tBack, phone);
    await o.calm();
    gone();

    // ── light ───────────────────────────────────────────────────────────
    // The day, from an opening high above: it models the wood; the rest of the
    // room is the dark the carried light goes about in.
    const key = new THREE.DirectionalLight(0xd9e2f5, 1.75);
    key.position.set(1.9, 6.6, 3.2);
    key.castShadow = !lite;
    // (It falls on the chest alone — the hall has the carried light's shadow — so
    // it is small, and softened where it is read. A blurred one, VSM, cost more
    // than everything else in the room: 28 ms of 42 on his laptop's GPU.)
    key.shadow.mapSize.set(phone ? 512 : 1024, phone ? 512 : 1024);
    Object.assign(key.shadow.camera, { left: -2.2, right: 2.2, top: 2.3, bottom: -2.1, near: 1, far: 14 });
    key.shadow.radius = phone ? 2.5 : 3.5;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.012;
    scene.add(key);
    // (Few lights, each used for more than one thing: every one of them is paid
    // for on every pixel of the chest.) The air, warmer as the lamps are lit…
    const hemi = new THREE.HemisphereLight(0xaebcff, 0x3a2413, 0.2);
    const cool = new THREE.Color(0xaebcff);
    const warm = new THREE.Color(0xffa55a);
    scene.add(hemi);
    // …and one that is the flash where a blow lands, then the gold's own light.
    const inner = new THREE.PointLight(0xffb24a, 0, 8, 2);
    scene.add(inner);
    const flashAt = new THREE.Vector3();

    const soft = softTexture(THREE, 128);
    const contactTex = softTexture(THREE, 128);
    const contactMat = new THREE.MeshBasicMaterial({ map: contactTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.85 });
    const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), contactMat);
    contact.renderOrder = 3;
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = FLOOR_Y + 0.003;
    scene.add(contact);

    // ── the chest (Poly Haven, CC0) ─────────────────────────────────────
    const chest = new THREE.Group();
    // Three-quarters on: its side shows, so it reads as a solid thing.
    const YAW = -0.32;
    chest.rotation.y = YAW;
    scene.add(chest);
    const root = chestG.scene;
    root.traverse((c) => {
      const m = c as Mesh;
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
    contact.scale.set(W * 1.5, D * 1.8, 1);
    const innerAt = new THREE.Vector3(0, TOP - 0.08 * H, 0.1);
    inner.position.copy(innerAt);

    // ── the hall, and the light you carry ───────────────────────────────
    const hall = buildHall(THREE, {
      renderer,
      scene,
      camera,
      phone,
      lite,
      env,
      files: { relief: carved.rt, height: tWh, wallGold: tGold, verse: tVerse, tiny: tTiny, stone: tStone, stoneN: tStoneN, floorD: fDiff, floorN: fNor, floorA: fArm },
      target: new THREE.Vector3(0, FLOOR_Y + H * 0.55, 0),
    });
    // (Its shadow across the hall is cast by a plain body and lid, not by the
    // scan's hundred thousand triangles.)
    const body = new THREE.Mesh(new THREE.BoxGeometry(W * 0.97, RIM - FLOOR_Y, D * 0.97), new THREE.MeshBasicMaterial({ visible: false }));
    body.position.y = (FLOOR_Y + RIM) / 2;
    chest.add(body);
    hall.casts(body);
    if (lid) {
      const cover = new THREE.Mesh(new THREE.CylinderGeometry(D * 0.485, D * 0.485, W * 0.97, 18, 1, false, 0, Math.PI), body.material);
      cover.rotation.z = Math.PI / 2;
      cover.scale.x = (TOP - RIM) / (D * 0.485);
      const held0 = new THREE.Group();
      held0.position.set(0, RIM, 0);
      held0.add(cover);
      chest.add(held0);
      chest.updateMatrixWorld(true);
      lid.attach(held0);
      hall.casts(held0);
    }
    await o.calm();
    gone();

    // What a blow is aimed at: a plain box round the chest (twelve
    // triangles, not the scan's hundred thousand), turned with it.
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.set(0, FLOOR_Y + H / 2, 0);
    chest.add(proxy);
    // …and what counts as tapping it: the same, a little generous.
    const near = new THREE.Mesh(new THREE.BoxGeometry(W * 1.16, H * 1.3, D * 1.16), proxy.material);
    near.position.copy(proxy.position);
    chest.add(near);
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
      hall.casts(hammer);
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

    // ── the coin ────────────────────────────────────────────────────────
    const struck = buildCoin(THREE, { env, front: struckA.rt, back: struckB.rt, phone });
    const coin = struck.group;
    coin.visible = false;
    scene.add(coin);
    hall.casts(coin);
    // Its place at the end (in front of you; worked out in fit), and its turning:
    // round and round, until you point at it — then it shows you its face.
    const goal = { p: new THREE.Vector3(0, 0.6, 2), s: 0.5, lookY: 0.4 };
    const spin = { a: 0, v: 0, tx: 0, ty: 0, held: false };
    // …or yours: pulled round any way you like (§106.2), running on when it is let go, and a
    // while after that upright and turning by itself again.
    const mine = { on: false, taken: false, q: new THREE.Quaternion(), wx: 0, wy: 0, since: 0, back: 0, t: 0 };
    const axX = new THREE.Vector3();
    const axY = new THREE.Vector3();
    const dq = new THREE.Quaternion();
    const selfQ = new THREE.Quaternion();
    const selfE = new THREE.Euler();
    const ahead = new THREE.Vector3();
    const pull = (ax: number, ay: number) => {
      axX.set(1, 0, 0).applyQuaternion(camera.quaternion);
      axY.set(0, 1, 0).applyQuaternion(camera.quaternion);
      mine.q.premultiply(dq.setFromAxisAngle(axY, ax)).premultiply(dq.setFromAxisAngle(axX, ay)).normalize();
    };
    const glowMat = new THREE.SpriteMaterial({ map: soft, color: 0xffc877, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(3.2);
    scene.add(glow);
    await o.calm();
    gone();

    // ── the gold inside: a heaped mound, coins lying all over it, and the
    // ones that leap out when it opens ───────────────────────────────────
    const pileMat = new THREE.MeshStandardMaterial({ color: 0xe0a648, metalness: 1, roughness: 0.34, envMap: env, envMapIntensity: 0.75 });
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
    const coinMat = new THREE.MeshStandardMaterial({ color: 0xe2a336, metalness: 1, roughness: 0.3, envMap: env, envMapIntensity: 0.8 });
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

    // (Each one's shadow on the stone, under it.)
    const leapDark = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.2, 0.2).rotateX(-Math.PI / 2), contactMat, LEAP);
    leapDark.frustumCulled = false;
    leapDark.visible = false;
    leapDark.renderOrder = 3;
    scene.add(leapDark);

    // ── the marks a blow leaves in the wood ─────────────────────────────
    // A crushed square the size of the hammer's face: sunk, its walls lit and
    // shaded by the room's own lights (a normal map made from its depth), a
    // raised lip, fibres crushed inside and torn along the grain.
    const [dentTex, dentNor] = (() => {
      const n = 128;
      const depth = new Float32Array(n * n);
      const c = document.createElement("canvas");
      c.width = c.height = n;
      const g = c.getContext("2d")!;
      const img = g.createImageData(n, n);
      const st = (e0: number, e1: number, x: number) => {
        const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
        return t * t * (3 - 2 * t);
      };
      const fibre = (u: number, v: number) => 0.5 + 0.5 * Math.sin(v * 46 + Math.sin(u * 3.1 + v * 5.3) * 1.6) * Math.sin(v * 17.3 + u * 1.7);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const u = (x / n) * 2 - 1;
          const v = (y / n) * 2 - 1;
          const qx = Math.abs(u) - 0.3;
          const qy = Math.abs(v) - 0.3;
          const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 0.09 + Math.sin(u * 9 + v * 4) * 0.012;
          const pit = 1 - st(-0.1, 0.05, sd);
          const lip = Math.exp(-(((sd - 0.09) / 0.075) ** 2));
          const fi = fibre(u, v);
          depth[y * n + x] = -pit * (1 + 0.28 * fi) + lip * (0.22 + 0.2 * fi);
          const rim = Math.exp(-((sd / 0.055) ** 2));
          const o = (y * n + x) * 4;
          img.data[o] = 58 + fi * 34 - rim * 22;
          img.data[o + 1] = 33 + fi * 20 - rim * 14;
          img.data[o + 2] = 21 + fi * 12 - rim * 9;
          img.data[o + 3] = Math.min(1, pit * 0.86 + rim * 0.5 + lip * 0.3) * 255;
        }
      }
      g.putImageData(img, 0, 0);
      // Torn along the grain: pale new wood, and the cracks between.
      for (let k = 0; k < 18; k++) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const y = 64 + (Math.random() - 0.5) * 52;
        const x = 64 + side * (20 + Math.random() * 8);
        const len = side * (5 + Math.random() * 24);
        g.strokeStyle = Math.random() < 0.55 ? `rgba(222,176,128,${0.45 + Math.random() * 0.35})` : `rgba(10,5,3,${0.55 + Math.random() * 0.35})`;
        g.lineWidth = 0.5 + Math.random() * 1.1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + len, y + (Math.random() - 0.5) * 3);
        g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      const c2 = document.createElement("canvas");
      c2.width = c2.height = n;
      const g2 = c2.getContext("2d")!;
      const im2 = g2.createImageData(n, n);
      const at = (x: number, y: number) => depth[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))];
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * 4.2;
          const dy = (at(x, y + 1) - at(x, y - 1)) * 4.2;
          const inv = 1 / Math.hypot(dx, dy, 1);
          const o = (y * n + x) * 4;
          im2.data[o] = (-dx * inv * 0.5 + 0.5) * 255;
          im2.data[o + 1] = (dy * inv * 0.5 + 0.5) * 255;
          im2.data[o + 2] = (inv * 0.5 + 0.5) * 255;
          im2.data[o + 3] = 255;
        }
      }
      g2.putImageData(im2, 0, 0);
      return [t, new THREE.CanvasTexture(c2)];
    })();
    const dentMat = new THREE.MeshStandardMaterial({ map: dentTex, normalMap: dentNor, normalScale: new THREE.Vector2(1.5, 1.5), transparent: true, depthWrite: false, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const dentGeo = new THREE.PlaneGeometry(1, 1);
    const dent = (at: V3, nrm: V3, power: number) => {
      const m = new THREE.Mesh(dentGeo, dentMat);
      m.position.copy(at).addScaledVector(nrm, 0.012);
      m.lookAt(at.clone().addScaledVector(nrm, 1));
      // Along the grain, give or take.
      m.rotateZ((Math.random() - 0.5) * 0.3);
      m.scale.setScalar(0.27 * (0.85 + power * 0.22));
      scene.add(m);
      // It belongs to what it marked: the lid swings away with its dents.
      (at.y > RIM && lid ? lid : root).attach(m);
    };
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
    const moteTex = softTexture(THREE, 64);
    const moteMat = new THREE.PointsMaterial({ map: moteTex, size: 0.05, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, color: 0xffd38a });
    const motes = new THREE.Points(moteGeo, moteMat);
    motes.visible = false;
    scene.add(motes);

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
    const puffTex = softTexture(THREE, 64);
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
      leaping.visible = leapDark.visible = true;
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
      coin.scale.setScalar(0.28);
      spin.a = 0;
      beam.visible = true;
      motes.visible = true;
    };

    // ── the light, where you point ──────────────────────────────────────
    const wallP = new THREE.Plane(new THREE.Vector3(0, 0, 1), -WALL_Z);
    const floorP = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FLOOR_Y);
    const at = new THREE.Vector3();
    const point = { nx: 0, ny: 0.1, t: -99, touch: false, seen: false };
    /** In the room, the place your pointer is over — a hand's breadth off it. */
    const carry = (nx: number, ny: number, out: V3) => {
      ray.setFromCamera(ndc.set(nx, ny), camera);
      const hit = ray.intersectObject(near, false)[0];
      if (hit) {
        out.copy(hit.point);
        toCam.copy(camera.position).sub(out).normalize();
        out.addScaledVector(toCam, 0.75);
        out.y += 0.15;
        return;
      }
      if (ray.ray.direction.y < 0 && ray.ray.intersectPlane(floorP, at) && at.z > WALL_Z) {
        out.copy(at);
        out.y += 0.62;
        // Near you it comes no nearer: it hangs where you point, over the floor there.
        const lim = camera.position.z - 3.0;
        if (out.z > lim) {
          const u = (lim - ray.ray.origin.z) / ray.ray.direction.z;
          out.copy(ray.ray.direction).multiplyScalar(u).add(ray.ray.origin);
          out.y = Math.max(out.y, FLOOR_Y + 0.45);
        }
        // Not inside the wall, where the floor meets it.
        out.z = Math.max(out.z, WALL_Z + 0.75);
        return;
      }
      if (ray.ray.intersectPlane(wallP, at)) {
        out.copy(at);
        out.z += 0.82;
      }
    };
    // Off the pointer (a phone left alone, the first moments): it wanders by
    // itself, slowly, over the carvings.
    const wander = (t: number, out: V3) => {
      const tall = camera.aspect < 0.8;
      out.set(Math.sin(t * 0.43) * (tall ? 1.7 : 3.6), 0.9 + Math.sin(t * 0.61 + 1) * (tall ? 1.5 : 0.75), WALL_Z + 1.15 + 0.4 * Math.sin(t * 0.37));
    };

    let raf = 0;
    let running = false;
    let shown = false;
    let host: HTMLElement | null = null;
    let cb: RoomEvents | null = null;
    let lastAt = 0;
    let t = 0;
    let born = 0;
    const camBase = new THREE.Vector3(0, 1.05, 7.2);
    const sway = { x: 0, y: 0 };
    let camOpen = 8;
    let frameNo = 0;
    let woke = 99;
    const boxed: CoinBox = { x: 0, y: 0, r: 0, on: false };
    const proj = new THREE.Vector3();
    const proj2 = new THREE.Vector3();

    const step = (dt: number) => {
      t += dt;
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
      flashAt.copy(cur).addScaledVector(curN, 0.35);
      if (!opened) {
        inner.position.copy(flashAt);
        inner.color.setHex(0xffa85c);
        inner.distance = 2.6;
        inner.intensity = flash * 5.5;
      }

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
          o3.position.y = FLOOR_Y + 0.004;
          o3.quaternion.identity();
          o3.scale.setScalar(Math.max(0.001, 1 - (c.p.y - FLOOR_Y) * 0.55));
          o3.updateMatrix();
          leapDark.setMatrixAt(i, o3.matrix);
        }
        leaping.instanceMatrix.needsUpdate = true;
        leapDark.instanceMatrix.needsUpdate = true;
      }

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

      // ── the light you carry ───────────────────────────────────────────
      const idle = t - point.t;
      if (!point.seen || (point.touch && idle > 2.6)) {
        // Its first moments: a pass across the wall, to show what is there.
        if (t - born < 2.8 && !still) {
          const u = ease(Math.min(1, Math.max(0, (t - born - 0.2) / 2.4)));
          const tall = camera.aspect < 0.8;
          hall.want.set((u * 2 - 1) * (tall ? 1.9 : 4.2), 1.15 + Math.sin(u * Math.PI) * 0.5, WALL_Z + 0.95);
        } else if (!still) wander(t, hall.want);
        else hall.want.set(0, 0.7, 2.2);
      } else carry(point.nx, point.ny, hall.want);

      // Near a lamp, it catches.
      if (point.seen && idle < 1.5) {
        for (let i = 0; i < 4; i++) {
          const l = hall.lamps[i];
          if (l.on) continue;
          proj.copy(l.at).project(camera);
          const dx = (proj.x - point.nx) * camera.aspect;
          const dy = proj.y - point.ny;
          if (dx * dx + dy * dy < 0.0132 && hall.ignite(i)) playFire();
        }
      }
      if (opened) {
        for (let i = 0; i < 4; i++) if (openT > 0.3 + i * 0.11 && hall.ignite(i)) playFire(0.6);
      }
      if (hall.lamps.every((l) => l.on)) {
        woke = Math.min(woke, t + 0.9);
        if (t > woke && !hall.wake.on) {
          hall.wake.on = true;
          cb?.awake?.();
        }
      }

      let innerI = 0;
      if (opened) {
        openT = Math.min(1, openT + dt * 0.5);
        const e = 1 - Math.pow(1 - openT, 3);
        innerI = e * 11 * (0.92 + 0.08 * Math.sin(t * 9.0) * Math.sin(t * 5.3));
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
        // The coin rises out of the glow, turning fast, and comes to you.
        const c = Math.max(0, Math.min(1, (openT - 0.1) / 0.8));
        const up = ease(Math.min(1, c / 0.55));
        const to = ease(Math.max(0, (c - 0.3) / 0.7));
        proj.set(0, TOP - 0.4 + up * 1.15, 0.1);
        coin.position.lerpVectors(proj, goal.p, to);
        coin.position.y += Math.sin(t * 1.1) * 0.012 * to;
        coin.scale.setScalar(0.28 + (goal.s - 0.28) * to);
        if (mine.on) spin.v *= Math.exp(-dt * 4);
        else if (spin.held && c >= 1) {
          const face = Math.round(spin.a / Math.PI) * Math.PI;
          spin.v += ((face - spin.a) * 26 - spin.v * 9) * dt;
        } else spin.v += ((still ? 0 : 0.62 + (1 - c) * 7.5) - spin.v) * (1 - Math.exp(-dt * 2.4));
        spin.a += spin.v * dt;
        const k2 = 1 - Math.exp(-dt * 6);
        spin.tx += ((spin.held ? -point.ny * 0.5 + 0.1 : 0.05) - spin.tx) * k2;
        spin.ty += ((spin.held ? point.nx * 0.55 : 0) - spin.ty) * k2;
        selfE.set(spin.tx, spin.a + spin.ty, Math.sin(t * 0.7) * 0.02);
        if (mine.on) {
          if (!mine.taken) {
            pull(mine.wx * dt, mine.wy * dt);
            const slow = Math.exp(-dt * 1.15);
            mine.wx *= slow;
            mine.wy *= slow;
            mine.since += dt;
            if (mine.back === 0 && mine.since > 3 && Math.hypot(mine.wx, mine.wy) < 0.3) {
              // Upright again from the way it faces.
              ahead.set(0, 0, 1).applyQuaternion(mine.q);
              spin.a = Math.atan2(ahead.x, ahead.z);
              spin.v = 0;
              spin.tx = spin.ty = 0;
              mine.back = 0.0001;
            }
            if (mine.back > 0) mine.back = Math.min(1, mine.back + dt / 1.6);
            if (mine.back >= 1) mine.on = false;
          }
          coin.quaternion.copy(mine.q).slerp(selfQ.setFromEuler(selfE), ease(mine.back));
        } else coin.rotation.copy(selfE);
        ahead.set(0, 0, 1).applyQuaternion(coin.quaternion);
        const facing = Math.abs(ahead.dot(proj2.copy(camera.position).sub(coin.position).normalize()));
        struck.step(t, facing * facing, to);
        glow.position.copy(coin.position).add(proj2.set(0, 0, -0.4));
        glowMat.opacity = to * 0.34;
        glow.scale.setScalar(goal.s * (4.6 + 0.2 * Math.sin(t * 1.3)));
      }
      if (opened) {
        inner.position.copy(innerAt);
        inner.color.setHex(0xffb24a);
        inner.distance = 8;
        inner.intensity = innerI + flash * 4;
      }
      let lit = 0;
      for (const l of hall.lamps) lit += l.lit;
      hemi.color.copy(cool).lerp(warm, lit / 5);
      hemi.intensity = 0.2 + lit * 0.14;
      scene.environmentIntensity = 0.5 + lit * 0.08;

      // The camera: leaning a little with your pointer; a flinch at each blow;
      // after the break, back, and up to the coin.
      camKick *= Math.exp(-dt * 9);
      const back = opened ? 1 - Math.pow(1 - openT, 3) : 0;
      const ks = 1 - Math.exp(-dt * 2.6);
      const lean = point.seen && !still ? 1 : 0;
      sway.x += (point.nx * 0.24 * lean - sway.x) * ks;
      sway.y += (point.ny * 0.1 * lean - sway.y) * ks;
      camera.position.set(camBase.x + sway.x + Math.sin(t * 61) * camKick * 0.05, camBase.y + sway.y + back * 0.12 + Math.sin(t * 47) * camKick * 0.03, camBase.z + (camOpen - camBase.z) * back);
      camera.lookAt(look.x + sway.x * 0.35, look.y + (goal.lookY - look.y) * back, look.z);
      camera.updateMatrixWorld();

      hall.step(dt, t, { open: opened ? openT : 0, inner: innerI, innerAt, rim: RIM, flash, flashAt, face: -chest.rotation.y, shaft: ease(Math.min(1, Math.max(0, (t - born) / 2.2))) });
    };

    const draw = () => {
      scene.updateMatrixWorld();
      // The two shadows take turns, a frame each.
      if ((frameNo & 1) === 1) hall.shadow();
      else renderer.shadowMap.needsUpdate = true;
      frameNo++;
      if (lens) lens.draw(scene, camera, t);
      else renderer.render(scene, camera);
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(Math.max(0, now - lastAt) / 1000, 0.05);
      lastAt = now;
      step(dt);
      gpu.begin();
      draw();
      gpu.end();
      // Where the coin is on the page, for the link over it.
      if (opened && cb && host) {
        const w = host.clientWidth;
        const h = host.clientHeight;
        proj.copy(coin.position).project(camera);
        const d = proj2.copy(coin.position).sub(camera.position).length();
        const x = ((proj.x + 1) / 2) * w;
        const y = ((1 - proj.y) / 2) * h;
        const r = ((coin.scale.x / d / Math.tan((camera.fov * Math.PI) / 360)) * h) / 2;
        const on = openT >= 0.9;
        if (on !== boxed.on || Math.abs(x - boxed.x) + Math.abs(y - boxed.y) + Math.abs(r - boxed.r) > 0.6) {
          Object.assign(boxed, { x, y, r, on });
          cb.coin(boxed);
        }
      }
      if (!shown) {
        shown = true;
        cb?.ready();
      }
    };

    const probe = new THREE.PerspectiveCamera();
    let above = 0;
    const fit = () => {
      const w = host?.clientWidth || window.innerWidth;
      const h = host?.clientHeight || window.innerHeight;
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
      // A tall screen: the chest lower down, more of the carved wall over it.
      const tall = asp < 0.8;
      look.y = tall ? 0.5 : -0.35;
      // At the end the chest stands low in the frame, the coin large above it.
      goal.lookY = FLOOR_Y + H / 2 + (tall ? 0.3 : 0.4) * camOpen * t2;
      probe.fov = camera.fov;
      probe.aspect = camera.aspect;
      probe.position.set(camBase.x, camBase.y + 0.12, camOpen);
      probe.lookAt(0, goal.lookY, 0);
      probe.updateMatrixWorld();
      const dc = 3.1;
      // (Its middle two fifths down; lower, and a little smaller, where the words at the top
      // would be under it.)
      let rad = Math.min(h * 0.205, w * 0.33);
      let mid = Math.max(h * 0.4, above + 12 + rad);
      if (mid + rad > h * 0.69) {
        rad = Math.max(h * 0.15, (h * 0.69 - above - 12) / 2);
        mid = Math.max(h * 0.4, above + 12 + rad);
      }
      goal.p.set(0, (1 - (2 * mid) / h) * dc * t2, -dc);
      probe.localToWorld(goal.p);
      goal.s = (rad / (h / 2)) * dc * t2;
      renderer.setSize(w, h, false);
      lens?.size(w * renderer.getPixelRatio(), h * renderer.getPixelRatio());
      const focal = (h * renderer.getPixelRatio()) / 2 / t2;
      // The sparks' heads: world size to pixels.
      hdMat.uniforms.uFocal.value = focal;
      hall.fit({ half: (z) => (camBase.z - z) * t2 * asp, focal, tall });
    };
    // (A phone is timed by the page's own pace, not by a GPU query some phones'
    // drivers trip over; a desktop by its GPU.)
    const gpu = watchGpu(
      renderer,
      "award",
      phone,
      (ratio) => {
        renderer.setPixelRatio(ratio);
        fit();
      },
      !phone,
    );
    fit();
    camera.position.copy(camBase);
    camera.lookAt(look);

    // Its shaders compiled in the background, then everything the blows and the
    // break will need drawn once unseen: the first blow used to wait ~280 ms for
    // the dent it was about to leave (measured) — no delay means none.
    const dress = new THREE.Mesh(dentGeo, dentMat);
    dress.position.set(0, RIM, 0);
    scene.add(dress);
    const held = [coin, beam, motes, leaping, leapDark];
    for (const x of held) x.visible = true;
    for (const x of [coin, leaping, dress]) x.traverse((m) => (m.frustumCulled = false));
    inner.intensity = 0.01;
    o.progress?.(0.78);
    hall.step(0.016, 0, { open: 0, inner: 0, innerAt, rim: RIM, flash: 0, flashAt, face: 0, shaft: 0 });
    await o.calm();
    gone();
    if (o.gentle && lens) {
      // Built behind a page in use: one piece at a time, its shader in the
      // background, its first use (textures, shapes) into a thumbnail.
      const pieces = scene.children.filter((x) => !(x as { isLight?: boolean }).isLight);
      const jobs: Promise<unknown>[] = [];
      for (const x of pieces) {
        lens.bind();
        jobs.push(renderer.compileAsync(x, camera, scene).catch(() => {}));
        renderer.setRenderTarget(null);
        await o.calm();
        gone();
      }
      jobs.push(lens.warm());
      await Promise.all(jobs);
      gone();
      o.progress?.(0.9);
      const on = pieces.map((x) => x.visible);
      for (const x of pieces) x.visible = false;
      for (let i = 0; i < pieces.length; i++) {
        if (!on[i]) continue;
        await o.calm();
        gone();
        pieces[i].visible = true;
        lens.touch(scene, camera);
        pieces[i].visible = false;
      }
      pieces.forEach((x, i) => (x.visible = on[i]));
      await o.calm();
      gone();
      hall.shadow();
      await o.calm();
      gone();
      renderer.shadowMap.needsUpdate = true;
      lens.touch(scene, camera);
    } else {
      const jobs: Promise<unknown>[] = [];
      lens?.bind();
      jobs.push(renderer.compileAsync(scene, camera).catch(() => {}));
      renderer.setRenderTarget(null);
      if (lens) jobs.push(lens.warm());
      // While the shaders build: the models' pictures to the GPU, one by one.
      const pics = new Set<Texture>();
      scene.traverse((c) => {
        const m = (c as Mesh).material as InstanceType<T3["MeshStandardMaterial"]> | undefined;
        if (!m || !("roughnessMap" in m)) return;
        for (const t of [m.map, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap]) if (t && !(t as { isRenderTargetTexture?: boolean }).isRenderTargetTexture) pics.add(t);
      });
      for (const t of pics) {
        renderer.initTexture(t);
        await o.calm();
        gone();
      }
      o.progress?.(0.86);
      await Promise.all(jobs);
      gone();
    }
    await Promise.all([around.ready, carved.ready, struckA.ready, struckB.ready]);
    gone();
    await o.calm();
    gone();
    o.progress?.(0.96);
    draw();
    scene.remove(dress);
    for (const x of held) x.visible = false;
    inner.intensity = 0;

    const ro = new ResizeObserver(fit);
    const room: Room = {
      canvas,
      attach: (h, on) => {
        host = h;
        cb = on;
        onLost = on.lost;
        h.appendChild(canvas);
        ro.observe(h);
        fit();
        if (running) return;
        running = true;
        born = t;
        lastAt = performance.now();
        tick(lastAt);
      },
      hit: (pw, nx, ny) => {
        if (broken || hold.phase === "swing") return "busy";
        if (nx !== undefined && ny !== undefined) {
          chest.updateMatrixWorld(true);
          ray.setFromCamera(ndc.set(nx, ny), camera);
          if (!ray.intersectObject(near, false)[0]) return "miss";
        }
        const breaks = damage + pw >= 3.4;
        damage += pw;
        broken = breaks;
        // Aimed at the spot tapped (or the lid's front), straight away.
        aimAt(nx, ny, tgt, tgtN);
        cur.copy(tgt);
        curN.copy(tgtN);
        // Its sound, scheduled on the audio clock to be heard as it lands.
        playHit(pw, SWING);
        if (breaks) playBreak(SWING);
        if (SWING === 0) {
          land(pw, breaks);
          return "hit";
        }
        // The hammer swings from wherever it is.
        hold.phase = "swing";
        hold.t = 0;
        hold.from = Math.max(0.4, hold.theta);
        pending = { power: pw, breaks };
        return "hit";
      },
      point: (nx, ny, touch) => {
        point.nx = nx;
        point.ny = ny;
        point.t = t;
        point.touch = touch;
        point.seen = true;
        if (fine && !touch) {
          hover.x = nx;
          hover.y = ny;
          hover.dirty = true;
        }
      },
      hold: (on) => {
        spin.held = on;
      },
      turn: (what, dx = 0, dy = 0) => {
        if (!opened || openT < 0.9) return;
        const now = performance.now();
        if (what === "take") {
          if (!mine.on) mine.q.copy(coin.quaternion);
          else if (mine.back > 0) mine.q.copy(coin.quaternion);
          mine.on = mine.taken = true;
          mine.wx = mine.wy = mine.back = mine.since = 0;
          mine.t = now;
        } else if (what === "move") {
          if (!mine.on) return;
          const ms = Math.max(8, now - mine.t) / 1000;
          mine.t = now;
          pull(dx, dy);
          mine.wx += (Math.max(-9, Math.min(9, dx / ms)) - mine.wx) * 0.4;
          mine.wy += (Math.max(-9, Math.min(9, dy / ms)) - mine.wy) * 0.4;
        } else {
          mine.taken = false;
          mine.since = 0;
          // (Held still before it was let go: it stays.)
          if (now - mine.t > 110) mine.wx = mine.wy = 0;
        }
      },
      under: (px) => {
        if (Math.abs(px - above) < 2) return;
        above = px;
        fit();
      },
      onVerse: (nx, ny) => {
        ray.setFromCamera(ndc.set(nx, ny), camera);
        if (ray.intersectObject(near, false)[0]) return false;
        if (!ray.ray.intersectPlane(wallP, at)) return false;
        return hall.verse.some((r) => Math.abs(at.x - r.x) < r.w + 0.12 && Math.abs(at.y - r.y) < r.h + 0.1);
      },
      lost: () => dead || renderer.getContext().isContextLost(),
      dispose: () => {
        if (dead) return;
        dead = true;
        unguard();
        gpu.dispose();
        cancelAnimationFrame(raf);
        ro.disconnect();
        hall.dispose();
        struck.dispose();
        lens?.dispose();
        scene.traverse((c) => {
          const m = c as Mesh;
          if (m.geometry) m.geometry.dispose();
          const mat = m.material as InstanceType<T3["MeshStandardMaterial"]> | undefined;
          if (mat && "map" in mat) {
            mat.map?.dispose();
            mat.normalMap?.dispose();
            mat.roughnessMap?.dispose();
            mat.metalnessMap?.dispose();
            mat.aoMap?.dispose();
          }
          mat?.dispose?.();
        });
        const rest: (M3 | null)[] = [contactMat, coinMat, pileMat, dentMat, glowMat, beamMat, moteMat, spMat, hdMat, puffMat, contactTex, soft, moteTex, puffTex, dentTex, dentNor, fDiff, fNor, fArm, tWx, tWy, tWc, tWh, tVerse, tTiny, tGold, tStone, tStoneN, tFront, tBack, tEnv, dentGeo, coinGeo, envRT];
        rest.forEach((x) => x?.dispose());
        renderer.dispose();
        // Free the context NOW: a closed award room must not keep holding one
        // of the phone's few (it used to linger until garbage collection).
        renderer.forceContextLoss();
        canvas.remove();
      },
    };
    return room;
  } catch (e) {
    if (!dead) bail();
    throw e;
  }
}
