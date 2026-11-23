"""One leaf of the award room's doors (103.2): teak under bronze bands, studs and
lotus bosses, a ring to pull; lit by the gold light in the crack at its right edge."""
import sys
import cv2
import numpy as np

OUT = sys.argv[1]
W, Hh = 2000, 2400
K = 2000.0  # px to one leaf's width; height is 1.2
xs = (np.arange(W, dtype=np.float32) + 0.5) / K
ys = (np.arange(Hh, dtype=np.float32) + 0.5) / K
x, y = np.meshgrid(xs, ys)
H = np.zeros((Hh, W), np.float32)
BR = np.zeros((Hh, W), np.float32)  # where it is bronze


def smooth(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def noise(sx, sy, octaves, seed):
    r = np.random.default_rng(seed)
    out = np.zeros((Hh, W), np.float32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        n = r.random((max(2, int(Hh / sy)), max(2, int(W / sx))), np.float32)
        out += amp * cv2.resize(n, (W, Hh), interpolation=cv2.INTER_CUBIC)
        tot += amp
        amp *= 0.5
        sx, sy = max(2, sx / 2), max(2, sy / 2)
    return out / tot - 0.5


# teak: planks, their grain
grain = noise(14, 420, 4, 1)
fine = noise(4, 260, 3, 2)
H += 0.006 * grain + 0.003 * fine
for px in (0.16, 0.4, 0.64, 0.87):
    H -= 0.012 * np.exp(-(((x - px) / 0.0028) ** 2))


def bronze(mask, z):
    global H, BR
    H = np.where(mask > 0.5, np.maximum(z, H), H)
    BR = np.maximum(BR, mask)


def dome(cx, cy, r, h):
    q = 1 - ((x - cx) ** 2 + (y - cy) ** 2) / r**2
    z = h * np.sqrt(np.clip(q, 0, 1))
    return (q > 0).astype(np.float32), z


# the bands
ROWS = [0.06, 0.33, 0.6, 0.87, 1.14]
for cy in ROWS:
    d = np.abs(y - cy)
    m = (d < 0.048).astype(np.float32)
    z = 0.02 + 0.006 * np.exp(-(((d - 0.041) / 0.0035) ** 4)) + 0.0015 * noise(30, 30, 3, int(cy * 100))
    bronze(m, z)
    # studs along it
    u = (np.mod(x / 0.0655 + 0.5, 1.0) - 0.5) * 0.0655
    q = np.where(x < 0.89, 1 - (u**2 + (y - cy) ** 2) / 0.0215**2, -1)
    H = np.where(q > 0, 0.024 + 0.026 * np.sqrt(np.clip(q, 0, 1)), H)
    q2 = np.where(x < 0.89, np.hypot(u, y - cy), 1)
    H = np.where((q2 > 0.0215) & (q2 < 0.027), np.maximum(H, 0.027), H)
# the stile at the crack
d = np.abs(x - 0.955)
m = (x > 0.91).astype(np.float32)
rope = 0.008 * np.sqrt(np.clip(1 - ((x - 0.925) / 0.012) ** 2, 0, 1)) * (0.7 + 0.3 * np.sin((y * 220 + (x - 0.925) * 260)))
bronze(m, 0.022 + rope + 0.006 * smooth(0.99, 1.0, x) * 0 + 0.0015 * noise(26, 26, 3, 77))
v = (np.mod(y / 0.0655 + 0.5, 1.0) - 0.5) * 0.0655
q = 1 - ((x - 0.967) ** 2 + v**2) / 0.0195**2
H = np.where(q > 0, 0.026 + 0.024 * np.sqrt(np.clip(q, 0, 1)), H)
# lotus bosses in the fields
for cy in (0.195, 0.465, 0.735, 1.005):
    for cx in (0.16, 0.46, 0.755):
        r = np.hypot(x - cx, y - cy)
        th = np.arctan2(y - cy, x - cx)
        for n, r0, r1, hh, ph in ((16, 0.022, 0.07, 0.016, 0.5), (16, 0.019, 0.056, 0.024, 0.0), (8, 0.01, 0.038, 0.032, 0.0)):
            a = (np.mod(th * n / (2 * np.pi) + ph, 1.0) - 0.5) * 2
            b = np.clip((r - r0) / (r1 - r0), 0, 1)
            w = np.where(b < 0.6, 0.8 + 0.18 * b / 0.6, 0.98 * np.sqrt(np.clip(1 - ((b - 0.6) / 0.4) ** 2, 0, 1)) ** 0.8)
            q = np.where((r > r0) & (r < r1), 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
            z = 0.006 + hh * np.sqrt(np.clip(q, 0, 1)) * (0.6 + 0.4 * b) - 0.004 * np.exp(-((a / 0.1) ** 2))
            bronze((q > 0).astype(np.float32), np.where(q > 0, z, 0))
        mm, z = dome(cx, cy, 0.0185, 0.04)
        bronze(mm, np.where(mm > 0, 0.02 + z, 0))
        rr = np.abs(r - 0.0785)
        bronze((rr < 0.0068).astype(np.float32), 0.006 + 0.011 * np.sqrt(np.clip(1 - (rr / 0.0068) ** 2, 0, 1)))
# the ring
cx, cy = 0.755, 0.6
mm, z = dome(cx, cy, 0.05, 0.06)
bronze(mm, np.where(mm > 0, 0.03 + z, 0))
r = np.hypot(x - cx, (y - cy - 0.062) * 0.97)
rr = np.abs(r - 0.088)
tw = 0.016 * (1 + 0.1 * np.cos(np.arctan2(y - cy - 0.062, x - cx) * 26))
q = 1 - (rr / tw) ** 2
H = np.where(q > 0, np.maximum(0.035 + 0.036 * np.sqrt(np.clip(q, 0, 1)), H), H)
BR = np.maximum(BR, (q > 0).astype(np.float32))
mm, z = dome(cx, cy - 0.008, 0.022, 0.03)
H = np.where(mm > 0, np.maximum(H, 0.075 + z), H)

# the light: gold, from the crack (just past the right edge, in front), and a
# breath of cool from above
Hs = cv2.GaussianBlur(H, (0, 0), 1.3)
gx = cv2.Sobel(Hs, cv2.CV_32F, 1, 0, ksize=3) / 8 * K
gy = cv2.Sobel(Hs, cv2.CV_32F, 0, 1, ksize=3) / 8 * K
l = np.sqrt(gx * gx + gy * gy + 1)
nx, ny, nz = -gx / l, -gy / l, 1 / l
ao = np.clip(1 - 16 * (cv2.GaussianBlur(H, (0, 0), 16) - H), 0.25, 1.12)
dirt = noise(90, 90, 5, 9)
wood = np.stack([0.030 + 0.02 * grain, 0.052 + 0.035 * grain, 0.105 + 0.07 * grain], -1)  # BGR
brz = np.stack([0.16 + 0.1 * dirt, 0.30 + 0.12 * dirt, 0.46 + 0.14 * dirt], -1)
pat = smooth(0.06, 0.2, dirt) * 0.55
brz = brz * (1 - pat[..., None]) + np.stack([0.17 + 0 * x, 0.2 + 0 * x, 0.14 + 0 * x], -1) * pat[..., None]
alb = np.where(BR[..., None] > 0.5, brz, wood)


def light(Lx, Ly, Lz, col, power, spec, shin):
    dx, dy, dz = Lx - x, Ly - y, Lz - H
    d2 = dx * dx + dy * dy + dz * dz
    inv = 1 / np.sqrt(d2)
    dx, dy, dz = dx * inv, dy * inv, dz * inv
    ndl = np.clip(nx * dx + ny * dy + nz * dz, 0, 1)
    hx, hy, hz = dx, dy, dz + 1
    hl = np.sqrt(hx * hx + hy * hy + hz * hz)
    ndh = np.clip((nx * hx + ny * hy + nz * hz) / hl, 0, 1)
    f = power / (d2 + 0.03)
    c = np.array(col, np.float32)
    s = (BR * spec * ndh**shin)[..., None] * (0.35 + 0.65 * alb / np.maximum(alb.max(-1, keepdims=True), 1e-3))
    return (alb * ndl[..., None] + s * (ndl > 0)[..., None]) * f[..., None] * c


img = np.zeros((Hh, W, 3), np.float32)
for ly in (0.15, 0.6, 1.05):
    img += light(1.12, ly, 0.2, (0.36, 0.72, 1.0), 0.16, 1.4, 22)
img += light(0.2, -0.7, 1.3, (1.0, 0.82, 0.66), 0.34, 0.5, 16)
img *= ao[..., None]
img = img / (1 + img * 0.65)
img = np.clip(img, 0, 1) ** (1 / 2.2)
img = cv2.resize((img * 255).astype(np.uint8), (1000, 1200), interpolation=cv2.INTER_AREA)
cv2.imwrite(f"{OUT}/door.png", img)
cv2.imwrite(f"{OUT}/door.webp", img, [cv2.IMWRITE_WEBP_QUALITY, 80])
