"""The back wall of the award room, carved (103.5, finer in 106.7): 14 x 7 units
(x -7..7, y -1.15..5.85). Our own carvings: a temple wheel, turned pilasters,
marching elephants, kudu arches, lotus bands, creepers, courses of cut stone.

    python bake_wall.py ART OUT      (ART: the folder verse.cjs wrote its masks into)

It is worked out 5120 wide, in floating point, and handed on as what the light needs:
its SLOPES (an 8-bit height has steps a light rakes across: it could only be shown
blurred), how open each place is to the light and how worn its edges are, its height
(coarse, for how it hides itself), and the gold in it: all of it 4096 wide for a
desktop, and for a phone the middle of it alone, at its own sharpness. And the verse
(Thirukkural 400), as distances: sharp at any size, cut into the stone by the shader."""
import math
import sys

import cv2
import numpy as np

ART, OUT = sys.argv[1], sys.argv[2]
W, Hh = 5120, 2560
K = W / 14.0
X0, YT = -7.0, 5.85
rng = np.random.default_rng(400)

XS = (np.arange(W, dtype=np.float32) + 0.5) / K + X0
YS = YT - (np.arange(Hh, dtype=np.float32) + 0.5) / K

H = np.zeros((Hh, W), np.float32)
GOLD = np.zeros((Hh, W), np.float32)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def win(x0, x1, y0, y1):
    """The part of the wall from x0..x1, y0..y1: its slices and coordinates."""
    i0, i1 = max(0, int((x0 - X0) * K)), min(W, int((x1 - X0) * K) + 1)
    j0, j1 = max(0, int((YT - y1) * K)), min(Hh, int((YT - y0) * K) + 1)
    sl = (slice(j0, j1), slice(i0, i1))
    x, y = np.meshgrid(XS[i0:i1], YS[j0:j1])
    return sl, x, y


def put(sl, z, gap=0.0):
    """Laid over what is there (the higher wins); `gap`: a groove round it."""
    cur = H[sl]
    if gap:
        m = (z > 1e-5).astype(np.uint8)
        d = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5) / K
        cur = cur - gap * np.exp(-((d / 0.011) ** 2)) * (1 - m)
    H[sl] = np.maximum(cur, z.astype(np.float32))


def band(y0, y1, pts):
    """A moulding the whole width: its depth at each height."""
    ys = np.array([p[0] for p in pts], np.float32)
    ds = np.array([p[1] for p in pts], np.float32)
    o = np.argsort(ys)
    j0, j1 = max(0, int((YT - y1) * K)), min(Hh, int((YT - y0) * K) + 1)
    d = np.interp(YS[j0:j1], ys[o], ds[o]).astype(np.float32)
    H[j0:j1, :] = d[:, None]


def beads_x(y, rad, step, h, x0=-7, x1=7):
    sl, x, yy = win(x0, x1, y - rad * 1.2, y + rad * 1.2)
    a = (np.mod(x / step + 0.5, 1.0) - 0.5) * step
    q = 1 - (a**2 + (yy - y) ** 2) / rad**2
    put(sl, h * np.sqrt(np.clip(q, 0, 1)) + np.where(q > 0, np.maximum(H[sl], 0) * 0, 0))


def add(sl, z):
    H[sl] += z.astype(np.float32)


# ── the mouldings ────────────────────────────────────────────────────────────
band(-1.15, -0.56, [(-1.15, 0.17), (-1.0, 0.17), (-0.99, 0.13), (-0.94, 0.13), (-0.935, 0.155), (-0.9, 0.16), (-0.865, 0.15), (-0.83, 0.115), (-0.8, 0.07), (-0.77, 0.05), (-0.765, 0.085), (-0.735, 0.085), (-0.73, 0.05), (-0.6, 0.05), (-0.595, 0.09), (-0.56, 0.09)])
band(-0.56, 0.24, [(-0.56, 0.09), (-0.55, -0.02), (0.1, -0.02), (0.11, 0.075), (0.15, 0.085), (0.155, 0.05), (0.205, 0.05), (0.21, 0.07), (0.24, 0.07)])
# lotus petals round the foot of the plinth
sl, x, y = win(-7, 7, -0.9, -0.75)
a = (np.mod(x / 0.17 + 0.5, 1.0) - 0.5) * 2
b = np.clip((y + 0.765) / -0.13, 0, 1)
w = np.sqrt(np.clip(1 - b**2.6, 0, 1)) * 0.94
add(sl, 0.02 * np.sqrt(np.clip(1 - (a / np.maximum(w, 1e-3)) ** 2, 0, 1)) * (b > 0.01) * (np.abs(a) < w) - 0.012 * np.exp(-((a / 0.12) ** 2)) * smooth(0.9, 0.5, b) * (b > 0.02))
# a running key along the band under the elephants
sl, x, y = win(-7, 7, -0.73, -0.6)
u = np.mod(x / 0.12, 1.0)
v = (y + 0.73) / 0.13
key = ((np.abs(v - 0.2) < 0.1) & (u < 0.8)) | ((np.abs(u - 0.75) < 0.07) & (v > 0.12) & (v < 0.88)) | ((np.abs(v - 0.8) < 0.1) & (u > 0.3) & (u < 0.82)) | ((np.abs(u - 0.35) < 0.07) & (v > 0.4) & (v < 0.88))
add(sl, 0.016 * cv2.GaussianBlur(key.astype(np.float32), (0, 0), 1.2))
beads_x(0.18, 0.021, 0.056, 0.083)
# the eaves: a curved cornice with its petals, over the panels
band(2.2, 2.86, [(2.2, 0.0), (2.205, 0.06), (2.25, 0.06), (2.255, 0.035), (2.33, 0.035), (2.335, 0.075), (2.37, 0.08), (2.4, 0.15), (2.48, 0.185), (2.58, 0.175), (2.68, 0.13), (2.75, 0.075), (2.78, 0.06), (2.785, 0.1), (2.83, 0.1), (2.835, 0.05), (2.86, 0.0)])
beads_x(2.293, 0.026, 0.07, 0.07)
for k in range(-10, 11):
    # kudu: the little horseshoe arches along the eaves
    cx = k * 0.7
    sl, x, y = win(cx - 0.2, cx + 0.2, 2.36, 2.8)
    dx, dy = (x - cx) / 0.15, (y - 2.53) / 0.16
    rr = np.hypot(dx, dy)
    arch = np.exp(-(((rr - 0.82) / 0.17) ** 4)) * (dy > -0.75)
    tip = np.clip(1 - np.abs(dx) / np.maximum(0.28 * (1.75 - dy), 0.01), 0, 1) * smooth(0.7, 0.9, dy) * (dy < 1.7)
    inner = np.sqrt(np.clip(1 - (rr / 0.42) ** 2, 0, 1))
    add(sl, 0.032 * np.maximum(arch, np.sqrt(tip)) + 0.03 * inner - 0.03 * ((rr < 0.66) & (inner <= 0)))

