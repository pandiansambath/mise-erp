#!/usr/bin/env python3
"""Extract scroll-scrub frame sequences from the landing clips.

The premium landing journey draws frames to a <canvas> as you scroll (Apple-style),
so we need each scene as a short sequence of downscaled JPGs spanning the clip's
motion. ffmpeg comes bundled with imageio-ffmpeg (no system install needed).

    pip install imageio-ffmpeg
    python scripts/extract_frames.py

Output: frontend/public/journey/frames/<scene>/01.jpg .. NN.jpg
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "frontend" / "public" / "journey"
OUT = SRC / "frames"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

SCENES = ["mountains", "sea", "forest", "produce", "cooking", "dining", "sharing", "sunrise"]
N = 30      # frames per scene — smooth scrub over ~1.5 screens of scroll
WIDTH = 854  # downscaled; canvas covers the viewport, scrim hides softness
_DUR = re.compile(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)")


def duration(mp4: Path) -> float:
    out = subprocess.run([FFMPEG, "-i", str(mp4)], capture_output=True, text=True).stderr
    m = _DUR.search(out)
    if not m:
        return 6.0
    h, mn, s = m.groups()
    return int(h) * 3600 + int(mn) * 60 + float(s)


def main() -> None:
    total = 0
    for name in SCENES:
        mp4 = SRC / f"{name}.mp4"
        if not mp4.exists():
            print(f"[{name}] missing {mp4}")
            continue
        d = OUT / name
        d.mkdir(parents=True, exist_ok=True)
        for old in d.glob("*.jpg"):
            old.unlink()
        dur = max(duration(mp4), 1.0)
        fps = N / dur  # N frames evenly across the whole clip
        subprocess.run(
            [
                FFMPEG, "-y", "-i", str(mp4),
                "-vf", f"fps={fps:.4f},scale={WIDTH}:-2",
                "-frames:v", str(N), "-q:v", "5",
                str(d / "%02d.jpg"),
            ],
            capture_output=True,
        )
        got = sorted(d.glob("*.jpg"))
        mb = sum(f.stat().st_size for f in got) / 1_000_000
        total += mb
        print(f"[{name}] {len(got)} frames · {mb:.1f}MB  (dur {dur:.1f}s)")
    print(f"\nDONE -> {OUT} · total {total:.1f}MB")


if __name__ == "__main__":
    main()
