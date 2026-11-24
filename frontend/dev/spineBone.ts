// The skeleton's bones (§103.6).
//
//   "the skeleton is not that much detailed… if I see close I can feel it's very low
//    quality… I'm saying like, so natural, detailed and wholesome, with a crystal-clear
//    skeleton as divider… ours is a bit small"
//
// Real vertebrae now: modelled offline as distance fields from the anatomy — a waisted
// body with lipped rims and dished ends, the arch round the canal, processes swept back
// and up, the facets that lock one bone to the next, grooves and small openings — and
// meshed to a few thousand triangles whose normals are the field's own, with how
// occluded, how thin and how sharp-edged every point is baked in (public/dev/spine).
// Between them, crystal discs, made here.

import type { BufferGeometry, DataTexture } from "three";
import { ask } from "./ask";

type T3 = typeof import("three");

/** What of a vertebra's own size its numbers are measured against. */
export const BONE_UNIT = 3;
/** From one vertebra to the next, in its own units (its body is 2 wide). */
export const BONE_PITCH = 1.4;
/** Its axis of turning: where the cord runs, behind the body. */
export const BONE_AXIS = -0.72;

/** Packed by the bench: Uint32 nv, nt · Int16 xyz0 · Int8 normal0 · Uint8 occlusion,
 *  thinness, edge, 0 · Uint16 indices. */
export async function loadBone(THREE: T3, url: string): Promise<BufferGeometry> {
  const buf = await ask(url, (r) => r.arrayBuffer());
  const [nv, nt] = new Uint32Array(buf, 0, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Int16Array(buf, 8, nv * 4), 4, true));
  g.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(buf, 8 + nv * 8, nv * 4), 4, true));
  g.setAttribute("aBake", new THREE.BufferAttribute(new Uint8Array(buf, 8 + nv * 12, nv * 4), 4, true));
  g.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, 8 + nv * 16, nt * 3), 1));
  return g;
}

/** A bone in pieces (§104.3), packed the same way, with which piece a point is of (and
 *  whether it is inside the break) in the last byte, and after the indices the pieces'
 *  middles and volumes. */
export async function loadBroken(THREE: T3, url: string): Promise<{ geo: BufferGeometry; cents: Float32Array }> {
  const buf = await ask(url, (r) => r.arrayBuffer());
  const [nv, nt] = new Uint32Array(buf, 0, 2);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Int16Array(buf, 8, nv * 4), 4, true));
  geo.setAttribute("normal", new THREE.BufferAttribute(new Int8Array(buf, 8 + nv * 8, nv * 4), 4, true));
  geo.setAttribute("aBake", new THREE.BufferAttribute(new Uint8Array(buf, 8 + nv * 12, nv * 4), 4, true));
  geo.setIndex(new THREE.BufferAttribute(new Uint16Array(buf, 8 + nv * 16, nt * 3), 1));
  let at = 8 + nv * 16 + nt * 6;
  at += at % 4;
  const n = new Uint32Array(buf, at, 1)[0];
  const cents = new Float32Array(24 * 4);
  cents.set(new Float32Array(buf, at + 4, n * 4).subarray(0, 24 * 4));
  return { geo, cents };
}

/** Splinters, as a bone in pieces: `n` slivers of crystal scattered through it, each a
 *  piece of its own. */
export function splinters(THREE: T3, n: number): { geo: BufferGeometry; cents: Float32Array } {
  const pos: number[] = [];
  const nor: number[] = [];
  const bake: number[] = [];
  const cents = new Float32Array(24 * 4);
  let s = 7;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let k = 0; k < n; k++) {
    const g = new THREE.OctahedronGeometry(1, 0);
    const len = 0.05 + 0.13 * rnd() * rnd();
    g.scale(0.018 + 0.03 * rnd(), len, 0.014 + 0.02 * rnd());
    const e = new THREE.Euler(rnd() * 6.3, rnd() * 6.3, rnd() * 6.3);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
    g.computeVertexNormals();
    const c = [(rnd() - 0.5) * 1.7, (rnd() - 0.5) * 0.9, -0.7 + (rnd() - 0.5) * 2.2];
    const p = g.getAttribute("position");
    const q = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push((p.getX(i) + c[0]) / BONE_UNIT, (p.getY(i) + c[1]) / BONE_UNIT, (p.getZ(i) + c[2]) / BONE_UNIT);
      nor.push(q.getX(i), q.getY(i), q.getZ(i));
      bake.push(0.8, 0.5, 0.75, (k * 2) / 255);
    }
    cents.set([c[0] / BONE_UNIT, c[1] / BONE_UNIT, c[2] / BONE_UNIT, 0.02 + 0.05 * rnd()], k * 4);
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute("aBake", new THREE.Float32BufferAttribute(bake, 4));
  return { geo, cents };
}

