// A card's way to the divider and back, as numbers (§106.13).
//
// The browser moves it (globals.css devRevolve…, on the compositor); the skeleton has to know
// where its ball is, to take it in. So the way is written down here too: THE SAME ROWS as the
// keyframes, between which the browser goes in straight lines, and so does this.
//
//   "the ball… when I scroll, that ball is disappearing: instead make that ball dissolve
//    inside the skeleton" (24 Nov)
//
// It used to go on behind the divider, to the far side, and fade there, at the very edge of
// the screen. Now it winds itself up as it lets go of its place, floats (the page goes on
// under it) to the skeleton, and goes into it: which is seen, a fifth of the way down the
// screen. The next card comes out of it the same way, a fifth of the way up.

/** Where in the second half of its life it has wound itself up; where it is at the skeleton;
 *  where it begins to go into the bone, and has gone. (The first half is the same, backwards.) */
export const CLOSED = 0.745;
const GO = { wide: [0.782, 0.912], phone: [0.762, 0.882] } as const;

/** Along the way: [how far in its life, x (of the way to the divider; px on a phone), y (of its
 *  own height), z px, turned (deg), scale]. */
type Row = readonly [number, number, number, number, number, number];
const WIDE: readonly Row[] = [
  [0.6, 0, 0, 0, 0, 1],
  [0.62, 0.0281, 0, -7, 1.55, 0.9938],
  [0.64, 0.1055, 0, -26, 2.94, 0.9765],
  [0.66, 0.2225, 0, -54, 4.05, 0.9499],
  [0.68, 0.3692, 0.0267, -88, 4.76, 0.916],
  [0.7, 0.5347, 0.0975, -125, 5, 0.8769],
  [0.72, 0.7063, 0.1973, -162, 4.76, 0.8357],
  [0.74, 0.8694, 0.3093, -196, 4.05, 0.7959],
  [0.76, 1.0075, 0.4147, -224, 2.94, 0.7617],
  [0.78, 1.1032, 0.4932, -243, 1.55, 0.7378],
  [0.8, 1.1389, 0.5239, -250, 0, 0.7289],
];
const PHONE: readonly Row[] = [
  [0.6, 0, 0, 0, 0, 1],
  [0.618, 9.3, 0, -1.7, 1.55, 0.9969],
  [0.636, 20.19, 0, -6.2, 2.94, 0.9885],
  [0.654, 29.79, 0.0037, -13, 4.05, 0.9759],
  [0.672, 36.41, 0.0307, -21.1, 4.76, 0.9603],
  [0.69, 38.95, 0.0771, -30, 5, 0.943],
  [0.708, 36.94, 0.1348, -38.9, 4.76, 0.9254],
  [0.726, 30.62, 0.1953, -47, 4.05, 0.9088],
  [0.744, 20.98, 0.2498, -53.8, 2.94, 0.895],
  [0.762, 9.74, 0.2893, -58.3, 1.55, 0.8855],
  [0.78, 0, 0.3045, -60, 0, 0.882],
];

/** Where a card's middle is on the screen, from where it was laid out (px), and how large. */
export type Way = { x: number; y: number; s: number; /** 1 in its place, 0 at the skeleton */ side: number };

/** `a`: how far in its life (0–1); `w`, `h`: its size; `gap`: half the gap between the columns. */
export function wayOf(a: number, w: number, h: number, gap: number, wide: boolean): Way {
  const rows = wide ? WIDE : PHONE;
  const b = Math.max(a, 1 - a);
  let i = 1;
  while (i < rows.length - 1 && b > rows[i][0]) i++;
  const p = rows[i - 1];
  const q = rows[i];
  const t = Math.min(1, Math.max(0, (b - p[0]) / (q[0] - p[0])));
  const at = (k: number) => p[k] + (q[k] - p[k]) * t;
  const deep = wide ? 1800 / (1800 - at(3)) : 1200 / (1200 - at(3));
  const back = a < 0.5 ? -1 : 1;
  const x = wide ? -at(1) * (w / 2 + gap) * deep : at(1) * back * deep;
  return { x, y: at(2) * h * back * deep, s: at(5) * deep, side: wide ? 1 - at(1) * deep : 0.85 };
}

/** How far it has gone into the bone (0 whole, 1 gone). */
export function goneAt(a: number, wide: boolean): number {
  const [g0, g1] = wide ? GO.wide : GO.phone;
  return Math.min(1, Math.max(0, (Math.max(a, 1 - a) - g0) / (g1 - g0)));
}

/** How far it has wound itself up. */
export function rollAt(a: number): number {
  return Math.min(1, Math.max(0, (Math.max(a, 1 - a) - 0.6) / (CLOSED - 0.6)));
}
