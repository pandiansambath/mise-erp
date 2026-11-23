"""The spine's vertebrae (103.6), modelled as distance fields and meshed: a thoracic
vertebra's own anatomy — a waisted body with lipped rims and dished end plates, the
pedicles and the arch round the canal, transverse processes swept up and back, a
bladed spinous process, the four facets that lock one bone to the next — with the
small ridges, pits and foramina that make bone look like bone. Ours, from the
anatomy; no scan and nobody's model. Out: a dense mesh (positions, normals from the
field, occlusion with its neighbours, thickness, edges), to be simplified after."""
import sys

import cv2
import numpy as np

OUT = sys.argv[1]
VAR = int(sys.argv[2]) if len(sys.argv) > 2 else 0
PITCH = 1.40
rng = np.random.default_rng(17 + VAR * 31)


def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b + (a - b) * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def capsule(p, a, b, ra, rb, sx=1.0, sy=1.0, sz=1.0):
    """A limb from a to b, its radius easing; s*: flattened along an axis."""
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    s = np.array([sx, sy, sz], np.float32)
    q = p / s
    A, B = a / s, b / s
    ba = B - A
    t = np.clip(((q - A) @ ba) / (ba @ ba), 0, 1)
    d = np.linalg.norm(q - A - t[:, None] * ba, axis=1)
    return (d - (ra + (rb - ra) * t)) * min(sx, sy, sz)


def curve(p, pts, rs, k=0.06, **kw):
    """A limb along a bent path."""
    d = None
    for i in range(len(pts) - 1):
        c = capsule(p, pts[i], pts[i + 1], rs[i], rs[i + 1], **kw)
        d = c if d is None else np.minimum(d, c) if k == 0 else smin(d, c, k)
    return d


def ball(p, c, r, s=(1, 1, 1)):
    q = (p - np.asarray(c, np.float32)) / np.asarray(s, np.float32)
    return (np.linalg.norm(q, axis=1) - r) * min(s)


# a smooth random field (trilinear value noise on a lattice), for wear and pits
_LAT = rng.random((64, 64, 64)).astype(np.float32)


def noise(p, f):
    q = p * f + 17.3
    i = np.floor(q).astype(np.int32)
    u = (q - i).astype(np.float32)
    u = u * u * (3 - 2 * u)
    i &= 63
    j = (i + 1) & 63
    L = _LAT
    x0, y0, z0 = i[:, 0], i[:, 1], i[:, 2]
    x1, y1, z1 = j[:, 0], j[:, 1], j[:, 2]
    a = L[x0, y0, z0] * (1 - u[:, 0]) + L[x1, y0, z0] * u[:, 0]
    b = L[x0, y1, z0] * (1 - u[:, 0]) + L[x1, y1, z0] * u[:, 0]
    c = L[x0, y0, z1] * (1 - u[:, 0]) + L[x1, y0, z1] * u[:, 0]
    d = L[x0, y1, z1] * (1 - u[:, 0]) + L[x1, y1, z1] * u[:, 0]
    e = a * (1 - u[:, 1]) + b * u[:, 1]
    g = c * (1 - u[:, 1]) + d * u[:, 1]
    return e * (1 - u[:, 2]) + g * u[:, 2] - 0.5


