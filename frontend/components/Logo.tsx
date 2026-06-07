// Mise logo — hand-built vector.
// Concept: an "M" monogram whose strokes rise like a chart (profit/growth),
// topped by a single dot — one ingredient "in its place" (mise en place: prepped
// and ready). Emerald gradient = fresh + money. Crisp from favicon to billboard.

export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Mise"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="miseGrad" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#miseGrad)" />
      <path
        d="M17 45 V22 L32 37 L47 22 V45"
        stroke="white"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="32" cy="19.5" r="3.1" fill="white" />
    </svg>
  );
}
