"use client";

// WHAT A JOB REACHES — answered once, inherited by everyone who holds it.
//
//   "you gave for each page access, fine... but it will make the job tough for
//    layman that they need to keep on doing this. So manager means what and all
//    he can access — read only or write only or both... super admin can choose
//    this... so please don't restrict any, let super admin do anything he wants."
//
// Two things follow from that and both are load-bearing:
//
//   1. This is the DEFAULT door. Per-person editing still exists, but it is now
//      the exception rather than the only way to answer an ordinary question.
//   2. NOTHING is hidden and nothing is refused. The archetype envelope becomes
//      a warning — "unusual for this job" — rather than a wall. The person
//      setting this bought the software and is telling us what their manager
//      does; our job is to make the consequence visible, not to argue.
import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { AccessModal } from "@/components/AccessModal";
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

export type Job = {
  key: string;
  label: string;
  permissions: string[];
  shipped: string[];
  suggested: string[];
  customised: boolean;
  people: number;
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
    <div role="radiogroup" aria-label={label} className="mise-well inline-flex shrink-0 rounded-xl p-0.5">
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
  // ONE ROW, AT THE TOP. There used to be two stacked rows with identical
  // buttons - "that 2 same button is confusing, better keep in top area as
  // this is a consolidated button". Whole-app lives here; each group heading
  // carries its own give-all where the group actually is.
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

/** Counted in PAGES, not in our word "areas" - "why 17? I thought we have
 *  more". 17 was our grouping, and he had no way to check it. */
const ALL_PAGES = new Set(SECTIONS.flatMap((s) => s.areas.flatMap((a) => a.pages)));

export function JobSheet({
  job,
  everything,
  onClose,
  onSaved,
}: {
  job: Job | null;
  /** The whole catalogue — every area is offered, nothing is hidden. */
  everything: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [held, setHeld] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Record<string, Level>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    setHeld(new Set(job.permissions));
    setDraft({});
    setErr(null);
  }, [job]);

  // The full catalogue stands in for the envelope, so every area shows all
  // three positions. Nothing is withheld from the person who owns the hotel.
  const all = useMemo(() => new Set(everything), [everything]);
  const suggested = useMemo(() => new Set(job?.suggested ?? []), [job]);

  const current = (a: Parameters<typeof levelOf>[0]) => draft[a.key] ?? levelOf(a, held);
  const dirty = Object.keys(draft).length > 0;

  const reach = useMemo(() => {
    const pages = new Set<string>();
    for (const s of SECTIONS)
      for (const a of s.areas) if (current(a) !== "none") for (const pg of a.pages) pages.add(pg);
    return { on: pages.size, total: ALL_PAGES.size };
  }, [draft, held]);

  /** Areas switched on that this job would not ordinarily reach. Warned about,
   *  never blocked — and counted, so the warning is specific. */
  const unusual = useMemo(() => {
    const out: string[] = [];
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        const lvl = current(a);
        if (lvl === "none") continue;
        const perms = lvl === "edit" ? [...a.read, ...a.write] : a.read;
        if (perms.length && !perms.some((p) => suggested.has(p))) out.push(a.label);
      }
    }
    return out;
  }, [draft, held, suggested]);

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
    if (!job) return;
    setBusy(true);
    setErr(null);
    const perms = new Set<string>();
    for (const s of SECTIONS) {
      for (const a of s.areas) {
        const map = overridesFor(a, current(a));
        for (const [p, on] of Object.entries(map)) if (on) perms.add(p);
      }
    }
    try {
      await api.put(`/roles/jobs/${job.key}`, { permissions: [...perms] });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not save what this job reaches.");
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!job) return;
    setBusy(true);
    try {
      await api.delete(`/roles/jobs/${job.key}`);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Could not reset this job.");
    } finally {
      setBusy(false);
    }
  }

  const name = job?.label.split("—")[0].trim() ?? "";

  return (
    <AccessModal
      open={!!job}
      onClose={onClose}
      icon="🧩"
      title={name}
      subtitle={job?.label.split("—")[1]?.trim() ?? ""}
      stats={[
        { label: "Pages they can open", value: `${reach.on} of ${reach.total}` },
        { label: "People with this job", value: String(job?.people ?? 0) },
      ]}
      intro={
        <>
          Everyone with this job gets this — one person can still be changed on their own
          card, which always wins. <b>{reach.total} pages</b> sit behind the <b>17 switches</b>
          below: one switch can open several, and each row lists which.
        </>
      }
      banner={
        unusual.length > 0 ? (
          <p className="mise-tone-warn mt-2 rounded-xl bg-amber-400/10 px-3.5 py-2.5 text-[11px] leading-relaxed">
            <b>Unusual for a {name}:</b> {unusual.join(", ")}. That is allowed — it is your
            hotel — but it is worth being sure, because everyone with this job gets it.
          </p>
        ) : null
      }
      current={(a) => current(a)}
      onSet={(a, l) => setDraft((d) => ({ ...d, [a.key]: l }))}
      onBulk={(l, g) => bulk(l, g)}
      areaExtra={(a) =>
        current(a) !== levelOf(a, held) ? (
          <span className="shrink-0 rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-300">
            unsaved
          </span>
        ) : null
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={!dirty || busy}
            onClick={save}
            className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
          >
            {busy ? "Saving…" : dirty ? `Save — applies to ${job?.people ?? 0} people` : "No changes yet"}
          </button>
          {dirty && (
            <button
              type="button"
              onClick={() => setDraft({})}
              className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-soft"
            >
              Undo
            </button>
          )}
          {job?.customised && !dirty && (
            <button
              type="button"
              onClick={reset}
              className="mise-press rounded-xl border border-line px-3 py-2 text-sm text-fg-faint"
            >
              Back to the DineAI default
            </button>
          )}
        </div>
      }
    />
  );
}
