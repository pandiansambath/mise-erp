// One place that knows whether something is covering the page.
//
// Found on a phone: the floating "Ask DineAI" launcher sits at the bottom-left
// with z-50, and a sheet's Save button lands in exactly that spot — so the
// launcher covered the button you had opened the sheet to press. Not a
// stacking-order tweak away from correct, either: whatever z-index the launcher
// has, a draggable bubble that floats over everything will eventually land on
// something that matters.
//
// So it stands down while anything is over the page. Sheets stack, which is why
// this is a COUNT rather than a flag — closing the second of two sheets must not
// announce that the page is clear while the first is still open.

let depth = 0;
let restore = "";
let restoreRoot = "";

/** Something is now covering the page. Returns the release function. */
export function overlayOpened(): () => void {
  if (typeof document === "undefined") return () => {};
  if (depth === 0) {
    restore = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The page scrolls on <html> too: `overflow-x: clip` there stops the body's
    // `hidden` reaching the viewport, so on a phone the page moved behind every
    // popup while this line claimed it was locked.
    restoreRoot = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.dataset.overlay = "1";
  }
  depth++;
  let released = false;
  return () => {
    // Guard the release: React can run a cleanup more than once (StrictMode,
    // fast refresh), and a double decrement would clear the flag with a sheet
    // still on screen.
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) {
      document.body.style.overflow = restore;
      document.documentElement.style.overflow = restoreRoot;
      delete document.body.dataset.overlay;
    }
  };
}
