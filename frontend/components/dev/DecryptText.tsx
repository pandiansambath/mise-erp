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
      className={className}
      onMouseEnter={replayOnHover ? run : undefined}
      // The scrambled text is noise to a screen reader; announce the real thing.
      aria-label={text}
    >
      <span aria-hidden>{display}</span>
    </span>
  );
}
