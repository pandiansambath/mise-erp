"""The coin's two faces as height fields (103.3): everything struck in relief,
worked out at 4096 and kept at 2048 as one grey picture each. Our own drawings."""
import math
import sys

import cv2
import numpy as np

ART = sys.argv[1]
OUT = sys.argv[2]
N = 4096
R = N / 2

yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
U = (xx + 0.5) / R - 1
V = 1 - (yy + 0.5) / R
RR = np.hypot(U, V)
TH = np.arctan2(V, U)
del yy, xx


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def dist(mask):
    return cv2.distanceTransform((mask > 127).astype(np.uint8), cv2.DIST_L2, 5)


def pillow(mask, rpx, h):
    d = dist(mask)
    t = np.clip(d / rpx, 0, 1)
    return (h * np.sqrt(1 - (1 - t) ** 2)).astype(np.float32)


def bevel(mask, rpx, h):
    """A struck letter: a sloped wall, a softly rounded shoulder, a flat top."""
    d = dist(mask)
    t = np.clip(d / rpx, 0, 1)
    return (h * (1 - (1 - t) ** 1.7)).astype(np.float32)


def blank():
    return np.zeros((N, N), np.uint8)


def pt(x, y):
    return [int(round((x + 1) * R)), int(round((1 - y) * R))]


def poly(mask, pts, val=255):
    cv2.fillPoly(mask, [np.array([pt(*p) for p in pts], np.int32)], val, lineType=cv2.LINE_AA)


def line(mask, pts, w, val=255):
    cv2.polylines(mask, [np.array([pt(*p) for p in pts], np.int32)], False, val, max(1, int(round(w * R))), cv2.LINE_AA)


def ring(r0, w, h):
    return h * np.exp(-(((RR - r0) / (w / 2)) ** 4))


def beads(n, r0, rad, h):
    a = np.mod(TH * n / (2 * np.pi), 1.0) - 0.5
    arc = a * (2 * np.pi / n) * r0
    d2 = (arc**2 + (RR - r0) ** 2) / rad**2
    return (h * np.sqrt(np.clip(1 - d2, 0, 1))).astype(np.float32)


def leaf(cx, cy, ang, length, half, h, H):
    """One laurel leaf, pointed at both ends, a vein down its middle."""
    x0, x1 = int((cx - length + 1) * R), int((cx + length + 1) * R)
    y0, y1 = int((1 - cy - length) * R), int((1 - cy + length) * R)
    x0, y0 = max(0, x0), max(0, y0)
    sub = (slice(y0, y1), slice(x0, x1))
    du = U[sub] - cx
    dv = V[sub] - cy
    c, s = math.cos(ang), math.sin(ang)
    a = (du * c + dv * s) / length + 0.5
    b = (-du * s + dv * c) / half
    w = np.sin(np.pi * np.clip(a, 0, 1)) ** 0.72 * (1 - 0.25 * np.clip(a, 0, 1))
    q = np.where((a > 0) & (a < 1), 1 - (b / np.maximum(w, 1e-4)) ** 2, -1)
    body = np.sqrt(np.clip(q, 0, 1))
    vein = np.exp(-((b / 0.11) ** 2)) * smooth(0.0, 0.12, a) * smooth(1.0, 0.8, a)
    side = 0.5 + 0.5 * np.cos((a * 9 - np.abs(b) * 1.6) * 2 * np.pi)
    z = h * np.clip(body * (1 - 0.14 * side * smooth(0.1, 0.5, np.abs(b))) - 0.34 * vein, 0, None)
    z = np.where(q > 0, z, 0)
    H[sub] = np.maximum(H[sub], z.astype(np.float32))


def berry(cx, cy, rad, h, H):
    x0, x1 = int((cx - rad + 1) * R) - 1, int((cx + rad + 1) * R) + 2
    y0, y1 = int((1 - cy - rad) * R) - 1, int((1 - cy + rad) * R) + 2
    sub = (slice(y0, y1), slice(x0, x1))
    d2 = ((U[sub] - cx) ** 2 + (V[sub] - cy) ** 2) / rad**2
    H[sub] = np.maximum(H[sub], (h * np.sqrt(np.clip(1 - d2, 0, 1))).astype(np.float32))


