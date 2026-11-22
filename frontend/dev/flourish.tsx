// Small touches shared by the cards.
//
//   "have a font animation whenever i hover over any font using cursor… like
//    we did in block… minute animation grow shrink"
//   "still i feel like those cards are also lacking design / animation"

import type { CSSProperties } from "react";

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

/** A card's chrome. Place inside a `relative overflow-hidden` card.
 *
 *  The skin — dark glass, the theme's water moving inside it, an iridescent
 *  rim, a band of light — sits inside an iris (a circle that scales), and
 *  beside it is the orb the card becomes when it is away from the present:
 *  "for future and past cards we need a spiral instead of a rectangle…
 *  a spiral circle which grows and shrinks" (globals.css, THE ORBIT, third
 *  pass). `hue` colours the orb's rim. The two-link mark that sat in the
 *  corner is gone ("please remove that, not nice to see"). */
export function CardChrome({ hue = "var(--d-a)" }: { hue?: string }) {
  return (
    <>
      <span aria-hidden className="dev-iris">
        <span className="dev-skin">
          {/* Water in the crystal: two sheets of the theme's own texture
              (painted once per theme into --dev-liquid) drifting against
              each other all the time, the pool turning as the card passes. */}
          <span className="dev-liquid pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <i>
              <b />
              <b />
            </i>
          </span>
          <span className="dev-edge pointer-events-none absolute inset-0 rounded-[inherit]" />
          {/* A band of light that crosses the card as it turns to face you. */}
          <span className="dev-sweep pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
            <i />
          </span>
        </span>
      </span>
      <span aria-hidden className="dev-orb" style={{ "--orb-hue": hue } as CSSProperties}>
        <i />
      </span>
    </>
  );
}
