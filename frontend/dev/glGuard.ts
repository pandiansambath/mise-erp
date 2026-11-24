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

// How many have been taken in this page's life: the card pool may go down to one,
// and what can be done without does not ask for its place again.
let losses = 0;
export function contextsLost(): number {
  return losses;
}

export function guardCanvas(canvas: HTMLCanvasElement, onLost?: () => void): () => void {
  const lost = () => {
    canvas.dataset.glLost = "";
    losses++;
    window.dispatchEvent(new Event(GL_LOST_EVENT));
    onLost?.();
  };
  canvas.addEventListener("webglcontextlost", lost);
  return () => canvas.removeEventListener("webglcontextlost", lost);
}

// Three asks the graphics about every shader the first time it is used (its log, its
// shaders' logs), and the page stands still for each answer — 20–90 ms, in the middle of a
// scroll. It is asked only when somebody is looking for a fault (?glcheck).
export function quiet(renderer: { debug: { checkShaderErrors: boolean } }) {
  renderer.debug.checkShaderErrors = /[?&]glcheck/.test(window.location.search);
}

// Its shaders, compiled off the main thread, and when they are ready. (three's own
// compileAsync asks a program that is gone when the context is lost meanwhile, and throws
// where nobody can catch it: QA, 24 Nov.)
type Compiles = {
  compile: (scene: never, camera: never) => unknown;
  properties: { get: (m: never) => { currentProgram?: { isReady: () => boolean } } };
  getContext: () => { isContextLost: () => boolean };
};
export function compiled(renderer: unknown, scene: unknown, camera: unknown): Promise<void> {
  const r = renderer as Compiles;
  return new Promise((done) => {
    let left: unknown[] = [];
    try {
      left = [...(r.compile(scene as never, camera as never) as Iterable<unknown>)];
    } catch {
      done();
      return;
    }
    const look = () => {
      try {
        if (!r.getContext().isContextLost()) left = left.filter((m) => !(r.properties.get(m as never).currentProgram?.isReady() ?? true));
        else left = [];
      } catch {
        left = [];
      }
      if (left.length) window.setTimeout(look, 12);
      else done();
    };
    window.setTimeout(look, 12);
  });
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