def vertebra(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    ax = np.abs(x)
    m = np.stack([ax, y, z], 1)  # (it is the same on both sides, before wear)
    lean = 0.02 if VAR == 0 else -0.015
    # ── the body: an oval drum, waisted, lipped, its ends dished, flat behind
    ex, ez = 1.0, 0.8
    th = np.arctan2(z / ez, x / ex)
    rho = np.sqrt((x / ex) ** 2 + (z / ez) ** 2)
    hy = 0.5 + 0.03 * z / ez  # a little wedge: taller in front (a curve in the column)
    yy = y / hy
    r = 0.955 - 0.15 * (1 - np.clip(yy, -1, 1) ** 2) ** 1.3
    r = r + 0.055 * np.exp(-(((np.abs(yy) - 0.86) / 0.13) ** 2))
    # fine upright grooves in the waist, as vessels leave
    r = r + 0.011 * np.sin(th * 38 + 3.1 * np.sin(th * 5)) * np.clip(1 - np.abs(yy) * 1.15, 0, 1)
    side = (rho - r) * 0.8
    dish = 0.085 * np.clip(1 - (rho / 0.78) ** 2, 0, 1) ** 1.1
    cap = np.abs(y) - (hy - dish)
    cap = cap + 0.006 * np.cos(rho * 46) * np.clip(1 - rho / 0.8, 0, 1)
    body = smax(side, cap, 0.085)
    # flattened, hollowed towards the canal
    body = smax(body, -(z + 0.66 + 0.12 * np.clip(1 - (x / 0.5) ** 2, 0, 1) * -1.0), 0.14)
    d = body
    # ── pedicles
    ped = curve(m, [(0.5, 0.16, -0.5), (0.55, 0.2, -0.82), (0.58, 0.17, -1.06)], [0.215, 0.18, 0.19], sy=1.25)
    d = smin(d, ped, 0.15)
    # ── the arch round the canal
    q = np.sqrt((x / 1.04) ** 2 + (z + 1.16) ** 2) - 0.56
    slope = 0.16 * np.clip((-z - 1.1) / 0.7, 0, 1)
    arch = np.sqrt((q * 1.15) ** 2 + ((y - 0.06 + slope * 1.2) / (1.55 + 0.5 * np.clip((-z - 1.1) / 0.7, 0, 1))) ** 2) - 0.135
    d = smin(d, arch, 0.12)
    # ── transverse processes: out, back and up, knuckled at the end
    tp = [(0.55, 0.14, -1.05), (0.92, 0.2, -1.2), (1.32, 0.31, -1.36), (1.62, 0.43, -1.44)]
    tr = [0.235, 0.17, 0.142, 0.155]
    trans = curve(m, tp, tr, 0.08, sy=1.22)
    trans = smin(trans, ball(m, (1.69, 0.46, -1.45), 0.185, (0.9, 1.15, 0.95)), 0.12)
    # (a facet for the rib on its front)
    trans = smax(trans, -ball(m, (1.71, 0.46, -1.2), 0.135), 0.05)
    d = smin(d, trans, 0.14)
    # ── spinous process: a blade down the back, thick along its lower edge
    sp = [(0, -0.02, -1.62), (0, -0.2, -1.95), (0, -0.46, -2.28), (0, -0.64, -2.46)]
    sr = [0.3, 0.27, 0.21, 0.18]
    spin = curve(p, sp, sr, 0.1, sx=0.42)
    spin = smin(spin, ball(p, (0, -0.68, -2.5), 0.17, (0.72, 1.0, 0.95)), 0.12)
    spin = smin(spin, curve(p, [(0, 0.16, -1.66), (0, 0.04, -2.05), (0, -0.28, -2.38)], [0.06, 0.05, 0.045], 0.05), 0.06)
    d = smin(d, spin, 0.13)
    # ── the facets: two up, two down, each a small flat oval
    up = curve(m, [(0.55, 0.22, -1.12), (0.53, 0.6, -1.2), (0.5, 0.8, -1.2)], [0.18, 0.165, 0.15], 0.08, sz=0.72)
    up = smax(up, 0.2 * (y - 0.6) - (z + 1.34), 0.03)
    d = smin(d, up, 0.1)
    dn = curve(m, [(0.42, -0.1, -1.48), (0.43, -0.42, -1.5), (0.42, -0.62, -1.46)], [0.2, 0.17, 0.145], 0.08, sz=0.72)
    dn = smax(dn, (z + 1.37), 0.03)
    d = smin(d, dn, 0.1)
    # ── facets for the ribs on the body's shoulders
    d = smax(d, -ball(m, (0.98, 0.43, -0.42), 0.2, (0.8, 1, 1.1)), 0.06)
    d = smax(d, -ball(m, (0.94, -0.46, -0.44), 0.15, (0.8, 1, 1.1)), 0.05)
    # ── small openings where vessels pass
    for cx, cy, cz, cr in ((0.42, 0.04, 0.72, 0.05), (0.75, -0.06, 0.48, 0.042), (0.16, -0.1, 0.8, 0.038), (0.9, 0.02, 0.1, 0.045), (0.5, -0.16, 0.66, 0.034)):
        s = 1 if (VAR + int(cx * 100)) % 2 == 0 else -1
        d = smax(d, -ball(p, (s * cx, cy, cz), cr), 0.035)
        d = smax(d, -ball(p, (-s * cx * 0.9, -cy * 0.7, cz * 0.97), cr * 0.8), 0.03)
    # ── wear: the whole a little uneven, ridges along the processes, pits
    d = d - 0.02 * noise(p, 2.3) - 0.012 * noise(p, 5.1)
    far = np.clip((ax - 0.8) / 0.6, 0, 1) + np.clip((-z - 1.7) / 0.5, 0, 1)
    d = d + 0.012 * np.clip(far, 0, 1) * np.sin(14 * y + 9 * z + 6 * noise(p, 3.0))
    pits = np.clip(noise(p, 11.0) - 0.2, 0, 1)
    d = d + 0.035 * pits * np.clip(1.2 - rho, 0.25, 1)
    if VAR == 1:
        # one that has been broken: a wing's tip gone, a chip from the rim
        d = smax(d, (x - 1.46 + 0.14 * np.sin(y * 9) + 0.1 * np.sin(z * 11 + 1)), 0.02)
        d = smax(d, -ball(p, (-0.72, 0.52, 0.62), 0.2, (1.1, 0.8, 1)), 0.03)
    return d + lean * 0


def disc(p):
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    rho = np.sqrt((x / 0.9) ** 2 + (z / 0.71) ** 2)
    return np.maximum((rho - 1) * 0.71, np.abs(y) - 0.2)


# ── the field on a grid, the surface through it (naive surface nets) ─────────
H = 0.0185
lo = np.array([-2.05, -1.02, -2.82], np.float32)
hi = np.array([2.05, 1.12, 1.0], np.float32)
n = np.ceil((hi - lo) / H).astype(int) + 1
xs, ys, zs = (lo[i] + H * np.arange(n[i], dtype=np.float32) for i in range(3))
F = np.empty(n, np.float32)
for i in range(n[0]):
    yy, zz = np.meshgrid(ys, zs, indexing="ij")
    p = np.stack([np.full(yy.size, xs[i], np.float32), yy.ravel(), zz.ravel()], 1)
    F[i] = vertebra(p).reshape(n[1], n[2])
print("grid", n, F.min(), F.max())

corner = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
C = [F[c[0]:n[0] - 1 + c[0], c[1]:n[1] - 1 + c[1], c[2]:n[2] - 1 + c[2]] for c in corner]
neg = sum((c < 0).astype(np.int8) for c in C)
cell = (neg > 0) & (neg < 8)
idx = np.argwhere(cell)
print("cells", len(idx))
pos = np.zeros((len(idx), 3), np.float32)
cnt = np.zeros(len(idx), np.float32)
vals = np.stack([c[cell] for c in C], 1)
edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if sum(abs(corner[a][q] - corner[b][q]) for q in range(3)) == 1]
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
    cr = (A < 0) != (B < 0)
    e = np.argwhere(cr)
    ok = (e[:, o[0]] > 0) & (e[:, o[1]] > 0) & (e[:, o[0]] < n[o[0]] - 1) & (e[:, o[1]] < n[o[1]] - 1)
    e = e[ok]
    fl = A[tuple(e.T)] < 0

    def at(du, dv):
        q = e.copy()
        q[:, o[0]] -= du
        q[:, o[1]] -= dv
        return vid[tuple(q.T)]

    v00, v10, v11, v01 = at(1, 1), at(0, 1), at(0, 0), at(1, 0)
    good = (v00 >= 0) & (v10 >= 0) & (v11 >= 0) & (v01 >= 0)
    f = np.stack([v00, v10, v11, v01], 1)[good]
    fl = fl[good]
    if axis == 1:
        fl = ~fl
    f[~fl] = f[~fl][:, ::-1]
    quads.append(f)
