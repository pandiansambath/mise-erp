"use client";

/** Extra fields a restaurant keeps for itself — and the shop they come from.
 *
 *    "have a customisation button like — what if super admin wants one field
 *     like he wants to get staff's address... also from our side we give one
 *     more option, like ready-made field marketplace."
 *    "not only for employee field, but also for vendor page — here also we're
 *     collecting vendor details, so here also we need that field marketplace
 *     idea."
 *
 *  Two exports, used together:
 *
 *    <FieldMarketplace>  the shop — pick from 56 ready-made fields, or write
 *                        your own. Opened from a "Customise fields" button.
 *    <CustomFieldInputs> renders this hotel's chosen fields into whatever form
 *                        they belong to, so Employees and Vendors get the same
 *                        behaviour from the same code.
 *
 *  WHY A SHOP AND NOT A FORM BUILDER.
 *  A blank "create a field" dialog asks somebody who has never designed a form
 *  to choose a name, a type and a validation rule at the exact moment they were
 *  trying to do something else. Most people close it. The catalogue turns that
 *  into recognition — scan a shelf, tap the two you keep — and the blank field
 *  stays as the escape hatch for the genuinely unusual.
 */

import { useEffect, useMemo, useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { api } from "@/lib/api";

export type FieldType =
  | "text" | "textarea" | "number" | "money" | "date" | "select"
  | "checkbox" | "phone" | "email" | "url" | "file";

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  group: string | null;
  hint: string | null;
  options: string[];
  required: boolean;
  expires: boolean;
  sort_order: number;
  is_active: boolean;
  from_catalogue: string | null;
};

type CatalogueItem = Omit<CustomFieldDef, "id" | "sort_order" | "is_active" | "from_catalogue"> & {
  added: boolean;
};

export type Entity = "employee" | "vendor";

const TYPE_LABEL: Record<FieldType, string> = {
  text: "Short text",
  textarea: "Long text",
  number: "Number",
  money: "Money",
  date: "Date",
  select: "Pick from a list",
  checkbox: "Yes / no",
  phone: "Phone",
  email: "Email",
  url: "Web address",
  file: "File",
};

/** Load this hotel's fields once per form. Exported so a page can show the
 *  values without mounting the editor. */
