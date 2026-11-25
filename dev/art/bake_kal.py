"""KAL's carvings (docs/temple/ART.md), piece by piece.

    python bake_kal.py OUT [s1 eave …]      (nothing named: all of them)

Own drawings, worked out from the shapes of old Tamil halls: no figure of a god, nothing copied."""
import json
import math
import sys

import cv2
import numpy as np

from sculpt import Rock, dome, smooth

OUT = sys.argv[1]
WANT = sys.argv[2:]
MAP = {}


def piece(name):
    def wrap(f):
        if not WANT or name in WANT:
            r = f()
            MAP[name] = r.write(OUT, f"kal_{name}")
            print(name, MAP[name])
            if "-look" in sys.argv:
                cv2.imwrite(f"{OUT}/look_{name}.png", r.lit(r.w * 0.5, r.h * 0.4, 170, power=1.4)[:, :, ::-1])
        return f

    return wrap


# ── living things ────────────────────────────────────────────────────────────
def swan(rock, x0, y0, s, step):
    """A swan walking, its foot at (x0, y0), s px to its own unit; `step`: its stride."""
    E = s * rock.k
    W, Ht = int(1.25 * E), int(1.05 * E)
    z = np.zeros((Ht, W), np.float32)

    def P(x, y):
        return (int(round(x * E)), int(round((1.0 - y) * E)))

    def new():
        return np.zeros((Ht, W), np.uint8)

    def worm(m, pts, r0, r1):
        pts = np.array(pts, np.float32)
        n = len(pts)
        for a in np.linspace(0, n - 1, 120):
            i = min(n - 2, int(a))
            f = a - i
            p0, p1, p2, p3 = pts[max(0, i - 1)], pts[i], pts[i + 1], pts[min(n - 1, i + 2)]
            q = 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f**3)
            cv2.circle(m, P(*q), max(1, int(round((r0 + (r1 - r0) * a / (n - 1)) * E))), 255, -1, cv2.LINE_AA)

    def over(m, rpx, h, base=0.0):
        nonlocal z
        d = cv2.distanceTransform((m <= 127).astype(np.uint8), cv2.DIST_L2, 5)
        z = z - np.where((m <= 127) & (z > 0), 0.1 * h * np.exp(-((d / (0.02 * E + 1)) ** 2)), 0).astype(np.float32)
        dd = cv2.distanceTransform((m > 127).astype(np.uint8), cv2.DIST_L2, 5)
        t = np.clip(dd / (rpx * E), 0, 1)
        z = np.maximum(z, np.where(m > 127, base + h * np.sqrt(1 - (1 - t) ** 2), 0)).astype(np.float32)

    H = 15.0 * s / 96
    for sx, lift in ((step, 0.0), (-step, 0.02)):
        m = new()
        worm(m, [(0.46 + sx * 0.4, 0.22), (0.47 + sx, 0.12), (0.46 + sx, 0.04 + lift)], 0.026, 0.015)
        worm(m, [(0.41 + sx, 0.02 + lift), (0.53 + sx, 0.02 + lift)], 0.014, 0.012)
        over(m, 0.03, 0.34 * H)
    m = new()  # the tail: long feathers that roll up at their ends
    for k in range(6):
        a = 1.75 + k * 0.3
        ex, ey = 0.22 + 0.3 * math.cos(a), 0.36 + 0.36 * math.sin(a)
        worm(m, [(0.3, 0.34), (0.26 + 0.18 * math.cos(a - 0.2), 0.36 + 0.2 * math.sin(a - 0.2)), (ex, ey), (ex - 0.05 * math.cos(a + 1.2), ey + 0.02 * math.sin(a + 1.2)), (ex - 0.035, ey - 0.05)], 0.034, 0.015)
    over(m, 0.035, 0.6 * H)
    m = new()  # the body: low and long, a breast that leads
    cv2.ellipse(m, P(0.48, 0.33), (int(0.26 * E), int(0.125 * E)), -8, 0, 360, 255, -1, cv2.LINE_AA)
    cv2.ellipse(m, P(0.66, 0.36), (int(0.11 * E), int(0.11 * E)), 0, 0, 360, 255, -1, cv2.LINE_AA)
    over(m, 0.13, 0.95 * H)
    m = new()  # the neck: an S, slender
    worm(m, [(0.67, 0.36), (0.79, 0.45), (0.765, 0.6), (0.69, 0.72), (0.7, 0.86), (0.79, 0.915)], 0.066, 0.03)
    over(m, 0.05, 0.72 * H, 0.15 * H)
    m = new()
    cv2.ellipse(m, P(0.805, 0.905), (int(0.05 * E), int(0.036 * E)), -14, 0, 360, 255, -1, cv2.LINE_AA)
    over(m, 0.036, 0.6 * H, 0.22 * H)
    m = new()  # the beak, a stalk with a bud in it
    worm(m, [(0.84, 0.905), (0.9, 0.885), (0.945, 0.865)], 0.018, 0.007)
    over(m, 0.016, 0.42 * H, 0.25 * H)
    m = new()
    worm(m, [(0.93, 0.87), (0.99, 0.76), (0.965, 0.62), (1.02, 0.5), (1.0, 0.4)], 0.009, 0.008)
    cv2.ellipse(m, P(1.0, 0.36), (int(0.026 * E), int(0.05 * E)), 10, 0, 360, 255, -1, cv2.LINE_AA)
    over(m, 0.018, 0.36 * H)
    # beads round the neck's foot; the wing: rows of feathers that end in a point
    m = new()
    for k in range(6):
        t = k / 5
        cv2.circle(m, P(0.6 + 0.16 * t, 0.43 - 0.1 * t + 0.03 * math.sin(3.1 * t)), max(1, int(0.014 * E)), 255, -1, cv2.LINE_AA)
    over(m, 0.014, 0.3 * H, 0.75 * H)
    yy, xx = np.mgrid[0:Ht, 0:W].astype(np.float32)
    ux, uy = xx / E, 1.0 - yy / E
    t = np.clip((0.66 - ux) / 0.42, 0, 1)
    wing = (np.abs(uy - (0.36 + 0.06 * t)) < 0.095 * np.sqrt(np.clip(1 - t**2.2, 0, 1))) & (ux < 0.66) & (ux > 0.22)
    row = np.mod(t * 5.5, 1.0)
    col = np.mod((uy - 0.36) * 24 + np.floor(t * 5.5) * 0.5, 1.0) - 0.5
    z = np.where(wing, z + 0.2 * H * np.sqrt(np.clip(1 - (col * 2) ** 2, 0, 1)) * (1 - row * 0.6), z)
    d = cv2.distanceTransform(wing.astype(np.uint8), cv2.DIST_L2, 5) / E
    z = z - np.where(wing, 0.22 * H * np.exp(-((d / 0.008) ** 2)), 0).astype(np.float32)
    eye = new()
    cv2.circle(eye, P(0.815, 0.91), max(1, int(0.008 * E)), 255, -1, cv2.LINE_AA)
    z = z - 0.25 * H * (cv2.GaussianBlur(eye, (0, 0), 0.8) / 255.0)
    i0, j0 = int(x0 * rock.k), int((y0 - 1.0 * s) * rock.k)
    i1, j1 = i0 + W, j0 + Ht
    ii0, jj0, ii1, jj1 = max(0, i0), max(0, j0), min(rock.W, i1), min(rock.Ht, j1)
    sub = rock.H[jj0:jj1, ii0:ii1]
    zz = z[jj0 - j0 : jj1 - j0, ii0 - i0 : ii1 - i0]
    m = (zz > 0.05).astype(np.uint8)
    d = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5) / rock.k
    sub -= 0.9 * np.exp(-((d / 1.8) ** 2)) * (1 - m)
    rock.H[jj0:jj1, ii0:ii1] = np.maximum(sub, np.where(zz > 0.05, zz + 1.0, sub))


