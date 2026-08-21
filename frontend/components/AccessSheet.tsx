"use client";

// ONE PERSON, ONE SCREEN, ONE SAVE.
//
// The page this replaces asked for four separate acts before anybody's access
// changed: pick an archetype, toggle inside its envelope, name and save a ROLE,
// then find the attach panel and attach it. His verdict, and the evidence
// agreed with him — the only role the hotel ever designed was attached to
// nobody:
//
//   "creating role for role like manager and assigning to role like manager or
//    staff, it's confusing the laymans. We definitely do something simpler for
//    them to easily do whatever they want."
//   "literally redesign UI UX functionality literally from zero to hero."
//
// So: open a person, set what they can reach, save. The custom role still
// exists underneath — it is how permissions are stored — but it is created,
// named and attached by the same button, because that plumbing was never the
// owner's problem to solve.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useConfirm } from "@/components/confirm";
import { AccessModal } from "@/components/AccessModal";
import {
  isUnusual,
  levelOf,
  overridesFor,
  positionsFor,
  SECTIONS,
  whyUnusual,
  type Area,
  type Level,
} from "@/lib/access";

export type Person = {
  id: string;
  email: string;
  role: string;
  preferred_name?: string | null;
  custom_role_id?: string | null;
  is_active?: boolean;
};

type Archetype = { key: string; label: string; defaults: string[]; envelope: string[] };

/** The three-way, as one control rather than two switches.
 *
 *  "Can they see the payroll, and can they change it" is ONE question with
 *  three answers, and two on/off switches make it look like two questions with
 *  a nonsense fourth answer (can change but cannot see). A segmented control
 *  can only ever be in one position, so the impossible state cannot be typed.
 */
/** Counted in PAGES, not in our word "areas" - a number he can check against
 *  the sidebar rather than take on trust. */
const ALL_PAGES = new Set(SECTIONS.flatMap((s) => s.areas.flatMap((a) => a.pages.map((p) => p.slug))));

