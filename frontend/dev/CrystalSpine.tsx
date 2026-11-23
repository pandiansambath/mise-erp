"use client";

// The crystal spine: the divider the cards revolve round.
//
//   "the centre divider skeleton crystal is not nice… a bit artificial, looks
//    very simple… see the active theory crystal skeleton divider, how
//    realistic… put more effort"
//   "see how these come when I scroll… like in movies when superheroes show
//    their full power, all moving from down into the air"
//
// A column of vertebrae grown in 3D: lumpy rounded bodies with wings and a
// spur, thin discs between them, crystal shards and thorns breaking out of
// the bone — dark glass under a film of rainbow (iridescence and a clear coat
// over a room's reflections), lit from either side by the theme's colours.
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
// One small WebGL canvas, sticky in the divider's lane (ChainSpine): it stays
// on screen while the column passes and draws only while it is on screen.
// The lane reaches SPINE_TAIL px below the column, for the hanging chain.
// The vertebrae are laid out in the column's own coordinates, so they travel
// with the page, and the spine grows out of nothing at the column's two ends.

import type { BufferGeometry } from "three";
import { useEffect, useRef, type RefObject } from "react";
import { readRGB, THEME_EVENT } from "./theme";

/** One vertebra every STEP px down the column. */
const STEP = 17;
/** Bone, disc, thorned bone, disc, bone, disc, crystal cluster, disc. */
const PATTERN = [0, 1, 2, 1, 0, 1, 3, 1];

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

  useEffect(() => {
    const el = canvas.current;
    const col = column.current;
    if (!el || !col) return;
    let dead = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import("three");
      const { mergeGeometries, mergeVertices } = await import("three/examples/jsm/utils/BufferGeometryUtils.js");
      if (dead) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const wide = window.matchMedia("(min-width: 1024px)");

      const renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.95;
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

      // ── The bones (built once) ────────────────────────────────────────
      type Geo = BufferGeometry;
      const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
      // A smooth, lumpy body: an icosphere pushed in and out by a few waves.
      const blob = (detail: number, sx: number, sy: number, sz: number, s: number, rough = 0.2): Geo => {
        let g: Geo = new THREE.IcosahedronGeometry(1, detail);
        g.deleteAttribute("normal");
        g.deleteAttribute("uv");
        g = mergeVertices(g);
        const p = g.getAttribute("position");
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i);
          const y = p.getY(i);
          const z = p.getZ(i);
          const n = 1 + rough * Math.sin(x * 3.1 + s) * Math.sin(y * 2.7 + s * 1.7) * Math.sin(z * 3.3 + s * 0.6) + rough * 0.4 * Math.sin(x * 6.3 + y * 5.1 + z * 4.2 + s * 2.3);
          p.setXYZ(i, x * n * sx, y * n * sy, z * n * sz);
        }
        g.computeVertexNormals();
        return g.toNonIndexed();
      };
      // A crystal shard: a long octahedron, cut in facets.
      const shard = (len: number, w: number): Geo => {
        const g: Geo = new THREE.OctahedronGeometry(1, 0);
        g.deleteAttribute("uv");
        g.scale(w, len, w);
        g.translate(0, len * 0.55, 0);
        g.computeVertexNormals();
        return g;
      };
      // A thorn: a five-sided cone, faceted, its base at the origin.
      const thorn = (len: number, r: number): Geo => {
        let g: Geo = new THREE.ConeGeometry(r, len, 5, 1);
        g.deleteAttribute("uv");
        g = g.toNonIndexed();
        g.translate(0, len / 2, 0);
        g.computeVertexNormals();
        return g;
      };
      const at = (g: Geo, pos: InstanceType<typeof THREE.Vector3>, rx = 0, ry = 0, rz = 0): Geo =>
        g.applyMatrix4(new THREE.Matrix4().compose(pos, new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), V(1, 1, 1)));
      const toward = (g: Geo, from: InstanceType<typeof THREE.Vector3>, dir: InstanceType<typeof THREE.Vector3>): Geo =>
        g.applyMatrix4(new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()), V(1, 1, 1)));

      const variants: Geo[] = [
        // A vertebra: the body, two wings reaching out and up, a spur behind,
        // and crystal breaking through.
        mergeGeometries([
          blob(3, 16, 9, 13, 1.3),
          at(blob(2, 12, 3.6, 5, 2.1), V(17, 1.5, -2), 0, 0, -0.22),
          at(blob(2, 12, 3.6, 5, 2.7), V(-17, 1.5, -2), 0, 0, 0.22),
          at(blob(2, 4, 4, 11, 3.3), V(0, -2, -14), 0.4, 0, 0),
          toward(shard(9, 2.2), V(6, 5, 7), V(0.5, 0.9, 0.4)),
          toward(shard(7, 1.8), V(-8, 4, 6), V(-0.6, 0.8, 0.3)),
        ]),
        // A disc between the bones, crystals round its rim.
        mergeGeometries([
          blob(2, 14, 3.2, 11.5, 4.4, 0.1),
          toward(shard(5, 1.4), V(12, 0, 3), V(1, 0.3, 0.2)),
          toward(shard(4.5, 1.3), V(-11, 0, -4), V(-1, 0.2, -0.3)),
          toward(shard(5.5, 1.5), V(2, 0, 10), V(0.2, 0.3, 1)),
          toward(shard(4, 1.2), V(-3, 0, -10), V(-0.1, 0.4, -1)),
        ]),
        // A bone with thorns.
        mergeGeometries([
          blob(3, 14.5, 8.5, 12.5, 5.5),
          toward(thorn(21, 2.2), V(-11, 3, 3), V(-0.9, 0.35, 0.3)),
          toward(thorn(17, 2), V(11, 4, -2), V(0.85, 0.5, -0.2)),
          toward(thorn(15, 1.8), V(1, 2, -11), V(0.1, 0.4, -1)),
          toward(shard(8, 2), V(4, 6, 8), V(0.3, 1, 0.5)),
          toward(shard(6, 1.7), V(-5, -5, 7), V(-0.4, -0.8, 0.5)),
        ]),
        // A druse: a small core with crystals bursting out of it.
        mergeGeometries([
          blob(2, 9, 6, 8, 6.6),
          toward(shard(14, 2.4), V(3, 2, 2), V(0.7, 0.8, 0.3)),
          toward(shard(12, 2.2), V(-3, 2, 1), V(-0.8, 0.7, 0.2)),
          toward(shard(15, 2.5), V(0, 3, -3), V(0.1, 0.9, -0.6)),
          toward(shard(10, 2), V(2, -2, 4), V(0.5, -0.4, 0.9)),
          toward(shard(11, 2.1), V(-2, -1, -4), V(-0.4, -0.3, -1)),
        ]),
      ];

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
      const CAP = Math.ceil(2200 / STEP) + 4;
      const meshes = variants.map((g) => {
        const m = new THREE.InstancedMesh(g, bone, CAP);
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
      const linkGeo = new THREE.TubeGeometry(new Stadium(9.5, 10.5), 64, 3.4, 10, true);
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
      const LCAP = Math.ceil((MORPH + SPINE_TAIL.sm + 120) / LINK_PITCH) + 4;
      const chainLinks = new THREE.InstancedMesh(linkGeo, linkMat, LCAP);
      chainLinks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      chainLinks.setColorAt(0, new THREE.Color(1, 1, 1));
      chainLinks.count = 0;
      chainLinks.frustumCulled = false;
      scene.add(chainLinks);
      const tintDark = new THREE.Color(0.08, 0.08, 0.12);
      const tintBright = new THREE.Color(0.8, 0.95, 0.92);
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
        uniforms: { uCol: { value: new THREE.Color(0.5, 0.95, 0.88) }, uGain: { value: 0.5 }, uH: { value: 1000 }, uPulseY: glow.uPulseY, uPulse: glow.uPulse },
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uCol;
          uniform float uGain, uH, uPulseY, uPulse;
          varying vec2 vP;
          void main() {
            float across = exp(-vP.x * vP.x / 18.0);
            float ends = smoothstep(-uH * 0.5, -uH * 0.5 + 120.0, vP.y) * (1.0 - smoothstep(uH * 0.5 - 120.0, uH * 0.5, vP.y));
            float surge = exp(-pow((vP.y - uPulseY) / 60.0, 2.0)) * uPulse;
            gl_FragColor = vec4(uCol, across * ends * (uGain + surge * 1.4));
          }`,
      });
      const core = new THREE.Mesh(new THREE.PlaneGeometry(26, 1), coreMat);
      core.position.z = -8;
      scene.add(core);

      // Light from either side in the theme's colours, drifting up and down
      // the bone so the rainbow on it never stands still.
      const keyA = new THREE.PointLight(0xffffff, 2.4, 0, 0);
      const keyB = new THREE.PointLight(0xffffff, 2.2, 0, 0);
      const rim = new THREE.DirectionalLight(0xffffff, 0.9);
      rim.position.set(0, 0.4, -1);
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
        envA.color = rgb("a2", [240, 160, 100]).multiplyScalar(2.2);
        envB.color = rgb("b2", [125, 240, 220]).multiplyScalar(2.2);
        envC.color = rgb("c", [155, 140, 255]).multiplyScalar(1.8);
        envGlint.color = new THREE.Color(1, 1, 1).multiplyScalar(light ? 2 : 3);
        relight();
        glow.uLitCol.value = rgb("b2", [125, 240, 220]).multiplyScalar(0.6);
        glow.uPulseCol.value = rgb("gold", [240, 189, 106]);
        coreMat.uniforms.uCol.value = rgb("b2", [125, 240, 220]);
        sparkMat.uniforms.uC0.value = rgb("a2", [240, 160, 100]);
        sparkMat.uniforms.uC1.value = rgb("b2", [125, 240, 220]);
        sparkMat.uniforms.uC2.value = rgb("c", [155, 140, 255]);
        sparkMat.uniforms.uC3.value = rgb("d", [244, 114, 182]);
        sparkMat.uniforms.uC4.value = rgb("gold", [240, 189, 106]);
        // Added light vanishes on paper: there the sparks and core are
        // painted, not added.
        const blend = light ? THREE.NormalBlending : THREE.AdditiveBlending;
        sparkMat.blending = blend;
        coreMat.blending = blend;
        sparkMat.needsUpdate = true;
        coreMat.needsUpdate = true;
        coreMat.uniforms.uGain.value = light ? 0.22 : 0.5;
        sparkMat.uniforms.uGain.value = light ? 0.8 : 1;
      };
      paint();
      window.addEventListener(THEME_EVENT, paint);

      let W = 1;
      let H = 1;
      let U = 1;
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
        U = wide.matches ? 1 : 1.25;
        sparkMat.uniforms.uH.value = H;
        sparkMat.uniforms.uDist.value = dist;
        sparkMat.uniforms.uR0.value = wide.matches ? 14 : 18;
        sparkMat.uniforms.uR1.value = wide.matches ? 92 : 130;
        sparkMat.uniforms.uLimit.value = wide.matches ? 34 : 150;
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
      const counts = [0, 0, 0, 0];
      let t = 0;
      let rise = 0;
      let power = 0;
      let pulseY = -99999;
      let pulse = 0;
      let skip = false;
      let prev = performance.now();
      let raf = 0;
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.06, (now - prev) / 1000);
        prev = now;
        if (!visible || document.hidden) return;
        const busy = now < busyUntil || (introStart > 0 && now - introStart < 2400);
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
        const k0 = Math.max(0, Math.floor((top - 80) / STEP));
        const k1 = Math.min(Math.floor(colH / STEP), Math.ceil((top + H + 80) / STEP));
        for (let k = k0; k <= k1; k++) {
          const yCol = k * STEP + STEP / 2;
          const yCanvas = yCol - top;
          const v = PATTERN[k % PATTERN.length];
          // Out of nothing at the top; at the bottom they break apart and fall
          // away while the chain forms among them.
          const boneFade = 1 - smooth(colH - MORPH, colH - MORPH * 0.3, yCol);
          const scatter = 1 - boneFade;
          const ends = smooth(0, 110, yCol) * boneFade;
          // The first sight: bones rise into place from below, the lowest first.
          const delay = (1 - Math.min(1, Math.max(0, yCanvas / H))) * 0.7;
          const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, (intro - delay) / 0.9)), 3);
          const s = (0.9 + hash(k * 3.1) * 0.22) * ends * (0.15 + 0.85 * e) * U;
          if (s < 0.02) continue;
          dummy.position.set((hash(k * 7.3) - 0.5) * 46 * scatter, H * 0.5 - yCanvas - (1 - e) * 170 - scatter * 14, (hash(k * 8.1) - 0.5) * 30 * scatter);
          dummy.rotation.set((hash(k * 1.7) - 0.5) * (0.2 + scatter * 1.6), k * 0.42 + hash(k * 2.3) * 0.6 + spin, (hash(k * 5.1) - 0.5) * (0.24 + scatter * 1.4));
          dummy.scale.setScalar(s);
          dummy.updateMatrix();
          meshes[v].setMatrixAt(counts[v]++, dummy.matrix);
        }
        meshes.forEach((m, v) => {
          m.count = counts[v];
          m.instanceMatrix.needsUpdate = true;
        });
        // The chain: forming among the last bones, hanging on below the
        // column, swaying more the further it hangs, alternate links turned a
        // quarter so each passes through the next, a light running down it.
        const tail = sm.matches ? SPINE_TAIL.sm : SPINE_TAIL.narrow;
        const yStart = colH - MORPH * 0.85;
        const yEnd = colH + tail - 15;
        const flowSpan = yEnd - yStart + 140;
        const flowY = yStart - 70 + ((t * 150) % flowSpan);
        let nLinks = 0;
        for (let j = 0; nLinks < LCAP; j++) {
          const yL = yStart + j * LINK_PITCH;
          if (yL > yEnd) break;
          const yCanvas = yL - top;
          if (yCanvas < -80 || yCanvas > H + 80) continue;
          const grow = smooth(yStart, colH - MORPH * 0.35, yL);
          const fade = 1 - smooth(yEnd - 56, yEnd, yL);
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
        keyA.position.set(-80, Math.sin(t * 0.5) * H * 0.36, 90);
        keyB.position.set(84, Math.cos(t * 0.41) * H * 0.36, 70);
        sparkMat.uniforms.uTime.value = t;
        sparkMat.uniforms.uRise.value = rise;
        sparkMat.uniforms.uPower.value = power;
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
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
  }, [column]);

  return <canvas ref={canvas} aria-hidden className="pointer-events-none sticky top-0 block h-[100dvh] w-full" />;
}
