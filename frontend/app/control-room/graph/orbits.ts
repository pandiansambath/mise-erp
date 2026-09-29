// Ordered orbits — where every body on the map goes, as plain geometry.
//
//     "i dont like the UI UX of map feature in controlroom.... its clumsy tight
//      and not ordered arranged"
//
// The previous map was a circle-pack: every restaurant squeezed edge to edge
// inside one ring, positions shuffling between loads, most bubbles unnamed. It
// was tight in the middle and empty everywhere else, and it had no order a
// reader could name. A designer's review of the live screen (29 Sep, 41
// screenshots) put the fix in one sentence: give it two readable axes.
//
//   · WHICH RING says what state something is in — busy, quiet, not started.
//   · CLOCKWISE FROM 12 says its rank within that state.
//
// Positions are CALCULATED, never clamped or jittered: the same data always
// lands in the same place, so "where is NIRAI" is never a search. And the whole
// thing is checked for overlap before it is returned — a map that has been told
// overlap is impossible is one that can still produce it, which is how six
// superimposed labels once reached a screenshot.
//
// Scene coordinates are centred on (0, 0), which is what `camera.ts` expects.

import type { GraphNode } from "./geometry";
import { areaLabel } from "./areas";

export type BodyKind = "restaurant" | "public" | "operator" | "area" | "polling" | "more";

export type Item = {
  id: string;
  label: string;
  /** The one number under the name. */
  sub: string;
  kind: BodyKind;
  load: number;
  ai: number;
  errors: number;
  /** Signed up, never used. Drawn hollow, never as a big empty sphere. */
  idle: boolean;
  /** What is inside it — drawn as real inner bubbles, not decoration. */
  inner: { id: string; weight: number }[];
  node?: GraphNode;
  area?: string;
  /** For a "+N more" body: what it stands for. */
  hidden?: Item[];
};

export type Body = Item & {
  x: number;
  y: number;
  r: number;
  ring: number;
  /** How far the name plate slid sideways to stay on the stage. */
  dx?: number;
};

export type Ring = { key: string; label: string; rx: number; ry: number; count: number };

export type Layout = {
  /** Phone-shaped stage: ring names go in a legend row, not on the rings. */
  portrait: boolean;
  /** Small bodies show their name only; the number moves to the hover card. */
  compact: boolean;
  core: { label: string; sub: string; r: number };
  rings: Ring[];
  bodies: Body[];
  /** Pairs of ids that still overlap. Always empty; reported rather than hidden. */
  overlaps: string[];
};

export type Group = { key: string; label: string; items: Item[] };

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** Two restaurants both called "NIRAI" must not look like one. */
export function disambiguate(nodes: GraphNode[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const n of nodes) count.set(n.label, (count.get(n.label) ?? 0) + 1);
  const out = new Map<string, string>();
  for (const n of nodes) {
    const handle = String(n.detail?.handle ?? "");
    out.set(n.id, (count.get(n.label) ?? 0) > 1 && handle ? `${n.label} · ${handle}` : n.label);
  }
  return out;
}

// ── what goes on which ring ──────────────────────────────────────────────

/** The whole platform: restaurants by state, and the two things that are
 *  traffic but not a restaurant. */
