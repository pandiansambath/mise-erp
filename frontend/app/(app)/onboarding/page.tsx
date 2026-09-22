"use client";

/** Setting up a restaurant, one section at a time.
 *
 *     "why everythign is splitted ...clumsy...worst worst UI UX... like
 *      litrelly it need to collect all the needed datas section by seciotn...
 *      first start with vendor... then inventory items and match inventory
 *      items with the name in vendor... after inventory ask for employees
 *      ...menu...recipe"
 *
 *  THE BUG THIS PAGE EXISTS TO MAKE IMPOSSIBLE
 *  ------------------------------------------------------------------------
 *  He dropped a stock CSV on the old page. It tried each list in turn and
 *  took the first that parsed: inventory FAILED (it did not accept "Item
 *  Name" as a spelling of "Name"), then vendors MATCHED, because a supplier
 *  list legitimately calls its name column "Supplier". Five stock lines
 *  became five suppliers, filed under the item's category. Nothing said
 *  which section it had gone to.
 *
 *  Guessing which list a file belongs to cannot work, because the same
 *  column heading is a name on one list and a foreign key on another. Here
 *  THE SECTION IS KNOWN, so the file is parsed as that list and no other.
 *  When it does not fit, the answer is a question — which of your columns is
 *  the name? — never a fallback and never a dead end.
 *
 *  WHY THE ORDER IS THE ORDER
 *  ------------------------------------------------------------------------
 *  Suppliers first, then stock, and that is a dependency not a preference: a
 *  stock row NAMES its supplier, so doing stock first guarantees every one of
 *  those names has nothing to match against. My original order had stock
 *  first and made his matching step impossible.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ImportTable, type Decision, type Plan } from "@/components/onboarding/ImportTable";
import { StepBar, type Step, type StepState } from "@/components/onboarding/StepBar";
import { Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { api, ApiError, postForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ApiStep = {
  key: string;
  title: string;
  why: string;
  href: string;
  list: string | null;
  matches: string | null;
  noun: string;
  count: number;
  done: boolean;
  skipped: boolean;
};

type Status = {
  steps: ApiStep[];
  done_count: number;
  total: number;
  complete: boolean;
  next_key: string | null;
  current_step: string | null;
  skipped: string[];
  dismissed: boolean;
};

/** The question at the top of each step. Not the step's name — a name is a
 *  label and a question is an instruction, and only one of those tells you
 *  what to do next. */
const ASK: Record<string, string> = {
  vendors: "Who do you buy from?",
  items: "What do you keep in stock?",
  employees: "Who works here?",
  recipes: "What is on your menu?",
  recipe_lines: "What goes into each dish?",
};

