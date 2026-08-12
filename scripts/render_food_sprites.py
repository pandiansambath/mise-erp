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


def _ellipsoid(
    img: Image.Image,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    base: tuple[int, int, int],
    spin: float,
    bumpiness: float = 0.0,
) -> None:
    px = img.load()
    x0, x1 = int(cx - rx) - 1, int(cx + rx) + 2
    y0, y1 = int(cy - ry) - 1, int(cy + ry) + 2
    for y in range(max(0, y0), min(img.height, y1)):
        for x in range(max(0, x0), min(img.width, x1)):
            c = _shade(x, y, cx, cy, rx, ry, base, spin, bumpiness=bumpiness)
            if c:
                px[x, y] = c


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


# ── the objects ──────────────────────────────────────────────────────────────
# Each is a body colour and a shape. Deliberately simple: at 48px what sells
# the illusion is the SHADING and the motion, not the modelling.
FOODS: dict[str, dict] = {
    "lemon":     {"color": (247, 205, 42),  "ry": 0.80, "bump": 0.25, "stalk": "leaf"},
    "tomato":    {"color": (222, 58, 44),   "ry": 0.92, "bump": 0.10, "stalk": "leaf"},
    "onion":     {"color": (206, 142, 84),  "ry": 0.94, "bump": 0.30, "stalk": "tuft"},
    "potato":    {"color": (186, 146, 96),  "ry": 0.74, "bump": 0.42},
    "apple":     {"color": (206, 44, 52),   "ry": 0.95, "bump": 0.12, "stalk": "stem"},
    "orange":    {"color": (238, 138, 30),  "ry": 0.95, "bump": 0.38},
    "egg":       {"color": (240, 226, 202), "ry": 1.18, "bump": 0.05},
    "milk":      {"color": (238, 240, 244), "ry": 1.05, "bump": 0.04},
    "rice":      {"color": (232, 220, 190), "ry": 0.70, "bump": 0.55},
    "flour":     {"color": (236, 228, 210), "ry": 0.72, "bump": 0.45},
    "oil":       {"color": (214, 176, 44),  "ry": 1.12, "bump": 0.06},
    "fish":      {"color": (126, 170, 196), "ry": 0.58, "bump": 0.30},
    "meat":      {"color": (176, 66, 66),   "ry": 0.66, "bump": 0.28},
    "chicken":   {"color": (214, 168, 112), "ry": 0.72, "bump": 0.22},
    "cheese":    {"color": (240, 200, 92),  "ry": 0.72, "bump": 0.18},
    "spice":     {"color": (188, 78, 36),   "ry": 0.64, "bump": 0.50},
    "pulse":     {"color": (176, 142, 76),  "ry": 0.66, "bump": 0.52},
    "greens":    {"color": (86, 158, 74),   "ry": 0.86, "bump": 0.34},
    "cleaning":  {"color": (96, 168, 208),  "ry": 0.80, "bump": 0.14},
    "packaging": {"color": (176, 140, 96),  "ry": 0.78, "bump": 0.10},
    "drink":     {"color": (148, 96, 196),  "ry": 1.10, "bump": 0.08},
    "frozen":    {"color": (146, 206, 224), "ry": 0.86, "bump": 0.20},
    "basket":    {"color": (192, 148, 92),  "ry": 0.74, "bump": 0.26},
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
        _ellipsoid(img, cx, cy, rx, ry, spec["color"], spin, spec.get("bump", 0.0))

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
