// The ordered film scenes for the landing journey — one real clip per story
// beat, in the SAME order the Overlay text appears. Each scene crossfades into
// the next as you scroll, holding on its beat's centre so the right footage
// backs the right words.

import { clamp01, smoothstep } from "./progress";

export type Scene = {
  /** file stem in /public/journey (…mp4 clip + …jpg poster) */
  name: string;
  /** scroll position (0..1) where this scene is fully on screen */
  center: number;
  /** object-position so the most interesting part stays framed */
  pos?: string;
};

export const SCENES: Scene[] = [
  { name: "hills-dawn", center: 0.0, pos: "center 55%" },
  { name: "prep-calm", center: 0.167, pos: "center 50%" },
  { name: "harvest", center: 0.302, pos: "center 55%" },
  { name: "cooking", center: 0.437, pos: "center 50%" },
  { name: "dark-street", center: 0.572, pos: "center 60%" },
  { name: "dining-warm", center: 0.695, pos: "center 50%" },
  { name: "entrance", center: 0.805, pos: "center 45%" },
  { name: "tablet", center: 0.902, pos: "center 50%" },
  { name: "plated", center: 1.0, pos: "center 45%" },
];

/** Opacity for every scene at scroll progress `p`. Adjacent scenes crossfade
    around the midpoint between their centres, with a hold near each centre, so
    there is always exactly one (or two, mid-dissolve) clips on screen. */
export function sceneOpacities(p: number, out: number[]): number[] {
  const n = SCENES.length;
  for (let i = 0; i < n; i++) out[i] = 0;
  if (p <= SCENES[0].center) {
    out[0] = 1;
    return out;
  }
  if (p >= SCENES[n - 1].center) {
    out[n - 1] = 1;
    return out;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = SCENES[i].center;
    const b = SCENES[i + 1].center;
    if (p >= a && p <= b) {
      const t = (p - a) / (b - a);
      const blend = smoothstep(0.35, 0.65, t);
      out[i] = clamp01(1 - blend);
      out[i + 1] = clamp01(blend);
      break;
    }
  }
  return out;
}
