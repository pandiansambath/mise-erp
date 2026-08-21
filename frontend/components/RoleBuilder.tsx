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
import { AccessModal } from "@/components/AccessModal";
import {
  levelOf,
  overridesFor,
  SECTIONS,
  type Level,
} from "@/lib/access";

export type CustomRole = {
  id: string;
  name: string;
  base_role: string;
  is_active: boolean;
  permissions: string[];
};

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
    <AccessModal
      open={open}
      onClose={onClose}
      icon="✨"
      title={role ? role.name : name.trim() || "A new role"}
      subtitle={role ? "A role you made" : "Name it, then say what they can reach"}
      stats={[
        { label: "Pages they can open", value: `${reach.on} of ${reach.total}` },
        { label: "People in this role", value: String(people) },
      ]}
      lead={
        <>
          {err && (
            <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
              {err}
            </p>
          )}
          <label className="block">
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
        </>
      }
      intro={
        <>
          <b>{reach.total} pages</b> sit behind the <b>17 switches</b> here — one switch can
          open several, and each row lists which. Nothing is off-limits: it is your restaurant.
        </>
      }
      current={(a) => current(a)}
      onSet={(a, l) => setDraft((d) => ({ ...d, [a.key]: l }))}
      onBulk={(l, g) => bulk(l, g)}
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
    />
  );
}
