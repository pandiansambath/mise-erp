"use client";

// The crystal spine: the divider the cards revolve round.
//
//   "the centre divider skeleton crystal is not nice… a bit artificial, looks
//    very simple… see the active theory crystal skeleton divider, how
//    realistic… put more effort"
//   "see how these come when I scroll… like in movies when superheroes show
//    their full power, all moving from down into the air"
//
// A column of real vertebrae (§103.6, spineBone.ts: "so natural, detailed and
// wholesome, with a crystal-clear skeleton… ours is a bit small"), crystal discs
// between them — dark glass under a film of rainbow (iridescence and a clear coat
// over a room's reflections), lit from either side by the theme's colours and from
// within by the cord's light, shining through wherever the bone is thin.
// The column twists as it climbs and turns as you scroll. The part you have
// read past glows a little (the chain reaction, lighting card by card), and
// every scroll sends a surge of light up the bone.
//
// Round it, sparks in the theme's colours stream upward like heat off a fire;
// when you scroll they surge and brighten — the power-up. When the spine
// first comes into view its bones rise into place from below.
//
// THE END OF THE SPINE (22 Nov, late): "where the skeleton ends and the chain
// area is shown, in between, feels so empty… I can literally see the end of
// the skeleton bottom". So the skeleton becomes the chain: over its last
// stretch the vertebrae break apart and fall away while interlocking links of
// iridescent metal form among them — dark like the bone at first, brighter
// as they go — and the chain hangs on below the column, swaying, a light
// running down it, until it fades out just above the finale, where the chain
// that frames his slogan is forged from light.
//
// THE PORTAL (23 Nov): "the start of the divider skeleton… use that dust
// kind of particle, like a portal opening… that pulls up… so so so realistic…
// currently the starting of the skeleton feels like a cut, a perfect cut". The
// column no longer simply begins: it rises out of a portal — dust spiralling
// in a disc seen in perspective, faster and hotter towards its heart, a rim of
// light round it, and more dust drawn UP into it from round the first bones,
// which condense out of the dust (small, loose, pulled up) before they settle
// into the column. It opens when the spine first comes into view. The
// beginning answers the end: a portal at the top, the pool of light below.
//
// One small WebGL canvas, sticky in the divider's lane (ChainSpine): it stays
// on screen while the column passes and draws only while it is on screen.
// The lane reaches SPINE_HEAD px above the column (the portal) and, below it,
// as far as the finale's surface (measured: ChainSpine's data-tail).
// The vertebrae are laid out in the column's own coordinates, so they travel
// with the page, and the spine grows out of nothing at the column's two ends.

import { useEffect, useRef, type RefObject } from "react";
import { readRGB, THEME_EVENT } from "./theme";
import { guardCanvas } from "./glGuard";
import { BURST, burstGalaxy } from "./GalaxyBurst";
import { pixelRatio, watchGpu } from "./sharp";
import { useComeBack } from "./useComeBack";
import { bakedSpine } from "./spineBake";
import { BONE_AXIS, BONE_PITCH, BONE_UNIT, boneGrain, crystalDisc, loadBone } from "./spineBone";

/** A vertebra's unit (half its body's width), in CSS px: with the cards either side
 *  of a desktop's column, and behind the cards on a phone. */
const boneSize = () => (window.matchMedia("(min-width: 1280px)").matches ? 39 : window.matchMedia("(min-width: 1024px)").matches ? 29 : 45);

/** How far the lane — and the chain — reach below the column: across the gap
 *  (the finale's top margin: 48 px, 64 px from sm) and just through its
 *  surface of light, where the last links fade as if under water. */
export const SPINE_TAIL = { narrow: 62, sm: 78 };
/** The stretch of the column, at its end, where bone gives way to chain —
 *  begun as the last card turns away, so its empty place holds the chain. */
