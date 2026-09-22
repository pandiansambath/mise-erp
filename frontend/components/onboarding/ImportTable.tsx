"use client";

/** What is about to happen to your data, at the width of a desk.
 *
 *  Replaces `ImportPlan`'s body inside the onboarding flow. Its LOGIC was
 *  right and is kept wholesale — the grouping, the decisions, the
 *  keep-ours default. What was wrong was everything about the presentation,
 *  and the design pass measured it: the panel rendered at 352×423 on a
 *  1440×900 screen, identical to the phone, with the diff's own column
 *  headers underneath the values at 10px.
 *
 *  FOUR DECISIONS, each answering something he has said more than once.
 *
 *  1. THE CHIPS ARE THE FILTER, and the default is the work. "i hate
 *     scrolling" — on a 203-row import the first screen shows the 4 rows
 *     that need him, not 203. The rest is one tap away. A chip reading 0 is
 *     not rendered at all; a row of zeroes is how a good import looks like a
 *     failure.
 *
 *  2. A BOX MEANS WORK. Only rows needing a decision get a box. Everything
 *     else is a ruled line with a 3px tone spine. Two hundred rows of equal
 *     weight is the "clumsy" he described, and it is why `mise-well` inside
 *     `mise-card-inset` does not help: on this product they are the same
 *     recipe in light mode, so the nesting is invisible.
 *
 *  3. A GRID WITH ROLES, NOT A TABLE. One component, both widths, same DOM —
 *     columns at `lg`, stacked cells at 390. Mobile parity is then structural
 *     rather than a second implementation that drifts.
 *
 *  4. EVERY NUMBER CARRIES ITS UNIT. "25 kg", never "25" with the unit in a
 *     header three columns away.
 */

import { useMemo, useState } from "react";

/** Which supplier a stock row would be linked to, worked out at PREVIEW
 *  time rather than at commit. `suggested` is never applied on his behalf:
 *  attaching a price list to the wrong supplier is the one mistake here that
 *  costs money quietly. */
export type SupplierMatch = {
  given: string;
  status: "matched" | "suggested" | "unknown" | "blank";
  vendor_id?: string;
  matched_name?: string;
  suggestions?: { name: string; id: string }[];
};

export type PlanRow = {
  n: number;
  supplier_match?: SupplierMatch;
  values: Record<string, unknown>;
  verdict: "new" | "duplicate" | "invalid";
  existing: Record<string, unknown> | null;
  differences: { field: string; label: string; ours: string; theirs: string }[] | null;
  reason: string | null;
};

export type Plan = {
  errors: string[];
  counts: { new: number; duplicates: number; unchanged: number; invalid?: number; total: number };
  rows: PlanRow[];
};

export type Decision = {
  n: number;
  action: "create" | "update" | "skip";
  values: Record<string, unknown>;
};

/** Literal strings, one per list. `grid-cols-[...]` assembled at runtime
 *  emits no CSS at all — Tailwind only ships what it can see in the source. */
const COLS: Record<string, string> = {
  vendors: "lg:grid-cols-[minmax(0,1fr)_10rem_12rem_8rem]",
  inventory: "lg:grid-cols-[minmax(0,1fr)_4.5rem_8rem_7rem_13rem]",
  employees: "lg:grid-cols-[minmax(0,1fr)_9rem_10rem]",
  recipes: "lg:grid-cols-[minmax(0,1fr)_9rem_5rem_6rem]",
};

/** Which fields to show, in order, per list — and how to label them. */
const SHOW: Record<string, { key: string; label: string; right?: boolean; unit?: string }[]> = {
  vendors: [
    { key: "name", label: "Supplier" },
    { key: "category", label: "Supplies" },
    { key: "mobile", label: "Phone" },
    { key: "email", label: "Email" },
  ],
  inventory: [
    { key: "name", label: "Item" },
    { key: "unit", label: "Unit" },
    { key: "category", label: "Category" },
    { key: "current_stock", label: "In stock", right: true, unit: "unit" },
    { key: "supplier", label: "Supplier" },
  ],
  employees: [
    { key: "full_name", label: "Name" },
    { key: "job_title", label: "Job" },
    { key: "mobile", label: "Phone" },
  ],
  recipes: [
    { key: "name", label: "Dish" },
    { key: "category", label: "Section" },
    { key: "servings_default", label: "Serves", right: true },
    { key: "selling_price", label: "Price", right: true },
  ],
};