export function useCustomFields(entity: Entity) {
  const [fields, setFields] = useState<CustomFieldDef[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useMemo(
    () => async () => {
      try {
        const d = await api.get<{ fields: CustomFieldDef[] }>(`/custom-fields/${entity}`);
        setFields(d.fields ?? []);
      } catch {
        /* a form that cannot load its extras is still a usable form */
      } finally {
        setLoaded(true);
      }
    },
    [entity],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { fields: fields.filter((f) => f.is_active), allFields: fields, loaded, reload };
}

// ── the inputs, rendered into somebody else's form ─────────────────────────

export function CustomFieldInputs({
  fields,
  value,
  onChange,
}: {
  fields: CustomFieldDef[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  if (fields.length === 0) return null;

  // Grouped, in the order the hotel arranged them. A flat list of thirty
  // fields is a wall; the groups are what make it scannable.
  const groups: [string, CustomFieldDef[]][] = [];
  for (const f of fields) {
    const g = f.group || "More";
    const row = groups.find(([n]) => n === g);
    if (row) row[1].push(f);
    else groups.push([g, [f]]);
  }

  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });

  return (
    <>
      {groups.map(([group, list]) => (
        <div key={group} className="mt-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {group}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {list.map((f) => (
              <label
                key={f.id}
                className={f.type === "textarea" ? "sm:col-span-2" : undefined}
              >
                <span className="mb-1 block text-xs font-medium text-fg-soft">
                  {f.label}
                  {f.required && <span className="ml-0.5 text-brand-300">*</span>}
                </span>
                <FieldInput
                  field={f}
                  value={value?.[f.key]}
                  onChange={(v) => set(f.key, v)}
                />
                {f.hint && <span className="mt-1 block text-[11px] text-fg-faint">{f.hint}</span>}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: CustomFieldDef;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const cls = "mise-well w-full rounded-xl px-3 py-2 text-sm outline-none";
  const s = value == null ? "" : String(value);

  switch (field.type) {
    case "textarea":
      return (
        <textarea rows={3} value={s} onChange={(e) => onChange(e.target.value)} className={cls} />
      );
    case "checkbox":
      return (
        <button
          type="button"
          onClick={() => onChange(!value)}
          className={`mise-press flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            value ? "bg-brand-600 text-white" : "mise-well text-fg-soft"
          }`}
        >
          <span aria-hidden>{value ? "✓" : "○"}</span>
          {value ? "Yes" : "No"}
        </button>
      );
    case "select":
      return (
        <select value={s} onChange={(e) => onChange(e.target.value)} className={cls}>
          <option value="">—</option>
          {field.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    case "date":
      return (
        <input type="date" value={s} onChange={(e) => onChange(e.target.value)} className={cls} />
      );
    case "number":
    case "money":
      return (
        <input
          type="number"
          inputMode="decimal"
          step={field.type === "money" ? "0.01" : "1"}
          value={s}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={cls}
        />
      );
    case "file":
      // Honest placeholder: uploads belong to the Documents area, which already
      // handles storage, permissions and expiry. Pretending to accept a file
      // here and dropping it would be worse than saying where it goes.
      return (
        <input
          value={s}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Reference or link — attach the file in Documents"
          className={cls}
        />
      );
    default:
      return (
        <input
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : field.type === "phone" ? "tel" : "text"}
          value={s}
          onChange={(e) => onChange(e.target.value)}
          className={cls}
        />
      );
  }
}

// ── the shop ───────────────────────────────────────────────────────────────

export function FieldMarketplace({
  entity,
  onClose,
  onChanged,
}: {
  entity: Entity;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [tab, setTab] = useState<"shop" | "mine" | "new">("shop");
  const [cat, setCat] = useState<{ groups: string[]; fields: CatalogueItem[] } | null>(null);
  const [mine, setMine] = useState<CustomFieldDef[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = useMemo(
    () => async () => {
      const [c, m] = await Promise.all([
        api.get<{ groups: string[]; fields: CatalogueItem[] }>(
          `/custom-fields/${entity}/marketplace`,
        ),
        api.get<{ fields: CustomFieldDef[] }>(`/custom-fields/${entity}`),
      ]);
      setCat(c);
      setMine(m.fields ?? []);
    },
    [entity],
  );
  useEffect(() => {
    void load();
  }, [load]);

  async function add(item: CatalogueItem) {
    setBusy(item.key);
    try {
      await api.post(`/custom-fields/${entity}`, {
        key: item.key,
        label: item.label,
        type: item.type,
        group: item.group,
        hint: item.hint,
        options: item.options?.length ? item.options : undefined,
        expires: item.expires,
      });
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function hide(f: CustomFieldDef) {
    setBusy(f.id);
    try {
      await api.delete(`/custom-fields/${entity}/${f.id}`);
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  const noun = entity === "employee" ? "staff" : "suppliers";
  const shown = (cat?.fields ?? []).filter(
    (f) =>
      !q.trim() ||
      f.label.toLowerCase().includes(q.toLowerCase()) ||
      (f.group ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <SheetPopup
      onClose={onClose}
      title="Customise fields"
      subtitle={`What you keep about your ${noun}`}
      columns={2}
    >
      <div className="mise-well mb-3 flex w-fit rounded-xl p-0.5">
        {(
          [
            ["shop", "Ready-made"],
            ["mine", `Yours${mine.length ? ` (${mine.filter((f) => f.is_active).length})` : ""}`],
            ["new", "Write your own"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`mise-press rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              tab === k ? "bg-brand-600 text-white" : "text-fg-faint"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "shop" && (
        <>
          {/* A shop with 31 things on the shelf needs a way to ask for one. */}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search — passport, hygiene, locker…"
            className="mise-well mb-3 w-full rounded-xl px-3 py-2 text-sm outline-none"
          />
          {(cat?.groups ?? []).map((g) => {
            const list = shown.filter((f) => f.group === g);
            if (list.length === 0) return null;
            return (
              <div key={g} className="mb-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
                  {g}
                </p>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {list.map((f) => (
                    <li
                      key={f.key}
                      className="mise-card-inset flex items-start gap-3 rounded-xl p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-fg">{f.label}</p>
                        <p className="mt-0.5 text-[11px] text-fg-faint">
                          {TYPE_LABEL[f.type]}
                          {f.expires && " · warns before it lapses"}
                        </p>
                        {f.hint && (
                          <p className="mt-1 text-[11px] leading-relaxed text-fg-soft">{f.hint}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        disabled={f.added || busy === f.key}
                        onClick={() => add(f)}
                        className={`mise-press shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          f.added
                            ? "mise-well text-fg-faint"
                            : "bg-brand-600 text-white disabled:opacity-50"
                        }`}
                      >
                        {f.added ? "✓ Added" : busy === f.key ? "…" : "Add"}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {shown.length === 0 && (
            <p className="py-6 text-center text-sm text-fg-faint">
              Nothing matches “{q}”. Try the <b className="text-fg-soft">Write your own</b> tab.
            </p>
          )}
        </>
      )}

      {tab === "mine" && (
        <ul className="space-y-2">
          {mine.filter((f) => f.is_active).length === 0 && (
            <p className="py-6 text-center text-sm text-fg-faint">
              Nothing extra yet. Pick something from <b className="text-fg-soft">Ready-made</b>.
            </p>
          )}
          {mine
            .filter((f) => f.is_active)
            .map((f) => (
              <li key={f.id} className="mise-card-inset flex items-center gap-3 rounded-xl p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-fg">{f.label}</p>
                  <p className="mt-0.5 text-[11px] text-fg-faint">
                    {TYPE_LABEL[f.type]}
                    {f.group && ` · ${f.group}`}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === f.id}
                  onClick={() => hide(f)}
                  className="mise-press shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-fg-faint hover:text-fg"
                >
                  Stop keeping
                </button>
              </li>
            ))}
          {/* Said plainly, because "remove" that does not remove is the kind of
              thing people discover at the worst moment. */}
          <p className="pt-2 text-[11px] leading-relaxed text-fg-faint">
            Stopping a field hides it from the form. What people already typed is
            kept, and comes back if you add the field again.
          </p>
        </ul>
      )}

      {tab === "new" && <NewField entity={entity} onDone={() => { void load(); onChanged?.(); setTab("mine"); }} />}
    </SheetPopup>
  );
}

function NewField({ entity, onDone }: { entity: Entity; onDone: () => void }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [group, setGroup] = useState("");
  const [hint, setHint] = useState("");
  const [options, setOptions] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!label.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/custom-fields/${entity}`, {
        label: label.trim(),
        type,
        group: group.trim() || null,
        hint: hint.trim() || null,
        options: type === "select" ? options.split("\n").filter((s) => s.trim()) : undefined,
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not add that field.");
    } finally {
      setBusy(false);
    }
  }

  const cls = "mise-well w-full rounded-xl px-3 py-2 text-sm outline-none";
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-soft">What is it called?</span>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Locker number"
          className={cls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-soft">What kind of thing?</span>
        <select value={type} onChange={(e) => setType(e.target.value as FieldType)} className={cls}>
          {(Object.keys(TYPE_LABEL) as FieldType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </label>
      {type === "select" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-fg-soft">
            The choices, one per line
          </span>
          <textarea
            rows={4}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
            className={cls}
          />
        </label>
      )}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-soft">
          Group it under (optional)
        </span>
        <input
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          placeholder="Day to day"
          className={cls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-fg-soft">
          A note for whoever fills it in (optional)
        </span>
        <input value={hint} onChange={(e) => setHint(e.target.value)} className={cls} />
      </label>
      {err && <p className="mise-tone-bad text-xs">{err}</p>}
      <button
        type="button"
        disabled={busy || !label.trim()}
        onClick={save}
        className="mise-press w-full rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy ? "Adding…" : "Add this field"}
      </button>
    </div>
  );
}
