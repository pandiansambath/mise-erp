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
// Fast on purpose: "dont be very slow in motion, i need to be fast, if slow
// means it will be awkward to look". 520ms end to end.

export const BURST_MS = 520;

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

    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);

    const anim = bubble.animate(
      [
        // squash out of the panel
        { transform: "translate(0,0) scale(1.06)", opacity: 0.95, offset: 0 },
        { transform: "translate(0,0) scale(0.72)", opacity: 1, offset: 0.18 },
        // arc across — lifted above the straight line so it travels like a
        // throw rather than sliding along a ruler
        {
          transform: `translate(${dx * 0.55}px, ${dy * 0.55 - Math.abs(dx) * 0.14 - 30}px) scale(0.34)`,
          opacity: 1,
          offset: 0.62,
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
