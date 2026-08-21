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

/**
 * SET A WHOLE SECTION AT ONCE.
 *
 *   "I need one extra feature like give ALL in this section, give in this
 *    page — so that I don't need to click each and everything when I need to
 *    give each and everything."
 *
 * Fair: handing somebody the run of the kitchen is one decision, and making it
 * cost four taps invites people to stop halfway. `all` does the same for the
 * whole app, which is the "make him a second me" case.
 *
 * It sets the HIGHEST position each area can offer, so an area with no middle
 * lands on its only "on" rather than being skipped.
 */
function BulkSet({ onSet }: { onSet: (level: Level) => void }) {
  // ONE ROW, NOT TWO. There used to be a "this group" row and an "every page"
  // row stacked on top of each other with identical buttons - "why can I see
  // 2 same thing duplicates". Fair: they looked the same because they were.
  // Whole-app lives here; each group has its own small "give all / none" on
  // its heading, where the group is.
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-paper-2/40 px-3 py-2.5">
      <span className="text-[11px] text-fg-faint">Every page in DineAI:</span>
      <span className="flex flex-wrap gap-1.5">
        {(["edit", "view", "none"] as const).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => onSet(l)}
            className="mise-press mise-well rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-fg-soft hover:text-fg"
          >
            {l === "edit" ? "Give everything" : l === "view" ? "See everything" : "Take it all away"}
          </button>
        ))}
      </span>
    </div>
  );
}

/** Every page this level of access opens, so the headline can be counted in
 *  PAGES rather than in our word "areas" — "why 17? I thought we have more".
 *  There are 34 screens behind 17 switches, and 17 was never a number he had
 *  any way to check. */
const ALL_PAGES = new Set(SECTIONS.flatMap((s) => s.areas.flatMap((a) => a.pages)));

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
    setErr(null);
  }, [open, role]);

  const held = useMemo(
    () => new Set(role ? role.permissions : [...startDefaults]),
    [role, startDefaults],
  );

  const current = (a: Parameters<typeof levelOf>[0]) => draft[a.key] ?? levelOf(a, held);

  const reach = useMemo(() => {
    const pages = new Set<string>();
    for (const s of SECTIONS)
      for (const a of s.areas) if (current(a) !== "none") for (const pg of a.pages) pages.add(pg);
    return { on: pages.size, total: ALL_PAGES.size };
  }, [draft, held]);

  /** The highest position this area can offer — so an area with no middle
   *  lands on its only "on" instead of being quietly skipped. */
  function bulk(level: Level, only?: string) {
    setDraft((d) => {
      const next = { ...d };
      for (const s of SECTIONS) {
        if (only && s.key !== only) continue;
        for (const a of s.areas) {
          if (level === "none") next[a.key] = "none";
          else if (level === "edit") next[a.key] = a.write.length ? "edit" : "view";
          else next[a.key] = a.read.length ? "view" : "none";
        }
      }
      return next;
    });
  }

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
      stats={[
        { label: "Reaches", value: `${reach.on} of ${reach.total}`, hint: "pages in DineAI" },
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

      <BulkSet onSet={(l) => bulk(l)} />

      {/* EVERY GROUP ON ONE SCREEN.
          "this UI is a bit hard for me to scroll and pick... I want all in one
           area so that I don't need to scroll or move from here, which will be
           useful for all the laymen."
          Tabs made you visit five places to answer one question, and you could
          not see what you had already given without going back. Two columns of
          compact rows fit the lot. */}
      {SECTIONS.map((sec) => (
        <div key={sec.key} className="mb-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
            <span aria-hidden>{sec.icon}</span>
            {sec.label}
            <button
              type="button"
              onClick={() => bulk("edit", sec.key)}
              className="mise-press ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-medium text-brand-300 hover:underline"
            >
              give all
            </button>
            <button
              type="button"
              onClick={() => bulk("none", sec.key)}
              className="mise-press rounded-md px-1.5 py-0.5 text-[10px] font-medium text-fg-faint hover:underline"
            >
              none
            </button>
          </p>
          <ul className="grid gap-1.5 lg:grid-cols-2">
            {sec.areas.map((a) => {
              const lvl = current(a);
              const opts: Level[] =
                a.read.length && a.write.length
                  ? ["none", "view", "edit"]
                  : ["none", a.write.length ? "edit" : "view"];
              return (
                <li key={a.key} className="mise-well rounded-xl px-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span aria-hidden className="shrink-0 text-base">
                      {a.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium leading-tight text-fg">
                        {a.label}
                      </span>
                      <span className="block truncate text-[10px] leading-tight text-fg-faint">
                        {a.pages.join(" · ")}
                      </span>
                    </span>
                  </span>
                  <span className="mt-2 flex justify-end">
                    <ThreeWay
                      label={a.label}
                      area={a}
                      value={lvl}
                      options={opts}
                      onChange={(l) => setDraft((d) => ({ ...d, [a.key]: l }))}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </DetailSheet>
  );
}
