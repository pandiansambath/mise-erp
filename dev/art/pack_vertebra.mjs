// A vertebra, simplified for the page: the dense field mesh brought down to a few
// thousand triangles (its normals are the field's own, so it stays smooth), packed:
// Uint32 nv, nt · Int16 xyz0 (÷3) · Int8 normal0 · Uint8 occlusion, thinness, edge,0 ·
// Uint16 indices.
import fs from "node:fs";
import { MeshoptSimplifier } from "../../frontend/node_modules/meshoptimizer/meshopt_simplifier.js";
import { MeshoptEncoder } from "../../frontend/node_modules/meshoptimizer/meshopt_encoder.js";

const [, , DIR, VAR, TRIS, OUT] = process.argv;
await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
const f32 = (n) => { const b = fs.readFileSync(`${DIR}/v${VAR}_${n}.bin`); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
const pos = f32("pos");
const nor = f32("nor");
const att = f32("att");
const ib = fs.readFileSync(`${DIR}/v${VAR}_idx.bin`);
const idx = new Uint32Array(ib.buffer, ib.byteOffset, ib.byteLength / 4);
const n = pos.length / 3;
const a = new Float32Array(n * 5);
for (let i = 0; i < n; i++) a.set([nor[i * 3], nor[i * 3 + 1], nor[i * 3 + 2], att[i * 3], att[i * 3 + 1]], i * 5);
const [res, err] = MeshoptSimplifier.simplifyWithAttributes(idx, pos, 3, a, 5, [0.32, 0.32, 0.32, 0.25, 0.1], null, Number(TRIS) * 3, 0.05, []);
let ind = Uint32Array.from(res);
// in the order a GPU likes
const [remap0, unique] = MeshoptEncoder.reorderMesh(ind, true, true);
const P = Buffer.alloc(8 + unique * 16 + ind.length * 2 + ((ind.length * 2) % 4));
P.writeUInt32LE(unique, 0);
P.writeUInt32LE(ind.length / 3, 4);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));
let used = 0;
for (let i = 0; i < n; i++) {
  const t = remap0[i];
  if (t === undefined || t === 0xffffffff) continue;
  used++;
  for (let k = 0; k < 3; k++) P.writeInt16LE(clamp((pos[i * 3 + k] / 3) * 32767, -32767, 32767), 8 + t * 8 + k * 2);
  const no = 8 + unique * 8 + t * 4;
  for (let k = 0; k < 3; k++) P.writeInt8(clamp(nor[i * 3 + k] * 127, -127, 127), no + k);
  const bo = 8 + unique * 12 + t * 4;
  for (let k = 0; k < 3; k++) P.writeUInt8(clamp(att[i * 3 + k] * 255, 0, 255), bo + k);
}
ind.forEach((v, i) => P.writeUInt16LE(v, 8 + unique * 16 + i * 2));
fs.writeFileSync(OUT, P);
console.log(VAR, "tris", idx.length / 3, "->", ind.length / 3, "verts", unique, used, "error", err.toFixed(5), "bytes", P.length);
