"use client";

// A consistent date-range control used across Reports / Sales / Expenses so every
// money screen answers the same question the same way: "what period am I looking at?"
// Quick presets (relative time) + explicit From/To (absolute time) + a plain caption.
import { localISODate } from "@/lib/date";

export type Range = { from: string; to: string };

const shift = (n: number) => {
  const x = new Date();
  x.setDate(x.getDate() + n);
  return x;
};
const monthStartDate = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), 1);
};
const weekStartOffset = () => (new Date().getDay() + 6) % 7; // 0 = Monday

export const RANGE_PRESETS: { key: string; label: string; make: () => Range }[] = [
  { key: "today", label: "Today", make: () => ({ from: localISODate(), to: localISODate() }) },
  { key: "wtd", label: "This week", make: () => ({ from: localISODate(shift(-weekStartOffset())), to: localISODate() }) },
  { key: "mtd", label: "This month", make: () => ({ from: localISODate(monthStartDate()), to: localISODate() }) },
  { key: "7d", label: "Last 7 days", make: () => ({ from: localISODate(shift(-6)), to: localISODate() }) },
  { key: "30d", label: "Last 30 days", make: () => ({ from: localISODate(shift(-29)), to: localISODate() }) },
];

/** Which preset (if any) exactly matches the current range — so we can highlight it. */
export function activePreset(range: Range): string | null {
  for (const p of RANGE_PRESETS) {
    const r = p.make();
    if (r.from === range.from && r.to === range.to) return p.key;
  }
  return null;
}

/** Human caption: "Today", "This month (1 Jul – 2 Jul)", or "12 Jun – 30 Jun". */
export function rangeCaption(range: Range): string {
  const fmt = (s: string) => {
    const d = new Date(s + "T00:00:00");
    return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
  };
  const key = activePreset(range);
  const label = RANGE_PRESETS.find((p) => p.key === key)?.label;
  const span = range.from === range.to ? fmt(range.from) : `${fmt(range.from)} – ${fmt(range.to)}`;
  if (label && label !== "Today") return `${label} (${span})`;
  return label === "Today" ? "Today" : span;
}

export function RangeControls({
  range,
  onChange,
  className = "",
}: {
  range: Range;
  onChange: (r: Range) => void;
  className?: string;
}) {
  const active = activePreset(range);
  return (
    <div className={`flex flex-wrap items-end gap-x-2 gap-y-2 ${className}`}>
      <div className="flex flex-wrap gap-1.5">
        {RANGE_PRESETS.map((p) => {
          const on = active === p.key;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.make())}
              className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                on ? "bg-brand-600 text-white shadow-sm" : "border border-line-2 text-fg-soft hover:bg-paper-2"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-end gap-2">
        <label className="block">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-faint">From</span>
          <input
            type="date"
            value={range.from}
            max={range.to}
            onChange={(e) => onChange({ ...range, from: e.target.value })}
            className="mt-0.5 rounded-lg border border-line-2 px-2.5 py-1.5 text-sm"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-medium uppercase tracking-wide text-fg-faint">To</span>
          <input
            type="date"
            value={range.to}
            min={range.from}
            max={localISODate()}
            onChange={(e) => onChange({ ...range, to: e.target.value })}
            className="mt-0.5 rounded-lg border border-line-2 px-2.5 py-1.5 text-sm"
          />
        </label>
      </div>
    </div>
  );
}
