"""The worlds the cards curl into (§104.6): public-domain mission maps, filled, graded and
made small; Saturn's and Neptune's bands and Earth's clouds simulated."""
import sys, site
sys.path.append(site.getusersitepackages())
import os
import numpy as np
from PIL import Image, ImageFilter
Image.MAX_IMAGE_PIXELS = None

RAW, OUT = sys.argv[1], sys.argv[2]
ONLY = set(sys.argv[3:])
W, H = 1024, 512
rng = np.random.default_rng(7)
os.makedirs(OUT, exist_ok=True)


def load(name, w=W, h=H):
    im = Image.open(f"{RAW}/{name}").convert("RGB").resize((w, h), Image.LANCZOS)
    return np.asarray(im).astype(np.float32) / 255


def save(name, a, q=82):
    im = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8))
    im.save(f"{OUT}/{name}.webp", quality=q, method=6)
    im.resize((640, 320 * im.size[1] // 512), Image.LANCZOS).save(f"{OUT}/{name}_s.webp", quality=q, method=6)
    print(name, os.path.getsize(f"{OUT}/{name}.webp") // 1024, "KB,", os.path.getsize(f"{OUT}/{name}_s.webp") // 1024, "KB small")


def lum(a):
    return a @ np.array([0.2126, 0.7152, 0.0722], np.float32)


def blur(a, r):
    """Gaussian, round in x (wrapping)."""
    pad = int(r * 3) + 2
    b = np.concatenate([a[:, -pad:], a, a[:, :pad]], 1)
    one = b.ndim == 2
    if one:
        b = b[..., None]
    out = np.stack([np.asarray(Image.fromarray(b[..., c]).filter(ImageFilter.GaussianBlur(r)) if b.dtype == np.uint8 else Image.fromarray((np.clip(b[..., c], 0, 1) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r)), np.float32) / 255 for c in range(b.shape[-1])], -1)
    out = out[:, pad:-pad]
    return out[..., 0] if one else out


def sharp(a, r, k):
    return np.clip(a + (a - blur(a, r)) * k, 0, 1)


def sat(a, k):
    g = lum(a)[..., None]
    return np.clip(g + (a - g) * k, 0, 1)


def gamma(a, g):
    return np.clip(a, 0, 1) ** g


def contrast(a, k, mid=0.4):
    return np.clip((a - mid) * k + mid, 0, 1)


def spectral(beta, ax=1.0, ay=1.0, w=W, h=H, lo=0, seed=None):
    """Noise of a power law, wrapping; ax, ay stretch it (larger: longer that way)."""
    r = np.random.default_rng(seed) if seed is not None else rng
    ky = np.fft.fftfreq(h)[:, None] * h * ay
    kx = np.fft.rfftfreq(w)[None, :] * w * ax * (h / w)
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1
    amp = k ** (-beta)
    amp[k < lo] = 0
    ph = r.standard_normal((h, w // 2 + 1)) + 1j * r.standard_normal((h, w // 2 + 1))
    f = np.fft.irfft2(ph * amp, s=(h, w))
    f -= f.mean()
    return (f / (f.std() + 1e-9)).astype(np.float32)


def sample(f, x, y):
    h, w = f.shape[:2]
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    fx = (x - x0)[..., None] if f.ndim == 3 else x - x0
    fy = (y - y0)[..., None] if f.ndim == 3 else y - y0
    x1 = (x0 + 1) % w
    x0 %= w
    y1 = np.clip(y0 + 1, 0, h - 1)
    y0 = np.clip(y0, 0, h - 1)
    return (f[y0, x0] * (1 - fx) + f[y0, x1] * fx) * (1 - fy) + (f[y1, x0] * (1 - fx) + f[y1, x1] * fx) * fy


YY, XX = np.mgrid[0:H, 0:W].astype(np.float32)
LAT = (0.5 - (YY + 0.5) / H) * 180
LON = (XX + 0.5) / W * 360 - 180
COS = np.maximum(0.08, np.cos(np.radians(LAT)))


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def advect(f, u, v, steps, dt, feed=None, rate=0.0):
    for _ in range(steps):
        f = sample(f, (XX - u * dt) % W, np.clip(YY - v * dt, 0, H - 1))
        if feed is not None:
            f = f * (1 - rate) + feed * rate
    return f


def swirl(psi):
    """A flow that neither gathers nor thins, from its stream function."""
    v = -(np.roll(psi, -1, 1) - np.roll(psi, 1, 1)) * 0.5
    u = np.gradient(psi, axis=0)
    return u / COS, v


def vortex(lat, lon, rad, k):
    dx = ((LON - lon + 180) % 360 - 180) * COS
    dy = LAT - lat
    return k * np.exp(-(dx * dx + dy * dy) / (2 * rad * rad))


def want(n):
    return not ONLY or n in ONLY


# ── Earth: the sea given depth, its clouds, its lights ───────────────────────
if want("earth"):
    e = load("earth.jpg")
    r, g, b = e[..., 0], e[..., 1], e[..., 2]
    sea = smooth(0.03, 0.11, b - np.maximum(r, g) * 1.15) * smooth(0.4, 0.25, lum(e))
    sea = blur(sea, 0.7)
    shelf = blur(1 - sea, 4) * 0.9 + blur(1 - sea, 12) * 0.45
    n = spectral(1.9, seed=3) * 0.035 + spectral(1.4, 2.4, 1, seed=4) * 0.02
    warm = np.exp(-(LAT / 26) ** 2)
    deep = np.stack([0.012 + 0.012 * warm, 0.055 + 0.04 * warm, 0.15 + 0.05 * warm], -1) * (1 + n[..., None] * 4)
    shallow = np.array([0.05, 0.27, 0.36], np.float32) * (0.8 + 0.3 * warm[..., None])
    k = np.clip(shelf, 0, 1)[..., None] ** 1.5
    ocean = deep * (1 - k) + shallow * k
    land = sharp(gamma(sat(contrast(e, 1.12, 0.35), 1.22), 0.92), 1.2, 0.8)
    s = sea[..., None]
    day = ocean * s + land * (1 - s)
    save("earth", day, 84)
    # clouds
    psi = spectral(2.5, seed=11, lo=3) * 20 + spectral(2.0, seed=12, lo=7) * 6
    r2 = np.random.default_rng(5)
    eyes = []
    for i in range(30):
        side = -1 if i % 2 else 1
        la = side * r2.uniform(34, 62)
        lo = (i // 2) * 24 - 180 + r2.uniform(-8, 8) + (12 if side < 0 else 0)
        eyes.append((la, lo))
        psi += vortex(la, lo, r2.uniform(5, 9), side * r2.uniform(34, 66))
    for _ in range(7):
        la = r2.choice([-1, 1]) * r2.uniform(10, 24)
        psi += vortex(la, r2.uniform(-180, 180), r2.uniform(2.2, 3.6), (1 if la > 0 else -1) * r2.uniform(24, 40))
    u, v = swirl(psi)
    u = u * 0.55 + np.sin(np.radians(LAT) * 3.2) * -0.6 + smooth(25, 45, np.abs(LAT)) * 1.1
    v = v * 0.55
    coarse = spectral(1.55, 1.2, 1.0, seed=21, lo=5)
    fine = spectral(1.1, seed=22, lo=14)
    for la, lo in eyes:
        # A front trails from each storm: a band that the turning winds into a comma.
        dx = ((LON - lo + 180) % 360 - 180) * COS
        dy = LAT - la
        coarse = coarse + 1.5 * np.exp(-(((dy + abs(dx) * 0.15 * np.sign(la)) / 3.2) ** 2)) * np.exp(-((dx / 15) ** 2)) - 0.9 * np.exp(-(((dy + np.sign(la) * 8) / 5) ** 2) - ((dx + 6) / 10) ** 2)
    cover = 0.62 * np.exp(-((LAT - 6) / 7) ** 2) + 0.95 * np.exp(-((np.abs(LAT) - 50) / 14) ** 2) - 0.75 * np.exp(-((np.abs(LAT) - 24) / 9) ** 2) + 0.25 * smooth(62, 80, np.abs(LAT))
    src = coarse * 0.8 + cover * 0.85
    c = advect(src, u, v, 40, 1.0, src, 0.015)
    d = advect(fine, u, v, 20, 0.9, fine, 0.05)
    cl = c + d * 0.5 + spectral(0.9, seed=23, lo=20) * 0.12
    cl = smooth(0.15, 2.0, cl) ** 1.1
    puff = smooth(0.7, 2.2, spectral(0.95, seed=24, lo=16) + cover * 0.6) * 0.32
    cl = np.clip(cl + puff * (1 - cl), 0, 1)
    # lights
    li = load("lights.jpg")
    L = np.clip(li[..., 0] * 1.0 - 0.07, 0, 1) * smooth(0.05, 0.16, li[..., 0] - li[..., 2] * 0.35)
    L = np.clip(L * 1.5 + blur(L, 1.6) * 0.8, 0, 1)
    both = np.concatenate([cl, L], 0)
    im = Image.fromarray((np.clip(both, 0, 1) * 255).astype(np.uint8))
    im.save(f"{OUT}/earth_x.webp", quality=72, method=6)
    im.resize((640, 640), Image.LANCZOS).save(f"{OUT}/earth_x_s.webp", quality=72, method=6)
    print("earth_x", os.path.getsize(f"{OUT}/earth_x.webp") // 1024, "KB")

# ── the Moon: its colours, with its relief ───────────────────────────────────
if want("moon"):
    a = load("moon.jpg")
    h = np.asarray(Image.open(f"{RAW}/moonh.jpg").convert("L").resize((W, H), Image.LANCZOS), np.float32) / 255
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 9 / COS.clip(0.3)
    gy = np.gradient(h, axis=0) * 9
    gx, gy = blur(gx * 0.5 + 0.5, 0.6) * 2 - 1, blur(gy * 0.5 + 0.5, 0.6) * 2 - 1
    shade = np.clip(1 + gx * 0.62 + gy * 0.3, 0.55, 1.45)
    a = gamma(contrast(sat(a, 1.35), 1.45, 0.64), 1.9) * shade[..., None]
    save("moon", sharp(a, 1.2, 0.4) * 0.92, 70)

if want("mars"):
    a = load("mars.jpg")
    a = sharp(gamma(contrast(sat(a, 1.45), 1.28, 0.36), 0.92), 1.4, 0.9)
    a = a * np.array([1.03, 1.02, 0.8], np.float32)
    save("mars", a, 74)

if want("jupiter"):
    a = load("jupiter.jpg")
    a = sharp(contrast(sat(a, 1.55), 1.22, 0.55), 1.6, 0.9)
    a = gamma(a, 1.18) * np.array([1.04, 0.98, 0.92], np.float32)
    save("jupiter", a, 78)

if want("venus"):
    a = load("venus.jpg")
    a = gamma(contrast(a, 1.25, 0.32), 1.12)
    save("venus", sharp(a, 1.2, 0.5), 72)

if want("mercury"):
    a = load("mercury.png")
    row = lum(a).mean(1)
    ok = np.where(row > 0.12)[0]
    top, end = ok[0] + 14, ok[-1] - 12
    for y in range(H):
        if y < top:
            a[y] = a[min(H - 1, top + (top - y))]
        if y > end:
            a[y] = a[max(0, end - (y - end))]
    a = gamma(contrast(sat(a, 0.82), 1.1, 0.4), 0.98)
    save("mercury", sharp(a, 1, 0.4), 72)

if want("europa"):
    a = load("europa.jpg")
    g = lum(a)
    for x in range(W):
        bad = np.where(g[:, x] < 0.08)[0]
        bad = bad[bad > H * 0.8]
        if len(bad):
            y0 = bad[0] - 3
            for y in range(y0, H):
                g[y, x] = g[2 * y0 - y - 1 if 2 * y0 - y - 1 > 0 else 0, x]
    low = blur(g, 14)
    base = np.clip((low - 0.42) / 0.36, 0, 1)
    det = np.clip(blur(g, 1.2) - blur(g, 6), -0.12, 0.12)
    rust = np.array([0.50, 0.33, 0.22], np.float32)
    ivory = np.array([0.86, 0.85, 0.81], np.float32)
    ice = np.array([0.70, 0.81, 0.92], np.float32)
    t = np.clip(base * 0.8 + 0.12 + det * 1.6, 0, 1)[..., None]
    col = rust * (1 - t) + ivory * t
    cold = smooth(0.45, 0.85, base)[..., None] * smooth(-0.6, 0.8, spectral(1.8, seed=30))[..., None]
    col = col * (1 - cold * 0.55) + ice * cold * 0.55
    lat, lon = np.radians(LAT), np.radians(LON)
    px = np.stack([np.cos(lat) * np.cos(lon), np.sin(lat), np.cos(lat) * np.sin(lon)], -1)
    wob = spectral(1.9, seed=34) * 0.010 + spectral(1.4, seed=35, lo=12) * 0.0035
    r3 = np.random.default_rng(36)
    for i in range(120):
        n = r3.standard_normal(3)
        n /= np.linalg.norm(n)
        ang = r3.uniform(0.45, 1.57)
        c0 = r3.uniform(0, 6.28)
        span = r3.uniform(0.5, 2.6)
        e1 = np.cross(n, [0.3, 0.9, 0.2])
        e1 /= np.linalg.norm(e1)
        e2v = np.cross(n, e1)
        d = np.arccos(np.clip(px @ n, -1, 1)) - ang + wob * r3.choice([-1, 1]) * r3.uniform(0.4, 1.3)
        w = r3.uniform(0.0035, 0.0125) * (1.5 if i < 14 else 1)
        az = np.arctan2(px @ e2v, px @ e1)
        along = np.clip(1.3 - np.abs(((az - c0 + np.pi) % (2 * np.pi)) - np.pi) / span, 0, 1)
        dark = np.exp(-((np.abs(d) - w * 0.75) / (w * 0.55)) ** 2) * along * r3.uniform(0.35, 0.85)
        pale = np.exp(-((d / (w * 0.4)) ** 2)) * along * 0.35
        halo = np.exp(-((d / (w * 2.6)) ** 2)) * along * 0.16
        k = np.clip(dark + halo, 0, 1)[..., None]
        col = col * (1 - k * 0.8) + np.array([0.37, 0.20, 0.13], np.float32) * k * 0.8
        col = col + pale[..., None] * 0.12
    col = col * (1 + det[..., None] * 1.3)
    save("europa", sharp(col, 1, 0.35), 72)

if want("enceladus"):
    a = load("enceladus.jpg")
    g = lum(a)[..., None]
    blue = np.clip(a[..., 2] - a[..., 0] + 0.02, 0, 1)[..., None]
    a = contrast(a, 1.5, 0.45) * np.array([1.06, 1.1, 1.16], np.float32) + blue * np.array([-0.4, 0.75, 1.0], np.float32)
    save("enceladus", sharp(gamma(a, 0.86), 1, 0.3), 68)

if want("pluto"):
    a = load("pluto.jpg")
    g = lum(a)
    hole = g < 0.02
    edge = np.full(W, H)
    for x in range(W):
        bad = np.where(hole[H // 2:, x])[0]
        if len(bad):
            edge[x] = H // 2 + bad[0] - 4
    e2 = np.round(np.convolve(np.concatenate([edge[-12:], edge, edge[:12]]), np.ones(25) / 25, "same")[12:-12]).astype(int)
    e2 = np.minimum(e2, edge)
    n = spectral(1.7, seed=41)
    base = a.copy()
    for x in range(W):
        for y in range(e2[x], H):
            m = 2 * e2[x] - y - 1
            sx = (x + int(n[y, x] * 6) + (y - e2[x]) // 2) % W
            base[y, x] = a[max(60, min(e2[sx] - 1, m)), sx]
    band = smooth(0, 46, YY - e2[None, :].astype(np.float32))[..., None]
    soft = blur(base, 2.2)
    tone = np.array([0.40, 0.27, 0.21], np.float32) * (1 + n[..., None] * 0.16)
    fill = soft * 0.55 + tone * 0.45
    under = (YY >= e2[None, :])[..., None]
    out = np.where(under, base * (1 - band) + fill * band, a)
    out = gamma(contrast(sat(out, 1.35), 1.15, 0.45), 1.0)
    save("pluto", sharp(out, 1, 0.5), 80)


def line(seed, octs, w=2048):
    """Bands: one number for each latitude."""
    r = np.random.default_rng(seed)
    x = np.linspace(0, 1, w)
    f = np.zeros(w)
    for n, a in octs:
        p = r.uniform(-1, 1, n + 3)
        t = x * n
        i = np.floor(t).astype(int)
        k = t - i
        k = k * k * (3 - 2 * k)
        f += a * (p[i] * (1 - k) + p[i + 1] * k)
    return f


# ── Saturn: pale gold bands, barely stirred ──────────────────────────────────
if want("saturn"):
    prof = line(51, [(14, 0.9), (40, 0.6), (110, 0.34), (300, 0.16)])
    psi = spectral(2.2, 1.0, 1.0, seed=52, lo=5) * 4
    u, v = swirl(psi)
    wave = np.sin(np.radians(LON) * 6 + LAT * 0.3) * 0.18 + spectral(1.9, 2.6, 0.7, seed=53) * 0.22
    lat = LAT + wave
    lat = advect(lat, u * 0.3 + np.sin(np.radians(LAT) * 7) * 1.2, v * 0.16, 26, 1.0)
    t = (lat / 180 + 0.5).clip(0, 1) * 2047
    p = np.interp(t, np.arange(2048), prof)
    p = (p - p.mean()) / p.std()
    stops = np.array([[0.62, 0.50, 0.34], [0.74, 0.62, 0.44], [0.86, 0.75, 0.55], [0.93, 0.85, 0.68], [0.97, 0.92, 0.80]], np.float32)
    q = np.clip(p * 0.19 + 0.55, 0, 0.999) * 4
    i = np.floor(q).astype(int)
    k = (q - i)[..., None]
    col = stops[i] * (1 - k) + stops[np.minimum(4, i + 1)] * k
    pole = smooth(52, 84, np.abs(LAT))[..., None]
    col = col * (1 - pole * 0.5) + np.array([0.52, 0.53, 0.47], np.float32) * pole * 0.5
    hexa = 77 + 0.9 * np.cos(np.radians(LON) * 6)
    col *= 1 - 0.18 * np.exp(-((LAT - hexa) / 0.9) ** 2)[..., None]
    col *= 1 + spectral(1.1, 3.0, 0.6, seed=54)[..., None] * 0.012
    save("saturn", col, 86)

# ── Neptune: azure, a dark storm, white cirrus ───────────────────────────────
if want("neptune"):
    prof = line(61, [(10, 1.0), (26, 0.5), (70, 0.22)])
    psi = spectral(2.3, seed=62, lo=4) * 9 + vortex(-21, 20, 8.5, -70) + vortex(-42, -80, 4, -30) + vortex(28, 120, 4.5, 26)
    u, v = swirl(psi)
    jets = np.cos(np.radians(LAT) * 2.4) * -1.6 + smooth(40, 60, np.abs(LAT)) * 1.6
    lat = advect(LAT + spectral(1.8, 2.5, 0.8, seed=63) * 0.5, u * 0.5 + jets, v * 0.5, 40, 1.0)
    t = (lat / 180 + 0.5).clip(0, 1) * 2047
    p = np.interp(t, np.arange(2048), prof)
    p = (p - p.mean()) / p.std()
    stops = np.array([[0.05, 0.13, 0.46], [0.08, 0.22, 0.62], [0.14, 0.34, 0.80], [0.27, 0.51, 0.92], [0.46, 0.68, 0.97]], np.float32)
    q = np.clip(p * 0.15 + 0.47, 0, 0.999) * 4
    i = np.floor(q).astype(int)
    k = (q - i)[..., None]
    col = stops[i] * (1 - k) + stops[np.minimum(4, i + 1)] * k
    dx = ((LON - 20 + 180) % 360 - 180) * COS / 15
    dy = (LAT + 21) / 6.8
    spot = np.exp(-np.maximum(0, dx * dx + dy * dy - 0.25) * 1.9)[..., None]
    col = col * (1 - spot * 0.62) + np.array([0.02, 0.06, 0.28], np.float32) * spot * 0.62
    cir = advect(smooth(1.1, 2.6, spectral(1.6, 3.4, 0.45, seed=64)), u * 0.6 + jets, v * 0.5, 30, 1.0)
    rim = np.exp(-((dx * dx + dy * dy - 1.5) / 0.5) ** 2) * (dy < -0.2) * (0.5 + 0.5 * np.clip(spectral(1.2, 2.5, 0.6, seed=65), -1, 1))
    c = np.clip(cir * (0.35 + 0.65 * np.exp(-((np.abs(LAT) - 28) / 12) ** 2)) + rim * 0.9, 0, 1)[..., None]
    col = col * (1 - c * 0.85) + np.array([0.93, 0.97, 1.0], np.float32) * c * 0.85
    col *= 1 + spectral(1.0, 2.6, 0.7, seed=66)[..., None] * 0.02
    save("neptune", col, 86)
