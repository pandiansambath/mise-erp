// The broken vertebra's pieces (fracture.py), each brought down to its share of TRIS
// triangles: still closed, the line where outside meets break kept.
import fs from "node:fs";
import { MeshoptSimplifier } from "../../frontend/node_modules/meshoptimizer/meshopt_simplifier.js";

const [, , DIR, VAR, TRIS] = process.argv;
await MeshoptSimplifier.ready;
const read = (n, T) => { const b = fs.readFileSync(`${DIR}/f${VAR}_${n}.bin`); return new T(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); };
const pos = read("pos", Float32Array);
const inn = read("in", Float32Array);
const idx = read("idx", Uint32Array);
const meta = JSON.parse(fs.readFileSync(`${DIR}/f${VAR}.json`, "utf8"));
const share = meta.map((m) => m.nt ** 0.8);
const sum = share.reduce((a, b) => a + b, 0);
const out = [];
let total = 0;
meta.forEach((m, i) => {
  const p = pos.subarray(m.v0 * 3, (m.v0 + m.nv) * 3);
  const a = inn.subarray(m.v0, m.v0 + m.nv);
  const t = idx.subarray(m.i0 * 3, (m.i0 + m.nt) * 3);
  const want = Math.max(40, Math.round((Number(TRIS) * share[i]) / sum));
  const [res] = MeshoptSimplifier.simplifyWithAttributes(Uint32Array.from(t), p, 3, a, 1, [0.06], null, want * 3, 0.2, []);
  out.push([...res].map((v) => v + m.v0));
  total += res.length / 3;
});
fs.writeFileSync(`${DIR}/f${VAR}_sub.json`, JSON.stringify(out));
console.log("var", VAR, "pieces", meta.length, "tris", total);
