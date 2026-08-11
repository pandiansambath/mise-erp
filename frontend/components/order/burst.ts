// The burst: a popup collapsing into a bubble that flies to the basket.
//
// His description, and it is a good one because it describes a CAUSE and an
// EFFECT rather than a decoration:
//
//   "that item popup need to burst and converted into a small bubble and
//    smoothly reducing its size while moving toward the corner... in this
//    corner we will have a basket kind of one, inside this basket our item will
//    go and settle and now basket will show 1"
//
// So the thing you were just looking at becomes the thing now in your basket.
// One object, one continuous movement — which is what makes it read as "that
// went in there" rather than "a panel closed and a number changed".
//

// 820ms, up from 520.
//
// "i can see the bubble movement but not burst, and also its so so so fast that
// i can even realise its happening." Both true. The old timing was tuned to his
// earlier "don't be slow" note and overshot — a movement you cannot perceive is
// not fast, it is missing. This is still brisk, but you can follow it.
export const BURST_MS = 820;

/** The shards thrown outward at the moment the panel pops. */
const SHARDS = 10;

/**
 * Fly a shrinking copy of `from` into the element with id `basketId`.
 *
 * Runs on the compositor (transform + opacity only) and cleans up after itself.
 * Returns the moment the bubble lands, so the basket can react then rather than
 * on the click — a catch that happens before the throw arrives reads as two
 * unrelated twitches.
 */
