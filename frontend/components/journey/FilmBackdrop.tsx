"use client";

// The cinematic layer: one real HD clip per beat, stacked full-screen and
// crossfaded by scroll. To kill the "video doesn't move for a few seconds / never
// moves on mobile" problem we PRELOAD EVERY clip up front (reporting progress to a
// loading screen), then autoplay them all. Each frame we also re-kick whichever
// clip is currently visible — so even if a phone pauses background videos, the one
// you're looking at is already buffered and starts instantly.

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";
import { SCENES, sceneOpacities } from "./scenes";

type Props = { onProgress?: (frac: number) => void; onReady?: () => void };

export default function FilmBackdrop({ onProgress, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const layers = Array.from(root.querySelectorAll<HTMLDivElement>("[data-scene]"));
    const videos = layers.map((l) => l.querySelector("video") as HTMLVideoElement);
    const op = new Array(SCENES.length).fill(0);
    const lastOp = new Array(SCENES.length).fill(-1);

    // ── Preload: reveal as soon as the FIRST few clips are ready; the rest keep
    // streaming in the background (preload=auto). We never play more than the
    // visible clip, so revealing early is safe and the loader stays quick. ──
    const total = videos.length;
    const REVEAL = Math.min(3, total); // first scenes the visitor will actually see
    const ready = new Set<number>();
    let done = false;
    const cleanups: Array<() => void> = [];

    const finish = () => {
      if (done) return;
      done = true;
      onProgress?.(1);
      onReady?.(); // the tick below plays ONLY the visible clip
    };
    const check = () => {
      let n = 0;
      for (let k = 0; k < REVEAL; k++) if (ready.has(k)) n++;
      onProgress?.(n / REVEAL);
      if (n >= REVEAL) finish();
    };

    videos.forEach((v, i) => {
      if (!v || v.readyState >= 2) {
        ready.add(i);
        return;
      }
      const h = () => {
        ready.add(i);
        check();
      };
      v.addEventListener("loadeddata", h);
      v.addEventListener("canplay", h);
      v.addEventListener("error", h); // count errors too, so we never hang
      cleanups.push(() => {
        v.removeEventListener("loadeddata", h);
        v.removeEventListener("canplay", h);
        v.removeEventListener("error", h);
      });
      try {
        v.load();
      } catch {
        /* ignore */
      }
    });
    check(); // some may already be ready on mount
    // Safety: never trap the visitor on the loader if the network is slow/flaky.
    const timeout = window.setTimeout(finish, 9000);

    let raf = 0;
    const tick = () => {
      sceneOpacities(journeyProgress.value, op);
      for (let i = 0; i < layers.length; i++) {
        const o = op[i];
        if (Math.abs(o - lastOp[i]) > 0.003) {
          layers[i].style.opacity = String(o);
          lastOp[i] = o;
        }
        const v = videos[i];
        if (!v) continue;
        // ONLY the visible clip (1–2 during a crossfade) decodes — keeps it smooth.
        if (o > 0.015) {
          if (v.paused) v.play().catch(() => {});
        } else if (!v.paused) {
          v.pause();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      cleanups.forEach((fn) => fn());
    };
  }, [onProgress, onReady]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-0 overflow-hidden bg-black" aria-hidden>
      {SCENES.map((s, i) => (
        <div
          key={s.name}
          data-scene={i}
          className="absolute inset-0"
          style={{ opacity: i === 0 ? 1 : 0, willChange: "opacity" }}
        >
          <video
            src={`/journey/${s.name}.mp4`}
            poster={`/journey/${s.name}.jpg`}
            muted
            loop
            playsInline
            preload="auto"
            disablePictureInPicture
            className="h-full w-full object-cover"
            style={{ objectPosition: s.pos, transform: "translateZ(0) scale(1.03)" }}
          />
        </div>
      ))}

      {/* legibility scrim — darker top (nav) + bottom (text), lighter middle */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, rgba(4,8,14,0.62) 0%, rgba(4,8,14,0.30) 32%, rgba(4,8,14,0.40) 64%, rgba(4,8,14,0.74) 100%)",
        }}
      />
      {/* soft vignette to focus the centre */}
      <div
        className="absolute inset-0"
        style={{ boxShadow: "inset 0 0 240px 70px rgba(0,0,0,0.55)" }}
      />
    </div>
  );
}
