"use client";

/** Everything you just added, with room to top it up — in a popup, not
 *  below the fold.
 *
 *     "its still tight...like for additional fiedls i need to scroll donw to
 *      fill... also for receipe when i uplaod text file ai is anlaysed and
 *      crorecty showed all dishes..but in optional fiedl prwview it only
 *      showed only 1 dish dont know why"
 *
 *  BOTH OF THOSE WERE MY FAULT, AND THE SECOND IS THE INTERESTING ONE.
 *
 *  The first version emitted a row PER MISSING FIELD rather than per record.
 *  His file said `Butter Chicken, Mains, 12.50` — name, category AND price —
 *  so almost every dish had nothing missing and produced no row at all. One
 *  dish was short of something, so he saw exactly one dish and no
 *  explanation. It was working as written and it was nonsense to look at:
 *  he had just watched twenty dishes go in, and the screen showed him one.
 *
 *  So this now shows WHAT HE ADDED, all of it, with the optional fields
 *  beside each one — already filled where we know them, empty where we do
 *  not. The list is the receipt AND the form. Nothing is missing from it,
 *  so there is nothing to explain.
 *
 *  AND IT IS A POPUP. "i need to scroll donw to fill" — it used to render
 *  under the preview, under the saved banner, below the fold on a laptop.
 *  His standing rule on this product is click, don't scroll. It opens over
 *  the page the moment the import lands.
 */

