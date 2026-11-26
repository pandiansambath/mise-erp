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


# ── S2: chains, every link loose, cut from the one stone ─────────────────────
def chain(n, w, h, k, x0, pitch, y0, sag, half, across, tube):
    """Stadium links, turned ±45° about their length, through one another: found by walking along the
    line of sight to the nearest surface of any of them."""
    r = Rock(w, h, k, seed=31)
    X, Y = np.meshgrid(r.xs, r.ys)
    Z = np.full_like(X, -60.0)
    odd = np.zeros_like(X)
    rho = across - tube
    a = half - tube - rho
    for i in range(n):
        u = (i - (n - 1) / 2) / ((n - 1) / 2)
        cx, cy = x0 + i * pitch, y0 + sag * (1 - u * u)
        slope = math.atan(-2 * u * sag / ((n - 1) / 2) / pitch)
        j0, j1 = max(0, int((cx - half - 4) * k)), min(r.W, int((cx + half + 4) * k))
        x, y = X[:, j0:j1] - cx, Y[:, j0:j1] - cy
        lx = x * math.cos(slope) + y * math.sin(slope)
        ly0 = -x * math.sin(slope) + y * math.cos(slope)
        tilt = math.radians(45 if i % 2 == 0 else -45) + 0.07 * math.sin(i * 2.1)
        z = np.full_like(lx, across + 8.0)
        hit = np.zeros(lx.shape, bool)
        for _ in range(44):
            ly = ly0 * math.cos(tilt) + z * math.sin(tilt)
            lz = -ly0 * math.sin(tilt) + z * math.cos(tilt)
            d = np.hypot(np.hypot(np.maximum(np.abs(lx) - a, 0), ly) - rho, lz) - tube
            hit |= d < 0.12
            z = np.where(hit, z, z - np.clip(d, 0.05, 30) * 0.92)
        z = np.where(hit, z, -60)
        win = z > Z[:, j0:j1]
        Z[:, j0:j1] = np.where(win, z, Z[:, j0:j1])
        odd[:, j0:j1] = np.where(win, i % 2, odd[:, j0:j1])
    on = Z > -50
    floor = float(Z[on].min())
    n1, n2 = r.noise(6), r.noise(2.4)
    r.H = np.where(on, Z + 0.5 * n1 + 0.28 * n2, floor - 6).astype(np.float32)
    r.alpha = cv2.GaussianBlur(on.astype(np.float32), (0, 0), 0.6)
    # (Each link's number goes on past its edge: no seam of the other's.)
    m = (odd > 0.5) & on
    r.gold = (cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 3) < cv2.distanceTransform((~(on & ~m)).astype(np.uint8), cv2.DIST_L2, 3)).astype(np.float32)
    return r


@piece("chain12")
def chain12():
    return chain(12, 1180, 136, 1.6, 62, 96, 36, 46, 62, 31, 9.4)


@piece("chain6")
def chain6():
    return chain(6, 361, 92, 2.4, 40.5, 56, 28, 20, 37, 19.5, 6.0)


# ── S4 · the hall of pillars ─────────────────────────────────────────────────
def pillar(r, cx, y0, y1, w, z0, kind=0, gap=2.0):
    """A pillar of an old hall: square foot, sixteen-sided shaft with its bands, pot, lotus, bracket."""
    h = y1 - y0
    sl, x, y = r.win(cx - w * 1.5, cx + w * 1.5, y0, y1)
    t = (y - y0) / h
    prof = np.interp(t, [0, 0.045, 0.05, 0.09, 0.11, 0.14, 0.17, 0.2, 0.235, 0.24, 0.27, 0.275, 0.5, 0.51, 0.55, 0.56, 0.8, 0.81, 0.84, 0.85, 0.955, 0.96, 1.0],
                     [1.35, 1.35, 1.05, 0.9, 0.55, 0.6, 0.92, 0.95, 0.6, 0.72, 0.72, 0.56, 0.56, 0.66, 0.66, 0.56, 0.58, 0.72, 0.72, 0.82, 0.82, 1.0, 1.0]) * w
    q = 1 - ((x - cx) / prof) ** 2
    th = np.arcsin(np.clip((x - cx) / np.maximum(prof, 1e-3), -1, 1))
    z = np.where(q > 0, z0 + w * 0.85 * dome(q), -99)
    shaft = smooth(0.272, 0.28, t) * smooth(0.805, 0.795, t)
    fl = 0.05 * w * (0.5 + 0.5 * np.cos(th * (16 if kind % 2 == 0 else 8)))
    z = z - np.where(q > 0, shaft * fl, 0)
    # the foot is square, a lotus on its face
    foot = smooth(0.845, 0.852, t) * smooth(0.958, 0.953, t)
    z = np.where((foot > 0.5) & (np.abs(x - cx) < 0.82 * w), z0 + w * 0.62, z)
    d = np.hypot(x - cx, y - (y0 + 0.9 * h)) / (w * 0.5)
    pt = np.abs(np.mod(np.arctan2(y - (y0 + 0.9 * h), x - cx) * 8 / (2 * np.pi), 1.0) - 0.5) * 2
    z = np.where((foot > 0.5) & (d < 1), np.maximum(z, z0 + w * 0.62 + 2.2 * dome(1 - (d / (0.45 + 0.5 * (1 - pt) ** 0.6)) ** 2) * (d > 0.25) + 2.5 * dome(1 - (d / 0.25) ** 2)), z)
    # petals of the lotus under the bracket
    lot = smooth(0.1, 0.115, t) * smooth(0.21, 0.2, t)
    z = z + np.where(q > 0, lot * 0.09 * w * np.cos(th * 9), 0)
    beads = np.exp(-(((t - 0.53) / 0.018) ** 2)) + np.exp(-(((t - 0.255) / 0.012) ** 2)) + np.exp(-(((t - 0.825) / 0.012) ** 2))
    z = z + np.where(q > 0, beads * 0.1 * w * (0.5 + 0.5 * np.cos(th * 18)), 0)
    r.put(sl, z, gap=gap)


