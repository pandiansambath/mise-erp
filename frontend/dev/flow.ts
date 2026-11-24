// The water under the hand (§104.7).
//
//   "when we move the cursor here and there we see 'a stone dropped in a lake'…
//    I want… when I move [the] cursor I can feel I'm above the water, with my hand
//    dipping inside it and moving… that area of [the] cursor scatters, disperses…
//    so realistic and enjoyable" (24 Nov)
//
// So there is water, over the whole screen: a coarse grid of it, worked out here, in
// the open (a WebGL canvas cannot lend its pictures to another, and the background and
// every card are canvases of their own: they are each handed these numbers as a small
// texture, and draw what it does to them).
//
//   · what it does: it is dragged along by the hand, pushed aside, rolls up in eddies
//     behind it and slows (stable fluids, with the eddies kept alive);
//   · its surface: dips under the hand, piles up before it, and runs out in waves;
//   · where it has been STIRRED: there things come apart (a wake of holes and beads),
//     and come together again as it settles;
//   · the beads that are thrown clear: they go with the water, and then home.
//
// It runs only while something moves; a mouse stirs it as it goes, and a press (a tap) is a
// hand put in.

import type * as THREE_NS from "three";

const PHONE = typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;
const CELL = PHONE ? 24 : 19;
const ROUNDS = PHONE ? 6 : 8;
export const BEADS = PHONE ? 110 : 320;
const HAND = PHONE ? 34 : 38;
const WAVE = 300;
const WAVE_STEP = 1 / 100;

type Dab = { x0: number; y0: number; x1: number; y1: number; vx: number; vy: number; press: number };

/** A half float's bits. */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function half(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 112;
  if (e <= 0) return sign;
  if (e >= 31) return sign | 0x7bff;
  return sign | (e << 10) | ((x >>> 13) & 0x3ff);
}

class Water {
  cols = 4;
  rows = 4;
  /** The screen it lies over, in CSS pixels. */
  w = 1;
  h = 1;
  /** What a canvas draws from: px a second (x, y), how stirred, how high; and the surface's
   *  slopes (a slope read off a height between its neighbours shows the grid). */
  data = new Uint16Array(64);
  slope = new Uint16Array(32);
  version = 0;
  /** Where anything is going on, in screen pixels (or nothing: x1 < x0). */
  box = { x0: 1, y0: 1, x1: 0, y1: 0 };
  /** The beads: place, size, opacity; and their colours. */
  bead = new Float32Array(BEADS * 4);
  beadTint = new Float32Array(BEADS * 3);
  beadsOn = false;
  /** Colours a bead may have; and that of what the hand is over. */
  palette: number[][] = [
    [0.49, 0.94, 0.86],
    [0.94, 0.74, 0.42],
    [0.61, 0.55, 1],
    [1, 1, 1],
  ];
  over: readonly number[] | null = null;

  private u = new Float32Array(16);
  private v = new Float32Array(16);
  private u0 = new Float32Array(16);
  private v0 = new Float32Array(16);
  private s = new Float32Array(16);
  private s0 = new Float32Array(16);
  private p = new Float32Array(16);
  private d = new Float32Array(16);
  private z = new Float32Array(16);
  private z0 = new Float32Array(16);
  private dabs: Dab[] = [];
  private raf = 0;
  private last = 0;
  private quiet = 0;
  private users = 0;
  private lastX = 0;
  private lastY = 0;
  private lastT = 0;
  private fresh = false;
  // a bead's own: speed, home, age, life, size, spin
  private bv = new Float32Array(BEADS * 2);
  private bh = new Float32Array(BEADS * 2);
  private bl = new Float32Array(BEADS * 3);
  private nextBead = 0;
  private owed = 0;

