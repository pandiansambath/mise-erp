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

    // ── Preload phase: count clips that are ready to play, then reveal + play ──
    const total = videos.length;
    const seen = new Set<number>();
    let done = false;
    const cleanups: Array<() => void> = [];

    const finish = () => {
      if (done) return;
      done = true;
      onProgress?.(1);
      for (const v of videos) v?.play?.().catch(() => {});
      onReady?.();
    };
    const bump = (i: number) => {
      if (seen.has(i)) return;
      seen.add(i);
      onProgress?.(seen.size / total);
      if (seen.size >= total) finish();
    };

    videos.forEach((v, i) => {
      if (!v || v.readyState >= 3) {
        bump(i);
        return;
      }
      const h = () => bump(i);
      v.addEventListener("canplay", h);
      v.addEventListener("loadeddata", h);
      v.addEventListener("error", h); // count errors too, so we never hang
      cleanups.push(() => {
        v.removeEventListener("canplay", h);
        v.removeEventListener("loadeddata", h);
        v.removeEventListener("error", h);
      });
      try {
        v.load();
      } catch {
        /* ignore */
      }
    });
    // Safety: never trap the visitor on the loader if the network is slow/flaky.
    const timeout = window.setTimeout(finish, 12000);

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
        // keep the clip you're actually looking at running (it's preloaded → instant)
        if (v && o > 0.02 && v.paused) v.play().catch(() => {});
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
            autoPlay
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
