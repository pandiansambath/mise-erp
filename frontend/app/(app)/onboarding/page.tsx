"use client";

/** Setting up a restaurant, one section at a time.
 *
 *     "why everythign is splitted ...clumsy... like litrelly it need to
 *      collect all the needed datas section by seciotn... first start with
 *      vendor... then inventory items and match inventory items with the
 *      name in vendor... after inventory ask for employees ...menu...recipe"
 *
 *  THE BUG THIS PAGE EXISTS TO MAKE IMPOSSIBLE. The old page tried each list
 *  in turn and took the first that parsed — which is how a stock CSV became
 *  five suppliers, silently. Guessing cannot work, because the same heading
 *  is a name on one list and a foreign key on another. Here the section is
 *  KNOWN, so a file is read as that list and no other.
 *
 *  AND NOTHING IS HOMEWORK. The deterministic reader runs first because it
 *  is exact and free; anything it cannot parse goes to the AI automatically,
 *  without him picking which button meant which. He should never have to
 *  understand our parsing strategy to add his suppliers — and he should
 *  never again be told to go and download a blank template.
 *
 *  ORDER IS DEPENDENCY. Suppliers before stock, because a stock row NAMES
 *  its supplier: doing stock first guarantees every one of those names has
 *  nothing to match against.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { commitRows } from "@/lib/commitRows";
import { FillGaps } from "@/components/onboarding/FillGaps";
import { ImportTable, type Decision, type Plan } from "@/components/onboarding/ImportTable";
import { SourceRail } from "@/components/onboarding/SourceRail";
import { StepBar, type Step, type StepState } from "@/components/onboarding/StepBar";
import { Spinner } from "@/components/ui";
import { Workbench } from "@/components/Workbench";
import { API_BASE, api, ApiError, getToken, postForm } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type ApiStep = {
  key: string;
  title: string;
  why: string;
  href: string;
  list: string | null;
  matches: string | null;
  noun: string;
  then: string | null;
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
  dismissed: boolean;
};

/** The question at the top of each step. A name is a label; a question is an
 *  instruction, and only one of them tells you what to do next. */