@piece("pic_aws")
def pic_aws():
    r = Rock(616, 196, 1.5, seed=61)
    X, Y = np.meshgrid(r.xs, r.ys)
    # the hall goes back: dark between the pillars, its floor in lines to the middle
    r.H[:] = -46
    floor = Y > 158
    d = (Y - 150) / 46
    lines = np.abs(np.mod((X - 308) / (14 + 74 * np.clip(d, 0.05, 1)) + 0.5, 1.0) - 0.5) * 2
    r.H = np.where(floor, -40 + 44 * np.clip((Y - 158) / 38, 0, 1) - 1.2 * smooth(0.06, 0.0, lines) - 1.2 * np.exp(-(((np.mod(np.log(np.maximum(Y - 150, 1)) * 3.1, 1.0) - 0.5) / 0.05) ** 2)), r.H)
    for i in range(8):
        pillar(r, 44 + i * 75.4, 52, 160, 9.5, -42, i, 0.6)
    for i in range(6):
        pillar(r, 82 + i * 90.4, 48, 172, 13.5, -26, i, 1.2)
    for i in range(7):
        pillar(r, 34 + i * 91.3, 44, 192, 19, -6, i, 2.2)
    # the beam, and the cloud over it, its rain
    r.moulding(38, [(0, 16), (3, 20), (8, 20), (9, 14), (12, 12)], 0, 616)
    sl, x, y = r.win(0, 616, 0, 38)
    z = np.full_like(x, 4.0)
    for k in range(19):
        cx = 14 + k * 33 + 6 * math.sin(k * 2.4)
        cy = 17 + 5 * math.sin(k * 1.7)
        rad = 15 + 4 * math.sin(k * 3.1)
        dd = np.hypot(x - cx, (y - cy) * 1.15) / rad
        an = np.arctan2(y - cy, x - cx)
        spi = np.abs(np.mod(dd * 2.6 - an / (2 * np.pi) * (1 if k % 2 else -1), 1.0) - 0.5) * 2
        z = np.maximum(z, np.where(dd < 1, 8 + 8 * dome(1 - dd**2) + 2.4 * (1 - spi) ** 0.7, -9))
    rain = np.abs(np.mod(x / 5.5 + 0.12 * y, 1.0) - 0.5) * 2
    z = np.where((z < 5) & (y > 24), 3 + 1.6 * smooth(0.45, 0.15, rain), z)
    r.H[sl] = z
    r.moulding(0, [(0, 10), (2, 14), (5, 10)], 0, 616)
    r.H += 0.5 * r.noise(8) + 0.32 * r.noise(3)
    return r


# ── S4 · the kolam: one line round every dot ─────────────────────────────────
@piece("pic_kolam")
def pic_kolam():
    r = Rock(616, 196, 1.5, seed=62)
    X, Y = np.meshgrid(r.xs, r.ys)
    cols, rows, sp = 7, 2, 74.0
    x0, y0 = 308 - cols * sp / 2, 98 - rows * sp / 2
    # (The line of a kolam is a ray in a mirrored box: with sides that share no factor, one ray goes
    # everywhere and comes home.)
    tri = lambda v, p: np.abs(np.mod(v, 2 * p) - p)
    n = 2 * 2 * cols * 2 * rows
    t = np.linspace(0, n, 6000)
    px = x0 + tri(t + 0.5, 2 * cols) * sp / 2
    py = y0 + tri(t + 1.5, 2 * rows) * sp / 2
    k = 61
    win = np.hanning(k) / np.hanning(k).sum()
    pad = lambda a: np.convolve(np.concatenate([a[-k:], a, a[:k]]), win, "same")[k:-k]
    pts = np.stack([pad(px), pad(py)], 1)
    mask = np.zeros((r.Ht, r.W), np.uint8)
    cv2.polylines(mask, [np.round(pts * r.k * 16).astype(np.int32)], True, 255, 1, cv2.LINE_AA, 4)
    dl = cv2.distanceTransform((mask < 100).astype(np.uint8), cv2.DIST_L2, 5) / r.k
    r.polish[:] = 1
    grain = r.noise(1.6)
    w = 3.1 + 0.25 * grain + 0.35 * r.noise(9)
    z = 1.5 * dome(1 - (dl / np.maximum(w, 0.5)) ** 2) * (1 + 0.25 * grain)
    line = smooth(0.5, -0.4, dl - w)
    dots = np.zeros_like(X)
    for i in range(cols):
        for j in range(rows):
            d = np.hypot(X - (x0 + (i + 0.5) * sp), Y - (y0 + (j + 0.5) * sp))
            dots = np.maximum(dots, smooth(0.5, -0.4, d - 4.6 - 0.4 * grain))
            z = np.maximum(z, 1.8 * dome(1 - (d / 5.0) ** 2))
    # lotuses in the corners, as one draws them
    for cx, sg in ((40, 1), (576, -1)):
        for cy in (34, 162):
            d = np.hypot(X - cx, Y - cy)
            th = np.arctan2(Y - cy, X - cx)
            rad = 22 * (0.62 + 0.38 * np.abs(np.cos(th * 4)))
            dots = np.maximum(dots, smooth(0.6, -0.4, np.abs(d - rad) - 1.5 - 0.2 * grain))
            dots = np.maximum(dots, smooth(0.5, -0.4, d - 3.4))
    r.gold = np.maximum(line, dots).astype(np.float32) * np.clip(0.86 + 0.16 * r.noise(2.2), 0.4, 1)
    r.polish = (1 - np.maximum(line, dots)).astype(np.float32)
    r.H = (z * np.maximum(line, dots)).astype(np.float32)
    sl, x, y = r.win(0, 616, 0, 196)
    e = np.minimum(np.minimum(x, 616 - x), np.minimum(y, 196 - y))
    r.H[sl] = np.where(e < 7, 6 * smooth(0, 2, e) * smooth(7.5, 5.5, e) + 1, r.H[sl])
    r.polish[sl] = np.where(e < 7, 0, r.polish[sl])
    return r


# ── S5 · the arch of pearls ──────────────────────────────────────────────────
def parrot(r, x0, y0, s, flip, beak):
    """A parrot in low relief, on its perch, in profile."""
    sl, x, y = r.win(x0 - s * 1.3, x0 + s * 1.3, y0 - s * 1.4, y0 + s * 1.7)
    u, v = (x - x0) / s * (-1 if flip else 1), (y - y0) / s
    z = np.full_like(u, -99.0)

    def ell(cx, cy, a, b, rot, h, base):
        nonlocal z
        c, sn = math.cos(rot), math.sin(rot)
        uu, vv = (u - cx) * c + (v - cy) * sn, -(u - cx) * sn + (v - cy) * c
        q = 1 - (uu / a) ** 2 - (vv / b) ** 2
        z = np.where(q > 0, np.maximum(z, base + h * dome(q)), z)
        return uu / a, vv / b, q

    # tail, body, wing, head
    tu, tv, tq = ell(-0.42, 0.98, 0.16, 0.72, 0.32, 4, 4)
    z = np.where(tq > 0, z - 0.8 * np.exp(-(((np.mod(tu * 2.2, 1) - 0.5) / 0.14) ** 2)), z)
    ell(0.0, 0.12, 0.42, 0.68, 0.22, 9, 5)
    wu, wv, wq = ell(-0.16, 0.28, 0.25, 0.6, 0.3, 4, 13)
    fea = np.abs(np.mod(wv * 4.5 + 0.35 * np.abs(wu), 1.0) - 0.5) * 2
    z = np.where(wq > 0, z - 1.5 * smooth(0.3, 0.0, fea), z)
    ell(0.2, -0.6, 0.34, 0.32, 0, 9, 7)
    # the beak, hooked; its two halves apart if it speaks
    hook = [(0.46, -0.7), (0.66, -0.66), (0.74, -0.5), (0.66, -0.34)]
    for k in range(40):
        a = k / 39
        b = (1 - a) ** 3
        cxp = b * hook[0][0] + 3 * a * (1 - a) ** 2 * hook[1][0] + 3 * a * a * (1 - a) * hook[2][0] + a**3 * hook[3][0]
        cyp = b * hook[0][1] + 3 * a * (1 - a) ** 2 * hook[1][1] + 3 * a * a * (1 - a) * hook[2][1] + a**3 * hook[3][1]
        rad = 0.13 * (1 - a) + 0.025
        q = 1 - ((u - cxp) ** 2 + (v - cyp) ** 2) / rad**2
        z = np.where(q > 0, np.maximum(z, 9 + 5 * dome(q)), z)
    ell(0.48, -0.42 + (0.1 if beak else 0.0), 0.13, 0.07, 0.5 if beak else 0.1, 4, 8)
    # eye, collar
    d = np.hypot(u - 0.27, v + 0.66)
    z = np.where(d < 0.075, 18 + 1.5 * dome(1 - (d / 0.075) ** 2), z)
    z = np.where((d > 0.075) & (d < 0.12) & (z > 0), z - 1.6, z)
    col = np.abs(np.hypot((u - 0.2) / 1.1, v + 0.6) - 0.36)
    z = np.where((col < 0.035) & (v > -0.5) & (z > 0), z + 1.6, z)
    # feet on a perch
    q = 1 - ((v - 0.84) / 0.085) ** 2
    z = np.where((q > 0) & (np.abs(u) < 0.95) & (z < 4 + 6 * dome(q)), 4 + 6 * dome(q), z)
    for fx in (0.02, 0.2):
        ell(fx, 0.79, 0.07, 0.13, 0.1, 4, 8)
    r.put(sl, z, gap=1.6)


