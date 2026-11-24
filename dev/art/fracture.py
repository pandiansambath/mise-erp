"""A vertebra, broken (§104.3): the same distance field as vertebra.py, cut into pieces
along rough faces (a Voronoi diagram, its walls bent by noise, so two neighbours fit
each other exactly), each piece closed and meshed. Out: the pieces, dense, for the
simplifier (simplify_pieces.mjs); then, run again with "pack", what it made of them is
given its normals, occlusion and so on, and packed as the page reads it.

  python fracture.py OUT VAR cut            (then)  node simplify_pieces.mjs OUT VAR TRIS
  python fracture.py OUT VAR pack DEST.bin"""
import json
import sys

import numpy as np

OUT, VAR, STEP = sys.argv[1], int(sys.argv[2]), sys.argv[3]
src = open(__file__.replace("fracture.py", "vertebra.py"), encoding="utf8").read().split("# ── the field on a grid")[0]
argv, sys.argv = sys.argv, ["vertebra.py", OUT, str(VAR)]
src = src.replace("import cv2\n", "")
exec(compile(src, "vertebra.py", "exec"))
sys.argv = argv

PIECES = 19
H = 0.03
lo = np.array([-2.05, -1.02, -2.82], np.float32)
hi = np.array([2.05, 1.12, 1.0], np.float32)
n = np.ceil((hi - lo) / H).astype(int) + 1
xs, ys, zs = (lo[i] + H * np.arange(n[i], dtype=np.float32) for i in range(3))


def grid(f):
    F = np.empty(n, np.float32)
    for i in range(n[0]):
        yy, zz = np.meshgrid(ys, zs, indexing="ij")
        p = np.stack([np.full(yy.size, xs[i], np.float32), yy.ravel(), zz.ravel()], 1)
        F[i] = f(p).reshape(n[1], n[2])
    return F


def warp(p):
    """Brittle walls: bent, then rough."""
    w = np.stack([noise(p + o, 1.7) * 0.34 + noise(p + o, 4.6) * 0.12 + noise(p + o, 12.0) * 0.035 for o in (0.0, 5.3, 9.1)], 1)
    return p + w.astype(np.float32)


# where it breaks: points spread evenly through it (farthest first, with some chance),
# more of them where it is slight (the wings and the blade break off)
gen = np.random.default_rng(101 + VAR)
pts = gen.uniform(lo, hi, (90000, 3)).astype(np.float32)
pts = pts[vertebra(pts) < -0.02]
slight = np.where(np.abs(pts[:, 0]) > 0.9, 0.82, 1.0) * np.where(pts[:, 2] < -1.6, 0.85, 1.0)
sites = [pts[gen.integers(len(pts))]]
for _ in range(PIECES - 1):
    d = np.min(np.stack([np.linalg.norm(pts - s, axis=1) for s in sites]), 0) / slight
    top = np.argsort(-d)[:400]
    sites.append(pts[top[gen.integers(len(top))]])
S = np.stack(sites)
# a few rounds towards the middle of their own parts (Lloyd), so none is a sliver
for _ in range(3):
    lab = np.argmin(((pts[:, None] - S[None]) ** 2).sum(2), 1)
    S = np.stack([pts[lab == k].mean(0) * 0.6 + S[k] * 0.4 if (lab == k).any() else S[k] for k in range(PIECES)])
S = S.astype(np.float32)


def wall(p, k):
    """How far outside piece k (in the Voronoi sense)."""
    q = warp(p)
    dk = ((q - S[k]) ** 2).sum(1)
    out = np.full(len(p), -9, np.float32)
    for j in range(PIECES):
        if j != k:
            out = np.maximum(out, (dk - ((q - S[j]) ** 2).sum(1)) / (2 * np.linalg.norm(S[k] - S[j])))
    return out


corner = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if sum(abs(corner[a][q] - corner[b][q]) for q in range(3)) == 1]


