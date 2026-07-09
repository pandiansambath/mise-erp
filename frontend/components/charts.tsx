"use client";

// The Mise chart kit — hand-rolled animated SVG, no library. Every chart
// draws itself when scrolled into view, respects reduced motion, and reads
// correctly in BOTH themes (colors via design tokens / passed tones).
//
//   <Sparkline data={[…]} />                    tiny trend, in cards
//   <AreaChart data={[…]} height={120} />       the hero trend chart
//   <Donut segments={[{label,value,color}]} />  composition (pie, but premium)
//   <Bars items={[{label,value,color?}]} />     comparison, animated widths
//   <Meter value={29} target={30} />            actual vs target

import { useId } from "react";
import { AnimatedNumber, useInView, usePrefersReducedMotion } from "@/components/fx";

/** Default categorical palette — brand-led, readable on paper in both themes. */
export const CHART_COLORS = [
  "#10b981", // emerald
  "#eab78a", // copper
  "#0ea5e9", // sky
  "#f59e0b", // amber
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#a78bfa", // violet
  "#94a3b8", // slate
];

const easeDraw = "cubic-bezier(0.22, 1, 0.36, 1)";

/* ────────────────────────── Sparkline ────────────────────────── */

export function Sparkline({
  data,
  color = "#10b981",
  height = 36,
  className = "",
}: {
  data: number[];
  color?: string;
  height?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const reduced = usePrefersReducedMotion();
  const id = useId();
  if (data.length < 2) return null;
  const W = 120;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    height - 3 - ((v - min) / span) * (height - 6),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const drawn = inView || reduced;
  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-full w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${line} L${W},${height} L0,${height} Z`}
          fill={`url(#sp-${id})`}
          style={{ opacity: drawn ? 1 : 0, transition: "opacity 700ms ease 600ms" }}
        />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={drawn ? 0 : 1}
          style={{ transition: `stroke-dashoffset 1100ms ${easeDraw} 150ms` }}
        />
      </svg>
    </div>
  );
}

/* ────────────────────────── AreaChart ────────────────────────── */

export function AreaChart({
  data,
  labels,
  color = "#10b981",
  height = 120,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  data: number[];
  /** optional x labels; first & last are shown */
  labels?: string[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const reduced = usePrefersReducedMotion();
  const id = useId();
  if (data.length < 2) return null;
  const W = 560;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * W,
    height - 6 - ((v - min) / span) * (height - 20),
  ]);
  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const drawn = inView || reduced;
  return (
    <div ref={ref} className={className}>
      <svg viewBox={`0 0 ${W} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={`ar-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.30" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* faint gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1="0"
            x2={W}
            y1={height * f}
            y2={height * f}
            stroke="currentColor"
            strokeOpacity="0.07"
            strokeDasharray="3 5"
          />
        ))}
        <path
          d={`${line} L${W},${height} L0,${height} Z`}
          fill={`url(#ar-${id})`}
          style={{ opacity: drawn ? 1 : 0, transition: "opacity 800ms ease 800ms" }}
        />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={drawn ? 0 : 1}
          style={{ transition: `stroke-dashoffset 1500ms ${easeDraw} 200ms` }}
        />
        <circle
          cx={last[0]}
          cy={last[1]}
          r="4"
          fill={color}
          style={{ opacity: drawn ? 1 : 0, transition: "opacity 400ms ease 1600ms" }}
        />
      </svg>
      {labels && labels.length > 1 ? (
        <div className="mt-1 flex justify-between font-mono text-[10px] text-fg-faint">
          <span>{labels[0]}</span>
          <span>{labels[labels.length - 1]}</span>
        </div>
      ) : null}
      <p className="sr-only">
        Trend from {formatValue(data[0])} to {formatValue(data[data.length - 1])}
      </p>
    </div>
  );
}

/* ──────────────────────────── Donut ──────────────────────────── */

export type DonutSegment = { label: string; value: number; color?: string };

