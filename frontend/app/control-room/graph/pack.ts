/** A deterministic circle pack, and the bill as the rim around it.
 *
 *     "the sahpes are not nice use bubbles instead please bubbule wil be
 *      imprssive to look like bubbuel inside that anothe bublles"
 *
 *  CONTAINMENT MEANS SUMMATION, and that is the whole justification for
 *  nesting anything. There is exactly one containment relation in this data
 *  that is TRUE:
 *
 *      a bubble contains the things whose numbers add up to its own.
 *
 *  Every request belongs to one restaurant; within a restaurant to one area;
 *  within an area it is a read or a write. Areas sum to the restaurant,
 *  restaurants sum to the platform. So a pack where a child's AREA (πr², not
 *  r) is its share of the parent's is not a picture of a hierarchy — it IS
 *  the arithmetic, drawn. Zooming in is division.
 *
 *  A circle that cannot pass that test does not get drawn nested, which is
 *  why AWS services and AI models are NOT inside a restaurant: a model is
 *  shared and a restaurant's share of the box is a split of rent, not a
 *  measurement. Drawing Bedrock inside NIRAI would assert something false.
 *  The demand side nests; the supply side is the container.
 *
 *  DETERMINISTIC, NOT A FORCE SIMULATION. The same data must produce the
 *  same picture — an operator who reloads and finds his restaurants
 *  rearranged cannot learn the shape of his own platform. No d3, no ticker,
 *  no settling.
 */

export type PackInput = {
  id: string;
  /** What the size means. Area is proportional to this. */
  weight: number;
};

export type Packed = PackInput & { x: number; y: number; r: number };

/** Nothing smaller than this across. Below ~44px a bubble cannot hold a tap
 *  target, let alone a label, and a map of unreadable dots is a worse answer
 *  than a map that admits it has too much in it. */
export const MIN_D = 44;

/**
 * Pack circles inside a circle of radius `R` centred at the origin.
 *
 * SPIRAL PLACEMENT, LARGEST FIRST. Each circle is pushed out along a golden
 * spiral until it touches nothing — the same idea as a phyllotaxis, which is
 * why it looks organic without anybody simulating anything. Largest first
 * because a big circle placed late has nowhere to go, and the failure mode of
 * "nowhere to go" is the overlap this whole file exists to prevent.
 */
export function packInCircle(items: PackInput[], R: number): Packed[] {
  if (!items.length) return [];

  const total = items.reduce((a, i) => a + Math.max(0, i.weight), 0) || 1;

  // AREA IS THE SHARE, so the radius is its square root. This is the line
  // that makes containment mean summation: two children whose weights add to
  // the third's cover the same area as it does.
  //
  // 0.62 is the packing budget: circles cannot tile a circle, and claiming
  // 100% of the parent's area produces a pack that cannot close. Hexagonal
  // packing tops out near 0.9 for equal circles and well below that for a
  // spread of sizes; 0.62 leaves room to breathe without looking sparse.
  const budget = Math.PI * R * R * 0.62;
  const sized = items
    .map((i) => ({
      ...i,
      r: Math.max(MIN_D / 2, Math.sqrt((Math.max(0, i.weight) / total) * budget / Math.PI)),
    }))
    .sort((a, b) => b.r - a.r);

  // THE FLOOR CAN OVERFLOW THE PARENT, and that is not a reason to clamp.
  //
  // A clamp is what produced six superimposed labels on the live map: it is
  // many-to-one, so everything that does not fit lands in the same place.
  // When the floors alone exceed the budget, every radius is scaled by one
  // factor — ratios survive exactly, and a smaller bubble is legible where
  // two bubbles at one point are not.
  const need = sized.reduce((a, c) => a + Math.PI * c.r * c.r, 0);
  if (need > budget) {
    const k = Math.sqrt(budget / need);
    for (const c of sized) c.r *= k;
  }

  const out: Packed[] = [];
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  for (const c of sized) {
    let placed = false;
    // Walk outwards along the spiral. The step is a fraction of this
    // circle's own radius, so a small circle probes finely and a large one
    // does not waste a thousand iterations finding the same gap.
    for (let i = 0; i < 4000 && !placed; i++) {
      const t = i * GOLDEN;
      const rad = (Math.sqrt(i) / Math.sqrt(4000)) * Math.max(0, R - c.r);
      const x = Math.cos(t) * rad;
      const y = Math.sin(t) * rad;
      if (Math.hypot(x, y) + c.r > R) continue;
      if (out.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + c.r + 2)) {
        out.push({ ...c, x, y });
        placed = true;
      }
    }
    // NOWHERE AT THIS SIZE? SHRINK UNTIL THERE IS.
    //
    // The first version tried ONE smaller size and, if that failed too, fell
    // through — silently dropping the circle. A test against his real fleet
    // placed 12 of 13: a restaurant simply missing from the map of
    // restaurants, which is the worst outcome available here and the exact
    // thing the comment claimed it was avoiding.
    //
    // This loop cannot exit without placing: each pass halves the radius, and
    // a circle of 4px always fits somewhere inside a field that already holds
    // the others. Drawn small and findable beats absent.
    for (let shrink = 0.6; !placed && shrink > 0.02; shrink *= 0.6) {
      const small = { ...c, r: Math.max(4, c.r * shrink) };
      for (let i = 0; i < 4000 && !placed; i++) {
        const t = i * GOLDEN;
        const rad = (Math.sqrt(i) / Math.sqrt(4000)) * Math.max(0, R - small.r);
        const x = Math.cos(t) * rad;
        const y = Math.sin(t) * rad;
        if (out.every((o) => Math.hypot(o.x - x, o.y - y) >= o.r + small.r + 2)) {
          out.push({ ...small, x, y });
          placed = true;
        }
      }
    }
    if (!placed) {
      // Truly nowhere — which should be unreachable, and is asserted by the
      // caller rather than trusted. Better a visible mark at the rim than a
      // restaurant that does not exist on a map of restaurants.
      out.push({ ...c, r: 4, x: 0, y: Math.max(0, R - 6) });
    }
  }

  return out;
}