def branch(H, r0, a0, a1, n, mirror):
    """A laurel branch along an arc, from a0 to a1 (degrees), leaves in pairs."""
    stem = blank()
    s = -1 if mirror else 1
    pts = [(s * r0 * math.cos(math.radians(a0 + (a1 - a0) * i / 60)), r0 * math.sin(math.radians(a0 + (a1 - a0) * i / 60))) for i in range(61)]
    line(stem, pts, 0.011)
    np.maximum(H, pillow(stem, 0.006 * R, 0.006), out=H)
    for i in range(n):
        f = (i + 0.5) / n
        a = math.radians(a0 + (a1 - a0) * f)
        tang = a + (math.pi / 2 if a1 > a0 else -math.pi / 2)
        size = 0.86 + 0.14 * math.sin(math.pi * f) - 0.22 * max(0, f - 0.8) / 0.2
        for side in (1, -1):
            off = 0.052 * size
            lean = tang + side * (-0.46 if a1 > a0 else 0.46)
            cx = (r0 + side * off) * math.cos(a) + 0.02 * math.cos(tang)
            cy = (r0 + side * off) * math.sin(a) + 0.02 * math.sin(tang)
            la = lean
            if mirror:
                cx, la = -cx, math.pi - lean
            leaf(cx, cy, la, 0.142 * size, 0.03 * size, 0.0125, H)
        if i % 2 == 0 and 0 < i < n - 1:
            for side in (1, -1):
                ra = a + 0.07 * (1 if a1 > a0 else -1)
                bx = s * (r0 + side * 0.085) * math.cos(ra)
                by = (r0 + side * 0.085) * math.sin(ra)
                berry(bx, by, 0.0135, 0.0105, H)
    # the tip
    a = math.radians(a1)
    tang = a + (math.pi / 2 if a1 > a0 else -math.pi / 2)
    cx, cy, la = r0 * math.cos(a) + 0.03 * math.cos(tang), r0 * math.sin(a) + 0.03 * math.sin(tang), tang
    if mirror:
        cx, la = -cx, math.pi - la
    leaf(cx, cy, la, 0.11, 0.022, 0.011, H)


def star(H, cx, cy, r, points, h, inner=0.42):
    du, dv = U - cx, V - cy
    rr = np.hypot(du, dv)
    sub = rr < r * 1.05
    a = np.mod(np.arctan2(du, dv) * points / (2 * np.pi), 1.0)
    a = np.abs(a - 0.5) * 2  # 1 on a point, 0 between
    edge = r * (inner + (1 - inner) * a**1.6)
    z = h * np.clip(1 - rr / np.maximum(edge, 1e-4), 0, 1) ** 0.7
    H[sub] = np.maximum(H[sub], z[sub].astype(np.float32))


def guilloche(H, keep, rmax):
    """Woven fine lines in the field, as on banknotes and watch dials."""
    depth = np.zeros_like(H)
    for ph, lobes, amp, gap in ((0.0, 24, 0.016, 0.026), (math.pi, 24, 0.016, 0.026), (0.6, 36, 0.009, 0.052)):
        f = (RR + amp * np.cos(lobes * TH + ph)) / gap
        d = np.abs(np.mod(f, 1.0) - 0.5) * gap
        depth = np.maximum(depth, np.exp(-((d / 0.0021) ** 2)).astype(np.float32))
    inside = smooth(rmax, rmax - 0.02, RR) * smooth(0.05, 0.09, RR)
    far = smooth(44, 92, cv2.distanceTransform((keep <= 0.0005).astype(np.uint8), cv2.DIST_L2, 5))
    return -0.0016 * depth * inside * far


def legend(name, H, flat_h=0.0115, rpx=15):
    m = cv2.imread(f"{ART}/{name}", cv2.IMREAD_GRAYSCALE)
    np.maximum(H, bevel(m, rpx, flat_h), out=H)
    return m


def finish(H, engraved, name):
    H = H + engraved
    # the whole struck thing softened a hair, as metal flows
    H = cv2.GaussianBlur(H, (0, 0), 1.6)
    lo, hi = -0.0024, 0.0222
    g = np.clip((H - lo) / (hi - lo), 0, 1)
    g = cv2.resize(g, (2048, 2048), interpolation=cv2.INTER_AREA)
    img = np.round(g * 255).astype(np.uint8)
    cv2.imwrite(f"{OUT}/{name}.png", img)
    print(name, img.min(), img.max(), "field", (0 - lo) / (hi - lo) * 255)


