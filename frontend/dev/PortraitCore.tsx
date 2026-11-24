"use client";

// No photo: a living piece in the portrait's place (23 Nov).
//
//   "if I wish to remove photos, then to replace that area we need to have
//    something… we can't leave it empty, because the photo is placed in the
//    centre and the skills revolve round it… like we have a realistic
//    skeleton, that kind of super cool animated stuff… cool, realistic… with
//    perfect detailing, even minute detailing… think deeply and create
//    no-photo designs… I need as many designs as possible, with cool stuff"
//
// Five pieces, each built in 3D in the spine's quality and lit by the theme:
//   · Star       — a living star: convection cells and granulation boiling on
//                  its face, sunspots, a darker limb, a corona of streamers,
//                  prominences arcing off it, a solar wind of sparks — the
//                  orbit becomes its solar system.
//   · Crystal    — a geode heart: iridescent hexagonal shards growing out of a
//                  dark rock, catching a room of the theme's colours, a light
//                  inside beating lub-dub, glints on the tips.
//   · Chain knot — iridescent metal links, each through the next, tied in an
//                  endless trefoil; a light runs round it.
//   · Neural     — a mind of light: neurons through a sphere, synapses joining
//                  neighbours, pulses firing along them.
//   · Black hole — the horizon's shadow, a photon ring, the accretion disc
//                  swirling (the side coming towards you brighter), its far side
//                  bent up over the top by the gravity, matter spiralling in.
// One WebGL canvas (a phone claims its context first, so the card pool makes
// room — glGuard), drawn while on screen; the pointer tilts it a little.

import { useEffect, useRef, useState } from "react";
import type * as THREE_NS from "three";
import { claimContext, guardCanvas, quiet } from "./glGuard";
import { pixelRatio } from "./sharp";
import type { PortraitLook } from "./portraits";
import { holder } from "./stage";
import { readRGB, THEME_EVENT } from "./theme";
import { useComeBack } from "./useComeBack";

type Three = typeof import("three");
type Col = InstanceType<Three["Color"]>;
type Pal = { a: Col; a2: Col; b: Col; b2: Col; c: Col; gold: Col; bg: Col; ink: Col; light: boolean };
type Piece = {
  update: (t: number, dt: number, tilt: { x: number; y: number }) => void;
  recolor: (p: Pal) => void;
  dispose: () => void;
};
type Ctx = { THREE: Three; scene: InstanceType<Three["Scene"]>; pal: Pal; phone: boolean; still: boolean };

// ── Noise, shared by the shaders ─────────────────────────────────────────
const NOISE = /* glsl */ `
  float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
  float h2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n2(vec2 x) { vec2 i = floor(x); vec2 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h2(i), h2(i + vec2(1, 0)), f.x), mix(h2(i + vec2(0, 1)), h2(i + vec2(1, 1)), f.x), f.y); }
  float fbm2(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.02 + vec2(3.1, 1.7); a *= 0.5; } return s; }
`;
const QUAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function readPal(THREE: Three): Pal {
  const root = (document.querySelector(".dev-root") as HTMLElement | null) ?? document.documentElement;
  const c = (role: string, fb: [number, number, number]) => {
    const [r, g, b] = readRGB(root, role, fb);
    return new THREE.Color(r / 255, g / 255, b / 255);
  };
  const bg = c("bg", [7, 10, 15]);
  return {
    a: c("a", [217, 119, 66]),
    a2: c("a2", [240, 160, 100]),
    b: c("b", [45, 212, 191]),
    b2: c("b2", [125, 240, 220]),
    c: c("c", [155, 140, 255]),
    gold: c("gold", [240, 189, 106]),
    bg,
    ink: c("ink", [230, 237, 245]),
    light: 0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b > 0.5,
  };
}

const lubdub = (t: number) => {
  const k = t % 1.5;
  return Math.exp(-((k - 0.05) ** 2) / 0.003) + 0.65 * Math.exp(-((k - 0.33) ** 2) / 0.003);
};