/** A disc between two bones: a lens of crystal, ringed, its rim broken into points. */
export function crystalDisc(THREE: T3, fine: boolean): BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const bake: number[] = [];
  const push = (p: number[], n: number[], b: number[]) => {
    pos.push(p[0] / BONE_UNIT, p[1] / BONE_UNIT, p[2] / BONE_UNIT);
    nor.push(...n);
    bake.push(...b, 0);
  };
  // The lens: rows from the top's middle, over the rim, to the bottom's middle.
  const prof: [number, number][] = [];
  const M = 9;
  for (let i = 0; i <= M; i++) {
    const a = (i / M) * Math.PI;
    const r = Math.sin(a) ** 0.72;
    const ring = 0.012 * Math.sin(a * 22) * (r > 0.3 ? 1 : 0);
    prof.push([0.93 * r + ring * 0.6, 0.185 * Math.cos(a) * (0.75 + 0.25 * r) + ring]);
  }
  const SEG = fine ? 24 : 26;
  const at = (i: number, j: number): [number[], number[]] => {
    const a = (j / SEG) * Math.PI * 2;
    const [r, y] = prof[i];
    const p0 = prof[Math.max(0, i - 1)];
    const p1 = prof[Math.min(M, i + 1)];
    const tr = p1[0] - p0[0];
    const ty = p1[1] - p0[1];
    const l = Math.hypot(tr, ty) || 1;
    const x = Math.cos(a);
    const z = Math.sin(a) * 0.8;
    const n = [(-ty / l) * x, tr / l, (-ty / l) * z];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    return [
      [x * r, y, z * r],
      [n[0] / nl, n[1] / nl, n[2] / nl],
    ];
  };
  for (let i = 0; i < M; i++)
    for (let j = 0; j < SEG; j++) {
      const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const b = (v: number[]) => {
        const rim = Math.min(1, Math.hypot(v[0], v[2] / 0.8) / 0.93);
        return [0.34 + 0.66 * rim ** 5, 0.3 + 0.3 * rim, rim ** 8];
      };
      for (const k of [0, 2, 1, 0, 3, 2]) push(q[k][0], q[k][1], b(q[k][0]));
    }
  // The points: faceted, leaning out all round the rim, no two alike.
  const hash = (n: number) => {
    const x = Math.sin(n * 91.7 + 13.3) * 43758.5453;
    return x - Math.floor(x);
  };
  const shard = (from: InstanceType<T3["Vector3"]>, dir: InstanceType<T3["Vector3"]>, len: number, w: number) => {
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(w, len / 2, w);
    g.translate(0, len * 0.3, 0);
    g.applyMatrix4(new THREE.Matrix4().compose(from, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()), new THREE.Vector3(1, 1, 1)));
    g.computeVertexNormals();
    const p = g.getAttribute("position");
    const n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      const out = i % 3 === 0 ? 1 : 0.75;
      push([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], [0.75 + 0.25 * out, 0.62, 0.85]);
    }
    g.dispose();
  };
  const N = 11;
  for (let k = 0; k < N; k++) {
    const a = ((k + 0.5 * hash(k + 3)) / N) * Math.PI * 2;
    const c = new THREE.Vector3(Math.cos(a) * 0.86, (hash(k) - 0.5) * 0.12, Math.sin(a) * 0.69);
    const d = new THREE.Vector3(Math.cos(a), (hash(k * 1.7) - 0.45) * 1.1, Math.sin(a) * 0.9);
    const big = hash(k * 2.3);
    shard(c, d.clone(), 0.2 + big * 0.2, 0.05 + big * 0.035);
    if (big > 0.55) shard(c, d.clone().add(new THREE.Vector3(hash(k * 5) - 0.5, hash(k * 7) - 0.2, hash(k * 9) - 0.5).multiplyScalar(0.8)), 0.14 + big * 0.12, 0.04);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("aBake", new THREE.Float32BufferAttribute(bake, 4));
  return g;
}

/** The bone's grain: a tile of pits, pores and fine ridges as a normal map (RG), with
 *  a slow marbling (B) that the film's colours drift by. Made once, 256 square. */
export function boneGrain(THREE: T3): DataTexture {
  const N = 256;
  const h = new Float32Array(N * N);
  const m = new Float32Array(N * N);
  // Tiling value noise.
  const lattice = (n: number, seed: number) => {
    const v = new Float32Array(n * n);
    let s = seed;
    for (let i = 0; i < v.length; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      v[i] = s / 4294967296;
    }
    return (x: number, y: number) => {
      const fx = (x / N) * n;
      const fy = (y / N) * n;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      let ux = fx - ix;
      let uy = fy - iy;
      ux = ux * ux * (3 - 2 * ux);
      uy = uy * uy * (3 - 2 * uy);
      const g = (a: number, b: number) => v[((b + n) % n) * n + ((a + n) % n)];
      return (g(ix, iy) * (1 - ux) + g(ix + 1, iy) * ux) * (1 - uy) + (g(ix, iy + 1) * (1 - ux) + g(ix + 1, iy + 1) * ux) * uy;
    };
  };
  const a = lattice(8, 11);
  const b = lattice(24, 23);
  const c = lattice(64, 37);
  const d = lattice(5, 51);
  const e = lattice(13, 67);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const pits = Math.max(0, b(x, y) - 0.62) * 2.2 + Math.max(0, c(x, y) - 0.66) * 0.9;
      const ridge = Math.abs(a(x, y) - 0.5) * 2;
      h[i] = 0.55 * ridge * ridge + 0.16 * c(x, y) - pits;
      m[i] = 0.6 * d(x, y) + 0.4 * e(x, y);
    }
  const out = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const g = (i: number, j: number) => h[((j + N) % N) * N + ((i + N) % N)];
      const dx = (g(x + 1, y) - g(x - 1, y)) * 3.4;
      const dy = (g(x, y + 1) - g(x, y - 1)) * 3.4;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      out[o] = (0.5 - (dx / l) * 0.5) * 255;
      out[o + 1] = (0.5 - (dy / l) * 0.5) * 255;
      out[o + 2] = m[y * N + x] * 255;
      out[o + 3] = 255;
    }
  const t = new THREE.DataTexture(out, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}