@piece("pic_genai")
def pic_genai():
    r = Rock(616, 196, 1.5, seed=63)
    X, Y = np.meshgrid(r.xs, r.ys)
    r.H[:] = -2
    # the arch: three mouldings and a frill of flames, over the whole width
    cx, cy, A, B = 308.0, 196.0, 246.0, 150.0
    e = np.hypot((X - cx) / A, (Y - cy) / B)
    th = np.arctan2((cy - Y) / B, (X - cx) / A)
    rr = (e - 1) * (A * B / np.sqrt((B * np.cos(th)) ** 2 + (A * np.sin(th)) ** 2 + 1e-6))
    up = Y < 178
    z = np.full_like(X, -2.0)
    for r0, w, h in ((0, 7, 12), (13, 9, 9), (26, 6, 14)):
        z = np.maximum(z, h * np.exp(-(((rr - r0) / (w / 2)) ** 4)))
    z = np.where((rr > 4) & (rr < 23), np.maximum(z, 5), z)
    wave = 13 + 4.5 * np.sin(th * 34)
    z = np.where((rr > 4) & (rr < 23), np.maximum(z, 5 + 5 * dome(1 - ((rr - wave) / 2.1) ** 2)), z)
    fa = np.mod(th * 30 / np.pi, 1.0) - 0.5
    fb = np.clip((rr - 28) / 19, 0, 1)
    fw = 0.5 * (1 - fb) ** 0.8
    q = np.where((rr > 27) & (fb < 1), 1 - ((fa - 0.22 * fb * np.sign(np.cos(th))) / np.maximum(fw, 1e-3)) ** 2, -1)
    z = np.where(q > 0, np.maximum(z, 6 + 7 * dome(q)), z)
    z = np.where(up, z, -2)
    r.H = np.maximum(r.H, z).astype(np.float32)
    # twelve pearls, hung under it in a festoon; a lotus in their middle
    n = 13
    for k in range(n):
        a = math.pi * (0.1 + 0.8 * k / (n - 1))
        px, py = cx - 214 * math.cos(a), cy - 2 - 124 * math.sin(a)
        rad = 9.2 if k != n // 2 else 15
        sl, x, y = r.win(px - rad - 3, px + rad + 3, py - rad - 3, py + rad + 3)
        d = np.hypot(x - px, y - py)
        if k == n // 2:
            pt = np.abs(np.mod(np.arctan2(y - py, x - px) * 10 / (2 * np.pi), 1.0) - 0.5) * 2
            zz = np.where(d < rad, 4 + 9 * np.maximum(dome(1 - (d / (rad * (0.5 + 0.5 * (1 - pt) ** 0.6))) ** 2) * (d > 5), dome(1 - (d / 5) ** 2)), -9)
        else:
            zz = np.where(d < rad, 2 + 11 * dome(1 - (d / rad) ** 2), -9)
            r.gold[sl] = np.maximum(r.gold[sl], smooth(0.4, -0.6, d - rad))
        r.put(sl, zz, gap=2.0)
    for k in range(n * 3 - 2):
        a = math.pi * (0.1 + 0.8 * k / (n * 3 - 3))
        if k % 3:
            px, py = cx - 214 * math.cos(a), cy - 2 - 124 * math.sin(a)
            sl, x, y = r.win(px - 4, px + 4, py - 4, py + 4)
            d = np.hypot(x - px, y - py)
            r.put(sl, np.where(d < 2.8, 2 + 4 * dome(1 - (d / 2.8) ** 2), -9))
    # the two who talk: one speaks, the other listens
    parrot(r, 84, 112, 46, False, True)
    parrot(r, 532, 112, 46, True, False)
    r.moulding(180, [(0, 2), (2, 9), (7, 10), (9, 4), (12, 6), (16, 6)], 0, 616)
    r.H += (0.5 * r.noise(8) + 0.32 * r.noise(3)) * (1 - r.gold)
    return r


