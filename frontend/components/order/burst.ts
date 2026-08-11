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
