/** Where every node sits — SOLVED, not simulated, and not guessed either.
 *
 *  ⚠️ NAMED `geometry.ts`, NOT `layout.ts`. Inside `app/`, `layout.*` is a
 *  RESERVED Next.js App Router filename: the router treats any such file as a
 *  route layout and requires a default-exported React component. A module of
 *  pure maths called `layout.ts` therefore fails the build with
 *  "Property 'default' is missing ... in type LayoutConfig" — and only at
 *  `next build`, because `tsc --noEmit` and `npm run lint` both pass. It cost a
 *  deploy.
 *
 *  WHAT WAS HERE BEFORE, AND WHY IT PUT A RESTAURANT INSIDE ANOTHER NODE
 *  ------------------------------------------------------------------------
 *  Two hemispheres on arcs. Tenants got `-0.78π … -1.18π`, non-tenants got
 *  `+0.80π … +1.16π`. Normalised those are 140.4°…212.4° and 144.0°…208.8° —
 *  THE SAME 70° WEDGE, DRAWN TWICE. `-1.18π` and `+0.80π` are four degrees
 *  apart, not half a turn. The "separate band with a visible gap" was written
 *  and then cancelled by a sign.
 *
 *  Measured consequence: NIRAI.Reading was drawn 18.1px from Public traffic
 *  with 91px of combined radius — one of three restaurants entirely inside
 *  another node, its only trace a stray "14" under a grey disc. Labels were
 *  clipped mid-word because neighbours sat on them, and the model node was
 *  placed at `bedrock.x + 128`, which is a coordinate derived from a NEIGHBOUR:
 *  the model's position was a function of the AWS bill's sort order, and it
 *  left the canvas below about 1150px.
 *
 *  THE FIX IS STRUCTURAL, NOT A COLLISION PASS
 *  ------------------------------------------------------------------------
 *  Four columns, and the column widths are SOLVED FROM THE MEASURED LABELS
 *  rather than assigned as fractions. Within a column x is constant, so the
 *  only constraint is a vertical pitch that is computed; between columns the
 *  solve leaves hundreds of pixels. Overlap stops being something an algorithm
 *  tries to avoid and becomes something the arithmetic cannot produce.
 *
 *  And the labels move OUT of the nodes and sit beside them. That one change
 *  kills every truncation, drops the vertical pitch to circle-diameter only,
 *  and frees the node interior — which is what makes "more graphical" possible
 *  at all.
 *
 *  Still deterministic: same payload, same picture, every morning. He opens
 *  this daily, and a layout that settles differently each load makes "where is
 *  NIRAI" a search task forever.
 */

export type GraphNode = {
  id: string;
  kind: string;
  label: string;
  detail?: Record<string, unknown>;
  metrics?: Record<string, number | null>;
  channels?: Record<string, { measured: boolean; fired: boolean; value: number | null }>;
  severed?: boolean;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  weight: number;
  measured: boolean;
  label: string | null;
  latency_ms: number | null;
};

export type Placed = GraphNode & {
  x: number;
  y: number;
  r: number;
  /** Which way the label points: -1 left of the node, 0 inside, 1 right. */
  anchor: -1 | 0 | 1;
  col: "A" | "B" | "C" | "D";
  sub: string;
};

const DEMAND = new Set(["restaurant", "anonymous", "orphan", "operator"]);

/** Area, not width. A node with ten times the traffic should look ten times the
 *  AREA — scaling the radius linearly would put it off the canvas. The floor is
 *  a readability floor: a quiet node still has to be clickable and still has to
 *  look like a peer of the busy ones, because "quiet" must never read as
 *  "broken". */
export function radiusFor(kind: string, value: number, biggest: number): number {
  if (kind === "platform") return 44;
  const floor = kind === "model" ? 22 : 24;
  const ceiling = kind === "restaurant" || kind === "anonymous" ? 46 : 38;
  if (!biggest || value <= 0) return floor;
  return floor + (ceiling - floor) * Math.sqrt(Math.min(1, value / biggest));
}

function weightOf(n: GraphNode): number {
  const m = n.metrics ?? {};
  if (n.kind === "service") return Math.abs(Number(m.usd ?? 0));
  if (n.kind === "model") return Number(m.calls ?? 0);
  return Number(m.requests ?? 0) + Number(m.ai_calls ?? 0);
}

