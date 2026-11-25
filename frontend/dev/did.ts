// What a visitor has done here (§107.4): each thing that can be touched says so itself, and the
// line that invited them to it is not said again. Remembered for the visit.

export type Deed = "scroll" | "galaxy" | "months" | "bones" | "rank" | "ring" | "hand" | "orbit" | "chips" | "resume" | "kural" | "lamps";

const STORE = "pandi-dev:did";
export const DID_EVENT = "dev-did";

let done: Set<string> | null = null;
function all(): Set<string> {
  if (done) return done;
  done = new Set();
  try {
    for (const x of (sessionStorage.getItem(STORE) ?? "").split(",")) if (x) done.add(x);
  } catch {
    /* a private window: for this page only */
  }
  return done;
}

export function hasDone(what: Deed): boolean {
  return typeof window !== "undefined" && all().has(what);
}

export function did(what: Deed) {
  const d = all();
  if (d.has(what)) return;
  d.add(what);
  try {
    sessionStorage.setItem(STORE, [...d].join(","));
  } catch {
    /* as above */
  }
  window.dispatchEvent(new CustomEvent(DID_EVENT, { detail: what }));
}
