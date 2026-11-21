// The header every card on the page wears: a glyph, small capitals in the
// card's own colour, a hairline that fades out, and a quiet note on the right.
// The same shape SkillClusters draws, written once here so the newer cards
// cannot drift from it.

import type { ReactNode } from "react";

export function SectionHead({
  glyph,
  label,
  hue,
  aside,
}: {
  glyph: string;
  label: string;
  hue: string;
  aside?: ReactNode;
}) {
  return (
    <div className="relative flex items-baseline gap-2.5">
      <span aria-hidden className="text-base" style={{ color: hue }}>
        {glyph}
      </span>
      <h3 className="font-mono text-[11px] tracking-[0.24em]" style={{ color: hue }}>
        {label.toUpperCase()}
      </h3>
      <span
        aria-hidden
        className="mb-1 h-px flex-1"
        style={{ background: `linear-gradient(90deg, ${hue}55, transparent)` }}
      />
      {aside != null && (
        <span className="font-mono text-[10px] tabular-nums tracking-[0.14em] text-[#4a5c70]">{aside}</span>
      )}
    </div>
  );
}
