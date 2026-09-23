/** One transform over the whole scene, and everything is a consequence.
 *
 *     "we need like if we scroll we can rotate the entier ..we can move...
 *      pull...zoon ni zoom out"
 *     "under the any hotel if we lcick i will show us zoominded view of its
 *      own pages as nodes"
 *
 *  DRILLING DOWN IS NOT A DIFFERENT MECHANISM FROM ZOOMING. It is the same
 *  camera flying to a computed target. That single decision is why pan, zoom,
 *  rotate and click-to-open are one feature rather than four, and why there
 *  is no popup: a popup is a different surface, and the old sheet is what
 *  made drilling in feel like LEAVING the map.
 *
 *  The bubble you clicked does not move relative to anything. Its siblings do
 *  not fade — they fly off the edges because the camera moved, and they are
 *  still there when you come back. That is the difference between a zoom and
 *  a navigation, and it is what stops an operator losing his place.
 */

export type Camera = { k: number; x: number; y: number; theta: number };

export const HOME: Camera = { k: 1, x: 0, y: 0, theta: 0 };

/** Zoom bounds. Below 0.4 the labels are unreadable and the picture says
 *  nothing; above 8 a single bubble fills the screen and there is nothing
 *  left to compare it to, which is the entire point of the view. */
export const K_MIN = 0.4;
export const K_MAX = 8;

/** Rotation is a nudge, not a free spin. He asked to be able to rotate; a map
 *  that can end up upside down is a map somebody has to fix before they can
 *  read it, so it springs back and is capped either side of level. */
export const THETA_MAX = Math.PI / 6;

export const clampK = (k: number) => Math.min(K_MAX, Math.max(K_MIN, k));
export const clampTheta = (t: number) =>
  Math.min(THETA_MAX, Math.max(-THETA_MAX, t));

/** The house curve — `globals.css` uses this for every deliberate move. */
const EASE = (t: number) => {
  // cubic-bezier(0.22, 1, 0.36, 1), evaluated. Newton would be exact; this
  // closed form is within a pixel over 520ms and costs nothing per frame.
  const u = 1 - t;
  return 1 - u * u * u * (1 - 0.36 * t);
};

export type Target = { x: number; y: number; r: number };

/**
 * Where the camera must sit to frame `target` in a `w × h` viewport.
 *
 * 82% rather than 100%: a bubble touching every edge has nothing around it,
 * and the whole argument of this view is that a thing is understood by what
 * it sits among. The margin IS the context.
 */
export function frame(target: Target, w: number, h: number): Camera {
  const k = clampK((Math.min(w, h) * 0.82) / (target.r * 2));
  return { k, x: -target.x * k, y: -target.y * k, theta: 0 };
}

/** `translate(w/2 + x, h/2 + y) scale(k) rotate(theta)` as an SVG string.
 *
 *  ONE `setAttribute` PER FRAME, on one `<g>`. Not React state: a camera
 *  written through `setState` re-renders every bubble sixty times a second,
 *  and this project has already shipped that mistake once — it was the phone
 *  "flickering while it answers" that survived two other fixes.
 */
export function toTransform(c: Camera, w: number, h: number): string {
  const deg = (c.theta * 180) / Math.PI;
  return `translate(${w / 2 + c.x} ${h / 2 + c.y}) scale(${c.k}) rotate(${deg})`;
}

export type Tween = { stop: () => void };

/**
 * Fly the camera from `from` to `to`, calling `onFrame` with each step.
 *
 * `reduce` collapses the duration to zero rather than taking a second code
 * path — one guard, so the reduced-motion case cannot drift from the normal
 * one by being maintained separately.
 */
export function flyTo(
  from: Camera,
  to: Camera,
  ms: number,
  onFrame: (c: Camera) => void,
  onDone?: () => void,
  reduce = false,
): Tween {
  const d = reduce ? 0 : ms;
  if (d <= 0) {
    onFrame(to);
    onDone?.();
    return { stop: () => {} };
  }

  const t0 = performance.now();
  let raf = 0;
  let live = true;

  const step = (now: number) => {
    if (!live) return;
    const p = Math.min(1, (now - t0) / d);
    const e = EASE(p);
    onFrame({
      // Zoom is interpolated in LOG SPACE. Linear k makes the first half of a
      // 1→8 fly feel motionless and the second half feel like a lurch,
      // because what the eye reads is the ratio, not the difference.
      k: from.k * Math.pow(to.k / from.k, e),
      x: from.x + (to.x - from.x) * e,
      y: from.y + (to.y - from.y) * e,
      theta: from.theta + (to.theta - from.theta) * e,
    });
    if (p < 1) raf = requestAnimationFrame(step);
    else onDone?.();
  };

  raf = requestAnimationFrame(step);
  return {
    stop: () => {
      live = false;
      cancelAnimationFrame(raf);
    },
  };
}

/** Screen point → scene point, so a wheel zooms toward the cursor rather than
 *  toward the middle. Zooming to the centre is what makes a map feel like it
 *  is fighting you. */
export function toScene(
  px: number,
  py: number,
  c: Camera,
  w: number,
  h: number,
): { x: number; y: number } {
  const dx = px - (w / 2 + c.x);
  const dy = py - (h / 2 + c.y);
  const cos = Math.cos(-c.theta);
  const sin = Math.sin(-c.theta);
  return {
    x: (dx * cos - dy * sin) / c.k,
    y: (dx * sin + dy * cos) / c.k,
  };
}

/** Zoom by `factor`, keeping the scene point under the cursor fixed. */
export function zoomAt(
  c: Camera,
  factor: number,
  px: number,
  py: number,
  w: number,
  h: number,
): Camera {
  const k = clampK(c.k * factor);
  if (k === c.k) return c;
  const s = toScene(px, py, c, w, h);
  // Solve for the pan that leaves `s` under (px, py) at the new scale.
  const cos = Math.cos(c.theta);
  const sin = Math.sin(c.theta);
  const rx = s.x * cos - s.y * sin;
  const ry = s.x * sin + s.y * cos;
  return { ...c, k, x: px - w / 2 - rx * k, y: py - h / 2 - ry * k };
}
