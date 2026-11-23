// How sharply a canvas is drawn, and what it costs (§102.7).
//
//   "in mobile view… the hanging chain and the finale chain look not in full
//    HD resolution… edges breaking… without compromising that lag issue,
//    possible to make these more and more higher resolution… then why in
//    mobile alone we compromised"
//
// A phone's canvases used to be drawn at 1–1.25 pixels per CSS pixel on a
// 2.75× screen, all of them, just in case. Now each is drawn at its screen's
// own resolution (up to a cap past which no eye sees more) and is cut only on
// a device that PROVES it cannot keep up: the canvas times its own GPU work
// (EXT_disjoint_timer_query_webgl2), or, where the browser will not say, the
// page's frame pacing while nothing else is going on — and steps itself down,
// one step at a time, remembered for the next visit.
//
// ?sharp=2 (or ?sharp=ring:1.5,spine:2) sets it by hand and records the GPU
// times in window.__sharp, for QA.

import type { WebGLRenderer } from "three";

export type SharpKind = "spine" | "ring" | "core" | "award";

// `wide`: what a desktop has always had (he likes it as it is). `ms`: the GPU
// time a frame of this canvas may take before it must step down.
const CAP: Record<SharpKind, { phone: number; wide: number; ms: number }> = {
  spine: { phone: 2.5, wide: 1.25, ms: 7 },
  ring: { phone: 2.75, wide: 1.75, ms: 8 },
  core: { phone: 2, wide: 1.35, ms: 6 },
  award: { phone: 2, wide: 1.6, ms: 13 },
};
const STEPS = [1, 0.78, 0.6, 0.46];
const STORE = "pandi-dev-sharp";

function forced(kind: SharpKind): number | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("sharp");
  if (!raw) return null;
  for (const part of raw.split(",")) {
    const [k, v] = part.includes(":") ? part.split(":") : ["", part];
    const n = Number(v);
    if ((k === "" || k === kind) && n > 0.2 && n <= 4) return n;
  }
  return null;
}
/** A step down is remembered for three days, then full sharpness is tried
 *  again: a phone that was hot or busy once is not held to it. */
const KEEP_MS = 3 * 24 * 3600 * 1000;
type Kept = Partial<Record<SharpKind, [number, number]>>;
function readKept(): Kept {
  try {
    const k = JSON.parse(localStorage.getItem(STORE) ?? "{}") as Kept;
    return k && typeof k === "object" ? k : {};
  } catch {
    return {};
  }
}
function readStep(kind: SharpKind): number {
  const k = readKept()[kind];
  if (!Array.isArray(k) || Date.now() - k[1] > KEEP_MS) return 0;
  return k[0] >= 1 && k[0] < STEPS.length ? Math.floor(k[0]) : 0;
}
function keepStep(kind: SharpKind, step: number) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...readKept(), [kind]: [step, Date.now()] }));
  } catch {
    /* a private window: decided again next time */
  }
}

/** Pixels drawn per CSS pixel, for this canvas on this screen, at a step. */
function ratioAt(kind: SharpKind, phone: boolean, step: number): number {
  const cap = CAP[kind];
  const full = Math.min(window.devicePixelRatio || 1, phone ? cap.phone : cap.wide);
  // A desktop's canvases were never over-drawn: no steps there.
  return phone ? Math.max(1, full * STEPS[step]) : full;
}
export function pixelRatio(kind: SharpKind, phone: boolean): number {
  return forced(kind) ?? ratioAt(kind, phone, readStep(kind));
}

export type GpuWatch = { begin: () => void; end: () => void; dispose: () => void };
const IDLE: GpuWatch = { begin: () => {}, end: () => {}, dispose: () => {} };

/** Put begin()/end() round each draw. `apply` is given the new ratio when this
 *  canvas must step down (call it between frames: it is). Phones only. */
export function watchGpu(renderer: WebGLRenderer, kind: SharpKind, phone: boolean, apply: (ratio: number) => void, query = true): GpuWatch {
  const hand = forced(kind);
  if (!phone && hand == null) return IDLE;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = query || hand != null ? (gl.getExtension?.("EXT_disjoint_timer_query_webgl2") as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
  // An iPhone never says, and never needs to.
  const apple = /iP(hone|ad|od)/.test(navigator.userAgent);
  let step = readStep(kind);
  let frame = 0;
  let open: WebGLQuery | null = null;
  let waiting: WebGLQuery | null = null;
  let times: number[] = [];
  let gaps: number[] = [];
  let last = 0;
  let drew = 0;
  let raf = 0;
  let settledAt = performance.now() + 5000;
  let scrolled = 0;
  const onScroll = () => {
    scrolled = performance.now();
  };

  const down = () => {
    times = [];
    gaps = [];
    settledAt = performance.now() + 2500;
    if (hand != null || step >= STEPS.length - 1) return;
    step++;
    keepStep(kind, step);
    apply(ratioAt(kind, phone, step));
  };
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1];
  // No timer: the page's own frames (not this canvas's draws — at rest the
  // spine draws every second one), while this canvas is drawing and nothing
  // else is going on.
  const pace = (now: number) => {
    // Its canvas gone from the page: nothing left to watch.
    if (!renderer.domElement.isConnected) return;
    raf = requestAnimationFrame(pace);
    const gap = now - last;
    last = now;
    if (now < settledAt || now - scrolled < 600 || performance.now() - drew > 200 || gap > 120 || document.hidden) {
      gaps = [];
      return;
    }
    gaps.push(gap);
    if (gaps.length < 80) return;
    const s = [...gaps].sort((x, y) => x - y);
    gaps = [];
    // Steady at half rate is a battery saver's cap, not a struggle.
    const capped = s[70] - s[10] < 5;
    if (s[40] > 25 && !capped) down();
  };
  if (!ext && !apple && hand == null) {
    window.addEventListener("scroll", onScroll, { passive: true });
    raf = requestAnimationFrame(pace);
  }

  return {
    begin() {
      const now = performance.now();
      frame++;
      drew = now;
      if (ext) {
        if (waiting && gl.getQueryParameter(waiting, gl.QUERY_RESULT_AVAILABLE)) {
          const off = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
          const ms = (gl.getQueryParameter(waiting, gl.QUERY_RESULT) as number) / 1e6;
          gl.deleteQuery(waiting);
          waiting = null;
          if (!off && now > settledAt) {
            times.push(ms);
            if (hand != null) ((window as unknown as { __sharp?: Record<string, number[]> }).__sharp ??= {})[kind] = [...times];
          }
        }
        if (hand == null && times.length >= 24) {
          if (median(times) > CAP[kind].ms) down();
          else times = [];
        }
        // One draw in six is timed.
        if (!waiting && frame % 6 === 0) {
          open = gl.createQuery();
          if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
        }
      }
    },
    end() {
      if (!open || !ext) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      waiting = open;
      open = null;
    },
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      if (waiting) gl.deleteQuery(waiting);
      waiting = null;
    },
  };
}
