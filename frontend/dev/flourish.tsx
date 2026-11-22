"use client";

// Small touches shared by the cards.
//
//   "have a font animation whenever i hover over any font using cursor… like
//    we did in block… minute animation grow shrink"
//   "still i feel like those cards are also lacking design / animation"

import { useEffect, useRef, type CSSProperties } from "react";
import { registerCard } from "./CardGL";

/** Text whose letters swell under the cursor (.dev-wave in globals.css).
 *  Screen readers get the word whole; the letters are presentation only. */
export function Wave({ text, className = "", style }: { text: string; className?: string; style?: CSSProperties }) {
  return (
    <span className={`dev-wave ${className}`} style={style} aria-label={text} role="text">
      {/* Spaces stay plain text between the letter boxes: that is where a
          line may break. A space inside an inline-block span gives the
          browser no break point, and a long label then pushed the whole
          column past a phone's edge. */}
      {Array.from(text).map((ch, i) =>
        ch === " " || ch === "\u00a0" ? (
          " "
        ) : (
          <span key={i} aria-hidden>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

/** A card's look: one slot for the WebGL canvas that draws it (CardGL —
 *  the glass, the water, the curve as it turns, the orb it becomes when it
 *  is away, the cursor stirring it, its dust). Place inside a `relative`
 *  card; the canvas reaches a little past the card's edges.
 *
 *  `hue` is the card's own colour: its rim and its orb's glow carry it. */
export function CardChrome({ hue = "var(--d-a)" }: { hue?: string }) {
  const slot = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = slot.current;
    const card = el?.parentElement;
    if (!el || !card) return;
    return registerCard(card, el, hue);
  }, [hue]);
  return <span ref={slot} aria-hidden className="dev-glslot" />;
}
