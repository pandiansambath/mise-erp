// Shared scroll state for the landing journey, kept OUTSIDE React on purpose.
//
// The page writes `journeyProgress.value` (0 → 1) on every scroll; the film
// backdrop and the text overlay both read it each frame and write opacity
// straight to the DOM. A plain mutable object keeps React re-renders out of the
// 60fps hot path entirely — which is why the journey stays buttery on a phone.
export const journeyProgress = { value: 0 };

/* ── tiny math helpers ────────────────────────────────────────────────────── */

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Hermite smoothstep — eases 0→1 between two edges. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Opacity for a narrative beat centred on the scroll track. Ramps up over
    `fade` before `start`, holds at 1 through the window, ramps down after
    `end`. Used by the text overlay so words appear/disappear with the footage. */
export function windowOpacity(p: number, start: number, end: number, fade = 0.06): number {
  const up = smoothstep(start - fade, start + fade, p);
  const down = 1 - smoothstep(end - fade, end + fade, p);
  return Math.min(up, down);
}
