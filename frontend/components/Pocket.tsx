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
    { duration: 620, easing: "cubic-bezier(.4,.02,.2,1)" },
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
      setBump(true);
      const t = window.setTimeout(() => setBump(false), 400);
      return () => window.clearTimeout(t);
    }
    seen.current = count;
  }, [count]);

  useEffect(() => {
    seen.current = count;
  }, [count]);

  // Empty pockets are not worth screen space, and an empty one you can tap is
  // a click that leads to "nothing here yet".
  if (count === 0) return null;

  return (
    <button
      id="mise-pocket"
      type="button"
      onClick={onOpen}
      aria-label={`${count} ${label} — open`}
      className={`mise-press fixed right-4 top-20 z-40 flex items-center gap-2.5 rounded-2xl border border-brand-400/45 bg-paper-2/95 px-3.5 py-2.5 shadow-lg shadow-black/30 backdrop-blur transition sm:right-6 sm:top-24 ${
        bump ? "ring-2 ring-brand-400" : ""
      }`}
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