def frame(H):
    np.maximum(H, beads(112, 0.9145, 0.0178, 0.0135), out=H)
    np.maximum(H, ring(0.884, 0.0062, 0.0062).astype(np.float32), out=H)
    np.maximum(H, ring(0.7085, 0.006, 0.006).astype(np.float32), out=H)
    np.maximum(H, ring(0.6955, 0.003, 0.0035).astype(np.float32), out=H)


# ── the front ────────────────────────────────────────────────────────────────
H = np.zeros((N, N), np.float32)
frame(H)
text = cv2.imread(f"{ART}/coin_a_text.png", cv2.IMREAD_GRAYSCALE)
centre = RR < 0.5
one = np.where(centre & (V > -0.13), text, 0).astype(np.uint8)
np.maximum(H, bevel(one, 46, 0.021), out=H)
small = np.where(centre & (V <= -0.13), text, 0).astype(np.uint8)
np.maximum(H, bevel(small, 13, 0.0115), out=H)
leg = np.where(centre, 0, text).astype(np.uint8)
np.maximum(H, bevel(leg, 16, 0.0125), out=H)
# between the legends: a star at either side
for sx in (-1, 1):
    star(H, sx * 0.793, 0.02, 0.05, 8, 0.0125)
branch(H, 0.585, -78, 56, 11, False)
branch(H, 0.585, -78, 56, 11, True)
star(H, 0, 0.6, 0.062, 5, 0.014, 0.36)
for sx in (-1, 1):
    star(H, sx * 0.135, 0.575, 0.034, 5, 0.011, 0.36)
# the ribbon that ties the branches
rib = blank()
for sx in (-1, 1):
    c = pt(sx * 0.062, -0.588)
    cv2.ellipse(rib, tuple(c), (int(0.058 * R), int(0.026 * R)), sx * 24, 0, 360, 255, int(0.017 * R), cv2.LINE_AA)
    poly(rib, [(sx * 0.01, -0.6), (sx * 0.05, -0.645), (sx * 0.1, -0.668), (sx * 0.083, -0.64), (sx * 0.125, -0.638), (sx * 0.07, -0.612), (sx * 0.022, -0.585)])
np.maximum(H, pillow(rib, 0.011 * R, 0.0145), out=H)
berry(0, -0.592, 0.024, 0.0175, H)
engr = guilloche(H, H, 0.47)
finish(H, engr, "coin_a")

# ── the back ─────────────────────────────────────────────────────────────────
H = np.zeros((N, N), np.float32)
frame(H)
text = cv2.imread(f"{ART}/coin_b_text.png", cv2.IMREAD_GRAYSCALE)
tamil = np.where(RR < 0.69, text, 0).astype(np.uint8)
np.maximum(H, bevel(tamil, 11, 0.0105), out=H)
leg = np.where(RR < 0.69, 0, text).astype(np.uint8)
np.maximum(H, bevel(leg, 16, 0.0125), out=H)
for sx in (-1, 1):
    star(H, sx * 0.79, 0.035, 0.04, 8, 0.0115)
# half a wreath under the verse
branch(H, 0.59, -84, -2, 7, False)
branch(H, 0.59, -84, -2, 7, True)
berry(0, -0.592, 0.03, 0.0165, H)
for k in range(8):
    a = k * math.pi / 4 + math.pi / 8
    leaf(0.045 * math.cos(a), -0.592 + 0.045 * math.sin(a), a, 0.075, 0.022, 0.0115, H)

# the lamp, turned on a lathe: half-width at each height
prof = np.array([
    (-0.235, 0.0), (-0.234, 0.17), (-0.215, 0.172), (-0.205, 0.15), (-0.19, 0.142), (-0.178, 0.12), (-0.165, 0.07), (-0.15, 0.045), (-0.135, 0.034),
    (-0.11, 0.03), (-0.1, 0.05), (-0.085, 0.058), (-0.07, 0.05), (-0.06, 0.03), (-0.02, 0.026), (0.0, 0.03), (0.008, 0.048), (0.02, 0.054), (0.032, 0.046), (0.04, 0.028),
    (0.075, 0.03), (0.09, 0.06), (0.105, 0.13), (0.12, 0.178), (0.136, 0.196), (0.148, 0.2), (0.152, 0.19), (0.156, 0.05), (0.165, 0.03), (0.19, 0.024), (0.2, 0.036), (0.212, 0.04), (0.224, 0.034), (0.232, 0.018), (0.25, 0.012), (0.256, 0.0),
], np.float32)
w = np.interp(V[:, 0], prof[:, 0], prof[:, 1], left=0, right=0).astype(np.float32)[:, None]
q = np.where(w > 1e-4, 1 - (U / np.maximum(w, 1e-4)) ** 2, -1)
z = np.sqrt(np.clip(q, 0, 1)) * (0.007 + 0.055 * np.minimum(w, 0.2))
H = np.maximum(H, np.where(q > 0, z, 0).astype(np.float32))


