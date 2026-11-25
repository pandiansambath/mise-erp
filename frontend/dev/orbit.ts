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
// under it) to the skeleton, and melts as it touches it: which is seen, some way down the
// screen. The next card comes out of it the same way.
//
//   "that ball dissolve and evolve is not so natural… also I can still see that ball inside the
//    skeleton, why… it needs to dissolve in a smooth way" (25 Nov)
//
// So none goes INSIDE: it is gone before its middle has reached the bones. And while a card is
// read, the one before it has melted and the next has not begun.

/** Where in the second half of its life it lets go of its place (until then it is the card, flat);
 *  where it has wound itself up; where it melts. (The first half is the same, backwards.) */
export const FLAT = 0.585;
const SHUT = { wide: 0.685, phone: 0.67 } as const;
const GO = { wide: 0.704, phone: 0.686 } as const;
/** How long it takes to melt, or to come together, once it has begun (s). */
export const MELTS = 1.25;
/** How far from the cord its middle stops (globals.css --d-melt), in rem: from 1280 px, and below. */
export const MELT = { xl: 5.9, lg: 4.6 } as const;

/** Along the way: [how far in its life, x (of the way to the divider; px on a phone), y (of its
 *  own height), z px, turned (deg), scale]. */
type Row = readonly [number, number, number, number, number, number];
const WIDE: readonly Row[] = [
  [0.585, 0, 0, 0, 0, 1],
  [0.601, 0.0996, 0, -21.6, 1.24, 0.9992],
  [0.617, 0.2369, 0.0072, -50.7, 2.35, 0.9802],
  [0.633, 0.3896, 0.034, -82, 3.24, 0.9453],
  [0.649, 0.547, 0.0763, -113.2, 3.8, 0.8989],
  [0.665, 0.6998, 0.129, -142.7, 4, 0.8464],
  [0.681, 0.8392, 0.1864, -168.8, 3.8, 0.794],
  [0.697, 0.9573, 0.2424, -190.4, 3.24, 0.7483],
  [0.713, 1.047, 0.2905, -206.6, 2.35, 0.7165],
  [0.729, 1.1031, 0.3241, -216.6, 1.24, 0.7058],
  [0.745, 1.1222, 0.3367, -220, 0, 0.707],
];
const PHONE: readonly Row[] = [
  [0.585, 0, 0, 0, 0, 1],
  [0.5985, 2.92, 0, -1.4, 1.24, 0.9947],
  [0.612, 10.86, 0.0026, -5.2, 2.35, 0.9803],
  [0.6255, 22.67, 0.0216, -10.8, 3.24, 0.9589],
  [0.639, 37.14, 0.055, -17.6, 3.8, 0.9325],
  [0.6525, 53.08, 0.0979, -25, 4, 0.9034],
  [0.666, 69.21, 0.1453, -32.4, 3.8, 0.8739],
  [0.6795, 84.2, 0.1918, -39.2, 3.24, 0.8465],
  [0.693, 96.66, 0.2319, -44.8, 2.35, 0.8236],
  [0.7065, 105.18, 0.2602, -48.6, 1.24, 0.8079],
  [0.72, 108.33, 0.2708, -50, 0, 0.8021],
];

/** Where a card's middle is on the screen, from where it was laid out (px), and how large. */
export type Way = { x: number; y: number; s: number; /** 1 in its place, 0 at the skeleton */ side: number };

/** `a`: how far in its life (0–1); `w`, `h`: its size; `gap`: half the gap between the columns, less
 *  how far from the cord it stops. */
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

/** Whether it melts there (it does so in its own time: a ball is never left half melted because one
 *  has stopped scrolling). */
export function melts(a: number, wide: boolean): boolean {
  return Math.max(a, 1 - a) > (wide ? GO.wide : GO.phone);
}

/** How far it has wound itself up; from where on it is closed. */
export const shutAt = (wide: boolean) => (wide ? SHUT.wide : SHUT.phone);
export function rollAt(a: number, wide: boolean): number {
  return Math.min(1, Math.max(0, (Math.max(a, 1 - a) - FLAT) / (shutAt(wide) - FLAT)));
}
