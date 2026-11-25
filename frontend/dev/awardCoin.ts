// His gold coin (§103.3: "make that gold coin still more detailing"), as a mint
// would strike it: both faces from height fields baked offline (public/dev/award/
// coin_a, coin_b — our own drawings), turned into normals on the GPU; the field
// polished to a mirror and everything standing on it frosted, as on a proof; a
// rounded rim, a border of beads, a reeded edge.
//
// Seen straight on it was one bright disc (§106.1: "that coin detailings I couldn't see
// clearly… from straight"): a mirror turned to you shows you the dark you stand in, so
// there the field goes deep, and a low light from one side that only the relief feels
// draws every letter and leaf on it, lit edge and dark edge — as a coin is photographed.
//
//   Front: ANNA UNIVERSITY · GOLD MEDALIST · 2023, a laurel, "1 GRAM FINE GOLD"
//          on an engine-turned ground.
//   Back:  PANDIAN SAMBATH · 17TH UNIVERSITY RANK, a temple lamp on an open book,
//          and the first words of Thirukkural 400 (learning, the wealth that
//          never perishes).

import type { Group, MeshStandardMaterial, Vector3, Sprite, SpriteMaterial, Texture, WebGLRenderer, WebGLRenderTarget } from "three";
import { reliefPass, type T3 } from "./awardHall";

// The height pictures: their depth, and where the field lies (0–1).
const DEPTH = 0.0246;
const FIELD = 24.9 / 255;
const INNER = 0.922;

export type Coin = {
  group: Group;
  /** Where the low light comes from that only its relief feels (view space): from the upper
   *  left, or from where one points. */
  rake: Vector3;
  /** Each frame while it is out: the glints that run over it. */
  step: (t: number, facing: number, up: number) => void;
  dispose: () => void;
};

/** A face's height as its normals (once). */
export const strikeFace = (THREE: T3, renderer: WebGLRenderer, height: Texture, phone: boolean) => {
  const size = phone ? 1024 : 2048;
  return reliefPass(THREE, renderer, height, { w: size, h: size, depth: DEPTH, width: 2, tall: 2, cavity: 3.2 });
};