# ── S5 · the water steps ─────────────────────────────────────────────────────
@piece("pic_msg")
def pic_msg():
    r = Rock(616, 196, 1.5, seed=64)
    X, Y = np.meshgrid(r.xs, r.ys)

    def rrect(x0, x1, y0, y1, rad):
        ax, ay = np.abs(X - (x0 + x1) / 2) - (x1 - x0) / 2 + rad, np.abs(Y - (y0 + y1) / 2) - (y1 - y0) / 2 + rad
        return np.hypot(np.maximum(ax, 0), np.maximum(ay, 0)) + np.minimum(np.maximum(ax, ay), 0) - rad

    z = np.where(Y < 66, 14.0, np.where(Y < 128, 4.0, -6.0))
    # the risers between the terraces, with petals cut in them
    for yr, hi, lo in ((66, 14, 4), (128, 4, -6)):
        t = np.clip((Y - yr + 7) / 14, 0, 1)
        a = np.mod(X / 22.0, 1.0) - 0.5
        pet = dome(1 - (a / np.maximum(0.47 * np.sqrt(np.clip(1 - t**2.2, 0, 1)), 1e-3)) ** 2)
        z = np.where(np.abs(Y - yr) < 7, hi + (lo - hi) * t + 2.6 * pet, z)
    wet = np.zeros_like(X)

    def hollow(sd, depth, rim=3.2):
        nonlocal z, wet
        z = z + 2.2 * np.exp(-(((sd - 1.5) / rim) ** 2)) - depth * smooth(0.8, -2.2, sd)
        wet = np.maximum(wet, smooth(-1.2, -2.6, sd))

    # two rows of four basins, a channel from each to the next
    for row, y0 in ((0, 18), (1, 80)):
        for k in range(4):
            hollow(rrect(96 + k * 118, 168 + k * 118, y0, y0 + 36, 8), 9)
        for k in range(3):
            hollow(rrect(164 + k * 118, 218 + k * 118, y0 + 13, y0 + 23, 2), 7, 1.6)
    hollow(rrect(30, 100, 31, 41, 2), 7, 1.6)
    hollow(rrect(518, 566, 31, 41, 2), 7, 1.6)
    hollow(rrect(556, 566, 31, 103, 2), 7, 1.6)
    hollow(rrect(518, 566, 93, 103, 2), 7, 1.6)
    hollow(rrect(50, 100, 93, 103, 2), 7, 1.6)
    hollow(rrect(50, 60, 93, 150, 2), 7, 1.6)
    hollow(rrect(34, 582, 146, 184, 10), 11)
    r.H = z.astype(np.float32)
    # the spout: a lotus it comes out of
    sl, x, y = r.win(4, 52, 12, 60)
    d = np.hypot(x - 28, y - 36)
    pt = np.abs(np.mod(np.arctan2(y - 36, x - 28) * 10 / (2 * np.pi), 1.0) - 0.5) * 2
    r.put(sl, np.where(d < 23, 15 + 9 * dome(1 - (d / (10 + 13 * (1 - pt) ** 0.6)) ** 2) * (d > 8), -9), gap=1)
    # a petal in each basin, some in the tank
    def petal(px, py, rot, sz):
        sl, x, y = r.win(px - sz, px + sz, py - sz, py + sz)
        c, sn = math.cos(rot), math.sin(rot)
        u, v = ((x - px) * c + (y - py) * sn) / sz, (-(x - px) * sn + (y - py) * c) / sz
        w = 0.42 * np.sqrt(np.clip(1 - u * u, 0, 1)) * (1 - 0.35 * u)
        q = np.where(np.abs(u) < 1, 1 - (v / np.maximum(w, 1e-3)) ** 2, -1)
        r.gold[sl] = np.maximum(r.gold[sl], smooth(0, 0.25, q))
        r.H[sl] = np.where(q > 0, r.H[sl] + 2.6 * dome(q) - 0.8 * np.exp(-((v / 0.06) ** 2)), r.H[sl])

    for row, y0 in ((0, 36), (1, 98)):
        for k in range(4):
            petal(132 + k * 118 + 5 * math.sin(k * 3 + row), y0 + 2 * math.cos(k * 2), 0.5 + k * 1.3 + row, 10.5)
    for k in range(9):
        petal(80 + k * 57 + 8 * math.sin(k * 2.2), 165 + 5 * math.sin(k * 1.9), k * 0.9, 9.5)
    rip = np.sin(X / 2.6 + 1.5 * np.sin(Y / 7)) * np.sin(Y / 3.1 + X / 21)
    r.H = (r.H + wet * 0.22 * rip + (0.5 * r.noise(8) + 0.32 * r.noise(3)) * (1 - wet)).astype(np.float32)
    r.polish = np.where(r.gold > 0.3, 0, wet).astype(np.float32)
    return r


# ── shapes a hand would carve, put together ──────────────────────────────────
class Relief:
    """A figure in low relief in its own little box: ellipses, tapering limbs; the higher wins."""

    def __init__(self, r, x0, y0, s, box, flip=False):
        self.r = r
        self.sl, x, y = r.win(x0 + box[0] * s, x0 + box[1] * s, y0 + box[2] * s, y0 + box[3] * s)
        self.u, self.v = (x - x0) / s * (-1 if flip else 1), (y - y0) / s
        self.z = np.full_like(self.u, -99.0)

    def ell(self, cx, cy, a, b, rot, h, base):
        c, sn = math.cos(rot), math.sin(rot)
        uu, vv = (self.u - cx) * c + (self.v - cy) * sn, -(self.u - cx) * sn + (self.v - cy) * c
        q = 1 - (uu / a) ** 2 - (vv / b) ** 2
        self.z = np.where(q > 0, np.maximum(self.z, base + h * dome(q)), self.z)
        return uu / a, vv / b, q

    def limb(self, pts, r0, r1, h, base, rings=0):
        n = 46
        (x0, y0), (x1, y1), (x2, y2), (x3, y3) = pts
        for k in range(n):
            a = k / (n - 1)
            b = 1 - a
            cx = b**3 * x0 + 3 * a * b * b * x1 + 3 * a * a * b * x2 + a**3 * x3
            cy = b**3 * y0 + 3 * a * b * b * y1 + 3 * a * a * b * y2 + a**3 * y3
            rad = r0 + (r1 - r0) * a
            if rings:
                rad *= 1 + 0.05 * math.cos(a * rings * 2 * math.pi)
            q = 1 - ((self.u - cx) ** 2 + (self.v - cy) ** 2) / rad**2
            self.z = np.where(q > 0, np.maximum(self.z, base + h * rad / max(r0, r1) * dome(q)), self.z)

    def done(self, gap=1.6):
        self.r.put(self.sl, self.z, gap=gap)


def elephant(r, x0, y0, s, step=0.0):
    f = Relief(r, x0, y0, s, (-1.5, 1.25, -0.95, 1.12))
    # the far legs, the near ones
    for lx, st, base in ((-0.2, -step, 1), (0.42, step, 1), (-0.42, step, 4), (0.66, -step, 4)):
        f.limb([(lx, 0.1), (lx, 0.4), (lx + st * 0.6, 0.6), (lx + st, 0.97)], 0.2, 0.14, 6, base)
        f.ell(lx + st - 0.01, 0.99, 0.165, 0.07, 0, 5, base)
    f.ell(0.12, -0.02, 0.74, 0.5, 0.02, 11, 5)
    f.ell(0.5, 0.04, 0.44, 0.5, 0.1, 11, 5)
    f.ell(-0.36, 0.0, 0.42, 0.48, -0.1, 11, 5)
    f.ell(-0.84, -0.24, 0.33, 0.34, 0.2, 11, 6)
    f.ell(-0.8, -0.46, 0.18, 0.16, 0, 8, 8)
    f.limb([(-1.06, -0.18), (-1.28, 0.1), (-1.26, 0.5), (-1.05, 0.72)], 0.17, 0.07, 10, 6, 11)
    f.limb([(-1.0, 0.03), (-1.1, 0.16), (-1.2, 0.17), (-1.3, 0.1)], 0.055, 0.025, 6, 12)
    # ear, eye
    eu, ev, eq = f.ell(-0.56, -0.16, 0.22, 0.33, -0.15, 3.5, 15)
    f.z = np.where((eq > 0) & (eq < 0.3), f.z + 1.2, f.z)
    d = np.hypot(f.u + 0.93, f.v + 0.24)
    f.z = np.where(d < 0.045, f.z + 1.8, f.z)
    # the cloth on its back, its fringe; a band on its brow
    cl = (np.abs(f.u - 0.12) < 0.34) & (f.v < 0.16) & (f.v > -0.46)
    edge = np.minimum(0.34 - np.abs(f.u - 0.12), 0.16 - f.v)
    f.z = np.where(cl & (f.z > 0), f.z + 1.4 + 0.9 * np.exp(-(((edge - 0.06) / 0.025) ** 2)), f.z)
    fr = (np.abs(f.u - 0.12) < 0.34) & (f.v >= 0.16) & (f.v < 0.25)
    f.z = np.where(fr & (f.z > 0), f.z + 1.0 * (0.5 + 0.5 * np.cos(f.u * 60)), f.z)
    f.limb([(0.98, -0.16), (1.08, 0.0), (1.06, 0.2), (1.1, 0.42)], 0.05, 0.035, 4, 4)
    f.done()


