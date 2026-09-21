"use client";

/** What is about to happen to your data, before it happens.
 *
 *     "if duplcaite ask user to chekc and remove duplcaite by showing the
 *      previw of duplcaute before ading wihtut confirmaiton"
 *
 *  ONE SCREEN, THREE DOORS. A list can arrive as a spreadsheet, as a photograph
 *  the AI read, or as a paste into the chat — and all three land here. That is
 *  deliberate: the plan is the same JSON whichever way it arrived, so a second
 *  renderer would be the same screen built twice, at half the quality, and he
 *  would have to learn both.
 *
 *  THE THING THIS REPLACES IS NOT AN ERROR MESSAGE. It is an import that
 *  "succeeds". Silently skipping duplicates loses what the file was carrying;
 *  silently overwriting loses what the restaurant already had. Both look
 *  identical to working, and the person finds out weeks later when a phone
 *  number is wrong.
 *
 *  SO: NOTHING IS PRESELECTED TOWARDS CHANGE. Every duplicate defaults to
 *  "keep what we have". The safe choice is the one that happens if he taps the
 *  button without reading, because that is what people do.
 */

import { useMemo, useState } from "react";

export type PlanRow = {
  n: number;
  values: Record<string, unknown>;
  verdict: "new" | "duplicate" | "invalid";
  existing: Record<string, unknown> | null;
  /** Each difference CARRIES ITS TWO VALUES. It used to be a list of column
   *  headers that this file had to resolve back to keys itself, by swapping
   *  underscores for spaces — so "Serves" hunted for a key called "serves"
   *  while the row held "servings_default", and the only flagged field on the
   *  screen rendered as "— vs —". Nothing to look up, nothing to mismatch. */
  differences: { field: string; label: string; ours: string; theirs: string }[] | null;
  reason: string | null;
};

export type Plan = {
  errors: string[];
  counts: {
    new: number;
    duplicates: number;
    unchanged: number;
    invalid?: number;
    total: number;
  };
  rows: PlanRow[];
};

export type Decision = { n: number; action: "create" | "update" | "skip"; values: Record<string, unknown> };

/** The first required field, which is what the server keys duplicates on and
 *  therefore what a person recognises the row by. */
function nameOf(r: PlanRow): string {
  const v = r.values;
  for (const k of ["name", "full_name", "item", "title"]) {
    if (typeof v[k] === "string" && v[k]) return v[k] as string;
  }
  const first = Object.values(v).find((x) => typeof x === "string" && x);
  return (first as string) || "(no name)";
}