import { useMemo, useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { api } from "@/lib/api";

type Row = Record<string, unknown> & { id?: string };

/** What is worth offering, per list, in the order it matters. Deliberately
 *  short — three columns is an offer, ten is a form. */
const EXTRA: Record<string, { key: string; label: string; type?: string; placeholder?: string }[]> = {
  vendors: [
    { key: "mobile", label: "Phone", type: "tel", placeholder: "07700 900111" },
    { key: "email", label: "Email", type: "email", placeholder: "orders@…" },
    { key: "category", label: "Supplies", placeholder: "veg, meat…" },
  ],
  employees: [
    { key: "job_title", label: "Job", placeholder: "chef" },
    { key: "mobile", label: "Phone", type: "tel", placeholder: "07700 900111" },
  ],
  inventory: [
    { key: "category", label: "Category", placeholder: "Dry goods" },
    { key: "supplier", label: "Supplier", placeholder: "who you buy it from" },
  ],
  recipes: [
    { key: "selling_price", label: "Menu price", placeholder: "12.50" },
    { key: "category", label: "Section", placeholder: "Mains" },
  ],
};

/** Literal, because Tailwind only emits classes it can see in the source and
 *  a template assembled at runtime produces no CSS. Keyed by how many extras
 *  the list offers — two or three, and nothing else. */
const GRID: Record<number, string> = {
  2: "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]",
  3: "lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]",
};

const PATH: Record<string, string> = {
  inventory: "/inventory/items",
  vendors: "/vendors",
  employees: "/employees",
  recipes: "/recipes",
};

export function FillGaps({
  list,
  rows,
  onDone,
}: {
  list: string;
  rows: Row[];
  onDone: () => void;
}) {
  const spec = EXTRA[list] ?? [];
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(0);

  const shown = useMemo(() => rows.filter((r) => r.id).slice(0, 60), [rows]);

  const nameOf = (r: Row) => String(r.name ?? r.full_name ?? "—");
  const valueOf = (r: Row, key: string) => {
    const k = `${r.id}:${key}`;
    if (k in edits) return edits[k];
    const v = r[key];
    return v === null || v === undefined ? "" : String(v);
  };

  /** How many rows are still short of something — said as a fact, not as a
   *  score. There is no progress bar here: this is optional, and a bar makes
   *  optional look like homework. */
  const short = shown.filter((r) =>
    spec.some((f) => !String(valueOf(r, f.key)).trim()),
  ).length;

  if (!spec.length || !shown.length) return null;

  const grid = GRID[spec.length] ?? GRID[2];

  const saveAll = async () => {
    setSaving(true);
    let n = 0;
    for (const r of shown) {
      const patch: Record<string, string> = {};
      for (const f of spec) {
        const k = `${r.id}:${f.key}`;
        const v = (edits[k] ?? "").trim();
        // Only what he actually typed. Re-sending values we already had
        // would rewrite rows he never touched, and an audit trail full of
        // no-op edits is worse than useless.
        if (k in edits && v) patch[f.key] = v;
      }
      if (!Object.keys(patch).length) continue;
      try {
        await api.patch(`${PATH[list] ?? `/${list}`}/${r.id}`, patch);
        n += 1;
      } catch {
        // Optional information. A red error on something he was not obliged
        // to enter is a punishment for trying to help.
      }
    }
    setDone(n);
    setSaving(false);
    onDone();
  };

  return (
    <SheetPopup onClose={onDone} title={`${shown.length} added — anything else?`} columns={4}>
      <div className="space-y-3">
        <p className="max-w-[60ch] text-[0.8125rem] leading-relaxed text-fg-soft">
          All of this is <b className="text-fg">already saved</b>. These extras are
          optional — fill in what you have to hand, leave the rest. You can add
          them any time from the {list === "inventory" ? "stock" : list} page.
          {short > 0 && (
            <>
              {" "}
              <span className="text-fg-faint">
                {short} of {shown.length} {short === 1 ? "is" : "are"} missing something.
              </span>
            </>
          )}
        </p>

        {/* ONE ROW PER THING HE ADDED — not one per missing field, which is
            what made twenty dishes render as a single line. */}
        <div className="overflow-hidden rounded-2xl border border-line">
          <div
            className={`hidden gap-3 border-b border-line bg-shell/95 px-4 py-2 lg:grid ${grid}`}
          >
            <span className="text-[0.75rem] font-medium text-fg-faint">Name</span>
            {spec.map((f) => (
              <span key={f.key} className="text-[0.75rem] font-medium text-fg-faint">
                {f.label} <span className="text-fg-faint/70">· optional</span>
              </span>
            ))}
          </div>

          <div className="max-h-[56vh] overflow-y-auto">
            {shown.map((r) => (
              <div
                key={String(r.id)}
                // Same template as the header. Below lg it is one column, so
                // the inputs stack under the name, each carrying its own
                // placeholder as its label.
                className={`grid gap-2 border-b border-line/60 px-4 py-2 last:border-0 lg:gap-3 ${grid}`}
              >
                <span className="min-w-0 self-center truncate text-[0.875rem] font-medium text-fg">
                  {nameOf(r)}
                </span>
                {spec.map((f) => (
                  <input
                    key={f.key}
                    type={f.type ?? "text"}
                    value={valueOf(r, f.key)}
                    onChange={(e) =>
                      setEdits((v) => ({ ...v, [`${r.id}:${f.key}`]: e.target.value }))
                    }
                    placeholder={f.placeholder ?? f.label}
                    aria-label={`${f.label} for ${nameOf(r)}`}
                    className="mise-well min-h-[2.25rem] w-full rounded-lg px-2.5 text-[0.875rem] text-fg outline-none placeholder:text-fg-faint/70"
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {rows.length > shown.length && (
          <p className="text-[0.75rem] text-fg-faint">
            Showing the first {shown.length} of {rows.length}. The rest are on the{" "}
            {list === "inventory" ? "stock" : list} page.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => void saveAll()}
            disabled={saving || !Object.keys(edits).length}
            className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : done ? "Saved" : "Save these details"}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="mise-press mise-card-inset rounded-xl px-3.5 py-2.5 text-sm font-medium text-fg-soft"
          >
            {Object.keys(edits).length ? "Not now" : "Done"}
          </button>
          <span className="text-[0.75rem] text-fg-faint">
            Nothing here is required — the list is already in.
          </span>
        </div>
      </div>
    </SheetPopup>
  );
}
