"use client";

// The pocket.
//
// His idea, and a better one than the bar it replaces: you tap an item, it
// FLIES to a pocket in the corner, and the pocket keeps count. Tap the pocket
// and everything you have gathered opens up, with room to act on all of it.
//
// Why it beats a pinned tray. A tray answers "what have I got?" by taking
// permanent space to show you a list you mostly are not reading. A pocket
// answers it with one number and gives the space back — and the flight is what
// makes the number trustworthy, because you SAW the thing go in. Nobody has to
// look away from what they are picking to confirm the pick landed.
//
// Two details that separate this from a scale-and-fade:
//
// **The ghost travels on an arc.** Things thrown across a room do not move in
// straight lines. A midpoint lifted above the chord costs one keyframe and is
// most of why it reads as thrown rather than tweened.
//
// **The pocket answers back.** It takes a knock when something lands — a real
// container reacts to being filled, and without it the count just increments
// and the connection between the two events is left to be inferred.

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Throw a copy of `from` into the pocket. */
/** How long an item takes to reach the pocket. The pocket waits this long
 *  before reacting, so the throw and the catch read as one movement. */
export const FLIGHT_MS = 620;

export function flyToPocket(from: HTMLElement | null, label?: string) {
  if (typeof window === "undefined" || !from) return;
  const target = document.getElementById("mise-pocket");
  if (!target) return;

  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  if (!a.width || !b.width) return;

  const ghost = document.createElement("div");
  ghost.textContent = label ?? "";
  ghost.className =
    "pointer-events-none fixed z-[90] grid place-items-center rounded-xl border " +
    "border-brand-400/50 bg-brand-500/90 px-2 text-[11px] font-semibold text-white shadow-lg";
  ghost.style.left = `${a.left}px`;
  ghost.style.top = `${a.top}px`;
  ghost.style.width = `${Math.min(a.width, 180)}px`;
  ghost.style.height = `${Math.min(a.height, 40)}px`;
  ghost.style.whiteSpace = "nowrap";
  ghost.style.overflow = "hidden";
  document.body.appendChild(ghost);

  const dx = b.left + b.width / 2 - (a.left + Math.min(a.width, 180) / 2);
  const dy = b.top + b.height / 2 - (a.top + Math.min(a.height, 40) / 2);

  const anim = ghost.animate(
    [
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      {
        // The arc. Two-thirds of the way across and lifted above the straight
        // line — the shape of something thrown, not something interpolated.
        transform: `translate(${dx * 0.62}px, ${dy * 0.62 - Math.abs(dx) * 0.16 - 40}px) scale(.6)`,
        opacity: 0.95,
        offset: 0.6,
      },
      { transform: `translate(${dx}px, ${dy}px) scale(.12)`, opacity: 0.2 },
    ],
    { duration: FLIGHT_MS, easing: "cubic-bezier(.4,.02,.2,1)" },
  );
  anim.onfinish = () => {
    ghost.remove();
    // The pocket reacts to being filled. Without this the count simply
    // increments and nothing ties the two events together.
    target.animate(
      [
        { transform: "scale(1)" },
        { transform: "scale(1.22)" },
        { transform: "scale(1)" },
      ],
      { duration: 320, easing: "cubic-bezier(.34,1.56,.64,1)" },
    );
  };
}

export function Pocket({
  count,
  label,
  hint,
  onOpen,
  icon = "🧺",
}: {
  count: number;
  /** What is inside, e.g. "on your order". */
  label: string;
  /** A second line — the total, usually. The reason to look. */
  hint?: ReactNode;
  onOpen: () => void;
  icon?: ReactNode;
}) {
  const [bump, setBump] = useState(false);
  const seen = useRef(count);

  useEffect(() => {
    if (count > seen.current) {
      // Wait for the flight to arrive before reacting.
      //
      // The count changes the instant you tap, so the pocket used to jump while
      // the item was still in the air — the catch happened before the throw
      // landed, which reads as two unrelated twitches rather than one movement.
      // FLIGHT_MS matches the arc in flyToPocket.
      const land = window.setTimeout(() => setBump(true), FLIGHT_MS - 60);
      const done = window.setTimeout(() => setBump(false), FLIGHT_MS + 400);
      return () => {
        window.clearTimeout(land);
        window.clearTimeout(done);
      };
    }
    seen.current = count;
  }, [count]);

  useEffect(() => {
    seen.current = count;
  }, [count]);

  // The pocket exists from the start, even empty.
  //
  // It used to return null at zero, which meant the FIRST tap on an item had no
  // #mise-pocket to fly to: the animation silently did nothing, and since the
  // pocket only appeared afterwards there was no feedback at all at the moment
  // you clicked. "checkbox click not working" is exactly what that feels like.
  //
  // So it is always mounted and always the flight's destination; at zero it is
  // simply invisible and untappable, and it fades in as the first item lands.

  return (
    <button
      id="mise-pocket"
      type="button"
      onClick={onOpen}
      aria-label={`${count} ${label} — open`}
      disabled={count === 0}
      className={`mise-press fixed bottom-24 right-4 z-[55] flex items-center gap-2.5 rounded-2xl border border-brand-400/45 bg-paper-2/95 px-3.5 py-2.5 shadow-xl shadow-black/40 backdrop-blur transition-all duration-300 sm:right-6 lg:bottom-8 ${
        count === 0
          ? "pointer-events-none translate-y-3 scale-90 opacity-0"
          : "translate-y-0 scale-100 opacity-100"
      } ${bump ? "mise-pocket-bump ring-2 ring-brand-400" : ""}`}
    >
      <span aria-hidden className="relative text-xl leading-none">
        {icon}
        <span className="absolute -right-2 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-bold tabular-nums text-white">
          {count}
        </span>
      </span>
      <span className="hidden text-left leading-tight sm:block">
        <span className="block text-[11px] font-semibold text-fg">{label}</span>
        {hint && <span className="block text-[10px] text-fg-faint">{hint}</span>}
      </span>
      <span aria-hidden className="text-xs text-fg-faint">
        ›
      </span>
    </button>
  );
}
