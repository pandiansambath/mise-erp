"use client";

// Textures and sound for the chest — everything that is not geometry.
//
// Both are GENERATED rather than downloaded. A wood texture and a hammer
// impact are each a few lines of maths, and shipping them as files would mean
// two more network round trips, two more licences to honour, and two more
// things that can 404 on a page whose whole appeal is that it opens instantly.

/** Wood: grain that actually follows the plank, plus knots. */
export function woodTexture(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;

  g.fillStyle = "#5a3316";
  g.fillRect(0, 0, 512, 512);

  // Grain. Each line wanders — dead-straight lines read as corduroy, not oak.
  for (let i = 0; i < 220; i++) {
    const y = Math.random() * 512;
    const dark = Math.random() > 0.5;
    g.strokeStyle = dark
      ? `rgba(40,22,8,${0.10 + Math.random() * 0.28})`
      : `rgba(150,96,44,${0.06 + Math.random() * 0.16})`;
    g.lineWidth = 0.6 + Math.random() * 2.6;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= 512; x += 16) {
      g.lineTo(x, y + Math.sin((x + i * 40) / 70) * 5 + (Math.random() - 0.5) * 2.5);
    }
    g.stroke();
  }

  // Knots — the thing the eye actually reads as "wood".
  for (let k = 0; k < 4; k++) {
    const kx = 60 + Math.random() * 400;
    const ky = 60 + Math.random() * 400;
    for (let r = 26; r > 0; r -= 2.2) {
      g.strokeStyle = `rgba(34,18,6,${0.06 + (26 - r) / 90})`;
      g.lineWidth = 1.4;
      g.beginPath();
      g.ellipse(kx, ky, r, r * 0.62, Math.random() * 0.5, 0, Math.PI * 2);
      g.stroke();
    }
  }
  return c;
}

/** The coin face: a one-gram bullion piece. Drawn, then mapped on. */
export function coinFace(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;

  const bg = g.createRadialGradient(180, 150, 15, 256, 256, 310);
  bg.addColorStop(0, "#fff4cf");
  bg.addColorStop(0.45, "#f0c463");
  bg.addColorStop(1, "#b8801f");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);

  // Engraving reads as depth because of the pair of offset strokes: a dark one
  // down-right and a light one up-left, which is what a cut in metal does to
  // light. Flat text would look printed on.
  const cut = (text: string, y: number, size: number, weight = "700", spacing = 0) => {
    g.textAlign = "center";
    g.font = `${weight} ${size}px Georgia, serif`;
    if (spacing) (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
    g.fillStyle = "rgba(70,40,8,0.85)";
    g.fillText(text, 258, y + 2.5);
    g.fillStyle = "rgba(255,246,214,0.6)";
    g.fillText(text, 254.5, y - 2);
    g.fillStyle = "rgba(104,60,14,0.95)";
    g.fillText(text, 256, y);
    if (spacing) (g as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = "0px";
  };

  // What a real one-gram coin carries: the weight, the metal, the fineness.
  // Nothing else. He was right that the rank belongs in the words underneath,
  // not stamped across the face.
  cut("1", 268, 172);
  cut("GRAM", 330, 56, "600", 4);
  cut("FINE GOLD", 380, 30, "500", 6);
  cut("999.9", 418, 26, "500", 3);

  g.strokeStyle = "rgba(96,54,12,0.42)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 256, 210, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(256, 256, 194, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 84; i++) {
    const a = (i / 84) * Math.PI * 2;
    g.fillStyle = "rgba(80,44,10,0.34)";
    g.beginPath();
    g.arc(256 + Math.cos(a) * 230, 256 + Math.sin(a) * 230, 4, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// ── sound ─────────────────────────────────────────────────────────────────
// Real recordings, not synthesis.
//
// He asked why I was not downloading them and he was right to — I had assumed
// the sandbox could not reach the internet and never checked. It can. These
// are Mixkit's free sound effects (Mixkit Free License: commercial use, no
// attribution required), picked BY NAME so each one is actually the thing it
// claims to be:
//
//   hit      Metal hammer hit
//   wood     Wood hard hit
//   shatter  Shatter shot explosion
//   thunder  Strong close thunder explosion
//   shock    Heavy electric shockwave impact
//   coin     Magic sweep game trophy
//
// Preloaded and pooled: a single Audio element cannot overlap with itself, so
// hitting twice quickly would cut the first blow off mid-strike. Three copies
// of each, used round-robin, and they can ring over one another the way real
// impacts do.

type Pool = { els: HTMLAudioElement[]; at: number };
const pools = new Map<string, Pool>();

function pool(name: string, volume: number): Pool | null {
  if (typeof window === "undefined") return null;
  let p = pools.get(name);
  if (!p) {
    p = {
      els: Array.from({ length: 3 }, () => {
        const a = new Audio(`/dev/sfx/${name}.mp3`);
        a.preload = "auto";
        a.volume = volume;
        return a;
      }),
      at: 0,
    };
    pools.set(name, p);
  }
  return p;
}

function play(name: string, volume = 0.8, rate = 1) {
  const p = pool(name, volume);
  if (!p) return;
  const el = p.els[p.at];
  p.at = (p.at + 1) % p.els.length;
  el.volume = volume;
  el.playbackRate = rate;
  try {
    el.currentTime = 0;
    void el.play();
  } catch {
    /* the browser will allow it after the first gesture */
  }
}

/** Warm the files up on the first gesture, so the first blow is not silent. */
export function primeSounds() {
  for (const [n, v] of [["hit", 0.7], ["wood", 0.7], ["shatter", 0.8], ["thunder", 0.7], ["shock", 0.6], ["coin", 0.6]] as const) {
    pool(n, v);
  }
}

/** Steel on wood. Harder blows are louder and pitched a touch lower. */
export function playHit(power = 1) {
  play("hit", Math.min(1, 0.55 * power), 1.06 - power * 0.08);
  play("wood", Math.min(1, 0.5 * power), 0.95);
}

/** The break: it comes apart, the sky answers, and the prize rings. */
export function playBreak() {
  play("shatter", 0.85, 0.95);
  play("shock", 0.7, 1);
  window.setTimeout(() => play("thunder", 0.8, 0.92), 90);
  window.setTimeout(() => play("coin", 0.65, 1), 620);
}
