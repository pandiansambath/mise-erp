// Code that arrives separately, and what happens when it does not (§103.1).
//
//   "I checked the chest page in mobile… I can see an empty page with yellow
//    light, then after a few seconds 'this page couldn't load', reload / back"
//
// His phone was on the page while a deploy swapped the server: the page (the
// old build's) asked for the room's code under a name the new build did not
// have, and the framework's answer to one missing file is to take the whole
// page away. So: asked for again, twice; then the page itself asked for afresh,
// once (that brings the new build, and the visitor sees a blink); and if even
// that does not help — no network — something plain stands in its place.
// (The deploy also keeps the last build's files now: scripts/keep-last-static.mjs.)

const KEY = "pandi-dev-fresh";

/** The page afresh from the server, at most once a minute: true if it is on
 *  its way. Without storage to remember by, never (it could go round for ever). */
export function freshPage(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < 60_000) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

/** Whether an error is a piece of code that did not arrive. */
export function isMissingCode(e: unknown): boolean {
  const s = e instanceof Error ? `${e.name} ${e.message}` : String(e);
  return /chunk|dynamically imported module|module script failed/i.test(s);
}

/** A piece of code, or (if it will not come) what stands in for it. */
export async function arrive<T>(load: () => Promise<T>, instead: T): Promise<T> {
  for (const pause of [0, 600, 1800]) {
    if (pause) await new Promise((r) => setTimeout(r, pause));
    try {
      return await load();
    } catch {
      /* again */
    }
  }
  if (typeof window !== "undefined" && navigator.onLine !== false && freshPage()) return new Promise<T>(() => {});
  return instead;
}