/** The line under each node. Words, never a bare zero — "nothing yet" and "0"
 *  are different claims and only one of them is something we know. */
export function subtitleFor(n: GraphNode): string {
  const m = n.metrics ?? {};
  if (n.kind === "service") return `$${Number(m.usd ?? 0).toFixed(2)}`;
  if (n.kind === "model") {
    const tok = Number(m.tokens ?? 0);
    return `${Number(m.calls ?? 0).toLocaleString()} calls · ${
      tok > 999 ? `${Math.round(tok / 1000)}k` : tok
    } tokens`;
  }
  if (n.kind === "platform") return "";
  const req = Number(m.requests ?? 0);
  const ai = Number(m.ai_calls ?? 0);
  if (!req && !ai) return "ready · nothing yet";
  if (!req && ai) return `no HTTP · ${ai} AI calls`;
  if (req && !ai) return `${req.toLocaleString()} req · no AI yet`;
  return `${req.toLocaleString()} req · ${ai} AI calls`;
}

type ColKey = "A" | "B" | "C" | "D";

/** Measured text widths, supplied by the renderer. Estimating them is what
 *  produced seven clipped labels, so the caller measures the element that
 *  actually renders and passes the map in. Missing entries fall back to a
 *  per-character estimate rather than throwing. */
export type Widths = Map<string, number>;

const PAD = 12;
const G_MIN = 18;
const G_BAND = 54;

function widthOf(w: Widths, s: string, px = 7.1): number {
  return w.get(s) ?? s.length * px;
}

