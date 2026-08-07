"use client";

// Text that resolves out of noise, character by character.
//
// Not a typewriter — a typewriter reveals left to right and everyone has seen
// one. This holds the FULL width from the first frame and resolves characters
// out of hex garbage in place, so the layout never shifts and it reads like
// something being decrypted rather than typed.
//
// Two details that make it feel deliberate rather than random:
//   • characters lock in a shuffled order, not left-to-right, so the word
//     assembles from the middle out and you cannot predict the next one
//   • spaces never scramble, so the shape of the name is legible throughout
//     and the eye has something stable to hold
//
// Honours prefers-reduced-motion by rendering the final text immediately.

import { useEffect, useRef, useState } from "react";

const NOISE = "0123456789abcdef!<>-_\\/[]{}=+*^?#";

export function DecryptText({
  text,
  className = "",
  delay = 0,
  speed = 34,
  /** Re-run the effect when hovered — pointless on a paragraph, lovely on a name. */
  replayOnHover = false,
}: {
  text: string;
  className?: string;
  delay?: number;
  speed?: number;
  replayOnHover?: boolean;
}) {
  const [display, setDisplay] = useState(text);
  const raf = useRef<number>(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const run = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplay(text);
      return;
    }
    const chars = [...text];
    // Shuffle the reveal order so it assembles unpredictably.
    const order = chars.map((_, i) => i).sort(() => Math.random() - 0.5);
    const locked = new Set<number>();
    let step = 0;

    const tick = () => {
      // Lock roughly one more character per frame-group.
      const target = Math.floor(step / 2);
      while (locked.size < Math.min(target, order.length)) {
        locked.add(order[locked.size]);
      }
      setDisplay(
        chars
          .map((c, i) => {
            if (c === " " || locked.has(i)) return c;
            return NOISE[Math.floor(Math.random() * NOISE.length)];
          })
          .join(""),
      );
      step += 1;
      if (locked.size < chars.length) {
        timer.current = setTimeout(() => {
          raf.current = requestAnimationFrame(tick);
        }, speed);
      } else {
        setDisplay(text);
      }
    };
    tick();
  };

  useEffect(() => {
    const id = setTimeout(run, delay);
    return () => {
      clearTimeout(id);
      clearTimeout(timer.current);
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, delay]);

  return (
    <span
      // `relative inline-block` so the scrambling copy can be lifted OUT of
      // the layout. This is not cosmetic: the noise glyphs are different
      // widths from the real letters, so rendering them in flow re-laid-out
      // the heading on every frame and shoved everything beneath it around.
      // On this page that is the orbit — "the solar system letters are
      // shaking", and only ever while the reassemble is running.
      // `block`, not `inline-block`.
      //
      // As an inline-block the whole name became one unbreakable box, so at
      // the moment the scramble started the line could no longer break where
      // it used to and "Sambath" dropped for a frame. A block element takes
      // its own line and cannot be pushed around by what sits beside it.
      // `whitespace-nowrap` is the actual fix for "Sambath drops to the next
      // line". The invisible copy holds the box open at the REAL text's width,
      // but the scrambled copy inside it is made of different glyphs — wider,
      // so it no longer fitted and wrapped at the space. Forbidding the wrap
      // means the line can never break mid-animation.
      className={`relative block whitespace-nowrap ${className}`}
      onMouseEnter={replayOnHover ? run : undefined}
      // The scrambled text is noise to a screen reader; announce the real thing.
      aria-label={text}
    >
      {/* Holds the final size open. Invisible, but laid out — so the box never
          changes shape no matter what is being drawn on top of it. */}
      <span aria-hidden className="invisible">
        {text}
      </span>
      {/* The animation, out of flow and therefore unable to move anything. */}
      <span aria-hidden className="absolute inset-0">
        {display}
      </span>
    </span>
  );
}
