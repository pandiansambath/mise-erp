"use client";

// The Mise chef — a cinematic 3D-render maître in a glowing medallion.
// Poses live in /public/chef/*.png (see docs/CHEF_PROMPTS.md): he watches you
// type, covers his eyes for the password, peeks through his fingers when you
// hit "show", and beams while signing you in. Poses crossfade; the medallion
// breathes gently so he never feels like a static sticker.

export type ChefMood = "idle" | "watch" | "cover" | "peek" | "happy";

const POSE_SRC: Record<Exclude<ChefMood, "idle">, string> = {
  watch: "/chef/watch.png",
  cover: "/chef/cover.png",
  peek: "/chef/peek.png",
  happy: "/chef/happy.png",
};

export default function ChefMascot({
  mood,
  look = 0,
  className = "",
}: {
  mood: ChefMood;
  /** -1 … 1 — subtle head-turn parallax while watching you type */
  look?: number;
  className?: string;
}) {
  const active: keyof typeof POSE_SRC = mood === "idle" ? "watch" : mood;
  const px = Math.max(-1, Math.min(1, look)) * 4;

  return (
    <div className={`pointer-events-none select-none ${className}`} aria-hidden>
      <div
        className="mise-chef-breathe relative mx-auto aspect-square w-full overflow-hidden rounded-full shadow-2xl shadow-black/50 ring-1 ring-white/15"
        style={{ background: "radial-gradient(circle at 50% 30%, #10201a, #050d0a 75%)" }}
      >
        {(Object.keys(POSE_SRC) as (keyof typeof POSE_SRC)[]).map((pose) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={pose}
            src={POSE_SRC[pose]}
            alt=""
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: active === pose ? 1 : 0,
              transform: `translateX(${active === pose && pose === "watch" ? px : 0}px) scale(1.06)`,
              transition: "opacity 450ms ease, transform 400ms ease",
            }}
          />
        ))}
        {/* candle-warm inner rim so he sits IN the ui, not on it */}
        <div className="absolute inset-0 rounded-full" style={{ boxShadow: "inset 0 0 34px rgba(0,0,0,0.55), inset 0 -8px 24px rgba(16,185,129,0.10)" }} />
      </div>
    </div>
  );
}
