"use client";

// "How do you buy it?" — the buying chain, written as a sentence.
//
// His brief, and the rule over all of it:
//
//   "1 box of pepper, it will have 10 small box, each box will have 30 packets
//    of 50g... THIS SITE IS MAINLY FOR LAYMEN BRO — even a layman needs to use
//    the site with flexibility, easy to use, friendly"
//
// So: no "pack size", no "case", no "UOM", no "conversion factor". Two plain
// questions, rows that read left to right as English, and — the part that
// actually makes it safe — a live echo underneath spelling out what was just
// typed. A wrong number is visible while you are entering it, instead of a
// month later in the stock value.
//
// Each row says "1 <name> = <n> <the thing below>". The right-hand unit fills
// itself in from the row above, so there is nothing to look up and no way to
// pair the wrong units together.

import { useMemo } from "react";

export type PackLevel = { name: string; contains: string };

/** 1500 -> "1500", 1.5 -> "1.5". Never 1E+3: this screen is for a layman. */
function tidy(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Math.round(n * 1000) / 1000);
}

/** How many base units one of level `i` is — the product down the chain. */
export function baseSizeAt(levels: PackLevel[], i: number): number {
  let size = 1;
  for (let k = 0; k <= i && k < levels.length; k++) {
    const n = parseFloat(levels[k].contains);
    if (!Number.isFinite(n) || n <= 0) return 0;
    size *= n;
  }
  return size;
}

export function PackChainEditor({
  baseUnit,
  levels,
  onChange,
  disabled = false,
}: {
  /** What stock and recipes count in — g, ml, piece. */
  baseUnit: string;
  levels: PackLevel[];
  onChange: (next: PackLevel[]) => void;
  disabled?: boolean;
}) {
  const unit = baseUnit.trim() || "unit";

  // The sentence, biggest first: "1 box = 10 small box = 300 packet = 15000 g".
  const echo = useMemo(() => {
    const usable = levels.filter(
      (l) => l.name.trim() && parseFloat(l.contains) > 0,
    );
    if (!usable.length) return [];
    return usable
      .map((lv, i) => {
        const parts = [`1 ${lv.name.trim()}`];
        for (let k = i - 1; k >= 0; k--) {
          const n = baseSizeAt(usable, i) / baseSizeAt(usable, k);
          parts.push(`${tidy(n)} ${usable[k].name.trim()}`);
        }
        parts.push(`${tidy(baseSizeAt(usable, i))} ${unit}`);
        return parts.join(" = ");
      })
      .reverse();
  }, [levels, unit]);

  const set = (i: number, patch: Partial<PackLevel>) =>
    onChange(levels.map((l, k) => (k === i ? { ...l, ...patch } : l)));

  const remove = (i: number) => onChange(levels.filter((_, k) => k !== i));

  return (
    <div className="rounded-2xl border border-line bg-paper-2/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold text-fg">
            How do you buy it?
          </p>
          <p className="mt-0.5 text-xs text-fg-faint">
            Only if it comes in packs. Stock and recipes still count in{" "}
            <b className="text-fg-soft">{unit}</b>.
          </p>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange([...levels, { name: "", contains: "" }])}
          className="mise-press shrink-0 rounded-xl border border-brand-400/40 bg-brand-400/10 px-3 py-1.5 text-xs font-medium text-brand-300 disabled:opacity-50"
        >
          ＋ Add a size
        </button>
      </div>

      {levels.length > 0 && (
        <div className="mt-3 space-y-2">
          {levels.map((lv, i) => {
            // The unit on the right is whatever the row below is called — the
            // smallest row sits directly on the base unit. Filling it in
            // automatically is what stops anyone pairing the wrong two things.
            const below = i === 0 ? unit : levels[i - 1].name.trim() || "…";
            return (
              <div
                key={i}
                className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper px-3 py-2"
              >
                <span className="text-sm text-fg-faint">1</span>
                <input
                  value={lv.name}
                  disabled={disabled}
                  onChange={(e) => set(i, { name: e.target.value })}
                  placeholder={i === 0 ? "packet" : i === 1 ? "small box" : "box"}
                  className="min-w-0 flex-1 rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-sm text-fg placeholder:text-fg-faint/60 sm:max-w-[10rem]"
                />
                <span className="text-sm text-fg-faint">=</span>
                <input
                  value={lv.contains}
                  disabled={disabled}
                  inputMode="decimal"
                  onChange={(e) =>
                    set(i, { contains: e.target.value.replace(/[^\d.]/g, "") })
                  }
                  placeholder="0"
                  className="w-20 rounded-lg border border-line bg-paper-2 px-2.5 py-1.5 text-sm tabular-nums text-fg"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-fg-soft">
                  {below}
                  {parseFloat(lv.contains) === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => remove(i)}
                  aria-label={`Remove ${lv.name || "this size"}`}
                  className="mise-press shrink-0 rounded-lg px-2 py-1 text-fg-faint hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* The safety net. Built from what they just typed, so a wrong number is
          visible now rather than a month later in the stock value. */}
      {echo.length > 0 && (
        <div className="mt-3 rounded-xl border border-brand-400/25 bg-brand-400/[0.06] px-3.5 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-brand-300">
            So that means
          </p>
          <ul className="mt-1 space-y-0.5">
            {echo.map((line) => (
              <li key={line} className="text-sm tabular-nums text-fg">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {levels.length === 0 && (
        <p className="mt-3 text-xs text-fg-faint">
          Bought loose, by the {unit}? Then there is nothing to add here.
        </p>
      )}
    </div>
  );
}
