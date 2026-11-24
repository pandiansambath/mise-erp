// The worlds the cards curl into (§104.6).
//
//   "the balls (grow as card and shrink from card)… too much comic with no
//    major detailing… any idea to make [them] more natural and realistic with
//    more and more detailing" (24 Nov)
//
// He is the middle of his own solar system (SkillOrbit), and the cards go round
// the spine: so each card, away, is a real world, from what was sent there. The
// maps are public-domain mission imagery, filled, graded and made small
// (public/dev/worlds; how, in dev/art/worlds.py):
//   Earth — NASA Blue Marble, night lights NASA/NOAA Suomi NPP (2012)
//   Moon — NASA LRO (LROC colour, LOLA relief)      Mars — NASA/USGS Viking
//   Jupiter — NASA/JPL/SSI Cassini                  Venus — NASA/JPL Magellan
//   Mercury — NASA/JHUAPL MESSENGER (enhanced colour)
//   Europa — NASA/JPL/USGS Voyager + Galileo        Pluto — NASA/JHUAPL New Horizons
//   Enceladus — NASA/JPL/SSI/LPI Cassini
// Saturn's and Neptune's bands and Earth's clouds are simulated.
//
// Each is lit by the spine it goes round: a day side, a night side, a band of
// dusk between them. What it has besides is below: air, seas that glint, clouds
// and their shadows, cities, winds, aurorae, moons and the shadows they cast,
// Saturn's rings, Enceladus's plumes.

import type * as THREE_NS from "three";

export type Moon = {
  /** Radius and distance, in the world's own radii. */
  r: number;
  d: number;
  /** How its path is tilted, where on it it begins, and turns a second. */
  tilt: number;
  at: number;
  speed: number;
  tint: [number, number, number];
};

export type World = {
  id: string;
  /** A second picture: clouds above, lights of cities below. */
  extra?: boolean;
  /** The colour of its air, and how much of it there is. */
  air: [number, number, number];
  airK: number;
  /** How much its own map stands out in relief. */
  bump: number;
  /** Winds: how far its bands slide past one another. */
  winds: number;
  /** Water that glints. */
  sea: number;
  aurora: number;
  plume: number;
  rings: boolean;
  moons: Moon[];
  /** Its axis, leaning; and turns a second. */
  lean: number;
  spin: number;
  /** How bright it is drawn. */
  gain: number;
};

const none = { airK: 0, air: [1, 1, 1] as [number, number, number], bump: 0, winds: 0, sea: 0, aurora: 0, plume: 0, rings: false, moons: [] as Moon[], lean: 0.12, spin: 0.018, gain: 1 };