@piece("pic_devops")
def pic_devops():
    r = Rock(616, 196, 1.5, seed=65)
    X, Y = np.meshgrid(r.xs, r.ys)
    # the road, the wall behind
    r.moulding(176, [(0, 3), (2, 9), (7, 9), (9, 4), (20, 3)], 0, 616)
    for k in range(5):
        elephant(r, 78 + k * 78, 124 - (0 if k else 0), 36 if k else 36, 0.16 * math.sin(k * 2.2 + 0.5))
    elephant(r, 22 + 452, 150, 19, 0.14)
    # the rope over their backs, twisted, its knots
    x = np.linspace(40, 520, 900)
    ry = 94 + 5 * np.sin(x / 38.0) + 0.0 * x
    for side in (0,):
        yy = np.interp(X, x, ry)
        on = (X > 40) & (X < 520)
        q = np.where(on, 1 - ((Y - yy) / 4.2) ** 2, -1)
        tw = 0.5 + 0.5 * np.cos((X / 7.5 + (Y - yy) / 8) * 2 * np.pi)
        r.H = np.where(q > 0, np.maximum(r.H, 17 + 5.5 * dome(q) * (0.7 + 0.3 * tw)), r.H)
    for k in range(11):
        kx = 62 + k * 43.4
        ky = 94 + 5 * math.sin(kx / 38.0)
        f = Relief(r, kx, ky, 8, (-1.4, 1.4, -1.4, 1.4))
        f.ell(0, 0, 0.95, 0.78, 0.5, 7, 19)
        f.ell(0.1, 0.05, 0.5, 0.95, -0.6, 6, 20)
        f.done(1.2)
        r.gold[f.sl] = np.maximum(r.gold[f.sl], (f.z > 19).astype(np.float32))
    # the chariot: its platform, its tower, its wheels
    for k, (hw, y0, y1, h) in enumerate(((62, 116, 130, 16), (54, 92, 116, 13), (42, 66, 92, 11), (29, 42, 66, 9), (16, 24, 42, 8))):
        sl, xx, yy = r.win(538 - hw, 538 + hw, y0, y1)
        b = (yy - y0) / (y1 - y0)
        col = np.abs(np.mod((xx - 538) / (hw / 3.0) + 0.5, 1.0) - 0.5) * 2
        z = h + 3 * np.exp(-(((b - 0.06) / 0.08) ** 2)) + 4 * smooth(0.8, 0.88, b) - 3 * smooth(0.5, 0.2, 1 - col) * smooth(0.15, 0.3, b) * smooth(0.82, 0.7, b)
        r.H[sl] = np.maximum(r.H[sl], z)
        if k in (1, 2, 3):
            r.kudu(538, (y0 + y1) / 2 + 2, min(9, hw * 0.24), 6, base=h + 2)
    r.finial(538, 26, 22, 7)
    r.moulding(130, [(0, 16), (3, 20), (8, 20), (9, 14), (12, 12)], 470, 606)
    for wx, wr in ((508, 23), (570, 23)):
        f = Relief(r, wx, 154, wr, (-1.1, 1.1, -1.1, 1.1))
        d = np.hypot(f.u, f.v)
        th = np.arctan2(f.v, f.u)
        sp = np.abs(np.mod(th * 12 / (2 * np.pi), 1.0) - 0.5) * 2
        z = np.where(d < 1, 9.0, -99)
        z = np.where(d < 0.8, 5 + 5 * smooth(0.55, 0.85, sp), z)
        z = np.where((d > 0.78) & (d < 1), 10 + 5 * dome(1 - ((d - 0.89) / 0.11) ** 2) + 0.8 * np.cos(th * 30), z)
        z = np.where(d < 0.26, 12 + 5 * dome(1 - (d / 0.26) ** 2), z)
        f.z = z
        f.done(1.6)
    r.H += 0.5 * r.noise(8) + 0.32 * r.noise(3)
    return r


# ── S6 · pierced windows, each another geometry ──────────────────────────────
@piece("pic_front")
def pic_front():
    r = Rock(616, 196, 1.5, seed=66)
    X, Y = np.meshgrid(r.xs, r.ys)
    hole = np.zeros_like(X)
    z = np.full_like(X, 4.0)
    for k in range(8):
        cx = 42 + k * 76
        u, v = X - cx, Y - 98
        hw, hh = 28.0, 78.0
        # each in a frame with a little arch over it
        top = np.hypot(u / hw, np.minimum(v + hh - hw, 0) / hw)
        sd = np.where(v < -(hh - hw), (top - 1) * hw, np.maximum(np.abs(u) - hw, v - hh))
        z = np.where(np.abs(sd - 4) < 4, 4 + 8 * dome(1 - ((sd - 4) / 4) ** 2), z)
        z = np.where(np.abs(sd - 4) < 4, z + 0.9 * np.cos(np.where(np.abs(u) > hw - 2, v, u) * 0.9), z)
        ins = sd < 0
        if k == 0:
            row = np.floor((v + 100) / 13)
            g = np.hypot(np.mod(u + 6.5 * np.mod(row, 2) + 6.5, 13) - 6.5, np.mod(v + 100, 13) - 6.5) - 4.4
        elif k == 1:
            g = (np.abs(np.mod(u + 8, 16) - 8) / 1.0 + np.abs(np.mod(v + 100, 22) - 11) / 1.35) - 5.6
        elif k == 2:
            a, b = u / 9.2, v / 9.2
            q0, r0 = a * 2 / 3, -a / 3 + b * 0.57735
            s0 = -q0 - r0
            rq, rr_, rs = np.round(q0), np.round(r0), np.round(s0)
            dq, dr, ds = np.abs(rq - q0), np.abs(rr_ - r0), np.abs(rs - s0)
            g = (np.maximum(np.maximum(np.abs((q0 - np.where((dq > dr) & (dq > ds), -rr_ - rs, rq))), 0), 0) * 0)
            rq2 = np.where((dq > dr) & (dq > ds), -rr_ - rs, rq)
            rr2 = np.where((dr >= dq) & (dr > ds), -rq - rs, rr_)
            hx = u - 9.2 * 1.5 * rq2
            hy = v - 9.2 * math.sqrt(3) * (rr2 + rq2 / 2)
            g = np.maximum(np.abs(hy), np.abs(hx) * 0.866 + np.abs(hy) * 0.5) - 5.8
        elif k == 3:
            mu, mv = np.mod(u + 7, 14) - 7, np.mod(v + 98, 14) - 7
            g = np.hypot(np.maximum(np.abs(mu) - 3.2, 0), np.maximum(np.abs(mv) - 3.2, 0)) - 1.6
        elif k == 4:
            mu, mv = np.mod(u + 9.3, 18.6) - 9.3, np.mod(v + 98, 18.6) - 9.3
            g = np.minimum(np.maximum(np.abs(mu), np.abs(mv)), np.maximum(np.abs(mu + mv), np.abs(mu - mv)) * 0.7071) - 5.4
        elif k == 5:
            c = 15.0
            mu, mv = np.mod(u + c / 2, c) - c / 2, np.mod(v + c / 2, c) - c / 2
            four = np.minimum(np.abs(np.hypot(np.abs(mu) - c / 2, np.abs(mv)) - c * 0.62), 99)
            g = np.maximum(np.hypot(mu - c / 2 * np.sign(mu), mv) - c * 0.6, -99)
            lens = np.maximum(np.hypot(np.abs(mu) - c * 0.5, mv - c * 0.5) - c * 0.66, np.hypot(np.abs(mu) - c * 0.5, mv + c * 0.5) - c * 0.66)
            lens2 = np.maximum(np.hypot(mu - c * 0.5, np.abs(mv) - c * 0.5) - c * 0.66, np.hypot(mu + c * 0.5, np.abs(mv) - c * 0.5) - c * 0.66)
            g = np.minimum(lens, lens2) + 1.2
        elif k == 6:
            w = np.mod(u + 4 * np.sin(v / 7.0) + 6, 12) - 6
            g = np.abs(w) - 3.2
            g = np.maximum(g, np.abs(np.mod(v, 44) - 22) - 19.5)
        else:
            # woven from one letter
            mu, mv = np.mod(u + 9.5, 19) - 9.5, np.mod(v + 98, 22) - 11
            box = np.maximum(np.abs(mu) - 6.4, np.abs(mv) - 7.6)
            inner = np.maximum(np.abs(mu) - 2.4, -(mv - 3.4))
            inner = np.maximum(np.abs(mu) - 2.4, mv - 3.4)
            g = np.maximum(box, -inner)
        g = np.maximum(g, sd + 4.5)
        h = smooth(0.5, -0.5, g) * ins
        hole = np.maximum(hole, h)
        z = np.where(ins, -1.0, z)
        z = z + np.where(ins, 1.8 * np.exp(-(((g - 1.4) / 1.3) ** 2)), 0)
    # sill and lintel
    r.H = np.where(hole > 0.5, -16, z).astype(np.float32)
    r.H = cv2.GaussianBlur(r.H, (0, 0), 0.8)
    r.gold = hole.astype(np.float32)
    r.moulding(0, [(0, 12), (3, 15), (7, 15), (8, 8), (10, 5)], 0, 616)
    r.moulding(182, [(0, 5), (2, 12), (8, 14), (10, 8), (14, 8)], 0, 616)
    r.H += (0.45 * r.noise(8) + 0.3 * r.noise(3)) * (1 - hole)
    return r


