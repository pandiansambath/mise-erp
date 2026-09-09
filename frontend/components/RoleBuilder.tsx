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
import { AiGrantPanel } from "@/components/AiGrantPanel";
import { useConfirm } from "@/components/confirm";
import { PagePermissions } from "@/components/PagePermissions";
import { AccessModal } from "@/components/AccessModal";
import { type PageRef, readOnlyKey,
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

/** Every page this level of access opens, so the headline can be counted in
 *  PAGES rather than in our word "areas" — "why 17? I thought we have more".
 *  There are 34 screens behind 17 switches, and 17 was never a number he had
 *  any way to check. */
const ALL_PAGES = new Set(SECTIONS.flatMap((s) => s.areas.flatMap((a) => a.pages.map((p) => p.slug))));

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
  /** Who is in this role today — names, so the count can be opened. */
  people: { id: string; name: string; email?: string | null }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  // A role the hotel invented is still a job, and a job is where AI belongs.
  // This sheet had no AI panel at all — I added it to JobSheet and stopped,
  // which is the same miss AccessModal's own comment warns about.
  const [ai, setAi] = useState<Record<string, unknown>>({});
  const [aiTouched, setAiTouched] = useState(false);
  // Never chosen on screen. STAFF is the narrowest thing we have, so a new
  // role begins shut and is opened one switch at a time.
  const base = role?.base_role ?? "STAFF";
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const [err, setErr] = useState<string | null>(null);

  // A NEW ROLE STARTS WITH NOTHING ON. Every switch the owner sees at "No
  // access" is one he turned on deliberately, which is the only version of
  // this that is honest — a role pre-filled from an archetype quietly grants
  // things nobody read.
  const startDefaults = useMemo(() => new Set<string>(), []);

  useEffect(() => {
    if (!open) return;
    setAi({ ...((role as unknown as { ai_settings?: Record<string, unknown> })?.ai_settings ?? {}) });
    setAiTouched(false);
    setName(role?.name ?? "");
    setDraft({});
    setErr(null);
    // AND THE PAGE DRAFTS. They were missed when they were added, and this
    // component is mounted permanently on the Staff page — so an unsaved
    // per-page change made on one role was still sitting here when the NEXT
    // role opened. Reproduced on production: hide a page on `sub-admin`, close
    // WITHOUT saving, open `super master`, and it opens with that page already
    // struck through and its Save button live on a role nobody had touched.
    // One stray click would write a narrowed page list into a real role.
    //
    // A draft is per-role by definition; leaving it behind is not a stale value
    // but somebody else's decision applied to the wrong person.
    setPageDraft({});
    setRoDraft({});
    setPagesFor(null);
  }, [open, role]);

  const held = useMemo(
    () => new Set(role ? role.permissions : [...startDefaults]),
    [role, startDefaults],
  );

  const current = (a: Parameters<typeof levelOf>[0]) => draft[a.key] ?? levelOf(a, held);


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

  /**
   * 5a — which SCREENS each area hands over. `undefined` for an area means
   * "all of them", which is what every existing role means today, so nothing
   * changes for anybody who never opens this.
   */
  const [pageDraft, setPageDraft] = useState<Record<string, Set<string>>>({});

  function shownPages(a: Area): Set<string> | undefined {
    if (pageDraft[a.key]) return pageDraft[a.key];
    const narrowed = a.pages.some((pg) => held.has(`page:${pg.slug}`));
    if (!narrowed) return undefined;
    return new Set(a.pages.filter((pg) => held.has(`page:${pg.slug}`)).map((pg) => pg.slug));
  }

  /** 5b — which of those screens are READ-ONLY, even though the area itself
   *  can be changed. Same shape as `pageDraft`: untouched areas fall back to
   *  what the role already holds, so opening this sheet changes nothing. */
  const [roDraft, setRoDraft] = useState<Record<string, Set<string>>>({});

  function readOnlyPages(a: Area): Set<string> {
    if (roDraft[a.key]) return roDraft[a.key];
    return new Set(a.pages.filter((pg) => held.has(readOnlyKey(pg.slug))).map((pg) => pg.slug));
  }

  function togglePageRo(a: Area, slug: string, ro: boolean) {
    setRoDraft((d) => {
      const now = new Set(d[a.key] ?? readOnlyPages(a));
      if (ro) now.add(slug);
      else now.delete(slug);
      return { ...d, [a.key]: now };
    });
  }

  // Declared AFTER the three drafts it reads: a const cannot see a `useState`
  // below it, and the page/read-only drafts were added later than this line
  // originally sat.
  const dirty =
    Object.keys(draft).length > 0 ||
    Object.keys(pageDraft).length > 0 ||
    Object.keys(roDraft).length > 0 ||
    name.trim() !== (role?.name ?? "");

  /** "PAGES THEY CAN OPEN — 28 of 33".
   *
   *  It used to count every page of every switched-on area, ignoring the
   *  shortlist entirely, so hiding a page left the number unmoved and the
   *  headline contradicted the chips right under it. Counts what they can
   *  actually open now. Read-only pages still count: they can open them, which
   *  is what the label says.
   *
   *  Declared after the page draft it reads — a const cannot see a `useState`
   *  below it. */
  const reach = useMemo(() => {
    const pages = new Set<string>();
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        if (current(a) === "none") continue;
        const only = shownPages(a);
        for (const pg of a.pages) if (!only || only.has(pg.slug)) pages.add(pg.slug);
      }
    }
    return { on: pages.size, total: ALL_PAGES.size };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, pageDraft, held]);

  /** Which area's per-page sheet is open. */
  const [pagesFor, setPagesFor] = useState<Area | null>(null);

  /** What ONE page is set to, right now. */
  function pageLevelOf(a: Area, pg: PageRef): Level {
    const only = shownPages(a);
    if (current(a) === "none" || (only && !only.has(pg.slug))) return "none";
    if (current(a) === "view") return "view";
    return readOnlyPages(a).has(pg.slug) ? "view" : "edit";
  }

  /** Set one page, and pull the AREA up to the maximum of its pages.
   *
   *  One rule, so the area switch and the page switches cannot contradict each
   *  other: THE AREA IS THE MAXIMUM OF ITS PAGES. Giving one page "can change"
   *  turns the area on to "can change" and leaves its neighbours exactly where
   *  they were — which is what makes "Online Orders read-only, the other two
   *  writable" expressible at all.
   */
  function setPageLevel(a: Area, pg: PageRef, level: Level) {
    const pages = new Set(shownPages(a) ?? a.pages.map((x) => x.slug));
    const ro = new Set(readOnlyPages(a));
    const wasArea = current(a);

    if (level === "none") {
      pages.delete(pg.slug);
      ro.delete(pg.slug);
    } else {
      pages.add(pg.slug);
      if (level === "view") ro.add(pg.slug);
      else ro.delete(pg.slug);
    }

    // The area rises to the highest level any surviving page now has. It is
    // never lowered here: dropping one page to "can look" must not quietly
    // demote the others.
    const levels = a.pages
      .filter((x) => pages.has(x.slug))
      .map((x) => (x.slug === pg.slug ? level : ro.has(x.slug) ? "view" : wasArea));
    const top: Level = levels.includes("edit")
      ? "edit"
      : levels.includes("view")
        ? "view"
        : "none";

    // WHEN THE AREA RISES, THE OTHERS MUST NOT RISE WITH IT.
    //
    // Setting one page to "can change" pulls the area from "can see" up to
    // "can change" — and every page not marked read-only would then be
    // editable, silently promoting two pages he never touched. So the pages
    // that were only readable BEFORE the rise are pinned read-only as it
    // happens. Their level did not change; only the area moved underneath them.
    if (top === "edit" && wasArea !== "edit") {
      for (const x of a.pages) {
        if (x.slug === pg.slug || !pages.has(x.slug)) continue;
        ro.add(x.slug);
      }
      ro.delete(pg.slug);
    }

    setDraft((d) => ({ ...d, [a.key]: top }));
    setPageDraft((d) => ({ ...d, [a.key]: pages }));
    // KEPT, NOT WIPED.
    //
    // This used to clear the whole read-only set whenever `top` was not
    // "edit", on the reasoning that markers mean nothing on a read-only area.
    // True, but destructive: with the area on "can see", marking one page
    // "can look" computes top === "view" and threw the marker away — so the
    // very next click that raised the area to "can change" re-read an empty
    // set and PROMOTED the page he had just made read-only.
    //
    // That is the exact arrangement he asked for ("Online Orders read-only, the
    // other two writable") and it was unreachable by the natural path: it only
    // worked if you happened to set "can change" first. The set is preserved
    // now; `overridesFor` already declines to emit these markers unless the
    // area is editable, so nothing meaningless is ever saved.
    setRoDraft((d) => ({ ...d, [a.key]: ro }));
  }

  function togglePage(a: Area, slug: string, on: boolean) {
    setPageDraft((d) => {
      const now = new Set(d[a.key] ?? shownPages(a) ?? a.pages.map((pg) => pg.slug));
      if (on) now.add(slug);
      else now.delete(slug);
      return { ...d, [a.key]: now };
    });
  }

  async function save() {
    const ok = await confirm({
      title: "Save this role?",
      message:
        (role && name.trim() !== role.name
          ? `Renaming "${role.name}" to "${name.trim()}". `
          : "") +
        `"${name.trim()}" will reach ${reach.on} of ${reach.total} pages${people.length ? ` — and ${people.length} ${people.length === 1 ? "person is" : "people are"} in this role` : ""}.`,
      confirmText: "Save it",
    });
    if (!ok) return;
    if (!named) return;
    setBusy(true);
    setErr(null);
    const perms = new Set<string>();
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        const map = overridesFor(a, current(a), shownPages(a), readOnlyPages(a));
        for (const [p, on] of Object.entries(map)) if (on) perms.add(p);
      }
    }
    // The server stores a diff against the starting point's defaults, so send
    // every permission explicitly on or off — a half-applied change is how
    // somebody keeps an ability they were just told they had lost.
    const overrides: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        for (const [p, on] of Object.entries(
          overridesFor(a, current(a), shownPages(a), readOnlyPages(a)),
        ))
          overrides[p] = on;
      }
    }
    try {
      const body = {
        name: name.trim(),
        base_role: base,
        overrides,
        // Only when touched: omitting it leaves the AI alone, whereas {} means
        // "clear it", and saving a permission change must not quietly do that.
        ...(aiTouched ? { ai } : {}),
      };
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
    const ok = await confirm({
      title: `Remove "${role.name}"?`,
      message: people.length
        ? `${people.length} ${people.length === 1 ? "person is" : "people are"} in this role. They fall back to their plain job, which reaches less — nobody gains access by this.`
        : "Nobody is in this role, so nothing changes for anyone today.",
      confirmText: "Remove it",
      tone: "danger",
    });
    if (!ok) return;
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
    <>
    <AccessModal
      open={open}
      onClose={onClose}
      icon="✨"
      title={role ? role.name : name.trim() || "A new role"}
      subtitle={role ? "A role you made" : "Name it, then say what they can reach"}
      stats={[
        { label: "Pages they can open", value: `${reach.on} of ${reach.total}` },
        { label: "People in this role", value: String(people.length), people },
      ]}
      areaPanel={(key) =>
        key === "ai" ? (
          <AiGrantPanel
            value={ai}
            onChange={(patch) => {
              setAiTouched(true);
              setAi((a) => ({ ...a, ...patch }));
            }}
            title="Everyone in this role"
            hint="one person can still differ"
            idPrefix="role-ai"
          />
        ) : null
      }
      intro={
        <>
          <b>{reach.total} pages</b> sit behind the <b>17 switches</b> here — one switch can
          open several, and each row lists which. Nothing is off-limits: it is your restaurant.
        </>
      }
      pagesOn={(a) => shownPages(a)}
      onTogglePage={(a, slug, on) => togglePage(a, slug, on)}
      pagesRo={(a) => readOnlyPages(a)}
      onTogglePageRo={(a, slug, ro) => togglePageRo(a, slug, ro)}
      onOpenPages={(a) => setPagesFor(a)}
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
                  ? people.length
                    ? `Save — applies to ${people.length} ${people.length === 1 ? "person" : "people"}`
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
    {pagesFor && (
      <PagePermissions
        area={pagesFor}
        levelFor={(pg) => pageLevelOf(pagesFor, pg)}
        onSet={(pg, l) => setPageLevel(pagesFor, pg, l)}
        onClose={() => setPagesFor(null)}
      />
    )}
    </>
  );
}
