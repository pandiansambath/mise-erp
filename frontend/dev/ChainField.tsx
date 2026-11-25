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
import { flight } from "./flight";
import { water } from "./flow";
import { pageY, pageYFree } from "./scrollPos";
import { FLOATERS } from "./SkillDrift";
import { holder } from "./stage";
import { readRGB, THEME_EVENT } from "./theme";

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
//
// Mutable on purpose: the theme decides them (accent A and B, and their lit
// steps), re-read on every switch — see `paint` below.
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

/** `words`: the skills drifting behind the page (SkillDrift) are drawn here too, on a desktop. */
export function ChainField({ intensity = 1, words = false }: { intensity?: number; words?: boolean }) {
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

    // The strands wear the theme's two accents.
    const paint = () => {
      STRAND_RGB[0] = readRGB(canvas, "a", STRAND_RGB[0]);
      STRAND_RGB[1] = readRGB(canvas, "b", STRAND_RGB[1]);
      STRAND_HOT[0] = readRGB(canvas, "a2", STRAND_HOT[0]);
      STRAND_HOT[1] = readRGB(canvas, "b2", STRAND_HOT[1]);
    };
    paint();
    window.addEventListener(THEME_EVENT, paint);

    // ── The drifting words, made pictures once a theme, all of them on one sheet ──
    // (Each on a canvas of its own was fetched afresh for every drawing, thirty of them thirty
    // times a second: more than half of what the whole page cost the graphics at rest.)
    let sprites: { sy: number; sw: number; sh: number; w: number; h: number; f: (typeof FLOATERS)[number] }[] = [];
    let sheet: CanvasImageSource | null = null;
    const root = canvas.closest<HTMLElement>(".dev-root");
    const drift = words && !reduced && !!root && pageYFree();
    const letter = () => {
      if (!drift || !root) return;
      const k = Math.min(window.devicePixelRatio || 1, 1.5);
      const probe = document.createElement("span");
      probe.className = "font-mono";
      probe.style.display = "none";
      root.appendChild(probe);
      const c = document.createElement("canvas");
      const g = c.getContext("2d")!;
      let wide = 1;
      let tall = 0;
      const set = FLOATERS.map((f) => {
        probe.style.color = f.hue;
        const cs = getComputedStyle(probe);
        const font = `${f.size * k}px ${cs.fontFamily}`;
        g.font = font;
        const sw = Math.ceil(g.measureText(f.label).width) + 4;
        const sh = Math.ceil(f.size * k * 1.5);
        const sy = tall;
        tall += sh + 2;
        wide = Math.max(wide, sw);
        return { sy, sw, sh, w: sw / k, h: sh / k, f, font, color: cs.color };
      });
      c.width = wide;
      c.height = tall;
      g.textBaseline = "middle";
      for (const s of set) {
        g.font = s.font;
        g.fillStyle = s.color;
        g.fillText(s.f.label, 1, s.sy + s.sh / 2);
      }
      probe.remove();
      sprites = set;
      sheet = c;
      if ("createImageBitmap" in window)
        void createImageBitmap(c).then(
          (b) => {
            if (sheet === c) sheet = b;
          },
          () => {},
        );
      root.dataset.drift = "";
    };
    let lettering = 0;
    const reletter = () => {
      window.clearTimeout(lettering);
      lettering = window.setTimeout(letter, 180);
    };
    if (drift) {
      void document.fonts.ready.then(() => {
        if (running) letter();
      });
      window.addEventListener(THEME_EVENT, reletter);
    }

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
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
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
    // The chain turns WITH the scroll: down winds it forward, up winds it
    // back — "chain rotation for scrolling".
    let lastY = pageY();
    let raf = 0;
    let last = performance.now();
    let running = true;

    // (Behind the door, and while it opens: still — §103.10.)
    const hold = holder(2, window.matchMedia("(max-width: 767px)").matches ? 3200 : 900);
    const SHADES = 5;
    const shade = (near: number) => Math.min(SHADES - 1, Math.max(0, Math.floor(near * SHADES)));
    const link = (a: number, c: number, near: number) => {
      const dx = px[c] - px[a];
      const dy = py[c] - py[a];
      const ang = Math.atan2(dy, dx);
      const rx = Math.min(Math.hypot(dx, dy) * 0.3, 9);
      const mx = (px[a] + px[c]) / 2;
      const my = (py[a] + py[c]) / 2;
      ctx.moveTo(mx + Math.cos(ang) * rx, my + Math.sin(ang) * rx);
      ctx.ellipse(mx, my, rx, 3.1 + near * 1.4, ang, 0, Math.PI * 2);
    };
    const draw = (now: number) => {
      if (!reduced && hold()) {
        last = now;
        if (running) raf = requestAnimationFrame(draw);
        return;
      }
      // Thirty frames a second are plenty for a slow helix, and halve what it
      // costs the main thread while the page scrolls (22 Nov).
      if (!reduced && now - last < 30) {
        if (running) raf = requestAnimationFrame(draw);
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05); // clamp: a backgrounded
      last = now;                                     // tab must not jump
      if (!reduced) {
        spin += dt * 0.16;
        const y = pageY();
        spin += Math.max(-0.4, Math.min(0.4, (y - lastY) * 0.0024));
        lastY = y;
      }

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

      const wet = !reduced && water.active();
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
        // The hand in the water carries it a little way.
        if (wet) {
          const f = water.at(px[i], y);
          const k = 0.05 + depth * 0.06;
          b.flash = Math.max(b.flash, Math.min(0.7, f[2]));
          px[i] += Math.max(-46, Math.min(46, f[0] * k));
          py[i] += Math.max(-46, Math.min(46, f[1] * k));
        }

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
      // (What is dim is drawn in a few shades, each in one stroke: a canvas is paid by the
      // command, and one for every link and block, thirty times a second, was two thirds of
      // what the page cost at rest.)
      for (let s = 0; s < STRANDS; s++) {
        for (let q = 0; q < SHADES; q++) {
          const mid = (q + 0.5) / SHADES;
          let any = false;
          ctx.beginPath();
          for (let i = 0; i < BLOCKS_PER_STRAND - 1; i++) {
            const a = s * BLOCKS_PER_STRAND + i;
            if (blocks[a].flash > 0 || blocks[a + 1].flash > 0) continue;
            if (shade((pz[a] + pz[a + 1]) / 2) !== q) continue;
            ctx.moveTo(px[a], py[a]);
            ctx.lineTo(px[a + 1], py[a + 1]);
            any = true;
          }
          if (any) {
            ctx.strokeStyle = rgba(STRAND_RGB[s], (0.06 + mid * 0.16) * amp);
            ctx.lineWidth = 0.6 + mid * 0.7;
            ctx.stroke();
          }
          // A real LINK at the midpoint, not just a line. A short ellipse
          // angled along the segment reads as interlocking metal, which is
          // what makes the thing look chained rather than merely connected.
          // Only on the near half — drawing 66 of these every frame would be
          // noise, and you cannot see them at the back anyway.
          if (mid < 0.5) continue;
          any = false;
          ctx.beginPath();
          for (let i = 0; i < BLOCKS_PER_STRAND - 1; i++) {
            const a = s * BLOCKS_PER_STRAND + i;
            if (blocks[a].flash > 0 || blocks[a + 1].flash > 0) continue;
            const near = (pz[a] + pz[a + 1]) / 2;
            if (near <= 0.55 || shade(near) !== q) continue;
            link(a, a + 1, near);
            any = true;
          }
          if (any) {
            ctx.strokeStyle = rgba(STRAND_RGB[s], (0.09 + mid * 0.2) * amp);
            ctx.lineWidth = 1.1;
            ctx.stroke();
          }
        }
        // …and what is lit, each by itself.
        for (let i = 0; i < BLOCKS_PER_STRAND - 1; i++) {
          const a = s * BLOCKS_PER_STRAND + i;
          const lit = Math.max(blocks[a].flash, blocks[a + 1].flash);
          if (lit <= 0) continue;
          const near = (pz[a] + pz[a + 1]) / 2;
          ctx.beginPath();
          ctx.moveTo(px[a], py[a]);
          ctx.lineTo(px[a + 1], py[a + 1]);
          ctx.strokeStyle = rgba(STRAND_HOT[s], (0.25 + lit * 0.75) * amp);
          ctx.lineWidth = 1.8;
          ctx.stroke();
          if (near > 0.55) {
            ctx.beginPath();
            link(a, a + 1, near);
            ctx.strokeStyle = rgba(STRAND_HOT[s], (0.4 + lit * 0.6) * amp);
            ctx.lineWidth = 1.1;
            ctx.stroke();
          }
        }
      }

      // Cross-links between the strands — what makes it read as a CHAIN rather
      // than two unrelated spirals. Each physically spans copper to teal: drawn
      // in four lengths, the colour turning from the one to the other, the same
      // length of all of them at once.
      for (let k = 0; k < 4; k++) {
        ctx.beginPath();
        for (let i = 0; i < BLOCKS_PER_STRAND; i += 3) {
          const c = BLOCKS_PER_STRAND + i;
          // A frame can catch a point before it has a position (seen on live,
          // 21 Nov 2026): moveTo shrugs NaN off.
          const dx = px[c] - px[i];
          const dy = py[c] - py[i];
          ctx.moveTo(px[i] + (dx * k) / 4, py[i] + (dy * k) / 4);
          ctx.lineTo(px[i] + (dx * (k + 1)) / 4, py[i] + (dy * (k + 1)) / 4);
        }
        const u = (k + 0.5) / 4;
        ctx.strokeStyle = rgba([0, 1, 2].map((n) => Math.round(STRAND_RGB[0][n] + (STRAND_RGB[1][n] - STRAND_RGB[0][n]) * u)) as [number, number, number], 0.11 * amp);
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }

      // ── Blocks ───────────────────────────────────────────────────────────
      for (let s = 0; s < STRANDS; s++)
        for (let q = 0; q < SHADES; q++) {
          let any = false;
          ctx.beginPath();
          for (let i = s * BLOCKS_PER_STRAND; i < (s + 1) * BLOCKS_PER_STRAND; i++) {
            if (blocks[i].flash > 0 || shade(pz[i]) !== q) continue;
            const size = 3 + pz[i] * 7;
            // Rounded square — a "block", not a dot.
            ctx.roundRect(px[i] - size / 2, py[i] - size / 2, size, size, size * 0.32);
            any = true;
          }
          if (!any) continue;
          ctx.fillStyle = rgba(STRAND_RGB[s], (0.12 + ((q + 0.5) / SHADES) * 0.45) * amp);
          ctx.fill();
        }
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

        if (glow > 0) {
          ctx.beginPath();
          ctx.roundRect(px[i] - size / 2, py[i] - size / 2, size, size, size * 0.32);
          ctx.fillStyle = rgba(STRAND_HOT[b.strand], (0.5 + glow * 0.5) * amp);
          ctx.fill();
        }

        // Hash labels only on the nearest blocks — every block labelled is
        // noise, a few labelled reads as a ledger.
        if (near > 0.86 && size > 8) {
          ctx.font = "9px ui-monospace, monospace";
          ctx.fillStyle = rgba(STRAND_RGB[b.strand], (near - 0.86) * 2.4 * amp);
          ctx.fillText(`0x${b.hash}`, px[i] + size, py[i] + 3);
        }
      }

      // ── The words: far ahead, come nearer, and passed (§108.2: one flies through them) ──
      if (sprites.length && sheet) {
        const n = sprites.length;
        for (let i = 0; i < n; i++) {
          const { sy, sw: pw, sh: ph, w: sw, h: sh, f } = sprites[i];
          // (Each has its own place in the depth: it keeps it from frame to frame.)
          const u = (((i * 0.618034 + flight.z * 0.011 * (0.75 + f.opacity * 4)) % 1) + 1) % 1;
          const k = 0.42 / (1.04 - u * 0.86);
          const x0 = ((f.left / 100) * w + sw / 2 - cx) * k + cx;
          const y0 = ((((f.top % 100) + 100) % 100) / 100) * h;
          let x = x0 - (sw * k) / 2;
          let y = (y0 - cy) * k + cy - (sh * k) / 2;
          if (x > w || y > h || x < -sw * k || y < -sh * k) continue;
          const seen = Math.min(1, u * 5) * Math.min(1, (1 - u) * 6);
          ctx.globalAlpha = Math.min(0.3, f.opacity * seen * (1 + 0.9 * flight.v));
          if (wet) {
            const q = water.at(x + (sw * k) / 2, y + (sh * k) / 2);
            ctx.globalAlpha = Math.min(0.5, f.opacity * seen * (1 + 2.2 * q[2]));
            x += Math.max(-60, Math.min(60, q[0] * 0.11));
            y += Math.max(-60, Math.min(60, q[1] * 0.11));
          }
          ctx.drawImage(sheet, 0, sy, pw, ph, x, y, sw * k, sh * k);
        }
        ctx.globalAlpha = 1;
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
      window.clearTimeout(lettering);
      window.removeEventListener(THEME_EVENT, reletter);
      if (root) delete root.dataset.drift;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerleave", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(THEME_EVENT, paint);
    };
  }, [words]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 h-full w-full"
      style={{ contain: "strict" }}
    />
  );
}