// ── Star ─────────────────────────────────────────────────────────────────
function star({ THREE, scene, pal, phone }: Ctx): Piece {
  const group = new THREE.Group();
  scene.add(group);
  const U = { uT: { value: 0 }, uHot: { value: pal.gold.clone() }, uWarm: { value: pal.a2.clone() }, uDeep: { value: pal.a.clone() }, uCool: { value: pal.b2.clone() } };
  const surfMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal); vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uT; uniform vec3 uHot, uWarm, uDeep, uCool;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vec3 p = normalize(vP) * 2.4;
        float conv = fbm(p + vec3(0.0, uT * 0.07, uT * 0.05));
        float gran = fbm(p * 5.0 - vec3(uT * 0.22, 0.0, uT * 0.17));
        float heat = 0.58 * conv + 0.42 * gran;
        float spot = smoothstep(0.63, 0.7, fbm(p * 0.8 + vec3(13.1) + uT * 0.012));
        heat = clamp(heat * 1.3 - spot * 0.75, 0.0, 1.0);
        vec3 col = mix(uDeep * 0.35, uWarm * 0.9, smoothstep(0.15, 0.55, heat));
        col = mix(col, uHot, smoothstep(0.5, 0.86, heat));
        col = mix(col, vec3(1.0, 0.96, 0.86), smoothstep(0.88, 1.0, heat));
        float mu = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        col *= 0.3 + 0.8 * pow(mu, 0.6);
        col += uCool * pow(max(0.0, 1.0 - mu), 4.0) * 0.35;
        gl_FragColor = vec4(col * 1.05, 1.0);
      }`,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.66, phone ? 64 : 96, phone ? 48 : 64), surfMat);
  group.add(sphere);
  // The corona: streamers round the disc (seamless in angle).
  const corMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    uniforms: { uT: U.uT, uC0: U.uHot, uC1: U.uWarm, uC2: U.uCool },
    vertexShader: QUAD_VERT,
    fragmentShader: NOISE + /* glsl */ `
      uniform float uT; uniform vec3 uC0, uC1, uC2; varying vec2 vUv;
      void main() {
        vec2 q = (vUv - 0.5) * 2.0;
        float r = length(q);
        vec2 dir = q / max(r, 1e-4);
        float r0 = 0.371;
        float d = max(r - r0, 0.0);
        float streak = fbm2(dir * 2.6 + vec2(0.0, r * 2.2 - uT * 0.12)) * 0.6 + fbm2(dir * 7.0 + vec2(r * 4.0 - uT * 0.2, 3.0)) * 0.4;
        float glow = exp(-d * 9.0) * 1.15 + exp(-d * 3.0) * 0.5 * streak * streak * 1.6;
        float outside = smoothstep(r0 - 0.012, r0 + 0.006, r);
        vec3 col = mix(uC0, uC1, smoothstep(0.0, 0.35, d)) + uC2 * exp(-d * 18.0) * 0.35;
        float a = glow * outside * (1.0 - smoothstep(0.85, 1.0, r));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(3.56, 3.56), corMat);
  corona.position.z = -0.02;
  group.add(corona);
  // Prominences: arcs of plasma lifting off the face and falling back.
  const promMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: U.uT, uC0: U.uHot, uC1: U.uWarm, uLife: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform vec3 uC0, uC1; varying vec2 vUv;
      void main() {
        float flow = 0.55 + 0.45 * sin(vUv.x * 40.0 - uT * 3.0);
        float ends = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.88, 1.0, vUv.x));
        float a = flow * ends * 0.75;
        gl_FragColor = vec4(mix(uC1, uC0, flow), a);
      }`,
  });
  const proms: InstanceType<Three["Group"]>[] = [];
  for (let k = 0; k < 3; k++) {
    const pivot = new THREE.Group();
    const lat = (k - 1) * 0.6 + (Math.random() - 0.5) * 0.3;
    const span = 0.35 + Math.random() * 0.3;
    const lift = 0.18 + Math.random() * 0.2;
    const pts: InstanceType<Three["Vector3"]>[] = [];
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const ang = (u - 0.5) * span;
      const rr = 0.66 + Math.sin(u * Math.PI) * lift;
      pts.push(new THREE.Vector3(Math.cos(ang) * rr, Math.sin(lat) * rr * 0.2, Math.sin(ang) * rr));
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.018 + Math.random() * 0.012, 8, false);
    pivot.add(new THREE.Mesh(geo, promMat));
    pivot.rotation.set(lat, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.6);
    group.add(pivot);
    proms.push(pivot);
  }
  // The solar wind: sparks drifting outwards.
  const NW = phone ? 180 : 320;
  const ws = new Float32Array(NW * 4);
  for (let i = 0; i < ws.length; i++) ws[i] = Math.random();
  const wGeo = new THREE.BufferGeometry();
  wGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NW * 3), 3));
  wGeo.setAttribute("seed", new THREE.BufferAttribute(ws, 4));
  const wMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: U.uT, uC: U.uHot, uPx: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: /* glsl */ `
      attribute vec4 seed; uniform float uT, uPx; varying float vA;
      void main() {
        float life = 3.0 + seed.x * 4.0; float k = fract(uT / life + seed.y);
        vec3 dir = normalize(vec3(seed.z - 0.5, seed.w - 0.5, fract(seed.x * 7.3) - 0.5));
        vec3 p = dir * (0.7 + k * 1.0);
        vA = smoothstep(0.0, 0.15, k) * (1.0 - k);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.2 + seed.w * 2.0) * uPx;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uC; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uC, smoothstep(0.5, 0.0, d) * vA); }`,
  });
  const wind = new THREE.Points(wGeo, wMat);
  wind.frustumCulled = false;
  group.add(wind);
  return {
    update(t, _dt, tilt) {
      U.uT.value = t;
      sphere.rotation.y = t * 0.06;
      proms.forEach((p, i) => (p.rotation.y += 0.0009 * (i + 1)));
      group.rotation.x = tilt.y * 0.25;
      group.rotation.z = -tilt.x * 0.12;
    },
    recolor(p) {
      U.uHot.value.copy(p.gold);
      U.uWarm.value.copy(p.a2);
      U.uDeep.value.copy(p.a);
      U.uCool.value.copy(p.b2);
    },
    dispose() {
      sphere.geometry.dispose();
      surfMat.dispose();
      corona.geometry.dispose();
      corMat.dispose();
      proms.forEach((p) => p.children.forEach((m) => (m as InstanceType<Three["Mesh"]>).geometry.dispose()));
      promMat.dispose();
      wGeo.dispose();
      wMat.dispose();
      scene.remove(group);
    },
  };
}

// ── Crystal ──────────────────────────────────────────────────────────────
function crystal({ THREE, scene, pal, phone }: Ctx): Piece {
  const group = new THREE.Group();
  scene.add(group);
  // The rock: a lumpy core.
  const rockGeo = new THREE.IcosahedronGeometry(0.4, phone ? 3 : 4);
  const pos = rockGeo.attributes.position as InstanceType<Three["BufferAttribute"]>;
  const v = new THREE.Vector3();
  const hash = (x: number, y: number, z: number) => {
    const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = v.clone().normalize();
    const bump = 0.86 + 0.18 * hash(Math.round(n.x * 6), Math.round(n.y * 6), Math.round(n.z * 6)) + 0.06 * hash(n.x * 31, n.y * 31, n.z * 31);
    v.copy(n.multiplyScalar(0.4 * bump));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshStandardMaterial({ color: pal.bg.clone().lerp(pal.ink, 0.12), roughness: 0.95, metalness: 0.05, emissive: pal.b.clone(), emissiveIntensity: 0.04 });
  const rock = new THREE.Mesh(rockGeo, rockMat);
  group.add(rock);
  // The shards: hexagonal prisms with a pointed tip, out of the rock.
  const profile = [new THREE.Vector2(0, -0.12), new THREE.Vector2(0.085, -0.12), new THREE.Vector2(0.1, 0.5), new THREE.Vector2(0.0, 0.78)];
  const shardGeo = new THREE.LatheGeometry(profile, 6);
  const shardMat = new THREE.MeshPhysicalMaterial({
    color: pal.c.clone().lerp(pal.bg, 0.45),
    metalness: 0.3,
    roughness: 0.1,
    iridescence: 1,
    iridescenceIOR: 1.45,
    iridescenceThicknessRange: [220, 760],
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.25,
    emissive: pal.b2.clone(),
    emissiveIntensity: 0.06,
    flatShading: true,
  });
  const N = phone ? 22 : 30;
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, N);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const twist = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);
  const tips: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = (i + 0.5) / N;
    const phi = Math.acos(1 - 2 * k);
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const dir = new THREE.Vector3(Math.sin(phi) * Math.cos(th), Math.cos(phi), Math.sin(phi) * Math.sin(th));
    dir.add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.35)).normalize();
    q.setFromUnitVectors(Y, dir);
    twist.setFromAxisAngle(Y, Math.random() * Math.PI);
    q.multiply(twist);
    const len = 0.7 + Math.random() * 0.75;
    const wid = 0.75 + Math.random() * 0.6;
    m.compose(dir.clone().multiplyScalar(0.28), q, new THREE.Vector3(wid, len, wid));
    shards.setMatrixAt(i, m);
    const tip = dir.clone().multiplyScalar(0.28 + 0.78 * len);
    tips.push(tip.x, tip.y, tip.z);
  }
  group.add(shards);
  // The heart's light, beating; and a glow behind.
  const heart = new THREE.PointLight(pal.b2.clone(), 2, 3.5, 2);
  group.add(heart);
  const keyA = new THREE.DirectionalLight(pal.a2.clone(), 0.8);
  keyA.position.set(-2, 1.5, 2);
  const keyB = new THREE.DirectionalLight(pal.b.clone(), 0.7);
  keyB.position.set(2, -1, 1.5);
  scene.add(keyA, keyB);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uC: { value: pal.b2.clone() }, uK: { value: 0.5 } },
    vertexShader: QUAD_VERT,
    fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uK; varying vec2 vUv;
      void main() { float d = length(vUv - 0.5) * 2.0; float a = exp(-d * d * 7.0) * uK; gl_FragColor = vec4(uC, a); }`,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), glowMat);
  glow.position.z = -0.6;
  scene.add(glow);
  // Glints on the tips.
  const gGeo = new THREE.BufferGeometry();
  gGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(tips), 3));
  const gSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) gSeed[i] = Math.random();
  gGeo.setAttribute("seed", new THREE.BufferAttribute(gSeed, 1));
  const gMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: { value: 0 }, uC: { value: new THREE.Color(1, 1, 1) }, uPx: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: /* glsl */ `attribute float seed; uniform float uT, uPx; varying float vA;
      void main() { vA = pow(max(0.0, sin(uT * (0.7 + seed) + seed * 40.0)), 18.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (4.0 + vA * 10.0) * uPx; }`,
    fragmentShader: /* glsl */ `uniform vec3 uC; varying float vA;
      void main() { vec2 q = gl_PointCoord - 0.5; float star = max(0.0, 1.0 - abs(q.x) * 14.0) * max(0.0, 1.0 - abs(q.y) * 2.2) + max(0.0, 1.0 - abs(q.y) * 14.0) * max(0.0, 1.0 - abs(q.x) * 2.2);
        gl_FragColor = vec4(uC, (star + smoothstep(0.5, 0.0, length(q)) * 0.4) * vA); }`,
  });
  const glints = new THREE.Points(gGeo, gMat);
  glints.frustumCulled = false;
  group.add(glints);
  return {
    update(t, _dt, tilt) {
      const p = lubdub(t);
      heart.intensity = 1.6 + p * 5;
      shardMat.emissiveIntensity = 0.05 + p * 0.26;
      glowMat.uniforms.uK.value = 0.35 + p * 0.45;
      gMat.uniforms.uT.value = t;
      group.rotation.y = t * 0.13 + tilt.x * 0.4;
      group.rotation.x = 0.25 + tilt.y * 0.3;
    },
    recolor(p) {
      rockMat.color.copy(p.bg).lerp(p.ink, 0.12);
      rockMat.emissive.copy(p.b);
      shardMat.color.copy(p.c).lerp(p.bg, 0.45);
      shardMat.emissive.copy(p.b2);
      heart.color.copy(p.b2);
      keyA.color.copy(p.a2);
      keyB.color.copy(p.b);
      glowMat.uniforms.uC.value.copy(p.b2);
    },
    dispose() {
      rockGeo.dispose();
      rockMat.dispose();
      shardGeo.dispose();
      shardMat.dispose();
      glow.geometry.dispose();
      glowMat.dispose();
      gGeo.dispose();
      gMat.dispose();
      scene.remove(group, keyA, keyB, glow);
    },
  };
}