export function buildCoin(THREE: T3, o: { env: Texture; front: WebGLRenderTarget; back: WebGLRenderTarget; phone: boolean }): Coin {
  const trash: { dispose: () => void }[] = [];
  const keep = <X extends { dispose: () => void }>(x: X): X => {
    trash.push(x);
    return x;
  };
  const group = new THREE.Group();

  // ── the two faces, very slightly dished ────────────────────────────────────
  const RINGS = 16;
  const SEG = 144;
  const face = keep(new THREE.BufferGeometry());
  {
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const DISH = 0.008;
    for (let i = 0; i <= RINGS; i++) {
      const r = (INNER * i) / RINGS;
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        pos.push(x, y, 0.046 + DISH * (r / INNER) ** 2);
        const s = (-2 * DISH * r) / (INNER * INNER);
        const l = Math.hypot(s, 1);
        nor.push((s * Math.cos(a)) / l, (s * Math.sin(a)) / l, 1 / l);
        uv.push(0.5 + x / 2, 0.5 + y / 2);
      }
    }
    const row = SEG + 1;
    for (let i = 0; i < RINGS; i++)
      for (let j = 0; j < SEG; j++) {
        const a = i * row + j;
        idx.push(a, a + row, a + row + 1, a, a + row + 1, a + 1);
      }
    face.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    face.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    face.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    face.setIndex(idx);
  }
  const rake = new THREE.Vector3(-0.64, 0.7, 0.32);
  const uRake = { value: rake };
  const struck = (face_: WebGLRenderTarget): MeshStandardMaterial => {
    const rt = keep(face_);
    const m = keep(new THREE.MeshStandardMaterial({ color: 0xffc65c, metalness: 1, roughness: 0.2, normalMap: rt.texture, envMap: o.env, envMapIntensity: 1.1 }));
    m.onBeforeCompile = (s) => {
      s.uniforms.uRake = uRake;
      s.fragmentShader = s.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform vec3 uRake;")
        // (It never burns out: its own bloom washed its letters away.)
        .replace(
          "#include <opaque_fragment>",
          /* glsl */ `
          float most = max( outgoingLight.r, max( outgoingLight.g, outgoingLight.b ) );
          outgoingLight *= min( 1.0, 0.92 / max( most, 1e-3 ) + 0.12 );
          #include <opaque_fragment>`,
        )
        .replace(
          "#include <color_fragment>",
          /* glsl */ `#include <color_fragment>
          vec4 struckAt = texture2D( normalMap, vNormalMapUv, -0.7 );
          // In the hollows gold is deeper and redder.
          diffuseColor.rgb *= mix( vec3( 0.5, 0.3, 0.12 ), vec3( 1.0 ), smoothstep( 0.35, 0.97, struckAt.b ) );`,
        )
        .replace(
          "#include <roughnessmap_fragment>",
          /* glsl */ `
          // The field is a mirror; what stands on it is frosted; what is cut into it, satin.
          float raised = smoothstep( ${(FIELD + 0.02).toFixed(4)}, ${(FIELD + 0.09).toFixed(4)}, struckAt.a );
          float cutIn = smoothstep( ${(FIELD - 0.012).toFixed(4)}, ${(FIELD - 0.045).toFixed(4)}, struckAt.a );
          float frost = fract( sin( dot( floor( vNormalMapUv * 1400.0 ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
          float roughnessFactor = mix( 0.1, 0.27 + 0.1 * frost, raised ) + 0.16 * cutIn;`,
        )
        .replace(
          "#include <normal_fragment_maps>",
          /* glsl */ `
          vec3 mapN;
          mapN.xy = ( struckAt.xy * 2.0 - 1.0 ) * normalScale;
          mapN.z = sqrt( max( 0.02, 1.0 - dot( mapN.xy, mapN.xy ) ) );
          normal = normalize( tbn * mapN );`,
        )
        .replace(
          "#include <aomap_fragment>",
          /* glsl */ `#include <aomap_fragment>
          float shade = smoothstep( 0.1, 0.95, struckAt.b );
          reflectedLight.indirectSpecular *= mix( 0.35, 1.0, shade );
          reflectedLight.directSpecular *= mix( 0.6, 1.0, shade );
          // Turned to you it is lit as a mint photographs a proof: its field a deep, dark mirror,
          // brighter towards the light; what stands on it frosted and bright; the wall of every
          // letter white on the side of the light and dark on the other; a line at its foot.
          // (The room's own lights are only its colour then: they laid one gold over all of it.)
          float facing = smoothstep( 0.1, 0.82, dot( nonPerturbedNormal, normalize( vViewPosition ) ) );
          float flat_ = 1.0 - raised;
          reflectedLight.indirectSpecular *= 1.0 - facing * ( 0.5 + 0.32 * flat_ );
          reflectedLight.directSpecular *= 1.0 - 0.88 * facing;
          vec3 rakeL = normalize( uRake );
          float rel = dot( normal, rakeL ) - dot( nonPerturbedNormal, rakeL );
          float lee = smoothstep( 0.02, 0.36, -rel );
          float sun = smoothstep( 0.02, 0.44, rel );
          float foot = 1.0 - smoothstep( 0.3, 0.92, struckAt.b );
          float sweep = 0.5 + 0.5 * dot( vNormalMapUv * 2.0 - 1.0, normalize( uRake.xy + 1e-3 ) );
          vec3 proof = mix( vec3( 0.046, 0.023, 0.005 ), vec3( 0.25, 0.138, 0.028 ), sweep * sweep );
          proof *= 1.0 - 0.62 * cutIn;
          proof = mix( proof, vec3( 0.8, 0.5, 0.135 ) * ( 0.76 + 0.24 * frost ) * ( 0.8 + 0.3 * sweep ), raised );
          proof = mix( proof, vec3( 1.2, 0.9, 0.46 ), sun * 0.9 );
          proof *= ( 1.0 - 0.84 * lee ) * ( 1.0 - 0.6 * foot * ( 1.0 - sun ) );
          reflectedLight.directSpecular += facing * proof;`,
        );
    };
    return m;
  };
  const front = new THREE.Mesh(face, struck(o.front));
  const back = new THREE.Mesh(face, struck(o.back));
  back.rotation.y = Math.PI;
  group.add(front, back);

  // ── the rim, rounded, and the reeded edge ──────────────────────────────────
  const gold = keep(new THREE.MeshStandardMaterial({ color: 0xffc65c, metalness: 1, roughness: 0.15, envMap: o.env, envMapIntensity: 1.15 }));
  // (Lit from the same side as the faces: one side of it bright, the other deep.)
  const rimLight = (m: MeshStandardMaterial) => {
    m.onBeforeCompile = (s) => {
      s.uniforms.uRake = uRake;
      s.fragmentShader = s.fragmentShader.replace("#include <common>", "#include <common>\nuniform vec3 uRake;").replace(
        "#include <aomap_fragment>",
        /* glsl */ `#include <aomap_fragment>
        vec3 rk = normalize( vec3( uRake.xy, 0.62 ) );
        float towards = dot( normal, rk );
        reflectedLight.indirectSpecular *= 0.55 + 0.45 * smoothstep( -0.4, 0.8, towards );
        reflectedLight.directSpecular *= 0.55;
        reflectedLight.directSpecular += vec3( 1.0, 0.65, 0.2 ) * ( pow( max( 0.0, dot( normalize( rk + normalize( vViewPosition ) ), normal ) ), 70.0 ) * 1.1 + 0.16 * smoothstep( 0.55, 1.0, towards ) );`,
      );
    };
  };
  rimLight(gold);
  const prof = [
    [0.914, 0.05],
    [0.922, 0.0535],
    [0.929, 0.0585],
    [0.937, 0.063],
    [0.948, 0.0658],
    [0.962, 0.0668],
    [0.976, 0.0655],
    [0.987, 0.0618],
    [0.9955, 0.0558],
    [1.0, 0.048],
  ]
    // (From the outside in: the way a lathe's faces look out. The other way round the lip on the
    // near side was not drawn, and one saw through the coin there.)
    .reverse()
    .map(([r, y]) => new THREE.Vector2(r, y));
  const lip = keep(new THREE.LatheGeometry(prof, SEG));
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(lip, gold);
    m.rotation.x = (side * Math.PI) / 2;
    m.castShadow = side === 1;
    group.add(m);
  }
  const REEDS = 128;
  const PER = o.phone ? 4 : 6;
  const edge = keep(new THREE.BufferGeometry());
  {
    const n = REEDS * PER;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a * REEDS);
      const r = 1 - 0.0055 * (1 - c);
      const dr = -0.0055 * REEDS * Math.sin(a * REEDS);
      const nx = r * Math.cos(a) + dr * Math.sin(a);
      const ny = r * Math.sin(a) - dr * Math.cos(a);
      const l = Math.hypot(nx, ny);
      for (const z of [0.0488, -0.0488]) {
        pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
        nor.push(nx / l, ny / l, 0);
      }
      if (i < n) {
        const k = i * 2;
        idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
      }
    }
    edge.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    edge.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    edge.setIndex(idx);
  }
  const edgeMat = keep(gold.clone());
  rimLight(edgeMat);
  edgeMat.roughness = 0.22;
  edgeMat.side = THREE.DoubleSide;
  const reeded = new THREE.Mesh(edge, edgeMat);
  reeded.castShadow = true;
  group.add(reeded);

  // ── glints: small stars where the metal catches the light ──────────────────
  const starTex = keep(
    (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 128;
      const g = c.getContext("2d")!;
      const core = g.createRadialGradient(64, 64, 0, 64, 64, 22);
      core.addColorStop(0, "rgba(255,255,255,1)");
      core.addColorStop(1, "rgba(255,240,200,0)");
      g.fillStyle = core;
      g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = "lighter";
      for (const [w, h] of [
        [3.2, 62],
        [62, 3.2],
      ]) {
        g.save();
        g.translate(64, 64);
        g.scale(w / 62, h / 62);
        const gr = g.createRadialGradient(0, 0, 0, 0, 0, 62);
        gr.addColorStop(0, "rgba(255,250,230,1)");
        gr.addColorStop(0.4, "rgba(255,225,150,.35)");
        gr.addColorStop(1, "rgba(255,210,120,0)");
        g.fillStyle = gr;
        g.beginPath();
        g.arc(0, 0, 62, 0, 7);
        g.fill();
        g.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })(),
  );
  const GLINTS: [number, number, number][] = [
    [0.915, 0.9, 0.2],
    [0.915, 2.45, 1.7],
    [0.96, 4.2, 3.1],
    [0.6, 2.1, 4.4],
    [0.79, 5.4, 5.2],
    [0.17, 1.3, 2.4],
  ];
  const glints: { s: Sprite; m: SpriteMaterial; ph: number }[] = GLINTS.map(([r, a, ph]) => {
    // (Light only: it adds, and covers nothing — also where the coin is drawn by itself.)
    const m = keep(new THREE.SpriteMaterial({ map: starTex, color: 0xffe9b8, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, transparent: true, depthWrite: false, depthTest: false, opacity: 0 }));
    const s = new THREE.Sprite(m);
    s.position.set(Math.cos(a) * r, Math.sin(a) * r, 0.09);
    s.scale.setScalar(0.34);
    s.renderOrder = 12;
    group.add(s);
    return { s, m, ph };
  });

  return {
    group,
    rake,
    step: (t, facing, up) => {
      for (const g of glints) {
        // Each flares for an instant, now and then, only while seen from its side.
        const w = Math.sin(t * 0.9 + g.ph * 2.7) * 0.5 + Math.sin(t * 1.7 + g.ph) * 0.5;
        const on = Math.max(0, w - 0.72) / 0.28;
        g.m.opacity = on * on * Math.max(0, facing) * up;
        g.s.scale.setScalar(0.2 + 0.26 * on);
        g.m.rotation = t * 0.2 + g.ph;
      }
    },
    dispose: () => {
      for (const x of trash) x.dispose();
    },
  };
}