  /** Somebody draws it: it listens. */
  use(): () => void {
    if (this.users++ === 0) this.begin();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--this.users === 0) this.end();
    };
  }

  active(): boolean {
    return this.raf !== 0;
  }

  /** What the water does at a place on the screen: px a second, and how stirred. (The same
   *  three numbers each time: read them before asking again.) */
  private out: [number, number, number] = [0, 0, 0];
  at(x: number, y: number): readonly [number, number, number] {
    const o = this.out;
    const b = this.box;
    if (!this.raf || x < b.x0 || x > b.x1 || y < b.y0 || y > b.y1) {
      o[0] = o[1] = o[2] = 0;
      return o;
    }
    const gx = Math.min(this.cols - 1.001, Math.max(0, (x / this.w) * this.cols - 0.5));
    const gy = Math.min(this.rows - 1.001, Math.max(0, (y / this.h) * this.rows - 0.5));
    const i = gx | 0;
    const j = gy | 0;
    const fx = gx - i;
    const fy = gy - j;
    const n = j * this.cols + i;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const c = this.cols;
    o[0] = this.u[n] * w00 + this.u[n + 1] * w10 + this.u[n + c] * w01 + this.u[n + c + 1] * w11;
    o[1] = this.v[n] * w00 + this.v[n + 1] * w10 + this.v[n + c] * w01 + this.v[n + c + 1] * w11;
    o[2] = this.s[n] * w00 + this.s[n + 1] * w10 + this.s[n + c] * w01 + this.s[n + c + 1] * w11;
    return o;
  }

  /** Whether anything is going on in this part of the screen. */
  stirs(x: number, y: number, w: number, h: number): boolean {
    const b = this.box;
    return this.raf !== 0 && b.x1 > b.x0 && x < b.x1 && x + w > b.x0 && y < b.y1 && y + h > b.y0;
  }

  private begin() {
    this.fit();
    window.addEventListener("resize", this.fit);
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerdown", this.onDown, { passive: true });
    window.addEventListener("click", this.onTap, { passive: true });
    document.documentElement.addEventListener("pointerleave", this.onLeave);
  }
  private end() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("resize", this.fit);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("click", this.onTap);
    document.documentElement.removeEventListener("pointerleave", this.onLeave);
  }

  private fit = () => {
    // (Without the scrollbar: what is drawn lies on the page, not under it.)
    const w = document.documentElement.clientWidth || window.innerWidth;
    const h = window.innerHeight;
    const cols = Math.max(8, Math.round(w / CELL));
    const rows = Math.max(8, Math.round(h / CELL));
    this.w = w;
    this.h = h;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    for (const k of ["u", "v", "u0", "v0", "s", "s0", "p", "d", "z", "z0"] as const) this[k] = new Float32Array(n);
    this.data = new Uint16Array(n * 4);
    this.slope = new Uint16Array(n * 2);
    this.version++;
  };

  private hand(x: number, y: number, t: number, press = 0) {
    if (!this.fresh || t - this.lastT > 160) {
      // (It comes in from nowhere: no stroke from where it was last seen.)
      this.lastX = x;
      this.lastY = y;
      this.lastT = t;
      this.fresh = true;
      if (!press) return;
    }
    const dt = Math.max(6, t - this.lastT) / 1000;
    const dx = x - this.lastX;
    const dy = y - this.lastY;
    if (!press && dx * dx + dy * dy < 1) return;
    let vx = dx / dt;
    let vy = dy / dt;
    const sp = Math.hypot(vx, vy);
    if (sp > 2400) {
      vx *= 2400 / sp;
      vy *= 2400 / sp;
    }
    this.dabs.push({ x0: this.lastX, y0: this.lastY, x1: x, y1: y, vx, vy, press });
    this.lastX = x;
    this.lastY = y;
    this.lastT = t;
    this.quiet = 0;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }
  private onMove = (e: PointerEvent) => {
    this.hand(e.clientX, e.clientY, e.timeStamp);
  };
  // (A finger put down may only be going to scroll: its splash waits for the tap. Once it
  // scrolls the page the browser keeps its moves to itself, so a scroll stirs nothing.)
  private touched = false;
  private onDown = (e: PointerEvent) => {
    this.touched = e.pointerType === "touch";
    if (this.touched) this.fresh = false;
    else this.hand(e.clientX, e.clientY, e.timeStamp, 1);
  };
  private onTap = (e: MouseEvent) => {
    if (this.touched) this.hand(e.clientX, e.clientY, e.timeStamp, 1);
  };
  private onLeave = () => {
    this.fresh = false;
  };

  private step = (now: number) => {
    this.raf = requestAnimationFrame(this.step);
    if (document.hidden) return;
    const dt = Math.min(1 / 26, Math.max(1 / 144, (now - this.last) / 1000));
    this.last = now;
    this.force(dt);
    this.eddies(dt);
    this.carry(dt);
    this.project();
    this.waves(dt);
    this.beads(dt);
    const still = this.settle(dt);
    this.version++;
    this.quiet = still ? this.quiet + dt : 0;
    if (this.quiet > 0.5 && !this.beadsOn) {
      // Calm: every canvas once more as it is, and then nothing.
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.box = { x0: 1, y0: 1, x1: 0, y1: 0 };
      this.u.fill(0);
      this.v.fill(0);
      this.s.fill(0);
      this.p.fill(0);
      this.z.fill(0);
      this.z0.fill(0);
      this.data.fill(0);
      this.slope.fill(0);
      this.version++;
    }
  };

  /** The hand, along its path since the last time. */
  private force(dt: number) {
    const { cols, rows, u, v, s, z, z0 } = this;
    const cx = cols / this.w;
    const cy = rows / this.h;
    for (const b of this.dabs) {
      const dx = b.x1 - b.x0;
      const dy = b.y1 - b.y0;
      const len = Math.hypot(dx, dy);
      const steps = Math.min(24, Math.max(1, Math.ceil(len / (HAND * 0.5))));
      const sp = Math.hypot(b.vx, b.vy);
      const hard = Math.min(1, sp / 900);
      const nx = sp > 1 ? b.vx / sp : 0;
      const ny = sp > 1 ? b.vy / sp : 0;
      const R = HAND * (b.press ? 1.7 : 0.85 + 0.35 * hard);
      for (let k = 1; k <= steps; k++) {
        const x = b.x0 + (dx * k) / steps;
        const y = b.y0 + (dy * k) / steps;
        const i0 = Math.max(1, Math.floor((x - R * 2) * cx));
        const i1 = Math.min(cols - 2, Math.ceil((x + R * 2) * cx));
        const j0 = Math.max(1, Math.floor((y - R * 2) * cy));
        const j1 = Math.min(rows - 2, Math.ceil((y + R * 2) * cy));
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const px = (i + 0.5) / cx - x;
            const py = (j + 0.5) / cy - y;
            const g = Math.exp(-(px * px + py * py) / (R * R));
            if (g < 0.02) continue;
            const n = j * cols + i;
            if (b.press) {
              // A hand put in: out from it on every side, a dip, and a splash.
              const l = Math.hypot(px, py) + 8;
              u[n] += (px / l) * 520 * g;
              v[n] += (py / l) * 520 * g;
              s[n] = Math.min(1.25, s[n] + 0.85 * g);
              z[n] -= 0.8 * g;
              z0[n] -= 0.5 * g;
              continue;
            }
            const a = Math.min(1, (g * 1.15) / Math.sqrt(steps));
            u[n] += (b.vx * 0.82 - u[n]) * a;
            v[n] += (b.vy * 0.82 - v[n]) * a;
            s[n] = Math.min(1.25, s[n] + g * hard * (0.5 / Math.sqrt(steps) + 0.16));
            // It dips beneath the hand and piles up before it.
            const ahead = (px * nx + py * ny) / R;
            const lift = g * hard * (ahead > 0 ? 0.26 * ahead : -0.3) * (0.6 / Math.sqrt(steps) + 0.2);
            z[n] += lift;
            z0[n] += lift * 0.75;
          }
        }
        // Beads thrown clear, more of them the harder it goes.
        this.owed += b.press ? 14 / steps : (len / steps) * (0.03 + 0.15 * hard * hard);
        while (this.owed >= 1) {
          this.owed -= 1;
          this.toss(x, y, b, R);
        }
      }
    }
    this.dabs.length = 0;
    void dt;
  }

  private toss(x: number, y: number, b: Dab, R: number) {
    const k = this.nextBead;
    this.nextBead = (k + 1) % BEADS;
    const a = Math.random() * 6.283;
    const r = R * (0.25 + 1.05 * Math.sqrt(Math.random()));
    const hx = x + Math.cos(a) * r;
    const hy = y + Math.sin(a) * r;
    const out = b.press ? 240 : 60;
    this.bead[k * 4] = hx;
    this.bead[k * 4 + 1] = hy;
    this.bv[k * 2] = b.vx * (0.12 + 0.3 * Math.random()) + Math.cos(a) * out * Math.random();
    this.bv[k * 2 + 1] = b.vy * (0.12 + 0.3 * Math.random()) + Math.sin(a) * out * Math.random();
    this.bh[k * 2] = hx;
    this.bh[k * 2 + 1] = hy;
    this.bl[k * 3] = 0;
    this.bl[k * 3 + 1] = 0.9 + 1.5 * Math.random();
    this.bl[k * 3 + 2] = (PHONE ? 3.4 : 4) + 6.5 * Math.random() * Math.random();
    const tint = this.over && Math.random() < 0.5 ? this.over : this.palette[Math.min(3, Math.floor(Math.random() * Math.random() * 4.2))];
    const lum = 0.55 + 0.45 * Math.random();
    for (let c = 0; c < 3; c++) this.beadTint[k * 3 + c] = tint[c] * lum;
    this.beadsOn = true;
  }

  /** Eddies, kept from dying of the coarse grid. */
  private eddies(dt: number) {
    const { cols, rows, u, v, d } = this;
    // (d: how fast it turns here, for the moment.)
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const n = j * cols + i;
        d[n] = v[n + 1] - v[n - 1] - (u[n + cols] - u[n - cols]);
      }
    const k = 8 * dt;
    for (let j = 2; j < rows - 2; j++)
      for (let i = 2; i < cols - 2; i++) {
        const n = j * cols + i;
        const c = d[n];
        // (In the wake only: kept up everywhere, the water never came to rest.)
        const wake = this.s[n];
        if (wake < 0.04 || (c > -12 && c < 12)) continue;
        const gx = Math.abs(d[n + 1]) - Math.abs(d[n - 1]);
        const gy = Math.abs(d[n + cols]) - Math.abs(d[n - cols]);
        const l = Math.sqrt(gx * gx + gy * gy) + 1e-3;
        const a = c * k * Math.min(1, wake * 1.6);
        u[n] += (gy / l) * a;
        v[n] -= (gx / l) * a;
      }
  }

  /** It carries itself, and what is stirred, along. */
  private carry(dt: number) {
    const { cols, rows } = this;
    [this.u0, this.u] = [this.u, this.u0];
    [this.v0, this.v] = [this.v, this.v0];
    [this.s0, this.s] = [this.s, this.s0];
    const { u, v, s, u0, v0, s0 } = this;
    const ax = (dt * cols) / this.w;
    const ay = (dt * rows) / this.h;
    const slow = Math.exp(-dt * 1.45);
    const fade = Math.exp(-dt * 1.05);
    const mx = cols - 1.501;
    const my = rows - 1.501;
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const n = j * cols + i;
        let x = i - u0[n] * ax;
        let y = j - v0[n] * ay;
        x = x < 0.5 ? 0.5 : x > mx ? mx : x;
        y = y < 0.5 ? 0.5 : y > my ? my : y;
        const xi = x | 0;
        const yi = y | 0;
        const fx = x - xi;
        const fy = y - yi;
        const a = yi * cols + xi;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        u[n] = (u0[a] * w00 + u0[a + 1] * w10 + u0[a + cols] * w01 + u0[a + cols + 1] * w11) * slow;
        v[n] = (v0[a] * w00 + v0[a + 1] * w10 + v0[a + cols] * w01 + v0[a + cols + 1] * w11) * slow;
        s[n] = (s0[a] * w00 + s0[a + 1] * w10 + s0[a + cols] * w01 + s0[a + cols + 1] * w11) * fade;
      }
  }

  /** It cannot be squeezed: what runs together here must go round. */
  private project() {
    const { cols, rows, u, v, p, d } = this;
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const n = j * cols + i;
        d[n] = 0.5 * (u[n + 1] - u[n - 1] + v[n + cols] - v[n - cols]);
        p[n] *= 0.8;
      }
    // (Each half of the squares in turn, a little over: it settles in far fewer rounds.)
    for (let k = 0; k < ROUNDS; k++)
      for (let half = 0; half < 2; half++)
        for (let j = 1; j < rows - 1; j++)
          for (let i = 1 + ((j + half) & 1); i < cols - 1; i += 2) {
            const n = j * cols + i;
            p[n] += 1.6 * (0.25 * (p[n - 1] + p[n + 1] + p[n - cols] + p[n + cols] - d[n]) - p[n]);
          }
    for (let j = 1; j < rows - 1; j++)
      for (let i = 1; i < cols - 1; i++) {
        const n = j * cols + i;
        u[n] -= 0.5 * (p[n + 1] - p[n - 1]);
        v[n] -= 0.5 * (p[n + cols] - p[n - cols]);
      }
  }

  /** Its surface: waves, running out and dying. (In steps of one length, always: a wave is
   *  its own last step, and one step longer than the next pumps it up till it breaks.) */
  private due = 0;
  private waves(dt: number) {
    const { cols, rows } = this;
    this.due = Math.min(4 * WAVE_STEP, this.due + dt);
    const c2 = Math.min(0.2, ((WAVE * WAVE_STEP * cols) / this.w) ** 2);
    const keep = Math.exp(-WAVE_STEP * 2.6);
    while (this.due >= WAVE_STEP) {
      this.due -= WAVE_STEP;
      const { z, z0 } = this;
      for (let j = 1; j < rows - 1; j++)
        for (let i = 1; i < cols - 1; i++) {
          const n = j * cols + i;
          // (And a little of it smoothed away: what is as fine as the grid is not water.)
          const lap = z[n - 1] + z[n + 1] + z[n - cols] + z[n + cols] - 4 * z[n];
          const next = z[n] + (z[n] - z0[n]) * keep + lap * (c2 + 0.035);
          z0[n] = next > 1 ? 1 : next < -1 ? -1 : next;
        }
      this.z = z0;
      this.z0 = z;
    }
  }

  private beads(dt: number) {
    if (!this.beadsOn) return;
    const { cols, rows, u, v, bead, bv, bh, bl } = this;
    let any = false;
    const cx = cols / this.w;
    const cy = rows / this.h;
    const drag = 1 - Math.exp(-dt * 3.2);
    for (let k = 0; k < BEADS; k++) {
      const life = bl[k * 3 + 1];
      if (life <= 0) continue;
      const age = (bl[k * 3] += dt);
      const q = age / life;
      if (q >= 1) {
        bl[k * 3 + 1] = 0;
        bead[k * 4 + 3] = 0;
        continue;
      }
      any = true;
      const i = Math.min(cols - 1, Math.max(0, (bead[k * 4] * cx) | 0));
      const j = Math.min(rows - 1, Math.max(0, (bead[k * 4 + 1] * cy) | 0));
      const n = j * cols + i;
      bv[k * 2] += (u[n] * 1.15 - bv[k * 2]) * drag;
      bv[k * 2 + 1] += (v[n] * 1.15 - bv[k * 2 + 1]) * drag;
      // With the water; then home.
      const home = q < 0.45 ? 0 : (q - 0.45) / 0.55;
      const pull = home * home * 9 * dt;
      bead[k * 4] += bv[k * 2] * dt * (1 - home) + (bh[k * 2] - bead[k * 4]) * Math.min(1, pull);
      bead[k * 4 + 1] += bv[k * 2 + 1] * dt * (1 - home) + (bh[k * 2 + 1] - bead[k * 4 + 1]) * Math.min(1, pull);
      const grow = Math.min(1, age * 9);
      bead[k * 4 + 2] = bl[k * 3 + 2] * grow * (1 - 0.55 * q * q);
      bead[k * 4 + 3] = Math.min(1, grow) * (1 - Math.max(0, (q - 0.72) / 0.28));
    }
    this.beadsOn = any;
  }

  /** The numbers, handed out; where anything is; whether it has all but stopped. */
  private settle(dt: number): boolean {
    void dt;
    const { cols, rows, u, v, s, z, data, slope } = this;
    let i0 = cols;
    let i1 = -1;
    let j0 = rows;
    let j1 = -1;
    let most = 0;
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const n = j * cols + i;
        const a = Math.abs(u[n]) + Math.abs(v[n]);
        const b = s[n];
        const c = Math.abs(z[n]);
        const m = a * 0.004 + b * 3 + c * 3;
        if (m > most) most = m;
        if (a > 10 || b > 0.012 || c > 0.008) {
          if (i < i0) i0 = i;
          if (i > i1) i1 = i;
          if (j < j0) j0 = j;
          if (j > j1) j1 = j;
        }
        const o = n * 4;
        data[o] = half(u[n]);
        data[o + 1] = half(v[n]);
        data[o + 2] = half(b);
        data[o + 3] = half(z[n]);
        if (i > 0 && j > 0 && i < cols - 1 && j < rows - 1) {
          slope[n * 2] = half(z[n + 1] - z[n - 1]);
          slope[n * 2 + 1] = half(z[n + cols] - z[n - cols]);
        }
      }
    const sx = this.w / cols;
    const sy = this.h / rows;
    this.box = { x0: (i0 - 2) * sx, y0: (j0 - 2) * sy, x1: (i1 + 3) * sx, y1: (j1 + 3) * sy };
    return most < 0.05;
  }
}

