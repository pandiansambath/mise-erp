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
  LEVEL_HINT,
  LEVEL_LABEL,
  SECTIONS,
  levelOf,
  overridesFor,
  positionsFor,
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
}: {
  value: Level;
  options: Level[];
  onChange: (l: Level) => void;
  label: string;
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
            {LEVEL_LABEL[o]}
          </button>
        );
      })}
    </div>
  );
}

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
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [tab, setTab] = useState("money");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ archetypes: Archetype[] }>("/roles/archetypes")
      .then((d) => setArch(d.archetypes))
      .catch(() => {});
  }, []);

  // What they can reach TODAY — their job's defaults, plus whatever their
  // designed role changed. Read fresh each time the sheet opens so it can never
  // show a stale picture of somebody's access.
  useEffect(() => {
    if (!person) return;
    setErr(null);
    setTab("money");
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
        if (positionsFor(a, envelope).length === 0) continue;
        Object.assign(overrides, overridesFor(a, current(a.key, a), envelope));
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
    let on = 0;
    let all = 0;
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        if (positionsFor(a, envelope).length === 0) continue;
        all += 1;
        if (current(a.key, a) !== "none") on += 1;
      }
    }
    return { on, all };
  }, [envelope, draft, held]);

  return (
    <DetailSheet
      open={!!person}
      onClose={onClose}
      icon="🔑"
      title={name}
      subtitle={owner ? "Owner — can do everything" : `${jobLabel} · ${person?.email ?? ""}`}
      width="lg"
      sections={
        owner
          ? undefined
          : SECTIONS.map((s) => ({ key: s.key, label: s.label, icon: s.icon }))
      }
      active={tab}
      onSection={setTab}
      stats={
        owner
          ? undefined
          : [
              { label: "Can reach", value: `${reach.on} of ${reach.all}`, hint: "areas of the app" },
              { label: "Their job", value: jobLabel, hint: "sets what is possible" },
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

          {/* THEIR JOB — the only abstraction left, and it is one a chef already
              uses. It sets the ceiling; everything below is inside it. */}
          <div className="mise-card3d mb-4 p-3.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-faint">
              Their job here
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-soft">
              This sets what is even possible for them. Everything below is inside it — you can
              turn things off, and back on, but never past what the job should ever reach.
            </p>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              {arch
                .filter((a) => !/kiosk/i.test(`${a.key} ${a.label}`))
                .map((a) => {
                  const on = job === a.key;
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

          {SECTIONS.filter((s) => s.key === tab).map((s) => {
            const areas = s.areas.filter((a) => positionsFor(a, envelope).length > 0);
            return (
              <div key={s.key}>
                {areas.length === 0 ? (
                  <p className="rounded-xl border border-line bg-paper-2/50 p-3.5 text-sm text-fg-faint">
                    A {jobLabel} never reaches {s.label.toLowerCase()}, so there is nothing here to
                    switch on. Change their job above if they need it.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {areas.map((a) => {
                      const lvl = current(a.key, a);
                      const was = levelOf(a, held);
                      const changed = lvl !== was;
                      return (
                        <li
                          key={a.key}
                          className={`mise-card3d flex flex-wrap items-center justify-between gap-3 p-3.5 ${
                            changed ? "ring-1 ring-amber-400/50" : ""
                          }`}
                        >
                          <span className="flex min-w-0 items-center gap-3">
                            <span aria-hidden className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base">
                              {a.icon}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate text-sm font-medium text-fg">
                                {a.label}
                              </span>
                              <span className="block truncate text-[11px] text-fg-faint">
                                {changed ? (
                                  <span className="mise-tone-warn">
                                    was &ldquo;{LEVEL_LABEL[was]}&rdquo; · not saved yet
                                  </span>
                                ) : (
                                  a.blurb
                                )}
                              </span>
                            </span>
                          </span>
                          <ThreeWay
                            label={a.label}
                            value={lvl}
                            options={positionsFor(a, envelope)}
                            onChange={(l) => setDraft((d) => ({ ...d, [a.key]: l }))}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </>
      )}
    </DetailSheet>
  );
}