const ALL: Record<string, World> = {
  earth: { ...none, id: "earth", extra: true, air: [0.3, 0.58, 1], airK: 1, bump: 0.35, sea: 1, aurora: 1, lean: 0.41, spin: 0.022, gain: 1.16, moons: [{ r: 0.2, d: 1.95, tilt: 0.3, at: 0.1, speed: 0.045, tint: [0.62, 0.6, 0.57] }] },
  saturn: { ...none, id: "saturn", air: [1, 0.86, 0.6], airK: 0.3, winds: 0.5, rings: true, lean: 0.32, spin: 0.03, gain: 1, moons: [{ r: 0.055, d: 2.5, tilt: 0.06, at: 0.4, speed: 0.05, tint: [0.85, 0.62, 0.3] }] },
  mars: { ...none, id: "mars", air: [1, 0.66, 0.45], airK: 0.38, bump: 1, lean: 0.44, gain: 1.3, moons: [{ r: 0.05, d: 1.5, tilt: 0.12, at: 0.2, speed: 0.12, tint: [0.45, 0.38, 0.33] }, { r: 0.035, d: 2.1, tilt: 0.2, at: 0.7, speed: 0.06, tint: [0.5, 0.45, 0.4] }] },
  jupiter: { ...none, id: "jupiter", air: [1, 0.8, 0.62], airK: 0.25, winds: 1, aurora: 0.7, lean: 0.06, spin: 0.032, gain: 1.12, moons: [{ r: 0.06, d: 1.55, tilt: 0.05, at: 0.15, speed: 0.11, tint: [0.9, 0.78, 0.4] }, { r: 0.05, d: 1.95, tilt: -0.06, at: 0.55, speed: 0.075, tint: [0.82, 0.8, 0.76] }, { r: 0.075, d: 2.4, tilt: 0.04, at: 0.85, speed: 0.05, tint: [0.5, 0.46, 0.42] }] },
  europa: { ...none, id: "europa", air: [0.7, 0.85, 1], airK: 0.12, bump: 0.55, lean: 0.1, gain: 0.82 },
  venus: { ...none, id: "venus", air: [1, 0.72, 0.36], airK: 0.95, bump: 0.8, winds: 0.12, lean: 0.05, spin: -0.012, gain: 1.35 },
  neptune: { ...none, id: "neptune", air: [0.38, 0.62, 1], airK: 0.8, winds: 0.8, lean: 0.49, spin: 0.026, gain: 1.35, moons: [{ r: 0.09, d: 2, tilt: 0.45, at: 0.3, speed: -0.05, tint: [0.78, 0.72, 0.7] }] },
  mercury: { ...none, id: "mercury", bump: 1, lean: 0.02, spin: 0.014, gain: 1.2 },
  moon: { ...none, id: "moon", bump: 0.7, lean: 0.12, spin: 0.014, gain: 1.05 },
  pluto: { ...none, id: "pluto", air: [0.55, 0.72, 1], airK: 0.42, bump: 0.8, lean: 0.3, gain: 1.05, moons: [{ r: 0.34, d: 1.9, tilt: 0.28, at: 0.6, speed: 0.035, tint: [0.5, 0.47, 0.45] }] },
  enceladus: { ...none, id: "enceladus", air: [0.72, 0.9, 1], airK: 0.1, bump: 0.6, plume: 1, lean: 0.14, gain: 0.86 },
};

/** In the order the cards come. */
const ORDER = ["earth", "saturn", "mars", "jupiter", "europa", "venus", "neptune", "mercury", "pluto", "moon", "enceladus"];

export const worldFor = (i: number): World => ALL[ORDER[((i % ORDER.length) + ORDER.length) % ORDER.length]];

/* ── Their pictures: fetched once, decoded off the main thread, kept ─────── */

const pictures = new Map<string, Promise<ImageBitmap | null>>();
const here = new Map<string, ImageBitmap>();

function picture(name: string): Promise<ImageBitmap | null> {
  let p = pictures.get(name);
  if (!p) {
    p = fetch(`/dev/worlds/${name}.webp`)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => createImageBitmap(b, { imageOrientation: "flipY", premultiplyAlpha: "none", colorSpaceConversion: "none" }))
      .then((bmp) => {
        here.set(name, bmp);
        return bmp;
      })
      .catch(() => {
        pictures.delete(name);
        return null;
      });
    pictures.set(name, p);
  }
  return p;
}

const file = (w: World, phone: boolean, extra = false) => `${w.id}${extra ? "_x" : ""}${phone ? "_s" : ""}`;

/** Ask for a world's pictures. */
export function fetchWorld(w: World, phone: boolean): Promise<unknown> {
  return Promise.all([picture(file(w, phone)), w.extra ? picture(file(w, phone, true)) : null]);
}

/** …and have them, if they have come. */
export function worldPictures(w: World, phone: boolean): { map: ImageBitmap; extra: ImageBitmap | null } | null {
  const map = here.get(file(w, phone));
  if (!map) return null;
  return { map, extra: w.extra ? (here.get(file(w, phone, true)) ?? null) : null };
}

/** A texture on a drawing surface, its picture still to be put in. */
export function worldTexture(THREE: typeof THREE_NS, phone: boolean): THREE_NS.Texture {
  const t = new THREE.Texture();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.flipY = false;
  t.anisotropy = phone ? 2 : 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}
