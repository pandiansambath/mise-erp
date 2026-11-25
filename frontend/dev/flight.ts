// How the page flies (§108.2): scrolling is moving on through space, and what is in the background
// (the dust and the water: DustField; the words: ChainField) goes by at one speed. DustField tells.

export const flight = {
  /** How far, since the page opened. */
  z: 0,
  /** How fast: 0 at rest, 1 all it can. */
  v: 0,
};
