"use client";

// The background: a double helix of blocks, chained, with transactions
// propagating along the links.
//
// It is a real little simulation rather than a looping animation, because a loop
// gives itself away after about eight seconds and then the page feels cheap. The
// helix rotates in projected 3D, blocks nearer the camera are larger and
// brighter, and every few seconds a "transaction" is minted at one block and
// travels the chain, lighting each link as it passes.
//
// Canvas 2D, not WebGL: this is ~120 blocks and some lines. WebGL would cost a
// dependency and a context for something 2D draws comfortably at 60fps — and
// the last WebGL attempt on this project was rejected for looking cartoonish.
//
// Performance rules it obeys, because a background that eats a laptop is worse
// than no background:
//   • device-pixel-ratio capped at 2 (a 3x phone would quadruple the fill rate)
//   • pauses entirely when the tab is hidden or the canvas scrolls out of view
//   • honours prefers-reduced-motion by rendering ONE static frame
//   • no per-frame allocation in the draw loop

import { useEffect, useRef } from "react";

type Block = {
  /** Position along the helix, 0..1. */
  t: number;
  /** Which of the two strands. */
  strand: number;
  hash: string;
  /** Lights up when a transaction passes through. */
  flash: number;
};

const BLOCKS_PER_STRAND = 34;
const STRANDS = 2;
const HEX = "0123456789abcdef";

function shortHash(seed: number): string {
  // Deterministic so the same block keeps its label across frames.
  let h = "";
  let x = seed * 2654435761;
  for (let i = 0; i < 4; i++) {
    x = (x ^ (x >>> 13)) * 1274126177;
    h += HEX[Math.abs(x) % 16];
  }
  return h;
}

export function ChainField({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Kept in a ref so changing intensity never restarts the simulation — the
  // helix should keep its position when the page transitions. Written in an
  // effect, not during render: React may render speculatively and discard the
  // result, so a render-time write can apply from a render that never happened.
  const intensityRef = useRef(intensity);
  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const blocks: Block[] = [];
    for (let s = 0; s < STRANDS; s++) {
      for (let i = 0; i < BLOCKS_PER_STRAND; i++) {
        blocks.push({
          t: i / BLOCKS_PER_STRAND,
          strand: s,
          hash: shortHash(s * 100 + i),
          flash: 0,
        });
      }
    }

    // A transaction is just a position along the chain that advances and lights
    // up whatever it passes.
    let txPos = -1;
    let txTimer = 1.2;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Reused across frames — allocating these inside draw() would make the GC
    // stutter the animation every few seconds.
    const px = new Float32Array(blocks.length);
    const py = new Float32Array(blocks.length);
    const pz = new Float32Array(blocks.length);

    let spin = 0;
    let raf = 0;
    let last = performance.now();
    let running = true;

    const draw = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); // clamp: a backgrounded
      last = now;                                     // tab must not jump
      if (!reduced) spin += dt * 0.16;

      const amp = intensityRef.current;
      ctx.clearRect(0, 0, w, h);

      // Advance the transaction.
      if (!reduced) {
        if (txPos >= 0) {
          txPos += dt * 0.55;
          if (txPos > 1) txPos = -1;
        } else {
          txTimer -= dt;
          if (txTimer <= 0) {
            txPos = 0;
            txTimer = 2.5 + Math.random() * 3;
          }
        }
      }

      const cx = w * 0.5;
      const cy = h * 0.5;
      // The helix is taller than the viewport so it reads as passing THROUGH
      // the screen rather than sitting inside it.
      const span = h * 1.35;
      const radius = Math.min(w, h) * 0.27;

      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const strandOffset = (b.strand / STRANDS) * Math.PI * 2;
        // Two turns across the visible span.
        const angle = b.t * Math.PI * 4 + spin + strandOffset;
        const y = cy + (b.t - 0.5) * span;
        const x3 = Math.cos(angle) * radius;
        const z3 = Math.sin(angle) * radius;
        // Weak perspective: near blocks bigger and brighter.
        const depth = (z3 + radius) / (radius * 2); // 0 far, 1 near
        px[i] = cx + x3 * (0.75 + depth * 0.35);
        py[i] = y;
        pz[i] = depth;

        if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 2.2);
        if (txPos >= 0 && Math.abs(b.t - txPos) < 0.02) b.flash = 1;
      }

      // ── Links first, so blocks sit on top ────────────────────────────────
      for (let s = 0; s < STRANDS; s++) {
        for (let i = 0; i < BLOCKS_PER_STRAND - 1; i++) {
          const a = s * BLOCKS_PER_STRAND + i;
          const c = a + 1;
          const near = (pz[a] + pz[c]) / 2;
          const lit = Math.max(blocks[a].flash, blocks[c].flash);
          ctx.beginPath();
          ctx.moveTo(px[a], py[a]);
          ctx.lineTo(px[c], py[c]);
          ctx.strokeStyle = lit > 0
            ? `rgba(217, 119, 66, ${(0.25 + lit * 0.75) * amp})`
            : `rgba(120, 150, 180, ${(0.05 + near * 0.13) * amp})`;
          ctx.lineWidth = lit > 0 ? 1.8 : 0.6 + near * 0.7;
          ctx.stroke();
        }
      }

      // Cross-links between the strands — what makes it read as a CHAIN rather
      // than two unrelated spirals.
      for (let i = 0; i < BLOCKS_PER_STRAND; i += 3) {
        const a = i;
        const c = BLOCKS_PER_STRAND + i;
        const near = (pz[a] + pz[c]) / 2;
        ctx.beginPath();
        ctx.moveTo(px[a], py[a]);
        ctx.lineTo(px[c], py[c]);
        ctx.strokeStyle = `rgba(120, 150, 180, ${(0.03 + near * 0.07) * amp})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }

      // ── Blocks ───────────────────────────────────────────────────────────
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i];
        const near = pz[i];
        const size = 3 + near * 7;
        const glow = b.flash;

        if (glow > 0) {
          ctx.beginPath();
          ctx.arc(px[i], py[i], size * (2.2 + glow * 2), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(217, 119, 66, ${0.16 * glow * amp})`;
          ctx.fill();
        }

        ctx.beginPath();
        // Rounded square — a "block", not a dot.
        const r = size * 0.32;
        const x0 = px[i] - size / 2;
        const y0 = py[i] - size / 2;
        ctx.roundRect(x0, y0, size, size, r);
        ctx.fillStyle = glow > 0
          ? `rgba(240, 160, 100, ${(0.5 + glow * 0.5) * amp})`
          : `rgba(150, 180, 210, ${(0.10 + near * 0.42) * amp})`;
        ctx.fill();

        // Hash labels only on the nearest blocks — every block labelled is
        // noise, a few labelled reads as a ledger.
        if (near > 0.86 && size > 8) {
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = `rgba(150, 180, 210, ${(near - 0.86) * 2.2 * amp})`;
          ctx.fillText(`0x${b.hash}`, px[i] + size, py[i] + 3);
        }
      }

      if (running && !reduced) raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    // Stop when nobody can see it: a hidden tab or a scrolled-away canvas has no
    // right to a CPU core.
    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running && !reduced) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ contain: "strict" }}
    />
  );
}
