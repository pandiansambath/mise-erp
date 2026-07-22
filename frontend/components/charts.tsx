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

import { useId, useRef, useState } from "react";
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

/* ────────────────────── instant hover tooltip ──────────────────────
   Every chart shares this: a glass tip that follows the cursor and shows
   the point's full story (label · value · share) with zero delay — no
   raw browser title bubbles. */

type TipState = { x: number; y: number; title: string; lines: string[] } | null;

function useChartTip() {
  const [tip, setTip] = useState<TipState>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const show = (e: { clientX: number; clientY: number }, title: string, lines: string[] = []) => {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return;
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, title, lines });
  };
  const hide = () => setTip(null);
  return { tip, show, hide, boxRef };
}

function ChartTip({ tip }: { tip: TipState }) {
  if (!tip) return null;
  return (
    <div
      className="mise-glass-panel pointer-events-none absolute z-30 min-w-[7rem] max-w-[15rem] rounded-xl px-3 py-2"
      style={{
        left: tip.x,
        top: tip.y,
        transform: `translate(${tip.x > 160 ? "calc(-100% - 10px)" : "12px"}, -110%)`,
      }}
      aria-hidden
    >
      <p className="truncate text-xs font-semibold text-fg">{tip.title}</p>
      {tip.lines.map((l, i) => (
        <p key={i} className="font-mono text-[11px] leading-snug text-fg-soft">{l}</p>
      ))}
    </div>
  );
}

/* ────────────────────────── Sparkline ────────────────────────── */

