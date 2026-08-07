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

/** The medal face: rank, the word, and the mark. Drawn, then mapped on. */
export function medalFace(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d")!;

  const bg = g.createRadialGradient(190, 160, 20, 256, 256, 300);
  bg.addColorStop(0, "#ffe6ad");
  bg.addColorStop(0.5, "#e0a63f");
  bg.addColorStop(1, "#a86a1f");
  g.fillStyle = bg;
  g.fillRect(0, 0, 512, 512);

  // Engraving reads as depth because of the pair of offset strokes: a dark
  // one down-right and a light one up-left, which is what a cut in metal does
  // to light. Flat text would look printed on.
  const cut = (text: string, y: number, size: number, weight = "700") => {
    g.textAlign = "center";
    g.font = `${weight} ${size}px Georgia, serif`;
    g.fillStyle = "rgba(60,32,8,0.85)";
    g.fillText(text, 258, y + 2.5);
    g.fillStyle = "rgba(255,242,205,0.6)";
    g.fillText(text, 254.5, y - 2);
    g.fillStyle = "rgba(96,54,14,0.95)";
    g.fillText(text, 256, y);
  };

  // Sparse, the way a bullion coin is marked. He asked for it: a real 1-gram
  // piece carries a figure and a word, not a paragraph. The rest of the story
  // is written under the case, where there is room for it.
  cut("17", 292, 190);
  cut("RANK", 356, 46, "500");

  // Two rings and a bead course — the framing that makes it read as struck
  // rather than printed.
  g.strokeStyle = "rgba(88,48,12,0.45)";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(256, 256, 208, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 2;
  g.beginPath();
  g.arc(256, 256, 192, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    g.fillStyle = "rgba(70,38,10,0.38)";
    g.beginPath();
    g.arc(256 + Math.cos(a) * 228, 256 + Math.sin(a) * 228, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

// ── sound ─────────────────────────────────────────────────────────────────
// Synthesised, and created on the first CLICK — browsers refuse to start
// audio before a gesture, and a hammer blow is exactly the gesture.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function noise(a: AudioContext, seconds: number) {
  const buf = a.createBuffer(1, a.sampleRate * seconds, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.createBufferSource();
  src.buffer = buf;
  return src;
}

/** Steel on wood: a bright transient, then a short body. */
export function playHit(power = 1) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;

  // The strike itself — filtered noise, gone in a tenth of a second.
  const src = noise(a, 0.25);
  const bp = a.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 2200 * power;
  bp.Q.value = 1.1;
  const gn = a.createGain();
  gn.gain.setValueAtTime(0.55 * power, t);
  gn.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  src.connect(bp).connect(gn).connect(a.destination);
  src.start(t);

  // The wood answering underneath it.
  const osc = a.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(150, t);
  osc.frequency.exponentialRampToValueAtTime(58, t + 0.18);
  const og = a.createGain();
  og.gain.setValueAtTime(0.4 * power, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  osc.connect(og).connect(a.destination);
  osc.start(t);
  osc.stop(t + 0.32);
}

/** The break: a crack, then thunder rolling off. */
export function playBreak() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;

  // Splintering: three short cracks a few milliseconds apart. One crack is a
  // door closing; three overlapping is something coming apart.
  for (let i = 0; i < 3; i++) {
    const at = t + i * 0.045;
    const crack = noise(a, 0.35);
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400 + i * 900;
    bp.Q.value = 0.8;
    const cg = a.createGain();
    cg.gain.setValueAtTime(0.75 - i * 0.15, at);
    cg.gain.exponentialRampToValueAtTime(0.001, at + 0.3);
    crack.connect(bp).connect(cg).connect(a.destination);
    crack.start(at);
  }

  // The strike of lightning: a hard, bright snap on top of the thunder.
  const snap = noise(a, 0.25);
  const sh = a.createBiquadFilter();
  sh.type = "highpass";
  sh.frequency.value = 2600;
  const sg = a.createGain();
  sg.gain.setValueAtTime(0.9, t);
  sg.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  snap.connect(sh).connect(sg).connect(a.destination);
  snap.start(t);

  // Thunder: low noise with the top rolled off, rolling away for three
  // seconds. The long tail is what makes it read as distance rather than
  // as a thud.
  const rumble = noise(a, 3.2);
  const lp = a.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(560, t);
  lp.frequency.exponentialRampToValueAtTime(70, t + 2.6);
  const rg = a.createGain();
  rg.gain.setValueAtTime(0.001, t);
  rg.gain.exponentialRampToValueAtTime(0.85, t + 0.07);
  rg.gain.exponentialRampToValueAtTime(0.28, t + 0.9);
  rg.gain.exponentialRampToValueAtTime(0.001, t + 3.0);
  rumble.connect(lp).connect(rg).connect(a.destination);
  rumble.start(t);

  // And a chord, so the reveal has somewhere to land.
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = a.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const g = a.createGain();
    const at = t + 0.42 + i * 0.06;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.14, at + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, at + 2.6);
    o.connect(g).connect(a.destination);
    o.start(at);
    o.stop(at + 2.7);
  });
}
