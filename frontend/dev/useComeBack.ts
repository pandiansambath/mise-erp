"use client";

// A canvas the page cannot do without, taken away (§103.9).
//
//   A friend opened the site from Instagram, in its own browser: the no-photo
//   black hole was not there, the orbit went round nothing. Such a browser keeps
//   fewer WebGL contexts alive than the phone's own, takes the OLDEST away, and
//   a canvas once taken stays hidden (glGuard: never white).
//
// Now the piece in the portrait's place, and the skeleton, ask for a canvas again
// once the rest has settled — the card pool gives a canvas back for every one that
// is taken — a few times at most. (Not the background: asking for it again took the
// piece away.)

import { useCallback, useEffect, useRef, useState } from "react";

export function useComeBack({ tries, after }: { tries: number; after: number }): { gen: number; gone: () => void } {
  const [gen, setGen] = useState(0);
  const at = useRef(0);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const gone = useCallback(() => {
    if (at.current >= tries) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => {
        at.current++;
        setGen(at.current);
      },
      after * (1 + at.current * 1.6),
    );
  }, [tries, after]);
  return { gen, gone };
}