# ── the great horseshoe window ───────────────────────────────────────────────
def great_kudu(rock, cx, cy, R, base=14.0, tight=1.62, crest=(1.3, 0.46)):
    """Its inner edge has radius R; cy its middle. Three mouldings, flame cusps, volutes, a lotus bud for
    crest. What is inside it is left to what goes there."""
    sl, x, y = rock.win(cx - R * 2.1, cx + R * 2.1, cy - R * 2.45, cy + R * 1.75)
    dx, dy = (x - cx) / R, (cy - y) / R
    # a horseshoe: a circle, its foot drawn in
    squeeze = 1.0 - 0.14 * smooth(-0.25, -0.95, dy)
    r0_ = np.hypot(dx / squeeze, dy)
    # (The mouldings, close together: a thin arch round a wide window.)
    rr = np.where(r0_ > 1, 1 + (r0_ - 1) * tight, r0_)
    th = np.arctan2(dy, dx)
    foot = smooth(-1.03, -0.97, dy)

    def ring(r0, w, h, p=4):
        return h * np.exp(-(((rr - r0) / (w / 2)) ** p))

    z = np.zeros_like(rr)
    z = np.maximum(z, ring(1.035, 0.07, 22))
    n = 64
    a = np.mod(th * n / (2 * np.pi), 1.0) - 0.5
    z = np.maximum(z, (17 + 10 * dome(1 - ((a * 2 * np.pi / n * 1.125) ** 2 + (rr - 1.125) ** 2) / 0.041**2)) * (np.abs(rr - 1.125) < 0.05))
    z = np.where((rr > 1.07) & (rr < 1.18) & (z < 17), 15, z)
    z = np.maximum(z, ring(1.215, 0.06, 27))
    # the broad face: a creeper in it
    face = smooth(1.235, 1.25, rr) * smooth(1.52, 1.505, rr)
    z = np.maximum(z, face * 24)
    wave = 1.38 + 0.062 * np.sin(th * 17)
    cre = 9 * dome(1 - ((rr - wave) / 0.018) ** 2)
    for k in range(34):
        ta = (k + 0.5) * 2 * np.pi / 34
        side = 1 if math.sin(ta * 17) > 0 else -1
        rc = 1.38 + side * 0.024
        ddx, ddy = rr * np.cos(th) - rc * math.cos(ta), rr * np.sin(th) - rc * math.sin(ta)
        d = np.hypot(ddx, ddy)
        an = np.arctan2(ddy, ddx) - ta
        spi = np.abs(np.mod(d / 0.036 + side * an / (2 * np.pi), 1.0) - 0.5) * 2
        cre = np.maximum(cre, np.where(d < 0.085, 8.5 * np.clip(1 - spi * 1.15, 0, 1) ** 0.55 * smooth(0.088, 0.068, d), 0))
        cre = np.maximum(cre, 10 * dome(1 - (d / 0.022) ** 2))
    z = z + np.where(face > 0.5, cre, 0)
    z = np.maximum(z, ring(1.545, 0.06, 32))
    # flames round it: tongues that lean away from the middle, a small one between two
    for m_, ph_, ht_, wd_, lv_ in ((40, 0.5, 0.15, 0.4, 12), (40, 0.0, 0.25, 0.5, 18)):
        fa = np.mod(th * m_ / (2 * np.pi) + ph_, 1.0) - 0.5
        fb = np.clip((rr - 1.555) / ht_, 0, 1)
        lean = fa - 0.34 * fb**1.6 * np.sign(dx) * -1 + 0.1 * np.sin(fb * 3.1) * np.sign(dx) * -1
        fw = wd_ * (1 - fb) ** 0.85 * (0.62 + 0.38 * np.cos(fb * 2.2))
        q = np.where((rr > 1.545) & (fb < 1) & (dy > -0.55), 1 - (lean / np.maximum(fw, 1e-3)) ** 2, -1)
        fl = lv_ + 12 * dome(q) - 5 * np.exp(-((lean / np.maximum(fw * 0.3, 1e-3)) ** 2)) * (1 - fb)
        z = np.where(q > 0, np.maximum(z, fl), z)
    z = z * foot
    on = (z > 0.4) & (rr > 1.0)
    # the scrolls it stands on, a leaf out of each
    for sgn in (-1, 1):
        vx, vy = (dx - sgn * 1.1) * sgn * 1.25, (dy + 0.9) * 1.25
        d = np.hypot(vx, vy)
        an = np.arctan2(vy, vx)
        spi = np.abs(np.mod(d / 0.082 + an / (2 * np.pi), 1.0) - 0.5) * 2
        v = np.where(d < 0.22, 20 + 9 * np.clip(1 - spi * 1.15, 0, 1) ** 0.6 * smooth(0.22, 0.17, d), 0)
        v = np.maximum(v, 31 * dome(1 - (d / 0.05) ** 2))
        for k in range(4):
            ta = -0.5 + k * 0.5
            ux, uy = vx * math.cos(ta) + vy * math.sin(ta), -vx * math.sin(ta) + vy * math.cos(ta)
            b = np.clip((ux - 0.16) / 0.26, 0, 1)
            lq = 1 - (uy / (0.075 * np.sin(np.pi * (0.12 + 0.88 * b)) + 1e-3)) ** 2
            v = np.maximum(v, np.where((ux > 0.16) & (ux < 0.42) & (lq > 0), 14 + 9 * dome(lq) - 4 * np.exp(-((uy / 0.012) ** 2)), 0))
        z = np.maximum(z, v)
        on |= v > 0.4
    # the crest: a lotus bud on a collar of petals
    by = (dy - crest[0]) / crest[1]
    cs = crest[1] / 0.46
    for off, sc, lv in ((0.0, 1.0, 26), (-0.3, 0.74, 21), (0.3, 0.74, 21), (-0.55, 0.5, 17), (0.55, 0.5, 17)):
        bx = (dx - off * 0.28 * cs) * 1.25 / cs
        bb = by / sc
        w = (0.17 * sc) * np.sin(np.pi * np.clip(bb, 0, 1) ** 0.66) + 0.004
        bend = off * 0.12 * np.clip(bb, 0, 1) ** 2
        q = np.where((bb > 0) & (bb < 1), 1 - ((bx - bend) / np.maximum(w, 1e-3)) ** 2, -1)
        z = np.where(q > 0, np.maximum(z, lv + 13 * dome(q) - 4 * np.exp(-(((bx - bend) / 0.012) ** 2))), z)
        on |= q > 0
    q = 1 - ((dy - crest[0] - 0.035 * cs) / (0.05 * cs)) ** 2
    z = np.where((q > 0) & (np.abs(dx) < 0.28 * cs), np.maximum(z, 26 + 12 * dome(q) * dome(1 - (dx / (0.29 * cs)) ** 2)), z)
    on |= (q > 0) & (np.abs(dx) < 0.28 * cs)
    rock.H[sl] = np.where(on, base + z, rock.H[sl])
    rock.alpha[sl] = np.maximum(rock.alpha[sl], on.astype(np.float32))
    rock.polish[sl] = np.where(on | ((rr < 1.0) & (dy > -1.0)), 0, rock.polish[sl])
    rock.gold[sl] = np.maximum(rock.gold[sl], np.where(on, np.exp(-(((rr - 1.125) / 0.034) ** 4)) * foot * 0.9, 0))
    # inside: cut deep (the reveal); its floor is another piece's
    inside = (rr < 1.0) & (dy > -1.0)
    depth = -34 * smooth(1.0, 0.955, rr)
    rock.H[sl] = np.where(inside, depth + 10, rock.H[sl])
    return sl, rr


