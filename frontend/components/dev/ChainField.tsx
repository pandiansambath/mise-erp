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
  /** >0 while this block is being "mined": its hash churns, then locks. */
  mining: number;
  /** Fades after a block locks, so the seal is visible for a moment. */
  sealed: number;
};

const BLOCKS_PER_STRAND = 34;
const STRANDS = 2;
const HEX = "0123456789abcdef";

// One colour per strand. Copper is the product's; teal is the counterweight —
// warm against cool, both legible on near-black, and it gives the two helixes
// an identity instead of being one colour drawn twice.
//
// Held as raw channels so alpha can be varied per-frame without building
// hundreds of rgba() strings in the draw loop.
const STRAND_RGB: [number, number, number][] = [
  [217, 119, 66],   // copper
  [45, 212, 191],   // teal
];
const STRAND_HOT: [number, number, number][] = [
  [240, 160, 100],  // copper, lit
  [125, 240, 220],  // teal, lit
];
const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

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
          mining: 0,
          sealed: 0,
        });
      }
    }

    // A transaction is just a position along the chain that advances and lights
    // up whatever it passes.
    // TWO transactions, one per strand, travelling in OPPOSITE directions.
    // They are the thing that makes the field feel like a system under load
    // rather than a screensaver — and when they pass each other, they collide.
    let txPos = -1;
    let txTimer = 1.2;
    let txPos2 = -1;
    let txTimer2 = 2.6;
    // Where two transactions met, and how long ago. Drives the shockwave.
    let collideAt = -1;
    let collideAge = 0;
    // Mining: every couple of seconds a random block churns its hash and then
    // locks. This is what makes it read as a CHAIN doing work rather than a
    // spiral of dots.
    let mineTimer = 0.8;

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

    // Where the cursor is, in canvas pixels. The helix leans toward it and
    // blocks near it wake up — a background that ignores the mouse reads as
    // wallpaper, and this one should feel like it noticed you.
    let pointerX = -9999;
    let pointerY = -9999;
    let tiltX = 0;   // eased, so the lean is weighty rather than twitchy
    let tiltTarget = 0;
    const onPointer = (e: PointerEvent) => {
      pointerX = e.clientX;
      pointerY = e.clientY;
      tiltTarget = (e.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2; // -1..1
    };
    const onLeave = () => { pointerX = -9999; pointerY = -9999; tiltTarget = 0; };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerleave", onLeave);

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

      // Ease the lean toward the cursor. Lerping rather than snapping is the
      // whole difference between "responsive" and "jittery".
      tiltX += (tiltTarget - tiltX) * Math.min(dt * 2.6, 1);

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

        // The counter-transaction, running backwards along the other strand.
        if (txPos2 >= 0) {
          txPos2 -= dt * 0.48;
          if (txPos2 < 0) txPos2 = -1;
        } else {
          txTimer2 -= dt;
          if (txTimer2 <= 0) {
            txPos2 = 1;
            txTimer2 = 3.2 + Math.random() * 3;
          }
        }

        // Collision: both live and passing through the same point. The two
        // strands are not decoration, they are two flows meeting.
        if (txPos >= 0 && txPos2 >= 0 && Math.abs(txPos - txPos2) < 0.015 && collideAge <= 0) {
          collideAt = (txPos + txPos2) / 2;
          collideAge = 1;
        }
        if (collideAge > 0) collideAge = Math.max(0, collideAge - dt * 0.85);

        // Start mining a new block now and then.
        mineTimer -= dt;
        if (mineTimer <= 0) {
          const pick = blocks[Math.floor(Math.random() * blocks.length)];
          if (pick.mining <= 0) pick.mining = 1;
          mineTimer = 1.6 + Math.random() * 2.4;
        }
        for (const b of blocks) {
          if (b.mining > 0) {
            b.mining -= dt * 1.4;
            // Churn the visible hash while it works…
            if (Math.random() < 0.5) b.hash = shortHash(Math.random() * 1e6);
            if (b.mining <= 0) {
              // …then it locks, and the seal flashes.
              b.mining = 0;
              b.sealed = 1;
              b.flash = Math.max(b.flash, 0.85);
            }
          }
          if (b.sealed > 0) b.sealed = Math.max(0, b.sealed - dt * 0.8);
        }
      }

      const cx = w * 0.5;
      const cy = h * 0.5;
      // The helix is taller than the viewport so it reads as passing THROUGH
      // the screen rather than sitting inside it.
      const span = h * 1.35;
      // Radius from BOTH axes, not just the smaller one.
      //
      // min(w, h) * 0.27 meant a 1920x900 desktop used the HEIGHT — a 243px
      // helix stranded in the middle of a very wide screen, with the sides
      // empty. Taking width into account lets it actually spread: ~450px on
      // that screen, while a phone is unchanged because there width is the
      // limit anyway.
      const radius = Math.min(w * 0.32, h * 0.5);

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
        // The lean: near blocks shift further than far ones, which is what
        // makes it read as parallax rather than the whole image sliding.
        px[i] = cx + x3 * (0.75 + depth * 0.35) + tiltX * (18 + depth * 46);
        py[i] = y;
        pz[i] = depth;

        if (b.flash > 0) b.flash = Math.max(0, b.flash - dt * 2.2);
        // Each transaction lights only its own strand — that is what makes two
        // flows readable as two rather than one wide one.
        if (b.strand === 0 && txPos >= 0 && Math.abs(b.t - txPos) < 0.02) b.flash = 1;
        if (b.strand === 1 && txPos2 >= 0 && Math.abs(b.t - txPos2) < 0.02) b.flash = 1;
        // A collision lights BOTH strands, and wider — the point is that it
        // reads as an event, not another pulse going by.
        if (collideAge > 0 && Math.abs(b.t - collideAt) < 0.06) {
          b.flash = Math.max(b.flash, collideAge);
        }

        // Near the cursor? Wake up. Squared distance — no sqrt in a loop that
        // runs 68 times a frame.
        const ddx = px[i] - pointerX;
        const ddy = py[i] - pointerY;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < 19600) {
          // 140px radius, falling off smoothly to nothing at the edge.
          const near2 = 1 - d2 / 19600;
          b.flash = Math.max(b.flash, near2 * 0.7);
        }
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
            ? rgba(STRAND_HOT[s], (0.25 + lit * 0.75) * amp)
            : rgba(STRAND_RGB[s], (0.06 + near * 0.16) * amp);
          ctx.lineWidth = lit > 0 ? 1.8 : 0.6 + near * 0.7;
          ctx.stroke();

          // A real LINK at the midpoint, not just a line. A short ellipse
          // angled along the segment reads as interlocking metal, which is
          // what makes the thing look chained rather than merely connected.
          // Only on the near half — drawing 66 of these every frame would be
          // noise, and you cannot see them at the back anyway.
          if (near > 0.55) {
            const mx = (px[a] + px[c]) / 2;
            const my = (py[a] + py[c]) / 2;
            const ang = Math.atan2(py[c] - py[a], px[c] - px[a]);
            const len = Math.hypot(px[c] - px[a], py[c] - py[a]);
            ctx.save();
            ctx.translate(mx, my);
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.ellipse(0, 0, Math.min(len * 0.3, 9), 3.1 + near * 1.4, 0, 0, Math.PI * 2);
            ctx.strokeStyle = lit > 0
              ? rgba(STRAND_HOT[s], (0.4 + lit * 0.6) * amp)
              : rgba(STRAND_RGB[s], (0.09 + near * 0.2) * amp);
            ctx.lineWidth = 1.1;
            ctx.stroke();
            ctx.restore();
          }
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
        // A gradient, not a flat line: this rung physically spans copper to
        // teal, so drawing it in one colour would hide the only place the two
        // systems actually touch.
        const grad = ctx.createLinearGradient(px[a], py[a], px[c], py[c]);
        grad.addColorStop(0, rgba(STRAND_RGB[0], (0.05 + near * 0.12) * amp));
        grad.addColorStop(1, rgba(STRAND_RGB[1], (0.05 + near * 0.12) * amp));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 0.7;
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
          ctx.fillStyle = rgba(STRAND_RGB[b.strand], 0.18 * glow * amp);
          ctx.fill();
        }

        // A block that just locked throws one expanding ring — the visible
        // "sealed" moment. Fades as it grows, so it reads as a pulse leaving
        // rather than a circle sitting there.
        if (b.sealed > 0) {
          ctx.beginPath();
          ctx.arc(px[i], py[i], size * (1.5 + (1 - b.sealed) * 6), 0, Math.PI * 2);
          ctx.strokeStyle = rgba(STRAND_HOT[b.strand], b.sealed * 0.55 * amp);
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        // Still mining: a broken arc spinning round it, like work in progress.
        if (b.mining > 0) {
          ctx.beginPath();
          const sweep = spin * 6;
          ctx.arc(px[i], py[i], size * 2.1, sweep, sweep + Math.PI * 1.2);
          ctx.strokeStyle = rgba(STRAND_HOT[b.strand], 0.6 * amp);
          ctx.lineWidth = 1.4;
          ctx.stroke();
        }

        ctx.beginPath();
        // Rounded square — a "block", not a dot.
        const r = size * 0.32;
        const x0 = px[i] - size / 2;
        const y0 = py[i] - size / 2;
        ctx.roundRect(x0, y0, size, size, r);
        ctx.fillStyle = glow > 0
          ? rgba(STRAND_HOT[b.strand], (0.5 + glow * 0.5) * amp)
          : rgba(STRAND_RGB[b.strand], (0.12 + near * 0.45) * amp);
        ctx.fill();

        // Hash labels only on the nearest blocks — every block labelled is
        // noise, a few labelled reads as a ledger.
        if (near > 0.86 && size > 8) {
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = rgba(STRAND_RGB[b.strand], (near - 0.86) * 2.4 * amp);
          ctx.fillText(`0x${b.hash}`, px[i] + size, py[i] + 3);
        }
      }

      // ── The collision ────────────────────────────────────────────────────
      // Drawn last so it sits over everything. Two rings expanding from where
      // the flows met, one in each colour, chasing each other outward — the
      // two systems briefly interfering rather than politely coexisting.
      if (collideAge > 0) {
        // Find the meeting point in screen space by interpolating down the
        // helix, rather than storing it: the helix is still turning, so a
        // remembered x/y would drift away from the chain within a frame.
        const y = cy + (collideAt - 0.5) * span;
        const age = 1 - collideAge; // 0 at impact, 1 as it fades
        for (let k = 0; k < 2; k++) {
          ctx.beginPath();
          ctx.arc(cx + tiltX * 40, y, 12 + age * (150 + k * 40), 0, Math.PI * 2);
          ctx.strokeStyle = rgba(STRAND_HOT[k], collideAge * (0.5 - k * 0.15) * amp);
          ctx.lineWidth = 2.4 - k * 0.9;
          ctx.stroke();
        }
        // A brief flare at the point itself.
        const flare = ctx.createRadialGradient(cx + tiltX * 40, y, 0, cx + tiltX * 40, y, 90);
        flare.addColorStop(0, rgba(STRAND_HOT[0], collideAge * 0.22 * amp));
        flare.addColorStop(0.5, rgba(STRAND_HOT[1], collideAge * 0.1 * amp));
        flare.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = flare;
        ctx.fillRect(cx + tiltX * 40 - 90, y - 90, 180, 180);
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
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerleave", onLeave);
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