type Filter = "todo" | "new" | "same" | "bad";

function text(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function Chip({
  n,
  on,
  tone,
  onClick,
  children,
}: {
  n: number;
  on: boolean;
  tone: "warn" | "good" | "none" | "bad";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const dot =
    tone === "warn"
      ? "mise-bg-warn"
      : tone === "good"
        ? "mise-bg-good"
        : tone === "bad"
          ? "bg-danger"
          : "bg-glass/30";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`mise-press mise-card-inset flex min-h-[2.25rem] items-center gap-1.5 rounded-full px-3 text-[0.8125rem] lg:min-h-[2rem] ${
        on ? "ring-2 ring-brand-500/30" : ""
      }`}
    >
      <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      <b className="tabular-nums text-fg">{n}</b>
      <span className="text-fg-soft">{children}</span>
    </button>
  );
}

export function ImportTable({
  plan,
  list,
  source,
  busy,
  onCommit,
  onCancel,
}: {
  plan: Plan;
  /** Which list this is — picks the columns. */
  list: string;
  /** "stock-list.csv", or "what you typed". Shown, so he can tell them apart. */
  source?: string;
  busy?: boolean;
  onCommit: (decisions: Decision[]) => void;
  onCancel?: () => void;
}) {
  /** Per-row choice, duplicates only. `false` = keep ours, which is the
   *  default because the safe choice must be what happens if he taps the
   *  button without reading — that is what people do. */
  const [take, setTake] = useState<Record<number, boolean>>({});

  const groups = useMemo(() => {
    const dupes = plan.rows.filter((r) => r.verdict === "duplicate");
    return {
      fresh: plan.rows.filter((r) => r.verdict === "new"),
      changed: dupes.filter((r) => (r.differences?.length ?? 0) > 0),
      same: dupes.filter((r) => (r.differences?.length ?? 0) === 0),
      bad: plan.rows.filter((r) => r.verdict === "invalid"),
    };
  }, [plan.rows]);

  // THE WORK FIRST. Landing on 188 rows of reassurance and having to hunt for
  // the 4 that need him is the scrolling he keeps objecting to.
  const [filter, setFilter] = useState<Filter>(groups.changed.length ? "todo" : "new");

  const cols = COLS[list] ?? COLS.vendors;
  const fields = SHOW[list] ?? SHOW.vendors;

  const decisions: Decision[] = useMemo(
    () => [
      ...groups.fresh.map((r) => ({ n: r.n, action: "create" as const, values: r.values })),
      ...groups.changed.map((r) => ({
        n: r.n,
        action: (take[r.n] ? "update" : "skip") as "update" | "skip",
        values: r.values,
      })),
      ...groups.same.map((r) => ({ n: r.n, action: "skip" as const, values: r.values })),
    ],
    [groups, take],
  );

  if (plan.errors.length) {
    return (
      <div className="space-y-3">
        {plan.errors.map((e) => (
          <p key={e} className="text-sm leading-relaxed text-danger">
            {e}
          </p>
        ))}
        {onCancel && (
          <button type="button" onClick={onCancel} className="mise-press mise-card-inset rounded-xl px-3 py-1.5 text-xs">
            Close
          </button>
        )}
      </div>
    );
  }

  const updating = groups.changed.filter((r) => take[r.n]).length;
  const leaving = groups.changed.length - updating + groups.same.length;
  const nothingToDo = groups.fresh.length === 0 && groups.changed.length === 0;

  const shown =
    filter === "todo"
      ? groups.changed
      : filter === "new"
        ? groups.fresh
        : filter === "same"
          ? groups.same
          : groups.bad;

  return (
    <div className="space-y-3">
      {/* ── the chips ARE the filter ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {groups.changed.length > 0 && (
          <Chip n={groups.changed.length} tone="warn" on={filter === "todo"} onClick={() => setFilter("todo")}>
            need you
          </Chip>
        )}
        {groups.fresh.length > 0 && (
          <Chip n={groups.fresh.length} tone="good" on={filter === "new"} onClick={() => setFilter("new")}>
            new
          </Chip>
        )}
        {groups.same.length > 0 && (
          <Chip n={groups.same.length} tone="none" on={filter === "same"} onClick={() => setFilter("same")}>
            already here
          </Chip>
        )}
        {groups.bad.length > 0 && (
          <Chip n={groups.bad.length} tone="bad" on={filter === "bad"} onClick={() => setFilter("bad")}>
            couldn&apos;t read
          </Chip>
        )}
        {source && (
          <span className="ml-auto truncate text-[0.75rem] text-fg-faint">
            from {source} · {plan.rows.length} rows
          </span>
        )}
      </div>

      {/* ── the tray ────────────────────────────────────────────────── */}
      <div role="table" aria-label="What will be imported" className="overflow-hidden rounded-2xl border border-line">
        <div
          role="row"
          className={`sticky top-0 z-10 hidden gap-3 border-b border-line bg-shell/95 px-4 py-2 backdrop-blur-sm lg:grid ${cols}`}
        >
          {fields.map((f) => (
            <span
              key={f.key}
              role="columnheader"
              className={`text-[0.75rem] font-medium text-fg-faint ${f.right ? "text-right" : ""}`}
            >
              {f.label}
            </span>
          ))}
        </div>

        <div className="mise-rows-in max-h-[52vh] overflow-y-auto">
          {shown.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-fg-soft">Nothing in this group.</p>
          )}

          {shown.map((r) => {
            const decide = filter === "todo";
            return (
              <div
                key={r.n}
                role="row"
                className={
                  decide
                    ? "mise-card-inset m-2 rounded-xl p-3"
                    : `mise-spine ${
                        r.verdict === "invalid" ? "mise-spine-bad" : r.verdict === "new" ? "mise-spine-good" : "mise-spine-none"
                      } border-b border-line/60 px-4 py-2.5 last:border-0`
                }
              >
                {/* A BOX MEANS WORK (Law 3). A row needing nothing is a ruled
                    line with a 3px tone spine — otherwise 200 rows read as
                    200 decisions. */}
                <div className={`grid gap-1 lg:gap-3 ${decide ? "" : cols}`}>
                  {decide ? (
                    <DecisionRow
                      row={r}
                      taken={!!take[r.n]}
                      onKeep={() => setTake((t) => ({ ...t, [r.n]: false }))}
                      onTake={() => setTake((t) => ({ ...t, [r.n]: true }))}
                    />
                  ) : (
                    fields.map((f, i) =>
                      f.key === "supplier" && r.supplier_match ? (
                        <SupplierCell key={f.key} m={r.supplier_match} />
                      ) : (
                      <span
                        key={f.key}
                        role="cell"
                        className={`truncate text-[0.875rem] ${
                          i === 0 ? "font-medium text-fg" : "text-fg-soft"
                        } ${f.right ? "lg:text-right tabular-nums" : ""}`}
                      >
                        {/* At 390 the columns stack, so each value carries its
                            own label — a bare "kg" under a bare "Rice" is a
                            puzzle. At lg the header row does that job. */}
                        <span className="text-[0.6875rem] text-fg-faint lg:hidden">{f.label} </span>
                        {text(r.values[f.key])}
                        {f.unit && r.values[f.key] !== undefined && r.values[f.key] !== "" ? (
                          <span className="ml-1 text-[0.75rem] text-fg-faint">
                            {text(r.values[f.unit === "unit" ? "unit" : f.unit])}
                          </span>
                        ) : null}
                      </span>
                      ),
                    )
                  )}
                </div>
                {r.verdict === "invalid" && r.reason && (
                  <p className="mt-0.5 text-[0.75rem] text-fg-faint">{r.reason}</p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── what the button will do, spelled out ────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => onCommit(decisions)}
          disabled={busy || nothingToDo}
          className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? "Saving…"
            : nothingToDo
              ? "Nothing to add"
              : `Add ${groups.fresh.length}${updating ? ` · update ${updating}` : ""}${
                  leaving ? ` · leave ${leaving}` : ""
                }`}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="mise-press mise-card-inset rounded-xl px-3 py-2.5 text-sm">
            Cancel
          </button>
        )}
        <span className="text-[0.75rem] text-fg-faint">Nothing is saved until you press this.</span>
      </div>
    </div>
  );
}

/** One row that needs a decision: the two versions, side by side, and two
 *  labelled choices. Not a red/green diff — this is a person deciding which
 *  of two phone numbers is right, not a merge conflict. */
function DecisionRow({
  row,
  taken,
  onKeep,
  onTake,
}: {
  row: PlanRow;
  taken: boolean;
  onKeep: () => void;
  onTake: () => void;
}) {
  const name =
    (["name", "full_name", "item", "title"]
      .map((k) => row.values[k])
      .find((v) => typeof v === "string" && v) as string) || "(no name)";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[0.9375rem] font-semibold text-fg">{name}</span>
        <span className="flex gap-1">
          <Choice on={!taken} onClick={onKeep}>
            Keep ours
          </Choice>
          <Choice on={taken} onClick={onTake}>
            Use the file
          </Choice>
        </span>
      </div>
      <dl className="space-y-1">
        <div className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 text-[0.6875rem] text-fg-faint">
          <span />
          <span>what we have</span>
          <span>your file says</span>
        </div>
        {(row.differences ?? []).map((d) => (
          <div key={d.field} className="grid grid-cols-[6.5rem_1fr_1fr] gap-2 text-[0.8125rem]">
            <dt className="truncate text-fg-faint">{d.label}</dt>
            <dd className={`truncate ${taken ? "text-fg-faint line-through" : "text-fg"}`}>{d.ours}</dd>
            <dd className={`truncate ${taken ? "text-fg" : "text-fg-faint line-through"}`}>{d.theirs}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`mise-press min-h-[2rem] rounded-lg px-2.5 text-[0.75rem] font-semibold transition ${
        on ? "bg-brand-600 text-white" : "mise-card-inset text-fg-soft"
      }`}
    >
      {children}
    </button>
  );
}


/** "Rice → Local Supplier", and what to do when it is not that simple.
 *
 *     "show preview like this matched to this ectetc"
 *
 *  This used to be the raw text from his file, and whether it resolved to a
 *  real supplier was decided at COMMIT time and reported afterwards in a
 *  note capped at twenty. So the first he knew that "Local Market" matched
 *  nothing was after the items were in.
 */
function SupplierCell({ m }: { m: SupplierMatch }) {
  if (m.status === "blank") {
    return (
      <span role="cell" className="truncate text-[0.875rem] text-fg-faint">
        <span className="text-[0.6875rem] text-fg-faint lg:hidden">Supplier </span>—
      </span>
    );
  }
  if (m.status === "matched") {
    return (
      <span role="cell" className="flex min-w-0 items-center gap-1.5 text-[0.875rem]">
        <span className="text-[0.6875rem] text-fg-faint lg:hidden">Supplier </span>
        <svg viewBox="0 0 12 12" className="mise-tone-good h-3 w-3 shrink-0" aria-hidden>
          <path d="M2.5 6.2 4.8 8.5 9.5 3.8" fill="none" stroke="currentColor"
                strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="truncate text-fg-soft">{m.matched_name}</span>
      </span>
    );
  }
  if (m.status === "suggested") {
    // SHOWN, NOT APPLIED. "Fresh Food" against "Fresh Foods" is probably a
    // typo and might be two businesses, and a confident wrong guess is worse
    // than none because he will accept it.
    return (
      <span role="cell" className="flex min-w-0 flex-col text-[0.875rem]">
        <span className="truncate text-fg-soft">{m.given}</span>
        <span className="truncate text-[0.6875rem] text-fg-faint">
          did you mean <b className="text-fg-soft">{m.matched_name}</b>?
        </span>
      </span>
    );
  }
  return (
    <span role="cell" className="flex min-w-0 flex-col text-[0.875rem]">
      <span className="truncate text-fg-soft">{m.given}</span>
      <span className="truncate text-[0.6875rem] text-fg-faint">new supplier</span>
    </span>
  );
}
