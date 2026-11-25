"""The sculptor's library for KAL, the temple design of the main page (docs/TEMPLE_DESIGN.md): stone as
heights. All of it is worked out, in floating point, in CSS pixels: x to the right, y DOWN, depth towards
you. A piece is handed on as what light needs: its slopes (an 8-bit height has steps a raking light
shows), how open each place is and how worn its edges, its height, and what it is made of."""
import math

import cv2
import numpy as np

SLOPE = 4.0  # the steepest that is told (px to a px)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def dome(q):
    """A half-round: q is 1 at its middle, 0 at its edge."""
    return np.sqrt(np.clip(q, 0, 1))


class Rock:
    """A piece of stone w by h CSS px, k of its own pixels to each."""

    def __init__(self, w, h, k, seed=400, tile="", nine=None):
        self.w, self.h, self.k = w, h, k
        self.tile, self.nine = tile, nine  # it repeats (that way); or is a frame, with corners so large
        self.W, self.Ht = int(round(w * k)), int(round(h * k))
        self.H = np.zeros((self.Ht, self.W), np.float32)
        self.gold = np.zeros_like(self.H)
        self.polish = np.zeros_like(self.H)  # polished black granite
        self.alpha = np.ones_like(self.H)  # 0: not there (sky, a hole)
        self.paint = np.zeros_like(self.H)  # old paint in its hollows: 0, or a colour's number / 8
        self.xs = (np.arange(self.W, dtype=np.float32) + 0.5) / k
        self.ys = (np.arange(self.Ht, dtype=np.float32) + 0.5) / k
        self.rng = np.random.default_rng(seed)

    def win(self, x0, x1, y0, y1):
        i0, i1 = max(0, int(x0 * self.k)), min(self.W, int(math.ceil(x1 * self.k)) + 1)
        j0, j1 = max(0, int(y0 * self.k)), min(self.Ht, int(math.ceil(y1 * self.k)) + 1)
        sl = (slice(j0, j1), slice(i0, i1))
        x, y = np.meshgrid(self.xs[i0:i1], self.ys[j0:j1])
        return sl, x, y

    def put(self, sl, z, gap=0.0):
        """Laid over what is there (the higher wins); `gap`: a groove round it."""
        cur = self.H[sl]
        if gap:
            m = (z > 0.02).astype(np.uint8)
            if m.any() and not m.all():
                d = cv2.distanceTransform(1 - m, cv2.DIST_L2, 5) / self.k
                cur = cur - gap * np.exp(-((d / 1.6) ** 2)) * (1 - m)
        self.H[sl] = np.maximum(cur, z.astype(np.float32))

    def add(self, sl, z):
        self.H[sl] += z.astype(np.float32)

    def over(self, sl, z, mask):
        """In place of what is there, where the mask is (0–1)."""
        self.H[sl] = self.H[sl] * (1 - mask) + z * mask

    # ── mouldings ──
    def moulding(self, y0, pts, x0=0.0, x1=None):
        """Right across: depth at each height below y0 (pts: [(dy, depth)])."""
        x1 = self.w if x1 is None else x1
        dy = np.array([p[0] for p in pts], np.float32)
        dd = np.array([p[1] for p in pts], np.float32)
        sl, x, y = self.win(x0, x1, y0, y0 + float(dy.max()))
        self.H[sl] = np.interp(y - y0, dy, dd).astype(np.float32)

    def beads(self, y, rad, step, h, x0, x1, base=0.0):
        sl, x, yy = self.win(x0, x1, y - rad * 1.2, y + rad * 1.2)
        n = max(1, round((x1 - x0) / step))
        st = (x1 - x0) / n
        a = (np.mod((x - x0) / st, 1.0) - 0.5) * st
        q = 1 - (a**2 + (yy - y) ** 2) / rad**2
        z = np.where(q > 0, base + h * dome(q), -99)
        self.H[sl] = np.maximum(self.H[sl], z)

    def petals(self, y0, y1, step, h, x0, x1, down=True, vein=0.3):
        """A band of lotus petals, their tips down (or up)."""
        sl, x, y = self.win(x0, x1, min(y0, y1), max(y0, y1))
        n = max(1, round((x1 - x0) / step))
        st = (x1 - x0) / n
        b = (y - y0) / (y1 - y0)
        b = b if down else 1 - b
        for row, (ph, hh, lim) in enumerate(((0.5, 0.72, 1.0), (0.0, 1.0, 0.92))):
            a = (np.mod((x - x0) / st + ph, 1.0) - 0.5) * 2
            bb = np.clip(b / lim, 0, 1)
            w = np.where(bb < 0.55, 0.8 + 0.17 * np.sin(np.pi * 0.5 * bb / 0.55), 0.97 * np.sqrt(np.clip(1 - ((bb - 0.55) / 0.45) ** 2, 0, 1)) ** 0.8)
            q = np.where(b < lim, 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
            z = hh * h * dome(q) * (0.5 + 0.5 * bb) - vein * h * np.exp(-((a / 0.1) ** 2)) * (q > 0) * 0.5
            z += 0.14 * h * np.exp(-(((np.abs(a) / np.maximum(w, 1e-3) - 0.82) / 0.09) ** 2)) * (q > 0)
            self.add(sl, np.where(q > 0, z, 0))

    def rope(self, pts_y, r, x0, x1, pitch=9.0, h=None):
        h = r if h is None else h
        sl, x, y = self.win(x0, x1, pts_y - r * 1.1, pts_y + r * 1.1)
        q = 1 - ((y - pts_y) / r) ** 2
        tw = 0.5 + 0.5 * np.cos((x / pitch + (y - pts_y) / (2.2 * r)) * 2 * np.pi)
        self.H[sl] = np.maximum(self.H[sl], np.where(q > 0, h * dome(q) * (0.72 + 0.28 * tw), -99))

    def creeper(self, x0, x1, yc, half, step, depth, base=0.0):
        sl, x, y = self.win(x0, x1, yc - half * 1.15, yc + half * 1.15)
        ph = x * np.pi / step
        amp = half * 0.58
        stem = yc + amp * np.sin(ph)
        tilt = np.cos(ph) * amp * np.pi / step
        d = (y - stem) / np.sqrt(1 + tilt**2)
        z = depth * 0.8 * dome(1 - (d / (half * 0.13)) ** 2)
        i0, i1 = int(math.floor(x0 / step)) - 1, int(math.ceil(x1 / step)) + 1
        for i in range(i0, i1):
            cx = (i + 0.5) * step
            side = 1 if i % 2 == 0 else -1
            cy = yc - side * amp * 0.28
            dx, dy = x - cx, y - cy
            r = np.hypot(dx, dy)
            th = np.arctan2(dy, dx) * side
            R = half * 0.6
            spi = np.abs(np.mod(r / (R * 0.46) - th / (2 * np.pi), 1.0) - 0.5) * 2
            z = np.maximum(z, np.where(r < R, depth * 0.75 * np.clip(1 - spi * 1.15, 0, 1) ** 0.55 * smooth(R, R * 0.8, r), 0))
            z = np.maximum(z, depth * 1.05 * dome(1 - (r / (half * 0.2)) ** 2))
            # a leaf outside the bend
            ly = cy + side * -half * 0.72
            for sgn in (-1, 1):
                ux, uy = (x - cx) * 0.83 * sgn + (y - ly) * 0.55, -(x - cx) * 0.55 * sgn + (y - ly) * 0.83
                lq = 1 - (uy / (half * 0.17 * np.sin(np.pi * np.clip(ux / (half * 0.62), 0.02, 1)) + 1e-3)) ** 2
                z = np.maximum(z, np.where((ux > 0) & (ux < half * 0.62), depth * 0.7 * dome(lq), 0))
        fade = smooth(x0, x0 + half * 0.5, x) * smooth(x1, x1 - half * 0.5, x)
        self.H[sl] = np.maximum(self.H[sl], base + z * fade - (z <= 0.01) * 99 * 0 - np.where(z <= 0.01, 99, 0))

    # ── the horseshoe window ──
    def kudu(self, cx, cy, r, depth, base=0.0, lotus=True):
        """A little one: its arch, its crest, a lotus (or a hollow) in it."""
        sl, x, y = self.win(cx - r * 1.7, cx + r * 1.7, cy - r * 2.2, cy + r * 1.2)
        dx, dy = (x - cx) / r, (cy - y) / r
        rr = np.hypot(dx, dy)
        th = np.arctan2(dy, dx)
        arch = np.exp(-(((rr - 0.98) / 0.2) ** 4)) * smooth(-0.82, -0.66, dy)
        flare = np.exp(-(((np.abs(dx) - 1.12 - 0.12 * (dy + 0.7)) / 0.2) ** 4)) * smooth(-0.95, -0.85, dy) * smooth(-0.45, -0.62, dy)
        cusp = 0.5 + 0.5 * np.cos(th * 26)
        flame = np.exp(-(((rr - 1.24) / 0.1) ** 2)) * (0.35 + 0.65 * cusp) * smooth(-0.35, -0.1, dy)
        crest = dome(1 - (dx / np.maximum(0.26 * np.sin(np.pi * np.clip((dy - 1.12) / 0.72, 0, 1) ** 0.65), 1e-3)) ** 2) * ((dy > 1.13) & (dy < 1.84))
        inb = np.mod(th * 24 / (2 * np.pi), 1.0) - 0.5
        bead = dome(1 - ((inb * 2 * np.pi / 24 * 0.76) ** 2 + (rr - 0.76) ** 2) / 0.06**2) * (dy > -0.7)
        z = np.maximum.reduce([arch, flare, 0.75 * flame, 1.1 * crest]) * depth
        z = np.maximum(z, depth * 0.8 * bead)
        hollow = (rr < 0.68) & (dy > -0.72)
        self.H[sl] = np.where(hollow, np.minimum(self.H[sl], base - depth * 0.55), self.H[sl])
        if lotus:
            pet = np.abs(np.mod(th * 8 / (2 * np.pi), 1.0) - 0.5) * 2
            lo = np.maximum(dome(1 - (rr / (0.3 + 0.26 * (1 - pet) ** 0.6)) ** 2) * (rr > 0.2) * 0.75, dome(1 - (rr / 0.2) ** 2))
            z = np.where(hollow, depth * 0.75 * lo - depth * 0.5, z)
            self.H[sl] = np.where(hollow, np.maximum(self.H[sl], base + z), self.H[sl])
            z = np.where(hollow, 0, z)
        self.H[sl] = np.where(z > 0.05, np.maximum(self.H[sl], base + z), self.H[sl])

    def finial(self, cx, yb, h, r, gold=True):
        """A pot, rings, a lotus, a bud: turned, half round, against the sky (it makes its own alpha)."""
        prof = np.array([(0, 0.62), (0.04, 0.66), (0.06, 0.5), (0.09, 0.46), (0.11, 0.62), (0.15, 0.86), (0.22, 1.0), (0.31, 0.98), (0.38, 0.78), (0.42, 0.5), (0.44, 0.42), (0.46, 0.5), (0.48, 0.56), (0.5, 0.5), (0.52, 0.34), (0.56, 0.36), (0.6, 0.52), (0.63, 0.56), (0.655, 0.44), (0.67, 0.26), (0.7, 0.26), (0.73, 0.34), (0.78, 0.36), (0.86, 0.24), (0.94, 0.1), (1.0, 0.0)], np.float32)
        sl, x, y = self.win(cx - r * 1.2, cx + r * 1.2, yb - h, yb)
        s = (yb - y) / h
        rad = np.interp(s, prof[:, 0], prof[:, 1]) * r
        dx = x - cx
        q = 1 - (dx / np.maximum(rad, 1e-3)) ** 2
        th = np.arcsin(np.clip(dx / np.maximum(rad, 1e-3), -1, 1))
        z = rad * dome(q) * 0.9
        z += smooth(0.1, 0.16, s) * smooth(0.42, 0.36, s) * 0.05 * r * np.cos(th * 14) * dome(q)
        on = (q > 0) & (rad > 0.2)
        a = np.clip((rad - np.abs(dx)) * self.k + 0.5, 0, 1) * (s >= 0)
        self.H[sl] = np.where(on, np.maximum(self.H[sl], z), self.H[sl])
        self.alpha[sl] = np.maximum(self.alpha[sl], a)
        if gold:
            self.gold[sl] = np.maximum(self.gold[sl], a)

    def frame(self, x0, x1, y0, y1, border=26, kind="rope", depth=12, polish=True):
        """A slab of polished black granite in a frame of its own kind."""
        sl, x, y = self.win(x0 - 6, x1 + 6, y0 - 6, y1 + 6)
        ax = np.abs(x - (x0 + x1) / 2) - (x1 - x0) / 2
        ay = np.abs(y - (y0 + y1) / 2) - (y1 - y0) / 2
        sd = np.maximum(ax, ay)
        per = np.where(ax > ay, y, x)
        inside = -sd
        z = depth * smooth(0, 2.5, inside) * smooth(border + 1.5, border - 2, inside)
        z += 0.25 * depth * np.exp(-(((inside - 4) / 2.2) ** 4))
        if kind == "rope":
            q = 1 - ((inside - border * 0.56) / (border * 0.24)) ** 2
            tw = 0.5 + 0.5 * np.cos((per / 10 + (inside - border * 0.56) / (border * 0.5)) * 2 * np.pi)
            z = np.where(q > 0, depth * 0.55 + depth * 0.75 * dome(q) * (0.66 + 0.34 * tw), z)
        elif kind == "bead":
            st = 11.0
            a = (np.mod(per / st, 1.0) - 0.5) * st
            q = 1 - (a**2 + (inside - border * 0.56) ** 2) / (st * 0.42) ** 2
            z = np.where(q > 0, depth * 0.6 + depth * 0.6 * dome(q), z)
        elif kind == "petal":
            st = 17.0
            a = (np.mod(per / st, 1.0) - 0.5) * 2
            b = np.clip((border - 3 - inside) / (border * 0.66), 0, 1)
            w = np.sqrt(np.clip(1 - b**2.4, 0, 1)) * 0.95
            q = np.where(b < 1, 1 - (a / np.maximum(w, 1e-3)) ** 2, -1)
            z = np.where((q > 0) & (inside > border * 0.3) & (inside < border - 2), depth * 0.55 + depth * 0.6 * dome(q), z)
        z = np.where(inside > border, 0, z)
        for cx in (x0, x1):
            for cy in (y0, y1):
                px, py = cx + (border * 0.5 if cx == x0 else -border * 0.5), cy + (border * 0.5 if cy == y0 else -border * 0.5)
                rr = np.hypot(x - px, y - py) / (border * 0.62)
                tt = np.arctan2(y - py, x - px)
                pet = np.abs(np.mod(tt * 8 / (2 * np.pi), 1.0) - 0.5) * 2
                box = np.maximum(np.abs(x - px), np.abs(y - py)) < border * 0.5
                lo = np.maximum(dome(1 - (rr / (0.42 + 0.36 * (1 - pet) ** 0.6)) ** 2) * (rr > 0.24), 1.1 * dome(1 - (rr / 0.24) ** 2))
                z = np.where(box, depth * 0.55 + depth * 0.75 * lo, z)
        on = inside > 0
        self.H[sl] = np.where(on, np.where(inside > border, 0.0, z), self.H[sl] - 1.6 * np.exp(-((np.clip(sd, 0, 99) / 2.4) ** 2)))
        if polish:
            self.polish[sl] = np.where(on, smooth(border - 0.5, border + 0.8, inside), self.polish[sl])

    def carve_rough(self, mask, amp=14.0, cell=46.0):
        """Raw rock: facets as a mason leaves them, rows of chisel marks in swung arcs."""
        rng = self.rng
        n = int(self.w * self.h / (cell * cell)) + 8
        tx, ty = "x" in self.tile, "y" in self.tile
        px = (rng.uniform(0, self.w, n) if tx else rng.uniform(-cell, self.w + cell, n)).astype(np.float32)
        py = (rng.uniform(0, self.h, n) if ty else rng.uniform(-cell, self.h + cell, n)).astype(np.float32)
        tiltx, tilty = rng.normal(0, 0.28, n), rng.normal(0, 0.28, n)
        off = rng.uniform(-1, 1, n)
        if tx or ty:
            sx = (-self.w, 0, self.w) if tx else (0,)
            sy = (-self.h, 0, self.h) if ty else (0,)
            px, py, tiltx, tilty, off = (np.concatenate(v) for v in zip(*[(px + a, py + b, tiltx, tilty, off) for a in sx for b in sy]))
            keep = (px > -3 * cell) & (px < self.w + 3 * cell) & (py > -3 * cell) & (py < self.h + 3 * cell)
            px, py, tiltx, tilty, off = (v[keep] for v in (px, py, tiltx, tilty, off))
            n = len(px)
        small = 3
        gx, gy = self.W // small + 1, self.Ht // small + 1
        yy, xx = np.mgrid[0:gy, 0:gx].astype(np.float32) * (small / self.k)
        best = np.full((gy, gx), 1e9, np.float32)
        second = best.copy()
        idx = np.zeros((gy, gx), np.int32)
        for i in range(n):
            d = np.hypot(xx - px[i], yy - py[i])
            c = d < best
            second = np.where(c, best, np.minimum(second, d))
            idx = np.where(c, i, idx)
            best = np.where(c, d, best)
        z = amp * (0.35 * off[idx] + tiltx[idx] * (xx - px[idx]) / cell + tilty[idx] * (yy - py[idx]) / cell)
        z = z - 0.2 * amp * np.exp(-(((second - best) / 5.0) ** 2))
        z = cv2.GaussianBlur(z.astype(np.float32), (0, 0), 1.2)
        z = cv2.resize(z, (self.W, self.Ht), interpolation=cv2.INTER_CUBIC)
        X, Y = np.meshgrid(self.xs, self.ys)
        ang = 0.6 + 0.35 * np.sin(X / 190.0 + Y / 260.0)
        u = X * np.cos(ang) + Y * np.sin(ang)
        v = -X * np.sin(ang) + Y * np.cos(ang) + 8 * np.sin(u / 60)
        if tx or ty:
            f = np.round(-0.56 * self.w / 8.5) * X / self.w + np.round(0.83 * self.h / 8.5) * Y / self.h
            marks = np.abs(np.mod(f + 0.8 * np.sin(2 * np.pi * (X / self.w + 2 * Y / self.h)), 1.0) - 0.5) * 2
        else:
            marks = np.abs(np.mod(v / 8.5, 1.0) - 0.5) * 2
        broken = 0.5 + 0.3 * self.noise(44)
        z = z - 1.5 * np.clip(1 - marks * 2.2, 0, 1) * smooth(0.35, 0.6, broken)
        z = z + 1.1 * self.noise(7) + 0.7 * self.noise(2.5)
        self.H = self.H * (1 - mask) + (self.H * 0.0 + z) * mask

    def noise(self, size):
        """Bumps of that size; they go round where the piece repeats."""
        tx, ty = "x" in self.tile, "y" in self.tile
        nx = max(2, int(round(self.w / size))) if tx else int(self.w / size) + 3
        ny = max(2, int(round(self.h / size))) if ty else int(self.h / size) + 3
        g = self.rng.normal(0, 1, (ny, nx)).astype(np.float32)
        if not (tx or ty):
            return cv2.resize(g, (self.W, self.Ht), interpolation=cv2.INTER_CUBIC)
        g = np.tile(g, (3 if ty else 1, 3 if tx else 1))
        z = cv2.resize(g, (self.W * (3 if tx else 1), self.Ht * (3 if ty else 1)), interpolation=cv2.INTER_CUBIC)
        return z[self.Ht if ty else 0 : 2 * self.Ht if ty else None, self.W if tx else 0 : 2 * self.W if tx else None]

    # ── handing on ──
    def openness(self):
        o = np.ones_like(self.H)
        for sg, s in ((1.4, 0.26), (4, 0.15), (11, 0.075), (26, 0.036)):
            o *= 1 - np.clip((cv2.GaussianBlur(self.H, (0, 0), sg * self.k) - self.H) * s, 0, 0.72)
        return o

    def worn(self):
        a = np.clip((self.H - cv2.GaussianBlur(self.H, (0, 0), 2.0 * self.k)) * 0.34, -1, 1)
        b = np.clip((self.H - cv2.GaussianBlur(self.H, (0, 0), 0.8 * self.k)) * 0.8, -1, 1)
        return a * 0.6 + b * 0.4

    def write(self, out, name, q=74):
        """name_x, name_y: slopes; name_c: openness over worn (half); name_h: height (half), name_m: gold,
        polish, alpha (half … full for alpha)."""
        info = {"w": self.w, "h": self.h, "k": self.k}
        if self.nine:
            info["nine"] = self.nine
        crop = None
        if self.tile:
            # (What lies past its edges is itself.)
            info["tile"] = self.tile
            P = int(40 * self.k) // 2 * 2
            px, py = (P if "x" in self.tile else 0), (P if "y" in self.tile else 0)
            crop = (px, py, self.W, self.Ht)
            for f in ("H", "gold", "polish", "alpha"):
                setattr(self, f, np.pad(getattr(self, f), ((py, py), (px, px)), mode="wrap"))
            self.W, self.Ht = self.W + 2 * px, self.Ht + 2 * py

        def cut(a, d=1):
            if not crop:
                return a
            x, y, w, h = (c // d for c in crop)
            return a[y : y + h, x : x + w]

        def webp(n, img, qq):
            cv2.imwrite(f"{out}/{n}.webp", np.round(np.clip(img, 0, 1) * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, qq])

        gx = np.zeros_like(self.H)
        gy = np.zeros_like(self.H)
        gx[:, 1:-1] = (self.H[:, 2:] - self.H[:, :-2]) * self.k / 2
        gy[1:-1, :] = (self.H[2:, :] - self.H[:-2, :]) * self.k / 2

        def told(g):
            g = np.clip(g / SLOPE, -1, 1)
            return np.sign(g) * np.sqrt(np.abs(g)) * 0.5 + 0.5

        half = (self.W // 2, self.Ht // 2)

        def to(a):
            return cv2.resize(a, half, interpolation=cv2.INTER_AREA)

        webp(f"{name}_x", cut(told(gx)), q)
        webp(f"{name}_y", cut(told(gy)), q)
        webp(f"{name}_c", np.vstack([cut(to(self.openness()), 2), cut(to(self.worn()) * 0.5 + 0.5, 2)]), 72)
        lo, hi = float(self.H.min()), float(self.H.max())
        webp(f"{name}_h", (cut(to(cv2.GaussianBlur(self.H, (0, 0), 0.7)), 2) - lo) / max(1e-3, hi - lo), 84)
        m = np.dstack([cut(self.alpha), cut(self.polish), cut(self.gold)])  # (B, G, R as OpenCV writes it: R gold, G polish, B alpha)
        cv2.imwrite(f"{out}/{name}_m.webp", np.round(np.clip(m, 0, 1) * 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 80])
        if crop:
            for f in ("H", "gold", "polish", "alpha"):
                setattr(self, f, cut(getattr(self, f)).copy())
            self.W, self.Ht = crop[2], crop[3]
        return {**info, "lo": round(lo, 3), "hi": round(hi, 3)}

    def lit(self, lx, ly, lz, warm=(1.0, 0.62, 0.3), amb=0.05, power=1.0):
        """A quick look, lit from a point (px) as the site will light it."""
        gx = np.gradient(self.H, axis=1) * self.k
        gy = np.gradient(self.H, axis=0) * self.k
        n = np.dstack([-gx, -gy, np.ones_like(gx)])
        n /= np.linalg.norm(n, axis=2, keepdims=True)
        X, Y = np.meshgrid(self.xs, self.ys)
        L = np.dstack([lx - X, ly - Y, lz - self.H])
        d = np.linalg.norm(L, axis=2, keepdims=True)
        L /= d
        lam = np.clip((n * L).sum(2), 0, 1) * power * 150**2 / (d[:, :, 0] ** 2 + 60**2)
        moon = np.clip((n * np.array([0.45, -0.65, 0.62])).sum(2), 0, 1) * 0.16
        o = self.openness()
        alb = np.array([0.36, 0.29, 0.22])
        pol = self.polish[..., None]
        base = alb * (1 - pol) + np.array([0.016, 0.014, 0.013]) * pol
        g = self.gold[..., None]
        base = base * (1 - g) + np.array([0.75, 0.47, 0.13]) * g
        col = base * (lam[..., None] * np.array(warm) + moon[..., None] * np.array([0.62, 0.74, 0.95]) + amb * np.array([0.9, 0.95, 1.3])) * o[..., None]
        col = col * (1 + 0.6 * np.clip(self.worn(), 0, 1)[..., None])
        sky = np.array([0.02, 0.025, 0.06])
        a = self.alpha[..., None]
        col = col * a + sky * (1 - a)
        col = col * 2.2
        col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14)
        return (np.clip(col, 0, 1) ** (1 / 2.2) * 255).astype(np.uint8)
