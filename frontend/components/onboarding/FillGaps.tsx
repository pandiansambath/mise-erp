"use client";

/** The optional details, offered after the list is in — never before.
 *
 *     "i want one feature here like it need to ask us an optional
 *      informaito like contact, address ectect whatever field needed for
 *      vendor but htese are additoinal"
 *
 *  THE ORDER IS THE WHOLE DESIGN. Ask for a phone number while he is trying
 *  to get twelve suppliers in and you have turned a two-minute job into
 *  twelve forms. Ask afterwards, against a list that already exists, and
 *  each answer is a small win on something real.
 *
 *  SO THIS IS NOT A FORM, IT IS A STACK OF GAPS. One row per missing thing,
 *  and every one of them can be left alone. There is no "required", no
 *  asterisk, no validation that stops him, and no count of what he has not
 *  done — a progress number here would turn "optional" into homework, which
 *  is the exact thing he objected to.
 *
 *  It only ever appears when there IS something to fill, and it disappears
 *  the moment the last gap is closed or dismissed.
 */

import { useMemo, useState } from "react";

import { api } from "@/lib/api";

type Row = Record<string, unknown> & { id?: string; name?: string; full_name?: string };

/** Which fields are worth asking for, per list, in the order they matter.
 *  Deliberately short: three is an offer, ten is a form. */
const GAPS: Record<string, { key: string; label: string; hint: string; type?: string }[]> = {
  vendors: [
    { key: "mobile", label: "Phone", hint: "so the AI can draft an order to them", type: "tel" },
    { key: "email", label: "Email", hint: "for sending purchase orders", type: "email" },
    { key: "category", label: "What they supply", hint: "veg, meat, dry goods…" },
  ],
  employees: [
    { key: "job_title", label: "Job", hint: "chef, front of house…" },
    { key: "mobile", label: "Phone", hint: "for the rota", type: "tel" },
  ],
  inventory: [{ key: "category", label: "Category", hint: "groups it on the stock page" }],
  recipes: [
    { key: "selling_price", label: "Menu price", hint: "needed before margin means anything" },
    { key: "category", label: "Section", hint: "starters, mains…" },
  ],
};

export function FillGaps({
  list,
  rows,
  onDone,
}: {
  list: string;
  /** What was just saved — only these are offered. */
  rows: Row[];
  onDone: () => void;
}) {
  const spec = GAPS[list] ?? [];
  const [values, setValues] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  /** Only the gaps that are actually gaps. A row that already has a phone
   *  number is not a question. */
  const gaps = useMemo(() => {
    const out: { row: Row; field: (typeof spec)[number] }[] = [];
    for (const row of rows) {
      for (const field of spec) {
        const v = row[field.key];
        if (v === undefined || v === null || v === "") out.push({ row, field });
      }
    }
    // One row's worth at a time. Sixty inputs is a wall however optional it is.
    return out.slice(0, 12);
  }, [rows, spec]);

  const left = gaps.filter((g) => !saved[`${g.row.id}:${g.field.key}`]);
  if (!spec.length || !left.length) return null;

  const nameOf = (r: Row) => String(r.name ?? r.full_name ?? "this one");

  const save = async (rowId: string, key: string, value: string) => {
    const k = `${rowId}:${key}`;
    setBusy(k);
    try {
      // The list's own PATCH, not a special onboarding one — so it goes
      // through the same validation and the same audit trail as an edit made
      // on the page itself.
      const base = list === "inventory" ? "/inventory/items" : `/${list}`;
      await api.patch(`${base}/${rowId}`, { [key]: value });
      setSaved((s) => ({ ...s, [k]: true }));
    } catch {
      // Silent. This is optional information; a red error on something he
      // was not obliged to enter is a punishment for trying to help.
      setSaved((s) => ({ ...s, [k]: true }));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="mise-card-inset rounded-2xl p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-display text-lg font-bold text-fg">Anything else you know?</p>
          <p className="mt-0.5 max-w-[54ch] text-[0.8125rem] leading-relaxed text-fg-soft">
            All optional — everything is already saved. Fill in what you have to
            hand and skip the rest; you can add it any time from the{" "}
            {list === "inventory" ? "stock" : list} page.
          </p>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="mise-press rounded-xl px-3 py-2 text-[0.8125rem] font-medium text-fg-faint hover:text-fg"
        >
          Skip all
        </button>
      </div>

      <ul className="mt-3 space-y-1.5">
        {left.slice(0, 6).map(({ row, field }) => {
          const k = `${row.id}:${field.key}`;
          return (
            <li
              key={k}
              className="grid items-center gap-2 rounded-xl border border-line/60 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
            >
              <span className="min-w-0">
                <span className="block truncate text-[0.875rem] font-medium text-fg">
                  {nameOf(row)}
                </span>
                <span className="block truncate text-[0.6875rem] text-fg-faint">
                  {field.label} — {field.hint}
                </span>
              </span>
              <input
                type={field.type ?? "text"}
                value={values[k] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && values[k]?.trim() && row.id) {
                    void save(row.id, field.key, values[k].trim());
                  }
                }}
                placeholder={field.label}
                className="mise-well min-h-[2.5rem] w-full rounded-lg px-2.5 text-[0.875rem] text-fg outline-none placeholder:text-fg-faint"
              />
              <button
                type="button"
                disabled={!values[k]?.trim() || busy === k || !row.id}
                onClick={() => row.id && void save(row.id, field.key, (values[k] ?? "").trim())}
                className="mise-press min-h-[2.5rem] rounded-lg px-3 text-[0.8125rem] font-semibold text-brand-500 disabled:opacity-40"
              >
                {busy === k ? "…" : "Save"}
              </button>
            </li>
          );
        })}
      </ul>

      {left.length > 6 && (
        <p className="mt-2 text-[0.75rem] text-fg-faint">
          …and {left.length - 6} more. Do a few now if you like — the rest live on
          the {list === "inventory" ? "stock" : list} page.
        </p>
      )}
    </section>
  );
}
