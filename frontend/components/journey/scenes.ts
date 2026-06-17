// The ordered film scenes for the landing journey — real clips that flow into
// one another as you scroll, so it feels like TRAVELLING through a world:
// peaceful mountains → misty hills → the market → prep → the craft → the heat →
// the dark city → a kitchen that can see → step inside → the numbers → sunrise.

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
  { name: "mountains-clouds", center: 0.0, pos: "center 55%" },
  { name: "hills-dawn", center: 0.1, pos: "center 55%" },
  { name: "market", center: 0.2, pos: "center 50%" },
  { name: "prep", center: 0.3, pos: "center 50%" },
  { name: "plating", center: 0.4, pos: "center 55%" },
  { name: "flames", center: 0.5, pos: "center 50%" },
  { name: "night-city", center: 0.6, pos: "center 60%" },
  { name: "dining-warm", center: 0.7, pos: "center 50%" },
  { name: "interior-walk", center: 0.8, pos: "center 45%" },
  { name: "screen-data", center: 0.9, pos: "center 50%" },
  { name: "sunrise-finale", center: 1.0, pos: "center 55%" },
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

/** Local 0→1 progress WITHIN a scene's own segment (used to drive a slow
    forward push so each scene feels travelled-through, not just shown). */
export function sceneLocalProgress(p: number, i: number): number {
  const n = SCENES.length;
  const a = i > 0 ? SCENES[i - 1].center : SCENES[0].center - 0.1;
  const b = i < n - 1 ? SCENES[i + 1].center : SCENES[n - 1].center + 0.1;
  return clamp01((p - a) / (b - a));
}