# ── S7 · the treasury's doorway: five thresholds and the bronze leaves ───────
@piece("door")
def door():
    r = Rock(420, 500, 1.6, seed=71)
    X, Y = np.meshgrid(r.xs, r.ys)
    z = np.full_like(X, 0.0)
    cx = 210.0
    halves = [210, 190, 169, 148, 128, 108]
    tops = [34, 56, 78, 100, 122, 144]
    depth = [0, -16, -34, -54, -76]
    for n in range(5):
        W, T = halves[n], tops[n]
        ax, ay = np.abs(X - cx) - W, T - Y
        sd = np.maximum(ax, ay)
        per = np.where(ax > ay, Y, X - cx)
        b = -sd
        wd = halves[n] - halves[n + 1]
        on = (sd < 0) & (b < wd)
        base = depth[n]
        zz = base + 3.5 * np.exp(-(((b - 2.5) / 1.6) ** 4)) + 3.5 * np.exp(-(((b - wd + 2.5) / 1.6) ** 4))
        m = wd / 2
        if n == 0:
            a = (np.mod(per / 13.0, 1.0) - 0.5) * 13
            q = 1 - (a**2 + (b - m) ** 2) / 5.2**2
            zz = np.maximum(zz, np.where(q > 0, base + 1 + 6 * dome(q), -99))
        elif n == 1:
            a = np.mod(per / 18.0, 1.0)
            wave = m + 3.6 * np.sin(per / 18.0 * 2 * np.pi)
            zz = np.maximum(zz, np.where(np.abs(b - wave) < 1.6, base + 1 + 4 * dome(1 - ((b - wave) / 1.6) ** 2), -99))
            for ph, sg in ((0.25, -1), (0.75, 1)):
                aa = (np.mod(per / 18.0 - ph + 0.5, 1.0) - 0.5) * 18
                dd = np.hypot(aa, b - m - sg * 2.2)
                zz = np.maximum(zz, np.where(dd < 4.6, base + 1 + 4.5 * dome(1 - (dd / 4.6) ** 2) * (0.6 + 0.4 * np.cos(dd * 2.6)), -99))
        elif n == 2:
            q = 1 - ((b - m) / 5.4) ** 2
            tw = 0.5 + 0.5 * np.cos((per / 11 + (b - m) / 11) * 2 * np.pi)
            zz = np.where(q > 0, np.maximum(zz, base + 1 + 7 * dome(q) * (0.66 + 0.34 * tw)), zz)
        elif n == 3:
            fl = np.cos((b - m) / 2.1 * np.pi)
            zz = np.where(np.abs(b - m) < 6.2, base + 3 + 1.8 * fl, zz)
            kn = np.exp(-(((np.mod(per / 42.0, 1.0) - 0.5) / 0.06) ** 2))
            zz = np.where(np.abs(b - m) < 7, zz + 3 * kn, zz)
        else:
            a = (np.mod(per / 15.0, 1.0) - 0.5) * 2
            t = np.clip((wd - 4 - b) / (wd - 8), 0, 1)
            w = np.sqrt(np.clip(1 - t**2.4, 0, 1)) * 0.95
            q = np.where(t < 1, 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
            zz = np.where((q > 0) & (b > 4), np.maximum(zz, base + 1 + 5.5 * dome(q)), zz)
        z = np.where(on, zz, z)
    # the leaves: bronze, in panels, a boss in each
    ins = (np.abs(X - cx) < 108) & (Y > 144)
    lx, ly = np.abs(X - cx), Y - 144
    zz = np.full_like(X, -92.0)
    px, py = np.mod(lx - 3, 52.5), np.mod(ly - 4, 58.5)
    e = np.minimum(np.minimum(px, 52.5 - px), np.minimum(py, 58.5 - py))
    zz += 5 * smooth(6.5, 4.0, e) + 1.6 * np.exp(-(((e - 9) / 1.5) ** 2))
    d = np.hypot(px - 26.25, py - 29.25)
    zz = np.maximum(zz, np.where(d < 13, -91 + 11 * dome(1 - (d / 13) ** 2), -99))
    pt = np.abs(np.mod(np.arctan2(py - 29.25, px - 26.25) * 12 / (2 * np.pi), 1.0) - 0.5) * 2
    zz = np.maximum(zz, np.where((d > 12) & (d < 20), -91 + 4 * dome(1 - ((d - 12) / (3 + 5 * (1 - pt))) ** 2), -99))
    for qx in (4, 48.5):
        for qy in (4, 54.5):
            dd = np.hypot(px - qx, py - qy)
            zz = np.maximum(zz, np.where(dd < 2.2, -86 + 3 * dome(1 - (dd / 2.2) ** 2), -99))
    zz = np.where(lx < 1.6, -99, zz)
    rd = np.hypot(lx - 18, ly - 178)
    zz = np.maximum(zz, np.where(np.abs(rd - 12) < 2.4, -82 + 4 * dome(1 - ((rd - 12) / 2.4) ** 2), -99))
    z = np.where(ins, zz, z)
    r.gold = (ins & (lx > 1.6)).astype(np.float32)
    # outside the frame: not there; over it, the crest with two fish
    sd0 = np.maximum(np.abs(X - cx) - 210, 34 - Y)
    r.alpha = (sd0 < 0).astype(np.float32)
    r.H = z.astype(np.float32)
    for sg in (-1, 1):
        f = Relief(r, cx + sg * 17, 19, 17, (-1.2, 1.2, -1.1, 1.2), flip=sg > 0)
        f.ell(0, 0.05, 0.42, 0.86, 0.12, 8, 4)
        f.limb([(0.06, 0.62), (0.16, 0.8), (0.34, 0.86), (0.5, 0.98)], 0.14, 0.03, 5, 4)
        f.limb([(0.06, 0.62), (0.0, 0.82), (-0.14, 0.9), (-0.3, 1.0)], 0.14, 0.03, 5, 4)
        sc = np.abs(np.mod(f.v * 5 + 0.6 * np.abs(f.u), 1.0) - 0.5) * 2
        f.z = np.where((f.z > 4) & (f.v > -0.35) & (f.v < 0.6), f.z - 1.0 * smooth(0.35, 0.0, sc), f.z)
        dd = np.hypot(f.u + 0.16, f.v + 0.52)
        f.z = np.where(dd < 0.09, f.z + 1.4, f.z)
        on = f.z > 0
        r.alpha[f.sl] = np.maximum(r.alpha[f.sl], on.astype(np.float32))
        r.gold[f.sl] = np.where(on, 1, r.gold[f.sl])
        f.done(0.8)
    sl, x, y = r.win(60, 360, 24, 36)
    q = 1 - ((x - cx) / 150) ** 2
    yb = 35 - 10 * np.sqrt(np.clip(q, 0, 1)) * 0.6
    on = (y > yb) & (q > 0)
    r.H[sl] = np.where(on & (r.alpha[sl] < 0.5), 6, r.H[sl])
    r.alpha[sl] = np.maximum(r.alpha[sl], on.astype(np.float32))
    r.H += (0.5 * r.noise(8) + 0.32 * r.noise(3)) * (1 - 0.6 * r.gold)
    return r


# ── S8 · a golden lotus, and the pond it stands in ───────────────────────────
@piece("lotus")
def lotus():
    r = Rock(150, 120, 2.2, seed=81)
    r.alpha[:] = 0
    X, Y = np.meshgrid(r.xs, r.ys)
    cx, cy = 75.0, 74.0
    z = np.full_like(X, -20.0)
    # rows of petals, the hindmost first; each a spoon that curls towards its tip
    rows = [(-1, 9, 62, 50, 2, 0.0), (-0.6, 8, 52, 52, 6, 0.5), (0.15, 7, 44, 47, 11, 0.0), (0.7, 6, 34, 36, 16, 0.5), (1, 9, 60, 26, 10, 0.5)]
    for lean, n, rx, ry, lift, ph in rows:
        for k in range(n):
            a = math.pi * ((k + ph + 0.5) / n)
            dx, dy = math.cos(a), math.sin(a)
            tipx, tipy = cx + rx * dx, cy - (ry * dy if lean < 1 else -ry * 0.55 * dy) + (0 if lean < 1 else 2)
            ux, uy = tipx - cx, tipy - cy
            L = math.hypot(ux, uy) + 1e-3
            ux, uy = ux / L, uy / L
            t = ((X - cx) * ux + (Y - cy) * uy) / L
            o = (-(X - cx) * uy + (Y - cy) * ux)
            w = (6.5 + 0.17 * L) * np.sin(np.pi * np.clip(t, 0, 1) ** 0.72) ** 0.8
            q = np.where((t > 0.02) & (t < 1), 1 - (o / np.maximum(w, 1e-3)) ** 2, -1)
            zz = lift + 7 * dome(q) * (0.5 + 0.5 * t) + 6 * t * t - 1.3 * np.exp(-((o / 1.1) ** 2))
            on = q > 0
            z = np.where(on, np.where(zz > z - 4, zz, z), z)
    d = np.hypot((X - cx) / 1.0, (Y - cy + 6) / 0.62)
    z = np.where(d < 15, np.maximum(z, 24 + 4 * dome(1 - (d / 15) ** 2)), z)
    for k in range(9):
        a = k * 2 * math.pi / 8
        rr = 8.5 if k < 8 else 0
        dd = np.hypot(X - cx - rr * math.cos(a), (Y - cy + 8 - rr * 0.6 * math.sin(a)))
        z = np.where(dd < 2.2, np.maximum(z, 27 + 2.4 * dome(1 - (dd / 2.2) ** 2)), z)
    on = z > -10
    r.H = np.where(on, z, -8).astype(np.float32)
    r.alpha = cv2.GaussianBlur(on.astype(np.float32), (0, 0), 0.6)
    r.gold = on.astype(np.float32)
    r.H += 0.25 * r.noise(3)
    return r


@piece("pond")
def pond():
    """The carved pond: water in ripples, round leaves; its lip above, its foot below. Repeats."""
    r = Rock(616, 116, 1.5, seed=82, tile="x")
    X, Y = np.meshgrid(r.xs, r.ys)
    r.moulding(0, [(0, 2), (2, 10), (8, 12), (10, 4), (13, -10), (100, -10), (103, 4), (106, 11), (113, 11), (116, 3)], 0, 616)
    pool = (Y > 13) & (Y < 101)
    wet = pool.astype(np.float32)
    tau = 2 * np.pi / 616
    rip = np.sin(Y / 4.2 + 1.4 * np.sin(X * tau * 5) + 0.8 * np.sin(X * tau * 11 + 2))
    r.H = np.where(pool, r.H + 1.3 * np.abs(rip) ** 0.7 * np.sign(rip), r.H).astype(np.float32)
    rng = np.random.default_rng(7)
    for k in range(15):
        lx, ly, lr = 20 + k * 41 + rng.uniform(-9, 9), rng.uniform(34, 86), rng.uniform(13, 21)
        for off in (-616, 0, 616):
            u, v = (X - lx - off) / lr, (Y - ly) / (lr * 0.52)
            d = np.hypot(u, v)
            th = np.arctan2(v, u)
            cutn = smooth(0.1, 0.02, np.abs(np.mod(th - 0.9 - k, 2 * np.pi) - np.pi) / np.pi * d)
            zz = -5 + 2.4 * d + 1.4 * np.exp(-(((d - 0.93) / 0.07) ** 2)) - 0.8 * np.exp(-(((np.mod(th * 9 / (2 * np.pi), 1.0) - 0.5) / 0.08) ** 2)) * d
            on = (d < 1) & (cutn < 0.5) & pool
            r.H = np.where(on, np.maximum(zz, r.H - 99), r.H).astype(np.float32)
            wet = np.where(on, 0, wet)
    r.polish = (wet * 0.0).astype(np.float32)
    r.H += (0.4 * r.noise(8) + 0.28 * r.noise(3)) * (1 - 0.6 * wet)
    return r


# ── S9 · the balance ─────────────────────────────────────────────────────────
@piece("beam")
def beam():
    r = Rock(380, 60, 1.8, seed=91)
    r.alpha[:] = 0
    X, Y = np.meshgrid(r.xs, r.ys)
    u = np.abs(X - 190) / 190
    half = 7.5 - 3.6 * u
    yc = 34 + 6 * u**2 - 2
    q = np.where(u < 0.97, 1 - ((Y - yc) / half) ** 2, -1)
    z = np.where(q > 0, 4 + 9 * dome(q), -20)
    for c in (0.14, 0.34, 0.62, 0.9):
        q2 = np.where(np.abs(u - c) < 0.022, 1 - ((Y - yc) / (half + 2.4)) ** 2, -1)
        z = np.where(q2 > 0, np.maximum(z, 5 + 11 * dome(q2)), z)
    # its ends curl up into buds; its heart is a lotus
    for sg in (-1, 1):
        f = Relief(r, 190 + sg * 180, 30, 14, (-1.2, 1.2, -1.6, 1.4), flip=sg < 0)
        f.limb([(-0.5, 0.5), (0.3, 0.6), (0.75, 0.1), (0.4, -0.5)], 0.32, 0.16, 8, 4)
        f.ell(0.36, -0.8, 0.26, 0.46, 0.1, 8, 5)
        z[f.sl] = np.maximum(z[f.sl], f.z)
    d = np.hypot(X - 190, Y - 32)
    pt = np.abs(np.mod(np.arctan2(Y - 32, X - 190) * 12 / (2 * np.pi), 1.0) - 0.5) * 2
    z = np.where(d < 20, np.maximum(z, 12 + 8 * dome(1 - (d / (9 + 11 * (1 - pt) ** 0.6)) ** 2) * (d > 7)), z)
    z = np.where(d < 7, 19 + 5 * dome(1 - (d / 7) ** 2), z)
    on = z > -10
    r.H = np.where(on, z, -4).astype(np.float32) + 0.2 * r.noise(3)
    r.alpha = cv2.GaussianBlur(on.astype(np.float32), (0, 0), 0.6)
    r.gold = on.astype(np.float32)
    return r


@piece("pan")
def pan():
    r = Rock(132, 186, 1.8, seed=92)
    r.alpha[:] = 0
    X, Y = np.meshgrid(r.xs, r.ys)
    z = np.full_like(X, -20.0)
    for ex in (12, 66, 120):
        t = np.clip((Y - 6) / 138, 0, 1)
        lx = 66 + (ex - 66) * t
        lk = np.mod(Y / 6.0 + (0.5 if ex == 66 else 0), 1.0) - 0.5
        w = 2.3 - 0.9 * np.abs(lk) * 2
        q = np.where((Y > 6) & (Y < 144), 1 - ((X - lx) / w) ** 2, -1)
        z = np.where(q > 0, np.maximum(z, 3 + 4 * dome(q)), z)
    d = np.hypot(X - 66, Y - 7)
    z = np.where((d < 6.5) & (d > 3), np.maximum(z, 4 + 4 * dome(1 - ((d - 4.75) / 1.75) ** 2)), z)
    # the bowl, seen a little from above
    rim = 1 - ((X - 66) / 60) ** 2 - ((Y - 146) / 11) ** 2
    bowl = np.where((Y > 146) & (np.abs(X - 66) < 60), 1 - ((X - 66) / 60) ** 2 - ((Y - 146) / 32) ** 2, -1)
    z = np.where(bowl > 0, 3 + 15 * dome(bowl) + 0.8 * np.cos((X - 66) / 4.2) * smooth(0.1, 0.4, bowl), z)
    z = np.where(rim > 0, -3 - 6 * dome(rim), z)
    ring = np.abs(np.sqrt(np.clip(1 - rim, 0, 4)) - 1)
    z = np.where(ring < 0.075, np.maximum(z, 6 + 6 * dome(1 - (ring / 0.075) ** 2)), z)
    on = z > -15
    r.H = np.where(on, z, -8).astype(np.float32) + 0.2 * r.noise(3)
    r.alpha = cv2.GaussianBlur(on.astype(np.float32), (0, 0), 0.6)
    r.gold = on.astype(np.float32)
    return r


@piece("post")
def post():
    r = Rock(96, 300, 1.6, seed=93)
    r.alpha[:] = 0
    pillar(r, 48, 34, 300, 30, 2, 0, 0)
    r.alpha = cv2.GaussianBlur((r.H > 3).astype(np.float32), (0, 0), 0.6)
    f = Relief(r, 48, 24, 15, (-1.2, 1.2, -1.5, 1.2))
    f.ell(0, 0.4, 0.55, 0.5, 0, 14, 10)
    f.ell(0, -0.5, 0.24, 0.8, 0, 12, 10)
    r.alpha[f.sl] = np.maximum(r.alpha[f.sl], (f.z > 0).astype(np.float32))
    f.done(0)
    r.H += 0.4 * r.noise(6) + 0.28 * r.noise(3)
    return r


# ── S11 · the last block, the steps to the water ─────────────────────────────
@piece("boulder")
def boulder():
    r = Rock(420, 230, 1.5, seed=111)
    r.carve_rough(np.ones_like(r.H), amp=24, cell=62)
    X, Y = np.meshgrid(r.xs, r.ys)
    th = np.arctan2((Y - 118) / 104, (X - 210) / 198)
    rad = np.hypot((X - 210) / 198, (Y - 118) / 104)
    edge = 1 + 0.035 * np.sin(5 * th + 1) + 0.03 * np.sin(9 * th + 0.4) + 0.015 * np.sin(17 * th)
    sd = rad / edge
    r.H = (r.H * 0.8 + 34 * np.sqrt(np.clip(1 - sd**2.4, 0, 1)) - 14).astype(np.float32)
    r.alpha = np.clip((1 - sd) * 150 + 0.5, 0, 1).astype(np.float32)
    # a face dressed smooth, where the word is cut
    face = np.hypot(np.maximum(np.abs(X - 210) - 70, 0), np.maximum(np.abs(Y - 112) - 34, 0)) - 18
    m = smooth(3, -3, face)
    r.H = (r.H * (1 - m) + (20 + 0.5 * r.noise(6)) * m).astype(np.float32)
    return r


@piece("steps")
def steps():
    r = Rock(336, 120, 1.5, seed=112, tile="x")
    r.moulding(0, [(0, -26), (26, -20), (27, -8), (31, -6), (62, -2), (63, 10), (67, 12), (98, 15), (99, 27), (104, 29), (120, 30)], 0, 336)
    X, Y = np.meshgrid(r.xs, r.ys)
    for y0 in (31, 67, 104):
        a = (np.mod(X / 112.0 + 0.5 * (y0 == 67), 1.0) - 0.5) * 112
        r.H -= 1.6 * np.exp(-((a / 0.9) ** 2)) * ((Y > y0 - 4) & (Y < y0 + 32))
    r.H += 0.7 * r.noise(10) + 0.4 * r.noise(3)
    return r


if WANT or MAP:
    p = f"{OUT}/kal_map.json"
    try:
        old = json.load(open(p))
    except Exception:
        old = {}
    old.update(MAP)
    json.dump(old, open(p, "w"), indent=0)