export function platformGroups(nodes: GraphNode[]): { groups: Group[]; satellites: Item[] } {
  const restaurants = nodes.filter((n) => n.kind === "restaurant");
  const names = disambiguate(restaurants);
  const total = restaurants.reduce((t, n) => t + (Number(n.metrics?.requests) || 0), 0);
  // BUSY is a share of the platform, not a fixed number — a threshold of "500
  // requests" means nothing in a 7-day window and everything in a 90-day one.
  const busyAt = Math.max(1, total * 0.05);

  const toItem = (n: GraphNode): Item => {
    const req = Number(n.metrics?.requests) || 0;
    const ai = Number(n.metrics?.ai_calls) || 0;
    const areas = (n.detail?.areas as { area: string; requests: number }[] | undefined) ?? [];
    // "signed up 12 Sep" rather than "signed up · not started": the ring is
    // already labelled NOT STARTED, so saying it again only made the widest
    // name plate on the map — and WHEN they signed up is the useful part.
    const created = String(n.detail?.created_at ?? "");
    const since = created
      ? `signed up ${new Date(created).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
      : "not started";
    return {
      id: n.id,
      label: names.get(n.id) ?? n.label,
      sub: req ? `${fmt(req)} req${ai ? ` · ${fmt(ai)} AI` : ""}` : since,
      kind: "restaurant",
      load: req,
      ai,
      errors: Number(n.metrics?.errors_5xx) || 0,
      idle: req === 0,
      inner: areas.map((a) => ({ id: a.area, weight: a.requests })),
      node: n,
    };
  };

  const items = restaurants.map(toItem).sort((a, b) => b.load - a.load || a.label.localeCompare(b.label));
  const groups: Group[] = [
    { key: "busy", label: "BUSY", items: items.filter((i) => i.load >= busyAt) },
    { key: "quiet", label: "QUIET", items: items.filter((i) => i.load > 0 && i.load < busyAt) },
    { key: "idle", label: "NOT STARTED", items: items.filter((i) => i.load === 0) },
  ];

  const satellites: Item[] = [];
  for (const kind of ["anonymous", "operator"] as const) {
    const n = nodes.find((x) => x.kind === kind);
    if (!n) continue;
    const req = Number(n.metrics?.requests) || 0;
    satellites.push({
      id: n.id,
      label: n.label,
      sub: `${fmt(req)} req · not a restaurant`,
      kind: kind === "anonymous" ? "public" : "operator",
      load: req,
      ai: 0,
      errors: Number(n.metrics?.errors_5xx) || 0,
      idle: false,
      inner: [],
      node: n,
    });
  }
  return { groups, satellites };
}

/** Inside one restaurant: its areas, by how much it uses each. */
export function restaurantGroups(n: GraphNode): { groups: Group[]; satellites: Item[] } {
  const areas = (n.detail?.areas as { area: string; requests: number }[] | undefined) ?? [];
  const total = areas.reduce((t, a) => t + a.requests, 0);
  const busyAt = Math.max(1, total * 0.1);
  const items: Item[] = areas
    .map((a) => ({
      id: `${n.id}::${a.area}`,
      label: areaLabel(a.area),
      sub: `${fmt(a.requests)} req`,
      kind: "area" as const,
      load: a.requests,
      ai: 0,
      errors: 0,
      idle: false,
      inner: [],
      area: a.area,
    }))
    .sort((a, b) => b.load - a.load || a.label.localeCompare(b.label));

  const satellites: Item[] = [];
  const polled = Number(n.detail?.polled_requests) || 0;
  if (polled > 0) {
    // Real traffic that costs real money and is nobody's choice — the
    // notification bell asking every 45 seconds. Shown apart, honestly,
    // rather than left out or allowed to dominate the picture.
    satellites.push({
      id: `${n.id}::__polling`,
      label: "Background checks",
      sub: `${fmt(polled)} req · automatic`,
      kind: "polling",
      load: polled,
      ai: 0,
      errors: 0,
      idle: false,
      inner: [],
    });
  }
  return {
    groups: [
      { key: "busy", label: "USED MOST", items: items.filter((i) => i.load >= busyAt) },
      { key: "quiet", label: "USED LESS", items: items.filter((i) => i.load < busyAt) },
    ],
    satellites,
  };
}

// ── the geometry ─────────────────────────────────────────────────────────

/** Ramanujan's approximation — exact enough to space bodies along an ellipse. */
function perimeter(a: number, b: number): number {
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/** Hidden behind "+N more" across the whole layout. */
const folded = (L: Layout) =>
  L.bodies.reduce((t, b) => t + (b.kind === "more" ? b.hidden?.length ?? 0 : 0), 0);

const biggest = (L: Layout) => Math.max(0, ...L.bodies.map((b) => b.r));

export function layout(
  groups: Group[],
  satellites: Item[],
  core: { label: string; sub: string },
  W: number,
  H: number,
  spin = 0,
): Layout {
  // TWO STRATEGIES, AND THE CLEANER RESULT WINS. Shrinking spheres cures a
  // collision between spheres; folding a quiet item into "+N more" cures one
  // between name plates, which shrinking cannot touch. Neither is always
  // right — folding alone hid 7 of 9 areas on a phone, and made the phone
  // platform view WORSE — so both run, and the answer with fewer overlaps
  // wins, then the one hiding fewer things.
  //
  // THEN, ONLY IF BOTH STILL COLLIDE: compact plates. On a short stage the
  // rings sit so close that two-line name plates stack into each other, and
  // no amount of shrinking cures text. So small bodies keep their NAME and
  // drop the second line — the number is still one hover or tap away. The
  // name itself is never dropped: an unnamed bubble is what he rejected.
  const tries = [
    place(groups, satellites, core, W, H, spin, false, false),
    place(groups, satellites, core, W, H, spin, true, false),
  ];
  const full = Math.max(24, 64 * Math.max(0.55, Math.min(W, H) / 780));
  const clean = (L: Layout) => L.overlaps.length === 0 && biggest(L) >= 0.8 * full;
  if (clean(tries[0])) return tries[0];
  if (!clean(tries[1])) {
    tries.push(
      place(groups, satellites, core, W, H, spin, false, true),
      place(groups, satellites, core, W, H, spin, true, true),
    );
  }
  // Fewest overlaps; then the one that kept its spheres big; then fewest
  // hidden; then keep the numbers if we can.
  return tries.reduce((best, L) => {
    if (L.overlaps.length !== best.overlaps.length) {
      return L.overlaps.length < best.overlaps.length ? L : best;
    }
    const a = biggest(L);
    const b = biggest(best);
    if (a > b * 1.5 || b > a * 1.5) return a > b ? L : best;
    if (folded(L) !== folded(best)) return folded(L) < folded(best) ? L : best;
    return best.compact && !L.compact ? L : best;
  });
}

function place(
  groups: Group[],
  satellites: Item[],
  core: { label: string; sub: string },
  W: number,
  H: number,
  spin: number,
  allowFold: boolean,
  compact: boolean,
): Layout {
  const portrait = W < 640 || H > W * 1.05;
  // Ellipses that FILL the stage. The old ring used ~40% of the width and left
  // the rest as grey margin — "tight" and "wasted" at the same time.
  // On a phone the rings are taller than wide. The spacing was chosen by
  // SWEEPING, not by eye: 5 phone widths × 18 stage heights × 4 fleet sizes.
  // The old [0.29, 0.37, 0.44] left the two inner rings 27px apart at 3
  // o'clock on a 360px phone and collided at 34 of 90 sizes on live data; this
  // spacing collides at none (only a 420px-tall stage, shorter than any phone
  // gives the map, still does). The core is an obstacle, so an inner ring
  // pulled close can never put a name plate into it unseen.
  const FX = portrait ? [0.22, 0.33, 0.44] : [0.19, 0.31, 0.43];
  const FY = portrait ? [0.18, 0.30, 0.41] : [0.21, 0.33, 0.44];
  const unit = Math.max(0.55, Math.min(W, H) / 780);
  const GAP = 10 * unit;

  const all = [...groups.flatMap((g) => g.items), ...satellites];
  const maxLoad = Math.max(1, ...all.map((i) => i.load));

  // ── shapes: a sphere, and — for a small one — the plate under it ──────
  //
  // ⚠️ The plate is a RECTANGLE below the sphere, not a bigger circle. The
  // first fix modelled a small body as a disc of r+32, which inflated every
  // one of them sideways and forced the whole map to shrink until the busiest
  // restaurant was 28px across — throwing away the one thing size is for.
  type Shape = { id: string; cx: number; cy: number; r: number; rect?: number[] };
  const shapeOf = (b: Body, inside: boolean): Shape => {
    if (inside) return { id: b.id, cx: b.x, cy: b.y, r: b.r + 3 };
    const pw = Math.max(b.label.length * 7.2, compact ? 0 : b.sub.length * 6.2) + 8;
    // A NAME NEAR THE EDGE SLIDES IN, like a tooltip; the sphere stays on its
    // ring. Centred plates at 3 and 9 o'clock ran "pandianshotel" off a phone.
    const lo = -W / 2 + 3 - (b.x - pw / 2);
    const hi = W / 2 - 3 - (b.x + pw / 2);
    b.dx = lo > 0 ? lo : hi < 0 ? hi : 0;
    return {
      id: b.id,
      cx: b.x,
      cy: b.y,
      r: b.r + 3,
      // Two lines (name + number) reach r+33; a compact plate is the name alone.
      rect: [b.x + b.dx - pw / 2, b.y + b.r + 1, b.x + b.dx + pw / 2, b.y + b.r + (compact ? 17 : 33)],
    };
  };
  const circleRect = (cx: number, cy: number, r: number, box: number[]) => {
    const nx = Math.max(box[0], Math.min(cx, box[2]));
    const ny = Math.max(box[1], Math.min(cy, box[3]));
    return Math.hypot(cx - nx, cy - ny) < r;
  };
  const rectRect = (a: number[], b: number[]) =>
    a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
  // THE EDGE OF THE STAGE IS AN OBSTACLE. The spheres were checked against
  // each other and never against the screen, so on a phone a name plate on
  // the outer ring ran off the left edge ("…gned up 21 Sept").
  const offStage = (s: Shape) => {
    const [x1, y1, x2, y2] = s.rect ?? [s.cx, s.cy, s.cx, s.cy];
    const left = Math.min(s.cx - s.r, x1);
    const right = Math.max(s.cx + s.r, x2);
    const top = Math.min(s.cy - s.r, y1);
    const bottom = Math.max(s.cy + s.r, y2);
    return left < -W / 2 + 2 || right > W / 2 - 2 || top < -H / 2 + 2 || bottom > H / 2 - 2;
  };
  const hit = (a: Shape, b: Shape) =>
    Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r ||
    (a.rect != null && circleRect(b.cx, b.cy, b.r, a.rect)) ||
    (b.rect != null && circleRect(a.cx, a.cy, a.r, b.rect)) ||
    (a.rect != null && b.rect != null && rectRect(a.rect, b.rect));

  let scale = 1;
  let result: Layout | null = null;
  // How many extra items each ring folds into its "+N more". A collision
  // between two NAME PLATES cannot be cured by shrinking spheres — the plates
  // are text — so a ring that still collides after turning gives up its
  // least-used item instead. Inner rings are placed first, so the ring that
  // pays is the outer, quieter one.
  const squeeze: number[] = [];

  // Turning a ring clears most collisions; folding and shrinking are fallbacks.
  for (let pass = 0; pass < 10; pass++) {
    const ringHit: boolean[] = [];
    const rMax = Math.max(24, 64 * unit * scale);
    const rMin = Math.max(12, 15 * unit * Math.max(scale, 0.8));
    const radius = (i: Item) =>
      i.idle || i.kind === "more"
        ? rMin + 2
        : rMin + (rMax - rMin) * Math.sqrt(Math.max(0, i.load) / maxLoad);
    // Only a restaurant or an area wears its name inside. The two corner
    // bodies carry long captions ("5,610 req · not a restaurant"), which were
    // drawn inside a 46px sphere and ran out past it on both sides.
    const inside = (r: number, it: Item) => r >= 44 && (it.kind === "restaurant" || it.kind === "area");

    const bodies: Body[] = [];
    const shapes: Shape[] = [];
    const rings: Ring[] = [];
    const coreR = portrait
      ? Math.max(26, Math.min(FY[0] * H * 0.42, 40 * unit))
      : Math.max(34, Math.min(FY[0] * H * 0.5, 58 * unit));
    // +12, not +8: the core wears a glow, and at +8 a name at 12 o'clock
    // ("Chat", inside a restaurant on a 360px phone) sat on its rim.
    shapes.push({ id: "__core", cx: 0, cy: 0, r: coreR + 12 });

    groups.forEach((g, gi) => {
      if (!g.items.length) return;
      const rx = FX[Math.min(gi, FX.length - 1)] * W;
      const ry = FY[Math.min(gi, FY.length - 1)] * H;
      const P = perimeter(rx, ry);

      let items = g.items;
      // Room per slot is the widest of the sphere and its plate — measured
      // from the actual words, not a flat allowance.
      const plateW = (i: Item) => Math.max(i.label.length * 7.2, i.sub.length * 6.2) + 8;
      const need =
        Math.max(
          ...items.map((i) => (inside(radius(i), i) ? 2 * radius(i) + 6 : Math.max(2 * radius(i), plateW(i)))),
        ) + GAP;
      const capacity = Math.max(2, Math.floor(P / need) - (squeeze[gi] ?? 0));
      if (items.length > capacity) {
        // "+N MORE" rather than a squashed row of unreadable dots.
        const keep = items.slice(0, capacity - 1);
        const rest = items.slice(capacity - 1);
        items = [
          ...keep,
          {
            id: `${g.key}::__more`,
            label: `+${rest.length} more`,
            sub: "tap to list them",
            kind: "more",
            load: 0,
            ai: 0,
            errors: 0,
            idle: false,
            inner: [],
            hidden: rest,
          },
        ];
      }

      // THE RING'S OWN LABEL IS AN OBSTACLE TOO. It sits at 12 o'clock just
      // outside the ring, and turning a ring could park a sphere right on it —
      // "QUIET · 6" disappeared under pppk exactly that way.
      // On a phone the rings are too close together to hold a label as well
      // as the spheres, so there the names move to a legend row instead
      // (see `portrait` on the result) and stop being an obstacle.
      if (!portrait) {
        const labelW = (g.label.length + 4) * 8 + 16;
        shapes.push({
          id: `__label-${g.key}`,
          cx: 0,
          cy: -ry - 9,
          r: 0,
          rect: [-labelW / 2, -ry - 22, labelW / 2, -ry + 4],
        });
      }

      const slot = (2 * Math.PI) / items.length;
      // TURN THE RING, don't shrink the map. Try a few phases — every one
      // still in rank order clockwise from just past 12, and deterministic —
      // and keep the first where this ring touches nothing already placed.
      // Eighths of a slot. Finer steps were tried and made the phone layout
      // WORSE: each ring picks greedily, so a cleverer turn on an inner ring
      // can block the next one out.
      const phases = [0, 0.5, 0.25, -0.25, 0.125, -0.125, 0.375, -0.375].map((f) => f * slot);
      let best: { placed: Body[]; placedShapes: Shape[]; hits: number } | null = null;
      for (const ph of phases) {
        const placed: Body[] = [];
        const placedShapes: Shape[] = [];
        items.forEach((it, k) => {
          // Half a slot of offset keeps 12 o'clock clear for the ring's label.
          const a = -Math.PI / 2 + slot / 2 + k * slot + spin + ph;
          const r = radius(it);
          const b: Body = { ...it, x: rx * Math.cos(a), y: ry * Math.sin(a), r, ring: gi };
          placed.push(b);
          placedShapes.push(shapeOf(b, inside(r, it)));
        });
        let n = 0;
        for (let i = 0; i < placedShapes.length; i++) {
          if (offStage(placedShapes[i])) n++;
          for (const s of shapes) if (hit(placedShapes[i], s)) n++;
          for (let j = i + 1; j < placedShapes.length; j++) {
            if (hit(placedShapes[i], placedShapes[j])) n++;
          }
        }
        if (!best || n < best.hits) best = { placed, placedShapes, hits: n };
        if (n === 0) break;
      }
      if (best) {
        bodies.push(...best.placed);
        shapes.push(...best.placedShapes);
        if (best.hits > 0) ringHit[gi] = true;
      }
      rings.push({ key: g.key, label: g.label, rx, ry, count: g.items.length });
    });

    // The things that are traffic but not a restaurant: the corners, off
    // every ring, so nobody mistakes them for one. The TOP corner first; on a
    // short phone stage the outer ring's crown reaches it ("CSK dhabha" sat
    // under "Control Room"), so the bottom corner is the fallback.
    satellites.forEach((s, i) => {
      const r = Math.min(radius(s), rMax * 0.8);
      const side = i % 2 === 0 ? -1 : 1;
      // In from the edge by the width of the name plate, not just the
      // sphere — "5,606 req · not a restaurant" is ~180px wide and was cut
      // off at both edges of the screen.
      const x = side * (W / 2 - Math.max(r + 16, 100));
      const top = -(H / 2 - r - 30 * unit);
      const bottom = H / 2 - r - (compact ? 17 : 33) - 6;
      const tries = [top, bottom].map((y) => {
        const b: Body = { ...s, r, ring: -1, x, y };
        const sh = shapeOf(b, false);
        return { b, sh, n: shapes.filter((o) => hit(sh, o)).length + (offStage(sh) ? 1 : 0) };
      });
      const pick = tries[0].n === 0 || tries[0].n <= tries[1].n ? tries[0] : tries[1];
      bodies.push(pick.b);
      shapes.push(pick.sh);
    });

    const hits: string[] = [];
    for (const s of shapes) {
      if (!s.id.startsWith("__label") && offStage(s)) hits.push(`${s.id}×__edge`);
    }
    for (let i = 0; i < shapes.length; i++) {
      for (let j = i + 1; j < shapes.length; j++) {
        if (hit(shapes[i], shapes[j])) hits.push(`${shapes[i].id}×${shapes[j].id}`);
      }
    }
    result = { portrait, compact, core: { ...core, r: coreR }, rings, bodies, overlaps: hits };
    if (!hits.length) break;
    // Fold before shrinking — but only a ring with more than two things on
    // it, and never the busiest ring's top items out of sight.
    // At most a third of a ring folds away: past that, "+N more" is hiding the
    // map rather than tidying it.
    let foldedOne = false;
    if (allowFold) {
      groups.forEach((g, gi) => {
        const s = squeeze[gi] ?? 0;
        if (ringHit[gi] && gi > 0 && s < Math.ceil(g.items.length / 3) && g.items.length - s > 2) {
          squeeze[gi] = s + 1;
          foldedOne = true;
        }
      });
    }
    if (!foldedOne) scale *= 0.9;
  }
  return result as Layout;
}
