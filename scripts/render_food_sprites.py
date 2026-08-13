"""Render food as small 3D objects, then bake the motion into a sprite sheet.

His ask, and his objection to my first answer, both fair:

    "we want real live motion moving feel of that thing… let's say we have lemon
     means lemon photo we need to show + that lemon needs to be in movement…
     for that a real 3D kinda one only suits. If we use 2D emoji as moving thing
     it won't suit and won't be nice, even SVG hand-drawn I have no idea…
     better try than regret."

He is right that a hand-drawn SVG lemon looks like a cartoon. He is also right
that live 3D in the browser is the obvious way to get a real one — and that is
exactly the thing he told me must not slow the site down. three.js plus a glTF
per category is megabytes and a WebGL context per tile.

So: render the 3D HERE, once, and ship the RESULT.

Each object is lit and shaded properly — a Lambert term for the body, a
specular highlight, a rim light, ambient occlusion where it meets the ground —
and rotated through a full turn. The frames are packed into one strip. The
browser then animates it with `steps()` on background-position: no JavaScript,
no WebGL, no per-frame decode. It costs what an image costs and it looks like
what it is, because it IS a rendered 3D object.

    python scripts/render_food_sprites.py            # all of them
    python scripts/render_food_sprites.py lemon      # just one

Output: frontend/public/food/<name>.webp  +  a manifest the app reads.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFilter

# One frame is small on purpose: these are 40-56px on screen, so 96px covers a
# 2x display with room to spare. Frames are the whole cost, so 24 is chosen to
# be the fewest that still reads as smooth at 12fps.
SIZE = 96
FRAMES = 24
SUPER = 3  # supersample, then downscale — the only cheap way to get clean edges

OUT = os.path.join("frontend", "public", "food")


def _shade(
    px: int,
    py: int,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    base: tuple[int, int, int],
    spin: float,
    *,
    bumpiness: float = 0.0,
) -> tuple[int, int, int, int] | None:
    """Light one pixel of an ellipsoid, or None if the pixel is outside it.

    Proper shading is what makes this read as an object rather than a circle:
    a surface normal, a light above and to the left, a specular highlight that
    MOVES as the body turns, and a darker limb where the surface curves away.
    """
    nx = (px - cx) / rx
    ny = (py - cy) / ry
    d2 = nx * nx + ny * ny
    if d2 > 1.0:
        return None
    nz = math.sqrt(max(0.0, 1.0 - d2))

    # Light from up and to the left, slightly in front.
    lx, ly, lz = -0.45, -0.62, 0.64
    lam = max(0.0, nx * lx + ny * ly + nz * lz)

    # Texture that travels with the rotation, so the object clearly SPINS
    # rather than sitting still under a moving lamp.
    if bumpiness:
        u = math.atan2(nx, nz) + spin
        lam += bumpiness * 0.5 * math.sin(u * 9.0) * math.sin(ny * 6.0)
        lam = max(0.0, min(1.4, lam))

    shade = 0.30 + 0.85 * lam
    r = min(255, int(base[0] * shade))
    g = min(255, int(base[1] * shade))
    b = min(255, int(base[2] * shade))

    # Specular: a tight highlight that slides across the surface as it turns.
    hx = math.sin(spin) * 0.42 - 0.34
    hy = -0.40
    hd = (nx - hx) ** 2 + (ny - hy) ** 2
    spec = math.exp(-hd * 16.0)
    r = min(255, int(r + 205 * spec))
    g = min(255, int(g + 205 * spec))
    b = min(255, int(b + 190 * spec))

    # Rim light along the far edge — what separates the object from the card.
    rim = max(0.0, 1.0 - nz) ** 3
    r = min(255, int(r + 70 * rim))
    g = min(255, int(g + 70 * rim))
    b = min(255, int(b + 78 * rim))

    return (r, g, b, 255)


def _body(
    img: Image.Image,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    base: tuple[int, int, int],
    spin: float,
    bumpiness: float,
    profile,
) -> None:
    """Light a solid of revolution.

    The normal is taken from the PROFILE, so a bottle's shoulder catches the
    light the way a bottle's shoulder does. The same lamp, the same specular,
    the same rim as the sphere — only the outline changes.
    """
    px = img.load()
    x0, x1 = int(cx - rx) - 1, int(cx + rx) + 2
    y0, y1 = int(cy - ry) - 1, int(cy + ry) + 2
    for y in range(max(0, y0), min(img.height, y1)):
        v = (y - (cy - ry)) / (2 * ry)
        if not (0.0 <= v <= 1.0):
            continue
        half = profile(v) * rx
        if half <= 0.5:
            continue
        for x in range(max(0, x0), min(img.width, x1)):
            u = (x - cx) / half
            if abs(u) > 1.0:
                continue
            # Surface normal across the body; the vertical component comes from
            # how fast the profile is changing, which is what rounds the ends.
            nx = u
            nz = math.sqrt(max(0.0, 1.0 - u * u))
            dv = 0.004
            slope = (profile(min(1.0, v + dv)) - profile(max(0.0, v - dv))) / (2 * dv)
            ny = -slope * 0.34
            n = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            nx, ny, nz = nx / n, ny / n, nz / n

            lx, ly, lz = -0.45, -0.62, 0.64
            lam = max(0.0, nx * lx + ny * ly + nz * lz)
            if bumpiness:
                a = math.atan2(nx, nz) + spin
                lam += bumpiness * 0.30 * (
                    math.sin(a * 5.0 + v * 3.0) * math.sin(v * 7.0)
                    + 0.4 * math.sin(a * 11.0 - v * 5.0)
                )
                lam = max(0.0, min(1.4, lam))

            shade = 0.30 + 0.85 * lam
            r = min(255, int(base[0] * shade))
            g = min(255, int(base[1] * shade))
            b = min(255, int(base[2] * shade))

            hx = math.sin(spin) * 0.42 - 0.34
            spec = math.exp(-((nx - hx) ** 2 + (v - 0.32) ** 2 * 4.0) * 14.0)
            r = min(255, int(r + 205 * spec))
            g = min(255, int(g + 205 * spec))
            b = min(255, int(b + 190 * spec))

            rim = max(0.0, 1.0 - nz) ** 3
            r = min(255, int(r + 70 * rim))
            g = min(255, int(g + 70 * rim))
            b = min(255, int(b + 78 * rim))
            px[x, y] = (r, g, b, 255)


def _ground_shadow(img: Image.Image, cx: float, cy: float, rx: float, bob: float) -> None:
    """A soft contact shadow that shrinks as the object rises. Without it the
    object floats and the whole illusion goes."""
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(sh)
    k = 1.0 - bob * 0.5
    w = rx * 0.92 * k
    h = rx * 0.26 * k
    a = int(96 * k)
    d.ellipse([cx - w, cy - h, cx + w, cy + h], fill=(20, 12, 8, a))
    sh = sh.filter(ImageFilter.GaussianBlur(radius=img.width * 0.022))
    img.alpha_composite(sh)




# ── Silhouettes ──────────────────────────────────────────────────────────────
# `profile(v)` returns the body's half-width at height v, where v runs 0 (top)
# to 1 (bottom). This is what makes a bottle a bottle: the shading was never the
# problem, the OUTLINE was. A category has to be recognisable at 40px and at
# 40px you are reading the silhouette, nothing else.
import math as _m


def _sphere(v: float) -> float:
    return _m.sin(_m.pi * v) ** 0.62


def _bottle(v: float) -> float:
    # narrow neck, shoulder, straight body — milk, oil, a drink
    if v < 0.22:
        return 0.30
    if v < 0.38:
        return 0.30 + (v - 0.22) / 0.16 * 0.62
    return 0.92


def _sack(v: float) -> float:
    # gathered at the top, heavy at the base — rice, flour, pulses
    if v < 0.16:
        return 0.34 + v / 0.16 * 0.30
    return 0.64 + _m.sin((v - 0.16) / 0.84 * _m.pi * 0.55) * 0.36


def _fish(v: float) -> float:
    # a body that tapers to a tail, seen side-on
    if v < 0.14:
        return 0.10 + v / 0.14 * 0.55          # nose
    if v < 0.62:
        return 0.65 + _m.sin((v - 0.14) / 0.48 * _m.pi) * 0.35
    if v < 0.82:
        return 0.65 - (v - 0.62) / 0.20 * 0.52  # waist before the tail
    return 0.13 + (v - 0.82) / 0.18 * 0.80      # tail fans out


def _leaf(v: float) -> float:
    return _m.sin(_m.pi * v) ** 1.35


def _box(v: float) -> float:
    return 1.0 if 0.06 < v < 0.94 else 0.86


def _drum(v: float) -> float:
    # a tub or a tin — cheese, butter, cleaning
    return 0.95 if 0.10 < v < 0.90 else 0.80


PROFILES = {
    "sphere": _sphere,
    "bottle": _bottle,
    "sack": _sack,
    "fish": _fish,
    "leaf": _leaf,
    "box": _box,
    "drum": _drum,
}



# ── Flat things ──────────────────────────────────────────────────────────────
# Outlines, as points on a unit square (0..1 across, 0..1 down). Anything can be
# drawn this way; the renderer works out the shading from the shape itself.
OUTLINES: dict[str, list[tuple[float, float]]] = {
    # nose, back, dorsal fin, tail, belly — read left to right
    "fish": [
        (0.03, 0.50), (0.18, 0.34), (0.38, 0.27), (0.50, 0.16), (0.56, 0.28),
        (0.72, 0.31), (0.84, 0.40), (0.84, 0.60), (0.72, 0.69), (0.56, 0.72),
        (0.50, 0.84), (0.38, 0.73), (0.18, 0.66),
    ],
    # a leaf with a point and a shoulder
    "leaf": [
        (0.50, 0.04), (0.66, 0.20), (0.78, 0.42), (0.74, 0.68), (0.56, 0.90),
        (0.50, 0.96), (0.44, 0.90), (0.26, 0.68), (0.22, 0.42), (0.34, 0.20),
    ],
    # a chilli: fat shoulder tapering to a tip, with a stalk
    "chilli": [
        (0.44, 0.06), (0.60, 0.14), (0.70, 0.32), (0.72, 0.56), (0.62, 0.80),
        (0.48, 0.94), (0.40, 0.80), (0.38, 0.56), (0.34, 0.34), (0.34, 0.14),
    ],
}


def _flat_body(
    img: Image.Image,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    base: tuple[int, int, int],
    spin: float,
    outline: list[tuple[float, float]],
) -> None:
    """Light a flat object with a slight dome.

    Height comes from DISTANCE TO THE EDGE — the middle of the shape stands
    proudest, the rim falls away — and the normal is the gradient of that
    height. It is the cheapest way to light an arbitrary silhouette and it is
    what makes a fish read as a fish rather than as a coloured shape.
    """
    w = int(rx * 2)
    h = int(ry * 2)
    if w < 4 or h < 4:
        return

    # The silhouette, and a blurred copy of it as the height field.
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).polygon(
        [(px * w, py * h) for px, py in outline], fill=255
    )
    height = mask.filter(ImageFilter.GaussianBlur(radius=max(2.0, w * 0.055)))

    m = mask.load()
    hh = height.load()
    px_out = img.load()
    ox = int(cx - rx)
    oy = int(cy - ry)

    # A yaw rather than a tumble: the light sweeps across the body as it turns
    # toward and away from you, which is what a swimming thing looks like.
    yaw = math.sin(spin)

    for y in range(h):
        for x in range(w):
            if m[x, y] < 40:
                continue
            # gradient of the height field = surface normal
            hx = (hh[min(w - 1, x + 1), y] - hh[max(0, x - 1), y]) / 255.0
            hy = (hh[x, min(h - 1, y + 1)] - hh[x, max(0, y - 1)]) / 255.0
            nx = -hx * 26.0
            ny = -hy * 26.0
            nz = 1.0
            n = math.sqrt(nx * nx + ny * ny + nz * nz)
            nx, ny, nz = nx / n, ny / n, nz / n

            lx, ly, lz = -0.42 + yaw * 0.45, -0.58, 0.70
            lam = max(0.0, nx * lx + ny * ly + nz * lz)
            dome = hh[x, y] / 255.0

            shade = 0.30 + min(0.92, 0.86 * lam) + 0.26 * dome
            r = min(255, int(base[0] * shade))
            g = min(255, int(base[1] * shade))
            b = min(255, int(base[2] * shade))

            spec = min(1.0, max(0.0, lam)) ** 16
            r = min(255, int(r + 120 * spec))
            g = min(255, int(g + 120 * spec))
            b = min(255, int(b + 114 * spec))

            # A soft edge, so it does not look cut out with scissors.
            a = 255 if m[x, y] > 200 else int(m[x, y] * 1.2)
            if 0 <= ox + x < img.width and 0 <= oy + y < img.height:
                px_out[ox + x, oy + y] = (r, g, b, min(255, a))


# ── the objects ──────────────────────────────────────────────────────────────
# Each is a body colour and a shape. Deliberately simple: at 48px what sells
# the illusion is the SHADING and the motion, not the modelling.
FOODS: dict[str, dict] = {
    # colour, how tall relative to its width, how textured, and — the part that
    # actually makes it recognisable at 40px — its SILHOUETTE.
    "lemon":     {"color": (247, 205, 42),  "ry": 0.80, "bump": 0.25, "shape": "sphere", "stalk": "leaf"},
    "tomato":    {"color": (222, 58, 44),   "ry": 0.92, "bump": 0.10, "shape": "sphere", "stalk": "leaf"},
    "onion":     {"color": (206, 142, 84),  "ry": 0.94, "bump": 0.20, "shape": "sphere", "stalk": "tuft"},
    "potato":    {"color": (186, 146, 96),  "ry": 0.74, "bump": 0.24, "shape": "sphere"},
    "apple":     {"color": (206, 44, 52),   "ry": 0.95, "bump": 0.12, "shape": "sphere", "stalk": "stem"},
    "orange":    {"color": (238, 138, 30),  "ry": 0.95, "bump": 0.22, "shape": "sphere"},
    "egg":       {"color": (240, 226, 202), "ry": 1.18, "bump": 0.05, "shape": "sphere"},
    "milk":      {"color": (238, 240, 244), "ry": 1.25, "bump": 0.04, "shape": "bottle"},
    "rice":      {"color": (232, 220, 190), "ry": 1.05, "bump": 0.26, "shape": "sack"},
    "flour":     {"color": (236, 228, 210), "ry": 1.05, "bump": 0.20, "shape": "sack"},
    "oil":       {"color": (214, 176, 44),  "ry": 1.25, "bump": 0.06, "shape": "bottle"},
    "fish":      {"color": (132, 176, 202), "ry": 0.62, "bump": 0.00, "shape": "fish"},
    "meat":      {"color": (176, 66, 66),   "ry": 0.70, "bump": 0.28, "shape": "drum"},
    "chicken":   {"color": (214, 168, 112), "ry": 0.86, "bump": 0.22, "shape": "sphere"},
    "cheese":    {"color": (240, 200, 92),  "ry": 0.72, "bump": 0.18, "shape": "drum"},
    "spice":     {"color": (198, 62, 40),   "ry": 1.15, "bump": 0.00, "shape": "chilli"},
    "pulse":     {"color": (176, 142, 76),  "ry": 1.00, "bump": 0.28, "shape": "sack"},
    "greens":    {"color": (92, 166, 78),   "ry": 1.15, "bump": 0.00, "shape": "leaf"},
    "cleaning":  {"color": (96, 168, 208),  "ry": 1.22, "bump": 0.14, "shape": "bottle"},
    "packaging": {"color": (176, 140, 96),  "ry": 0.88, "bump": 0.10, "shape": "box"},
    "drink":     {"color": (148, 96, 196),  "ry": 1.25, "bump": 0.08, "shape": "bottle"},
    "frozen":    {"color": (146, 206, 224), "ry": 0.90, "bump": 0.20, "shape": "box"},
    "basket":    {"color": (192, 148, 92),  "ry": 0.78, "bump": 0.26, "shape": "drum"},
}


def render(name: str, spec: dict) -> str:
    s = SIZE * SUPER
    frames: list[Image.Image] = []

    for i in range(FRAMES):
        t = i / FRAMES
        spin = t * math.tau
        # A gentle bob and tilt. Rotation alone on a near-symmetric body is
        # nearly invisible; the bob is what says "this is alive".
        bob = (math.sin(spin) + 1) / 2
        cx = s / 2
        cy = s * 0.55 - bob * s * 0.045
        rx = s * 0.33
        ry = rx * spec["ry"]

        img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
        _ground_shadow(img, cx, s * 0.86, rx, bob)
        shape = spec.get("shape", "sphere")
        if shape in OUTLINES:
            _flat_body(img, cx, cy, rx, ry, spec["color"], spin, OUTLINES[shape])
        else:
            _body(
                img, cx, cy, rx, ry, spec["color"], spin,
                spec.get("bump", 0.0), PROFILES[shape],
            )

        # A stalk or leaf, drawn AFTER the body so it sits in front, and swung
        # with the spin so it belongs to the object rather than to the frame.
        d = ImageDraw.Draw(img)
        kind = spec.get("stalk")
        if kind in ("leaf", "stem", "tuft"):
            sw = math.sin(spin) * s * 0.03
            top = cy - ry
            d.line([(cx + sw * 0.4, top + s * 0.02), (cx + sw, top - s * 0.07)],
                   fill=(92, 128, 60, 255), width=max(2, int(s * 0.018)))
            if kind == "leaf":
                lx = cx + sw
                ly = top - s * 0.07
                d.ellipse([lx - s * 0.055, ly - s * 0.030, lx + s * 0.055, ly + s * 0.030],
                          fill=(104, 158, 72, 255))

        frames.append(img.resize((SIZE, SIZE), Image.LANCZOS))

    # One horizontal strip — the browser walks it with steps().
    sheet = Image.new("RGBA", (SIZE * FRAMES, SIZE), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * SIZE, 0))

    os.makedirs(OUT, exist_ok=True)
    png = os.path.join(tempfile.gettempdir(), f"{name}.png")
    sheet.save(png)

    webp = os.path.join(OUT, f"{name}.webp")
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", png,
         "-vcodec", "libwebp", "-lossless", "0", "-compression_level", "6",
         "-q:v", "72", "-preset", "picture", webp],
        check=True,
    )
    os.remove(png)
    return webp


def main() -> None:
    wanted = sys.argv[1:] or list(FOODS)
    total = 0
    made = []
    for name in wanted:
        spec = FOODS.get(name)
        if not spec:
            print(f"  ?? no recipe for {name}")
            continue
        path = render(name, spec)
        size = os.path.getsize(path)
        total += size
        made.append(name)
        print(f"  {name:12} {size / 1024:6.1f} KB")

    manifest = os.path.join(OUT, "manifest.json")
    with open(manifest, "w", encoding="utf-8") as f:
        json.dump({"size": SIZE, "frames": FRAMES, "foods": sorted(made)}, f, indent=1)
    print(f"\n{len(made)} objects, {total / 1024:.0f} KB total, {FRAMES} frames each")


if __name__ == "__main__":
    main()