def nets(F):
    C = [F[c[0]:n[0] - 1 + c[0], c[1]:n[1] - 1 + c[1], c[2]:n[2] - 1 + c[2]] for c in corner]
    neg = sum((c < 0).astype(np.int8) for c in C)
    cell = (neg > 0) & (neg < 8)
    idx = np.argwhere(cell)
    if not len(idx):
        return np.zeros((0, 3), np.float32), np.zeros((0, 3), np.int64)
    pos = np.zeros((len(idx), 3), np.float32)
    cnt = np.zeros(len(idx), np.float32)
    vals = np.stack([c[cell] for c in C], 1)
    for a, b in edges:
        va, vb = vals[:, a], vals[:, b]
        cross = (va < 0) != (vb < 0)
        t = np.where(cross, va / np.where(cross, va - vb, 1), 0)[:, None]
        ca, cb = np.array(corner[a], np.float32), np.array(corner[b], np.float32)
        pos += np.where(cross[:, None], ca + (cb - ca) * t, 0)
        cnt += cross
    pos = (idx + pos / cnt[:, None]) * H + lo
    vid = np.full(cell.shape, -1, np.int64)
    vid[cell] = np.arange(len(idx))
    quads = []
    for axis in range(3):
        o = [a for a in range(3) if a != axis]
        s0 = [slice(None)] * 3
        s1 = [slice(None)] * 3
        s0[axis] = slice(0, n[axis] - 1)
        s1[axis] = slice(1, n[axis])
        A, B = F[tuple(s0)], F[tuple(s1)]
        e = np.argwhere((A < 0) != (B < 0))
        ok = (e[:, o[0]] > 0) & (e[:, o[1]] > 0) & (e[:, o[0]] < n[o[0]] - 1) & (e[:, o[1]] < n[o[1]] - 1)
        e = e[ok]
        fl = A[tuple(e.T)] < 0

        def at(du, dv):
            q = e.copy()
            q[:, o[0]] -= du
            q[:, o[1]] -= dv
            return vid[tuple(q.T)]

        v = [at(1, 1), at(0, 1), at(0, 0), at(1, 0)]
        good = np.all([x >= 0 for x in v], 0)
        f = np.stack(v, 1)[good]
        fl = fl[good]
        if axis == 1:
            fl = ~fl
        f[~fl] = f[~fl][:, ::-1]
        quads.append(f)
    q = np.concatenate(quads)
    return pos.astype(np.float32), np.concatenate([q[:, [0, 1, 2]], q[:, [0, 2, 3]]])


if STEP == "cut":
    F = grid(vertebra)
    meta = []
    P, I = [], []
    base = 0
    for k in range(PIECES):
        Fk = np.maximum(F, grid(lambda p: wall(p, k)))
        pos, tri = nets(Fk)
        if len(tri) < 60:
            print("piece", k, "dropped", len(tri))
            continue
        # its faces outward
        eps = 0.02
        f = lambda p: np.maximum(vertebra(p), wall(p, k))
        g = np.stack([f(pos + np.array(d, np.float32) * eps) - f(pos - np.array(d, np.float32) * eps) for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], 1)
        fn = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
        flip = (fn * g[tri[:, 0]]).sum(1) < 0
        tri[flip] = tri[flip][:, ::-1]
        # the middle of it
        vol = np.einsum("ij,ij->i", pos[tri[:, 0]], np.cross(pos[tri[:, 1]], pos[tri[:, 2]])) / 6
        cen = ((pos[tri].sum(1) / 4) * vol[:, None]).sum(0) / vol.sum()
        meta.append({"k": k, "v0": base, "nv": len(pos), "i0": sum(len(x) for x in I), "nt": len(tri), "c": cen.tolist(), "vol": float(abs(vol.sum()))})
        P.append(pos)
        I.append(tri.astype(np.uint32))
        base += len(pos)
        print("piece", k, len(pos), len(tri), "vol %.3f" % abs(vol.sum()), flush=True)
    P = np.concatenate(P)
    # inside or out: which of the two makes the surface here
    inner = np.zeros(len(P), np.float32)
    for m in meta:
        p = P[m["v0"]:m["v0"] + m["nv"]]
        inner[m["v0"]:m["v0"] + m["nv"]] = (wall(p, m["k"]) > vertebra(p)).astype(np.float32)
    P.tofile(f"{OUT}/f{VAR}_pos.bin")
    inner.tofile(f"{OUT}/f{VAR}_in.bin")
    np.concatenate(I).tofile(f"{OUT}/f{VAR}_idx.bin")
    json.dump(meta, open(f"{OUT}/f{VAR}.json", "w"))