quads = np.concatenate(quads)
tris = np.concatenate([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
print("verts", len(pos), "tris", len(tris))

# the field's own normals (smooth whatever the mesh), and everything baked in
eps = 0.011
g = np.stack([vertebra(pos + np.array(d, np.float32) * eps) - vertebra(pos - np.array(d, np.float32) * eps) for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1))], 1)
nor = g / np.maximum(np.linalg.norm(g, axis=1, keepdims=True), 1e-9)
# faces the way the normals do
fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
flip = (fn * nor[tris[:, 0]]).sum(1) < 0
tris[flip] = tris[flip][:, ::-1]
print("flipped", flip.mean())


def world(p):
    """The bone with its neighbours and discs, for occlusion."""
    d = vertebra(p)
    for s in (-1, 1):
        d = np.minimum(d, vertebra(p - np.array([0, s * PITCH, 0], np.float32)))
        d = np.minimum(d, disc(p - np.array([0, s * PITCH / 2, 0], np.float32)))
    return d


ao = np.zeros(len(pos), np.float32)
tot = 0
for i, h in enumerate((0.04, 0.09, 0.17, 0.3, 0.5)):
    w = 0.75**i
    ao += w * np.clip(world(pos + nor * h) / h, 0, 1)
    tot += w
ao /= tot
thick = np.full(len(pos), 1.2, np.float32)
done = np.zeros(len(pos), bool)
for h in np.linspace(0.05, 1.2, 24):
    v = vertebra(pos - nor * h)
    out = (v > 0) & ~done
    thick[out] = h
    done |= out
thin = np.exp(-thick / 0.28)
k1 = vertebra(pos + nor * 0.0) * 0
curv = np.zeros(len(pos), np.float32)
for d in ((1, 0, 0), (0, 1, 0), (0, 0, 1)):
    o = np.array(d, np.float32) * 0.05
    curv += vertebra(pos + o) + vertebra(pos - o)
edge = np.clip(curv / (0.05 * 2.2) + 0.35, 0, 1)
print("ao", ao.min(), ao.max(), "thin", thin.mean(), "edge", edge.mean())
np.savez(f"{OUT}/vertebra{VAR}.npz", pos=pos.astype(np.float32), nor=nor.astype(np.float32), tris=tris.astype(np.uint32), ao=ao, thin=thin.astype(np.float32), edge=edge.astype(np.float32))
# plain binaries for the simplifier
for name, a in (("pos", pos.astype(np.float32)), ("nor", nor.astype(np.float32)), ("idx", tris.astype(np.uint32)), ("att", np.stack([ao, thin, edge], 1).astype(np.float32))):
    a.tofile(f"{OUT}/v{VAR}_{name}.bin")
