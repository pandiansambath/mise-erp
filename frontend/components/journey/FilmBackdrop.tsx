"use client";

// The cinematic layer: one real HD clip per beat, stacked full-screen and
// crossfaded by scroll. Tuned for SMOOTHNESS on a phone:
//   • no per-frame transforms (motion comes from the clips themselves) — a
//     continuously-scaled <video> layer was the source of the scroll jank,
//     flicker, and the "zooms more and more" on mobile;
//   • opacity is written only when it actually changes (idle frames are free);
//   • the current clip + its immediate neighbours preload so a crossfade never
//     flashes a black/empty frame;
//   • only visible clips play (battery/CPU).
// A static, tiny scale just hides sub-pixel edges during a dissolve.

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";
import { SCENES, sceneOpacities } from "./scenes";

export default function FilmBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const layers = Array.from(root.querySelectorAll<HTMLDivElement>("[data-scene]"));
    const videos = layers.map((l) => l.querySelector("video") as HTMLVideoElement);
    const op = new Array(SCENES.length).fill(0);
    const lastOp = new Array(SCENES.length).fill(-1);
    let raf = 0;

    const tick = () => {
      sceneOpacities(journeyProgress.value, op);
      // most-visible scene — used to preload its neighbours
      let active = 0;
      for (let i = 1; i < op.length; i++) if (op[i] > op[active]) active = i;

      for (let i = 0; i < layers.length; i++) {
        const o = op[i];
        if (Math.abs(o - lastOp[i]) > 0.003) {
          layers[i].style.opacity = String(o);
          lastOp[i] = o;
        }
        const v = videos[i];
        if (!v) continue;
        const near = Math.abs(i - active) <= 1; // preload current + neighbours
        if (near && !v.getAttribute("src")) v.setAttribute("src", v.dataset.src || "");
        if (o > 0.02) {
          if (v.paused) v.play().catch(() => {});
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