export const water = new Water();

/** The numbers as a texture, for one canvas: `update` before each drawing. */
export function flowTexture(THREE: typeof THREE_NS): { tex: THREE_NS.DataTexture; slope: THREE_NS.DataTexture; update: () => void; dispose: () => void } {
  const make = (data: Uint16Array, format: THREE_NS.PixelFormat) => {
    const t = new THREE.DataTexture(data as Uint16Array<ArrayBuffer>, water.cols, water.rows, format, THREE.HalfFloatType);
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  };
  const tex = make(water.data, THREE.RGBAFormat);
  const slope = make(water.slope, THREE.RGFormat);
  let seen = -1;
  const put = (t: THREE_NS.DataTexture, data: Uint16Array) => {
    if (t.image.width !== water.cols || t.image.height !== water.rows) {
      t.dispose();
      t.image = { data: data as Uint16Array<ArrayBuffer>, width: water.cols, height: water.rows };
    } else t.image.data = data as Uint16Array<ArrayBuffer>;
    t.needsUpdate = true;
  };
  return {
    tex,
    slope,
    update() {
      if (seen === water.version) return;
      seen = water.version;
      put(tex, water.data);
      put(slope, water.slope);
    },
    dispose() {
      tex.dispose();
      slope.dispose();
    },
  };
}

