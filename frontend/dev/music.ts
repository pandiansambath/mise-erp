"use client";

// The site's music.
//
//   "i need a soothing music to play in my website… continuously… from one
//    music ending to start of next song have a fading effect… mute button…
//    when we enter the album section these songs need to play from the
//    starting as fresh then continue in loop… volume control"
//
// His playlist lives in music.json (dev-site/, written from the owner panel):
// each song plays on the landing page, in the album, or both, in his order,
// at his default volume. Two audio elements take turns so one song can fade
// out while the next fades in — and a single song fades into itself at the
// loop, so there is never a hard cut or a silent gap.
//
// Volume and the fades go through WebAudio gain nodes, because phones ignore
// an <audio> element's own volume. A visitor's mute and volume are remembered
// on their device. Nothing plays until a tap (the intro's ENTER): browsers
// refuse sound before one, and so should a polite site.

export type Track = { id: string; title: string; file: string; scope: "landing" | "album" | "both" };
export type MusicManifest = { tracks: Track[]; volume: number };
type Mode = "landing" | "album";

const FADE = 2.4; // seconds of crossfade
const STORE = "pandi-dev:sound";

const src = (t: Track) => `/api/dev-site/music/${t.file}`;

/** The award room's track (his pick, 22 Nov), in the bucket beside the songs.
 *  Fetched during the intro so the room opens with it ready. */
export const AWARD_TRACK = "/api/dev-site/music/award-ancient-empire.mp3";

type Listener = () => void;

class Player {
  manifest: MusicManifest;
  mode: Mode = "landing";
  index = 0;
  volume: number;
  muted = false;
  started = false;
  private els: HTMLAudioElement[] = [];
  private gains: GainNode[] = [];
  private master: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private active = 0;
  private fading = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();

  constructor(manifest: MusicManifest) {
    this.manifest = manifest;
    this.volume = manifest.volume ?? 0.6;
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { muted?: boolean; volume?: number } | null;
      if (saved) {
        this.muted = !!saved.muted;
        if (typeof saved.volume === "number") this.volume = Math.min(1, Math.max(0, saved.volume));
      }
    } catch {
      /* storage blocked: defaults */
    }
    for (let i = 0; i < 2; i++) {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      this.els.push(el);
    }
  }

  playlist(mode = this.mode): Track[] {
    return this.manifest.tracks.filter((t) => t.scope === "both" || t.scope === mode);
  }

  get track(): Track | null {
    const list = this.playlist();
    return list.length ? list[this.index % list.length] : null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  private remember() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ muted: this.muted, volume: this.volume }));
    } catch {
      /* fine */
    }
  }

  /** Load the first song into the cache during the intro. */
  preload(timeout = 9000): Promise<void> {
    const first = this.playlist("landing")[0];
    if (!first) return Promise.resolve();
    const el = this.els[0];
    el.src = src(first);
    return new Promise((resolve) => {
      const done = () => resolve();
      el.addEventListener("canplaythrough", done, { once: true });
      el.addEventListener("error", done, { once: true });
      setTimeout(done, timeout);
      el.load();
    });
  }

  /** The first tap. Builds the audio graph and starts the landing playlist. */
  start() {
    if (this.started || !this.playlist().length) return;
    this.started = true;
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(this.ctx.destination);
        for (const el of this.els) {
          const g = this.ctx.createGain();
          g.gain.value = 0;
          this.ctx.createMediaElementSource(el).connect(g).connect(this.master);
          this.gains.push(g);
        }
        void this.ctx.resume();
      }
    } catch {
      this.ctx = null;
    }
    this.playOn(this.active, this.track!, 1.2);
    this.timer = setInterval(() => this.watch(), 250);
    this.emit();
  }

  private setGain(i: number, to: number, seconds: number) {
    const g = this.gains[i];
    if (this.ctx && g) {
      const now = this.ctx.currentTime;
      g.gain.cancelScheduledValues(now);
      g.gain.setValueAtTime(g.gain.value, now);
      g.gain.linearRampToValueAtTime(to, now + seconds);
      return;
    }
    // No WebAudio: step the element's own volume.
    const el = this.els[i];
    const from = el.volume;
    const base = this.muted ? 0 : this.volume;
    const steps = Math.max(1, Math.round(seconds * 20));
    let k = 0;
    const id = setInterval(() => {
      k += 1;
      el.volume = Math.min(1, Math.max(0, (from + ((to * base - from) * k) / steps)));
      if (k >= steps) clearInterval(id);
    }, 50);
  }

  private playOn(i: number, t: Track, fadeIn: number) {
    const el = this.els[i];
    const want = src(t);
    if (!el.src.endsWith(want)) el.src = want;
    el.currentTime = 0;
    if (!this.ctx) el.volume = 0;
    void el.play().catch(() => {});
    this.setGain(i, 1, fadeIn);
  }

  /** Crossfade from the playing element to `t` on the other one. */
  private crossTo(t: Track) {
    const from = this.active;
    const to = 1 - from;
    this.fading = true;
    this.playOn(to, t, FADE);
    this.setGain(from, 0, FADE);
    this.active = to;
    setTimeout(() => {
      this.els[from].pause();
      this.fading = false;
    }, FADE * 1000 + 100);
    this.emit();
  }

  private watch() {
    const el = this.els[this.active];
    if (this.fading || !el.duration || Number.isNaN(el.duration)) return;
    if (el.duration - el.currentTime <= FADE + 0.15) this.next();
  }

  next() {
    const list = this.playlist();
    if (!list.length || !this.started) return;
    this.index = (this.index + 1) % list.length;
    this.crossTo(list[this.index]);
  }

  /** The album starts its playlist fresh; leaving it starts the landing one. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.index = 0;
    const t = this.track;
    if (this.started && t) this.crossTo(t);
    this.emit();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) {
      const now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(m ? 0 : this.volume, now + 0.4);
    } else {
      for (const el of this.els) el.volume = m ? 0 : this.volume;
    }
    if (!m && !this.started) this.start();
    this.remember();
    this.emit();
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    else for (const el of this.els) el.volume = this.muted ? 0 : this.volume;
    this.remember();
    this.emit();
  }

  /** New songs or order from the owner panel. */
  replace(manifest: MusicManifest) {
    this.manifest = manifest;
    this.index = 0;
    if (this.started && this.track) this.crossTo(this.track);
    this.emit();
  }

  /** Leaving the page (the award room has its own score). */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (let i = 0; i < this.els.length; i++) this.setGain(i, 0, 0.8);
    setTimeout(() => this.els.forEach((el) => el.pause()), 900);
    setTimeout(() => void this.ctx?.close().catch(() => {}), 1000);
    this.started = false;
    this.ctx = null;
    this.gains = [];
    this.master = null;
  }
}

let player: Player | null = null;

export function getPlayer(manifest: MusicManifest | null): Player | null {
  if (typeof window === "undefined" || !manifest || !manifest.tracks.length) return null;
  if (!player) player = new Player(manifest);
  return player;
}

export function releasePlayer() {
  player?.stop();
  player = null;
}

export type { Player };

/** Shared with the award room so one mute rules every page. */
export function soundMuted(): boolean {
  try {
    return !!(JSON.parse(localStorage.getItem(STORE) ?? "null") as { muted?: boolean } | null)?.muted;
  } catch {
    return false;
  }
}

export function setSoundMuted(m: boolean) {
  try {
    const saved = (JSON.parse(localStorage.getItem(STORE) ?? "null") as Record<string, unknown> | null) ?? {};
    localStorage.setItem(STORE, JSON.stringify({ ...saved, muted: m }));
  } catch {
    /* fine */
  }
}