// ── Chain knot ───────────────────────────────────────────────────────────
function knot({ THREE, scene, pal }: Ctx): Piece {
  const group = new THREE.Group();
  scene.add(group);
  // The knot: a trefoil.
  const S = 0.26;
  const kp: InstanceType<Three["Vector3"]>[] = [];
  for (let i = 0; i < 240; i++) {
    const u = (i / 240) * Math.PI * 2;
    kp.push(new THREE.Vector3((Math.sin(u) + 2 * Math.sin(2 * u)) * S, (Math.cos(u) - 2 * Math.cos(2 * u)) * S, -Math.sin(3 * u) * S * 1.2));
  }
  const path = new THREE.CatmullRomCurve3(kp, true);
  // One link: a stadium (two straights, two round ends), as a tube.
  const a = 0.034;
  const r = 0.036;
  const tube = 0.0125;
  const sp: InstanceType<Three["Vector3"]>[] = [];
  for (let i = 0; i < 24; i++) {
    const ang = -Math.PI / 2 + (i / 23) * Math.PI;
    sp.push(new THREE.Vector3(a + Math.cos(ang) * r, Math.sin(ang) * r, 0));
  }
  for (let i = 0; i < 24; i++) {
    const ang = Math.PI / 2 + (i / 23) * Math.PI;
    sp.push(new THREE.Vector3(-a + Math.cos(ang) * r, Math.sin(ang) * r, 0));
  }
  const linkGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp, true), 64, tube, 10, true);
  const pitch = 2 * a + 2 * r - 2.4 * tube;
  const N = Math.max(24, Math.round(path.getLength() / pitch));
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.17, iridescence: 0.9, iridescenceIOR: 1.6, iridescenceThicknessRange: [220, 620], clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 1.7 });
  const links = new THREE.InstancedMesh(linkGeo, mat, N);
  const frames = path.computeFrenetFrames(N, true);
  const m = new THREE.Matrix4();
  const basis = new THREE.Matrix4();
  const spin = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    const u = i / N;
    const p = path.getPointAt(u);
    const T = frames.tangents[i];
    const Nn = frames.normals[i];
    const B = frames.binormals[i];
    basis.makeBasis(T, Nn, B);
    spin.makeRotationX((i % 2) * (Math.PI / 2));
    m.copy(basis).multiply(spin).setPosition(p);
    links.setMatrixAt(i, m);
    links.setColorAt(i, new THREE.Color(1, 1, 1));
  }
  group.add(links);
  const keyA = new THREE.DirectionalLight(pal.a2.clone(), 1.6);
  keyA.position.set(-2, 2, 2);
  const keyB = new THREE.DirectionalLight(pal.b2.clone(), 1.4);
  keyB.position.set(2, -1.5, 1.5);
  scene.add(keyA, keyB);
  const tint = new THREE.Color();
  const dark = pal.c.clone().lerp(new THREE.Color(1, 1, 1), 0.55);
  const bright = pal.gold.clone().lerp(new THREE.Color(1, 1, 1), 0.3);
  return {
    update(t, _dt, tilt) {
      group.rotation.y = t * 0.2 + tilt.x * 0.4;
      group.rotation.x = 0.35 + Math.sin(t * 0.3) * 0.12 + tilt.y * 0.3;
      // A light running round the knot.
      const head = (t * 0.11) % 1;
      for (let i = 0; i < N; i++) {
        let d = Math.abs(i / N - head);
        d = Math.min(d, 1 - d);
        const band = Math.exp(-((d / 0.05) ** 2));
        tint.copy(dark).lerp(bright, band).multiplyScalar(1 + band * 1.4);
        links.setColorAt(i, tint);
      }
      if (links.instanceColor) links.instanceColor.needsUpdate = true;
    },
    recolor(p) {
      dark.copy(p.c).lerp(new THREE.Color(1, 1, 1), 0.55);
      bright.copy(p.gold).lerp(new THREE.Color(1, 1, 1), 0.3);
      keyA.color.copy(p.a2);
      keyB.color.copy(p.b2);
    },
    dispose() {
      linkGeo.dispose();
      mat.dispose();
      scene.remove(group, keyA, keyB);
    },
  };
}