export function layout(
  nodes: GraphNode[],
  w: number,
  h: number,
  widths: Widths = new Map(),
): { placed: Placed[]; byId: Map<string, Placed> } {
  const M = 20;
  const U = { x: M, y: M, w: Math.max(320, w - M * 2), h: Math.max(240, h - M * 2) };

  const cols: Record<ColKey, GraphNode[]> = { A: [], B: [], C: [], D: [] };
  for (const n of nodes) {
    if (n.kind === "platform") cols.B.push(n);
    else if (DEMAND.has(n.kind)) cols.A.push(n);
    else if (n.kind === "model") cols.D.push(n);
    else cols.C.push(n);
  }

  // Stable order: busiest first inside each group, and tenants above the band.
  const rank = (n: GraphNode) => -weightOf(n);
  const tenants = cols.A.filter((n) => n.kind === "restaurant").sort((a, b) => rank(a) - rank(b));
  const others = cols.A.filter((n) => n.kind !== "restaurant").sort((a, b) => rank(a) - rank(b));
  cols.A = [...tenants, ...others];
  cols.C.sort((a, b) => rank(a) - rank(b));
  cols.D.sort((a, b) => rank(a) - rank(b));

  const biggest: Record<string, number> = {};
  for (const n of nodes) {
    const k = n.kind === "service" ? "service" : n.kind === "model" ? "model" : "demand";
    biggest[k] = Math.max(biggest[k] ?? 0, weightOf(n));
  }
  const radiusOf = (n: GraphNode) =>
    radiusFor(
      n.kind,
      weightOf(n),
      biggest[n.kind === "service" ? "service" : n.kind === "model" ? "model" : "demand"] ?? 1,
    );

  // ── horizontal: SOLVE the footprints, never guess fractions ─────────────
  const rMax: Record<ColKey, number> = { A: 0, B: 0, C: 0, D: 0 };
  const labelW: Record<ColKey, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const key of ["A", "B", "C", "D"] as ColKey[]) {
    for (const n of cols[key]) {
      rMax[key] = Math.max(rMax[key], radiusOf(n));
      labelW[key] = Math.max(
        labelW[key],
        widthOf(widths, n.label, 7.4),
        widthOf(widths, subtitleFor(n), 6.2),
      );
    }
  }

  const need: Record<ColKey, number> = {
    A: cols.A.length ? labelW.A + PAD + 2 * rMax.A : 0,
    B: cols.B.length ? 2 * rMax.B : 0,
    C: cols.C.length ? 2 * rMax.C + PAD + labelW.C : 0,
    D: cols.D.length ? 2 * rMax.D + PAD + labelW.D : 0,
  };

  const live = (["A", "B", "C", "D"] as ColKey[]).filter((k) => cols[k].length);
  const sumNeed = live.reduce((a, k) => a + need[k], 0);
  const gap = live.length > 1 ? (U.w - sumNeed) / (live.length - 1) : 0;

  const x: Record<ColKey, number> = { A: 0, B: 0, C: 0, D: 0 };
  let cursor = U.x;
  for (const k of live) {
    if (k === "A") x.A = cursor + labelW.A + PAD + rMax.A;
    else x[k] = cursor + rMax[k];
    cursor += need[k] + gap;
  }

  // ── vertical: pitch computed, band gap visible ──────────────────────────
  const placed: Placed[] = [];

  const placeColumn = (key: ColKey, groups: GraphNode[][]) => {
    const all = groups.flat();
    if (!all.length) return;
    const need2r = all.reduce((a, n) => a + 2 * radiusOf(n), 0);
    const gapsIn = groups.reduce((a, g) => a + Math.max(0, g.length - 1), 0);
    const bands = Math.max(0, groups.length - 1);
    const slack = U.h - need2r - gapsIn * G_MIN - bands * G_BAND;
    // Spread the slack across the gaps rather than pinning to the top, so a
    // short column sits centred instead of hanging from the ceiling.
    const extra = gapsIn + bands > 0 ? Math.max(0, slack) / (gapsIn + bands) : 0;
    let y = U.y + (slack < 0 ? 0 : 0);

    groups.forEach((g, gi) => {
      g.forEach((n, i) => {
        const r = radiusOf(n);
        y += r;
        placed.push({
          ...n,
          x: x[key],
          y: Math.min(U.y + U.h - r, Math.max(U.y + r, y)),
          r,
          anchor: key === "A" ? -1 : key === "B" ? 0 : 1,
          col: key,
          sub: subtitleFor(n),
        });
        y += r;
        if (i < g.length - 1) y += G_MIN + extra;
      });
      if (gi < groups.length - 1) y += G_BAND + extra;
    });
  };

  // Column A carries TWO groups with a visible band between them: restaurants,
  // then everything that is not a tenant. That gap is the only thing on the
  // page that says "Public traffic is not a customer", and it is the gap the
  // old sign error silently removed.
  placeColumn("A", [tenants, others].filter((g) => g.length) as GraphNode[][]);
  placeColumn("B", [cols.B]);
  placeColumn("C", [cols.C]);
  placeColumn("D", [cols.D]);

  // Centre each column vertically in the box.
  for (const key of live) {
    const inCol = placed.filter((p) => p.col === key);
    if (!inCol.length) continue;
    const top = Math.min(...inCol.map((p) => p.y - p.r));
    const bottom = Math.max(...inCol.map((p) => p.y + p.r));
    const shift = U.y + (U.h - (bottom - top)) / 2 - top;
    for (const p of inCol) p.y += shift;
  }

  return { placed, byId: new Map(placed.map((p) => [p.id, p])) };
}

/** A proof, not a pass.
 *
 *  The old layout had no check at all, so a restaurant drawn inside another
 *  node shipped and was found by a person looking at a screenshot. This runs in
 *  development only and fails loudly: the four-column solve makes overlap
 *  arithmetically impossible, so if this ever fires, the solve is wrong and
 *  wants fixing — not a collision pass bolted on top of it.
 */
export function assertNoOverlap(placed: Placed[]): string[] {
  const bad: string[] = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < a.r + b.r) {
        bad.push(`${a.label} ↔ ${b.label}: ${d.toFixed(1)}px apart, radii sum ${(a.r + b.r).toFixed(0)}`);
      }
    }
  }
  return bad;
}

/** An edge that bows, so parallel lines stay distinguishable and the middle of
 *  the picture does not become a knot where the platform needs to be read. */
export function curve(a: Placed, b: Placed, bow = 0.16): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * len * bow;
  const ny = (dx / len) * len * bow;
  return `M ${a.x} ${a.y} Q ${mx + nx} ${my + ny} ${b.x} ${b.y}`;
}

export function pointOnCurve(a: Placed, b: Placed, t: number, bow = 0.16) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const len = Math.hypot(dx, dy) || 1;
  const cx = mx + (-dy / len) * len * bow;
  const cy = my + (dx / len) * len * bow;
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
    y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
  };
}
