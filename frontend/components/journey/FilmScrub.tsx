"use client";

// The premium cinematic layer: real footage drawn to a <canvas>, scrubbed BY the
// scroll (Apple-style). As you scroll through a scene we draw the frame matching
// your scroll position — so the motion is locked to your finger, never on its own
// clock, and there is no video engine to buffer / loop / pause (the things that
// made the stacked-video version stutter). Frames are tiny JPGs, decoded one at a
// time, so it's smooth on phones too.

import { useEffect, useRef } from "react";
import { journeyProgress } from "./progress";
import { SCENES, sceneLocalProgress, sceneOpacities } from "./scenes";

const N = 30; // frames per scene (matches scripts/extract_frames.py)
const pad2 = (n: number) => String(n).padStart(2, "0");

type Props = { onProgress?: (frac: number) => void; onReady?: () => void };

function yFrac(pos?: string): number {
  // "center 55%" → 0.55 ; default 0.5
  const m = pos?.match(/(\d+)%/);
  return m ? Math.min(1, Math.max(0, Number(m[1]) / 100)) : 0.5;
}

export default function FilmScrub({ onProgress, onReady }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // ── Preload frames (+ posters as fallback) ──
    const frames: HTMLImageElement[][] = SCENES.map(() => []);
    const posters: HTMLImageElement[] = [];
    const sceneLoaded = new Array(SCENES.length).fill(0);
    let done = false;

    const REVEAL = Math.min(2, SCENES.length); // first scenes shown → reveal early
    const revealTarget = REVEAL * N;
    const finish = () => {
      if (done) return;
      done = true;
      onProgress?.(1);
      onReady?.();
    };
    const report = () => {
      let r = 0;
      for (let i = 0; i < REVEAL; i++) r += sceneLoaded[i];
      onProgress?.(Math.min(1, r / revealTarget));
      let revealReady = true;
      for (let i = 0; i < REVEAL; i++) if (sceneLoaded[i] < N) revealReady = false;
      if (revealReady) finish();
    };

    SCENES.forEach((s, i) => {
      const poster = new Image();
      poster.src = `/journey/${s.name}.jpg`;
      posters[i] = poster;
      for (let f = 0; f < N; f++) {
        const img = new Image();
        const onceDone = () => {
          sceneLoaded[i] += 1;
          report();
        };
        img.onload = onceDone;
        img.onerror = onceDone; // count errors too, so we never hang
        img.src = `/journey/frames/${s.name}/${pad2(f + 1)}.jpg`;
        frames[i][f] = img;
      }
    });
    const timeout = window.setTimeout(finish, 9000);

    // ── Canvas sizing (cap DPR for perf) ──
    let cw = 0;
    let ch = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cw = Math.round(window.innerWidth * dpr);
      ch = Math.round(window.innerHeight * dpr);
      canvas.width = cw;
      canvas.height = ch;
    };
    resize();
    window.addEventListener("resize", resize);

    const frameFor = (i: number, local: number): HTMLImageElement | null => {
      const idx = Math.min(N - 1, Math.max(0, Math.round(local * (N - 1))));
      const img = frames[i][idx];
      if (img && img.complete && img.naturalWidth > 0) return img;
      const p = posters[i];
      return p && p.complete && p.naturalWidth > 0 ? p : null;
    };

    const drawCover = (img: HTMLImageElement, alpha: number, fracY: number) => {
      const iw = img.naturalWidth;
      const ih = img.naturalHeight;
      if (!iw || !ih) return;
      const scale = Math.max(cw / iw, ch / ih) * 1.05; // slight bleed past edges
      const w = iw * scale;
      const h = ih * scale;
      const dx = (cw - w) / 2;
      const dy = (ch - h) * fracY;
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, dx, dy, w, h);
      ctx.globalAlpha = 1;
    };

    const op = new Array(SCENES.length).fill(0);
    let raf = 0;
    const tick = () => {
      sceneOpacities(journeyProgress.value, op);
      ctx.fillStyle = "#04080e";
      ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < SCENES.length; i++) {
        if (op[i] <= 0.004) continue;
        const img = frameFor(i, sceneLocalProgress(journeyProgress.value, i));
        if (img) drawCover(img, op[i], yFrac(SCENES[i].pos));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener("resize", resize);
    };
  }, [onProgress, onReady]);

  return (
    <div className="fixed inset-0 z-0 overflow-hidden bg-[#04080e]" aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
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
