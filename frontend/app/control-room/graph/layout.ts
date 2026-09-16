/** Where every node sits — worked out, not simulated.
 *
 *  TWO HEMISPHERES: demand on the left, supply on the right, the platform as
 *  the stem between them. Restaurants, public traffic and orphans branch left;
 *  AWS services branch right, with the AI models hanging off Bedrock.
 *
 *  WHY NOT FORCE-DIRECTED, which is what "neural network" usually means:
 *
 *  A force simulation settles somewhere slightly different on every load. He
 *  opens this every morning, so "where is NIRAI" would be a search task every
 *  single time — and a layout you have to re-read is a layout that is costing
 *  you something. We already KNOW the structure; a solver would spend frames
 *  rediscovering an answer we can write down.
 *
 *  WHY NOT A TREE:
 *
 *  At depth 1 a tree puts three nodes in a row across 1,600px and leaves the
 *  left and right thirds empty — a machine for generating the complaint about
 *  dead space that this project gets more than any other.
 *
 *  AND THE SPLIT IS REAL, which is the actual argument. Demand and supply is
 *  the same division the money page already draws between what we measured and
 *  what AWS billed. Putting one on each side makes the band crossing the middle
 *  the main visual event of the page: the topology carries the meaning.
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

export type Placed = GraphNode & { x: number; y: number; r: number; side: -1 | 0 | 1 };

/** Node radius from its own volume — big enough to carry a label and a figure.
 *
 *  Square-root, not linear: area is what the eye compares, so a node ten times
 *  the traffic should look ten times the AREA and not ten times the WIDTH,
 *  which would put it off the canvas. A floor of 26px because a node that is
 *  quiet still has to be clickable and readable — shrinking it to nothing is
 *  how "quiet" turns into "broken".
 */
export function radiusFor(kind: string, value: number, biggest: number): number {
  if (kind === "platform") return 52;
  const floor = kind === "model" ? 22 : 26;
  const ceiling = kind === "restaurant" ? 56 : 44;
  if (!biggest || value <= 0) return floor;
  return floor + (ceiling - floor) * Math.sqrt(Math.min(1, value / biggest));
}

const DEMAND = new Set(["restaurant", "anonymous", "orphan", "operator"]);

/** Deterministic placement. Same input, same picture, every time. */
export function layout(
  nodes: GraphNode[],
  w: number,
  h: number,
): { placed: Placed[]; byId: Map<string, Placed> } {
  const cx = w / 2;
  const cy = h / 2;
  // Radii scale with the box so the picture fills a wide screen and still
  // works on a phone, where the whole thing is rotated by the caller.
  const rx = Math.max(150, Math.min(w * 0.36, 520));
  const ry = Math.max(110, Math.min(h * 0.40, 380));

  const demand = nodes.filter((n) => DEMAND.has(n.kind));
  const supply = nodes.filter((n) => n.kind === "service");
  const models = nodes.filter((n) => n.kind === "model");
  const platform = nodes.find((n) => n.kind === "platform");

  const biggestDemand = Math.max(
    1,
    ...demand.map((n) => Number(n.metrics?.requests ?? 0)),
  );
  const biggestSupply = Math.max(1, ...supply.map((n) => Number(n.metrics?.usd ?? 0)));
  const biggestModel = Math.max(1, ...models.map((n) => Number(n.metrics?.calls ?? 0)));

  const placed: Placed[] = [];

  if (platform) {
    placed.push({ ...platform, x: cx, y: cy, r: radiusFor("platform", 0, 0), side: 0 });
  }

  /** Spread down an arc. A single node sits on the axis rather than at the top
   *  of an arc it is the only member of — one item on a curve reads as a
   *  mistake. */
  const arc = (i: number, n: number, from: number, to: number) =>
    n === 1 ? (from + to) / 2 : from + ((to - from) * i) / (n - 1);

  // Tenants take the upper-left arc; everything that is NOT a tenant takes the
  // lower-left, in its own band. That separation is information: it is how you
  // see at a glance that most traffic belongs to nobody.
  const tenants = demand.filter((n) => n.kind === "restaurant");
  const others = demand.filter((n) => n.kind !== "restaurant");

  tenants.forEach((n, i) => {
    const a = arc(i, tenants.length, -Math.PI * 0.78, -Math.PI * 1.18);
    placed.push({
      ...n,
      x: cx + Math.cos(a) * rx,
      y: cy + Math.sin(a) * ry,
      r: radiusFor(n.kind, Number(n.metrics?.requests ?? 0), biggestDemand),
      side: -1,
    });
  });

  others.forEach((n, i) => {
    const a = arc(i, others.length, Math.PI * 0.80, Math.PI * 1.16);
    placed.push({
      ...n,
      x: cx + Math.cos(a) * rx,
      y: cy + Math.sin(a) * ry * 0.92,
      r: radiusFor(n.kind, Number(n.metrics?.requests ?? 0), biggestDemand),
      side: -1,
    });
  });

  supply.forEach((n, i) => {
    const a = arc(i, supply.length, -Math.PI * 0.42, Math.PI * 0.42);
    placed.push({
      ...n,
      x: cx + Math.cos(a) * rx,
      y: cy + Math.sin(a) * ry,
      r: radiusFor(n.kind, Number(n.metrics?.usd ?? 0), biggestSupply),
      side: 1,
    });
  });

  // Models hang OFF Bedrock rather than joining the service ring: they are not
  // things AWS bills, they are what we chose to call. Placed relative to the
  // Bedrock node so the parentage is visible without reading an edge.
  const bedrock = placed.find((p) => p.id.toLowerCase().includes("bedrock"));
  models.forEach((n, i) => {
    const base = bedrock ?? { x: cx + rx, y: cy, r: 40 };
    const spread = models.length === 1 ? 0 : (i / (models.length - 1) - 0.5) * 2;
    placed.push({
      ...n,
      x: base.x + 128,
      y: base.y + spread * 72,
      r: radiusFor("model", Number(n.metrics?.calls ?? 0), biggestModel),
      side: 1,
    });
  });

  return { placed, byId: new Map(placed.map((p) => [p.id, p])) };
}

/** A curve that bows AWAY from the centre.
 *
 *  Straight lines through a radial layout all cross the middle and turn into a
 *  knot exactly where the platform node needs to be readable. Bowing outward
 *  keeps the centre clear and makes parallel edges distinguishable, which is
 *  what lets you follow one restaurant's line with your eye.
 */
export function curve(a: Placed, b: Placed, bowOut = 0.18): string {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Perpendicular offset, signed by which hemisphere we are in so both sides
  // bow outward rather than one bowing back through the stem.
  const side = a.side || b.side || 1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * len * bowOut * side;
  const ny = (dx / len) * len * bowOut * side;
  return `M ${a.x} ${a.y} Q ${mx + nx} ${my + ny} ${b.x} ${b.y}`;
}

/** Point along a quadratic bezier — how a pulse knows where it is. */
export function pointOnCurve(
  a: Placed,
  b: Placed,
  t: number,
  bowOut = 0.18,
): { x: number; y: number } {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const side = a.side || b.side || 1;
  const len = Math.hypot(dx, dy) || 1;
  const cxp = mx + (-dy / len) * len * bowOut * side;
  const cyp = my + (dx / len) * len * bowOut * side;
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * cxp + t * t * b.x,
    y: u * u * a.y + 2 * u * t * cyp + t * t * b.y,
  };
}