const ASK: Record<string, string> = {
  vendors: "Who do you buy from?",
  items: "What do you keep in stock?",
  employees: "Who works here?",
  recipes: "What do you cook?",
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
  const [justSaved, setJustSaved] = useState<string | null>(null);
  /** What was just written, so the optional-details pass can offer the
   *  gaps in it. Cleared when he moves on. */
  const [fresh, setFresh] = useState<Record<string, unknown>[]>([]);
  const liveRef = useRef<HTMLParagraphElement>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.get<Status>("/hotels/onboarding");
      setStatus(s);
      setAt((cur) => cur ?? s.current_step ?? s.next_key ?? s.steps[0]?.key ?? null);
    } catch {
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

  const go = useCallback((key: string) => {
    setAt(key);
    setPlan(null);
    setNote(null);
    setJustSaved(null);
    setFresh([]);
    void api.post("/hotels/onboarding/at", { step: key }).catch(() => {});
  }, []);

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
        // Law 4: a count carries its noun. "0 suppliers" is a score;
        // "none yet" is a state, and only one of them is fair.
        hint: s.done ? `${s.count} ${s.noun}` : s.skipped ? "skipped" : "none yet",
        state,
      };
    });
  }, [status, at]);

  /** DETERMINISTIC FIRST, THEN THE AI — and he never chooses between them.
   *
   *  A file this product exported is read exactly and costs nothing. Only a
   *  file we have never seen costs a model call. Doing it the other way
   *  round would spend money re-reading our own exports and be less accurate
   *  doing it. */
  const takeFiles = useCallback(
    async (files: File[]) => {
      if (!step?.list) return;
      setNote(null);
      setJustSaved(null);

      // One file we might already understand: try the exact reader.
      if (files.length === 1) {
        setReading(`Reading ${files[0].name}…`);
        try {
          const body = new FormData();
          body.append("file", files[0]);
          const p = await postForm<Plan>(`/${step.list}/import/preview`, body);
          if (p.rows?.length) {
            setPlan({ plan: p, source: files[0].name });
            setReading(null);
            return;
          }
        } catch {
          // Not a shape we know. That is not a failure, it is the next step.
        }
      }

      // ANYTHING ELSE GOES TO THE AI, automatically. This is the branch that
      // replaces "Couldn't find the template's header row" — a sentence that
      // was true and completely useless for a text file.
      setReading(
        files.length > 1
          ? `Reading ${files.length} documents…`
          : `Reading ${files[0].name} with AI…`,
      );
      try {
        const body = new FormData();
        for (const f of files) body.append("files", f);
        const res = await fetch(`${API_BASE}/api/${step.list}/import/read-ai`, {
          method: "POST",
          headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
          body,
        });
        if (!res.ok) throw new ApiError(res.status, "The AI could not read those.");
        const out = (await res.json()) as {
          plan: Plan | null;
          read: string[];
          failed: { name: string; why: string }[];
          why?: string;
        };
        if (out.plan?.rows?.length) {
          setPlan({
            plan: out.plan,
            source: out.read.length > 1 ? `${out.read.length} documents` : out.read[0],
          });
          if (out.failed.length) {
            setNote(
              `Couldn't read ${out.failed.length}: ${out.failed
                .map((f) => f.name)
                .slice(0, 3)
                .join(", ")}. The rest are below.`,
            );
          }
        } else {
          setNote(out.why ?? `I couldn't find any ${step.noun} in those.`);
        }
      } catch (err) {
        setNote(
          err instanceof ApiError
            ? err.message
            : "Something went wrong reading those. Try again in a moment.",
        );
      } finally {
        setReading(null);
      }
    },
    [step],
  );

  /** Typed or pasted. Same classify, same preview, same commit. */
  const takeTyped = useCallback(
    async (text: string) => {
      if (!step?.list) return;
      setReading("Reading what you typed…");
      setNote(null);
      try {
        const rows = text
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((line) => {
            const [first, ...rest] = line.split(/[,\t;]/).map((s) => s.trim());
            const key = step.list === "employees" ? "full_name" : "name";
            const row: Record<string, string> = { [key]: first };
            // The second column is the most useful one per list, and getting
            // it wrong costs nothing — he sees every value before it saves.
            if (rest[0]) {
              row[
                step.list === "inventory"
                  ? "unit"
                  : step.list === "employees"
                    ? "job_title"
                    : "category"
              ] = rest[0];
            }
            if (rest[1] && step.list === "inventory") row.current_stock = rest[1];
            if (rest[1] && step.list === "recipes") row.selling_price = rest[1];
            if (rest[1] && step.list === "vendors") row.mobile = rest[1];
            return row;
          });
        const p = await api.post<Plan>(`/${step.list}/import/preview-rows`, { rows });
        if (p.rows?.length) setPlan({ plan: p, source: "what you typed" });
        else setNote("I couldn't read that. One per line is plenty.");
      } catch (err) {
        setNote(err instanceof ApiError ? err.message : "I couldn't read that.");
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
        // BATCHED, so he never meets the server's row cap. He sent 200 items
        // and was told to cut his own spreadsheet into pieces — that is our
        // implementation detail becoming his problem.
        const res = await commitRows(step.list, decisions, "onboarding");
        const c = res.counts;

        // THE ROWS THAT NOW EXIST, with their ids AND the values he sent —
        // the response carries the id, the decision carries the rest. Zipped
        // by row number so the optional pass knows which fields are actually
        // empty rather than asking about all of them.
        const sent = new Map(decisions.map((d) => [d.n, d.values]));
        setFresh(
          (res.created ?? [])
            .filter((r) => r.id)
            .map((r) => ({ ...(sent.get(r.n) ?? {}), id: r.id, name: r.name })),
        );
        setPlan(null);
        setJustSaved(
          `${c.created} ${step.noun} added` +
            (c.updated ? `, ${c.updated} updated` : "") +
            (c.failed ? ` — ${c.failed} couldn't be saved: ${res.failed[0]?.why}` : "") +
            (res.error ? ` ${res.error}` : ""),
        );
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
      if (s.next_key) go(s.next_key);
    } catch {
      /* skipping is a convenience; a failure is not worth a dialog */
    }
  }, [step, go]);

  const finish = useCallback(async () => {
    // "once they finish or skipping all and finishing then that onboading
    //  page need to be disapperered from UI" — so this is a real decision
    //  recorded against the hotel, not a navigation.
    try {
      await api.post("/hotels/onboarding/dismiss", {});
    } catch {
      /* ignore — worst case the card is still there next time */
    }
    window.location.assign("/dashboard");
  }, []);

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
        <button
          type="button"
          onClick={() => void load()}
          className="mise-press mise-card-inset rounded-xl px-3 py-2 text-sm"
        >
          Try again
        </button>
      </div>
    );
  }

  const index = status.steps.findIndex((s) => s.key === step.key);
  const remaining = status.steps.filter((s) => !s.done && !s.skipped);
  const allHandled = remaining.length === 0;

  return (
    <Workbench
      title={ASK[step.key] ?? step.title}
      subtitle={`Step ${index + 1} of ${status.total} · ${step.why}`}
      action={
        // COMPACT AT 390. `Workbench` truncates its title and holds the
        // action row's width, so three buttons here turned "What do you
        // cook?" into "What do y…" — the question is the whole point of the
        // screen. Skip moves into the stage on a phone, where there is room
        // for it to say what it means.
        <div className="flex items-center gap-1.5">
          {!step.done && (
            <button
              type="button"
              onClick={() => void skip()}
              className="mise-press hidden rounded-xl px-3 py-2 text-xs font-medium text-fg-faint hover:text-fg sm:block"
            >
              Not for us
            </button>
          )}
          <Link
            href="/dashboard"
            className="mise-press mise-card-inset rounded-xl px-3 py-2 text-xs font-medium text-fg-soft"
          >
            <span className="hidden sm:inline">Save &amp; close</span>
            <span className="sm:hidden">Close</span>
          </Link>
          {allHandled && (
            <button
              type="button"
              onClick={() => void finish()}
              className="mise-press rounded-xl bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white"
            >
              <span className="hidden sm:inline">Finish setup</span>
              <span className="sm:hidden">Finish</span>
            </button>
          )}
        </div>
      }
      tools={<StepBar steps={steps} onGo={go} />}
    >
      <div className="space-y-4">
        <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg-faint">
          Setting up {hotel?.name ?? "your restaurant"}
        </p>

        {!plan && step.list && (
          <SourceRail
            list={step.list}
            noun={step.noun}
            title={step.title}
            href={step.href}
            reading={reading}
            onFiles={(f) => void takeFiles(f)}
            onTyped={(t) => void takeTyped(t)}
          />
        )}

        {justSaved && (
          <div
            className="mise-spine mise-spine-good mise-tick-in rounded-xl border border-line px-4 py-3"
            role="status"
          >
            <p className="text-sm font-medium text-fg">{justSaved}</p>
            {step.then && <p className="mt-0.5 text-[0.8125rem] text-fg-soft">{step.then}</p>}
            {remaining.length > 0 && (
              <button
                type="button"
                onClick={() => go(remaining[0].key)}
                className="mise-press mt-2 rounded-lg bg-brand-600 px-3.5 py-2 text-[0.8125rem] font-semibold text-white"
              >
                Next: {remaining[0].title.toLowerCase()} →
              </button>
            )}
          </div>
        )}

        {/* THE OPTIONAL DETAILS, AFTER the list is in — never before. Asking
            for a phone number while he is trying to get twelve suppliers in
            turns a two-minute job into twelve forms. */}
        {fresh.length > 0 && step.list && (
          <FillGaps list={step.list} rows={fresh} onDone={() => setFresh([])} />
        )}

        {note && (
          <p
            ref={liveRef}
            role="status"
            className="max-w-[54ch] text-[0.8125rem] leading-relaxed text-fg-soft"
          >
            {note}
          </p>
        )}

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

        {/* Skip lives here on a phone — see the note on `action` above. */}
        {!step.done && !plan && (
          <button
            type="button"
            onClick={() => void skip()}
            className="mise-press rounded-xl px-1 py-2 text-[0.8125rem] text-fg-faint underline underline-offset-2 sm:hidden"
          >
            We don&apos;t need {step.noun} — skip this
          </button>
        )}

        {!plan && !justSaved && step.done && (
          <p className="text-sm text-fg-soft">
            {step.count} {step.noun} so far. Bring more whenever you like, or move on.
          </p>
        )}
      </div>
    </Workbench>
  );
}
