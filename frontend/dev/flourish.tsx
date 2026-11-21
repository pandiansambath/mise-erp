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

/** A card's chrome: a slowly turning gradient edge, and two interlocked chain
 *  links in the corner that turn when the pointer comes close. Place inside a
 *  `relative overflow-hidden` card with the `group` class. */
export function CardChrome({ hue = "var(--d-a)" }: { hue?: string }) {
  return (
    <>
      <span aria-hidden className="dev-edge pointer-events-none absolute inset-0 rounded-[inherit]" />
      <svg
        aria-hidden
        className="dev-link-mark pointer-events-none absolute -right-3 -top-3 h-20 w-20 opacity-[0.16]"
        viewBox="0 0 80 80"
        fill="none"
        stroke={hue}
        strokeWidth="5"
        strokeLinecap="round"
      >
        <rect x="8" y="22" width="38" height="20" rx="10" transform="rotate(-30 27 32)" />
        <rect x="30" y="36" width="38" height="20" rx="10" transform="rotate(-30 49 46)" />
      </svg>
    </>
  );
}