# ── S1 · கலசம், a desktop: 1536 × 676 (the next eave begins below it) ────────
@piece("s1")
def s1():
    r = Rock(1536, 676, 1.5)
    cx = 768.0
    L, Rr = 96.0, 1440.0
    r.alpha[:] = 0
    # the wall itself, from the roof's foot down
    sl, x, y = r.win(0, 1536, 160, 676)
    r.alpha[sl] = 1
    # ── raw rock at both sides, and what it leaves
    side = np.zeros((r.Ht, r.W), np.float32)
    X, Y = np.meshgrid(r.xs, r.ys)
    wob = 10 * np.sin(Y / 47.0) + 7 * np.sin(Y / 19.0 + 1.3)
    side = np.maximum(smooth(L - 4, L - 22, X + wob), smooth(Rr + 4, Rr + 22, X - wob))
    ridge = 96 + 26 * np.sin(X / 63.0) + 14 * np.sin(X / 23.0 + 2)
    rockon = (side > 0.02) & (Y > ridge)
    r.alpha = np.maximum(r.alpha, np.where(side > 0.5, np.clip((Y - ridge) * r.k, 0, 1), 0).astype(np.float32))

    # ── the barrel roofs, left and right
    for x0, x1 in ((L + 10, cx - 168), (cx + 168, Rr - 10)):
        y0, y1 = 116.0, 168.0
        sl, x, y = r.win(x0, x1, y0, y1)
        b = (y - y0) / (y1 - y0)
        bulge = 30 * np.sqrt(np.clip(1 - (1 - np.clip(b * 1.15, 0, 1)) ** 2, 0, 1))
        a = np.mod((x - x0) / 58.0, 1.0)
        rib = 5 * np.exp(-(((a - 0.5) / 0.09) ** 4))
        su, sv = np.mod((x - x0) / 14.5, 1.0) - 0.5, None
        rowi = np.floor(b * 4.2)
        su = np.mod((x - x0) / 14.5 + 0.5 * np.mod(rowi, 2), 1.0) - 0.5
        sv = np.mod(b * 4.2, 1.0)
        scale = 2.6 * dome(1 - (su * 2) ** 2) * (0.35 + 0.65 * sv)
        z = bulge + np.where(rib > 0.6, rib, scale * smooth(0.06, 0.16, np.abs(a - 0.5)))
        r.H[sl] = z
        r.alpha[sl] = 1
        # ridge roll, and kudus along the gable ends
        r.rope(y0 + 2, 6, x0, x1, 15, 9)
        sl, x, y = r.win(x0, x1, y0 - 8, y0 + 8)
        r.alpha[sl] = np.maximum(r.alpha[sl], np.clip((7 - np.abs(y - y0 - 2)) * r.k, 0, 1))
        # small pavilions' windows on the roof
        n = 3
        for i in range(n):
            kx = x0 + (i + 0.5) * (x1 - x0) / n
            r.kudu(kx, 146, 15, 13, base=30)
        for i in range(n + 1):
            fx = x0 + 34 + i * (x1 - x0 - 68) / n
            r.finial(fx, 117, 52, 11)
    # ── the eave: a curved cornice, its petals under it
    for x0, x1 in ((L, cx - 160), (cx + 160, Rr)):
        r.moulding(168, [(0, 34), (4, 34), (4.5, 30), (9, 30), (9.5, 46), (14, 50), (21, 51), (29, 46), (35, 38), (38, 30), (38.5, 22), (42, 22), (42.5, 4), (46, 2)], x0, x1)
        r.petals(199, 211, 15, 5, x0, x1)
        n = int((x1 - x0) / 112)
        for i in range(n):
            kx = x0 + (i + 0.5) * (x1 - x0) / n
            r.kudu(kx, 194, 11, 10, base=44)
        r.beads(171.5, 3.2, 8, 4, x0, x1, 32)
    # ── the architrave: polished black granite, the name's own
    for x0, x1 in ((L, cx - 200), (cx + 200, Rr)):
        r.moulding(214, [(0, 0), (1, 9), (6, 10), (7, 5), (10, 4), (10.5, 0), (101, 0), (101.5, 4), (104.5, 5), (105.5, 10), (111, 10), (112, 0)], x0, x1)
        sl, x, y = r.win(x0, x1, 225, 315)
        r.polish[sl] = 1
        r.beads(220.4, 2.6, 7, 3, x0, x1, 8)
        r.beads(320.6, 2.6, 7, 3, x0, x1, 8)
    # ── the recess under it, with its row of buds
    r.moulding(326, [(0, 0), (2, -10), (16, -10), (18, 6), (20, 6)], L, Rr)
    r.petals(328, 342, 13, 6, L, Rr, down=False)
    # ── the slabs where words stand
    for x0, x1 in ((L + 24, cx - 256), (cx + 256, Rr - 24)):
        r.frame(x0, x1, 352, 466, 24, "rope", 11)
    # pilasters at their sides
    for px in (L + 4, Rr - 4):
        sl, x, y = r.win(px - 20, px + 20, 346, 474)
        prof = np.interp(y, [346, 352, 353, 360, 361, 372, 380, 386, 388, 430, 432, 440, 448, 456, 458, 466, 474], [19, 19, 14, 14, 11, 9, 15, 17, 11, 10, 14, 15, 11, 12, 17, 18, 19])
        q = 1 - ((x - px) / prof) ** 2
        th = np.arcsin(np.clip((x - px) / prof, -1, 1))
        z = np.where(q > 0, 3 + 15 * dome(q) - 1.0 * (0.5 + 0.5 * np.cos(th * 12)) * smooth(388, 392, y) * smooth(430, 426, y), 0)
        r.put(sl, z, gap=1.4)
    # ── the frieze of swans
    r.moulding(474, [(0, 3), (3, 8), (7, 8), (8, 2), (10, 0), (66, 0), (68, 3), (70, 8), (74, 8), (76, 2), (80, -8), (82, -8)], L, Rr)
    r.beads(479.5, 2.6, 7.5, 3, L, Rr, 7)
    strides = [0.05, -0.03, 0.08, 0.0, 0.06, -0.05, 0.03]
    s = 58.0
    for i in range(7):
        swan(r, cx - 250 - 18 - i * 84 - s, 542, s, strides[i])  # placed, then turned below
    left = r.H[int(482 * r.k) : int(542 * r.k), int(L * r.k) : int((cx - 190) * r.k)].copy()
    # (they walk toward the middle: the right half is the left one, turned round)
    w = left.shape[1]
    i1 = int((2 * cx - L) * r.k)
    r.H[int(482 * r.k) : int(542 * r.k), i1 - w : i1] = left[:, ::-1]
    # ── below: pierced windows, and the railing the wheel sinks behind
    for wx0, wx1 in ((L + 24, L + 300), (Rr - 300, Rr - 24)):
        r.frame(wx0, wx1, 560, 604, 9, "bead", 8, polish=False)
        sl, x, y = r.win(wx0 + 9, wx1 - 9, 569, 595)
        u = np.mod((x - wx0) / 13.0 + 0.5 * np.mod(np.floor((y - 569) / 13.0), 2), 1.0) - 0.5
        v = np.mod((y - 569) / 13.0, 1.0) - 0.5
        hole = smooth(0.36, 0.3, np.hypot(u, v))
        r.H[sl] = 2 - 20 * hole
    # (beside the lintel: a creeper in a sunk field)
    for x0, x1 in ((L + 22, cx - 416), (cx + 416, Rr - 22)):
        sl, x, y = r.win(x0, x1, 612, 660)
        e = np.minimum(np.minimum(x - x0, x1 - x), np.minimum(y - 612, 660 - y))
        r.H[sl] = 4 * smooth(0, 1.5, e) - 8 * smooth(5, 7.5, e)
        r.creeper(x0 + 9, x1 - 9, 636, 19, 34, 8, base=-3)
    r.moulding(556, [(0, 2), (2, 10), (6, 10), (7, 4), (9, 4)], cx - 330, cx + 330)
    sl, x, y = r.win(cx - 330, cx + 330, 565, 594)
    a = np.mod((x - cx) / 30.0 + 0.5, 1.0) - 0.5
    post = dome(1 - (a * 30 / (5.2 + 2.2 * np.cos((y - 579) / 7.2))) ** 2)
    disc = np.hypot((np.mod((x - cx) / 60.0, 1.0) - 0.5) * 60, y - 579.5)
    z = np.where(post > 0, 4 + 8 * post, -7)
    z = np.maximum(z, np.where(disc < 10, 6 + 8 * dome(1 - (disc / 10) ** 2), -99))
    r.H[sl] = z
    r.moulding(594, [(0, 4), (2, 10), (7, 10), (8, 3), (10, 3)], cx - 330, cx + 330)
    # ── the lintel with the Kural's first line
    r.frame(cx - 392, cx + 392, 606, 664, 10, "bead", 9)
    r.moulding(664, [(0, 4), (2, 7), (6, 7), (7, 2), (12, 0)], L, Rr)
    # ── the great window
    great_kudu(r, cx, 338, 176)
    # the wall has grain of its own: a mason's hand is not a ruler's
    r.H += (0.55 * r.noise(9) + 0.35 * r.noise(3.2)) * (1 - r.polish) * 0.6
    hand = cv2.GaussianBlur(r.noise(70), (0, 0), 8)
    r.H += 1.2 * hand * (1 - r.polish)
    # and the rock at both sides, proud of it all
    z0 = r.H.copy()
    r.carve_rough(np.ones_like(side), amp=26, cell=58)
    rough = r.H + 26
    r.H = np.where(rockon, z0 * (1 - side) + rough * side, z0).astype(np.float32)
    r.gold *= 1 - side
    return r


