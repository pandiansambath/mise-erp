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
  /** What their AI may do once ai:use is on. Empty = the hotel's defaults, so
   *  nobody is capped by surprise. */
  const [ai, setAi] = useState<Record<string, unknown>>({});
  const [aiTouched, setAiTouched] = useState(false);
  const patchAi = (patch: Record<string, unknown>) => {
    setAiTouched(true);
    setAi((v) => ({ ...v, ...patch }));
  };
  // The hotel's OWN roles, so a person can simply be put into one instead
  // of having their switches set by hand every time.
  const [mine, setMine] = useState<{ id: string; name: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
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
    setAi(
      ((person as unknown as { ai_settings?: Record<string, unknown> }).ai_settings) ?? {},
    );
    setAiTouched(false);
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
  // Touching the AI panel counts as a change too, or Save stays greyed out
  // while the screen plainly shows something different from what is stored.
  const dirty =
    Object.keys(draft).length > 0 || (person != null && job !== person.role) || aiTouched;

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
      await api.put(`/roles/user/${person.id}/access`, { base_role: job, overrides, ai });
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

  /** The full chooser, on demand. It is a question you ask occasionally, so it
   *  does not sit above the switches taking a third of the popup. */
  const picker =
    picking && person ? (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6"
        role="dialog"
        aria-modal="true"
      >
        <div
          className="mise-fade-in absolute inset-0 bg-black/50"
          onClick={() => setPicking(false)}
        />
        <div className="mise-pop-lg relative w-full max-w-lg rounded-t-3xl border border-line bg-paper p-5 shadow-2xl shadow-black/60 sm:rounded-3xl">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-display text-base font-semibold leading-tight text-fg">
                What is {name}?
              </p>
              <p className="text-[11px] text-fg-faint">
                It fills in what they reach. Nothing here is a limit.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setPicking(false)}
              aria-label="Close"
              className="mise-press grid h-8 w-8 shrink-0 place-items-center rounded-lg text-fg-faint hover:text-fg"
            >
              ✕
            </button>
          </div>

          {mine.length > 0 && (
            <>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-brand-300">
                Roles you made
              </p>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                {mine.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Put ${name} in "${r.name}"?`,
                        message: `They get exactly what that role reaches, straight away. Whenever you edit "${r.name}" later, ${name} changes with it.`,
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
                        setErr(ex instanceof ApiError ? ex.message : "Could not change their role.");
                      } finally {
                        setBusy(false);
                        setPicking(false);
                      }
                    }}
                    className={`mise-press rounded-xl border px-3 py-2 text-left transition ${
                      person.custom_role_id === r.id
                        ? "border-brand-400/60 bg-brand-400/10"
                        : "border-line hover:border-brand-400/40"
                    }`}
                  >
                    <span className="block text-[13px] font-medium text-fg">{r.name}</span>
                    <span className="block text-[10px] text-fg-faint">a role you made</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
            {mine.length > 0 ? "Or a standard job" : "Their job"}
          </p>
          <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
            {arch
              .filter((a) => !/kiosk/i.test(`${a.key} ${a.label}`))
              .map((a) => (
                <button
                  key={a.key}
                  type="button"
                  onClick={() => {
                    setJob(a.key);
                    setDraft({});
                    setPicking(false);
                  }}
                  className={`mise-press rounded-xl border px-3 py-2 text-left transition ${
                    job === a.key && !person.custom_role_id
                      ? "border-brand-400/60 bg-brand-400/10"
                      : "border-line hover:border-brand-400/40"
                  }`}
                >
                  <span className="block text-[13px] font-medium text-fg">
                    {a.label.split("—")[0].trim()}
                  </span>
                  <span className="block text-[10px] text-fg-faint">
                    {a.label.split("—")[1]?.trim() ?? ""}
                  </span>
                </button>
              ))}
          </div>
        </div>
      </div>
    ) : null;

  return (
    <>
      {picker}
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
              <p className="mb-2 rounded-xl border border-rose-400/40 bg-rose-400/10 px-3 py-2 text-sm text-rose-200">
                {err}
              </p>
            )}
            {/* ONE LINE, NOT A WALL.
                "even for 4 cards we need to scroll?"
                This was the reason. The chooser listed every role and every job
                as its own card — eight buttons, four rows deep — directly above
                the switches, so the switches started halfway down the popup and
                had to scroll to be reached. What somebody IS takes one line;
                changing it is a question you ask occasionally, so it opens on
                demand instead of sitting there all the time. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-fg-faint">They are</span>
              <span className="mise-well rounded-lg px-2.5 py-1 text-[13px] font-medium text-fg">
                {mine.find((r) => r.id === person?.custom_role_id)?.name ?? jobLabel}
              </span>
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="mise-press rounded-lg border border-line px-2.5 py-1 text-[11px] font-medium text-fg-soft hover:border-brand-400/50"
              >
                Change
              </button>
              <span className="text-[10px] text-fg-faint">
                — or set their switches below, just for them
              </span>
            </div>

            {/* ── WHAT THEIR AI MAY DO ────────────────────────────────────
                "here we don't have a feature to add or remove ai feature
                 (under this we need to have some filter like whether to give
                 haiku or sonnet, also whether to give our voice model, also
                 what the max token max msg etc)."

                WHETHER they get AI is a permission and is already one of the
                switches below — it did not need a second home, and two places
                to turn one thing on is how the two drift apart. This is
                everything UNDER that yes.

                The ceiling is what earns this panel its place. Every other
                switch here grants access to something already paid for; a
                model costs money per question, so "who may use it" without
                "how much" is half a control. */}
            <div className="mise-card-inset mt-3 p-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold text-fg">✨ Their AI</p>
                <p className="text-[11px] text-fg-faint">
                  applies once the AI switch below is on
                </p>
              </div>

              <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                    Model
                  </span>
                  <select
                    value={(ai.model as string) ?? ""}
                    onChange={(e) => patchAi({ model: e.target.value || undefined })}
                    data-testid="ai-model"
                    className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm outline-none"
                  >
                    <option value="">Hotel default</option>
                    <option value="haiku">Haiku — quick and cheap</option>
                    <option value="sonnet">Sonnet — slower, better answers</option>
                  </select>
                </label>

                <label className="flex items-end gap-2 pb-2.5">
                  <input
                    type="checkbox"
                    checked={Boolean(ai.voice)}
                    onChange={(e) => patchAi({ voice: e.target.checked })}
                    data-testid="ai-voice"
                  />
                  <span className="text-sm text-fg-soft">Let them talk to it</span>
                </label>

                <label className="block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                    Max tokens per answer
                  </span>
                  <input
                    value={(ai.max_tokens as string | number | undefined) ?? ""}
                    inputMode="numeric"
                    placeholder="hotel default"
                    onChange={(e) => patchAi({ max_tokens: e.target.value.replace(/[^0-9]/g, "") })}
                    className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                </label>

                <label className="block">
                  <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                    Max messages a day
                  </span>
                  <input
                    value={(ai.max_messages as string | number | undefined) ?? ""}
                    inputMode="numeric"
                    placeholder="hotel default"
                    onChange={(e) => patchAi({ max_messages: e.target.value.replace(/[^0-9]/g, "") })}
                    className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
                  />
                </label>
              </div>

              <p className="mt-2 text-[11px] text-fg-faint">
                Blank means the hotel&apos;s default. These are a spend ceiling, not a
                suggestion — the assistant is the one thing here that costs money every
                time it is asked.
              </p>
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
                onClick={() => { setDraft({}); setJob(person?.role ?? ""); setAi(((person as unknown as { ai_settings?: Record<string, unknown> })?.ai_settings) ?? {}); setAiTouched(false); }}
                className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-soft"
              >
                Undo
              </button>
            )}
          </div>
        )
      }
    />
    </>
  );
}
