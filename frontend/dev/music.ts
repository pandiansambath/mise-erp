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
// at his default volume. Every song fades in at its start and fades out at its
// end, and between songs there is a short quiet before the next fades in —
// a single song too, each time it comes round again:
//   "when playing a song have a fade in at the start and a fade out at the
//    end… if multiple songs, a fade in, fade out with a small gap in between…
//    even for a single song, it will play in a loop, so follow it too"
// Two audio elements take turns, so the next song loads during the fade-out
// and the quiet is the same length every time.
//
// Volume and the fades go through WebAudio gain nodes, because phones ignore
// an <audio> element's own volume. A visitor's mute and volume are remembered
// on their device. A browser refuses sound before the visitor has touched the
// page, and since the site opens by itself (§103.10) nothing is pressed on the
// way in: so the music begins with the FIRST touch, click or key anywhere — or
// at once, where the browser allows it (it trusts a site one often plays).

export type Track = { id: string; title: string; file: string; scope: "landing" | "album" | "both" };
export type MusicManifest = { tracks: Track[]; volume: number };
type Mode = "landing" | "album";

const FADE_IN = 2.6; // seconds, at the start of every song
const FADE_OUT = 3.2; // seconds, at its end
const GAP = 1.4; // seconds of quiet between one song and the next
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
  private handTimer: ReturnType<typeof setTimeout> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<Listener>();
  private disarm: (() => void) | null = null;

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

  /** From the first touch, click or key on: wherever it lands. */
  arm() {
    if (this.started || this.disarm || typeof window === "undefined") return;
    const kinds = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
    const on = (e: Event) => {
      // Not one a browser counts as a touch (the end of a scroll, a stray key)…
      const ua = navigator.userActivation;
      if (ua && !ua.isActive) return;
      // …nor one on the sound's own buttons, which say for themselves.
      if ((e.target as Element | null)?.closest?.("[data-sound]")) return;
      this.start();
    };
    for (const k of kinds) window.addEventListener(k, on, { capture: true, passive: true });
    window.setTimeout(() => {
      if (this.disarm && this.playlist().length) this.graph();
    }, 350);
    this.disarm = () => {
      for (const k of kinds) window.removeEventListener(k, on, { capture: true });
      this.disarm = null;
    };
  }

  /** The site has opened: music at once if the browser will have it, else armed. */
  wake() {
    if (this.started || !this.playlist().length) return;
    this.arm();
    if (navigator.userActivation?.hasBeenActive) {
      this.start();
      return;
    }
    const el = this.els[this.active];
    const t = this.track;
    if (!t) return;
    if (!el.src.endsWith(src(t))) el.src = src(t);
    el.volume = 0;
    const back = () => {
      if (!this.started) el.volume = 1;
    };
    void el
      .play()
      .then(() => {
        if (this.started) return;
        el.pause();
        back();
        this.start();
      })
      .catch(back);
  }

  /** The bars: sound off, or on (from the first press, if nothing has played yet). */
  toggle() {
    this.setMuted(this.started ? !this.muted : false);
  }

  /** Builds the audio graph and starts the landing playlist. */
  start() {
    if (this.started || !this.playlist().length) return;
    this.started = true;
    this.disarm?.();
    this.graph();
    void this.ctx?.resume();
    if (this.ctx) for (const el of this.els) el.volume = 1;
    this.playOn(this.active, this.track!, FADE_IN, () => {
      // Refused after all (a touch that did not count): wait for the next one.
      this.started = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.arm();
      this.emit();
    });
    this.timer = setInterval(() => this.watch(), 250);
    this.emit();
  }

  /** The audio graph, once. The first one a page asks for starts the browser's whole
   *  sound system: 0.2 s on a good day and 1.9 s on his laptop on a bad one, all of it
   *  with the page standing still. So it is asked for while the page loads (arm), not
   *  in the touch that starts the music, and never in the opening. */
  private graph() {
    if (this.ctx) return;
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
      }
    } catch {
      this.ctx = null;
    }
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

  private playOn(i: number, t: Track, fadeIn: number, refused?: () => void) {
    const el = this.els[i];
    const want = src(t);
    if (!el.src.endsWith(want)) el.src = want;
    el.currentTime = 0;
    if (!this.ctx) el.volume = 0;
    void el.play().catch((e: unknown) => {
      if ((e as { name?: string } | null)?.name === "NotAllowedError") refused?.();
    });
    this.setGain(i, 1, fadeIn);
  }

  /** Fade the playing song out, a short quiet, then `t` fades in on the other
   *  element (loaded meanwhile). `quick` for switches he makes himself — the
   *  album opening, a new playlist — which should not take four seconds. */
  private handOver(t: Track, quick = false) {
    const from = this.active;
    const to = 1 - from;
    const out = quick ? 0.9 : FADE_OUT;
    const quiet = quick ? 0.25 : GAP;
    this.fading = true;
    this.setGain(from, 0, out);
    const next = this.els[to];
    const want = src(t);
    if (!next.src.endsWith(want)) {
      next.src = want;
      next.load();
    }
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = setTimeout(() => {
      this.handTimer = null;
      this.els[from].pause();
      this.active = to;
      this.playOn(to, t, quick ? 1.4 : FADE_IN);
      this.fading = false;
      this.emit();
    }, (out + quiet) * 1000);
    this.emit();
  }

  private watch() {
    const el = this.els[this.active];
    if (this.fading || !el.duration || Number.isNaN(el.duration)) return;
    // Start the fade-out so it ends with the song.
    if (el.duration - el.currentTime <= FADE_OUT + 0.1) this.next();
  }

  next() {
    const list = this.playlist();
    if (!list.length || !this.started) return;
    this.index = (this.index + 1) % list.length;
    this.handOver(list[this.index]);
  }

  /** The album starts its playlist fresh; leaving it starts the landing one. */
  setMode(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.index = 0;
    const t = this.track;
    if (this.started && t) this.handOver(t, true);
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
    if (this.started && this.track) this.handOver(this.track, true);
    this.emit();
  }

  /** Leaving the page (the award room has its own score). */
  stop() {
    this.disarm?.();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.handTimer) clearTimeout(this.handTimer);
    this.handTimer = null;
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