// ── Neural ───────────────────────────────────────────────────────────────
function neural({ THREE, scene, pal, phone }: Ctx): Piece {
  const group = new THREE.Group();
  scene.add(group);
  const N = phone ? 420 : 760;
  const P: number[] = [];
  for (let i = 0; i < N; i++) {
    const k = (i + 0.5) / N;
    const phi = Math.acos(1 - 2 * k);
    const th = Math.PI * (1 + Math.sqrt(5)) * i;
    const rr = 0.86 * Math.cbrt(0.25 + 0.75 * Math.random());
    P.push(Math.sin(phi) * Math.cos(th) * rr, Math.cos(phi) * rr * 0.92, Math.sin(phi) * Math.sin(th) * rr);
  }
  // Synapses: each neuron to its nearest few.
  const seg: number[] = [];
  const tA: number[] = [];
  const sSeed: number[] = [];
  for (let i = 0; i < N; i++) {
    const best: [number, number][] = [];
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const dx = P[i * 3] - P[j * 3];
      const dy = P[i * 3 + 1] - P[j * 3 + 1];
      const dz = P[i * 3 + 2] - P[j * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d > 0.09) continue;
      best.push([d, j]);
    }
    best.sort((x, y) => x[0] - y[0]);
    for (const [, j] of best.slice(0, 3)) {
      if (j < i) continue;
      const sd = Math.random();
      seg.push(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], P[j * 3], P[j * 3 + 1], P[j * 3 + 2]);
      tA.push(0, 1);
      sSeed.push(sd, sd);
    }
  }
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(seg), 3));
  lGeo.setAttribute("along", new THREE.BufferAttribute(new Float32Array(tA), 1));
  lGeo.setAttribute("seed", new THREE.BufferAttribute(new Float32Array(sSeed), 1));
  const U = { uT: { value: 0 }, uC0: { value: pal.b2.clone() }, uC1: { value: pal.c.clone() }, uHot: { value: pal.gold.clone() } };
  const lMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: U,
    vertexShader: /* glsl */ `
      attribute float along; attribute float seed; varying float vT; varying float vS; varying float vDepth;
      void main() { vT = along; vS = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = clamp((mv.z + 7.0) / 1.8, 0.0, 1.0); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
#define sq2(x) ((x) * (x))

      uniform float uT; uniform vec3 uC0, uC1, uHot; varying float vT; varying float vS; varying float vDepth;
      void main() {
        float win = floor(uT * 0.45 + vS * 7.0);
        float fire = step(0.72, fract(sin(vS * 91.7 + win * 12.9898) * 43758.5453));
        float head = fract(uT * (0.45 + vS * 0.5) + vS * 3.0);
        float pulse = exp(-sq2((vT - head) / 0.07)) * fire;
        vec3 col = mix(uC1, uC0, vS);
        float a = (0.06 + 0.1 * vDepth) + pulse * 0.95;
        gl_FragColor = vec4(mix(col, uHot, pulse), a);
      }`,
  });
  const lines = new THREE.LineSegments(lGeo, lMat);
  lines.frustumCulled = false;
  group.add(lines);
  const nGeo = new THREE.BufferGeometry();
  nGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(P), 3));
  const nSeed = new Float32Array(N);
  for (let i = 0; i < N; i++) nSeed[i] = Math.random();
  nGeo.setAttribute("seed", new THREE.BufferAttribute(nSeed, 1));
  const nMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { ...U, uPx: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: /* glsl */ `attribute float seed; uniform float uT, uPx; varying float vA; varying float vS;
      void main() { vS = seed; vA = 0.45 + 0.55 * pow(max(0.0, sin(uT * (0.6 + seed * 1.3) + seed * 30.0)), 6.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (1.6 + seed * 2.4 + vA * 2.0) * uPx; }`,
    fragmentShader: /* glsl */ `uniform vec3 uC0, uC1, uHot; varying float vA; varying float vS;
      void main() { float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d) * vA; gl_FragColor = vec4(mix(mix(uC1, uC0, vS), uHot, vA * 0.4), a); }`,
  });
  const neurons = new THREE.Points(nGeo, nMat);
  neurons.frustumCulled = false;
  group.add(neurons);
  const glowMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uC: U.uC1, uK: { value: 0.35 } },
    vertexShader: QUAD_VERT,
    fragmentShader: /* glsl */ `uniform vec3 uC; uniform float uK; varying vec2 vUv;
      void main() { float d = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uC, exp(-d * d * 5.0) * uK); }`,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), glowMat);
  glow.position.z = -1;
  scene.add(glow);
  return {
    update(t, _dt, tilt) {
      U.uT.value = t;
      group.rotation.y = t * 0.1 + tilt.x * 0.4;
      group.rotation.x = 0.15 + tilt.y * 0.3;
      glowMat.uniforms.uK.value = 0.28 + 0.08 * Math.sin(t * 0.9);
    },
    recolor(p) {
      U.uC0.value.copy(p.b2);
      U.uC1.value.copy(p.c);
      U.uHot.value.copy(p.gold);
    },
    dispose() {
      lGeo.dispose();
      lMat.dispose();
      nGeo.dispose();
      nMat.dispose();
      glow.geometry.dispose();
      glowMat.dispose();
      scene.remove(group, glow);
    },
  };
}

