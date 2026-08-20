"use client";

// A ROLE THE HOTEL INVENTED, IN THEIR OWN WORDS.
//
//   "what if hotel need to create their own role like kitchen manager, hotel
//    manager... may be paratha manager, poori manager. Anything. We need to
//    make this thing very very loose and flexible — super admin is the owner,
//    he can do anything he wants. In runtime we need to create a new role and
//    give RBAC in runtime, because we don't know what that super admin will
//    create as a new role."
//
// He is right, and the five jobs we shipped were never a description of
// restaurants — they were a description of our database. A kitchen with a
// Tandoor Lead, a Sweets Counter and a Poori Master has three jobs we have no
// word for, and the answer is not a longer list of OUR words.
//
// The thing that makes this explainable to a layman is that it is ONE screen
// answering one question: what is this job called, and what can they reach.
// Everything that used to make it hard is gone —
//
//   * no ceiling: every area, every position, always;
//   * no separate "attach" errand: you put people in it right here;
//   * NO STARTING POINT TO PICK. It begins blank.
//
// The last one I got wrong first time round. I kept a "start from" dropdown,
// labelled it "a head start, not a limit", and thought that was enough:
//
//   "bro again we came to same point that super admin need to choose from
//    these 6 roles. This is what I said — let super admin build his own."
//
// He is right. A dropdown of our six words, as the SECOND thing on the screen,
// is the archetype concept wearing a friendlier caption. It does not matter
// that it no longer constrains anything; it still asks somebody naming a Poori
// Master to first decide which of our jobs he is closest to, and that question
// has no answer. `base_role` is still a column the server needs, and it is now
// exactly what it should be: an implementation detail he never sees.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { DetailSheet } from "@/components/DetailSheet";
import {
  labelFor,
  LEVEL_HINT,
  LEVEL_LABEL,
  levelOf,
  overridesFor,
  SECTIONS,
  type Area,
  type Level,
} from "@/lib/access";

export type CustomRole = {
  id: string;
  name: string;
  base_role: string;
  is_active: boolean;
  permissions: string[];
};

function ThreeWay({
  value,
  options,
  onChange,
  label,
  area,
}: {
  value: Level;
  options: Level[];
  onChange: (l: Level) => void;
  label: string;
  /** So an area can name its own positions - "Can use", not "Can change". */
  area?: Area;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="mise-well inline-flex shrink-0 rounded-xl p-0.5"
    >
      {options.map((o) => {
        const on = value === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={on}
            title={LEVEL_HINT[o]}
            onClick={() => onChange(o)}
            className={`mise-press rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition ${
              on ? "bg-brand-600 text-white" : "text-fg-faint hover:text-fg"
            }`}
          >
            {area ? labelFor(area, o) : LEVEL_LABEL[o]}
          </button>
        );
      })}
    </div>
  );
}

