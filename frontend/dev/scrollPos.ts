// How far the page is scrolled, known without asking it.
//
// scrollY (and getBoundingClientRect), asked in the middle of a frame, makes the browser
// work out every style that has changed so far on the spot; then something else changes,
// something else asks, and it does it again. Half a dozen loops here each asked, every
// frame of a scroll: 10–15 ms of it on a slow laptop (24 Nov).
//
// A scroll timeline carries the same number and is not a question: the browser keeps it
// for its own scroll-driven animations. It is read as a share of the way down, and the
// whole way is measured when the page is at rest. Only where a mouse is: a phone's way
// down changes as its address bar slides, and there the page is asked, as before.

type Timeline = { currentTime: { value: number } | null };

let tl: Timeline | null = null;
let span = 0;
let begun = false;

function begin() {
  begun = true;
  try {
    const ST = (window as unknown as { ScrollTimeline?: new (o: object) => Timeline }).ScrollTimeline;
    if (!ST || !window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches) return;
    tl = new ST({ source: document.documentElement, axis: "block" });
  } catch {
    return;
  }
  const whole = () => {
    span = Math.max(0, document.documentElement.scrollHeight - document.documentElement.clientHeight);
  };
  // At rest the two agree: the whole way exactly, parts of a pixel and all.
  let rest = 0;
  const settle = () => {
    const y = window.scrollY;
    const p = tl?.currentTime?.value;
    whole();
    if (p && p > 5 && y > 100 && Math.abs((p / 100) * span - y) < 3) span = y / (p / 100);
  };
  const later = () => {
    window.clearTimeout(rest);
    rest = window.setTimeout(settle, 260);
  };
  whole();
  const ro = new ResizeObserver(whole);
  ro.observe(document.documentElement);
  ro.observe(document.body);
  window.addEventListener("resize", later);
  window.addEventListener("scroll", later, { passive: true });
}

export function pageY(): number {
  if (!begun) begin();
  const p = tl?.currentTime?.value;
  return p === undefined || p === null || !span ? window.scrollY : (p / 100) * span;
}

/** Whether that is free here (else it asks the page). */
export function pageYFree(): boolean {
  if (!begun) begin();
  return !!tl && span > 0;
}
