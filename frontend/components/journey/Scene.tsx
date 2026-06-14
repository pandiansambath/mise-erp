"use client";
/* eslint-disable react-hooks/immutability -- react-three-fiber's useFrame loop
   mutates three.js objects (camera, fog, materials, geometry) every frame BY
   DESIGN; that is the correct, performant R3F pattern, not a React state bug.
   The React-Compiler immutability rule doesn't model the imperative render loop. */

// The WebGL world for the landing journey. One long flight path; scroll drives
// the camera forward through a series of "stations" (hills → the one tree →
// cooking → a valley of dark kitchens → our glowing hotel → through its door →
// the money loop → open sky). Everything is procedural + low-poly so it loads
// instantly and holds 60fps on a phone. No external 3D assets, no postprocessing.

import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { damp, journeyProgress, journeySmooth, lerp, smoothstep, zAtProgress } from "./progress";

/* ────────────────────────── shared seeded RNG ───────────────────────────── */
// Deterministic so the world looks identical every load (and SSR-stable).
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ──────────────────────────── colour journey ────────────────────────────── */
// Sky-top / sky-bottom / fog colour at each point on the scroll track. The
// scene lerps between these so the mood travels dawn → day → warm interior →
// bright open profit-sky.
type Stop = { p: number; top: string; bottom: string; fog: string };
const SKY: Stop[] = [
  { p: 0.0, top: "#0b1026", bottom: "#e9a06b", fog: "#caa07e" }, // dawn over the hills
  { p: 0.22, top: "#16244a", bottom: "#7fb7c9", fog: "#a9c6c2" }, // morning blue
  { p: 0.42, top: "#1d3a52", bottom: "#cfe8c8", fog: "#bcd9bf" }, // green valley haze
  { p: 0.58, top: "#0c1622", bottom: "#26323f", fog: "#1a2530" }, // the dark valley of kitchens
  { p: 0.72, top: "#2a1c0f", bottom: "#f0b46a", fog: "#7a5a3a" }, // warm light of our hotel
  { p: 0.84, top: "#3a2606", bottom: "#ffd79a", fog: "#caa15f" }, // stepping inside
  { p: 1.0, top: "#06281d", bottom: "#a7f3d0", fog: "#5fae8c" }, // open profit-sky
];

const _cA = new THREE.Color();
const _cB = new THREE.Color();
function sampleStops(p: number, key: "top" | "bottom" | "fog", out: THREE.Color) {
  for (let i = 0; i < SKY.length - 1; i++) {
    const a = SKY[i];
    const b = SKY[i + 1];
    if (p <= b.p || i === SKY.length - 2) {
      const t = smoothstep(a.p, b.p, p);
      _cA.set(a[key]);
      _cB.set(b[key]);
      return out.copy(_cA).lerp(_cB, t);
    }
  }
  return out.set(SKY[0][key]);
}

/* ─────────────────────────── gradient sky dome ──────────────────────────── */
function Sky() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(SKY[0].top) },
      uBottom: { value: new THREE.Color(SKY[0].bottom) },
    }),
    [],
  );
  useFrame(() => {
    sampleStops(journeySmooth.value, "top", uniforms.uTop.value);
    sampleStops(journeySmooth.value, "bottom", uniforms.uBottom.value);
  });
  return (
    <mesh scale={[1, 1, 1]} renderOrder={-1}>
      <sphereGeometry args={[260, 32, 16]} />
      <shaderMaterial
        ref={mat}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={`
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`}
        fragmentShader={`
          varying vec3 vPos;
          uniform vec3 uTop;
          uniform vec3 uBottom;
          void main() {
            float h = clamp((normalize(vPos).y + 0.25) / 1.1, 0.0, 1.0);
            float e = pow(h, 0.65);
            gl_FragColor = vec4(mix(uBottom, uTop, e), 1.0);
          }`}
      />
    </mesh>
  );
}

