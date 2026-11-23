// When the browser takes a WebGL canvas's context away.
//
// A phone allows only a few live WebGL contexts at once (desktop Chrome 16;
// his Android phone fewer — eight reproduced it) and, past that, kills the
// OLDEST — which on this page were the background and the top menu. Android
// then paints the dead canvas WHITE with a broken-picture mark: his "white
// white boards" (23 Nov, §100.2).
//
// guardCanvas() marks such a canvas (globals.css hides `canvas[data-gl-lost]`,
// so the page's dark ground shows instead) and tells everyone else, so the
// card pool can give back a canvas and settle under the device's limit.
//
// Our own clean-ups lose contexts on purpose (forceContextLoss frees one at
// once): call the returned function BEFORE that, or a tidy clean-up would read
// as the browser running out.

export const GL_LOST_EVENT = "dev-gl-lost";

export function guardCanvas(canvas: HTMLCanvasElement, onLost?: () => void): () => void {
  const lost = () => {
    canvas.dataset.glLost = "";
    window.dispatchEvent(new Event(GL_LOST_EVENT));
    onLost?.();
  };
  canvas.addEventListener("webglcontextlost", lost);
  return () => canvas.removeEventListener("webglcontextlost", lost);
}

// A canvas about to take a context of its own (the finale's ring, the award
// room) claims one first: the card pool gives a canvas back for as long as the
// claim lasts, so the page as a whole stays within a phone's few.
export const GL_CLAIM_EVENT = "dev-gl-claim";
let claims = 0;

export function claimedContexts(): number {
  return claims;
}

export function claimContext(): () => void {
  claims++;
  window.dispatchEvent(new Event(GL_CLAIM_EVENT));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    claims = Math.max(0, claims - 1);
    window.dispatchEvent(new Event(GL_CLAIM_EVENT));
  };
}
