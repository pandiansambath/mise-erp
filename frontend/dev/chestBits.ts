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
// Where each sound's IMPACT is, in seconds from its start (§102.1: "no delay
// to sound hitting"). The files were cut with lead-ins — the shock's boom is
// 2.7 s in, the thunder's crack 0.4 s, the wood's knock 26 ms — and an MP3
// decodes with ~25 ms of encoder padding in front. Playback starts AT the
// impact, so every blow is heard on the frame it is drawn.
const attack = new Map<Sfx, number>();

/** The first moment the sound reaches 30% of its peak, less a hair of attack. */
function attackOf(buf: AudioBuffer): number {
  const ch = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < ch.length; i++) {
    const v = Math.abs(ch[i]);
    if (v > peak) peak = v;
  }
  const th = peak * 0.3;
  for (let i = 0; i < ch.length; i++) if (Math.abs(ch[i]) > th) return Math.max(0, i / buf.sampleRate - 0.008);
  return 0;
}
// <audio> fallback for anything without WebAudio; still better than nothing.
const tags = new Map<Sfx, HTMLAudioElement>();
let warming: Promise<void> | null = null;

/** One AudioContext for the room: the blows and the music share it. */
export function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
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
            const buf = await a.decodeAudioData(raw);
            buffers.set(n, buf);
            attack.set(n, attackOf(buf));
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

/** How long the speakers take to sound what the context plays (the device's
 *  output latency and the context's own): taken off a sound scheduled AHEAD,
 *  so it is heard on the frame it is meant for (§102.1: "no delay to sound
 *  hitting and animation"). A sound for now cannot be helped. */
function lead(a: AudioContext): number {
  return (a.outputLatency || 0) + (a.baseLatency || 0);
}

/** Where many loud things at once go: held together, never over the top (a soft limiter). */
let held: AudioNode | null = null;
function hold(a: AudioContext): AudioNode {
  if (held && held.context === a) return held;
  const c = a.createDynamicsCompressor();
  c.threshold.value = -14;
  c.knee.value = 6;
  c.ratio.value = 5;
  c.attack.value = 0.002;
  c.release.value = 0.18;
  c.connect(a.destination);
  return (held = c);
}

/** `soft`: without its highs, above so many Hz; `together`: one of many at once. */
function play(name: Sfx, volume = 0.8, rate = 1, delay = 0, soft = 0, together = false) {
  const a = audioCtx();
  const buf = buffers.get(name);
  if (a && buf) {
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = a.createGain();
    g.gain.value = volume;
    let from: AudioNode = src;
    if (soft) {
      const f = a.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = soft;
      from = src.connect(f);
    }
    from.connect(g).connect(together ? hold(a) : a.destination);
    // Every blow gets its OWN source node, so rapid hits ring over each other
    // instead of cutting one another off the way a single element would —
    // and it starts at its impact, not at the top of the file.
    src.start(a.currentTime + Math.max(0, delay - (delay > 0 ? lead(a) : 0)), attack.get(name) ?? 0);
    return;
  }
  const el = tags.get(name);
  if (!el) return;
  const clone = el.cloneNode() as HTMLAudioElement;
  clone.volume = volume;
  clone.playbackRate = rate;
  clone.currentTime = attack.get(name) ?? 0;
  window.setTimeout(() => void clone.play().catch(() => {}), delay * 1000);
}

/** Steel on wood. Harder blows are louder and pitched a touch lower. `delay`:
 *  seconds until the hammer lands (it is scheduled to be heard then). */
export function playHit(power = 1, delay = 0) {
  play("hit", Math.min(1, 0.55 * power), 1.06 - power * 0.08, delay);
  play("wood", Math.min(1, 0.5 * power), 0.95, delay);
}

/** Iron landing on the floor: short and bright, quieter the softer it lands. */
export function playClank(power = 1) {
  play("hit", Math.min(0.7, 0.32 * power), 1.38);
}

/** A gold coin on stone: small and bright, never two the same. */
export function playClink(power = 1) {
  play("coin", Math.min(0.3, 0.14 * power), 1.45 + Math.random() * 0.6);
}

/** A wick catching: a soft rush of air, and it is alight. Made here, quiet. */
export function playFire(power = 1) {
  const a = audioCtx();
  if (!a || a.state !== "running") return;
  const n = Math.floor(a.sampleRate * 0.7);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / a.sampleRate;
    low += (Math.random() * 2 - 1 - low) * 0.12;
    const puff = Math.min(1, t / 0.05) * Math.exp(-t * 6.5);
    const crackle = Math.random() < 0.0012 ? (Math.random() - 0.5) * 1.6 * Math.exp(-t * 2) : 0;
    d[i] = low * 2.6 * puff + crackle * 0.3;
  }
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.value = 1500;
  const g = a.createGain();
  g.gain.value = 0.3 * power;
  src.connect(f).connect(g).connect(a.destination);
  src.start();
}

/** The break: the wood gives, it comes apart, the sky answers far off, and the prize rings.
 *  Measured against a blow (§107: "that burst sound is too very high; please maintain balance"):
 *  it was 11 dB over a strong one, and clipped; it is 3–4 over it now, its weight in the lows. */
export function playBreak(delay = 0) {
  play("wood", 0.8, 0.72, delay, 0, true);
  play("shatter", 0.2, 0.86, delay + 0.01, 5200, true);
  play("shock", 0.12, 0.92, delay, 900, true);
  // Scheduled on the audio clock rather than with setTimeout, so the thunder
  // lands exactly 100ms after the crack instead of whenever the main thread
  // next gets a turn.
  play("thunder", 0.15, 0.82, delay + 0.1, 900, true);
  play("coin", 0.22, 0.94, delay + 0.7, 0, true);
}