/** Overlapping pairs, by id. Runs in PRODUCTION on this map: the previous
 *  layout's only check was compiled out of the shipping build, which is
 *  exactly why six labels on top of each other survived to a screenshot. */
export function overlaps(packed: Packed[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < packed.length; i++) {
    for (let j = i + 1; j < packed.length; j++) {
      const a = packed[i];
      const b = packed[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5) {
        bad.push(`${a.id}↔${b.id}`);
      }
    }
  }
  return bad;
}

export type Arc = {
  id: string;
  label: string;
  usd: number;
  /** Radians along the rim. */
  from: number;
  to: number;
  pool: string;
};

/**
 * The AWS bill as arcs around the rim.
 *
 * THE BILL IS THE RIM AND NOT NINE MORE BUBBLES, for three reasons that all
 * come back to what he asked for:
 *
 *  1. It is the only CLOSED PARTITION on the page. Nine bubbles say "here
 *     are nine numbers"; a band whose whole circumference IS the total says
 *     "these nine things ARE the bill", which is half of "both need to
 *     match" done before anybody reads a digit.
 *  2. It costs no interior space. The hexagons occupied about 45% of the
 *     canvas to show nine figures — that is the wasted-rail complaint, and
 *     moving them to the border the page already has is a structural answer
 *     rather than a nudge.
 *  3. It is true. Nothing on this platform runs outside the bill, so drawing
 *     it as the outermost enclosure is the one piece of containment here
 *     that is literally physical.
 */
export function billArcs(
  lines: { service: string; label: string; usd: number; pool: string }[],
  startAt = -Math.PI / 2,
): Arc[] {
  const live = lines.filter((l) => l.usd > 0);
  const total = live.reduce((a, l) => a + l.usd, 0);
  if (!total) return [];

  // A 2px hairline between arcs, expressed in radians, so adjacency reads
  // without a legend. Deliberately not a gap per arc — that would make the
  // sum of the arcs visibly less than the circumference, which is the one
  // thing this shape must not do.
  const gap = 0.006;
  let at = startAt;
  return live
    .sort((a, b) => b.usd - a.usd)
    .map((l) => {
      const span = (l.usd / total) * (Math.PI * 2);
      const arc: Arc = {
        id: l.service,
        label: l.label,
        usd: l.usd,
        from: at + gap / 2,
        to: at + span - gap / 2,
        pool: l.pool,
      };
      at += span;
      return arc;
    });
}