def flame(cx, cy, half, tall, h, H):
    b = (V - cy) / tall
    ww = half * np.sin(np.pi * np.clip(b, 0, 1) ** 0.62) * (1 - 0.35 * np.clip(b, 0, 1))
    bend = cx + 0.12 * half * np.sin(b * 4.0)
    q = np.where((b > 0) & (b < 1), 1 - ((U - bend) / np.maximum(ww, 1e-4)) ** 2, -1)
    return np.maximum(H, np.where(q > 0, h * np.sqrt(np.clip(q, 0, 1)), 0).astype(np.float32))


H = flame(0, 0.262, 0.04, 0.17, 0.019, H)
for sx, hh in ((-0.178, 0.085), (0.178, 0.085), (-0.1, 0.075), (0.1, 0.075)):
    H = flame(sx, 0.156, 0.019, hh, 0.012, H)
# rays from the flame
fx, fy = 0.0, 0.335
du, dv = U - fx, V - fy
fr = np.hypot(du, dv)
fa = np.arctan2(du, dv)  # 0 straight up
rays = 28
k = np.mod(fa * rays / (2 * np.pi) + 0.5, 1.0) - 0.5
long_ = np.where(np.mod(np.floor(fa * rays / (2 * np.pi) + 0.5), 2) == 0, 0.185, 0.145)
half = 0.0075 * smooth(0.0, 0.06, fr - 0.1) * smooth(0, 0.09, long_ - fr)
d = np.abs(k) * (2 * np.pi / rays) * fr
z = 0.0075 * np.sqrt(np.clip(1 - (d / np.maximum(half, 1e-4)) ** 2, 0, 1))
inside = (fr > 0.1) & (fr < long_) & (np.abs(fa) < 1.95) & (RR < 0.53)
H = np.maximum(H, np.where(inside, z, 0).astype(np.float32))

# the open book
for sx in (-1, 1):
    page = blank()
    top = [(sx * x, -0.262 + 0.052 * math.sin(math.pi * min(1, x / 0.36) ** 0.7) - 0.03 * (x / 0.36) ** 2) for x in np.linspace(0.0, 0.36, 30)]
    bot = [(sx * x, -0.452 + 0.04 * math.sin(math.pi * min(1, x / 0.36) ** 0.7) - 0.03 * (x / 0.36) ** 2) for x in np.linspace(0.36, 0.0, 30)]
    poly(page, top + bot)
    page[RR > 0.505] = np.where(RR > 0.505, 0, page)[RR > 0.505]
    z = bevel(page, 18, 0.011)
    # its curve, and its lines of writing
    x = np.clip(U * sx / 0.36, 0, 1)
    z = z * (0.72 + 0.4 * np.sin(np.pi * x**0.7))
    ytop = -0.262 + 0.052 * np.sin(np.pi * x**0.7) - 0.03 * x**2
    k = (ytop - V) / 0.0255
    ln = np.exp(-(((np.mod(k, 1.0) - 0.5) / 0.2) ** 2)) * smooth(0.12, 0.17, x) * smooth(0.93, 0.86, x) * smooth(1.0, 1.4, k) * smooth(7.1, 6.6, k)
    z = np.where(page > 127, z - 0.0036 * ln, 0)
    H = np.maximum(H, z.astype(np.float32))
# its spine and cover
cov = blank()
line(cov, [(-0.385, -0.312), (-0.33, -0.472), (0, -0.455), (0.33, -0.472), (0.385, -0.312)], 0.012)
cov[RR > 0.52] = 0
np.maximum(H, pillow(cov, 0.006 * R, 0.006), out=H)
engr = guilloche(H, H, 0.52)
finish(H, engr, "coin_b")
