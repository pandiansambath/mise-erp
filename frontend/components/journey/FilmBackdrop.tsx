"use client";

// The cinematic layer: one real video clip per story beat, stacked full-screen
// and crossfaded by scroll. Clips lazy-load only as you approach them (so the
// first paint is just the hero poster + its ~1.8MB clip), play only while
// visible (battery/CPU), and sit under a legibility scrim + vignette so the
// oversized white type always reads. No WebGL — just video + opacity, which is
// why it stays buttery on a phone.

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";
import { SCENES, sceneLocalProgress, sceneOpacities } from "./scenes";

export default function FilmBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const layers = Array.from(root.querySelectorAll<HTMLDivElement>("[data-scene]"));
    const videos = layers.map((l) => l.querySelector("video") as HTMLVideoElement);
    const op = new Array(SCENES.length).fill(0);
    let raf = 0;
    const tick = () => {
      const p = journeyProgress.value;
      sceneOpacities(p, op);
      for (let i = 0; i < layers.length; i++) {
        const o = op[i];
        layers[i].style.opacity = String(o);
        const v = videos[i];
        if (!v) continue;
        if (o > 0.02) {
          if (!v.getAttribute("src")) v.setAttribute("src", v.dataset.src || "");
          if (v.paused) v.play().catch(() => {});
          // slow forward push + drift while you travel through this scene
          const local = sceneLocalProgress(p, i);
          v.style.transform = `scale(${1.06 + local * 0.13}) translateY(${(local - 0.5) * 3}%)`;
        } else if (!v.paused) {
          v.pause();
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

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
            data-src={`/journey/${s.name}.mp4`}
            poster={`/journey/${s.name}.jpg`}
            muted
            loop
            playsInline
            preload="none"
            disablePictureInPicture
            className="h-full w-full object-cover will-change-transform"
            style={{ objectPosition: s.pos, transform: "scale(1.06)" }}
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