export function Sparkline({
  data,
  labels,
  color = "#10b981",
  height = 36,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  data: number[];
  /** optional per-point labels (dates) for the hover tip */
  labels?: string[];
  color?: string;
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.4);
  const reduced = usePrefersReducedMotion();
  const id = useId();
  const { tip, show, hide, boxRef } = useChartTip();
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
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((e.clientX - r.left) / r.width) * (data.length - 1))));
    show(e, labels?.[i] ?? `point ${i + 1}/${data.length}`, [formatValue(data[i])]);
  };
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative ${className}`}
    >
      <ChartTip tip={tip} />
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="h-full w-full"
        preserveAspectRatio="none"
        aria-hidden
        onMouseMove={onMove}
        onMouseLeave={hide}
      >
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
  const { tip, show, hide, boxRef } = useChartTip();
  const [hoverI, setHoverI] = useState<number | null>(null);
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
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (data.length - 1));
    const clamped = Math.max(0, Math.min(data.length - 1, i));
    setHoverI(clamped);
    show(e, labels?.[clamped] ?? `point ${clamped + 1}/${data.length}`, [formatValue(data[clamped])]);
  };
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative ${className}`}
    >
      <ChartTip tip={tip} />
      <svg
        viewBox={`0 0 ${W} ${height}`}
        className="w-full cursor-crosshair"
        style={{ height }}
        preserveAspectRatio="none"
        aria-hidden
        onMouseMove={onMove}
        onMouseLeave={() => {
          setHoverI(null);
          hide();
        }}
      >
        {hoverI != null && (
          <g>
            <line x1={pts[hoverI][0]} x2={pts[hoverI][0]} y1={0} y2={height} stroke={color} strokeOpacity="0.35" strokeDasharray="3 4" />
            <circle cx={pts[hoverI][0]} cy={pts[hoverI][1]} r="5" fill={color} stroke="#fff" strokeWidth="1.5" />
          </g>
        )}
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
  onSegmentClick,
  onSelect,
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
  /** drill-down: called when a slice/legend row is clicked a second time */
  onSegmentClick?: (segment: DonutSegment) => void;
  /** fires whenever the selected slice changes (null = deselected) — lets the
      page show a SUB-CHART of what's inside the slice */
  onSelect?: (segment: DonutSegment | null) => void;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const reduced = usePrefersReducedMotion();
  const { tip, show, hide, boxRef } = useChartTip();
  // Touch a slice → it pops out and the centre swaps to ITS name/value/share.
  const [sel, setSel] = useState<number | null>(null);
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  const R = (size - thickness) / 2;
  const C = 2 * Math.PI * R;
  const drawn = inView || reduced;
  const pick = (i: number, s: DonutSegment) => {
    if (sel === i) {
      if (onSegmentClick) onSegmentClick(s); // second tap = drill down
      else {
        setSel(null);
        onSelect?.(null);
      }
    } else {
      setSel(i);
      onSelect?.(s);
    }
  };
  const active = sel != null ? segments[sel] : null;
  let acc = 0;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative flex flex-wrap items-center gap-5 ${className}`}
    >
      <ChartTip tip={tip} />
      <div className="relative" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90 overflow-visible">
          <circle cx={size / 2} cy={size / 2} r={R} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth={thickness} />
          {total > 0 &&
            segments.map((s, i) => {
              const frac = Math.max(0, s.value) / total;
              const offset = acc;
              acc += frac;
              const isSel = sel === i;
              const dim = sel != null && !isSel;
              return (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={R}
                  fill="none"
                  stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
                  strokeWidth={isSel ? thickness + 5 : thickness}
                  strokeLinecap={frac > 0.02 ? "round" : "butt"}
                  strokeDasharray={`${Math.max(0.001, frac * C - 2)} ${C}`}
                  strokeDashoffset={drawn ? -offset * C : C * 0.25}
                  onClick={() => pick(i, s)}
                  onMouseMove={(e) => show(e, s.label, [formatValue(s.value), `${Math.round(frac * 100)}% of total`])}
                  onMouseLeave={hide}
                  className="cursor-pointer"
                  style={{
                    opacity: drawn ? (dim ? 0.3 : 1) : 0,
                    transition: `stroke-dashoffset 1100ms ${easeDraw} ${i * 90}ms, opacity 400ms ease, stroke-width 250ms ${easeDraw}`,
                  }}
                />
              );
            })}
        </svg>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          {active ? (
            <div className="mise-pop px-3 text-center">
              <p className="truncate text-[11px] font-medium" style={{ color: active.color ?? CHART_COLORS[(sel ?? 0) % CHART_COLORS.length] }}>
                {active.label}
              </p>
              <p className="font-mono text-lg font-bold text-fg">{formatValue(active.value)}</p>
              <p className="text-[10px] text-fg-faint">
                {total > 0 ? `${Math.round((active.value / total) * 100)}% of total` : ""}
                {onSegmentClick ? " · tap again to open" : ""}
              </p>
            </div>
          ) : (
            <div className="text-center">
              <p className="font-mono text-xl font-bold text-fg">{centerValue ?? formatValue(total)}</p>
              {centerLabel ? <p className="text-[10px] text-fg-faint">{centerLabel}</p> : null}
            </div>
          )}
        </div>
      </div>
      {legend ? (
        <ul className="min-w-0 flex-1 space-y-1">
          {segments.map((s, i) => (
            <li key={s.label}>
              <button
                type="button"
                onClick={() => pick(i, s)}
                className={`mise-press flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-xs transition-colors ${
                  sel === i ? "mise-well" : "hover:bg-glass/5"
                } ${sel != null && sel !== i ? "opacity-50" : ""}`}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 self-center rounded-full"
                  style={{ background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="min-w-0 max-w-[60%] truncate text-fg-soft">{s.label}</span>
                <span aria-hidden className="mx-1 flex-1 self-center border-b border-dotted border-line-2" />
                <span className="shrink-0 font-mono text-fg-faint">
                  {sel === i ? formatValue(s.value) : total > 0 ? `${Math.round((s.value / total) * 100)}%` : "—"}
                </span>
              </button>
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
  const { tip, show, hide, boxRef } = useChartTip();
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((s, x) => s + Math.max(0, x.value), 0);
  const drawn = inView || reduced;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative space-y-2.5 ${className}`}
    >
      <ChartTip tip={tip} />
      {items.map((it, i) => (
        <div
          key={it.label}
          className="flex items-center gap-3 rounded-lg px-1 text-xs transition-colors hover:bg-glass/5"
          onMouseMove={(e) =>
            show(e, it.label, [
              formatValue(it.value),
              total > 0 ? `${Math.round((it.value / total) * 100)}% of total` : "",
              it.hint ?? "",
            ].filter(Boolean))
          }
          onMouseLeave={hide}
        >
          <span className="w-28 shrink-0 truncate text-fg-soft">
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
  const { tip, show, hide, boxRef } = useChartTip();
  const drawn = inView || reduced;
  const healthy = goodBelow ? value <= target : value >= target;
  const tone = healthy ? "#10b981" : "#f59e0b";
  const maxScale = Math.max(value, target) * 1.25 || 1;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative ${className}`}
      onMouseMove={(e) =>
        show(e, label ?? "vs target", [
          `now ${value}${suffix} · target ${target}${suffix}`,
          healthy ? "on track ✓" : goodBelow ? "over target" : "under target",
        ])
      }
      onMouseLeave={hide}
    >
      <ChartTip tip={tip} />
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

/* ────────────────────────── Treemap ──────────────────────────
   Modern "expense map": every category is a box, area = share of spend.
   Strip layout (rows of proportional widths) — reads instantly, no lib. */

export type TreemapItem = { label: string; value: number; color?: string };

export function Treemap({
  items,
  height = 220,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  items: TreemapItem[];
  height?: number;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = usePrefersReducedMotion();
  const { tip, show, hide, boxRef } = useChartTip();
  const drawn = inView || reduced;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((s, i) => s + i.value, 0);
  if (total <= 0 || sorted.length === 0) return null;

  // Slice into rows of ~1–3 boxes: big items get their own row, small share one.
  const rows: TreemapItem[][] = [];
  let row: TreemapItem[] = [];
  let rowSum = 0;
  for (const it of sorted) {
    row.push(it);
    rowSum += it.value;
    if (rowSum >= total / 3 || row.length >= 3) {
      rows.push(row);
      row = [];
      rowSum = 0;
    }
  }
  if (row.length) rows.push(row);

  let i = 0;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative flex w-full flex-col gap-1 ${className}`}
      style={{ height }}
    >
      <ChartTip tip={tip} />
      {rows.map((r, ri) => {
        const rSum = r.reduce((s, x) => s + x.value, 0);
        return (
          <div key={ri} className="flex min-h-0 gap-1" style={{ flexGrow: rSum }}>
            {r.map((it) => {
              const idx = i++;
              return (
                <div
                  key={it.label}
                  onMouseMove={(e) => show(e, it.label, [formatValue(it.value), `${Math.round((it.value / total) * 100)}% of spend`])}
                  onMouseLeave={hide}
                  className="mise-feel relative min-w-0 overflow-hidden rounded-lg p-2"
                  style={{
                    flexGrow: it.value,
                    flexBasis: 0,
                    background: `${it.color ?? CHART_COLORS[idx % CHART_COLORS.length]}26`,
                    border: `1px solid ${it.color ?? CHART_COLORS[idx % CHART_COLORS.length]}55`,
                    opacity: drawn ? 1 : 0,
                    transform: drawn ? "scale(1)" : "scale(0.92)",
                    transition: `opacity 600ms ${easeDraw} ${idx * 90}ms, transform 600ms ${easeDraw} ${idx * 90}ms`,
                  }}
                >
                  <p className="truncate text-[11px] font-medium" style={{ color: it.color ?? CHART_COLORS[idx % CHART_COLORS.length] }}>
                    {it.label}
                  </p>
                  <p className="truncate text-xs font-semibold text-fg">{formatValue(it.value)}</p>
                  <p className="text-[10px] text-fg-faint">{Math.round((it.value / total) * 100)}%</p>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ────────────────────────── Waffle ──────────────────────────
   "Every £1 you took in": a 10×10 grid — each square is 1%. The most
   instantly-readable proportion chart there is for non-finance people. */

export function Waffle({
  segments,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  segments: { label: string; value: number; color: string }[];
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = usePrefersReducedMotion();
  const { tip, show, hide, boxRef } = useChartTip();
  const drawn = inView || reduced;
  const total = segments.reduce((s, x) => s + Math.max(0, x.value), 0);
  if (total <= 0) return null;
  // 100 cells, allocated by share (largest remainder keeps the sum at 100)
  const exact = segments.map((s) => (Math.max(0, s.value) / total) * 100);
  const cells = exact.map(Math.floor);
  let left = 100 - cells.reduce((s, n) => s + n, 0);
  const rema = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r);
  for (const { i } of rema) {
    if (left <= 0) break;
    cells[i] += 1;
    left -= 1;
  }
  const colors: string[] = [];
  const owners: number[] = [];
  segments.forEach((s, i) => {
    for (let k = 0; k < cells[i]; k++) {
      colors.push(s.color);
      owners.push(i);
    }
  });

  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative ${className}`}
    >
      <ChartTip tip={tip} />
      <div className="grid grid-cols-10 gap-1">
        {colors.map((c, i) => (
          <span
            key={i}
            onMouseMove={(e) => {
              const seg = segments[owners[i]];
              show(e, seg.label, [formatValue(seg.value), `${cells[owners[i]]}% of the total`]);
            }}
            onMouseLeave={hide}
            className="aspect-square rounded-[3px]"
            style={{
              background: c,
              opacity: drawn ? 0.9 : 0,
              transform: drawn ? "scale(1)" : "scale(0.4)",
              transition: `opacity 420ms ${easeDraw} ${i * 9}ms, transform 420ms ${easeDraw} ${i * 9}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {segments.map((s, i) => (
          <span key={s.label} className="flex items-center gap-1.5 text-xs text-fg-soft">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
            {s.label} · <b className="text-fg">{cells[i]}%</b>
            <span className="text-fg-faint">({formatValue(s.value)})</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────── RadialBars ──────────────────────────
   Activity-ring style: concentric arcs, each ring's sweep = its share of
   the largest value. Premium "watch rings" look for top-N comparisons. */

export function RadialBars({
  items,
  size = 180,
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  onItemClick,
  className = "",
}: {
  items: { label: string; value: number; color?: string }[];
  size?: number;
  formatValue?: (v: number) => string;
  /** tap a legend row to drill into that item */
  onItemClick?: (item: { label: string; value: number }) => void;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.35);
  const reduced = usePrefersReducedMotion();
  const { tip, show, hide, boxRef } = useChartTip();
  const drawn = inView || reduced;
  const sorted = [...items].filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  const restSum = rest.reduce((s, x) => s + x.value, 0);
  const max = Math.max(...top.map((i) => i.value), 1);
  const thickness = 9;
  const gap = 4;
  const c = size / 2;
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative ${className}`}
    >
      <ChartTip tip={tip} />
      <div className="flex flex-wrap items-center gap-5">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90">
          {top.map((it, i) => {
            const r = c - thickness / 2 - i * (thickness + gap);
            if (r <= 8) return null;
            const circ = 2 * Math.PI * r;
            const frac = Math.min(1, it.value / max) * 0.83; // cap sweep so rings never close
            const color = it.color ?? CHART_COLORS[i % CHART_COLORS.length];
            return (
              <g
                key={it.label}
                onMouseMove={(e) => show(e, it.label, [formatValue(it.value), `${Math.round((it.value / max) * 100)}% of the biggest`])}
                onMouseLeave={hide}
              >
                <circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeOpacity={0.14} strokeWidth={thickness} />
                <circle
                  cx={c} cy={c} r={r} fill="none"
                  stroke={color} strokeWidth={thickness} strokeLinecap="round"
                  strokeDasharray={circ}
                  strokeDashoffset={drawn ? circ * (1 - frac) : circ}
                  style={{ transition: `stroke-dashoffset 1300ms ${easeDraw} ${i * 140}ms` }}
                />
              </g>
            );
          })}
        </svg>
        <ul className="min-w-0 flex-1 space-y-1">
          {top.map((it, i) => (
            <li key={it.label}>
              <button
                type="button"
                onClick={onItemClick ? () => onItemClick(it) : undefined}
                className={`flex w-full items-baseline gap-2 rounded-lg px-1.5 py-1 text-left text-xs ${
                  onItemClick ? "mise-press cursor-pointer transition-colors hover:bg-glass/5" : "cursor-default"
                }`}
                title={onItemClick ? `Show ${it.label} in the table` : it.label}
              >
                <span className="h-2.5 w-2.5 shrink-0 self-center rounded-full" style={{ background: it.color ?? CHART_COLORS[i % CHART_COLORS.length] }} />
                <span className="min-w-0 max-w-[60%] truncate text-fg-soft">{it.label}</span>
                {/* menu-style dot leader — the eye never loses which price is whose */}
                <span aria-hidden className="mx-1 flex-1 border-b border-dotted border-line-2" />
                <span className="shrink-0 font-medium text-fg">{formatValue(it.value)}</span>
              </button>
            </li>
          ))}
          {rest.length > 0 && (
            <li className="flex items-baseline gap-2 px-1.5 py-1 text-xs text-fg-faint">
              <span className="h-2.5 w-2.5 shrink-0 self-center rounded-full bg-glass/20" />
              <span className="min-w-0 truncate">+ {rest.length} more item{rest.length === 1 ? "" : "s"}</span>
              <span aria-hidden className="mx-1 flex-1 border-b border-dotted border-line-2" />
              <span className="shrink-0 font-mono">{formatValue(restSum)}</span>
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}

/* ────────────────────────── CalendarHeat ──────────────────────────
   GitHub-style month heatmap: one cell per day, colour intensity = takings.
   The month's rhythm at a glance — weekends glow, dead Mondays fade. */

export function CalendarHeat({
  days,
  color = "#10b981",
  formatValue = (v: number) => v.toLocaleString("en-GB"),
  className = "",
}: {
  /** ISO date + value; missing days render as empty cells */
  days: { date: string; value: number }[];
  color?: string;
  formatValue?: (v: number) => string;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const reduced = usePrefersReducedMotion();
  const { tip, show, hide, boxRef } = useChartTip();
  const drawn = inView || reduced;
  if (days.length === 0) return null;
  const byDate = new Map(days.map((d) => [d.date, d.value]));
  const dates = [...byDate.keys()].sort();
  const first = new Date(dates[0] + "T00:00:00");
  const last = new Date(dates[dates.length - 1] + "T00:00:00");
  const max = Math.max(...days.map((d) => d.value), 1);
  // grid starts on the Monday of the first week
  const start = new Date(first);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const weeks: Date[][] = [];
  const cur = new Date(start);
  while (cur <= last) {
    const week: Date[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }
  const DOW = ["M", "T", "W", "T", "F", "S", "S"];
  let cellIdx = 0;
  // Month label above each week whose Monday opens a new month — so dates are
  // readable at a glance (mobile can't hover). GitHub-contribution style.
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthLabels = weeks.map((week, wi) => {
    const m = week[0].getMonth();
    const prev = wi > 0 ? weeks[wi - 1][0].getMonth() : -1;
    return m !== prev ? MON[m] : "";
  });
  return (
    <div
      ref={(el) => {
        ref.current = el;
        boxRef.current = el;
      }}
      className={`relative flex gap-1.5 ${className}`}
    >
      <ChartTip tip={tip} />
      <div className="grid grid-rows-7 gap-1 pr-0.5 pt-[14px] text-[9px] leading-none text-fg-faint">
        {DOW.map((d, i) => (
          <span key={i} className="flex h-4 items-center">{d}</span>
        ))}
      </div>
      <div className="overflow-x-auto">
      <div className="mb-1 flex gap-1">
        {monthLabels.map((lbl, i) => (
          <span key={i} className="w-4 shrink-0 text-[9px] leading-none text-fg-faint">{lbl}</span>
        ))}
      </div>
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-rows-7 gap-1">
            {week.map((d) => {
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
              const v = byDate.get(iso);
              const inRange = d >= first && d <= last;
              const idx = cellIdx++;
              const alpha = v ? 0.16 + 0.84 * Math.min(1, v / max) : 0;
              return (
                <span
                  key={iso}
                  onMouseMove={
                    inRange
                      ? (e) => {
                          const nice = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
                          show(e, nice, [v ? formatValue(v) : "no sales recorded"]);
                        }
                      : undefined
                  }
                  onMouseLeave={inRange ? hide : undefined}
                  className="h-4 w-4 rounded-[4px]"
                  style={{
                    background: v ? color : "currentColor",
                    opacity: drawn ? (inRange ? (v ? alpha : 0.07) : 0) : 0,
                    transform: drawn ? "scale(1)" : "scale(0.3)",
                    transition: `opacity 420ms ${easeDraw} ${idx * 12}ms, transform 420ms ${easeDraw} ${idx * 12}ms`,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