export function RoleBuilder({
  open,
  role,
  people,
  onClose,
  onSaved,
}: {
  open: boolean;
  /** null = designing a new one. */
  role: CustomRole | null;
  /** How many people are in this role today. */
  people: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  // Never chosen on screen. STAFF is the narrowest thing we have, so a new
  // role begins shut and is opened one switch at a time.
  const base = role?.base_role ?? "STAFF";
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [tab, setTab] = useState(SECTIONS[0].key);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // A NEW ROLE STARTS WITH NOTHING ON. Every switch the owner sees at "No
  // access" is one he turned on deliberately, which is the only version of
  // this that is honest — a role pre-filled from an archetype quietly grants
  // things nobody read.
  const startDefaults = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    if (!open) return;
    setName(role?.name ?? "");
    setDraft({});
    setTab(SECTIONS[0].key);
    setErr(null);
  }, [open, role]);

  const held = useMemo(
    () => new Set(role ? role.permissions : [...startDefaults]),
    [role, startDefaults],
  );

  const current = (a: Parameters<typeof levelOf>[0]) => draft[a.key] ?? levelOf(a, held);

  const reach = useMemo(() => {
    let on = 0;
    let total = 0;
    for (const s of SECTIONS)
      for (const a of s.areas) {
        total += 1;
        if (current(a) !== "none") on += 1;
      }
    return { on, total };
  }, [draft, held]);

  const named = name.trim().length >= 2;
  const dirty = Object.keys(draft).length > 0 || name.trim() !== (role?.name ?? "");

  async function save() {
    if (!named) return;
    setBusy(true);
    setErr(null);
    const perms = new Set<string>();
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        const map = overridesFor(a, current(a));
        for (const [p, on] of Object.entries(map)) if (on) perms.add(p);
      }
    }
    // The server stores a diff against the starting point's defaults, so send
    // every permission explicitly on or off — a half-applied change is how
    // somebody keeps an ability they were just told they had lost.
    const overrides: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        for (const [p, on] of Object.entries(overridesFor(a, current(a)))) overrides[p] = on;
      }
    }
    try {
      const body = { name: name.trim(), base_role: base, overrides };
      if (role) await api.patch(`/roles/${role.id}`, body);
      else await api.post("/roles", body);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save this role.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!role) return;
    setBusy(true);
    try {
      await api.delete(`/roles/${role.id}`);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not remove this role.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      icon="✨"
      title={role ? role.name : name.trim() || "A new role"}
      subtitle={role ? "A role you made" : "Name it, then say what they can reach"}
      width="lg"
      sections={SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))}
      active={tab}
      onSection={setTab}
      stats={[
        { label: "Reaches", value: `${reach.on} of ${reach.total}`, hint: "areas of the app" },
        {
          label: "People in this role",
          value: String(people),
          hint: people ? "they all get this" : "nobody yet",
        },
        { label: "Made by", value: "You", hint: "not a DineAI default" },
      ]}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!named || busy || (!!role && !dirty)}
            onClick={save}
            className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy
              ? "Saving…"
              : !named
                ? "Give it a name first"
                : role
                  ? people
                    ? `Save — applies to ${people} ${people === 1 ? "person" : "people"}`
                    : "Save"
                  : "Create this role"}
          </button>
          {role && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-faint"
            >
              Remove this role
            </button>
          )}
        </div>
      }
    >
      {err && (
        <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
          {err}
        </p>
      )}

      {/* THE TWO QUESTIONS, ANSWERED IN ORDER. Name first, because naming the
          job is the thing the owner actually came here to do. */}
      {/* ONE QUESTION, NOT TWO. Naming the job is what he came here to do. */}
      <label className="mb-3 block">
        <span className="mb-1 block text-[11px] font-medium text-fg-faint">
          What is this job called?
        </span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          autoFocus
          placeholder="Poori Master, Tandoor Lead, Floor Manager…"
          className="mise-well w-full rounded-xl px-3 py-2.5 text-base outline-none"
        />
        <span className="mt-1 block text-[10px] leading-relaxed text-fg-faint">
          Your words, not ours. This is what you will see next to their name.
        </span>
      </label>

      <p className="mb-3 rounded-xl border border-line bg-paper-2/50 px-3.5 py-2.5 text-[11px] leading-relaxed text-fg-soft">
        Every page in DineAI is below, in {SECTIONS.length} groups. Choose <b>No access</b>,{" "}
        <b>Can see</b> (look, don&apos;t touch) or <b>Can change</b> for each. The pages each one
        opens are listed underneath it, so you can see exactly what you are giving. Nothing is
        off-limits — it is your restaurant.
      </p>

      {SECTIONS.filter((s) => s.key === tab).map((s) => (
        <ul key={s.key} className="space-y-2">
          {s.areas.map((a) => {
            const lvl = current(a);
            const was = levelOf(a, held);
            const changed = lvl !== was;
            const opts: Level[] =
              a.read.length && a.write.length
                ? ["none", "view", "edit"]
                : ["none", a.write.length ? "edit" : "view"];
            return (
              <li
                key={a.key}
                className={`mise-card3d flex flex-wrap items-center justify-between gap-3 p-3.5 ${
                  changed ? "ring-1 ring-amber-400/50" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden
                    className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base"
                  >
                    {a.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-fg">{a.label}</span>
                    <span className="block text-[11px] leading-snug text-fg-faint">
                      {a.blurb}
                    </span>
                    {/* THE PAGES. 34 screens behind 17 switches means a switch
                        called "Suppliers & buying" has to say that it opens
                        Vendors, Price Comparison and Purchasing, or the owner
                        is agreeing to something he cannot see. */}
                    <span className="mt-1 flex flex-wrap gap-1">
                      {a.pages.map((pg) => (
                        <span
                          key={pg}
                          className="mise-well rounded-md px-1.5 py-0.5 text-[10px] text-fg-faint"
                        >
                          {pg}
                        </span>
                      ))}
                    </span>
                  </span>
                </span>
                <ThreeWay
                  label={a.label}
                  area={a}
                  value={lvl}
                  options={opts}
                  onChange={(l) => setDraft((d) => ({ ...d, [a.key]: l }))}
                />
              </li>
            );
          })}
        </ul>
      ))}
    </DetailSheet>
  );
}