# ── the upper field: courses of plain stone, and a frieze of great arches ────
for yy in (3.0, 4.75, 5.4):
    sl, x, y = win(-7, 7, yy - 0.05, yy + 0.05)
    add(sl, 0.05 * np.exp(-(((y - yy) / 0.03) ** 4)))
for k in range(-4, 5):
    cx = k * 1.75
    sl, x, y = win(cx - 0.72, cx + 0.72, 3.85, 5.25)
    dx, dy = (x - cx) / 0.5, (y - 4.32) / 0.5
    rr = np.hypot(dx, dy)
    outer = np.exp(-(((rr - 1.0) / 0.13) ** 4)) * (dy > -0.62)
    beadsA = np.mod(np.arctan2(dy, dx) * 30 / (2 * np.pi), 1.0) - 0.5
    beadR = np.sqrt(np.clip(1 - ((beadsA * 2 * np.pi / 30 * 0.8) ** 2 + (rr - 0.8) ** 2) / 0.055**2, 0, 1)) * (dy > -0.55)
    fin = np.sqrt(np.clip(1 - (dx / np.maximum(0.2 * np.sin(np.pi * np.clip((dy - 1.02) / 0.62, 0, 1) ** 0.7), 1e-3)) ** 2, 0, 1)) * ((dy > 1.03) & (dy < 1.64))
    th = np.arctan2(dy, dx)
    pet = np.abs(np.mod(th * 12 / (2 * np.pi), 1.0) - 0.5) * 2
    lotus = np.sqrt(np.clip(1 - (rr / (0.34 + 0.28 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.2)
    hub = np.sqrt(np.clip(1 - (rr / 0.2) ** 2, 0, 1))
    put(sl, 0.075 * outer + 0.05 * beadR + 0.07 * fin + np.maximum(0.05 * lotus, 0.075 * hub) - 0.0)

# ── the pilasters: turned on a lathe, half out of the wall ───────────────────
PROFILE = np.array([
    (-0.55, 0.34), (-0.44, 0.34), (-0.435, 0.3), (-0.4, 0.3), (-0.395, 0.315), (-0.34, 0.325), (-0.28, 0.3), (-0.24, 0.265), (-0.235, 0.285), (-0.2, 0.285), (-0.195, 0.25), (0.02, 0.25),
    (0.03, 0.28), (0.07, 0.29), (0.11, 0.28), (0.12, 0.235), (0.2, 0.225), (0.75, 0.215), (0.755, 0.245), (0.8, 0.255), (0.845, 0.245), (0.85, 0.21), (1.28, 0.205), (1.285, 0.235), (1.32, 0.245), (1.355, 0.235), (1.36, 0.19),
    (1.42, 0.165), (1.47, 0.16), (1.5, 0.2), (1.53, 0.265), (1.6, 0.315), (1.68, 0.325), (1.75, 0.29), (1.8, 0.23), (1.82, 0.2), (1.825, 0.26), (1.86, 0.27), (1.865, 0.36), (1.95, 0.38), (1.955, 0.3), (2.0, 0.36), (2.1, 0.5), (2.19, 0.56), (2.2, 0.57),
], np.float32)


def pilaster(cx):
    sl, x, y = win(cx - 0.66, cx + 0.66, -0.55, 2.2)
    r = np.interp(y, PROFILE[:, 0], PROFILE[:, 1]).astype(np.float32)
    dx = np.abs(x - cx)
    q = np.clip(1 - (dx / r) ** 2, 0, 1)
    z = 0.62 * r * np.sqrt(q)
    th = np.arcsin(np.clip((x - cx) / r, -1, 1))
    # sixteen-sided shafts, petals on the cushions, a garland between
    shaft = smooth(0.2, 0.24, y) * smooth(0.75, 0.71, y) + smooth(0.85, 0.89, y) * smooth(1.28, 1.24, y)
    z -= shaft * 0.012 * (0.5 + 0.5 * np.cos(th * 16))
    cush = smooth(1.5, 1.56, y) * smooth(1.8, 1.74, y)
    z += cush * 0.012 * np.cos(th * 14) * np.sqrt(q)
    foot = smooth(-0.395, -0.36, y) * smooth(-0.24, -0.27, y)
    z += foot * 0.012 * np.cos(th * 12)
    uu = np.mod(th / 0.9 + 0.5, 1.0) - 0.5
    gar = np.abs(y - (1.22 - 0.15 * (1 - (2 * uu) ** 2)))
    z += 0.018 * np.exp(-((gar / 0.018) ** 2)) * smooth(0.95, 1.0, y) * smooth(1.2, 1.16, y) * q
    for yb in (0.44, 0.62):
        z += 0.012 * np.exp(-(((y - yb) / 0.02) ** 4)) * (0.6 + 0.4 * np.cos(th * 32)) * q
    flat = ((y > 1.865) & (y < 1.955)) | (y < -0.435)
    z = np.where(flat, 0.16 * smooth(0, 0.02, r - dx) * (dx < r), z)
    corb = y > 2.0
    z = np.where(corb, (0.15 - 0.03 * np.abs(np.sin((dx / np.maximum(r, 0.01)) * np.pi * 2.5))) * smooth(0, 0.03, r - dx), z)
    z = np.where(dx < r, z, 0)
    put(sl, np.where(z > 0, z + 0.02, 0), gap=0.02)


for cx in (-5.75, -2.62, 2.62, 5.75):
    pilaster(cx)

# ── the elephants, marching ──────────────────────────────────────────────────
E = 330  # px to a unit of the elephant's own drawing (about 0.9 of the wall's)
EW, EH = int(1.16 * E), int(0.82 * E)


def pelt(shape_mask, rpx, h):
    d = cv2.distanceTransform((shape_mask > 127).astype(np.uint8), cv2.DIST_L2, 5)
    t = np.clip(d / rpx, 0, 1)
    return (h * np.sqrt(1 - (1 - t) ** 2)).astype(np.float32)


def P(x, y):
    return (int(round(x * E)), int(round((0.78 - y) * E)))


def worm(m, pts, r0, r1):
    """A limb: a smooth curve through points, its width easing from r0 to r1."""
    pts = np.array(pts, np.float32)
    n = len(pts)
    t = np.linspace(0, n - 1, 90)
    for a in t:
        i = min(n - 2, int(a))
        f = a - i
        p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(n - 1, i + 2)]
        q = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f**3)
        cv2.circle(m, P(*q), max(1, int(round((r0 + (r1 - r0) * a / (n - 1)) * E))), 255, -1, cv2.LINE_AA)


def blob(m, pts):
    cv2.fillPoly(m, [np.array([P(*p) for p in pts], np.int32)], 255, cv2.LINE_AA)


def ell(m, cx, cy, rx, ry, a=0):
    cv2.ellipse(m, P(cx, cy), (int(rx * E), int(ry * E)), a, 0, 360, 255, -1, cv2.LINE_AA)


def elephant(step):
    z = np.zeros((EH, EW), np.float32)

    def over(m, rpx, h, base=0.0, gap=0.012):
        nonlocal z
        d = cv2.distanceTransform((m <= 127).astype(np.uint8), cv2.DIST_L2, 5)
        z = z - np.where((m <= 127) & (z > 0), gap * np.exp(-((d / 4.0) ** 2)), 0).astype(np.float32)
        p = pelt(m, rpx, h)
        z = np.maximum(z, np.where(m > 127, p + base, 0))

    def new():
        return np.zeros((EH, EW), np.uint8)

    s = step  # the legs' stride
    m = new()  # the far legs
    worm(m, [(0.24, 0.36), (0.26 + s, 0.2), (0.25 + s * 1.3, 0.035)], 0.075, 0.055)
    worm(m, [(0.62, 0.34), (0.6 - s, 0.2), (0.6 - s * 1.3, 0.035)], 0.07, 0.052)
    over(m, 18, 0.03)
    m = new()  # the tail
    worm(m, [(0.115, 0.5), (0.07, 0.42), (0.062, 0.3), (0.075, 0.21)], 0.016, 0.01)
    worm(m, [(0.075, 0.21), (0.07, 0.17), (0.08, 0.13)], 0.018, 0.026)
    over(m, 8, 0.028)
    m = new()  # the body
    ell(m, 0.385, 0.47, 0.285, 0.205)
    ell(m, 0.26, 0.46, 0.165, 0.185)
    ell(m, 0.56, 0.5, 0.15, 0.17)
    over(m, 66, 0.07)
    m = new()  # the near legs
    worm(m, [(0.2, 0.42), (0.175 - s * 0.5, 0.22), (0.17 - s, 0.035)], 0.095, 0.062)
    worm(m, [(0.565, 0.42), (0.6 + s * 0.6, 0.22), (0.6 + s, 0.035)], 0.085, 0.06)
    over(m, 22, 0.052, 0.02)
    for lx in (0.17 - s, 0.6 + s):  # anklets
        m = new()
        cv2.line(m, P(lx - 0.07, 0.1), P(lx + 0.075, 0.1), 255, 8, cv2.LINE_AA)
        over(m, 4, 0.012, 0.066, 0.004)
    m = new()  # the head and its trunk
    ell(m, 0.755, 0.585, 0.125, 0.135)
    ell(m, 0.72, 0.655, 0.07, 0.065)
    worm(m, [(0.82, 0.56), (0.895, 0.46), (0.915, 0.32), (0.91, 0.19), (0.955, 0.115), (1.02, 0.14), (1.03, 0.2)], 0.09, 0.026)
    over(m, 34, 0.062, 0.028)
    rings = new()  # the trunk's folds
    for i in range(9):
        yy = 0.46 - i * 0.032
        cv2.line(rings, P(0.83, yy + 0.008), P(0.985, yy - 0.012), 255, 2, cv2.LINE_AA)
    z = z - np.where(z > 0.05, 0.009 * (cv2.GaussianBlur(rings, (0, 0), 1.2) / 255.0), 0).astype(np.float32)
    m = new()  # the tusk
    worm(m, [(0.845, 0.47), (0.9, 0.43), (0.965, 0.45), (1.0, 0.485)], 0.027, 0.009)
    over(m, 9, 0.03, 0.055)
    m = new()  # the ear
    blob(m, [(0.665, 0.7), (0.71, 0.685), (0.742, 0.63), (0.75, 0.55), (0.735, 0.46), (0.69, 0.395), (0.655, 0.385), (0.63, 0.42), (0.575, 0.475), (0.56, 0.56), (0.575, 0.64), (0.615, 0.69)])
    m = cv2.GaussianBlur(m, (0, 0), 3)
    over(m, 13, 0.024, 0.07)
    fold = new()
    cv2.polylines(fold, [np.array([P(*p) for p in [(0.6, 0.64), (0.615, 0.55), (0.645, 0.46), (0.668, 0.42)]], np.int32)], False, 255, 4, cv2.LINE_AA)
    cv2.polylines(fold, [np.array([P(*p) for p in [(0.645, 0.67), (0.66, 0.58), (0.685, 0.5)]], np.int32)], False, 255, 3, cv2.LINE_AA)
    z = z - 0.012 * (cv2.GaussianBlur(fold, (0, 0), 1.6) / 255.0)
    m = new()  # the cloth on its back, beaded, a lotus in the middle
    blob(m, [(0.24, 0.675), (0.32, 0.69), (0.42, 0.692), (0.51, 0.675), (0.52, 0.4), (0.38, 0.36), (0.235, 0.4)])
    over(m, 7, 0.01, 0.074, 0.005)
    d = cv2.distanceTransform((m > 127).astype(np.uint8), cv2.DIST_L2, 5)
    z = z + np.where(m > 127, 0.007 * np.exp(-(((d - 16) / 4.0) ** 2)), 0).astype(np.float32)
    yy, xx = np.mgrid[0:EH, 0:EW].astype(np.float32)
    cxp, cyp = P(0.378, 0.525)
    rr = np.hypot(xx - cxp, yy - cyp) / E
    th = np.arctan2(yy - cyp, xx - cxp)
    pet = np.abs(np.mod(th * 10 / (2 * np.pi), 1.0) - 0.5) * 2
    z = z + np.where(m > 127, 0.013 * np.sqrt(np.clip(1 - (rr / (0.05 + 0.035 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.026) + 0.016 * np.sqrt(np.clip(1 - (rr / 0.024) ** 2, 0, 1)), 0).astype(np.float32)
    tas = new()  # its tassels, and the rope of bells round the neck
    for i in range(9):
        cv2.circle(tas, P(0.245 + i * 0.034, 0.385 - 0.024 * math.sin(math.pi * i / 8)), 5, 255, -1, cv2.LINE_AA)
    for i in range(7):
        a = i / 6
        cv2.circle(tas, P(0.555 + 0.05 * a + 0.03 * math.sin(a * 3.1), 0.61 - 0.27 * a), 5, 255, -1, cv2.LINE_AA)
    over(tas, 5, 0.012, 0.074, 0.003)
    eye = new()
    ell(eye, 0.795, 0.585, 0.019, 0.012, -10)
    z = z - 0.018 * (cv2.GaussianBlur(eye, (0, 0), 1.5) / 255.0)
    m = new()
    cv2.circle(m, P(0.795, 0.583), 3, 255, -1, cv2.LINE_AA)
    z = z + 0.016 * (m / 255.0)
    # the head's ornament
    orn = new()
    cv2.polylines(orn, [np.array([P(*p) for p in [(0.735, 0.72), (0.79, 0.66), (0.845, 0.6), (0.885, 0.52)]], np.int32)], False, 255, 5, cv2.LINE_AA)
    z = z + 0.01 * (cv2.GaussianBlur(orn, (0, 0), 1.4) / 255.0) * (z > 0.03)
    return z


pace = [0.035, -0.02, 0.05, 0.0]
sprites = [elephant(s) for s in pace]
scale = 0.6 / (0.78)  # to stand inside the band
for i in range(16):
    z = sprites[i % 4]
    w2, h2 = int(EW * K * scale / E * 1.0), int(EH * K * scale / E * 1.0)
    z = cv2.resize(z, (w2, h2), interpolation=cv2.INTER_AREA) * scale * 1.15
    # marching outward from the middle, both ways
    right = i < 8
    n = i if right else i - 8
    x0 = 0.12 + n * 0.94
    px = int(((x0 if right else -x0) - X0) * K) - (0 if right else w2)
    if not right:
        z = z[:, ::-1]
    py = int((YT - 0.075) * K) - 0
    py0 = int((YT + 0.545) * K) - h2 + int(0.0 * K)
    x1, x2 = max(0, px), min(W, px + w2)
    if x2 <= x1:
        continue
    sub = H[py0:py0 + h2, x1:x2]
    zz = z[:, x1 - px:x2 - px]
    H[py0:py0 + h2, x1:x2] = np.maximum(sub, np.where(zz > 0.003, zz - 0.02, sub))
# (and the pilasters stand in front of them)
for cx in (-5.75, -2.62, 2.62, 5.75):
    pilaster(cx)

# ── the middle bay, standing forward: a framed field for the wheel ──────────
sl, x, y = win(-2.2, 2.2, -1.15, 3.04)
ax = np.abs(x) - 2.06
low = smooth(0.0, -0.03, ax) * (y <= -0.53)
H[sl] = H[sl] + (0.08 * low).astype(np.float32)
sd = np.maximum(ax, np.abs(y - 1.235) - 1.765)
slab = 0.12 * smooth(0.0, -0.025, sd) + 0.04 * np.exp(-(((sd + 0.075) / 0.03) ** 4)) + 0.018 * np.exp(-(((sd + 0.2) / 0.012) ** 4))
per = np.where(ax > np.abs(y - 1.235) - 1.765, y, x)
a = (np.mod(per / 0.075 + 0.5, 1.0) - 0.5) * 0.075
slab = slab + 0.026 * np.sqrt(np.clip(1 - (a**2 + (sd + 0.145) ** 2) / 0.024**2, 0, 1))
for cx, cy in ((-1.74, 2.68), (1.74, 2.68), (-1.74, -0.2), (1.74, -0.2)):
    rr = np.hypot(x - cx, y - cy)
    tt = np.arctan2(y - cy, x - cx)
    pet = np.abs(np.mod(tt * 12 / (2 * np.pi), 1.0) - 0.5) * 2
    slab = slab + 0.05 * np.sqrt(np.clip(1 - (rr / (0.1 + 0.07 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.055) + 0.062 * np.sqrt(np.clip(1 - (rr / 0.052) ** 2, 0, 1)) + 0.035 * np.exp(-(((rr - 0.205) / 0.016) ** 4))
H[sl] = np.where(sd < 0.0, slab, H[sl]).astype(np.float32)

# ── the wheel, behind the chest ──────────────────────────────────────────────
CX, CY = 0.0, 0.95
sl, x, y = win(-2.1, 2.1, CY - 2.1, CY + 2.1)
dx, dy = x - CX, y - CY
r = np.hypot(dx, dy)
th = np.arctan2(dy, dx)
z = np.zeros_like(r)
gold = np.zeros_like(r)
DISC = r < 1.99


def ringz(r0, w, h, p=4):
    return h * np.exp(-(((r - r0) / (w / 2)) ** p))


def petals(r0, r1, n, h, phase=0.0, sharp=0.62, vein=0.35):
    a = (np.mod(th * n / (2 * np.pi) + phase, 1.0) - 0.5) * 2
    b = (r - r0) / (r1 - r0)
    bb = np.clip(b, 0, 1)
    w = np.where(bb < sharp, 0.74 + 0.24 * np.sin(np.pi * 0.5 * bb / sharp), 0.98 * np.sqrt(np.clip(1 - ((bb - sharp) / (1 - sharp)) ** 2, 0, 1)) ** 0.8)
    q = np.where((b > 0) & (b < 1), 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
    body = np.sqrt(np.clip(q, 0, 1))
    edge = np.exp(-(((np.abs(a) / np.maximum(w, 1e-3) - 0.8) / 0.1) ** 2)) * (q > 0)
    out = h * (body * (0.55 + 0.45 * bb) - vein * 0.35 * np.exp(-((a / 0.1) ** 2)) * (q > 0) + 0.12 * edge)
    return np.where(q > 0, out, 0)


def beads(r0, n, rad, h):
    a = np.mod(th * n / (2 * np.pi), 1.0) - 0.5
    q = 1 - ((a * 2 * np.pi / n * r0) ** 2 + (r - r0) ** 2) / rad**2
    return h * np.sqrt(np.clip(q, 0, 1))


# the hub, a lotus in it
z = np.maximum(z, 0.05 * smooth(1.99, 1.95, r))
z = np.maximum(z, 0.05 + 0.055 * np.sqrt(np.clip(1 - (r / 0.12) ** 2, 0, 1)) * (r < 0.12))
z = np.maximum(z, 0.05 + petals(0.1, 0.3, 8, 0.05, 0.0))
z = np.maximum(z, 0.05 + petals(0.14, 0.36, 8, 0.04, 0.5) * (petals(0.1, 0.3, 8, 1, 0.0) <= 0))
z = np.maximum(z, 0.05 + ringz(0.4, 0.04, 0.05))
z = np.maximum(z, 0.05 + beads(0.455, 44, 0.022, 0.035))
z = np.maximum(z, 0.05 + ringz(0.51, 0.035, 0.05))
# the spokes: twelve turned ones with medallions, twelve plain
for n, phase, kind in ((12, 0.0, 1), (12, 0.5, 0)):
    a = (np.mod(th * n / (2 * np.pi) + phase, 1.0) - 0.5) * 2 * np.pi / n
    t = a * r  # across the spoke
    s = (r - 0.53) / (1.13 - 0.53)
    if kind:
        half = np.interp(s, [0, 0.06, 0.1, 0.2, 0.3, 0.42, 0.58, 0.7, 0.8, 0.9, 0.94, 1], [0.055, 0.06, 0.035, 0.05, 0.035, 0.03, 0.03, 0.035, 0.05, 0.035, 0.06, 0.055])
        q = np.where((s > 0) & (s < 1), 1 - (t / half) ** 2, -1)
        z = np.maximum(z, np.where(q > 0, 0.03 + 0.075 * np.sqrt(np.clip(q, 0, 1)), 0))
        md = np.hypot(t, r - 0.83)
        pet = np.abs(np.mod(np.arctan2(t, r - 0.83) * 8 / (2 * np.pi), 1.0) - 0.5) * 2
        z = np.maximum(z, np.where(md < 0.088, 0.085 + 0.012 * np.exp(-(((md - 0.078) / 0.012) ** 2)) + 0.02 * np.sqrt(np.clip(1 - (md / (0.034 + 0.03 * (1 - pet) ** 0.6)) ** 2, 0, 1)), 0))
        gold = np.maximum(gold, np.exp(-(((md - 0.078) / 0.009) ** 2)))
    else:
        q = np.where((s > 0) & (s < 1), 1 - (t / 0.02) ** 2, -1)
        z = np.maximum(z, np.where(q > 0, 0.03 + 0.04 * np.sqrt(np.clip(q, 0, 1)), 0))
        z = np.maximum(z, np.where(np.hypot(t, r - 0.83) < 0.04, 0.03 + 0.06 * np.sqrt(np.clip(1 - (np.hypot(t, r - 0.83) / 0.04) ** 2, 0, 1)), 0))
# between the spokes the stone is cut away
z = np.where((r > 0.53) & (r < 1.13) & (z <= 0.0501), -0.02, z)
# the felloe: a scrolling vine between two rings
z = np.maximum(z, 0.05 + ringz(1.15, 0.045, 0.055))
z = np.maximum(z, 0.05 + ringz(1.44, 0.04, 0.055))
wave = 1.295 + 0.062 * np.sin(th * 16)
z = np.maximum(z, 0.05 + 0.035 * np.sqrt(np.clip(1 - ((r - wave) / 0.02) ** 2, 0, 1)))
for k in range(32):
    ta = (k + 0.5) * 2 * np.pi / 32
    side = 1 if k % 2 == 0 else -1
    rc = 1.295 - side * 0.028
    ddx, ddy = dx - rc * math.cos(ta), dy - rc * math.sin(ta)
    d = np.hypot(ddx, ddy)
    ang = np.arctan2(ddy, ddx) - ta
    spiral = np.abs(np.mod(d / 0.034 - side * ang / (2 * np.pi), 1.0) - 0.5) * 2
    z = np.maximum(z, np.where(d < 0.075, 0.05 + 0.028 * np.clip(1 - spiral * 1.1, 0, 1) ** 0.6 * smooth(0.078, 0.06, d), 0))
gold = np.maximum(gold, np.exp(-(((r - 1.15) / 0.013) ** 2)) * 0.9)
gold = np.maximum(gold, np.exp(-(((r - 1.44) / 0.012) ** 2)) * 0.9)
z = np.maximum(z, 0.05 + beads(1.505, 120, 0.026, 0.045))
# the great lotus, two rows deep, and flames round it
z = np.maximum(z, 0.045 + petals(1.5, 1.86, 30, 0.05, 0.5, 0.6) * smooth(1.53, 1.56, r))
z = np.maximum(z, 0.06 + petals(1.5, 1.76, 30, 0.06, 0.0, 0.6) * smooth(1.53, 1.56, r))
a = np.mod(th * 60 / (2 * np.pi), 1.0)
fb = (r - 1.86) / 0.2
lean = a - 0.5 - 0.22 * np.sin(np.clip(fb, 0, 1) * 2.6)
fw = 0.46 * np.sqrt(np.clip(1 - np.clip(fb, 0, 1) ** 1.5, 0, 1))
q = np.where((fb > -0.1) & (fb < 1), 1 - (lean / np.maximum(fw, 1e-3)) ** 2, -1)
z = np.maximum(z, np.where(q > 0, 0.02 + 0.045 * np.sqrt(np.clip(q, 0, 1)), 0))
mask = r < 2.08
d_out = np.where(mask, 0, r - 2.08)
cur = H[sl]
under = cur * smooth(2.06, 2.14, r) + 0.0 * cur
keepband = (y < 0.25) | (y > 2.2)
# the wheel stands over the mouldings behind it
z = np.where(DISC | (q > 0), z, 0)
H[sl] = np.where(DISC | ((q > 0) & (z > 0.001)), z + 0.12, cur - 0.02 * np.exp(-(((r - 2.0) / 0.05) ** 2)))
GOLD[sl] = np.maximum(GOLD[sl], gold.astype(np.float32))

# ── two framed panels for the verse, and (for a tall screen) a band ──────────


def panel(x0, x1, y0, y1):
    sl, x, y = win(x0 - 0.16, x1 + 0.16, y0 - 0.16, y1 + 0.16)
    ax = np.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2
    ay = np.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2
    sd = np.maximum(ax, ay)
    fr = 0.07 * smooth(0.0, 0.02, sd + 0.085) * smooth(0.09, 0.07, sd) + 0.022 * smooth(0.135, 0.125, sd) * smooth(0.09, 0.1, sd)
    groove = -0.02 * np.exp(-(((sd + 0.005) / 0.012) ** 2))
    inner = np.where(sd < -0.085, -0.03 * smooth(-0.085, -0.11, sd), 0)
    H[sl] = np.where(sd < 0.14, fr + groove + inner, H[sl])
    # beads along the frame, a fine line inside it, a lotus at each corner
    per = np.where(ax > ay, y, x)
    a = (np.mod(per / 0.07 + 0.5, 1.0) - 0.5) * 0.07
    q = 1 - (a**2 + (sd - 0.045) ** 2) / 0.02**2
    H[sl] += (0.022 * np.sqrt(np.clip(q, 0, 1)) + 0.008 * np.exp(-(((sd + 0.128) / 0.006) ** 2))).astype(np.float32)
    for cx in (x0, x1):
        for cy in (y0, y1):
            rr = np.hypot(x - cx, y - cy)
            tt = np.arctan2(y - cy, x - cx)
            pet = np.abs(np.mod(tt * 8 / (2 * np.pi), 1.0) - 0.5) * 2
            lot = np.where(rr < 0.12, 0.085 + 0.02 * np.sqrt(np.clip(1 - (rr / (0.055 + 0.05 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.032) + 0.026 * np.sqrt(np.clip(1 - (rr / 0.03) ** 2, 0, 1)) + 0.01 * np.exp(-(((rr - 0.108) / 0.008) ** 2)), 0)
            H[sl] = np.maximum(H[sl], lot.astype(np.float32))


panel(-5.2, -3.17, 0.45, 2.0)
panel(3.17, 5.2, 0.45, 2.0)
sl, x, y = win(-2.6, 2.6, 3.06, 3.82)
sdx = np.abs(x) - 2.42
sdy = np.abs(y - 3.43) - 0.33
sd = np.maximum(sdx, sdy)
H[sl] = np.where(sd < 0.05, 0.05 * np.exp(-(((sd + 0.0) / 0.035) ** 4)) - 0.02 * smooth(-0.04, -0.07, sd), H[sl])


# ── more of it (106.7) ───────────────────────────────────────────────────────
def creeper(x0, x1, yc, half, step, depth, base=0.0):
    """A running creeper: a stem that swings, and in each of its bends a tendril that leaves it,
    curls in on itself and ends in a bud; a leaf outside each bend."""
    sl, x, y = win(x0, x1, yc - half * 1.15, yc + half * 1.15)
    ph = x * np.pi / step
    amp = half * 0.62
    stem = yc + amp * np.sin(ph)
    tilt = np.cos(ph) * amp * np.pi / step
    d = (y - stem) / np.sqrt(1 + tilt**2)
    z = depth * np.sqrt(np.clip(1 - (d / (half * 0.1)) ** 2, 0, 1))
    k = np.floor(ph / np.pi)
    cx = (k + 0.5) * step
    up = np.where(np.mod(k, 2) == 0, 1.0, -1.0)
    # the tendril: a spiral in the bend's hollow
    u, v = x - cx, (y - (yc - up * half * 0.1)) * up
    rr = np.hypot(u, v) / (half * 0.56)
    th = np.arctan2(u, v)
    arm = rr - (0.2 + 0.8 * np.mod(th / (2 * np.pi) + 0.5, 1.0))
    arm2 = rr - (0.2 + 0.8 * (np.mod(th / (2 * np.pi) + 0.5, 1.0) + 1.0))
    arm3 = rr - (0.2 + 0.8 * (np.mod(th / (2 * np.pi) + 0.5, 1.0) - 1.0))
    q = np.maximum(np.maximum(1 - (arm / 0.16) ** 2, 1 - (arm2 / 0.16) ** 2), 1 - (arm3 / 0.16) ** 2)
    z = np.maximum(z, 0.85 * depth * np.sqrt(np.clip(q, 0, 1)) * smooth(1.08, 0.98, rr) * smooth(0.12, 0.2, rr))
    pet = np.abs(np.mod(np.arctan2(v, u) * 5 / (2 * np.pi), 1.0) - 0.5) * 2
    z = np.maximum(z, 1.15 * depth * np.sqrt(np.clip(1 - (rr / (0.16 + 0.14 * (1 - pet) ** 0.6)) ** 2, 0, 1)))
    # a leaf, outside the bend
    lu, lv = x - cx, (y - (yc + up * half * 0.8)) * up
    w = half * 0.15 * np.sqrt(np.clip(1 - (lu / (step * 0.3)) ** 2, 0, 1))
    ql = np.where(np.abs(lu) < step * 0.3, 1 - (lv / np.maximum(w, 1e-3)) ** 2, -1)
    z = np.maximum(z, 0.7 * depth * np.sqrt(np.clip(ql, 0, 1)) - 0.3 * depth * np.exp(-((lv / (half * 0.03)) ** 2)) * (ql > 0))
    H[sl] = np.where(z > 1e-4, np.maximum(H[sl], base + z), H[sl]).astype(np.float32)


def rosettes(y0, r0, step, depth, n=10, x0=-7.0, x1=7.0, skip=None):
    for k in range(int(math.ceil(x0 / step)), int(math.floor(x1 / step)) + 1):
        cx = k * step
        if skip and skip(cx):
            continue
        sl, x, y = win(cx - r0 * 1.3, cx + r0 * 1.3, y0 - r0 * 1.3, y0 + r0 * 1.3)
        rr = np.hypot(x - cx, y - y0) / r0
        th = np.arctan2(y - y0, x - cx)
        pet = np.abs(np.mod(th * n / (2 * np.pi), 1.0) - 0.5) * 2
        z = depth * (0.75 * np.sqrt(np.clip(1 - (rr / (0.5 + 0.42 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.3) - 0.25 * np.exp(-((pet / 0.14) ** 2)) * ((rr > 0.32) & (rr < 0.85)) + 1.1 * np.sqrt(np.clip(1 - (rr / 0.28) ** 2, 0, 1)) + 0.5 * np.exp(-(((rr - 1.02) / 0.07) ** 2)))
        H[sl] = (H[sl] + np.maximum(z, 0)).astype(np.float32)


def lotus_band(y0, y1, step, depth):
    """A band of petals, hanging."""
    sl, x, y = win(-7, 7, min(y0, y1), max(y0, y1))
    a = (np.mod(x / step + 0.5, 1.0) - 0.5) * 2
    b = np.clip((y - y0) / (y1 - y0), 0, 1)
    w = np.sqrt(np.clip(1 - b**2.4, 0, 1)) * 0.94
    body = np.sqrt(np.clip(1 - (a / np.maximum(w, 1e-3)) ** 2, 0, 1)) * (np.abs(a) < w)
    edge = np.exp(-(((np.abs(a) / np.maximum(w, 1e-3) - 0.78) / 0.1) ** 2)) * (np.abs(a) < w)
    z = depth * (body * (0.55 + 0.45 * b) + 0.22 * edge) - depth * 0.45 * np.exp(-((a / 0.09) ** 2)) * smooth(0.94, 0.5, b)
    H[sl] = (H[sl] + np.where(H[sl] < 0.02, np.maximum(z, 0), 0)).astype(np.float32)


# the upper field: a creeper above and below the great arches, petals under the courses,
# little lotuses between the arches and over the eaves
creeper(-7, 7, 5.13, 0.17, 0.42, 0.05)
lotus_band(4.7, 4.52, 0.16, 0.024)
rosettes(3.92, 0.1, 0.4375, 0.04, 8, skip=lambda cx: False)
for k in range(-4, 4):
    cx = (k + 0.5) * 1.75
    sl, x, y = win(cx - 0.36, cx + 0.36, 4.02, 4.52)
    rr = np.hypot(x - cx, y - 4.28)
    tt = np.arctan2(y - 4.28, x - cx)
    pet = np.abs(np.mod(tt * 14 / (2 * np.pi), 1.0) - 0.5) * 2
    bd = np.mod(tt * 26 / (2 * np.pi), 1.0) - 0.5
    z = 0.045 * np.sqrt(np.clip(1 - (rr / (0.085 + 0.07 * (1 - pet) ** 0.6)) ** 2, 0, 1)) * (rr > 0.05) + 0.06 * np.sqrt(np.clip(1 - (rr / 0.046) ** 2, 0, 1)) + 0.04 * np.exp(-(((rr - 0.185) / 0.018) ** 4)) + 0.026 * np.sqrt(np.clip(1 - ((bd * 2 * np.pi / 26 * 0.15) ** 2 + (rr - 0.15) ** 2) / 0.013**2, 0, 1))
    H[sl] = (H[sl] + z).astype(np.float32)
# either side of the band over the wheel: creepers, and at the band's ends a lotus
for x0, x1 in ((-6.95, -2.56), (2.56, 6.95)):
    sl, x, y = win(x0, x1, 3.1, 3.78)
    sdy = np.abs(y - 3.43) - 0.3
    sdx = np.maximum(x0 + 0.04 - x, x - (x1 - 0.04))
    sd = np.maximum(sdx, sdy)
    H[sl] = (H[sl] + 0.032 * np.exp(-(((sd + 0.02) / 0.016) ** 4)) - 0.012 * smooth(-0.03, -0.05, sd)).astype(np.float32)
    creeper(x0 + 0.1, x1 - 0.1, 3.43, 0.24, 0.5, 0.05, -0.005)
# under the panels and over them: a row of little flowers, a string of beads
rosettes(0.345, 0.052, 0.145, 0.03, 8, skip=lambda cx: not (3.05 < abs(cx) < 5.3))
beads_x(2.12, 0.02, 0.06, 0.045, -5.4, -2.98)
beads_x(2.12, 0.02, 0.06, 0.045, 2.98, 5.4)
# beside the wheel's field, strings of buds
for cx in (-2.24, 2.24):
    sl, x, y = win(cx - 0.08, cx + 0.08, 0.3, 2.16)
    b = (np.mod((y - 0.3) / 0.16, 1.0) - 0.5) * 0.16
    q = 1 - ((x - cx) / 0.032) ** 2 - (b / 0.055) ** 2
    H[sl] = (H[sl] + 0.03 * np.sqrt(np.clip(q, 0, 1))).astype(np.float32)
# the slab round the wheel: in its corners, a spray of leaves
for sx in (-1, 1):
    for sy in (-1, 1):
        ox, oy = sx * 1.74, 1.235 + sy * 1.44
        for n in range(5):
            an = math.atan2(-sy, -sx) + (n - 2) * 0.34
            cx, cy = ox + math.cos(an) * 0.36, oy + math.sin(an) * 0.36
            sl, x, y = win(cx - 0.2, cx + 0.2, cy - 0.2, cy + 0.2)
            u = (x - cx) * math.cos(an) + (y - cy) * math.sin(an)
            v = -(x - cx) * math.sin(an) + (y - cy) * math.cos(an)
            t = np.clip(u / 0.13 * 0.5 + 0.5, 0, 1)
            wd = 0.042 * np.sin(np.pi * t**0.8)
            q = np.where((np.abs(u) < 0.13), 1 - (v / np.maximum(wd, 1e-3)) ** 2, -1)
            rw = np.hypot(x, y - 0.95)
            H[sl] = np.where((q > 0) & (rw > 2.03), np.maximum(H[sl], 0.12 + 0.028 * np.sqrt(np.clip(q, 0, 1)) - 0.012 * np.exp(-((v / 0.007) ** 2))), H[sl]).astype(np.float32)
# the plain stone is in courses: its joints, and where a corner has gone
JY = [3.06, 3.82, 4.0, 4.75, 5.4, 5.85]
for a_, b_ in ((4.02, 4.7), (4.78, 5.36), (5.42, 5.84)):
    sl, x, y = win(-7, 7, a_, b_)
    row = int(a_ * 10) % 3
    jx = np.abs(np.mod(x / 1.31 + row * 0.37, 1.0) - 0.5)
    joint = np.exp(-(((0.5 - jx) * 1.31 / 0.006) ** 2))
    H[sl] = (H[sl] - 0.012 * joint * (H[sl] < 0.012)).astype(np.float32)

# ── time: the stone's own grain, its worn edges, a chip here and there ───────


def noise(scale, octaves=4, seed=0):
    r2 = np.random.default_rng(seed)
    out = np.zeros((Hh, W), np.float32)
    amp = 1.0
    tot = 0.0
    for o in range(octaves):
        n = r2.random((max(2, int(Hh / scale)), max(2, int(W / scale))), np.float32)
        out += amp * cv2.resize(n, (W, Hh), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.5
        scale = max(2.0, scale / 2)
    return out / tot - 0.5


# hand-cut: nothing quite straight
wx, wy = noise(120, 3, 1), noise(120, 3, 2)
gx, gy = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(Hh, dtype=np.float32))
H = cv2.remap(H, gx + wx * 9, gy + wy * 9, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
GOLD = cv2.remap(GOLD, gx + wx * 9, gy + wy * 9, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
del wx, wy, gx, gy
# worn: what stands out has lost its sharpest edge
soft = cv2.GaussianBlur(H, (0, 0), 5)
conv = np.clip(H - soft, 0, 1)
n1 = noise(60, 4, 3)
H -= conv * (0.35 + 0.9 * np.clip(n1 + 0.1, 0, 1))
chips = smooth(0.2, 0.27, noise(46, 3, 5)) * smooth(0.004, 0.015, cv2.GaussianBlur(conv, (0, 0), 6))
H -= 0.03 * chips
# cracks: where a course has settled, hair-thin, wandering
crack = np.zeros((Hh, W), np.uint8)
for k in range(13):
    px, py = rng.uniform(0, W), rng.uniform(0, Hh)
    an = rng.uniform(0, 2 * math.pi)
    pts = [(px, py)]
    for _ in range(int(rng.uniform(14, 60))):
        an += rng.normal(0, 0.24)
        px += math.cos(an) * 16
        py += math.sin(an) * 16
        pts.append((px, py))
        if rng.random() < 0.06:
            bx, by, ba = px, py, an + rng.choice([-0.9, 0.9])
            br = [(bx, by)]
            for _ in range(int(rng.uniform(5, 16))):
                ba += rng.normal(0, 0.5)
                bx += math.cos(ba) * 12
                by += math.sin(ba) * 12
                br.append((bx, by))
            cv2.polylines(crack, [np.int32(br)], False, 120, 1, cv2.LINE_AA)
    cv2.polylines(crack, [np.int32(pts)], False, 220, 1, cv2.LINE_AA)
H -= 0.016 * (cv2.GaussianBlur(crack, (0, 0), 1.1).astype(np.float32) / 255)
# pits: the stone is not close-grained
pits = np.zeros((Hh, W), np.float32)
for _ in range(5200):
    x_, y_, r_ = int(rng.uniform(0, W)), int(rng.uniform(0, Hh)), rng.uniform(1.2, 4.2) ** 1.0
    cv2.circle(pits, (x_, y_), max(1, int(round(r_))), float(rng.uniform(0.3, 1.0)), -1, cv2.LINE_AA)
H -= 0.006 * cv2.GaussianBlur(pits, (0, 0), 1.3)
# the mason's tool, faintly, on what is plain
tool = noise(7, 2, 21)
tool = cv2.GaussianBlur(tool, (0, 0), sigmaX=1.2, sigmaY=7)
flatness = np.clip(1 - np.abs(cv2.Laplacian(cv2.GaussianBlur(H, (0, 0), 4), cv2.CV_32F)) * 260, 0, 1)
H += 0.0042 * tool * flatness
del tool, flatness, pits
GOLD *= np.clip(1.15 - 0.9 * np.clip(noise(26, 3, 11) + 0.05, 0, 1), 0, 1)

LO, HI = -0.085, 0.335
SLOPE = 3.0  # the steepest that is told (units to a unit)


def webp(name, img, q):
    cv2.imwrite(f"{OUT}/{name}.webp", np.round(np.clip(img, 0, 1) * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, q])


def told(g):
    """A slope in a byte: gentle ones finely (its square root)."""
    g = np.clip(g / SLOPE, -1, 1)
    return np.sign(g) * np.sqrt(np.abs(g)) * 0.5 + 0.5


# how open to the light each place is, near and far; how it stands out of what is round it
openness = np.ones((Hh, W), np.float32)
for sg, k in ((4, 14.0), (10, 9.0), (26, 5.0), (60, 2.6)):
    openness *= 1 - np.clip((cv2.GaussianBlur(H, (0, 0), sg) - H) * k, 0, 0.75)
edge = np.clip((H - cv2.GaussianBlur(H, (0, 0), 5)) * 26, -1, 1) * 0.6 + np.clip((H - cv2.GaussianBlur(H, (0, 0), 2)) * 60, -1, 1) * 0.4


def write(tag, x0, x1, w, h, small):
    i0, i1 = int(round((x0 - X0) * K)), int(round((x1 - X0) * K))

    def to(a, ww, hh):
        return cv2.resize(a[:, i0:i1], (ww, hh), interpolation=cv2.INTER_AREA)

    step = (x1 - x0) / w
    fine = to(H, w, h)
    gx = np.zeros_like(fine)
    gy = np.zeros_like(fine)
    gx[:, 1:-1] = (fine[:, 2:] - fine[:, :-2]) / (2 * step)
    gy[1:-1, :] = (fine[:-2, :] - fine[2:, :]) / (2 * step)  # (up is up)
    webp(f"wall_x{tag}", told(gx), 72)
    webp(f"wall_y{tag}", told(gy), 72)
    webp(f"wall_c{tag}", np.vstack([to(openness, small[0], small[1]), to(edge, small[0], small[1]) * 0.5 + 0.5]), 70)
    webp(f"wall_deep{tag}", (to(cv2.GaussianBlur(H, (0, 0), 1.5), small[0], small[1]) - LO) / (HI - LO), 84)
    webp(f"wall_gilt{tag}", to(GOLD, small[0], small[1]), 70)


write("", -7.0, 7.0, 4096, 2048, (2048, 1024))
write("_s", -3.5, 3.5, 1792, 1792, (1024, 1024))


# the verse, as distances from its letters' edges
def far(name, w, h, spread):
    m = cv2.imread(f"{ART}/{name}.png", cv2.IMREAD_GRAYSCALE)
    k = m.shape[1] / w
    ins = cv2.distanceTransform((m > 127).astype(np.uint8), cv2.DIST_L2, 5)
    out = cv2.distanceTransform((m <= 127).astype(np.uint8), cv2.DIST_L2, 5)
    d = (ins - out) / k
    return cv2.resize(np.clip(d / spread * 0.5 + 0.5, 0, 1), (w, h), interpolation=cv2.INTER_AREA)


PW, PH = 640, 480
webp("verse_d", np.vstack([np.hstack([far("v_l_ta", PW, PH, 12), far("v_r_ta", PW, PH, 12)]), np.hstack([far("v_l_en", PW, PH, 12), far("v_r_en", PW, PH, 12)])]), 92)
webp("verse_s", np.vstack([far("v_b_ta", 1536, 208, 10), far("v_b_en", 1536, 208, 10)]), 92)
tiny = cv2.imread(f"{ART}/v_tiny.png", cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
webp("verse_t", cv2.resize(tiny, (1024, 210), interpolation=cv2.INTER_AREA), 88)
print("wall", float(H.min()), float(H.max()))