else:
    DEST = sys.argv[4]
    meta = json.load(open(f"{OUT}/f{VAR}.json"))
    P = np.fromfile(f"{OUT}/f{VAR}_pos.bin", np.float32).reshape(-1, 3)
    sub = json.load(open(f"{OUT}/f{VAR}_sub.json"))

    def grad(f, p, eps):
        g = np.stack([f(p + np.array(d, np.float32) * eps) - f(p - np.array(d, np.float32) * eps) for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], 1)
        return g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)

    def world(p):
        d = vertebra(p)
        for s in (-1, 1):
            d = np.minimum(d, vertebra(p - np.array([0, s * PITCH, 0], np.float32)))
            d = np.minimum(d, disc(p - np.array([0, s * PITCH / 2, 0], np.float32)))
        return d

    VP, VN, VB, IX = [], [], [], []
    total = 0
    for pi, m in enumerate(meta):
        tri = np.array(sub[pi], np.int64).reshape(-1, 3)
        k = m["k"]
        cent = P[tri].mean(1)
        isin = wall(cent, k) > vertebra(cent)
        for cls in (False, True):
            t = tri[isin == cls]
            if not len(t):
                continue
            uq, inv = np.unique(t, return_inverse=True)
            p = P[uq]
            if cls:
                nor = grad(lambda q: wall(q, k), p, 0.03)
                ao = np.clip(0.72 + 0.5 * (vertebra(p) / 0.25 + 1), 0.7, 1.0)
                thin = np.clip(0.95 + vertebra(p) / 0.5, 0.35, 0.95)
                edge = np.clip(1 + vertebra(p) / 0.06, 0, 1)
            else:
                nor = grad(vertebra, p, 0.011)
                ao = np.zeros(len(p), np.float32)
                tot = 0
                for i, h in enumerate((0.04, 0.09, 0.17, 0.3, 0.5)):
                    w = 0.75**i
                    ao += w * np.clip(world(p + nor * h) / h, 0, 1)
                    tot += w
                ao /= tot
                thick = np.full(len(p), 1.2, np.float32)
                done = np.zeros(len(p), bool)
                for h in np.linspace(0.05, 1.2, 24):
                    out = (vertebra(p - nor * h) > 0) & ~done
                    thick[out] = h
                    done |= out
                thin = np.exp(-thick / 0.28)
                curv = np.zeros(len(p), np.float32)
                for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
                    o = np.array(d, np.float32) * 0.05
                    curv += vertebra(p + o) + vertebra(p - o)
                edge = np.clip(curv / (0.05 * 2.2) + 0.35, 0, 1)
            VP.append(p)
            VN.append(nor)
            VB.append(np.stack([ao * 255, thin * 255, edge * 255, np.full(len(p), pi * 2 + int(cls))], 1))
            IX.append(inv.reshape(-1, 3) + total)
            total += len(p)
    VP, VN, VB, IX = np.concatenate(VP), np.concatenate(VN), np.concatenate(VB), np.concatenate(IX)
    nv, nt = len(VP), len(IX)
    assert nv < 65536
    buf = bytearray()
    buf += np.array([nv, nt], np.uint32).tobytes()
    a = np.zeros((nv, 4), np.int16)
    a[:, :3] = np.clip(np.round(VP / 3 * 32767), -32767, 32767)
    buf += a.tobytes()
    b = np.zeros((nv, 4), np.int8)
    b[:, :3] = np.clip(np.round(VN * 127), -127, 127)
    buf += b.tobytes()
    buf += np.clip(np.round(VB), 0, 255).astype(np.uint8).tobytes()
    ib = IX.astype(np.uint16).tobytes()
    buf += ib + b"\0" * (len(ib) % 4)
    buf += np.array([len(meta)], np.uint32).tobytes()
    for m in meta:
        buf += np.array([*(np.array(m["c"]) / 3), m["vol"]], np.float32).tobytes()
    open(DEST, "wb").write(buf)
    print(DEST, "pieces", len(meta), "verts", nv, "tris", nt, "bytes", len(buf))