export default function OnboardingPage() {
  const { hotel } = useAuth();
  const [status, setStatus] = useState<Status | null>(null);
  const [at, setAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [reading, setReading] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ plan: Plan; source: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.get<Status>("/hotels/onboarding");
      setStatus(s);
      setAt((cur) => cur ?? s.current_step ?? s.next_key ?? s.steps[0]?.key ?? null);
    } catch {
      // A failed count must never blank the page — the sections still work,
      // and a step showing "—" beats a screen that refuses to render.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const step = useMemo(
    () => status?.steps.find((s) => s.key === at) ?? status?.steps[0] ?? null,
    [status, at],
  );

  /** Remember where he is, server-side, so tomorrow opens here rather than
   *  at the beginning — and so the laptop and the phone agree. */
  const go = useCallback(
    (key: string) => {
      setAt(key);
      setPlan(null);
      setNote(null);
      void api.post("/hotels/onboarding/at", { step: key }).catch(() => {});
    },
    [],
  );

  const steps: Step[] = useMemo(() => {
    if (!status) return [];
    return status.steps.map((s) => {
      let state: StepState = "todo";
      if (s.key === at) state = "current";
      else if (s.done) state = "done";
      else if (s.skipped) state = "skipped";
      return {
        key: s.key,
        title: s.title,
        // Law 4: the count carries its noun. "0 suppliers" is a score;
        // "none yet" is a state, and only one of them is fair.
        hint: s.done ? `${s.count} ${s.noun}` : s.skipped ? "skipped" : "none yet",
        state,
      };
    });
  }, [status, at]);

  /** THE FILE IS PARSED AS THIS SECTION'S LIST AND NO OTHER. No fallback,
   *  ever — that is the whole bug. */
  const take = useCallback(
    async (file: File) => {
      if (!step?.list) return;
      setReading(file.name);
      setNote(null);
      try {
        const body = new FormData();
        body.append("file", file);
        const p = await postForm<Plan>(`/${step.list}/import/preview`, body);
        if (p.rows?.length) {
          setPlan({ plan: p, source: file.name });
        } else {
          // NOT a dead end and NOT a silent success. Say what was expected.
          setNote(
            p.errors?.[0] ??
              `I couldn't find any ${step.noun} in “${file.name}”.`,
          );
        }
      } catch (err) {
        setNote(err instanceof ApiError ? err.message : `Couldn't read “${file.name}”.`);
      } finally {
        setReading(null);
      }
    },
    [step],
  );

  const commit = useCallback(
    async (decisions: Decision[]) => {
      if (!step?.list) return;
      setBusy(true);
      try {
        const res = await api.post<{
          counts: { created: number; updated: number; skipped: number; failed: number };
          failed: { name: string; why: string }[];
        }>(`/${step.list}/import/commit`, { rows: decisions, source: "onboarding" });
        const c = res.counts;
        setNote(
          `Added ${c.created}${c.updated ? `, updated ${c.updated}` : ""}` +
            `${c.skipped ? `, left ${c.skipped}` : ""}` +
            `${c.failed ? `. ${c.failed} could not be saved: ${res.failed[0]?.why}` : "."}`,
        );
        setPlan(null);
        await load();
      } catch (err) {
        setNote(err instanceof ApiError ? err.message : "Could not save those.");
      } finally {
        setBusy(false);
      }
    },
    [step, load],
  );

  const skip = useCallback(async () => {
    if (!step) return;
    try {
      const s = await api.post<Status>("/hotels/onboarding/skip", { step: step.key });
      setStatus(s);
      const nxt = s.next_key;
      if (nxt) go(nxt);
    } catch {
      /* skipping is a convenience; a failure here is not worth a dialog */
    }
  }, [step, go]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!status || !step) {
    return (
      <div className="space-y-3 py-10 text-center">
        <p className="text-sm text-fg-soft">Couldn&apos;t load your setup just now.</p>
        <button type="button" onClick={() => void load()} className="mise-press mise-card-inset rounded-xl px-3 py-2 text-sm">
          Try again
        </button>
      </div>
    );
  }

  const index = status.steps.findIndex((s) => s.key === step.key);

  return (
    <Workbench
      title={ASK[step.key] ?? step.title}
      subtitle={`Step ${index + 1} of ${status.total} · ${step.why}`}
      action={
        <div className="flex items-center gap-1.5">
          {/* THREE EXITS, because "I'll come back" and "stop asking me" are
              different intentions and one button for both is wrong half the
              time. Dismiss lives further in, where its consequence can be
              explained. */}
          <button
            type="button"
            onClick={() => void skip()}
            className="mise-press mise-card-inset rounded-xl px-3 py-2 text-xs font-medium text-fg-soft"
          >
            Skip this
          </button>
          <Link
            href="/dashboard"
            className="mise-press mise-card-inset rounded-xl px-3 py-2 text-xs font-medium text-fg-soft"
          >
            Save &amp; close
          </Link>
        </div>
      }
      tools={<StepBar steps={steps} onGo={go} />}
    >
      <div className="space-y-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg-faint">
          Setting up {hotel?.name ?? "your restaurant"}
        </p>

        {/* ── the source strip: three ways in, equal citizens ────────── */}
        {!plan && (
          <div className="mise-card-inset rounded-2xl p-4">
            {reading ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2.5">
                  <Spinner />
                  <p className="text-sm text-fg-soft">
                    Reading <b className="text-fg">{reading}</b>…
                  </p>
                </div>
                {/* Skeleton rows at the REAL row height, so nothing jumps
                    when the rows land. A 24px spinner in a 1110px card tells
                    you nothing about what is coming. */}
                <div className="space-y-1.5" aria-hidden>
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="mise-readrail h-9 rounded-lg border border-line/60" />
                  ))}
                </div>
              </div>
            ) : step.list ? (
              <>
                <p className="max-w-[54ch] text-sm leading-relaxed text-fg-soft">
                  Bring a spreadsheet, a PDF or a photo of a list — or add them by hand on
                  the {step.title.toLowerCase()} page. Anything exported from another DineAI
                  account works here exactly as it is.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="mise-press rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
                  >
                    Choose a file
                  </button>
                  <Link
                    href={step.href}
                    className="mise-press mise-card-inset rounded-xl px-3.5 py-2.5 text-sm font-medium text-fg-soft"
                  >
                    Add by hand
                  </Link>
                  <a
                    href={`/api/${step.list}/import-template.xlsx`}
                    className="mise-press rounded-xl px-2.5 py-2.5 text-[0.75rem] text-fg-faint underline"
                  >
                    blank template
                  </a>
                </div>
              </>
            ) : (
              /* A step with no importer says so, rather than offering a file
                 chooser that leads nowhere. That button already existed once
                 and he pressed it four times. */
              <>
                <p className="max-w-[54ch] text-sm leading-relaxed text-fg-soft">
                  Ingredient lines are added on the dish itself — open a dish and add what
                  goes into it. There is no file import for this one yet.
                </p>
                <Link
                  href={step.href}
                  className="mise-press mt-3 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white"
                >
                  Open the menu
                </Link>
              </>
            )}
            {/* NO `accept` NARROWER THAN THE SERVER READS. Restricting this is
                what once stopped him choosing his own spreadsheet — the
                refusal happened in the file dialog, before any upload. */}
            <input
              ref={fileRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void take(f);
              }}
            />
          </div>
        )}

        {note && (
          <p className="max-w-[54ch] text-[0.8125rem] leading-relaxed text-fg-soft" role="status">
            {note}
          </p>
        )}

        {/* ── the preview IS the step's content, at full width ───────── */}
        {plan && step.list && (
          <ImportTable
            plan={plan.plan}
            list={step.list}
            source={plan.source}
            busy={busy}
            onCommit={commit}
            onCancel={() => setPlan(null)}
          />
        )}

        {!plan && step.done && (
          <p className="text-sm text-fg-soft">
            {step.count} {step.noun} so far. Bring more whenever you like, or move on.
          </p>
        )}
      </div>
    </Workbench>
  );
}