const MORPH = 320;
/** Centre to centre between links: each passes through the next one's loop. */
const LINK_PITCH = 32;

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export function CrystalSpine({ column }: { column: RefObject<HTMLElement | null> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // The easter egg (§102.5): where the galaxy's heart is on the screen, its
  // colours, and when it was last touched — shared with the render loop.
  const heartAt = useRef({ x: 0, y: 0, r: 100, ok: false });
  const tint = useRef<{ cols: [number, number, number][]; light: boolean }>({ cols: [], light: false });
  const burstAt = useRef(-1);
  // Taken away by a browser that keeps few contexts: asked for again (§103.9).
  const { gen, gone } = useComeBack({ tries: 2, after: 2400 });

  useEffect(() => {
    const el = canvas.current;
    const col = column.current;
    if (!el || !col) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      if (dead) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wide = window.matchMedia("(min-width: 1024px)");

      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: "high-performance" });
      // Taken away by the browser (a phone's few contexts): hide, never white.
      const unguard = guardCanvas(el, gone);
      // The screen's own resolution on a phone too (§102.7; it was 1×).
      renderer.setPixelRatio(pixelRatio("spine", !wide.matches));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.02;
      const scene = new THREE.Scene();
      // What the glass reflects: not a bright room (that turned the bones to
      // white porcelain — every curve catches a white rim) but the dark, with
      // a few panels of the theme's light in it, so the bone stays dark and
      // throws coloured light at its edges, as Active Theory's does.
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envScene = new THREE.Scene();
      envScene.background = new THREE.Color(0x020207);
      const panel = (w: number, h: number, x: number, y: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
        m.position.set(x, y, z);
        m.lookAt(0, 0, 0);
        envScene.add(m);
        return m.material as InstanceType<typeof THREE.MeshBasicMaterial>;
      };
      const envA = panel(2.6, 9, -5, 1, 2.5);
      const envB = panel(2.6, 9, 5, -1, 1.5);
      const envC = panel(9, 1.6, 0, 6, -2);
      const envGlint = panel(1.1, 1.1, 1.6, 2.2, 6);
      let envTex: InstanceType<typeof THREE.Texture> | null = null;
      const relight = () => {
        envTex?.dispose();
        envTex = pmrem.fromScene(envScene, 0.02).texture;
        scene.environment = envTex;
      };
      // One unit is one CSS pixel at the spine's depth (see fit()).
      const FOV = 28;
      const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);

      // ── The bones (modelled offline; a phone's have half the triangles) ──
      const big = wide.matches;
      const [boneA, boneB] = await Promise.all((big ? ["a", "b"] : ["a_s", "b_s"]).map((n) => loadBone(THREE, `/dev/spine/bone_${n}.bin`).catch(() => null)));
      if (dead) {
        unguard();
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        return;
      }
      const discGeo = crystalDisc(THREE, big);
      // (Should a bone not come, its place is a disc's.)
      const variants = [boneA ?? discGeo, boneB ?? boneA ?? discGeo, discGeo];
      const grain = boneGrain(THREE);

      // Dark glass, not chrome: little metal, a thin film that throws rainbow
      // at the edges, a modest room in it — the white came from a bright room
      // reflected twice (clear coat on top of a shiny base).
      // An oil-slick film on dark bone: the rainbow Active Theory's skeleton
      // throws at every curve (22 Nov, evening: "even more natural… see how
      // detailed").
      const bone = new THREE.MeshPhysicalMaterial({
        color: 0x16151f,
        metalness: 0.45,
        roughness: 0.13,
        iridescence: 1,
        iridescenceIOR: 1.75,
        iridescenceThicknessRange: [200, 900],
        clearcoat: 0.6,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.5,
      });
      // The part read past glows (uLine: the reading line, world y), and a
      // surge of light climbs the bone with every scroll (uPulseY).
      const glow = {
        uLine: { value: 0 },
        uLit: { value: 0.12 },
        uLitCol: { value: new THREE.Color(0.5, 0.95, 0.88) },
        uPulseY: { value: -9999 },
        uPulse: { value: 0 },
        uPulseCol: { value: new THREE.Color(1, 0.85, 0.5) },
      };
      bone.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, glow);
        shader.vertexShader = shader.vertexShader
          .replace("#include <common>", "#include <common>\nvarying float vWy;")
          .replace(
            "#include <project_vertex>",
            "#include <project_vertex>\n  vec4 wyP = vec4(transformed, 1.0);\n  #ifdef USE_INSTANCING\n  wyP = instanceMatrix * wyP;\n  #endif\n  vWy = (modelMatrix * wyP).y;",
          );
        shader.fragmentShader = shader.fragmentShader
          .replace("#include <common>", "#include <common>\nvarying float vWy;\nuniform float uLine, uLit, uPulseY, uPulse;\nuniform vec3 uLitCol, uPulseCol;")
          .replace(
            "#include <emissivemap_fragment>",
            "#include <emissivemap_fragment>\n  float litAbove = smoothstep(uLine - 40.0, uLine + 40.0, vWy);\n  float surge = exp(-pow((vWy - uPulseY) / 34.0, 2.0)) * uPulse;\n  totalEmissiveRadiance += uLitCol * litAbove * uLit + uPulseCol * surge;",
          );
      };
      const CAP = Math.ceil(2600 / (29 * BONE_PITCH)) + 6;
      // Light from either side in the theme's colours, drifting up and down
      // the bone so the rainbow on it never stands still.
      const keyA = new THREE.PointLight(0xffffff, 2.4, 0, 0);
      const keyB = new THREE.PointLight(0xffffff, 2.2, 0, 0);
      const rim = new THREE.DirectionalLight(0xffffff, 0.9);
      rim.position.set(0, 0.4, -1);
      const linkMat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 1,
        roughness: 0.18,
        iridescence: 1,
        iridescenceIOR: 1.8,
        iridescenceThicknessRange: [220, 820],
        clearcoat: 0.7,
        clearcoatRoughness: 0.1,
        envMapIntensity: 1.5,
      });
      const tintDark = new THREE.Color(0.08, 0.08, 0.12);
      const tintBright = new THREE.Color(0.8, 0.95, 0.92);
      // The materials worked out once a theme (spineBake), not at every pixel of
      // every bone — a third of the GPU's time for the same look (§102.7), which
      // is what their detail is paid with.
      const inner = { value: new THREE.Color(0.5, 0.95, 0.88) };
      const baked = bakedSpine(THREE, renderer, { bone, link: linkMat, glow, lights: { a: keyA, b: keyB, rim }, tints: { dark: tintDark, bright: tintBright }, room: () => envTex, grain, inner, fine: big });
      const meshes = variants.map((g) => {
        const m = new THREE.InstancedMesh(g, baked.bone, CAP);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0;
        m.frustumCulled = false;
        scene.add(m);
        return m;
      });

      // ── The chain the skeleton becomes ──
      class Stadium extends THREE.Curve<InstanceType<typeof THREE.Vector3>> {
        constructor(
          private r: number,
          private half: number,
        ) {
          super();
        }
        getPoint(t: number, target = new THREE.Vector3()) {
          const { r, half } = this;
          const straight = 2 * half;
          const arc = Math.PI * r;
          let d = t * (2 * straight + 2 * arc);
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
      const linkGeo = new THREE.TubeGeometry(new Stadium(9.5, 10.5), 64, 3.4, 12, true);
      // Room for a long measured tail (a tall screen's gap to the finale).
      const LCAP = Math.ceil((MORPH + 560 + 120) / LINK_PITCH) + 4;
      const chainLinks = new THREE.InstancedMesh(linkGeo, baked.link, LCAP);
      chainLinks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      chainLinks.setColorAt(0, new THREE.Color(1, 1, 1));
      chainLinks.count = 0;
      chainLinks.frustumCulled = false;
      scene.add(chainLinks);
      const tmpC = new THREE.Color();
      const qUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      const qTurn = new THREE.Quaternion();
      const qSway = new THREE.Quaternion();
      const AXIS_Y = new THREE.Vector3(0, 1, 0);
      const AXIS_Z = new THREE.Vector3(0, 0, 1);
      const sm = window.matchMedia("(min-width: 640px)");

      // The light inside: a soft core behind the bones, seen in the gaps.
      const coreMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        // uTop: the column's top (scene y) — the light rises out of the
        // portal's heart there, not through it.
        uniforms: { uCol: { value: new THREE.Color(0.5, 0.95, 0.88) }, uGain: { value: 0.5 }, uH: { value: 1000 }, uTop: { value: 1e5 }, uPulseY: glow.uPulseY, uPulse: glow.uPulse },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          varying float vY;
          void main() {
            vP = position.xy;
            vY = (modelMatrix * vec4(position, 1.0)).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uCol;
          uniform float uGain, uH, uTop, uPulseY, uPulse;
          varying vec2 vP;
          varying float vY;
          void main() {
            float across = exp(-vP.x * vP.x / 26.0) + 0.16 * exp(-vP.x * vP.x / 420.0);
            float ends = smoothstep(-uH * 0.5, -uH * 0.5 + 120.0, vP.y) * (1.0 - smoothstep(uH * 0.5 - 120.0, uH * 0.5, vP.y));
            float below = 1.0 - smoothstep(uTop - 12.0, uTop + 36.0, vY);
            float surge = exp(-pow((vP.y - uPulseY) / 60.0, 2.0)) * uPulse;
            gl_FragColor = vec4(uCol, across * ends * below * (uGain + surge * 1.4));
          }`,
      });
      const core = new THREE.Mesh(new THREE.PlaneGeometry(110, 1), coreMat);
      core.position.z = -8;
      scene.add(core);

      scene.add(keyA, keyB, rim, new THREE.AmbientLight(0xffffff, 0.06));

      // ── The sparks rising round it ────────────────────────────────────
      // Two kinds: fast sparks streaming up, and a dense, slow sleeve of
      // bokeh and bubbles clinging round the bone (the clusters of colour
      // round Active Theory's spine).
      const P = still ? 160 : wide.matches ? 900 : 600;
      const pseed = new Float32Array(P * 4);
      for (let i = 0; i < P * 4; i++) pseed[i] = Math.random();
      const pgeo = new THREE.BufferGeometry();
      // Positions are made in the shader; three still wants a position attribute.
      pgeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P * 3), 3));
      pgeo.setAttribute("seed", new THREE.BufferAttribute(pseed, 4));
      const sparkMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uRise: { value: 0 },
          uPower: { value: 0 },
          uH: { value: 1000 },
          uDist: { value: 2000 },
          uRatio: { value: renderer.getPixelRatio() },
          uR0: { value: 14 },
          uR1: { value: 90 },
          uLimit: { value: 36 },
          uGain: { value: 1 },
          uC0: { value: new THREE.Color(1, 0.6, 0.4) },
          uC1: { value: new THREE.Color(0.5, 0.95, 0.88) },
          uC2: { value: new THREE.Color(0.6, 0.55, 1) },
          uC3: { value: new THREE.Color(0.96, 0.45, 0.71) },
          uC4: { value: new THREE.Color(0.94, 0.74, 0.42) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          uniform float uTime, uRise, uPower, uH, uDist, uRatio, uR0, uR1, uLimit;
          varying float vA;
          varying float vPick;
          varying float vRing;
          void main() {
            float span = uH + 240.0;
            // The sleeve (about 60%) hugs the bone and climbs slowly; the
            // sparks range wider and stream up fast.
            float sleeve = step(seed.w, 0.6);
            float climb = mix(0.55 + seed.x * 0.9, 0.08 + seed.x * 0.12, sleeve);
            // Up, always: from below the canvas to above it, then round again.
            float y = mod(seed.y * span + uRise * climb, span) - 120.0;
            float turn = seed.x > 0.5 ? 1.0 : -1.0;
            float ang = seed.z * 6.2831 + uTime * mix(0.25 + seed.w * 0.45, 0.12 + seed.x * 0.2, sleeve) * turn + y * 0.006;
            float rad = mix(uR0 + pow(seed.w, 1.7) * uR1, uR0 * 0.6 + pow(seed.x, 2.0) * uR0 * 1.6, sleeve);
            vec3 p = vec3(cos(ang) * rad, y - uH * 0.5, sin(ang) * rad);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            float size = mix(1.8 + seed.x * seed.x * 6.5, 2.5 + pow(seed.z, 2.0) * 9.0, sleeve) * (1.0 + uPower * 0.4);
            vRing = sleeve * step(0.62, seed.y);
            gl_PointSize = size * uRatio * (uDist / -mv.z);
            float ends = smoothstep(-120.0, 80.0, y) * (1.0 - smoothstep(uH - 120.0, uH + 120.0, y));
            // Off the words: past the lane the sparks are only a glimmer.
            float lane = 1.0 - smoothstep(uLimit, uLimit + 60.0, abs(p.x));
            float behind = 0.5 + 0.5 * smoothstep(-rad, rad, p.z);
            float twinkle = 0.7 + 0.3 * sin(uTime * 3.0 + seed.z * 40.0);
            // (the sleeve is many and close together: quieter each, so where
            // they overlap the light stays coloured instead of burning white)
            vA = ends * mix(0.22, 1.0, lane) * behind * twinkle * (0.45 + 0.55 * seed.z) * (0.7 + uPower * 0.6) * mix(1.0, 0.55, sleeve);
            vPick = seed.w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1, uC2, uC3, uC4;
          uniform float uGain;
          varying float vA;
          varying float vPick;
          varying float vRing;
          void main() {
            // A soft hexagon, like light through a lens — or a bubble.
            vec2 q = abs((gl_PointCoord - 0.5) * 2.0);
            float h = max(dot(q, vec2(0.8660254, 0.5)), q.y);
            float a = smoothstep(1.0, 0.72, h);
            float bubble = smoothstep(1.0, 0.84, h) * smoothstep(0.5, 0.74, h) + smoothstep(0.4, 0.0, h) * 0.18;
            a = mix(a, bubble, vRing);
            float hot = smoothstep(0.55, 0.0, h) * (1.0 - vRing);
            vec3 col = vPick < 0.2 ? uC0 : vPick < 0.4 ? uC1 : vPick < 0.6 ? uC2 : vPick < 0.8 ? uC3 : uC4;
            gl_FragColor = vec4(col + hot * 0.35, a * vA * uGain);
          }`,
      });
      const sparks = new THREE.Points(pgeo, sparkMat);
      sparks.frustumCulled = false;
      scene.add(sparks);

      // ── The portal at the top ─────────────────────────────────────────
      // A disc of dust spiralling in (seen in perspective, faster towards its
      // heart) and an updraft drawn up into it from round the first bones.
      const PD = still ? 0 : wide.matches ? 560 : 420;
      const PU = still ? 0 : wide.matches ? 320 : 240;
      const PN = PD + PU;
      const poSeed = new Float32Array(PN * 4);
      const poKind = new Float32Array(PN);
      for (let i = 0; i < PN; i++) {
        for (let c = 0; c < 4; c++) poSeed[i * 4 + c] = Math.random();
        poKind[i] = i < PD ? 0 : 1;
      }
      const pogeo = new THREE.BufferGeometry();
      pogeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(Math.max(1, PN) * 3), 3));
      pogeo.setAttribute("seed", new THREE.BufferAttribute(poSeed, 4));
      pogeo.setAttribute("kind", new THREE.BufferAttribute(poKind, 1));
      const portalMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpen: { value: 0 },
          uY: { value: 0 },
          uR: { value: 100 },
          uRatio: { value: renderer.getPixelRatio() },
          uDist: { value: 2000 },
          uGain: { value: 1 },
          uC0: { value: new THREE.Color(0.5, 0.95, 0.88) },
          uC1: { value: new THREE.Color(1, 0.6, 0.4) },
          uC2: { value: new THREE.Color(0.6, 0.55, 1) },
          uHot: { value: new THREE.Color(0.94, 0.74, 0.42) },
        },
        vertexShader: /* glsl */ `
          attribute vec4 seed;
          attribute float kind;
          uniform float uTime, uOpen, uY, uR, uRatio, uDist;
          varying float vA;
          varying float vHot;
          varying float vPick;
          void main() {
            vec3 p;
            float a;
            float size;
            if (kind < 0.5) {
              // The disc: dust drifting in along two slow spiral arms (§102.4:
              // "it's moving very very fast… make it smooth"). Its angle is a
              // steady turn of the whole disc PLUS a twist that grows as a
              // grain falls in: a function of how far in it is, never of the
              // clock. (It was clock × the speed at its radius, so as a grain
              // fell in, the rise in its speed was multiplied by the page's
              // whole age: the heart whirled faster the longer you stayed,
              // hundreds of radians a second after a minute.) Now the disc
              // turns once in ~75 s; a grain at the heart once in ~15 s at most.
              float life = 16.0 + seed.x * 18.0;
              float ph = fract(uTime / life + seed.y);
              float r = uR * mix(1.0, 0.07, pow(ph, 1.35)) * (0.75 + 0.25 * seed.w);
              float pick = fract(sin(dot(seed.xy, vec2(12.9898, 78.233))) * 43758.5453);
              float th0 = pick < 0.64 ? step(0.5, seed.z) * 3.14159 + (fract(seed.z * 2.0) - 0.5) * 0.95 : seed.z * 6.2831;
              float th = th0 + uTime * 0.084 + pow(ph, 1.6) * 3.3;
              p = vec3(cos(th) * r, uY + sin(th) * r * 0.22, sin(th) * r * 0.55);
              vHot = 1.0 - r / uR;
              a = smoothstep(0.0, 0.1, ph) * (1.0 - smoothstep(0.82, 1.0, ph)) * (0.3 + 0.7 * vHot);
              // The far half of the disc a little dimmer.
              a *= 0.6 + 0.4 * smoothstep(-0.3, 0.3, sin(th));
              size = (1.3 + seed.w * 2.0) * (1.0 + vHot * 0.9);
            } else {
              // The updraft: dust drawn UP from round the first bones into it.
              float life = 7.0 + seed.x * 6.0;
              float ph = fract(uTime / life + seed.y);
              float drop = 50.0 + seed.z * 280.0;
              float spread = (seed.w - 0.5) * 2.0 * (26.0 + seed.z * 70.0);
              float e = ph * ph;
              float y = uY - drop * (1.0 - e);
              float x = spread * (1.0 - pow(ph, 0.75));
              float swirl = sin(ph * 8.0 + seed.x * 6.2831) * 9.0 * (1.0 - ph);
              p = vec3(x + swirl, y, (seed.y - 0.5) * 50.0 * (1.0 - ph));
              vHot = ph;
              a = smoothstep(0.0, 0.18, ph) * (1.0 - smoothstep(0.86, 1.0, ph)) * (0.35 + 0.65 * ph);
              size = 1.1 + seed.w * 1.7 + ph * 1.3;
            }
            // Opening: all of it grows out of the heart.
            p.x *= uOpen;
            p.z *= uOpen;
            p.y = uY + (p.y - uY) * uOpen;
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = size * uRatio * (uDist / -mv.z);
            vA = a * min(1.0, uOpen);
            vPick = seed.w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uC0, uC1, uC2, uHot;
          uniform float uGain;
          varying float vA;
          varying float vHot;
          varying float vPick;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float m = smoothstep(0.5, 0.0, d);
            vec3 c = vPick < 0.45 ? uC0 : vPick < 0.78 ? uC1 : uC2;
            c = mix(c, uHot, vHot * 0.55);
            gl_FragColor = vec4(c, m * vA * uGain);
          }`,
      });
      const portal = new THREE.Points(pogeo, portalMat);
      portal.frustumCulled = false;
      portal.renderOrder = 2;
      if (PN > 0) scene.add(portal);
      // Its heart: a glow, and a rim of light round the disc.
      const heartMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uOpen: { value: 0 },
          uGain: { value: 1 },
          uBoost: { value: 1 },
          uC0: portalMat.uniforms.uC0,
          uHot: portalMat.uniforms.uHot,
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform float uTime, uOpen, uGain, uBoost;
          uniform vec3 uC0, uHot;
          varying vec2 vUv;
          void main() {
            vec2 q = (vUv - 0.5) * 2.0;
            float d = length(q);
            float core = exp(-d * d * 9.0);
            float ang = atan(q.y, q.x);
            float rim = exp(-pow((d - 0.66) / 0.06, 2.0)) * (0.5 + 0.5 * sin(ang * 3.0 - uTime * 0.3));
            float k = core * 0.8 + rim * 0.45;
            gl_FragColor = vec4(mix(uC0, uHot, min(1.0, core * uBoost)), k * min(1.0, uOpen) * uGain * uBoost);
          }`,
      });
      const heart = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), heartMat);
      heart.position.z = -30;
      heart.renderOrder = 1;
      scene.add(heart);

      let light = false;
      const paint = () => {
        const root = el.closest(".dev-root") ?? document.documentElement;
        const rgb = (role: string, fb: [number, number, number]) => {
          const [r, g, b] = readRGB(root, role, fb);
          return new THREE.Color(r / 255, g / 255, b / 255);
        };
        const [br, bg, bb] = readRGB(root, "bg", [7, 10, 15]);
        light = (0.2126 * br + 0.7152 * bg + 0.0722 * bb) / 255 > 0.5;
        // Dark glass with a hint of the theme's third colour in it.
        bone.color = new THREE.Color(light ? 0x3d4050 : 0x13121b).lerp(rgb("c", [155, 140, 255]), light ? 0.14 : 0.2);
        keyA.color = rgb("a2", [240, 160, 100]);
        keyB.color = rgb("b2", [125, 240, 220]);
        rim.color = rgb("c", [155, 140, 255]);
        // The chain's first links are bone-dark; the rest bright metal.
        tintDark.copy(bone.color);
        tintBright.copy(rgb("b2", [125, 240, 220])).lerp(new THREE.Color(1, 1, 1), 0.55);
        // The panels the glass reflects, in this theme's light (brighter than
        // white: they are light sources).
        // (Part white: the film's own colours show in them.)
        const pale = new THREE.Color(1, 1, 1);
        envA.color = rgb("a2", [240, 160, 100]).lerp(pale, 0.4).multiplyScalar(2.2);
        envB.color = rgb("b2", [125, 240, 220]).lerp(pale, 0.4).multiplyScalar(2.2);
        envC.color = rgb("c", [155, 140, 255]).lerp(pale, 0.3).multiplyScalar(2);
        envGlint.color = new THREE.Color(1, 1, 1).multiplyScalar(light ? 2 : 3);
        relight();
        baked.bake();
        inner.value.copy(rgb("b2", [125, 240, 220])).multiplyScalar(light ? 0.5 : 0.62);
        glow.uLitCol.value = rgb("b2", [125, 240, 220]).multiplyScalar(0.6);
        glow.uPulseCol.value = rgb("gold", [240, 189, 106]);
        coreMat.uniforms.uCol.value = rgb("b2", [125, 240, 220]);
        sparkMat.uniforms.uC0.value = rgb("a2", [240, 160, 100]);
        sparkMat.uniforms.uC1.value = rgb("b2", [125, 240, 220]);
        sparkMat.uniforms.uC2.value = rgb("c", [155, 140, 255]);
        sparkMat.uniforms.uC3.value = rgb("d", [244, 114, 182]);
        sparkMat.uniforms.uC4.value = rgb("gold", [240, 189, 106]);
        portalMat.uniforms.uC0.value = rgb("b2", [125, 240, 220]);
        portalMat.uniforms.uC1.value = rgb("a2", [240, 160, 100]);
        portalMat.uniforms.uC2.value = rgb("c", [155, 140, 255]);
        portalMat.uniforms.uHot.value = rgb("gold", [240, 189, 106]);
        tint.current = {
          cols: [readRGB(root, "b2", [125, 240, 220]), readRGB(root, "a2", [240, 160, 100]), readRGB(root, "c", [155, 140, 255]), readRGB(root, "gold", [240, 189, 106])],
          light,
        };
        // Added light vanishes on paper: there the sparks and core are
        // painted, not added.
        const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        sparkMat.blending = blend;
        portalMat.blending = blend;
        heartMat.blending = blend;
        portalMat.needsUpdate = true;
        heartMat.needsUpdate = true;
        coreMat.blending = blend;
        sparkMat.needsUpdate = true;
        coreMat.needsUpdate = true;
        coreMat.uniforms.uGain.value = light ? 0.22 : 0.5;
        sparkMat.uniforms.uGain.value = light ? 0.8 : 1;
        portalMat.uniforms.uGain.value = light ? 0.75 : 1;
        heartMat.uniforms.uGain.value = light ? 0.5 : 1;
      };
      relight();
      // Built off the main thread, then painted.
      await baked.warm().catch(() => {});
      if (dead) {
        unguard();
        baked.dispose();
        grain.dispose();
        variants.forEach((g) => g.dispose());
        pmrem.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        return;
      }
      paint();
      window.addEventListener(THEME_EVENT, paint);

      const gpu = watchGpu(renderer, "spine", !wide.matches, (ratio) => {
        renderer.setPixelRatio(ratio);
        sparkMat.uniforms.uRatio.value = ratio;
        portalMat.uniforms.uRatio.value = ratio;
        dirty = true;
      });
      let W = 1;
      let H = 1;
      let U = 1;
      let unit = 39;
      let pitch = 55;
      const fit = () => {
        W = Math.max(1, el.clientWidth);
        H = Math.max(1, el.clientHeight);
        renderer.setSize(W, H, false);
        camera.aspect = W / H;
        const dist = H / (2 * Math.tan((FOV * Math.PI) / 360));
        camera.position.set(0, 0, dist);
        camera.near = Math.max(1, dist - 1500);
        camera.far = dist + 1500;
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
        // A phone's spine stands behind the cards: a little bigger, and its
        // sparks may roam wider.
        U = wide.matches ? 1.1 : 1.3;
        unit = boneSize();
        pitch = unit * BONE_PITCH;
        // Off the words: half the gap between the columns (a phone's is behind them).
        const gap = wide.matches ? (window.matchMedia("(min-width: 1280px)").matches ? 64 : 44) : 150;
        sparkMat.uniforms.uH.value = H;
        sparkMat.uniforms.uDist.value = dist;
        sparkMat.uniforms.uR0.value = unit * 0.92;
        sparkMat.uniforms.uR1.value = wide.matches ? 74 : 108;
        sparkMat.uniforms.uLimit.value = gap;
        portalMat.uniforms.uDist.value = dist;
        portalMat.uniforms.uR.value = Math.min(W * 0.46, wide.matches ? 104 : 124);
        coreMat.uniforms.uH.value = H;
        core.scale.set(1, H, 1);
        dirty = true;
      };
      let dirty = true;
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);

      let visible = false;
      let introStart = -1;
      const io = new IntersectionObserver(([e]) => {
        visible = e.isIntersecting;
        if (visible && introStart < 0) introStart = performance.now();
      });
      io.observe(el);

      let lastY = window.scrollY;
      let scrollV = 0;
      let busyUntil = 0;
      const onScroll = () => {
        const y = window.scrollY;
        scrollV = Math.min(40, scrollV + Math.abs(y - lastY) * 0.35);
        lastY = y;
        busyUntil = performance.now() + 1200;
        dirty = true;
      };
      window.addEventListener("scroll", onScroll, { passive: true });

      const dummy = new THREE.Object3D();
      const counts = [0, 0, 0];
      let t = 0;
      let rise = 0;
      let power = 0;
      let pulseY = -99999;
      let pulse = 0;
      let skip = false;
      let prev = performance.now();
      const born = prev;
      let raf = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.06, (now - prev) / 1000);
        prev = now;
        if (!visible || document.hidden) return;
        // The easter egg, while it plays: every frame.
        const bt = burstAt.current > 0 ? (now - burstAt.current) / 1000 : 99;
        const busy = now < busyUntil || (introStart > 0 && now - introStart < 2400) || bt < BURST.done;
        if (still && !dirty) return;
        // At rest the sparks drift slowly: half the frames are plenty.
        if (!busy && !dirty) {
          skip = !skip;
          if (skip) return;
        }
        dirty = false;
        if (!still) {
          t += dt;
          scrollV *= Math.exp(-dt * 3.2);
          power += (Math.min(1.5, scrollV / 14) - power) * (1 - Math.exp(-dt * 5));
          rise += dt * (26 + power * 150);
          // The surge: off from the bottom whenever you scroll, up the bone.
          if (pulseY > H * 0.5 + 140) pulseY = -99999;
          if (pulseY < -H) {
            if (power > 0.25) {
              pulseY = -H * 0.5 - 140;
              pulse = 1;
            }
          } else {
            pulseY += dt * (900 + power * 500);
          }
          pulse *= Math.exp(-dt * 0.6);
        }
        glow.uPulseY.value = pulseY;
        glow.uPulse.value = pulse * 0.9;

        // Where the column is, against the canvas.
        const cr = col.getBoundingClientRect();
        const kr = el.getBoundingClientRect();
        const top = kr.top - cr.top;
        const colH = cr.height;
        glow.uLine.value = H * 0.5 - (window.innerHeight * 0.62 - kr.top);
        const spin = still ? 0 : window.scrollY * 0.0016 + t * 0.05;
        const intro = introStart > 0 && !still ? (now - introStart) / 1000 : 9;
        counts.fill(0);
        const k0 = Math.max(0, Math.floor((top - 120) / pitch));
        const k1 = Math.min(Math.floor(colH / pitch), Math.ceil((top + H + 120) / pitch));
        const seat = (v: number, k: number, yCol: number, disc: boolean) => {
          const yCanvas = yCol - top;
          // Out of nothing at the top; at the bottom they break apart and fall
          // away while the chain forms among them.
          const boneFade = 1 - smooth(colH - MORPH, colH - MORPH * 0.3, yCol);
          const scatter = 1 - boneFade;
          // Out of the portal at the top: the first bones condense out of its
          // dust — small, loose, pulled up towards it — before they settle.
          const emerge = smooth(-20, 250, yCol);
          const loose = 1 - emerge;
          const ends = (0.1 + 0.9 * emerge) * boneFade;
          // The first sight: bones rise into place from below, the lowest first.
          const delay = (1 - Math.min(1, Math.max(0, yCanvas / H))) * 0.7;
          const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, (intro - delay) / 0.9)), 3);
          // A column of bones, not of beads: each a little its own, all in line,
          // the whole with a spine's long curves in it.
          const s = (disc ? 1 : 0.97 + hash(k * 3.1) * 0.06) * ends * (0.15 + 0.85 * e);
          if (s < 0.02) return;
          const drift = still ? 0 : Math.sin(t * 1.3 + k) * 8 * loose;
          const bend = Math.sin(yCol * 0.0034 + 0.6) * 0.1 + Math.sin(yCol * 0.0013 + 1.9) * 0.07;
          const lean = (Math.cos(yCol * 0.0034 + 0.6) * 0.1 * 0.0034 + Math.cos(yCol * 0.0013 + 1.9) * 0.07 * 0.0013) * unit;
          dummy.position.set(
            bend * unit + (hash(k * 7.3) - 0.5) * 90 * scatter + (hash(k * 9.7) - 0.5) * 70 * loose + drift,
            H * 0.5 - yCanvas - (1 - e) * 190 - scatter * 18 + loose * 26,
            (hash(k * 8.1) - 0.5) * 60 * scatter + (hash(k * 4.9) - 0.5) * 50 * loose,
          );
          dummy.rotation.set((hash(k * 1.7) - 0.5) * (0.05 + scatter * 1.6 + loose * 1.2), k * 0.085 + Math.sin(k * 0.31) * 0.16 + spin, lean + (hash(k * 5.1) - 0.5) * (0.04 + scatter * 1.4 + loose * 1.1), "YXZ");
          dummy.scale.setScalar(s * unit * BONE_UNIT);
          // It turns about the cord, behind its body.
          dummy.translateZ(-BONE_AXIS * unit * s);
          dummy.updateMatrix();
          if (counts[v] < CAP) meshes[v].setMatrixAt(counts[v]++, dummy.matrix);
        };
        for (let k = k0; k <= k1; k++) {
          const yCol = k * pitch + pitch / 2;
          seat(hash(k * 6.7) > 0.76 ? 1 : 0, k, yCol, false);
          seat(2, k, yCol + pitch / 2, true);
        }
        meshes.forEach((m, v) => {
          m.count = counts[v];
          m.instanceMatrix.needsUpdate = true;
        });
        // The chain: forming among the last bones, hanging on below the
        // column, swaying more the further it hangs, alternate links turned a
        // quarter so each passes through the next, a light running down it.
        // As far as the finale's surface (ChainSpine measures it).
        const tail = Number(el.parentElement?.dataset.tail) || (sm.matches ? SPINE_TAIL.sm : SPINE_TAIL.narrow);
        const yStart = colH - MORPH * 0.85;
        // The surface is 40 px above the lane's end (ChainSpine): links run on
        // past it and fade just below it — the chain goes INTO the water, it
        // does not stop short of it (QA, 23 Nov: 13–25 px short).
        const surfaceY = colH + tail - 40;
        const yEnd = surfaceY + 34;
        const flowSpan = yEnd - yStart + 140;
        const flowY = yStart - 70 + ((t * 150) % flowSpan);
        let nLinks = 0;
        for (let j = 0; nLinks < LCAP; j++) {
          const yL = yStart + j * LINK_PITCH;
          if (yL > yEnd) break;
          const yCanvas = yL - top;
          if (yCanvas < -80 || yCanvas > H + 80) continue;
          const grow = smooth(yStart, colH - MORPH * 0.35, yL);
          const fade = 1 - smooth(surfaceY + 6, surfaceY + 32, yL);
          const sc = grow * fade * U;
          if (sc < 0.02) continue;
          const hang = Math.max(0, yL - (colH - MORPH * 0.3));
          const amp = still ? 0 : Math.min(1, hang / 200) * (wide.matches ? 9 : 7);
          const ph = t * 0.9 - yL * 0.012;
          qTurn.setFromAxisAngle(AXIS_Y, (j % 2) * (Math.PI / 2) + spin * 0.6);
          qSway.setFromAxisAngle(AXIS_Z, Math.atan(amp * 0.012 * Math.cos(ph)));
          dummy.quaternion.copy(qSway).multiply(qTurn).multiply(qUp);
          dummy.position.set(amp * Math.sin(ph), H * 0.5 - yCanvas, 0);
          dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          chainLinks.setMatrixAt(nLinks, dummy.matrix);
          const metal = smooth(colH - MORPH * 0.6, colH + 40, yL);
          const band = Math.exp(-(((yL - flowY) / 38) ** 2));
          tmpC.copy(tintDark).lerp(tintBright, metal).multiplyScalar(1 + band * 1.6);
          chainLinks.setColorAt(nLinks, tmpC);
          nLinks++;
        }
        chainLinks.count = nLinks;
        chainLinks.instanceMatrix.needsUpdate = true;
        if (chainLinks.instanceColor) chainLinks.instanceColor.needsUpdate = true;
        // The core runs only where the column is.
        coreMat.uniforms.uGain.value = (light ? 0.22 : 0.5) * Math.min(1, colH / 300);
        keyA.position.set(-150, Math.sin(t * 0.5) * H * 0.36, 150);
        keyB.position.set(156, Math.cos(t * 0.41) * H * 0.36, 120);
        // The portal, at the column's top (canvas y = -top).
        const yTop = -top;
        coreMat.uniforms.uTop.value = H * 0.5 - yTop + (wide.matches ? 0 : 54);
        // On a phone the spine stands behind the cards and the first card
        // begins at the column's top: the portal is lifted into the space
        // above it, or the card would hide it (QA, 23 Nov).
        const lift = wide.matches ? 0 : 54;
        const showPortal = yTop - lift > -240 && yTop - lift < H + 220;
        portal.visible = showPortal && PN > 0;
        heart.visible = showPortal;
        if (showPortal) {
          // It opens as the spine first comes into view (a little past full,
          // then settling, like an iris).
          const o = still ? 1 : Math.min(1, Math.max(0, (intro - 0.05) / 1.1));
          const open = still ? 1 : 1 - Math.pow(1 - o, 3) + Math.sin(o * Math.PI) * 0.08;
          const R = portalMat.uniforms.uR.value as number;
          // Its own clock: real time, the same at rest (when every other frame
          // is skipped and the spine's `t` runs at half speed) as while the
          // page scrolls; it used to double its speed the moment you scrolled.
          const pt = (now - born) / 1000;
          // The easter egg's half (GalaxyBurst plays the rest to this clock):
          // it draws in, hands its dust to the page (which swells, bursts and
          // hangs there), its heart straining brighter and then flashing as it
          // goes, and re-forms out of its heart as the dust comes home.
          let bMul = 1;
          let boost = 1;
          if (bt < BURST.done) {
            if (bt < BURST.inhale) {
              const k = bt / BURST.inhale;
              bMul = 1 - 0.5 * k * k;
              boost = 1 + 0.8 * k;
            } else if (bt < BURST.burst) {
              const k = (bt - BURST.inhale) / (BURST.burst - BURST.inhale);
              bMul = 0.5 * Math.max(0, 1 - k * 5);
              boost = 1.8 + 1.1 * k + Math.sin(k * 40) * 0.2 * k;
            } else if (bt < BURST.reform) {
              bMul = 0;
              boost = 0.22 + 3.2 * Math.exp(-(bt - BURST.burst) * 6);
            } else {
              const k = Math.min(1, (bt - BURST.reform) / 1.3);
              bMul = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.12;
              boost = 0.25 + 0.75 * k + Math.sin(k * Math.PI) * 0.9;
            }
          }
          portalMat.uniforms.uY.value = H * 0.5 - yTop + lift;
          portalMat.uniforms.uTime.value = pt;
          portalMat.uniforms.uOpen.value = open * bMul;
          heart.position.y = H * 0.5 - yTop + lift;
          heart.scale.set(R * 2.5 * Math.max(0.001, open), R * 0.66 * Math.max(0.001, open), 1);
          heartMat.uniforms.uTime.value = pt;
          heartMat.uniforms.uOpen.value = open;
          heartMat.uniforms.uBoost.value = boost;
          heartAt.current.ok = o >= 1 && PN > 0;
        } else heartAt.current.ok = false;
        // Where its heart is on the screen (the easter egg's touch and burst).
        heartAt.current.x = kr.left + kr.width / 2;
        heartAt.current.y = cr.top - lift;
        heartAt.current.r = portalMat.uniforms.uR.value as number;
        sparkMat.uniforms.uTime.value = t;
        sparkMat.uniforms.uRise.value = rise;
        sparkMat.uniforms.uPower.value = power;
        gpu.begin();
        renderer.render(scene, camera);
        gpu.end();
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        unguard();
        gpu.dispose();
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener(THEME_EVENT, paint);
        window.removeEventListener("scroll", onScroll);
        variants.forEach((g) => g.dispose());
        meshes.forEach((m) => m.dispose());
        bone.dispose();
        linkGeo.dispose();
        linkMat.dispose();
        chainLinks.dispose();
        core.geometry.dispose();
        coreMat.dispose();
        pgeo.dispose();
        sparkMat.dispose();
        pogeo.dispose();
        portalMat.dispose();
        heart.geometry.dispose();
        heartMat.dispose();
        baked.dispose();
        grain.dispose();
        envTex?.dispose();
        envScene.traverse((o) => {
          const m = o as InstanceType<typeof THREE.Mesh>;
          if (m.isMesh) {
            m.geometry.dispose();
            (m.material as InstanceType<typeof THREE.Material>).dispose();
          }
        });
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
  }, [column, gen, gone]);

  // The easter egg: a touch at the galaxy's heart (and only there).
  const touch = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const now = performance.now();
    if (!heartAt.current.ok || (burstAt.current > 0 && now - burstAt.current < BURST.done * 1000)) return;
    burstAt.current = now;
    // A phone feels it: a tick as it draws in, a thump as it bursts.
    navigator.vibrate?.([10, 830, 45]);
    burstGalaxy(() => heartAt.current, tint.current.cols, tint.current.light, !window.matchMedia("(min-width: 1024px)").matches);
  };

  return (
    <>
      {/* 100lvh on a phone: one height whatever the address bar does (with
          100dvh its drawing surface was made anew each time the bar slid away,
          mid-scroll). */}
      <canvas key={gen} ref={canvas} aria-hidden className="pointer-events-none sticky top-0 block h-[100lvh] w-full lg:h-[100dvh]" />
      {/* The easter egg's touch: no mark on the page, only the galaxy's heart —
          SPINE_HEAD (130 px) down the lane, the portal lifted 54 px on a phone
          (as the loop draws it). Anything covering it takes the touch first. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        data-galaxy-heart
        onClick={touch}
        className="pointer-events-auto absolute left-1/2 top-[76px] h-16 w-28 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[50%] bg-transparent outline-none [-webkit-tap-highlight-color:transparent] lg:top-[130px] lg:h-12 lg:w-24"
      />
    </>
  );
}
