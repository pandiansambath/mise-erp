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
  // 1024, not 512. The coin fills a good part of a laptop screen, and a 512px
  // texture stretched that far is the blur he spotted on the lettering.
  c.width = c.height = 1024;
  const g = c.getContext("2d")!;

  const bg = g.createRadialGradient(360, 300, 30, 512, 512, 620);
  bg.addColorStop(0, "#fff6d8");
  bg.addColorStop(0.4, "#f2c765");
  bg.addColorStop(0.78, "#c98f2c");
  bg.addColorStop(1, "#8f5f14");
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 1024);

  // Engraving reads as depth because of the pair of offset strokes: a dark one
  // down-right and a light one up-left, which is what a cut in metal does to
  // light. Flat text would look printed on.
  const cut = (text: string, y: number, size: number, weight = "700", spacing = 0) => {
    g.textAlign = "center";
    g.font = `${weight} ${size}px Georgia, "Times New Roman", serif`;
    const ls = g as CanvasRenderingContext2D & { letterSpacing?: string };
    if (spacing) ls.letterSpacing = `${spacing}px`;
    g.fillStyle = "rgba(58,32,4,0.9)";
    g.fillText(text, 517, y + 5);
    g.fillStyle = "rgba(255,250,225,0.75)";
    g.fillText(text, 508, y - 4);
    g.fillStyle = "rgba(120,72,14,0.96)";
    g.fillText(text, 512, y);
    if (spacing) ls.letterSpacing = "0px";
  };

  // The weight and the metal. Nothing else — the fineness line was one thing
  // too many on a face this size, and he was right that it read as clutter.
  cut("1", 530, 340);
  cut("GRAM", 650, 108, "600", 8);
  cut("FINE GOLD", 730, 52, "500", 12);

  g.strokeStyle = "rgba(110,64,10,0.5)";
  g.lineWidth = 9;
  g.beginPath();
  g.arc(512, 512, 424, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(512, 512, 392, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    g.fillStyle = "rgba(92,52,8,0.4)";
    g.beginPath();
    g.arc(512 + Math.cos(a) * 462, 512 + Math.sin(a) * 462, 7, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** The room the metal reflects.
 *
 *  This is the single biggest thing separating gold from a yellow circle.
 *  Metal has almost no colour of its own — what you read as "gold" is mostly
 *  the ENVIRONMENT bent around a curved surface. Without something to reflect,
 *  a metalness:1 material renders nearly black and has to be faked with
 *  emissive, which is exactly why it looked flat and plastic.
 *
 *  A bright band near the horizon, warm ground below, deep sky above — the
 *  cheapest possible studio, and enough for the highlight to travel properly
 *  as the coin turns. */
export function studioEnv(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d")!;
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#10161f");
  sky.addColorStop(0.36, "#4a3a24");
  sky.addColorStop(0.47, "#fff0cc");   // the light source, a band not a dot
  sky.addColorStop(0.53, "#ffe0a0");
  sky.addColorStop(0.66, "#3a2a16");
  sky.addColorStop(1, "#0a0806");
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);
  // Two soft lamps, so the surface has more than one thing to catch.
  for (const [x, r, a] of [[130, 70, 0.85], [370, 52, 0.6]] as const) {
    const lamp = g.createRadialGradient(x, 118, 2, x, 118, r);
    lamp.addColorStop(0, `rgba(255,246,222,${a})`);
    lamp.addColorStop(1, "rgba(255,246,222,0)");
    g.fillStyle = lamp;
    g.fillRect(x - r, 118 - r, r * 2, r * 2);
  }
  return c;
}

// ── sound ─────────────────────────────────────────────────────────────────
// Decoded up front and played from memory.
//
// The delay he heard was not the recordings — it was WHEN they were fetched.
// `primeSounds()` ran on the first CLICK, so the first blow kicked off the
// download and tried to play it in the same instant. 686KB later, the clang
// arrived. Worse, an <audio> element decodes on demand, so even a cached file
// costs tens of milliseconds before the first sample — enough to feel wrong on
// something that is supposed to land WITH the hammer.
//
// So: fetch and decode into AudioBuffers as soon as the scene mounts, long
// before anybody swings. Playing one is then just wiring a BufferSource to the
// output and calling start() — no I/O, no decode, sample-accurate.
//
// Browsers will happily DOWNLOAD without a gesture; they only refuse to make
// noise. So the context is created suspended and resumed on the first click,
// which is a gesture we already have.
//
// Recordings are Mixkit's free sound effects (Mixkit Free License: commercial
// use, no attribution required), picked BY NAME so each is what it claims:
//   hit  Metal hammer hit · wood  Wood hard hit · shatter  Shatter shot
//   thunder  Strong close thunder · shock  Heavy electric shockwave
//   coin  Magic sweep game trophy

type Sfx = "hit" | "wood" | "shatter" | "thunder" | "shock" | "coin";
const NAMES: Sfx[] = ["hit", "wood", "shatter", "thunder", "shock", "coin"];

let ctx: AudioContext | null = null;
const buffers = new Map<Sfx, AudioBuffer>();
// <audio> fallback for anything without WebAudio; still better than nothing.
const tags = new Map<Sfx, HTMLAudioElement>();
let warming: Promise<void> | null = null;

function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

/** Fetch and decode everything. Call it when the scene mounts, not on click. */
export function primeSounds(): Promise<void> {
  if (warming) return warming;
  warming = (async () => {
    const a = audioCtx();
    await Promise.all(
      NAMES.map(async (n) => {
        const url = `/dev/sfx/${n}.mp3`;
        try {
          if (a) {
            const res = await fetch(url);
            const raw = await res.arrayBuffer();
            buffers.set(n, await a.decodeAudioData(raw));
            return;
          }
        } catch {
          /* fall through to the tag */
        }
        const el = new Audio(url);
        el.preload = "auto";
        el.load();
        tags.set(n, el);
      }),
    );
  })();
  return warming;
}

/** Browsers refuse audio until a gesture. The hammer IS the gesture. */
export function unlockSound() {
  const a = audioCtx();
  if (a && a.state === "suspended") void a.resume();
}

function play(name: Sfx, volume = 0.8, rate = 1, delay = 0) {
  const a = audioCtx();
  const buf = buffers.get(name);
  if (a && buf) {
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = a.createGain();
    g.gain.value = volume;
    src.connect(g).connect(a.destination);
    // Every blow gets its OWN source node, so rapid hits ring over each other
    // instead of cutting one another off the way a single element would.
    src.start(a.currentTime + delay);
    return;
  }
  const el = tags.get(name);
  if (!el) return;
  const clone = el.cloneNode() as HTMLAudioElement;
  clone.volume = volume;
  clone.playbackRate = rate;
  window.setTimeout(() => void clone.play().catch(() => {}), delay * 1000);
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
  // Scheduled on the audio clock rather than with setTimeout, so the thunder
  // lands exactly 90ms after the crack instead of whenever the main thread
  // next gets a turn.
  play("thunder", 0.8, 0.92, 0.09);
  play("coin", 0.65, 1, 0.62);
}
