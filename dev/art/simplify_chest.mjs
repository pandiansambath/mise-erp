// The chest, lighter: each mesh simplified (meshoptimizer, attribute-aware) to about
// a third of its triangles — its normal map carries what they carried — and written
// back quantized as before.
import fs from "node:fs";
import path from "node:path";
import { MeshoptSimplifier } from "../../frontend/node_modules/meshoptimizer/meshopt_simplifier.js";

const DIR = process.argv[2];
const OUT = process.argv[3];
const NAME = "treasure_chest_1k";
await MeshoptSimplifier.ready;
const g = JSON.parse(fs.readFileSync(path.join(DIR, NAME + ".gltf"), "utf8"));
const bin = fs.readFileSync(path.join(DIR, g.buffers[0].uri));
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const RATIO = { "Plane.020": 0.3, "Plane.002": 0.3, "Plane.005": 0.6, "Plane.006": 0.6, "Plane.007": 0.5 };

function read(acc) {
  const a = g.accessors[acc];
  const bv = g.bufferViews[a.bufferView];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5126: 4 }[a.componentType];
  const stride = bv.byteStride ?? n * size;
  const out = a.type === "SCALAR" ? new Uint32Array(a.count) : new Float32Array(a.count * n);
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < n; k++) {
      const at = bv.byteOffset + (a.byteOffset ?? 0) + i * stride + k * size;
      let v;
      if (a.componentType === 5122) v = view.getInt16(at, true) / (a.normalized ? 32767 : 1);
      else if (a.componentType === 5120) v = view.getInt8(at) / (a.normalized ? 127 : 1);
      else if (a.componentType === 5123) v = view.getUint16(at, true) / (a.normalized ? 65535 : 1);
      else v = view.getFloat32(at, true);
      out[i * n + k] = v;
    }
  return out;
}

const chunks = [];
let offset = 0;
const views = [];
const accs = [];
function push(buf, extra) {
  const pad = (4 - (buf.length % 4)) % 4;
  views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, ...extra });
  chunks.push(buf, Buffer.alloc(pad));
  offset += buf.length + pad;
  return views.length - 1;
}

for (const m of g.meshes) {
  const p = m.primitives[0];
  const pos = read(p.attributes.POSITION);
  const nor = read(p.attributes.NORMAL);
  const uv = read(p.attributes.TEXCOORD_0);
  const idx = read(p.indices);
  const count = pos.length / 3;
  const attr = new Float32Array(count * 5);
  for (let i = 0; i < count; i++) {
    attr.set([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], uv[i * 2], uv[i * 2 + 1]], i * 5);
  }
  const target = Math.floor((idx.length * (RATIO[m.name] ?? 0.4)) / 3) * 3;
  const [res, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, attr, 5, [0.55, 0.55, 0.55, 0.7, 0.7], null, target, 0.006, []);
  const ind = Uint32Array.from(res);
  const [remap, unique] = MeshoptSimplifier.compactMesh(ind);
  const P = Buffer.alloc(unique * 8);
  const N = Buffer.alloc(unique * 4);
  const T = Buffer.alloc(unique * 4);
  const lo = [1e9, 1e9, 1e9];
  const hi = [-1e9, -1e9, -1e9];
  for (let i = 0; i < count; i++) {
    const t = remap[i];
    if (t === undefined || t === 0xffffffff) continue;
    for (let k = 0; k < 3; k++) {
      const v = Math.round(pos[i * 3 + k] * 32767);
      P.writeInt16LE(v, t * 8 + k * 2);
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
      N.writeInt8(Math.max(-127, Math.min(127, Math.round(nor[i * 3 + k] * 127))), t * 4 + k);
    }
    T.writeUInt16LE(Math.round(uv[i * 2] * 65535), t * 4);
    T.writeUInt16LE(Math.round(uv[i * 2 + 1] * 65535), t * 4 + 2);
  }
  const I = Buffer.alloc(ind.length * 2);
  ind.forEach((v, i) => I.writeUInt16LE(v, i * 2));
  const a0 = accs.length;
  accs.push({ bufferView: push(P, { byteStride: 8, target: 34962 }), componentType: 5122, count: unique, type: "VEC3", normalized: true, min: lo, max: hi });
  accs.push({ bufferView: push(N, { byteStride: 4, target: 34962 }), componentType: 5120, count: unique, type: "VEC3", normalized: true });
  accs.push({ bufferView: push(T, { byteStride: 4, target: 34962 }), componentType: 5123, count: unique, type: "VEC2", normalized: true });
  accs.push({ bufferView: push(I, { target: 34963 }), componentType: 5123, count: ind.length, type: "SCALAR" });
  p.attributes = { POSITION: a0, NORMAL: a0 + 1, TEXCOORD_0: a0 + 2 };
  p.indices = a0 + 3;
  console.log(m.name, "tris", idx.length / 3, "->", ind.length / 3, "verts", count, "->", unique, "error", err.toFixed(5));
}
g.accessors = accs;
g.bufferViews = views;
g.buffers = [{ uri: NAME + ".bin", byteLength: offset }];
fs.writeFileSync(path.join(OUT, NAME + ".bin"), Buffer.concat(chunks));
fs.writeFileSync(path.join(OUT, NAME + ".gltf"), JSON.stringify(g));
console.log("bin", offset);