/* ──────────────────────────── the sun / glow ────────────────────────────── */
function makeRadialTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function Sun() {
  const tex = useMemo(() => makeRadialTexture("rgba(255,224,178,1)", "rgba(255,170,90,0)"), []);
  const ref = useRef<THREE.Sprite>(null);
  useFrame(() => {
    const p = journeySmooth.value;
    // The sun sits low at dawn, climbs through the morning, then yields to the
    // warm interior light and finally the bright profit-sky glow.
    const o = lerp(0.9, 0.0, smoothstep(0.5, 0.66, p)) + lerp(0.0, 0.85, smoothstep(0.82, 1.0, p));
    if (ref.current) {
      ref.current.material.opacity = o;
      ref.current.position.y = lerp(6, 34, smoothstep(0.0, 0.5, p));
    }
  });
  return (
    <sprite ref={ref} position={[-22, 6, -150]} scale={[120, 120, 1]}>
      <spriteMaterial
        map={tex}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        fog={false}
      />
    </sprite>
  );
}

/* ──────────────────────────── mountain ridges ───────────────────────────── */
// Flat jagged silhouettes layered at increasing depth — atmospheric-perspective
// mountains, the dreamy look from the reel, for almost nothing.
function makeRidge(seed: number, width: number, base: number, peak: number): THREE.ShapeGeometry {
  const rnd = mulberry32(seed);
  const shape = new THREE.Shape();
  const steps = 14;
  shape.moveTo(-width / 2, -base);
  let prev = peak * (0.4 + rnd() * 0.6);
  for (let i = 0; i <= steps; i++) {
    const x = -width / 2 + (width * i) / steps;
    const target = peak * (0.35 + rnd() * 0.65);
    prev = lerp(prev, target, 0.6);
    shape.lineTo(x, prev);
  }
  shape.lineTo(width / 2, -base);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function Ridges() {
  const layers = useMemo(
    () => [
      { seed: 7, z: -130, w: 460, base: 30, peak: 46, color: "#8fb3c8", y: -10 },
      { seed: 21, z: -108, w: 400, base: 28, peak: 40, color: "#5f8aa0", y: -11 },
      { seed: 42, z: -86, w: 360, base: 26, peak: 33, color: "#3c6d6a", y: -12 },
      { seed: 88, z: -64, w: 320, base: 24, peak: 26, color: "#244b46", y: -12.5 },
    ],
    [],
  );
  const geos = useMemo(
    () => layers.map((l) => makeRidge(l.seed, l.w, l.base, l.peak)),
    [layers],
  );
  return (
    <group>
      {layers.map((l, i) => (
        <mesh key={i} geometry={geos[i]} position={[0, l.y, l.z]}>
          <meshBasicMaterial color={l.color} fog />
        </mesh>
      ))}
    </group>
  );
}

/* ─────────────────────────── drifting particles ─────────────────────────── */
// Pollen / fireflies / sparks. A single additive Points cloud that wraps around
// the camera so the world feels alive without ever ending.
function Particles({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const { positions, speeds } = useMemo(() => {
    const rnd = mulberry32(99);
    const positions = new Float32Array(count * 3);
    const speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rnd() - 0.5) * 90;
      positions[i * 3 + 1] = rnd() * 46 - 8;
      positions[i * 3 + 2] = (rnd() - 0.5) * 110;
      speeds[i] = 0.4 + rnd() * 1.2;
    }
    return { positions, speeds };
  }, [count]);
  const tex = useMemo(() => makeRadialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)"), []);

  useFrame((_, dt) => {
    const pts = ref.current;
    if (!pts) return;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 1] += speeds[i] * dt; // drift upward
      if (arr[i * 3 + 1] > 40) arr[i * 3 + 1] = -10; // wrap
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        map={tex}
        size={0.55}
        transparent
        opacity={0.8}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        color="#bff3d8"
      />
    </points>
  );
}

