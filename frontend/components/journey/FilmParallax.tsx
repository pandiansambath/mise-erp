"use client";

// The journey, done the way smooth premium sites actually do it: a CAMERA gliding
// over cinematic imagery. Each scene is a still image; as you scroll we drive a
// gentle push-in (scale) + parallax drift + crossfade using ONLY transform and
// opacity — GPU-composited, no decoding, no video engine. So the motion is
// continuous and buttery on desktop and mobile alike (unlike scrubbing video
// frames, which steps through real motion and feels jerky by nature).

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";
import { SCENES, sceneLocalProgress, sceneOpacities } from "./scenes";

type Props = { onProgress?: (frac: number) => void; onReady?: () => void };

export default function FilmParallax({ onProgress, onReady }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const layers = Array.from(root.querySelectorAll<HTMLDivElement>("[data-layer]"));
    const inners = layers.map((l) => l.firstElementChild as HTMLDivElement);

    // ── Preload the scene images; reveal once the first couple are ready ──
    const REVEAL = Math.min(2, SCENES.length);
    const loaded = new Array(SCENES.length).fill(false);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      onProgress?.(1);
      onReady?.();
    };
    const report = () => {
      let r = 0;
      for (let i = 0; i < REVEAL; i++) if (loaded[i]) r++;
      onProgress?.(Math.min(1, r / REVEAL));
      let ok = true;
      for (let i = 0; i < REVEAL; i++) if (!loaded[i]) ok = false;
      if (ok) finish();
    };
    SCENES.forEach((s, i) => {
      const img = new Image();
      const d = () => {
        loaded[i] = true;
        report();
      };
      img.onload = d;
      img.onerror = d;
      img.src = `/journey/${s.name}.jpg`;
    });
    const timeout = window.setTimeout(finish, 8000);

    // ── Scroll → camera. Only transform/opacity, only when scroll moved. ──
    const op = new Array(SCENES.length).fill(0);
    const lastOp = new Array(SCENES.length).fill(-1);
    let lastP = -1;
    let raf = 0;
    const tick = () => {
      const p = journeyProgress.value;
      if (p !== lastP) {
        lastP = p;
        sceneOpacities(p, op);
        for (let i = 0; i < layers.length; i++) {
          const o = op[i];
          if (Math.abs(o - lastOp[i]) > 0.003) {
            layers[i].style.opacity = String(o);
            lastOp[i] = o;
          }
          if (o > 0.004) {
            const local = sceneLocalProgress(p, i);
            // slow push-in + a little vertical drift = a travelling camera
            const scale = (1.06 + local * 0.1).toFixed(4);
            const drift = ((local - 0.5) * 5).toFixed(2);
            inners[i].style.transform = `translateZ(0) scale(${scale}) translateY(${drift}%)`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [onProgress, onReady]);

  return (
    <div ref={rootRef} className="fixed inset-0 z-0 overflow-hidden bg-[#04080e]" aria-hidden>
      {SCENES.map((s, i) => (
        <div
          key={s.name}
          data-layer={i}
          className="absolute inset-0"
          style={{ opacity: i === 0 ? 1 : 0, willChange: "opacity" }}
        >
          <div
            className="absolute inset-0 bg-cover"
            style={{
              backgroundImage: `url(/journey/${s.name}.jpg)`,
              backgroundPosition: s.pos || "center",
              transform: "translateZ(0) scale(1.06)",
              willChange: "transform",
            }}
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
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 240px 70px rgba(0,0,0,0.55)" }} />
    </div>
  );
}