export function ImportPlan({
  plan,
  busy,
  onCancel,
  onCommit,
}: {
  plan: Plan;
  busy?: boolean;
  onCancel: () => void;
  onCommit: (decisions: Decision[]) => void;
}) {
  /** Per-row choice for the duplicates only. `false` = keep ours (the
   *  default), `true` = take what the file says. New rows are always added and
   *  invalid rows can never be, so neither needs a control — a checkbox that
   *  cannot change anything is noise. */
  const [take, setTake] = useState<Record<number, boolean>>({});

  const groups = useMemo(() => {
    const fresh = plan.rows.filter((r) => r.verdict === "new");
    const dupes = plan.rows.filter((r) => r.verdict === "duplicate");
    return {
      fresh,
      // Rows that differ come FIRST — those are the only ones needing a
      // decision. Identical ones are reassurance, not work.
      changed: dupes.filter((r) => (r.differences?.length ?? 0) > 0),
      same: dupes.filter((r) => (r.differences?.length ?? 0) === 0),
      bad: plan.rows.filter((r) => r.verdict === "invalid"),
    };
  }, [plan.rows]);

  const updating = groups.changed.filter((r) => take[r.n]).length;

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
        <button type="button" onClick={onCancel} className="mise-press mise-well rounded-xl px-3 py-1.5 text-xs">
          Close
        </button>
      </div>
    );
  }

  const nothingToDo = groups.fresh.length === 0 && groups.changed.length === 0;

  return (
    <div className="space-y-4">
      {/* THE COUNT FIRST, AND IN WORDS. He needs to be able to compare it
          against what he sent — if he pasted forty suppliers and this says
          sixty, something invented twenty and he can see that before anything
          is written. */}
      <p className="text-sm leading-relaxed text-fg-soft">
        {summarise(groups)}
      </p>

      {groups.changed.length > 0 && (
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            Already here, and different — {groups.changed.length} to decide
          </p>
          <ul className="space-y-2">
            {groups.changed.map((r) => (
              <li key={r.n} className="mise-well rounded-xl p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-fg">{nameOf(r)}</span>
                  {/* TWO LABELLED CHOICES, not a red/green diff. This is not a
                      merge conflict; it is a person deciding which of two
                      phone numbers is right. */}
                  <span className="flex gap-1">
                    <Choice on={!take[r.n]} onClick={() => setTake((t) => ({ ...t, [r.n]: false }))}>
                      Keep ours
                    </Choice>
                    <Choice on={!!take[r.n]} onClick={() => setTake((t) => ({ ...t, [r.n]: true }))}>
                      Use the file
                    </Choice>
                  </span>
                </div>
                {/* ONLY THE FIELDS THAT DIFFER. Showing all ten columns of a
                    row where one phone number changed is how a person stops
                    reading these. */}
                <dl className="mt-2 space-y-1">
                  {(r.differences ?? []).map((d) => (
                    <div key={d.field} className="grid grid-cols-[7rem_1fr_1fr] gap-2 text-[11px]">
                      <dt className="truncate text-fg-faint">{d.label}</dt>
                      <dd className={`truncate ${take[r.n] ? "text-fg-faint line-through" : "text-fg"}`}>
                        {d.ours}
                      </dd>
                      <dd className={`truncate ${take[r.n] ? "text-fg" : "text-fg-faint line-through"}`}>
                        {d.theirs}
                      </dd>
                    </div>
                  ))}
                  <div className="grid grid-cols-[7rem_1fr_1fr] gap-2 text-[10px] text-fg-faint">
                    <span />
                    <span>what we have</span>
                    <span>your file says</span>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.bad.length > 0 && (
        <section>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            {groups.bad.length} we could not read
          </p>
          {/* NAMED, NOT COUNTED. "12 rows were ignored" is the sentence that
              makes somebody re-upload the whole file blind. */}
          <ul className="space-y-1">
            {groups.bad.map((r) => (
              <li key={r.n} className="mise-well rounded-lg px-2.5 py-1.5 text-[11px] text-fg-faint">
                <b className="text-fg-soft">Row {r.n}</b> — {r.reason}
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.fresh.length > 0 && (
        <details className="mise-well rounded-xl px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            {groups.fresh.length} new — nothing to decide
          </summary>
          <ul className="mt-2 space-y-0.5">
            {groups.fresh.slice(0, 60).map((r) => (
              <li key={r.n} className="truncate text-xs text-fg-soft">
                {nameOf(r)}
              </li>
            ))}
            {groups.fresh.length > 60 && (
              <li className="text-[11px] text-fg-faint">…and {groups.fresh.length - 60} more</li>
            )}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => onCommit(decisions)}
          disabled={busy || nothingToDo}
          className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy
            ? "Adding…"
            : nothingToDo
              ? "Nothing to add"
              : `Add ${groups.fresh.length}${updating ? ` · update ${updating}` : ""}${
                  groups.changed.length - updating + groups.same.length
                    ? ` · leave ${groups.changed.length - updating + groups.same.length}`
                    : ""
                }`}
        </button>
        <button type="button" onClick={onCancel} className="mise-press mise-well rounded-lg px-3 py-2 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The summary sentence. Deliberately not a percentage or a bar — the useful
 *  facts are the counts, and one of them ("you have none yet") is the
 *  difference between a working screen and one that looks broken. */
function summarise(g: {
  fresh: PlanRow[];
  changed: PlanRow[];
  same: PlanRow[];
  bad: PlanRow[];
}): string {
  const bits: string[] = [];
  if (g.fresh.length) bits.push(`${g.fresh.length} new`);
  if (g.changed.length) bits.push(`${g.changed.length} already here but different`);
  if (g.same.length) bits.push(`${g.same.length} already here and unchanged`);
  if (g.bad.length) bits.push(`${g.bad.length} we could not read`);
  if (!bits.length) return "There was nothing in that file.";
  if (!g.changed.length && !g.same.length && g.fresh.length) {
    // Landing on an empty "already here" section after a good read is the most
    // reliable way this screen looks broken, so say why it is empty.
    return `${g.fresh.length} new — you have none yet, so all of them are new.`;
  }
  return bits.join(" · ");
}

function Choice({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`mise-press rounded-lg px-2.5 py-1 text-[11px] font-semibold transition ${
        on ? "bg-brand-600 text-white" : "mise-card-inset text-fg-soft"
      }`}
    >
      {children}
    </button>
  );
}