/** How its surface is lit: by a light high up and to the left (x: the lit side of a wave,
 *  y: its shadow side, z: a glint off it). */
export const SURFACE_LIGHT = /* glsl */ `
  vec3 surfaceLight(vec2 slope) {
    vec3 n = normalize(vec3(-slope * 2.6, 1.0));
    float s = dot(n, vec3(-0.40, -0.52, 0.755)) - 0.755;
    float spec = pow(max(0.0, dot(n, vec3(-0.26, -0.34, 0.904))), 90.0) - 0.0001;
    return vec3(clamp(s * 1.9, 0.0, 0.8), clamp(-s * 1.9, 0.0, 0.8), max(0.0, spec));
  }
`;

/** What the beads are drawn with: hexagons of glass, lit from above. `place` puts one (px on
 *  the screen) into clip space. */
export function beadShader(place: string): { vertex: string; fragment: string } {
  return {
    vertex: /* glsl */ `
      attribute vec4 aBead;
      attribute vec3 aTint;
      uniform float uPx;
      varying vec3 vTint;
      varying float vA;
      ${place}
      void main() {
        gl_Position = aBead.w > 0.004 ? put(aBead.xy) : vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = (aBead.z * 2.0 + 1.5) * uPx;
        vTint = aTint;
        vA = aBead.w;
      }`,
    fragment: /* glsl */ `
      uniform float uShow;
      varying vec3 vTint;
      varying float vA;
      void main() {
        vec2 q = (gl_PointCoord - 0.5) * 2.2;
        vec2 b = abs(q);
        float d = max(b.x, dot(b, vec2(0.5, 0.8660254)));
        float m = smoothstep(1.0, 0.86, d);
        // Glass: dark in its middle, lit at the upper left, an edge that catches light.
        float lit = 0.5 - 0.5 * dot(q, vec2(0.6, 0.8));
        vec3 c = vTint * (0.3 + 0.75 * lit) + vTint * smoothstep(0.62, 0.95, d) * 0.45;
        c += smoothstep(0.34, 0.0, length(q + vec2(0.34, 0.42))) * 0.7;
        gl_FragColor = vec4(c, m * vA * uShow);
      }`,
  };
}

