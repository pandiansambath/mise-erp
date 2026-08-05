"use client";

// A drop in water, wherever you touch.
//
// His ask: *"if I touch somewhere I need to have a kind of animation like if I
// touch water or drop stone on water"*. So every pointer-down anywhere in the
// app sends a ring out from that exact point and fades it.
//
// The three things that decide whether this feels expensive or cheap:
//
// **It must never be in the way.** `pointer-events: none` on the whole layer,
// so it cannot swallow a tap meant for a button underneath. An effect that
// eats clicks is a bug wearing a costume.
//
// **It must not accumulate.** Each ring removes itself when its animation
// ends, and there is a hard cap on how many can exist. Somebody drumming their
// fingers must not build a thousand DOM nodes.
//
// **It must be free.** transform + opacity only, so it runs on the compositor.
// A ripple that drops a frame is worse than no ripple, because the jank is now
// attached to every single tap.

import { useEffect, useState } from "react";

type Drop = { id: number; x: number; y: number };

/** Beyond this, older rings are dropped. Fast tapping should not build DOM. */
const MAX = 6;

export function Ripple() {
  const [drops, setDrops] = useState<Drop[]>([]);

  useEffect(() => {
    // Honour a reader who has asked for less motion — this fires on EVERY
    // interaction, so it is the last thing that should ignore that setting.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let n = 0;
    function onDown(e: PointerEvent) {
      // Not on scrollbars, and not for a right-click.
      if (e.button !== 0) return;
      const drop = { id: ++n, x: e.clientX, y: e.clientY };
      setDrops((prev) => [...prev.slice(-(MAX - 1)), drop]);
    }
    // Capture phase: a ring should appear even when the element under the
    // finger stops the event from bubbling, which plenty of controls do.
    window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", onDown, { capture: true });
  }, []);

  if (drops.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[200] overflow-hidden" aria-hidden>
      {drops.map((d) => (
        <span
          key={d.id}
          className="mise-ripple"
          style={{ left: d.x, top: d.y }}
          onAnimationEnd={() =>
            setDrops((prev) => prev.filter((x) => x.id !== d.id))
          }
        >
          {/* Two rings at different speeds: one drop makes more than one wave,
              and a single expanding circle reads as a loading spinner. */}
          <span className="mise-ripple-ring" />
          <span className="mise-ripple-ring mise-ripple-ring-2" />
        </span>
      ))}
    </div>
  );
}
