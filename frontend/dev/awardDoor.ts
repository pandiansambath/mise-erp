// The way into the award room (§103.2).
//
//   "in desktop [I'm] able to view the screen, but it took some time to load, I can
//    see a loading icon… please try to load before itself, before entering this
//    area, in a smooth way"
//
// So there is no loading icon any more. On a desktop the whole room — its scene, its
// pictures, its shaders, its first frame — is built in the profile page's idle
// moments as the way in comes near, and simply handed over. A phone, whose graphics
// memory the profile needs, gets its files and code early and builds behind a pair
// of bronze doors. Either way you walk up to the doors in the dark, gold light in the
// crack between them, and they open on a room that is already there.

import { AWARD_MODEL_FILES, canWarmAward, DOOR_IMG } from "./awardFiles";
import type { Room } from "./awardRoom";
import { EMPTY_COPY, type Copy } from "./copy";

let room: Promise<Room | null> | null = null;
let wanted = 0;
let hurry = false;
let scrolledAt = 0;

/** A moment the page has nothing better to do (at once, if you are on your way in). */
const calm = () =>
  new Promise<void>((done) => {
    const ask = () => {
      if (hurry) {
        window.setTimeout(done, 0);
        return;
      }
      // Not while the page is being scrolled, nor behind its door, nor as that opens.
      if (document.hidden || performance.now() - scrolledAt < 350 || document.querySelector("[data-boot]")) {
        window.setTimeout(ask, 160);
        return;
      }
      const ric = (window as Window & { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) ric(() => done(), { timeout: 260 });
      else window.setTimeout(done, 40);
    };
    ask();
  });

/** Whether this machine can hold the room as well as the page. */
function roomy(): boolean {
  if (!window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches || !canWarmAward()) return false;
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.deviceMemory ?? 8) >= 4 && (n.hardwareConcurrency ?? 4) >= 4;
}

/** The way in is near (or pointed at): what it will need, early. */
export function warmAward() {
  new Image().src = DOOR_IMG;
  if (!roomy()) {
    if (!canWarmAward()) return;
    void import("./awardRoom").catch(() => {});
    void import("./AwardStage").catch(() => {});
    for (const u of AWARD_MODEL_FILES) void fetch(u).catch(() => {});
    return;
  }
  if (room) return;
  const mine = ++wanted;
  hurry = false;
  window.addEventListener("scroll", seen, { passive: true });
  void import("./AwardStage").catch(() => {});
  room = import("./awardRoom")
    .then((m) => m.buildRoom({ lite: false, gentle: true, calm, alive: () => mine === wanted, progress: (p) => performance.mark(`award-${Math.round(p * 100)}`) }))
    .catch(() => null);
}
const seen = () => {
  scrolledAt = performance.now();
};

/** It has been left far behind: give back what it holds. */
export function coolAward() {
  if (!room || hurry) return;
  wanted++;
  const r = room;
  room = null;
  window.removeEventListener("scroll", seen);
  void r.then((x) => x?.dispose());
}

/** The room, if one was built ahead (whatever is left of it is done at once). */
export async function takeAward(): Promise<Room | null> {
  hurry = true;
  const r = room;
  room = null;
  window.removeEventListener("scroll", seen);
  const got = r ? await r : null;
  // Its graphics taken away while it waited: it will be built afresh.
  if (got?.lost()) {
    got.dispose();
    return null;
  }
  return got;
}

// ── the doors, shut over the profile while the page changes behind them ──────

const ID = "award-doors";
export const DOOR_PARTS = '<div class="award-door award-door-l"></div><div class="award-door award-door-r"></div><i class="award-crack"></i>';

export function dropDoors() {
  document.getElementById(ID)?.remove();
}

/** Into the room: the doors come up out of the dark, then the page changes. */
export function enterAward(go: () => void) {
  hurry = true;
  performance.mark("award-enter");
  // No room built ahead (a phone): what it is made of, read and decoded while the
  // doors come up and the page changes.
  if (!room) void import("./awardRoom").then((m) => m.stockRoom()).catch(() => {});
  warmDoorsOnly();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    go();
    return;
  }
  dropDoors();
  const el = document.createElement("div");
  el.id = ID;
  el.className = "award-doors award-doors-in";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = DOOR_PARTS;
  document.body.appendChild(el);
  window.setTimeout(go, 340);
  // Should the page never come, ask for it the plain way.
  window.setTimeout(() => {
    if (document.getElementById(ID) && !window.location.pathname.endsWith("/award")) window.location.assign("/award");
  }, 9000);
  window.setTimeout(dropDoors, 20000);
}
function warmDoorsOnly() {
  new Image().src = DOOR_IMG;
}

// ── his words, carried across (the room's are in the Template too) ───────────

let words: Copy = EMPTY_COPY;
let known = false;
export function rememberWords(c: Copy) {
  words = c;
  known = true;
}
export function rememberedWords(): { copy: Copy; known: boolean } {
  return { copy: words, known };
}
