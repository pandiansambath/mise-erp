// What both kitchen screens agree on: the logged-in page and the wall tablet.
// They kept separate copies, and the "a request is not a dish" fix only ever
// reached one of them, so the tablet still offered "Start cooking" on a glass
// of water.

// What the chef presses next, and what it is called in kitchen words.
export const NEXT: Record<string, { to: string; label: string }> = {
  NEW: { to: "CONFIRMED", label: "Accept" },
  CONFIRMED: { to: "PREPARING", label: "Start cooking" },
  PREPARING: { to: "READY", label: "Ready" },
  READY: { to: "COMPLETED", label: "Served" },
};

/** A REQUEST IS NOT A DISH.
 *
 *   "as a customer if I ask like 'need water please' as a msg, this also going
 *    like food in kitchen screen like start cooking, ready, served. Kitchen
 *    screen bug, please fix."
 *
 * He is right, and the cause is that a message arriving when the table has no
 * live order CREATES one to hang itself on — a real Order row with a status,
 * and therefore the whole cooking flow. Nobody cooks a napkin, so Accept →
 * Start cooking → Ready → Served is four presses of theatre for something that
 * needs one.
 *
 * The tell is already in the data and needed no schema change: an order with no
 * ITEMS is not food. It gets one button that finishes it.
 */
export function nextStep(o: { status: string; items: { name: string }[] }) {
  if (o.items.length === 0) {
    return o.status === "COMPLETED" ? undefined : { to: "COMPLETED", label: "Done" };
  }
  return NEXT[o.status];
}

/** A dish keeps its place on the ticket. The server's order is not fixed, so a
 *  row could swap with its neighbour under somebody's thumb after a tick. */
export function inOrder<T extends { id: string; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** THE LANES OF THE PASS (32.30). */
export const LANES = [
  { key: "new", label: "New", statuses: ["NEW", "CONFIRMED"] },
  { key: "cooking", label: "Cooking", statuses: ["PREPARING"] },
  { key: "ready", label: "Ready", statuses: ["READY", "OUT_FOR_DELIVERY"] },
];

/** Which lane a table belongs in.
 *
 *  "I can see 2 table 4. Actually we need to group them until free up." A table
 *  stays one card, so a lane cannot split it by round. It sits in the lane of
 *  the earliest thing it is still waiting on, and each round inside the card
 *  keeps its own stage and its own button. */
export function laneOf(rows: { status: string }[]): string {
  const hit = LANES.find((l) => rows.some((r) => l.statuses.includes(r.status)));
  return (hit ?? LANES[0]).key;
}