export function AccessSheet({
  person,
  onClose,
  onSaved,
}: {
  person: Person | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [arch, setArch] = useState<Archetype[]>([]);
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [job, setJob] = useState("");
  // The hotel's OWN roles, so a person can simply be put into one instead
  // of having their switches set by hand every time.
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ archetypes: Archetype[] }>("/roles/archetypes")
      .then((d) => setArch(d.archetypes))
      .catch(() => {});
    api
      .get<{ roles: { id: string; name: string; is_active: boolean }[] }>("/roles")
      // Per-person tuning creates a role named "<who> - custom access". Offering
      // Balaji's private arrangement to the accountant is the exact mistake I
      // filtered off the roles board and then left in place right here.
      .then((d) =>
        setMine(
          d.roles
            .filter((r) => r.is_active && !/— custom access$/.test(r.name))
            .map((r) => ({ id: r.id, name: r.name })),
        ),
      )
      .catch(() => setMine([]));
  }, []);

  // What they can reach TODAY — their job's defaults, plus whatever their
  // designed role changed. Read fresh each time the sheet opens so it can never
  // show a stale picture of somebody's access.
  useEffect(() => {
    if (!person) return;
    setErr(null);
    setJob(person.role);
    const base = arch.find((a) => a.key === person.role);
    const defaults = new Set(base?.defaults ?? []);
    if (!person.custom_role_id) {
      setHeld(defaults);
      return;
    }
    api
      .get<{ roles: { id: string; base_role: string; permissions: string[] }[] }>("/roles")
      .then((d) => {
        const mine = d.roles.find((r) => r.id === person.custom_role_id);
        setHeld(new Set(mine?.permissions ?? [...defaults]));
      })
      .catch(() => setHeld(defaults));
  }, [person, arch]);

  const envelope = useMemo(
    () => new Set(arch.find((a) => a.key === job)?.envelope ?? []),
    [arch, job],
  );

  // Where each area sits: the unsaved choice if there is one, otherwise today.
  const current = (areaKey: string, area: Parameters<typeof levelOf>[0]): Level =>
    draft[areaKey] ?? levelOf(area, held);

  const owner = person?.role === "SUPER_ADMIN";
  const dirty = Object.keys(draft).length > 0 || (person != null && job !== person.role);

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
      title: "Change what they can reach?",
      message: `${name} will be able to open ${reach.on} of ${reach.all} pages. This affects only them.`,
      confirmText: "Save it",
    });
    if (!ok) return;
    if (!person) return;
    setBusy(true);
    setErr(null);
    // Every area is written, not just the ones touched, so the saved picture is
    // exactly the picture on screen — an untouched area cannot quietly keep a
    // permission the new job should never have had.
    const overrides: Record<string, boolean> = {};
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        if (positionsFor(a).length === 0) continue;
        Object.assign(overrides, overridesFor(a, current(a.key, a), shownPages(a)));
      }
    }
    try {
      await api.put(`/roles/user/${person.id}/access`, { base_role: job, overrides });
      setDraft({});
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save their access.");
    } finally {
      setBusy(false);
    }
  }

  const name = person?.preferred_name || person?.email?.split("@")[0] || "";
  const jobLabel = arch.find((a) => a.key === job)?.label.split("—")[0].trim() ?? job;

  // How much of the app they can reach, as one number — the headline a person
  // actually wants: "what does this account get to see?"
  const reach = useMemo(() => {
    const pages = new Set<string>();
    for (const s of SECTIONS)
      for (const a of s.areas)
        if (current(a.key, a) !== "none") for (const pg of a.pages) pages.add(pg.slug);
    return { on: pages.size, all: ALL_PAGES.size };
  }, [envelope, draft, held]);

  return (
    <AccessModal
      open={!!person}
      onClose={onClose}
      icon="🔑"
      title={name}
      subtitle={owner ? "Owner — can do everything" : `${jobLabel} · ${person?.email ?? ""}`}
      stats={
        owner
          ? [{ label: "Can reach", value: "Everything" }]
          : [
              { label: "Pages they can open", value: `${reach.on} of ${reach.all}` },
              { label: "Access", value: person?.custom_role_id ? "Tailored" : "Standard" },
            ]
      }
      lead={
        owner ? (
          <p className="text-sm leading-relaxed text-fg-soft">
            This is the owner&apos;s account. It reaches everything in the hotel and cannot be
            limited — that is what makes it the account that can rescue every other one.
          </p>
        ) : (
          <>
            {err && (
              <p className="mb-3 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                {err}
              </p>
            )}
          {/* WHAT IS THIS PERSON? One list, one question.
              "I checked for my custom role to give to this person, but not
               showing."
              It was there — buried under five job cards, in a second box, below
              the fold. Two lists answering the same question is one list too
              many: the hotel's own roles belong beside ours, because from where
              he is standing "Till" and "super master" are the same kind of
              thing. */}
          <div className="mise-card3d mb-4 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
              What is this person?
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-soft">
              Pick the job or the role they do. It fills in what they reach — you can change any
              of it below, and nothing here is a limit.
            </p>

            {mine.length > 0 && (
              <>
                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-300">
                  Roles you made
                </p>
                <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                  {mine.map((r) => {
                    const on = person?.custom_role_id === r.id;
                    return (
                      <button
                        key={r.id}
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          if (!person) return;
                          // Putting somebody in a role takes effect at once —
                          // there is no save button behind it to change your
                          // mind at.
                          const ok = await confirm({
                            title: `Put ${name} in "${r.name}"?`,
                            message: `They get exactly what that role reaches, and it changes for them straight away. Whenever you edit "${r.name}" later, ${name} changes with it.`,
                            confirmText: "Yes, do it",
                          });
                          if (!ok) return;
                          setBusy(true);
                          setErr(null);
                          try {
                            await api.put(`/roles/user/${person.id}/role`, { role_id: r.id });
                            onSaved();
                            onClose();
                          } catch (ex) {
                            setErr(
                              ex instanceof ApiError ? ex.message : "Could not change their role.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className={`mise-press rounded-xl border px-3 py-2.5 text-left transition ${
                          on
                            ? "border-brand-400/60 bg-brand-400/10"
                            : "border-line hover:border-brand-400/40"
                        }`}
                      >
                        <span className="block text-sm font-medium text-fg">{r.name}</span>
                        <span className="block text-[11px] text-fg-faint">
                          {on ? "they are in this role" : "a role you made"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
              {mine.length > 0 ? "Or a standard job" : "Their job"}
            </p>
            <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
              {arch
                .filter((a) => !/kiosk/i.test(`${a.key} ${a.label}`))
                .map((a) => {
                  const on = job === a.key && !person?.custom_role_id;
                  return (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => { setJob(a.key); setDraft({}); }}
                      className={`mise-press rounded-xl border px-3 py-2.5 text-left transition ${
                        on
                          ? "border-brand-400/60 bg-brand-400/10"
                          : "border-line hover:border-brand-400/40"
                      }`}
                    >
                      <span className="block text-sm font-medium text-fg">
                        {a.label.split("—")[0].trim()}
                      </span>
                      <span className="block text-[11px] text-fg-faint">
                        {a.label.split("—")[1]?.trim() ?? ""}
                      </span>
                    </button>
                  );
                })}
            </div>
            {job !== person?.role && (
              <p className="mise-tone-warn mt-2 text-[11px]">
                Changing their job resets the switches below to that job&apos;s normal access.
              </p>
            )}

          </div>
          </>
        )
      }
      intro={
        owner ? undefined : (
          <>
            <b>{reach.all} pages</b> sit behind the <b>17 switches</b> here — one switch can
            open several, and each row lists which.
          </>
        )
      }
      pagesOn={(a) => shownPages(a)}
      onTogglePage={(a, slug, on) => togglePage(a, slug, on)}
      current={(a) => current(a.key, a)}
      onSet={(a, l) => setDraft((d) => ({ ...d, [a.key]: l }))}
      onBulk={(l, g) => bulk(l, g)}
      explain={(a) => (isUnusual(a, envelope) ? whyUnusual(a, jobLabel) : null)}
      actions={
        owner ? undefined : (
          <div className="flex flex-wrap items-center gap-2">
            {/* THE GATE. Nothing is written until this is pressed — "even in
                that 1 sec they will change their mind and regret." */}
            <button
              type="button"
              disabled={!dirty || busy}
              onClick={save}
              className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy ? "Saving…" : dirty ? "Save what they can reach" : "No changes yet"}
            </button>
            {dirty && (
              <button
                type="button"
                onClick={() => { setDraft({}); setJob(person?.role ?? ""); }}
                className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-soft"
              >
                Undo
              </button>
            )}
          </div>
        )
      }
    />
  );
}