/** The beads as points: `update` before each drawing. */
export function beadPoints(THREE: typeof THREE_NS, mat: THREE_NS.Material): { points: THREE_NS.Points; update: () => void; dispose: () => void } {
  const geo = new THREE.BufferGeometry();
  const at = new THREE.BufferAttribute(water.bead, 4);
  const tint = new THREE.BufferAttribute(water.beadTint, 3);
  at.setUsage(THREE.DynamicDrawUsage);
  tint.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(BEADS * 3), 3));
  geo.setAttribute("aBead", at);
  geo.setAttribute("aTint", tint);
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  let seen = -1;
  return {
    points,
    update() {
      points.visible = water.beadsOn;
      if (!water.beadsOn || seen === water.version) return;
      seen = water.version;
      at.needsUpdate = true;
      tint.needsUpdate = true;
    },
    dispose: () => geo.dispose(),
  };
}

/** Shaders' half of it: where the surface of something comes apart into beads. `flowAt(p)`
 *  must be there: px in, what the water does there out — read with textureLod, or the whole
 *  of this is done for every pixel there is (a loop with a texture's slope in it is not
 *  stepped over). */
export const COME_APART = /* glsl */ `
  float apartRnd(vec2 p) { return fract(sin(dot(floor(p * 0.5), vec2(12.9898, 78.233))) * 43758.5453); }
  // The middle of the hexagon (of this width) that p is in.
  vec2 hexMid(vec2 p, float s) {
    vec2 r = vec2(1.0, 1.7320508) * s;
    vec2 h = r * 0.5;
    vec2 a = mod(p, r) - h;
    vec2 b = mod(p - h, r) - h;
    return p - (dot(a, a) < dot(b, b) ? a : b);
  }
  // Which bead is at p: how much of it (x), its light (y), how far it has come apart from
  // the rest (z), and (out) where it came from.
  vec3 beadAt(vec2 p, float s, out vec2 from) {
    vec2 m = hexMid(p, s);
    float best = 0.0;
    float light = 1.0;
    float how = 0.0;
    from = m;
    for (int k = 0; k < 7; k++) {
      vec2 o = k == 0 ? vec2(0.0) : k < 3 ? vec2(k == 1 ? s : -s, 0.0) : vec2((k == 3 || k == 5 ? 0.5 : -0.5) * s, (k < 5 ? 0.8660254 : -0.8660254) * s);
      vec2 c = m + o;
      vec4 f = flowAt(c);
      float r = apartRnd(c);
      float b = smoothstep(0.14, 0.75, f.z * (0.6 + 0.8 * r));
      float r2 = apartRnd(c.yx + 7.0);
      float a2 = r * 43.0;
      vec2 at = c + clamp(f.xy * 0.02 * b * (0.3 + r), -s * 0.45, s * 0.45) + vec2(cos(a2), sin(a2)) * s * (0.12 + 0.5 * b) * b;
      // (Smaller the further apart, no two alike, and some are gone.)
      float rad = s * 0.5 * (1.14 - b * (0.3 + 0.55 * r2)) * mix(1.0, smoothstep(0.26, 0.4, r2), smoothstep(0.35, 0.75, b));
      vec2 q = (p - at) / rad;
      vec2 w = abs(q);
      float d = max(w.x, dot(w, vec2(0.5, 0.8660254)));
      float cov = rad > 0.6 ? smoothstep(1.0, 1.0 - 1.6 / rad, d) : 0.0;
      if (cov > best) {
        best = cov;
        how = b;
        from = c;
        light = mix(1.0, (0.62 + 0.5 * (0.5 - 0.5 * dot(q, vec2(0.6, 0.8)))) + 0.35 * smoothstep(0.6, 0.95, d) + 0.6 * smoothstep(0.35, 0.0, length(q + vec2(0.32, 0.4))), b);
      }
    }
    return vec3(best, light, how);
  }
`;
