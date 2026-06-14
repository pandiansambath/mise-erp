// Shared scroll state for the landing journey, kept OUTSIDE React on purpose.
//
// The page writes `journeyProgress.value` (0 → 1) on every scroll; the WebGL
// canvas reads it each frame, eases it into `journeySmooth.value`, and drives
// the camera + world from that. Plain mutable objects keep React re-renders out
// of the 60fps hot path entirely — which is the whole reason the journey stays
// buttery on a phone.
export const journeyProgress = { value: 0 };

// The eased/damped version the 3D scene actually renders from. The Scene's
// camera rig owns the easing; every world piece just reads this number.
export const journeySmooth = { value: 0 };

/* ── tiny math helpers (no dependency on three) ───────────────────────────── */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Hermite smoothstep — eases 0→1 between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate-independent exponential damping toward `target`.
    `lambda` is "how fast" (bigger = snappier); dt is the frame delta. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(target, current, Math.exp(-lambda * dt));
}

/** Opacity for a narrative beat centred on the scroll track.
    Ramps up over `fade` before `start`→`start`, holds at 1 through the window,
    ramps back down after `end`. Used by the HTML overlay AND scene pieces so
    text and 3D objects appear/disappear together. */
export function windowOpacity(p: number, start: number, end: number, fade = 0.06): number {
  const up = smoothstep(start - fade, start + fade, p);
  const down = 1 - smoothstep(end - fade, end + fade, p);
  return Math.min(up, down);
}

/** Position along the flight path for a given scroll progress (camera z). */
export const PATH_START_Z = 16;
export const PATH_END_Z = -132;
export const zAtProgress = (p: number) => lerp(PATH_START_Z, PATH_END_Z, p);
