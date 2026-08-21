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
import { DetailSheet } from "@/components/DetailSheet";
import {
  isUnusual,
  labelFor,
  LEVEL_HINT,
  LEVEL_LABEL,
  levelOf,
  overridesFor,
  positionsFor,
  SECTIONS,
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
            onClick={() => onChange(o)}
            title={LEVEL_HINT[o]}
            className={`mise-press rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition sm:px-3 ${
              on
                ? o === "none"
                  ? "bg-fg-faint/25 text-fg"
                  : o === "view"
                    ? "mise-tone-info bg-glass/10"
                    : "bg-brand-600 text-white"
                : "text-fg-faint hover:text-fg-soft"
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
  // One row for the whole app; each group heading carries its own give-all.
  // Two stacked rows with identical buttons read as a duplicate, because they
  // were one.
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

/** Counted in PAGES, not in our word "areas" - a number he can check against
 *  the sidebar rather than take on trust. */
const ALL_PAGES = new Set(SECTIONS.flatMap((s) => s.areas.flatMap((a) => a.pages)));

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

  async function save() {
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
        Object.assign(overrides, overridesFor(a, current(a.key, a)));
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
        if (current(a.key, a) !== "none") for (const pg of a.pages) pages.add(pg);
    return { on: pages.size, all: ALL_PAGES.size };
  }, [envelope, draft, held]);

  return (
    <DetailSheet
      open={!!person}
      onClose={onClose}
      icon="🔑"
      title={name}
      subtitle={owner ? "Owner — can do everything" : `${jobLabel} · ${person?.email ?? ""}`}
      width="lg"
      stats={
        owner
          ? undefined
          : [
              { label: "Can reach", value: `${reach.on} of ${reach.all}`, hint: "pages in DineAI" },
              { label: "Their job", value: jobLabel, hint: "what they start from" },
              {
                label: "Access",
                value: person?.custom_role_id ? "Tailored" : "Standard",
                hint: person?.custom_role_id ? "differs from the job" : "exactly their job",
                tone: person?.custom_role_id ? "warn" : "plain",
              },
            ]
      }
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
    >
      {owner ? (
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

          <BulkSet onSet={(l) => bulk(l)} />

          {/* EVERY GROUP ON ONE SCREEN, same as the role builder. Five tabs
              meant five visits to answer one question. */}
          {SECTIONS.map((sec) => {
            const areas = sec.areas.filter((a) => positionsFor(a).length > 0);
            if (areas.length === 0) return null;
            return (
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
                  {areas.map((a) => {
                    const lvl = current(a.key, a);
                    const was = levelOf(a, held);
                    const changed = lvl !== was;
                    const odd = isUnusual(a, envelope);
                    return (
                      <li
                        key={a.key}
                        className={`mise-well flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 ${
                          changed ? "ring-1 ring-amber-400/50" : ""
                        }`}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <span aria-hidden className="shrink-0 text-base">
                            {a.icon}
                          </span>
                          <span className="min-w-0">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-fg">
                                {a.label}
                              </span>
                              {odd && (
                                <span
                                  title={`Not normally part of a ${jobLabel}'s job`}
                                  className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300"
                                >
                                  unusual
                                </span>
                              )}
                            </span>
                            <span className="block truncate text-[10px] text-fg-faint">
                              {changed ? (
                                <span className="mise-tone-warn">
                                  was &ldquo;{LEVEL_LABEL[was]}&rdquo; · not saved yet
                                </span>
                              ) : (
                                a.pages.join(" · ")
                              )}
                            </span>
                          </span>
                        </span>
                        <ThreeWay
                          label={a.label}
                          area={a}
                          value={lvl}
                          options={positionsFor(a)}
                          onChange={(l) => setDraft((d) => ({ ...d, [a.key]: l }))}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </>
      )}
    </DetailSheet>
  );
}