# ── the same, for a phone: 393 wide, the names above and below the wheel ─────
@piece("s1p")
def s1p():
    Wd, Ht, Y0 = 393.0, 800.0, 52.0  # (its y is the scene's less 52)
    r = Rock(Wd, Ht, 2.2, seed=77)
    cx = Wd / 2
    L, Rr = 11.0, Wd - 11.0
    r.alpha[:] = 0
    Y = lambda y: y - Y0
    sl, x, y = r.win(0, Wd, Y(118), Ht)
    r.alpha[sl] = 1
    # ── the roof
    x0, x1, y0, y1 = L + 4, Rr - 4, Y(88), Y(128)
    sl, x, y = r.win(x0, x1, y0, y1)
    b = (y - y0) / (y1 - y0)
    bulge = 24 * np.sqrt(np.clip(1 - (1 - np.clip(b * 1.15, 0, 1)) ** 2, 0, 1))
    pitch = (x1 - x0) / 9
    a = np.mod((x - x0) / pitch, 1.0)
    rib = 4.5 * np.exp(-(((a - 0.5) / 0.1) ** 4))
    rowi = np.floor(b * 3.4)
    su = np.mod((x - x0) / (pitch / 4) + 0.5 * np.mod(rowi, 2), 1.0) - 0.5
    sv = np.mod(b * 3.4, 1.0)
    scale = 2.2 * dome(1 - (su * 2) ** 2) * (0.35 + 0.65 * sv)
    r.H[sl] = bulge + np.where(rib > 0.6, rib, scale * smooth(0.06, 0.16, np.abs(a - 0.5)))
    r.alpha[sl] = 1
    r.rope(y0 + 2, 5, x0, x1, 12, 7)
    sl, x, y = r.win(x0, x1, y0 - 7, y0 + 7)
    r.alpha[sl] = np.maximum(r.alpha[sl], np.clip((6 - np.abs(y - y0 - 2)) * r.k, 0, 1))
    for kx in (x0 + 2 * pitch, cx, x1 - 2 * pitch):
        r.kudu(kx, Y(110), 12, 11, base=24)
    for fx in (x0 + 24, cx - 62, cx + 62, x1 - 24):
        r.finial(fx, Y(90), 36, 8)
    # ── the eave
    r.moulding(Y(126), [(0, 26), (3, 26), (3.5, 23), (7, 23), (7.5, 36), (11, 40), (17, 40), (23, 35), (27, 28), (29, 22), (29.5, 16), (32, 16), (32.5, 4), (35, 2)], L, Rr)
    r.petals(Y(150), Y(158), 11.6, 4, L, Rr)
    n = 5
    for i in range(n):
        r.kudu(L + (i + 0.5) * (Rr - L) / n, Y(146), 8.5, 8, base=35)
    r.beads(Y(128.5), 2.4, 6.1, 3, L, Rr, 24)
    # ── the two architraves: polished, his name's own
    for ya, yb in ((162, 226), (580, 640)):
        r.moulding(Y(ya), [(0, 0), (1, 8), (4, 9), (5, 4), (7, 3), (7.5, 0), (yb - ya - 7.5, 0), (yb - ya - 7, 3), (yb - ya - 5, 4), (yb - ya - 4, 9), (yb - ya - 1, 8), (yb - ya, 0)], L, Rr)
        sl, x, y = r.win(L, Rr, Y(ya + 8), Y(yb - 8))
        r.polish[sl] = 1
        r.beads(Y(ya + 2.8), 2.1, 5.8, 2.6, L, Rr, 7)
        r.beads(Y(yb - 2.8), 2.1, 5.8, 2.6, L, Rr, 7)
    # ── round the window: the wall, with a lotus in each corner
    for kx, ky in ((L + 37, 270), (Rr - 37, 270)):
        sl, x, y = r.win(kx - 32, kx + 32, Y(ky - 32), Y(ky + 32))
        d = np.hypot(x - kx, y - Y(ky))
        th = np.arctan2(y - Y(ky), x - kx)
        pt = np.abs(np.mod(th * 12 / (2 * np.pi), 1.0) - 0.5) * 2
        z = np.where(d < 27, 3 + 9 * dome(1 - (d / (12 + 14 * (1 - pt) ** 0.55)) ** 2) * (d > 8), 0)
        z = np.maximum(z, np.where(d < 8, 8 + 5 * dome(1 - (d / 8) ** 2), 0))
        z = np.maximum(z, 8 * np.exp(-(((d - 29) / 2.0) ** 2)))
        r.H[sl] = np.maximum(r.H[sl], z)
    # ── the slab, and the lintel of the couplet (two rows)
    r.frame(L + 6, Rr - 6, Y(648), Y(744), 14, "rope", 9)
    r.moulding(Y(744), [(0, 0), (2, -8), (6, -8), (8, 4), (10, 4)], L, Rr)
    r.frame(L + 6, Rr - 6, Y(754), Y(828), 9, "bead", 8)
    r.moulding(Y(830), [(0, 4), (2, 8), (7, 8), (8, 2), (12, 0), (20, 0)], L, Rr)
    # ── the great window
    great_kudu(r, cx, Y(424), 137, tight=2.45, crest=(1.2, 0.31))
    r.H += (0.55 * r.noise(9) + 0.35 * r.noise(3.2)) * (1 - r.polish) * 0.55
    r.H += 1.0 * cv2.GaussianBlur(r.noise(60), (0, 0), 8) * (1 - r.polish)
    # the rock at both sides
    X, YY = np.meshgrid(r.xs, r.ys)
    wob = 3.2 * np.sin(YY / 31.0) + 2.4 * np.sin(YY / 13.0 + 1.3)
    side = np.maximum(smooth(L + 1, L - 7, X + wob), smooth(Rr - 1, Rr + 7, X - wob)).astype(np.float32)
    ridge = Y(84) + 10 * np.sin(X / 13.0) + 12 * smooth(0, 8, np.minimum(X, Wd - X))
    rockon = (side > 0.02) & (YY > ridge)
    r.alpha = np.where(side > 0.5, np.clip((YY - ridge) * r.k, 0, 1), r.alpha).astype(np.float32)
    z0 = r.H.copy()
    r.carve_rough(np.ones_like(side), amp=16, cell=40)
    rough = r.H + 14
    r.H = np.where(rockon, z0 * (1 - side) + rough * side, z0).astype(np.float32)
    r.gold *= 1 - side
    return r


