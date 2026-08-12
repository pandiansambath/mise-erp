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

    // ── The panel FOLDS AWAY, it does not explode. ────────────────────────
    //
    // "after submit from basket the burst effect is not nice, it's like here
    //  and there — please make it fun and smooth."
    //
    // He is describing scatter, and scatter was the design: shards thrown at
    // random angles. Random is busy, not playful. What actually happened is
    // that the order LEFT — one thing, going one way — so the panel now
    // collapses along its own vertical axis and lifts, the way a docket is
    // whisked off a rail, while a single band of light sweeps through it.
    // One direction, one idea, and it reads at a glance.

    const sheet = document.createElement("div");
    sheet.setAttribute("aria-hidden", "true");
    sheet.className = "pointer-events-none fixed z-[97] overflow-hidden rounded-3xl";
    sheet.style.left = `${a.left}px`;
    sheet.style.top = `${a.top}px`;
    sheet.style.width = `${a.width}px`;
    sheet.style.height = `${a.height}px`;
    sheet.style.background =
      "linear-gradient(100deg, transparent 35%, rgba(255,255,255,.55) 50%, transparent 65%)";
    sheet.style.transform = "translateX(-100%)";
    document.body.appendChild(sheet);
    sheet
      .animate(
        [{ transform: "translateX(-100%)" }, { transform: "translateX(100%)" }],
        { duration: 520, easing: "cubic-bezier(.4,0,.2,1)" },
      )
      .addEventListener("finish", () => sheet.remove());

    // A few motes lifting off the top edge — smoke off something taken away,
    // not debris thrown outward. They all travel the SAME way, which is what
    // makes it read as one event.
    for (let i = 0; i < 9; i++) {
      const mote = document.createElement("div");
      mote.setAttribute("aria-hidden", "true");
      mote.className = "pointer-events-none fixed z-[96] rounded-full bg-brand-400";
      const r = 4 + Math.random() * 5;
      mote.style.left = `${a.left + Math.random() * a.width}px`;
      mote.style.top = `${cy}px`;
      mote.style.width = `${r}px`;
      mote.style.height = `${r}px`;
      document.body.appendChild(mote);
      mote
        .animate(
          [
            { transform: "translateY(0) scale(1)", opacity: 0.9 },
            {
              transform: `translate(${(Math.random() - 0.5) * 40}px, ${-70 - Math.random() * 70}px) scale(0.2)`,
              opacity: 0,
            },
          ],
          { duration: 620 + Math.random() * 260, delay: 120 + i * 22, easing: "cubic-bezier(.2,.7,.3,1)" },
        )
        .addEventListener("finish", () => mote.remove());
    }

    // The panel itself: a breath, then it folds shut along its middle and
    // lifts away. `scaleY` collapsing to nothing is the fold; the small rise
    // is what stops it feeling like a door slamming.
    from
      .animate(
        [
          { transform: "translateY(0) scaleY(1)", opacity: 1, offset: 0 },
          { transform: "translateY(2px) scaleY(1.02)", opacity: 1, offset: 0.22 },
          { transform: "translateY(-14px) scaleY(0.55)", opacity: 0.85, offset: 0.62 },
          { transform: "translateY(-46px) scaleY(0.02)", opacity: 0, offset: 1 },
        ],
        { duration: 760, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" },
      )
      .addEventListener("finish", () => done());

    window.setTimeout(done, 900);
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

  // ALL AT ONCE. My last version went deepest-first, 190ms apart, and he saw
  // exactly that: "I can literally see 1st popup burst, then right side 2nd
  // popup burst, then left some other is disappearing." A sequence of three
  // events is three events; he wants ONE.
  //
  // So every panel goes on the same frame, and a single shower of colour paper
  // is thrown over the whole screen rather than each panel making its own.
  confetti();
  await Promise.all(panels.map((el) => burstAway(el)));
  window.dispatchEvent(new CustomEvent("mise:close-basket"));
}


/**
 * Colour paper thrown across the screen. Once, on submit.
 *
 * "with colour papers throwing kinda UI, should need to be realistic."
 *
 * Realistic here means the physics, not the rendering: each piece gets its own
 * launch angle and speed, gravity pulls it down, drag slows it, and it flutters
 * about its own axis at its own rate — which is why real confetti never looks
 * like a fountain of identical dots. All of it on transform and opacity, so it
 * costs the compositor and not the layout.
 */
function confetti(): void {
  if (typeof window === "undefined") return;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.className = "pointer-events-none fixed inset-0 z-[98] overflow-hidden";
  document.body.appendChild(host);

  const colours = ["#e11d48", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#f472b6", "#facc15"];
  const w = window.innerWidth;
  const h = window.innerHeight;
  const N = Math.min(90, Math.round(w / 14));

  for (let i = 0; i < N; i++) {
    const bit = document.createElement("div");
    // Thrown from two lower corners, the way a party popper actually works —
    // a single central fountain reads as a loading spinner.
    const fromLeft = i % 2 === 0;
    const x0 = fromLeft ? w * 0.12 : w * 0.88;
    const y0 = h * 0.86;

    const spread = (Math.random() - 0.5) * 1.1;
    const angle = (fromLeft ? -1 : 1) * (0.55 + Math.random() * 0.5) + spread;
    const speed = h * (0.62 + Math.random() * 0.5);

    const dx = Math.sin(angle) * speed;
    const rise = -Math.cos(angle * 0.55) * speed;
    const fall = h * (0.9 + Math.random() * 0.5);

    const size = 6 + Math.random() * 8;
    bit.style.cssText = `position:absolute;left:${x0}px;top:${y0}px;width:${size}px;height:${size * (0.4 + Math.random() * 0.5)}px;background:${colours[i % colours.length]};border-radius:1px;will-change:transform,opacity;`;
    host.appendChild(bit);

    const spinA = (Math.random() - 0.5) * 900;
    const spinB = (Math.random() - 0.5) * 1400;

    bit.animate(
      [
        { transform: "translate(0,0) rotate3d(1,1,0,0deg)", opacity: 1, offset: 0 },
        {
          // apex — up and out, still fast
          transform: `translate(${dx * 0.55}px, ${rise * 0.75}px) rotate3d(1,1,0,${spinA}deg)`,
          opacity: 1,
          offset: 0.42,
        },
        {
          // and down, drifting sideways as drag takes the horizontal speed
          transform: `translate(${dx * 0.92}px, ${fall}px) rotate3d(1,1,0,${spinB}deg)`,
          opacity: 0,
          offset: 1,
        },
      ],
      {
        duration: 1500 + Math.random() * 900,
        delay: Math.random() * 90,
        // Fast off the mark, slowing at the top, then away — one curve doing
        // the work of a physics engine.
        easing: "cubic-bezier(.16,.62,.36,1)",
        fill: "forwards",
      },
    );
  }

  window.setTimeout(() => host.remove(), 2700);
}