/* ───────────────────────────── the one tree ─────────────────────────────── */
// One trunk, many harvests: leafy blobs studded with fruit AND vegetables in
// different colours — "every harvest on one platform" (the ERP, as a tree).
const FRUIT_COLORS = ["#f43f5e", "#fb923c", "#facc15", "#a855f7", "#22d3ee", "#34d399"];

function OneTree({ z }: { z: number }) {
  const group = useRef<THREE.Group>(null);
  const fruits = useRef<THREE.InstancedMesh>(null);
  const FRUIT = 26;

  const fruitData = useMemo(() => {
    const rnd = mulberry32(5);
    return Array.from({ length: FRUIT }, () => ({
      x: (rnd() - 0.5) * 6,
      y: 6 + rnd() * 5,
      z: (rnd() - 0.5) * 5,
      s: 0.32 + rnd() * 0.22,
      c: FRUIT_COLORS[Math.floor(rnd() * FRUIT_COLORS.length)],
    }));
  }, []);

  useLayoutEffect(() => {
    const im = fruits.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    fruitData.forEach((f, i) => {
      m.makeScale(f.s, f.s, f.s);
      m.setPosition(f.x, f.y, f.z);
      im.setMatrixAt(i, m);
      im.setColorAt(i, col.set(f.c));
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, [fruitData]);

  useFrame((state) => {
    if (group.current) {
      // gentle sway
      group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.4) * 0.02;
    }
  });

  return (
    <group ref={group} position={[-7, -12, z]}>
      {/* trunk */}
      <mesh position={[0, 3.5, 0]}>
        <cylinderGeometry args={[0.5, 1.1, 8, 7]} />
        <meshStandardMaterial color="#5b3b25" roughness={1} flatShading />
      </mesh>
      {/* canopy blobs */}
      {[
        [0, 8.5, 0, 4.2],
        [-2.6, 7.4, 0.6, 2.8],
        [2.7, 7.6, -0.5, 3.0],
        [0.4, 10.4, -0.3, 2.6],
      ].map((b, i) => (
        <mesh key={i} position={[b[0], b[1], b[2]]}>
          <icosahedronGeometry args={[b[3], 1]} />
          <meshStandardMaterial color={i % 2 ? "#1f7a4d" : "#2c8f5c"} flatShading roughness={0.9} />
        </mesh>
      ))}
      {/* fruit + veg */}
      <instancedMesh ref={fruits} args={[undefined, undefined, FRUIT]}>
        <sphereGeometry args={[1, 10, 10]} />
        <meshStandardMaterial roughness={0.5} metalness={0.05} flatShading />
      </instancedMesh>
    </group>
  );
}

/* ───────────────────────── cooking in the hills ─────────────────────────── */
function Cauldron({ z }: { z: number }) {
  const steam = useRef<THREE.Points>(null);
  const COUNT = 40;
  const data = useMemo(() => {
    const rnd = mulberry32(11);
    const positions = new Float32Array(COUNT * 3);
    const sp = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      positions[i * 3] = (rnd() - 0.5) * 1.6;
      positions[i * 3 + 1] = rnd() * 6;
      positions[i * 3 + 2] = (rnd() - 0.5) * 1.6;
      sp[i] = 0.8 + rnd() * 1.4;
    }
    return { positions, sp };
  }, []);
  const tex = useMemo(() => makeRadialTexture("rgba(255,245,235,0.9)", "rgba(255,245,235,0)"), []);

  useFrame((_, dt) => {
    const pts = steam.current;
    if (!pts) return;
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += data.sp[i] * dt;
      if (arr[i * 3 + 1] > 7) arr[i * 3 + 1] = 0;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <group position={[7, -11.4, z]}>
      {/* pot */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[1.5, 1.1, 1.6, 16]} />
        <meshStandardMaterial color="#2b2b30" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* glowing broth */}
      <mesh position={[0, 1.42, 0]}>
        <cylinderGeometry args={[1.45, 1.45, 0.1, 16]} />
        <meshStandardMaterial color="#ff9d3c" emissive="#ff7a1a" emissiveIntensity={1.4} />
      </mesh>
      {/* hearth glow */}
      <pointLight position={[0, 1.4, 0]} color="#ff8a3d" intensity={9} distance={16} decay={2} />
      {/* steam */}
      <points ref={steam} position={[0, 1.6, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          map={tex}
          size={1.5}
          transparent
          opacity={0.5}
          depthWrite={false}
          sizeAttenuation
          color="#fff3e8"
        />
      </points>
    </group>
  );
}

/* ─────────────────────── the dark valley of kitchens ────────────────────── */
// Many restaurants flank the path, dim and cold — "cooking in the dark", losing
// without ever seeing it. We fly between them toward the one that can see.
function DarkHotels({ z }: { z: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const COUNT = 18;
  const data = useMemo(() => {
    const rnd = mulberry32(3);
    return Array.from({ length: COUNT }, () => {
      const side = rnd() > 0.5 ? 1 : -1;
      const h = 5 + rnd() * 9;
      return {
        x: side * (10 + rnd() * 12),
        y: -12 + h / 2,
        z: z + (rnd() - 0.5) * 46,
        w: 4 + rnd() * 3,
        h,
        d: 4 + rnd() * 3,
      };
    });
  }, [z]);

  useLayoutEffect(() => {
    const im = mesh.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const s = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    data.forEach((b, i) => {
      pos.set(b.x, b.y, b.z);
      s.set(b.w, b.h, b.d);
      m.compose(pos, q, s);
      im.setMatrixAt(i, m);
    });
    im.instanceMatrix.needsUpdate = true;
  }, [data]);

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#2a3340" roughness={0.95} emissive="#0b1a2a" emissiveIntensity={0.4} />
    </instancedMesh>
  );
}

/* ───────────────────────── our glowing hotel + door ─────────────────────── */
// The hotel that runs on Mise — lit, warm, every window alive. A wide facade
// with a doorway gap the camera flies through; the doors swing open as you
// arrive, and warm light spills out.
function GlowHotel({ z }: { z: number }) {
  const leftDoor = useRef<THREE.Group>(null);
  const rightDoor = useRef<THREE.Group>(null);
  const windows = useRef<THREE.InstancedMesh>(null);
  const glow = useRef<THREE.Sprite>(null);
  const WIN = 40;
  const glowTex = useMemo(
    () => makeRadialTexture("rgba(255,228,176,1)", "rgba(255,176,84,0)"),
    [],
  );

  // Lit windows arranged around (never over) the central doorway.
  const winData = useMemo(() => {
    const rnd = mulberry32(17);
    const out: { x: number; y: number }[] = [];
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 10; col++) {
        const x = -15.3 + col * 3.4;
        const y = -9 + row * 4.2;
        if (Math.abs(x) < 6 && y < 7) continue; // keep the doorway clear
        if (rnd() > 0.16) out.push({ x, y });
      }
    }
    return out.slice(0, WIN);
  }, []);

  useLayoutEffect(() => {
    const im = windows.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    winData.forEach((w, i) => {
      m.makeScale(1.7, 2.5, 0.2);
      m.setPosition(w.x, w.y, 0.1);
      im.setMatrixAt(i, m);
    });
    for (let i = winData.length; i < WIN; i++) {
      m.makeScale(0, 0, 0);
      im.setMatrixAt(i, m);
    }
    im.instanceMatrix.needsUpdate = true;
  }, [winData]);

  useFrame(() => {
    const s = journeySmooth.value;
    const open = smoothstep(0.7, 0.8, s); // doors swing open as we arrive
    if (leftDoor.current) leftDoor.current.rotation.y = open * 2.1;
    if (rightDoor.current) rightDoor.current.rotation.y = -open * 2.1;
    // the warm interior light swells to fill the screen — the "step inside" beat
    if (glow.current) {
      const near = smoothstep(0.76, 0.85, s);
      glow.current.material.opacity = open * (0.55 + near * 0.45);
      const g = 16 + near * 70;
      glow.current.scale.set(g, g, 1);
    }
  });

  // Camera-height (group y ≈ flight height) so we thread the doorway dead-on.
  return (
    <group position={[0, 1, z]}>
      {/* facade */}
      <mesh position={[0, 5, -0.5]}>
        <boxGeometry args={[36, 34, 1.5]} />
        <meshStandardMaterial color="#3a2c1c" roughness={0.85} emissive="#7a4d18" emissiveIntensity={0.3} />
      </mesh>
      {/* lit windows */}
      <instancedMesh ref={windows} args={[undefined, undefined, WIN]} position={[0, 5, 0.45]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#ffe1a6" emissive="#ffb04d" emissiveIntensity={2.4} />
      </instancedMesh>
      {/* sign */}
      <mesh position={[0, 20, 0.7]}>
        <boxGeometry args={[13, 2.8, 0.4]} />
        <meshStandardMaterial color="#0d2c20" emissive="#10b981" emissiveIntensity={1.9} />
      </mesh>
      {/* the bright interior, seen through the doorway once the doors open */}
      <mesh position={[0, 0, 0.2]}>
        <planeGeometry args={[8, 11]} />
        <meshBasicMaterial color="#ffe9c2" toneMapped={false} fog={false} />
      </mesh>
      {/* additive glow that grows into a warm flash as we step inside */}
      <sprite ref={glow} position={[0, 0, 0.4]} scale={[16, 16, 1]}>
        <spriteMaterial
          map={glowTex}
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          fog={false}
        />
      </sprite>
      {/* dark jambs + lintel framing the doorway */}
      <mesh position={[-4.6, 0, 0.55]}>
        <boxGeometry args={[1, 12, 0.8]} />
        <meshStandardMaterial color="#1a130a" />
      </mesh>
      <mesh position={[4.6, 0, 0.55]}>
        <boxGeometry args={[1, 12, 0.8]} />
        <meshStandardMaterial color="#1a130a" />
      </mesh>
      <mesh position={[0, 6, 0.55]}>
        <boxGeometry args={[10, 1.2, 0.8]} />
        <meshStandardMaterial color="#1a130a" />
      </mesh>
      {/* the two doors (hinged at the jambs) */}
      <group ref={leftDoor} position={[-4, 0, 0.95]}>
        <mesh position={[2, 0, 0]}>
          <boxGeometry args={[4, 10.4, 0.3]} />
          <meshStandardMaterial color="#6b4a26" roughness={0.6} metalness={0.2} />
        </mesh>
      </group>
      <group ref={rightDoor} position={[4, 0, 0.95]}>
        <mesh position={[-2, 0, 0]}>
          <boxGeometry args={[4, 10.4, 0.3]} />
          <meshStandardMaterial color="#6b4a26" roughness={0.6} metalness={0.2} />
        </mesh>
      </group>
      <pointLight position={[0, 2, 5]} color="#ffc66b" intensity={16} distance={48} decay={2} />
    </group>
  );
}

/* ───────────────────────── the money loop (the wheel) ───────────────────── */
// The signature rotating dial, reborn in 3D: a glowing ring of the eight
// modules, spinning as a pound moves through the kitchen. The camera flies
// through its centre.
const MONEY_GLYPH = 8;
function MoneyRing({ z }: { z: number }) {
  const ring = useRef<THREE.Group>(null);
  const nodes = useRef<THREE.InstancedMesh>(null);
  const R = 7;

  useLayoutEffect(() => {
    const im = nodes.current;
    if (!im) return;
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < MONEY_GLYPH; i++) {
      const a = (i / MONEY_GLYPH) * Math.PI * 2;
      m.makeScale(0.9, 0.9, 0.9);
      m.setPosition(Math.cos(a) * R, Math.sin(a) * R, 0);
      im.setMatrixAt(i, m);
      im.setColorAt(i, col.set(i % 2 ? "#34d399" : "#22d3ee"));
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }, []);

  useFrame((state) => {
    if (ring.current) ring.current.rotation.z = -state.clock.elapsedTime * 0.25;
  });

  return (
    <group ref={ring} position={[0, 4, z]}>
      <mesh>
        <torusGeometry args={[R, 0.22, 12, 64]} />
        <meshStandardMaterial color="#0d2c20" emissive="#10b981" emissiveIntensity={1.4} />
      </mesh>
      <instancedMesh ref={nodes} args={[undefined, undefined, MONEY_GLYPH]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial emissiveIntensity={0.6} flatShading />
      </instancedMesh>
      <pointLight color="#10b981" intensity={6} distance={30} decay={2} />
    </group>
  );
}

/* ─────────────────────────────── camera rig ─────────────────────────────── */
function CameraRig() {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const fog = useMemo(() => new THREE.FogExp2("#caa07e", 0.0095), []);
  const fogColor = useMemo(() => new THREE.Color(), []);

  useLayoutEffect(() => {
    scene.fog = fog;
    return () => {
      scene.fog = null;
    };
  }, [scene, fog]);

  useFrame((state, dt) => {
    // ease raw scroll → smooth, frame-rate independent
    journeySmooth.value = damp(journeySmooth.value, journeyProgress.value, 6, Math.min(dt, 0.05));
    const p = journeySmooth.value;
    const t = state.clock.elapsedTime;

    // fly forward along the path, with a gentle weave + bob for life. The weave
    // straightens out as we approach the hotel so we thread the doorway dead-on,
    // and stays centred through the door → ring → open sky.
    const center = smoothstep(0.62, 0.78, p);
    const weave = Math.sin(p * Math.PI * 3) * 3 + Math.sin(t * 0.3) * 0.4;
    camera.position.z = zAtProgress(p);
    camera.position.x = weave * (1 - center);
    camera.position.y = lerp(3.2, 2.2, smoothstep(0, 1, p)) + Math.sin(t * 0.5) * 0.25 * (1 - center);
    const lookX = Math.sin((p + 0.04) * Math.PI * 3) * 3 * (1 - center);
    camera.lookAt(lookX, camera.position.y - 0.3, camera.position.z - 10);

    // fog colour follows the sky mood
    sampleStops(p, "fog", fogColor);
    fog.color.copy(fogColor);
    // thin the fog out in the bright finale so the open sky reads as relief
    fog.density = lerp(0.0095, 0.006, smoothstep(0.86, 1, p));
  });

  return null;
}

/* ──────────────────────────────── the scene ─────────────────────────────── */
export default function Scene({ quality }: { quality: "low" | "high" }) {
  const particleCount = quality === "high" ? 320 : 120;
  return (
    <>
      <CameraRig />
      {/* lighting — cheap, no shadows */}
      <hemisphereLight args={["#dff0ff", "#243018", 0.9]} />
      <directionalLight position={[-10, 18, -6]} intensity={1.1} color="#ffe6c2" />
      <ambientLight intensity={0.25} />

      <Sky />
      <Sun />
      <Ridges />
      <Particles count={particleCount} />

      {/* stations along the flight path — placed at the END of each text beat so
          the object is approaching + framed while its words are on screen */}
      <OneTree z={zAtProgress(0.35)} />
      <Cauldron z={zAtProgress(0.49)} />
      <DarkHotels z={zAtProgress(0.585)} />
      <GlowHotel z={zAtProgress(0.81)} />
      <MoneyRing z={zAtProgress(0.915)} />
    </>
  );
}
