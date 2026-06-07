// Mise logo — a fork whose tines rise like a bar chart.
// Food (the fork) + growth/analytics (ascending bars) = "the intelligence behind
// the plate." Emerald gradient. Reads cleanly from favicon to billboard.

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
        <linearGradient id="miseGrad" x1="4" y1="4" x2="60" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#34d399" />
          <stop offset="0.55" stopColor="#10b981" />
          <stop offset="1" stopColor="#047857" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="15" fill="url(#miseGrad)" />
      <g fill="white">
        {/* fork tines = ascending bar chart */}
        <rect x="16.5" y="27" width="5" height="9" rx="2.5" />
        <rect x="24.5" y="23" width="5" height="13" rx="2.5" />
        <rect x="32.5" y="19" width="5" height="17" rx="2.5" />
        <rect x="40.5" y="14" width="5" height="22" rx="2.5" />
        {/* neck joining the tines */}
        <rect x="16.5" y="34" width="29" height="4.5" rx="2.25" />
        {/* handle */}
        <rect x="28.5" y="37" width="5" height="14" rx="2.5" />
      </g>
    </svg>
  );
}