// ── Black hole ───────────────────────────────────────────────────────────
function blackhole({ THREE, scene, pal, phone }: Ctx): Piece {
  const U = { uT: { value: 0 }, uTilt: { value: 0.2 }, uHot: { value: pal.gold.clone() }, uWarm: { value: pal.a2.clone() }, uCool: { value: pal.b2.clone() } };
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: U,
    vertexShader: QUAD_VERT,
    fragmentShader: NOISE + /* glsl */ `
#define sq2(x) ((x) * (x))

      uniform float uT, uTilt; uniform vec3 uHot, uWarm, uCool; varying vec2 vUv;
      void main() {
        vec2 q = (vUv - 0.5) * 2.0;
        float rH = 0.2;
        float rr = length(q);
        // The disc, seen nearly edge-on (squashed), swirling.
        vec2 dq = vec2(q.x, q.y / uTilt);
        float dr = length(dq);
        vec2 ddir = dq / max(dr, 1e-4);
        float inner = 0.3, outer = 0.95;
        float band = smoothstep(inner, inner + 0.05, dr) * (1.0 - smoothstep(outer - 0.3, outer, dr));
        float ang = atan(ddir.y, ddir.x);
        vec2 sw = vec2(cos(ang - uT * 0.9 / dr), sin(ang - uT * 0.9 / dr)) * (2.5 + dr * 3.0);
        float swirl = fbm2(sw + vec2(dr * 7.0, 0.0));
        float doppler = 1.0 + 0.65 * cos(ang + 3.14159);
        float temp = smoothstep(outer, inner, dr);
        vec3 discCol = mix(uWarm, uHot, temp) * (0.55 + 0.95 * swirl) * doppler;
        float discA = band * (0.5 + 0.5 * swirl);
        float front = step(q.y, 0.0);
        // The far side, bent up over the top (and faintly under) by the gravity.
        vec2 dir = q / max(rr, 1e-4);
        float lens = exp(-sq2((rr - 0.31) / 0.055)) * (0.55 + 0.45 * fbm2(dir * 3.0 + vec2(rr * 8.0 - uT * 0.5, 1.0)));
        lens *= smoothstep(-0.06, 0.22, q.y) + smoothstep(0.06, -0.24, q.y) * 0.32;
        float photon = exp(-sq2((rr - rH * 1.1) / 0.011));
        float shadow = 1.0 - smoothstep(rH * 0.97, rH * 1.03, rr);
        vec3 col = vec3(0.0);
        float a = 0.0;
        float backA = discA * (1.0 - front) * (1.0 - shadow);
        col += discCol * backA; a = max(a, backA);
        float lensA = lens * (1.0 - shadow);
        col += mix(uWarm, uHot, 0.55) * lensA * 1.25; a = max(a, lensA);
        col += mix(uHot, vec3(1.0), 0.4) * photon * 1.4; a = max(a, photon);
        float halo = exp(-max(rr - rH, 0.0) * 5.0) * 0.22 * (1.0 - shadow);
        col += uCool * halo; a = max(a, halo);
        col *= (1.0 - shadow); a = max(a, shadow);
        float frontA = discA * front;
        col = col * (1.0 - frontA) + discCol * frontA; a = max(a, frontA);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(3.56, 3.56), mat);
  scene.add(quad);
  // Matter spiralling in.
  const NM = phone ? 160 : 300;
  const ms = new Float32Array(NM * 4);
  for (let i = 0; i < ms.length; i++) ms[i] = Math.random();
  const mGeo = new THREE.BufferGeometry();
  mGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NM * 3), 3));
  mGeo.setAttribute("seed", new THREE.BufferAttribute(ms, 4));
  const mMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uT: U.uT, uTilt: U.uTilt, uC: U.uHot, uPx: { value: Math.min(window.devicePixelRatio || 1, 1.5) } },
    vertexShader: /* glsl */ `attribute vec4 seed; uniform float uT, uTilt, uPx; varying float vA;
      void main() { float life = 4.0 + seed.x * 5.0; float k = fract(uT / life + seed.y);
        float r = mix(1.7, 0.4, pow(k, 1.6)); float th = seed.z * 6.2831 + uT * (0.9 / r);
        vec3 p = vec3(cos(th) * r, sin(th) * r * uTilt * 1.78, 0.05);
        vA = smoothstep(0.0, 0.2, k) * (1.0 - smoothstep(0.85, 1.0, k));
        vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = (1.0 + seed.w * 1.8) * uPx; }`,
    fragmentShader: /* glsl */ `uniform vec3 uC; varying float vA;
      void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uC, smoothstep(0.5, 0.0, d) * vA * 0.8); }`,
  });
  const matter = new THREE.Points(mGeo, mMat);
  matter.frustumCulled = false;
  scene.add(matter);
  return {
    update(t, _dt, tilt) {
      U.uT.value = t;
      U.uTilt.value = 0.2 + tilt.y * 0.08;
      quad.rotation.z = -0.12 + tilt.x * 0.06;
      matter.rotation.z = quad.rotation.z;
    },
    recolor(p) {
      U.uHot.value.copy(p.gold);
      U.uWarm.value.copy(p.a2);
      U.uCool.value.copy(p.b2);
    },
    dispose() {
      quad.geometry.dispose();
      mat.dispose();
      mGeo.dispose();
      mMat.dispose();
      scene.remove(quad, matter);
    },
  };
}

const BUILD: Partial<Record<PortraitLook, (c: Ctx) => Piece>> = { star, crystal, knot, neural, blackhole };

/** A room of the theme's colours, for the metals and crystals to reflect. */
function makeEnv(THREE: Three, renderer: THREE_NS.WebGLRenderer, pal: Pal) {
  const env = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), new THREE.MeshBasicMaterial({ color: pal.light ? 0xd9dde4 : 0x05070b, side: THREE.BackSide }));
  env.add(box);
  const panel = (c: Col, x: number, y: number, z: number, w: number, h: number, k = 1) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  panel(pal.a, -4, 1.4, 2, 3, 4, 1.6);
  panel(pal.b, 4, -1, 2, 3, 4, 1.6);
  panel(pal.c, 0, 4, -2, 5, 2, 1.4);
  panel(new THREE.Color(1, 1, 1), 0, -4, 3, 4, 1.5, 1.2);
  panel(pal.gold, 2.5, 3, -3.5, 3, 3, 1.3);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.04);
  env.traverse((o) => {
    const mm = o as InstanceType<Three["Mesh"]>;
    if (mm.isMesh) {
      mm.geometry.dispose();
      (mm.material as InstanceType<Three["Material"]>).dispose();
    }
  });
  pm.dispose();
  return rt;
}

export function PortraitCore({ look }: { look: PortraitLook }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Never an empty place (§103.9): a still of the piece stands there until the
  // piece itself is drawn — and again if a browser refuses it or takes it away,
  // while it is asked for anew.
  const { gen, gone } = useComeBack({ tries: 3, after: 1100 });
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = canvas.current;
    const build = BUILD[look];
    if (!el || !build) return;
    let dead = false;
    let cleanup = () => {};
    const phone = window.matchMedia("(max-width: 767px)").matches;
    // A phone: claim the context first, so the card pool makes room.
    const unclaim = phone ? claimContext() : () => {};
    (async () => {
      if (phone) await new Promise((r) => setTimeout(r, 120));
      const THREE = await import("three");
      if (dead) return;
      let renderer: THREE_NS.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ canvas: el, alpha: true, antialias: true, powerPreference: "high-performance", premultipliedAlpha: true });
        quiet(renderer);
      } catch {
        gone();
        return;
      }
      const unguard = guardCanvas(el, () => {
        setDrawn(false);
        gone();
      });
      renderer.setPixelRatio(pixelRatio("core", phone));
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.setClearColor(0x000000, 0);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
      camera.position.set(0, 0, 6.2);
      let pal = readPal(THREE);
      let envRT = makeEnv(THREE, renderer, pal);
      scene.environment = envRT.texture;
      scene.add(new THREE.AmbientLight(0xffffff, 0.15));
      const piece = build({ THREE, scene, pal, phone, still });

      const fit = () => {
        const w = Math.max(1, el.clientWidth);
        const h = Math.max(1, el.clientHeight);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      };
      fit();
      const ro = new ResizeObserver(fit);
      ro.observe(el);
      let visible = true;
      const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: "120px" });
      io.observe(el);
      const onTheme = () =>
        window.setTimeout(() => {
          pal = readPal(THREE);
          envRT.dispose();
          envRT = makeEnv(THREE, renderer, pal);
          scene.environment = envRT.texture;
          piece.recolor(pal);
        }, 160);
      window.addEventListener(THEME_EVENT, onTheme);
      // The pointer tilts it a little.
      const tilt = { x: 0, y: 0 };
      const want = { x: 0, y: 0 };
      // (Where it is: asked for now and then, not at every move.)
      let box: DOMRect | null = null;
      let asked = 0;
      const onMove = (e: PointerEvent) => {
        const now = performance.now();
        if (!box || now - asked > 350) {
          asked = now;
          box = el.getBoundingClientRect();
        }
        const r = box;
        want.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5)));
        want.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.5)));
      };
      window.addEventListener("pointermove", onMove, { passive: true });

      let t = 0;
      let prev = performance.now();
      let raf = 0;
      let skip = false;
      const hold = holder(4, 200);
      const loop = (now: number) => {
        raf = requestAnimationFrame(loop);
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        if (!visible || document.hidden || hold()) return;
        // A phone draws every other frame.
        if (phone) {
          skip = !skip;
          if (skip) return;
        }
        if (!still) t += phone ? dt * 2 : dt;
        tilt.x += (want.x - tilt.x) * 0.05;
        tilt.y += (want.y - tilt.y) * 0.05;
        piece.update(t, dt, tilt);
        renderer.render(scene, camera);
        if (!shown && !renderer.getContext().isContextLost()) {
          shown = true;
          setDrawn(true);
        }
      };
      let shown = false;
      raf = requestAnimationFrame(loop);
      cleanup = () => {
        unguard();
        cancelAnimationFrame(raf);
        ro.disconnect();
        io.disconnect();
        window.removeEventListener(THEME_EVENT, onTheme);
        window.removeEventListener("pointermove", onMove);
        piece.dispose();
        envRT.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
      };
      if (dead) cleanup();
    })().catch(() => {
      // (Code that did not come, a shader a phone will not build: the still stays.)
    });
    return () => {
      dead = true;
      cleanup();
      unclaim();
      setDrawn(false);
    };
  }, [look, gen, gone]);
  return (
    <span className="relative block h-full w-full">
      <span
        aria-hidden
        data-core-still={drawn ? undefined : ""}
        className="absolute inset-[17%] transition-opacity duration-700"
        style={{ opacity: drawn ? 0 : 1, transform: look === "blackhole" ? "rotate(-7deg)" : undefined, animation: drawn ? undefined : "devBreathe 5s ease-in-out infinite" }}
      >
        <CorePreview look={look} bare />
      </span>
      <canvas key={gen} ref={canvas} aria-hidden className="relative block h-full w-full" />
    </span>
  );
}

/** A small still for choosing a piece (the owner panel), in the theme's colours. */
export function CorePreview({ look, bare = false }: { look: PortraitLook; bare?: boolean }) {
  const bg: Record<string, string> = {
    star: "radial-gradient(circle, #fff6e0 0 6%, var(--d-gold) 18%, var(--d-a2) 34%, color-mix(in srgb, var(--d-a) 60%, transparent) 44%, transparent 64%)",
    crystal: "conic-gradient(from 20deg, var(--d-c), var(--d-b2), var(--d-gold), var(--d-c), var(--d-b), var(--d-c))",
    knot: "radial-gradient(circle, transparent 30%, var(--d-gold) 33%, var(--d-c) 40%, transparent 44%), radial-gradient(circle, transparent 50%, var(--d-b2) 53%, transparent 57%)",
    neural: "radial-gradient(circle, var(--d-b2) 0 2%, transparent 3%) 0 0 / 14px 14px, radial-gradient(circle, color-mix(in srgb, var(--d-c) 55%, transparent), transparent 70%)",
    blackhole: "radial-gradient(circle, #000 0 22%, var(--d-gold) 24%, transparent 27%), radial-gradient(ellipse 60% 14% at 50% 52%, var(--d-a2), transparent 70%), radial-gradient(circle, color-mix(in srgb, var(--d-a2) 45%, transparent) 30%, transparent 46%)",
  };
  return <span className={`block h-full w-full rounded-full ${bare ? "" : "bg-[var(--d-bg)]"}`} style={{ background: bg[look] ?? (bare ? "transparent" : "var(--d-bg2)"), ...(look === "crystal" ? { clipPath: "polygon(50% 0, 66% 30%, 100% 38%, 72% 62%, 80% 100%, 50% 80%, 20% 100%, 28% 62%, 0 38%, 34% 30%)" } : {}) }} />;
}