export function burstToBasket(
  from: HTMLElement | null,
  basketId = "mise-basket",
  label?: string,
): Promise<void> {
  return new Promise((done) => {
    if (typeof window === "undefined" || !from) return done();

    const target = document.getElementById(basketId);
    const a = from.getBoundingClientRect();
    const b = target?.getBoundingClientRect();
    if (!target || !b || !a.width || !b.width) return done();

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) return done();

    // The bubble starts as a disc the size of the popup's shorter side, centred
    // on it — so it reads as the panel BALLING UP rather than a new thing
    // appearing from nowhere.
    const size = Math.min(a.width, a.height, 220);
    const bubble = document.createElement("div");
    bubble.setAttribute("aria-hidden", "true");
    bubble.className =
      "pointer-events-none fixed z-[95] grid place-items-center rounded-full " +
      "bg-brand-500 text-white shadow-2xl shadow-brand-900/40";
    bubble.style.left = `${a.left + a.width / 2 - size / 2}px`;
    bubble.style.top = `${a.top + a.height / 2 - size / 2}px`;
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.fontSize = "12px";
    bubble.style.fontWeight = "600";
    bubble.style.padding = "0 10px";
    bubble.style.textAlign = "center";
    bubble.style.overflow = "hidden";
    if (label) bubble.textContent = label;
    document.body.appendChild(bubble);

    // THE BURST ITSELF, which was missing — the old version only shrank and
    // slid, so it read as "a thing moved" rather than "the panel popped and
    // what was inside it flew away". A ring pushes outward from the panel's
    // centre and a handful of shards scatter, both fading fast, while the
    // bubble carries on to the basket.
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;

    const ring = document.createElement("div");
    ring.setAttribute("aria-hidden", "true");
    ring.className = "pointer-events-none fixed z-[94] rounded-full border-2 border-brand-400";
    ring.style.left = `${cx - size / 2}px`;
    ring.style.top = `${cy - size / 2}px`;
    ring.style.width = `${size}px`;
    ring.style.height = `${size}px`;
    document.body.appendChild(ring);
    ring
      .animate(
        [
          { transform: "scale(0.4)", opacity: 0.9 },
          { transform: "scale(1.5)", opacity: 0 },
        ],
        { duration: 420, easing: "cubic-bezier(.2,.8,.3,1)" },
      )
      .addEventListener("finish", () => ring.remove());

    for (let i = 0; i < SHARDS; i++) {
      const angle = (Math.PI * 2 * i) / SHARDS + Math.random() * 0.4;
      const dist = 60 + Math.random() * 70;
      const shard = document.createElement("div");
      shard.setAttribute("aria-hidden", "true");
      shard.className = "pointer-events-none fixed z-[94] rounded-full bg-brand-400";
      const r = 5 + Math.random() * 5;
      shard.style.left = `${cx - r / 2}px`;
      shard.style.top = `${cy - r / 2}px`;
      shard.style.width = `${r}px`;
      shard.style.height = `${r}px`;
      document.body.appendChild(shard);
      shard
        .animate(
          [
            { transform: "translate(0,0) scale(1)", opacity: 1 },
            {
              transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.2)`,
              opacity: 0,
            },
          ],
          { duration: 380 + Math.random() * 220, easing: "cubic-bezier(.2,.7,.3,1)" },
        )
        .addEventListener("finish", () => shard.remove());
    }

    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);

    const anim = bubble.animate(
      [
        // pop first — swell, then ball up — so the burst is SEEN before the
        // travel starts. It used to begin moving immediately, which is why the
        // burst never read as one.
        { transform: "translate(0,0) scale(1.18)", opacity: 0.95, offset: 0 },
        { transform: "translate(0,0) scale(0.62)", opacity: 1, offset: 0.26 },
        // arc across — lifted above the straight line so it travels like a
        // throw rather than sliding along a ruler
        {
          transform: `translate(${dx * 0.55}px, ${dy * 0.55 - Math.abs(dx) * 0.14 - 30}px) scale(0.34)`,
          opacity: 1,
          offset: 0.68,
        },
        { transform: `translate(${dx}px, ${dy}px) scale(0.08)`, opacity: 0.35, offset: 1 },
      ],
      { duration: BURST_MS, easing: "cubic-bezier(.34,.02,.2,1)", fill: "forwards" },
    );

    anim.onfinish = () => {
      bubble.remove();
      done();
    };
    // If the tab is backgrounded mid-flight the animation may never finish;
    // never leave a stray bubble welded to the page.
    window.setTimeout(() => {
      if (document.body.contains(bubble)) {
        bubble.remove();
        done();
      }
    }, BURST_MS + 400);
  });
}

/**
 * Blow a whole panel apart where it stands.
 *
 * "once user clicks submit indent button, burst that popup — entire popup you
 * need to burst like a yell — and back to original screen."
 *
 * Not a flight this time: nothing is going anywhere, the order has left. The
 * panel snaps taut, then detonates outward in shards while the panel itself
 * scales up and fades — a thing completing rather than a thing moving.
 */
export function burstAway(from: HTMLElement | null): Promise<void> {
  return new Promise((done) => {
    if (typeof window === "undefined" || !from) return done();
    const a = from.getBoundingClientRect();
    if (!a.width) return done();

    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (still) return done();

    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;

    // A flash of light at the moment it goes. Without it the shards read as
    // confetti appearing rather than a thing breaking — "I don't even realise
    // it is happening".
    const flash = document.createElement("div");
    flash.setAttribute("aria-hidden", "true");
    flash.className = "pointer-events-none fixed z-[97] rounded-3xl bg-white";
    flash.style.left = `${a.left}px`;
    flash.style.top = `${a.top}px`;
    flash.style.width = `${a.width}px`;
    flash.style.height = `${a.height}px`;
    document.body.appendChild(flash);
    flash
      .animate(
        [
          { opacity: 0, transform: "scale(1)" },
          { opacity: 0.55, transform: "scale(1.02)", offset: 0.25 },
          { opacity: 0, transform: "scale(1.14)" },
        ],
        { duration: 460, easing: "cubic-bezier(.2,.8,.3,1)" },
      )
      .addEventListener("finish", () => flash.remove());

    // A ring pushing out past the panel's edge, so the eye is given the SIZE
    // of what just went.
    const ring = document.createElement("div");
    ring.setAttribute("aria-hidden", "true");
    ring.className = "pointer-events-none fixed z-[96] rounded-3xl border-2 border-brand-400";
    ring.style.left = `${a.left}px`;
    ring.style.top = `${a.top}px`;
    ring.style.width = `${a.width}px`;
    ring.style.height = `${a.height}px`;
    document.body.appendChild(ring);
    ring
      .animate(
        [
          { transform: "scale(0.94)", opacity: 0.95 },
          { transform: "scale(1.35)", opacity: 0 },
        ],
        { duration: 620, easing: "cubic-bezier(.2,.8,.3,1)" },
      )
      .addEventListener("finish", () => ring.remove());

    // Shards fly from the panel's EDGES, not its middle, so it reads as the
    // panel coming apart rather than something erupting through it.
    for (let i = 0; i < 34; i++) {
      const t = (Math.PI * 2 * i) / 34;
      const sx = cx + Math.cos(t) * (a.width / 2) * 0.9;
      const sy = cy + Math.sin(t) * (a.height / 2) * 0.9;
      const shard = document.createElement("div");
      shard.setAttribute("aria-hidden", "true");
      shard.className = "pointer-events-none fixed z-[96] rounded-md bg-brand-400";
      const w = 6 + Math.random() * 14;
      shard.style.left = `${sx}px`;
      shard.style.top = `${sy}px`;
      shard.style.width = `${w}px`;
      shard.style.height = `${4 + Math.random() * 8}px`;
      document.body.appendChild(shard);
      const dist = 140 + Math.random() * 220;
      shard
        .animate(
          [
            { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: 1 },
            {
              transform: `translate(${Math.cos(t) * dist}px, ${Math.sin(t) * dist + 60}px) rotate(${
                (Math.random() - 0.5) * 540
              }deg) scale(0.3)`,
              opacity: 0,
            },
          ],
          { duration: 760 + Math.random() * 340, easing: "cubic-bezier(.15,.7,.3,1)" },
        )
        .addEventListener("finish", () => shard.remove());
    }

    from
      .animate(
        [
          { transform: "scale(1)", opacity: 1, offset: 0 },
          { transform: "scale(0.96)", opacity: 1, offset: 0.18 },
          { transform: "scale(1.12)", opacity: 0, offset: 1 },
        ],
        { duration: 560, easing: "cubic-bezier(.2,.8,.3,1)", fill: "forwards" },
      )
      .addEventListener("finish", () => done());

    window.setTimeout(done, 780);
  });
}

/** The id the basket panel carries, so anything can blow it apart by name. */
export const BASKET_PANEL_ID = "mise-basket-panel";

/**
 * Blow the basket apart and tell it to close.
 *
 * By id and by event rather than by a ref passed downward: the submit button
 * lives on the page and the panel lives inside the basket, and threading a ref
 * up through a render prop means calling a function during render with a ref
 * inside it — which React's own lint rule objects to, correctly.
 */
export async function burstBasket(): Promise<void> {
  if (typeof window === "undefined") return;

  // EVERY panel that is up, not just the basket. "I said once I click submit
  // in basket it needs to burst all the opened popups and show the original
  // page... also I can still see 1 popup open — this also needs to be closed."
  // Quite right: the category popup was still sitting there behind it, so you
  // did not land back on the page at all.
  const panels = Array.from(document.querySelectorAll<HTMLElement>("[role=dialog]"));
  const basket = document.getElementById(BASKET_PANEL_ID);
  if (basket && !panels.includes(basket)) panels.push(basket);

  // The backdrops go with them, or the screen stays dark over a page with
  // nothing on it.
  for (const b of Array.from(document.querySelectorAll<HTMLElement>("[data-sheet-backdrop]"))) {
    b.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 380, fill: "forwards" });
  }

  await Promise.all(panels.map((el) => burstAway(el)));
  window.dispatchEvent(new CustomEvent("mise:close-basket"));
}
