// The skeleton's breaking, to the ear (§104.3): made here, no recording. Only while the
// site's music is playing — somebody who has it off, or has not begun it, hears nothing.

import { pageVoice } from "./music";
import { BEATS, BREAK } from "./spineBreak";

let hiss: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (hiss && hiss.sampleRate === ctx.sampleRate) return hiss;
  hiss = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = hiss.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return hiss;
}

export function playBreak() {
  const v = pageVoice();
  if (!v) return;
  const { ctx, out } = v;
  const t0 = ctx.currentTime + 0.01;
  const bus = ctx.createGain();
  bus.gain.value = 0.85;
  bus.connect(out);
  window.setTimeout(() => bus.disconnect(), (BREAK.done + 2) * 1000);
  const buf = noise(ctx);
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const env = (at: number, peak: number, attack: number, decay: number) => {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(bus);
    return g;
  };
  const burst = (at: number, f: number, q: number, peak: number, decay: number, type: BiquadFilterType = "bandpass") => {
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    s.connect(b).connect(env(at, peak, 0.002, decay));
    s.start(at, Math.random() * 1.5, decay + 0.1);
    return b;
  };
  const tone = (at: number, f0: number, f1: number, peak: number, attack: number, decay: number, type: OscillatorType = "sine") => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + attack + decay);
    o.connect(env(at, peak, attack, decay));
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  };
  // It cracks: dry ticks, closer and closer together.
  for (let i = 0; i < 22; i++) {
    const at = t0 + BREAK.first * (1 - Math.pow(1 - i / 22, 1.8)) + rnd(0, 0.02);
    burst(at, rnd(1500, 5200), rnd(2, 9), rnd(0.05, 0.24) * (0.5 + i / 30), rnd(0.018, 0.07));
    if (i % 5 === 0) tone(at, rnd(190, 260), 80, 0.09, 0.003, 0.09, "triangle");
  }
  // It bursts: a body, a breaking, and crystal falling.
  const b0 = t0 + BREAK.first;
  tone(b0, 128, 36, 0.75, 0.004, 0.75);
  const low = burst(b0, 7000, 0.4, 0.55, 1.1, "lowpass");
  low.frequency.setValueAtTime(8500, b0);
  low.frequency.exponentialRampToValueAtTime(500, b0 + 1);
  for (let i = 0; i < 9; i++) burst(b0 + i * BREAK.run + rnd(0, 0.03), rnd(700, 2600), 1.2, 0.2 * Math.exp(-i * 0.18), rnd(0.12, 0.3));
  for (let i = 0; i < 34; i++) {
    const at = b0 + 0.03 + Math.pow(Math.random(), 1.7) * 1.7;
    const f = rnd(2100, 7600);
    tone(at, f, f * 0.985, rnd(0.008, 0.035), 0.002, rnd(0.12, 0.55));
  }
  // The dark; and a heart in it.
  tone(b0 + 0.5, 58, 41, 0.1, 0.4, 1.6);
  for (const [t, k] of BEATS) {
    tone(t0 + t - 0.05, 74, 40, 0.5 * k, 0.018, 0.2);
    burst(t0 + t - 0.05, 160, 0.8, 0.07 * k, 0.12, "lowpass");
  }
  // They come home: a breath drawn in, shards rising in it, and a last soft ringing.
  const c0 = t0 + BREAK.rest;
  const s = ctx.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 1.6;
  f.frequency.setValueAtTime(300, c0);
  f.frequency.exponentialRampToValueAtTime(4200, c0 + 2.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, c0);
  g.gain.exponentialRampToValueAtTime(0.1, c0 + 1.9);
  g.gain.exponentialRampToValueAtTime(0.0001, c0 + 2.6);
  s.connect(f).connect(g).connect(bus);
  s.start(c0);
  s.stop(c0 + 2.7);
  for (let i = 0; i < 26; i++) {
    const at = c0 + 0.5 + (i / 26) * 1.9 + rnd(0, 0.06);
    const p = rnd(1800, 5200) * (0.7 + i / 60);
    tone(at, p, p * 1.02, 0.006 + 0.016 * (i / 26), 0.04, rnd(0.1, 0.3));
    if (i % 3 === 0) burst(at + 0.04, rnd(2400, 4800), 6, 0.05, 0.03);
  }
  const e0 = c0 + 2.35;
  [220, 330, 440, 660, 990].forEach((h, i) => tone(e0 + i * 0.03, h, h, 0.05 / (1 + i * 0.35), 0.12, 2.4));
}