export function Donut({
  segments,
  size = 148,
  thickness = 13,
  centerLabel,
  centerValue,
  legend = true,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  /** shown big in the middle; defaults to the total */
  centerValue?: string;
  legend?: boolean;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const reduced = usePrefersReducedMotion();
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  const drawn = inView || reduced;
  let acc = 0;
  return (
    <div ref={ref} className={`flex flex-wrap items-center gap-5 ${className}`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth={thickness} />
          {total > 0 &&
            segments.map((s, i) => {
              const frac = Math.max(0, s.value) / total;
              const offset = acc;
              acc += frac;
              return (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={R}
                  fill="none"
                  stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={thickness}
                  strokeLinecap={frac > 0.02 ? "round" : "butt"}
                  strokeDasharray={`${Math.max(0.001, frac * C - 2)} ${C}`}
                  strokeDashoffset={drawn ? -offset * C : C * 0.25}
                  style={{
                    opacity: drawn ? 1 : 0,
                    transition: `stroke-dashoffset 1100ms ${easeDraw} ${i * 90}ms, opacity 500ms ease ${i * 90}ms`,
                  }}
                />
              );
            })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            <p className="font-mono text-xl font-bold text-fg">{centerValue ?? formatValue(total)}</p>
            {centerLabel ? <p className="text-[10px] text-fg-faint">{centerLabel}</p> : null}
          </div>
        </div>
      </div>
      {legend ? (
        <ul className="min-w-0 flex-1 space-y-1.5">
          {segments.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }}
              />
              <span className="truncate text-fg-soft">{s.label}</span>
              <span className="ml-auto font-mono text-fg-faint">
                {total > 0 ? `${Math.round((s.value / total) * 100)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ──────────────────────────── Bars ───────────────────────────── */

export type BarItem = { label: string; value: number; color?: string; hint?: string };

export function Bars({
  items,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  items: BarItem[];
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = usePrefersReducedMotion();
  const max = Math.max(...items.map((i) => i.value), 1);
  const drawn = inView || reduced;
  return (
    <div ref={ref} className={`space-y-2.5 ${className}`}>
      {items.map((it, i) => (
        <div key={it.label} className="flex items-center gap-3 text-xs">
          <span className="w-28 shrink-0 truncate text-fg-soft" title={it.label}>
            {it.label}
          </span>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-glass/10">
            <span
              className="block h-full rounded-full"
              style={{
                width: drawn ? `${Math.max(1.5, (it.value / max) * 100)}%` : "0%",
                background: it.color ?? CHART_COLORS[i % CHART_COLORS.length],
                transition: `width 900ms ${easeDraw} ${i * 110}ms`,
              }}
            />
          </span>
          <span className="w-20 shrink-0 text-right font-mono text-fg-faint">{formatValue(it.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ──────────────────────────── Meter ──────────────────────────── */

export function Meter({
  value,
  target,
  label,
  suffix = "%",
  goodBelow = true,
  className = "",
}: {
  value: number;
  target: number;
  label?: string;
  suffix?: string;
  /** true → being under target is healthy (food cost, labour %) */
  goodBelow?: boolean;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const reduced = usePrefersReducedMotion();
  const drawn = inView || reduced;
  const healthy = goodBelow ? value <= target : value >= target;
  const tone = healthy ? "#10b981" : "#f59e0b";
  const maxScale = Math.max(value, target) * 1.25 || 1;
  return (
    <div ref={ref} className={className}>
      {label ? (
        <div className="mb-1.5 flex items-baseline justify-between text-xs">
          <span className="text-fg-soft">{label}</span>
          <span className="font-mono font-semibold" style={{ color: tone }}>
            <AnimatedNumber value={value} suffix={suffix} decimals={value % 1 ? 1 : 0} />
            <span className="ml-1 text-fg-faint">/ {target}{suffix} target</span>
          </span>
        </div>
      ) : null}
      <div className="relative h-2 overflow-visible rounded-full bg-glass/10">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: drawn ? `${(value / maxScale) * 100}%` : "0%",
            background: tone,
            transition: `width 1000ms ${easeDraw} 150ms`,
          }}
        />
        {/* target notch */}
        <span
          className="absolute -top-1 h-4 w-0.5 rounded bg-fg-faint/70"
          style={{ left: `${(target / maxScale) * 100}%` }}
          title={`target ${target}${suffix}`}
        />
      </div>
    </div>
  );
}
