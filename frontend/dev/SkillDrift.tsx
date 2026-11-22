// Skills drifting through the background, at different depths.
//
//   "skills moving here and there in background… background detailing"
//
// Every word on his skill cards, scattered behind the page: near ones larger
// and brighter, far ones small and faint, each wandering its own slow path
// and sliding past at its own speed as the page scrolls. Faint enough that it
// is texture, never something competing with the text in front of it.
//
// Positions come from a seeded generator, not Math.random: the server and the
// browser must draw the same picture, or the page hydrates with a mismatch.
// All motion is CSS (globals.css: devDrift, devParallax), on the compositor.

import { memo } from "react";
import { CLUSTERS } from "@/dev/skills";

/** mulberry32 — a tiny, repeatable random number source. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Thirty at most, taken round-robin from the groups: the résumé sync (22 Nov)
// took the skills from 28 to 71, and every floating word is a GPU layer of its
// own — the background stays as quiet, and as light, as it was.
const WORDS = (() => {
  const out: { label: string; hue: string }[] = [];
  for (let i = 0; out.length < 30; i++) {
    let any = false;
    for (const c of CLUSTERS) {
      if (i < c.items.length && out.length < 30) {
        out.push({ label: c.items[i], hue: c.hue });
        any = true;
      }
    }
    if (!any) break;
  }
  return out;
})();

const FLOATERS = (() => {
  const rnd = seeded(20240101);
  return WORDS.map((w, i) => {
    const depth = rnd(); // 0 = far, 1 = near
    return {
      ...w,
      // Spread over the whole screen in a loose grid, then jittered, so they
      // never clump into one corner.
      left: ((i * 37) % 100) * 0.92 + rnd() * 6,
      top: (((i * 61) % 100) * 0.9 + rnd() * 8) % 100,
      size: 10 + depth * 13,
      // Far words fainter, not blurred: a blur filter on thirty moving words
      // costs paint on every frame, and on a phone that is the frame rate.
      opacity: 0.04 + depth * 0.11,
      dx: (rnd() - 0.5) * 120,
      dy: (rnd() - 0.5) * 90,
      r0: (rnd() - 0.5) * 8,
      r1: (rnd() - 0.5) * 8,
      t: 34 + rnd() * 40,
      d: -rnd() * 60,
      // Near words travel further against the scroll: that difference is
      // what reads as depth.
      parallax: -(60 + depth * 260),
      phoneHidden: i % 2 === 1,
    };
  });
})();

// Memoised: the page re-renders every second for its clock, and none of this
// depends on it.
// `grid={false}` where the dot grid is painted elsewhere (the Chain design
// draws it in its background canvas — a full-screen layer fewer).
export const SkillDrift = memo(function SkillDrift({ grid = true }: { grid?: boolean }) {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {/* Blueprint detail: a faint dot grid, fading out toward the edges. */}
      {grid && <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(color-mix(in srgb, var(--d-ink4) 14%, transparent) 1px, transparent 1.2px)",
          backgroundSize: "26px 26px",
          WebkitMaskImage: "radial-gradient(80% 70% at 50% 40%, #000 30%, transparent 85%)",
          maskImage: "radial-gradient(80% 70% at 50% 40%, #000 30%, transparent 85%)",
        }}
      />}
      {FLOATERS.map((f) => (
        <span
          key={f.label}
          className={`dev-parallax absolute ${f.phoneHidden ? "hidden sm:block" : ""}`}
          style={{ left: `${f.left}%`, top: `${f.top}%`, ["--depth" as string]: `${f.parallax}px` }}
        >
          <span
            className="dev-drift block whitespace-nowrap font-mono"
            style={{
              fontSize: f.size,
              color: f.hue,
              opacity: f.opacity,
              ["--dx" as string]: `${f.dx}px`,
              ["--dy" as string]: `${f.dy}px`,
              ["--r0" as string]: `${f.r0}deg`,
              ["--r1" as string]: `${f.r1}deg`,
              ["--t" as string]: `${f.t}s`,
              ["--d" as string]: `${f.d}s`,
            }}
          >
            {f.label}
          </span>
        </span>
      ))}
    </div>
  );
});
