"use client";

// The Mise chef — a cinematic 3D-render maître in a breathing medallion.
// 10 poses live in /public/chef/*.webp (docs/CHEF_PROMPTS.md). Pose changes
// don't jump: the outgoing render blurs and swells, the incoming one arrives
// through a kitchen-steam puff — like he moved while the steam rolled past.

import { useEffect, useRef, useState } from "react";

export type ChefMood =
  | "idle" | "watch" | "cover" | "peek" | "happy"
  | "welcome" | "shrug" | "serve" | "point" | "think" | "books";

const POSES = [
  "watch", "cover", "peek", "happy", "welcome",
  "shrug", "serve", "point", "think", "books",
] as const;
type Pose = (typeof POSES)[number];

export default function ChefMascot({
  mood,
  look = 0,
  className = "",
}: {
  mood: ChefMood;
  /** -1 … 1 — subtle parallax while he watches you type */
  look?: number;
  className?: string;
}) {
  const active: Pose = mood === "idle" ? "watch" : (mood as Pose);
  const px = Math.max(-1, Math.min(1, look)) * 4;

  // A steam puff rolls over the medallion on every pose change.
  const [puff, setPuff] = useState(0);
  const prev = useRef(active);
  useEffect(() => {
    if (prev.current !== active) {
      prev.current = active;
      setPuff((n) => n + 1);
    }
  }, [active]);

  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden>
      <div
        className="mise-chef-breathe relative mx-auto aspect-square w-full overflow-hidden rounded-full shadow-2xl shadow-black/50 ring-1 ring-white/15"
        style={{ background: "radial-gradient(circle at 50% 30%, #10201a, #050d0a 75%)" }}
      >
        {POSES.map((pose) => {
          const on = active === pose;
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={pose}
              src={`/chef/${pose}.webp`}
              alt=""
              decoding="async"
              loading={pose === "watch" ? "eager" : "lazy"}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                opacity: on ? 1 : 0,
                filter: on ? "blur(0px)" : "blur(7px)",
                transform: `translateX(${on && pose === "watch" ? px : 0}px) scale(${on ? 1.06 : 1.14})`,
                transition: "opacity 550ms ease, filter 550ms ease, transform 550ms ease",
              }}
            />
          );
        })}
        {/* the steam that hides the move */}
        {puff > 0 && <span key={puff} className="mise-chef-puff" />}
        {/* candle-warm inner rim so he sits IN the ui, not on it */}
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 0 34px rgba(0,0,0,0.55), inset 0 -8px 24px rgba(16,185,129,0.10)" }} />
      </div>
    </div>
  );
}