# ── the wheel of skills: 352 × 352, turned in the shader in three rings ──────
@piece("wheel")
def wheel():
    r = Rock(352, 352, 2.2, seed=12)
    X, Y = np.meshgrid(r.xs, r.ys)
    dx, dy = (X - 176) / 172, (176 - Y) / 172
    rr = np.hypot(dx, dy)
    th = np.arctan2(dy, dx)
    z = np.full_like(rr, -2.0)

    def ringz(r0, w, h, p=4):
        return h * np.exp(-(((rr - r0) / (w / 2)) ** p))

    def petals(r0, r1, n, h, phase=0.0, sharp=0.6, vein=0.35):
        a = (np.mod(th * n / (2 * np.pi) + phase, 1.0) - 0.5) * 2
        b = (rr - r0) / (r1 - r0)
        bb = np.clip(b, 0, 1)
        w = np.where(bb < sharp, 0.74 + 0.24 * np.sin(np.pi * 0.5 * bb / sharp), 0.98 * np.sqrt(np.clip(1 - ((bb - sharp) / (1 - sharp)) ** 2, 0, 1)) ** 0.8)
        q = np.where((b > 0) & (b < 1), 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
        edge = np.exp(-(((np.abs(a) / np.maximum(w, 1e-3) - 0.8) / 0.1) ** 2)) * (q > 0)
        return np.where(q > 0, h * (dome(q) * (0.55 + 0.45 * bb) - vein * 0.35 * np.exp(-((a / 0.1) ** 2)) + 0.12 * edge), -99)

    def beads(r0, n, rad, h):
        a = np.mod(th * n / (2 * np.pi), 1.0) - 0.5
        q = 1 - ((a * 2 * np.pi / n * r0) ** 2 + (rr - r0) ** 2) / rad**2
        return np.where(q > 0, h * dome(q), -99)

    gold = np.zeros_like(rr)
    # ring A (to .60): the rim his face looks out of, a lotus round it
    z = np.where(rr < 0.6, 4, z)
    z = np.maximum(z, 4 + ringz(0.5, 0.045, 9))
    z = np.maximum(z, 4 + petals(0.5, 0.598, 24, 8, 0.5))
    z = np.maximum(z, 5 + petals(0.5, 0.572, 24, 8, 0.0))
    z = np.where(rr < 0.475, -14, z)
    gold = np.maximum(gold, np.exp(-(((rr - 0.5) / 0.016) ** 4)))
    # ring B (.60–.80): spokes, twelve turned and twelve plain
    body = (rr > 0.605) & (rr < 0.8)
    z = np.where(body, -8, z)
    for n, phase, kind in ((12, 0.0, 1), (12, 0.5, 0)):
        a = (np.mod(th * n / (2 * np.pi) + phase, 1.0) - 0.5) * 2 * np.pi / n
        t = a * rr
        s_ = (rr - 0.605) / 0.195
        if kind:
            half = np.interp(s_, [0, 0.1, 0.16, 0.3, 0.42, 0.58, 0.7, 0.84, 0.9, 1], [0.03, 0.034, 0.018, 0.03, 0.018, 0.018, 0.03, 0.018, 0.034, 0.03])
            q = np.where((s_ > 0) & (s_ < 1), 1 - (t / half) ** 2, -1)
            z = np.maximum(z, np.where(q > 0, 1 + 10 * dome(q), -99))
            md = np.hypot(t, rr - 0.7025)
            z = np.maximum(z, np.where(md < 0.034, 8 + 6 * dome(1 - (md / 0.034) ** 2), -99))
        else:
            q = np.where((s_ > 0) & (s_ < 1), 1 - (t / 0.011) ** 2, -1)
            z = np.maximum(z, np.where(q > 0, 1 + 5 * dome(q), -99))
    z = np.maximum(z, 3 + ringz(0.615, 0.026, 8) - 99 * ((rr < 0.6) | (rr > 0.63)))
    z = np.maximum(z, 3 + ringz(0.788, 0.028, 9) - 99 * ((rr < 0.77) | (rr > 0.804)))
    # ring C: the felloe with its vine, sixty beads (the sixty nazhigai of a day), a lotus
    z = np.where(rr > 0.806, 4, z)
    wave = 0.848 + 0.02 * np.sin(th * 20)
    z = np.maximum(z, np.where(rr > 0.806, 4 + 5 * dome(1 - ((rr - wave) / 0.0075) ** 2), z))
    for k in range(40):
        ta = (k + 0.5) * 2 * np.pi / 40
        side = 1 if k % 2 == 0 else -1
        rc = 0.848 - side * 0.01
        d = np.hypot(dx - rc * math.cos(ta), dy - rc * math.sin(ta))
        z = np.maximum(z, np.where(d < 0.022, 4 + 5 * dome(1 - (d / 0.022) ** 2) * (0.55 + 0.45 * np.cos(d * 620)), -99))
    z = np.maximum(z, 4 + ringz(0.882, 0.018, 7) - 99 * (rr < 0.865))
    z = np.maximum(z, 4 + beads(0.907, 60, 0.0225, 8))
    z = np.maximum(z, 4 + petals(0.928, 0.998, 48, 7, 0.5))
    z = np.maximum(z, 5 + petals(0.928, 0.976, 48, 7, 0.0))
    z = np.where(rr > 1.0, -14, z)
    gold = np.maximum(gold, np.exp(-(((rr - 0.882) / 0.007) ** 4)) * 0.9)
    r.H = z.astype(np.float32) + 0.3 * r.noise(4)
    r.gold = gold.astype(np.float32)
    r.alpha = np.clip((1.0 - rr) * 172 * r.k + 0.5, 0, 1).astype(np.float32)
    return r


# ── the railing it sinks behind ──────────────────────────────────────────────
@piece("rail")
def rail():
    r = Rock(316, 52, 2.0, seed=3)
    r.alpha[:] = 0
    r.moulding(0, [(0, 4), (2, 12), (7, 13), (8, 5), (10, 4)], 0, 316)
    r.moulding(42, [(0, 4), (1, 12), (6, 13), (8, 6), (10, 4)], 0, 316)
    sl, x, y = r.win(0, 316, 0, 10)
    r.alpha[sl] = 1
    sl, x, y = r.win(0, 316, 42, 52)
    r.alpha[sl] = 1
    sl, x, y = r.win(0, 316, 10, 42)
    a = (np.mod(x / 26.4 + 0.5, 1.0) - 0.5) * 26.4
    w = 4.6 + 2.0 * np.cos((y - 26) / 6.6)
    q = 1 - (a / w) ** 2
    z = np.where(q > 0, 4 + 9 * dome(q), -20)
    b = (np.mod(x / 52.8, 1.0) - 0.5) * 52.8
    d = np.hypot(b, y - 26)
    pet = np.abs(np.mod(np.arctan2(y - 26, b) * 8 / (2 * np.pi), 1.0) - 0.5) * 2
    disc = np.where(d < 13, 7 + 7 * np.maximum(dome(1 - (d / (5.5 + 5.5 * (1 - pet) ** 0.6)) ** 2) * (d > 3), dome(1 - (d / 3.2) ** 2)), -20)
    z = np.maximum(z, disc)
    r.H[sl] = z
    r.alpha[sl] = np.maximum(np.clip(q * 6, 0, 1), np.clip((13 - d) * r.k, 0, 1))
    r.H += 0.4 * r.noise(4)
    return r


# ── the kit: what every hall is built of ─────────────────────────────────────
@piece("wall")
def wall():
    """The dressed wall: courses of blocks, each with its smooth margin and its pecked face."""
    r = Rock(384, 288, 1.25, seed=41, tile="xy")
    X, Y = np.meshgrid(r.xs, r.ys)
    H = np.zeros_like(X)
    rng = np.random.default_rng(5)
    for c in range(6):
        y0 = c * 48.0
        row = (Y >= y0) & (Y < y0 + 48)
        xs = np.cumsum([0] + [[96, 128, 160], [128, 144, 112], [144, 96, 144]][c % 3])[:-1] + (c * 53) % 96
        for j, xb in enumerate(xs):
            xe = xs[j + 1] if j + 1 < len(xs) else xs[0] + 384
            u = np.mod(X - xb, 384)
            on = row & (u < (xe - xb))
            e = np.minimum(np.minimum(u, (xe - xb) - u), np.minimum(Y - y0, y0 + 48 - Y))
            z = -2.6 * smooth(1.7, 0.3, e) + 1.1 * smooth(6.5, 8.5, e) + rng.uniform(-0.8, 0.8) + rng.normal(0, 0.012) * (u - (xe - xb) / 2) * smooth(0, 4, e)
            H = np.where(on, z, H)
    peck = smooth(0.4, 0.9, H)
    r.H = (H + 0.55 * r.noise(5) * peck + 0.3 * r.noise(2.6) + 0.8 * r.noise(60)).astype(np.float32)
    return r


@piece("rock")
def rock():
    r = Rock(512, 512, 1.0, seed=8, tile="xy")
    r.carve_rough(np.ones_like(r.H), amp=26, cell=58)
    return r


@piece("eave")
def eave():
    """A storey's eave and the neck under it. Its shelf (the lamps') is its first px."""
    r = Rock(336, 104, 1.75, seed=3, tile="x")
    r.moulding(0, [(0, 30), (4, 34), (4.5, 30), (9, 30), (9.5, 46), (14, 50), (21, 51), (29, 46), (35, 38), (38, 30), (38.5, 22), (42, 22), (42.5, 2), (46, -8), (50, -12), (74, -12), (76, -2), (78, 4), (82, 9), (88, 9), (90, 4), (92, 2), (104, 0)], 0, 336)
    r.petals(31, 43, 14, 5, 0, 336)
    for i in range(3):
        r.kudu(56 + i * 112, 26, 11, 10, base=44)
    r.beads(4, 3.2, 8, 4, 0, 336, 32)
    r.petals(52, 72, 16, 8, 0, 336, down=False)
    r.beads(85, 2.6, 7, 3, 0, 336, 7)
    r.H += 0.5 * r.noise(9) + 0.3 * r.noise(3.4)
    return r


@piece("band")
def band():
    """A course of polished granite between two rows of beads: what is cut in it is read."""
    r = Rock(168, 72, 1.75, seed=4, tile="x")
    r.moulding(0, [(0, 0), (1, 8), (5, 9), (6, 5), (8, 4), (8.5, 0), (63.5, 0), (64, 4), (66, 5), (67, 9), (71, 8), (72, 0)], 0, 168)
    sl, x, y = r.win(0, 168, 9, 63)
    r.polish[sl] = 1
    r.beads(3, 2.4, 7, 3, 0, 168, 7)
    r.beads(69, 2.4, 7, 3, 0, 168, 7)
    r.H += 0.3 * r.noise(4) * (1 - r.polish)
    return r


def framed(kind, border, inner, depth, seed):
    M = 6  # the wall round it
    r = Rock(2 * (M + border) + inner, 2 * (M + border) + inner, 1.75, seed=seed, nine=M + border)
    r.frame(M, r.w - M, M, r.h - M, border, kind, depth)
    r.H += (0.35 * r.noise(5) + 0.2 * r.noise(2.6)) * (1 - r.polish)
    return r


@piece("f_rope")
def f_rope():
    return framed("rope", 22, 80, 11, 1)


@piece("f_bead")
def f_bead():
    return framed("bead", 14, 88, 9, 2)


@piece("f_petal")
def f_petal():
    return framed("petal", 20, 85, 10, 3)


@piece("f_plain")
def f_plain():
    return framed("plain", 10, 60, 7, 4)


@piece("side")
def side():
    """The rock left standing at the page's left edge (turned round for its right)."""
    r = Rock(120, 512, 1.25, seed=12, tile="y")
    r.carve_rough(np.ones_like(r.H), amp=20, cell=52)
    X, Y = np.meshgrid(r.xs, r.ys)
    t = 2 * np.pi * Y / 512
    edge = 92 + 9 * np.sin(2 * t + 0.4) + 6 * np.sin(5 * t + 2) + 3.5 * np.sin(11 * t) + 2 * np.sin(23 * t + 1)
    r.H = (r.H + 18 * smooth(0, 34, edge - X) - 6).astype(np.float32)
    r.alpha = np.clip((edge - X) * r.k * 0.8 + 0.5, 0, 1).astype(np.float32)
    return r


if WANT or MAP:
    p = f"{OUT}/kal_map.json"
    try:
        old = json.load(open(p))
    except Exception:
        old = {}
    old.update(MAP)
    json.dump(old, open(p, "w"), indent=0)
