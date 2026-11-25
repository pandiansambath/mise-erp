// The balls that have come to the skeleton (§106.13): handed from the cards (CardGL), which
// know where they are, to the skeleton (CrystalSpine), which takes them in.
//
// A ball near the bones cannot be drawn on its card's canvas: that canvas is behind the
// skeleton (on a phone, before it), and a ball that goes INTO the bones has to be among them —
// bones standing in it, bones standing out of it. So, closed, and come within the skeleton's
// lane, it is let go by its card and drawn there, the very same ball, until it is gone.

import type { CardTheme } from "./cardScene";

export type Guest = {
  /** Whose it is (the same from frame to frame). */
  key: object;
  /** Its middle on the screen, and its radius there (px). */
  x: number;
  y: number;
  r: number;
  /** How far it has melted (0 whole, 1 gone), and how far the light of it has died down since. */
  d: number;
  past: number;
  /** It is closed, and the skeleton draws it (else only what streams from it, or to it). */
  ball: boolean;
  /** How far it has come since its card let go of it (0…1). */
  come: number;
  hue: readonly number[];
  seed: number;
  spin: number;
  side: number;
  bright: number;
  /** Its card's clock, its card's size, its radius before any of that is made smaller. */
  t: number;
  w: number;
  h: number;
  R: number;
};

/** The skeleton: whether it can take a ball, and half how wide its canvas is. */
export const host = { ready: false, half: 0 };

/** What a card is dressed in: its theme, and the picture its water is made of. */
export const dress: { theme: CardTheme | null; liquid: string | null; version: number } = { theme: null, liquid: null, version: 0 };

const NONE: Guest[] = [];
let from: ((sy: number) => Guest[]) | null = null;

/** The cards say where theirs are: the skeleton asks, at the moment it draws (the page scrolls
 *  between one canvas's frame and the next). */
export function giveGuests(f: ((sy: number) => Guest[]) | null) {
  from = f;
}
export function guestsAt(sy: number): Guest[] {
  return from ? from(sy) : NONE;
}
