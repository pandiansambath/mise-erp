"use client";

// The award room's music: generated, not downloaded.
//
//   "add an ancient feel kinda music to play background (have a button to
//    mute music)"
//
// Built from WebAudio parts, so it is ready the instant the room opens and
// carries no licence: a tanpura-like drone cycling Pa–Sa–Sa–Sa on D, a
// bansuri-like flute wandering a pentatonic raga (Bhupali: Sa Re Ga Pa Dha)
// with breath and late vibrato, a soft frame drum every few bars, all sent
// through a long generated reverb, like a stone hall. Quiet by design.

const SA = 146.83; // D3
const RAGA = [0, 2, 4, 7, 9, 12, 14, 16]; // semitones above Sa: S R G P D S' R' G'

const hz = (semis: number, base = SA) => base * Math.pow(2, semis / 12);

function reverb(ctx: AudioContext, seconds = 4.5) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const node = ctx.createConvolver();
  node.buffer = buf;
  return node;
}

export type Score = { setMuted: (m: boolean) => void; stop: () => void };

export function startAncient(ctx: AudioContext, muted: boolean, level = 0.32): Score {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  const hall = reverb(ctx);
  wet.connect(hall).connect(master);
  const dry = ctx.createGain();
  dry.gain.value = 0.6;
  dry.connect(master);
  const send = (node: AudioNode) => {
    node.connect(dry);
    node.connect(wet);
  };

  // A plucked string: a bright saw, darkened by a closing filter.
  const pluck = (f: number, when: number, gain = 0.06, length = 3.2) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, when);
    lp.frequency.exponentialRampToValueAtTime(380, when + length * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, when + length);
    o.connect(lp).connect(g);
    send(g);
    o.start(when);
    o.stop(when + length + 0.1);
  };

  // A breathy flute note with vibrato arriving late, as players do.
  const flute = (f: number, when: number, dur: number, gain = 0.05) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = f;
    const o2 = ctx.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = f * 2;
    const g2 = ctx.createGain();
    g2.gain.value = 0.18;
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vibAmt = ctx.createGain();
    vibAmt.gain.setValueAtTime(0, when);
    vibAmt.gain.linearRampToValueAtTime(f * 0.012, when + Math.min(dur * 0.6, 1.2));
    vib.connect(vibAmt).connect(o.frequency);
    vibAmt.connect(o2.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.35);
    g.gain.setValueAtTime(gain, when + dur - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g);
    o2.connect(g2).connect(g);
    // Breath: filtered noise riding the note.
    const noise = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    noise.buffer = nb;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f * 3;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.value = gain * 0.25;
    noise.connect(bp).connect(ng).connect(g);
    send(g);
    for (const n of [o, o2, vib, noise]) {
      n.start(when);
      n.stop(when + dur + 0.1);
    }
  };

  // A frame drum: a falling low tone with a skin of noise.
  const drum = (when: number, gain = 0.14) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(120, when);
    o.frequency.exponentialRampToValueAtTime(48, when + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.6);
    o.connect(g);
    send(g);
    o.start(when);
    o.stop(when + 0.7);
  };

  // Scheduler: a look-ahead loop placing notes on the audio clock.
  let next = ctx.currentTime + 0.3;
  let bar = 0;
  let note = 3; // start on Pa
  const drone = [hz(-5), hz(0), hz(0), hz(-12)]; // Pa, Sa, Sa, low Sa
  const tick = () => {
    while (next < ctx.currentTime + 1.2) {
      // The drone cycle: four strings, 0.85 s apart.
      drone.forEach((f, k) => pluck(f, next + k * 0.85, k === 3 ? 0.07 : 0.05, 3.6));
      // A flute phrase on most cycles, walking the raga by small steps.
      if (bar % 4 !== 3) {
        let t = next + 0.4;
        const phrase = 2 + Math.floor(Math.random() * 3);
        for (let k = 0; k < phrase; k++) {
          note = Math.max(0, Math.min(RAGA.length - 1, note + [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)]));
          const dur = 0.9 + Math.random() * 1.4;
          flute(hz(RAGA[note]), t, dur);
          t += dur * 0.85;
        }
      }
      if (bar % 2 === 0) {
        drum(next);
        drum(next + 1.7, 0.08);
      }
      next += 3.4;
      bar += 1;
    }
  };
  tick();
  const id = setInterval(tick, 400);

  const set = (m: boolean) => {
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(m ? 0 : level, now + 1.2);
  };
  set(muted);

  return {
    setMuted: set,
    stop: () => {
      clearInterval(id);
      set(true);
      setTimeout(() => master.disconnect(), 1500);
    },
  };
}
