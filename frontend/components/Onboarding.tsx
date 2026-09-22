"use client";

/** One line on the dashboard, pointing at the section that does the work.
 *
 *     "even after i clikc save and finigsh ...still onboading section is
 *      showing in dashboard...i said once they finish or skipping all and
 *      finishing then that onboading page need to be disapperered"
 *
 *  THIS USED TO BE A SECOND WIZARD. It listed all six steps, named the next
 *  one, offered its own import button and kept its own progress bar — beside
 *  a separate hand-written banner further down the same page doing the same
 *  job from a different localStorage key. Two things saying the same thing is
 *  how one of them ends up stale, and both of them ignored the one source of
 *  truth: whether he had actually finished.
 *
 *  So it is now a POINTER, not a wizard. The work lives at /onboarding.
 *
 *  AND IT OBEYS THE SERVER. `complete`, `dismissed` and `snoozed_until` are
 *  stored against the hotel, not in this browser — he finishes on the laptop
 *  and the phone agrees. localStorage was why "save and finish" left the card
 *  sitting there: the button never wrote the key this component read.
 */

import Link from "next/link";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

type Step = { key: string; title: string; why: string; count: number; noun: string; done: boolean; skipped: boolean };

type Status = {
  steps: Step[];
  done_count: number;
  total: number;
  complete: boolean;
  next_key: string | null;
  dismissed: boolean;
  snoozed_until: string | null;
};

export function Onboarding({ hotelName }: { hotelName?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    api
      .get<Status>("/hotels/onboarding")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status || gone) return null;

  // FINISHED, DISMISSED, OR SNOOZED — three ways to have said "not now", and
  // all three are his to decide. No "well done" tombstone either: a card that
  // congratulates you for finishing is still a card you have to dismiss.
  if (status.complete || status.dismissed) return null;
  if (status.snoozed_until && status.snoozed_until > new Date().toISOString().slice(0, 10)) {
    return null;
  }

  const next = status.steps.find((s) => s.key === status.next_key);
  const done = status.steps.filter((s) => s.done).length;

  return (
    <section
      className="mise-card-inset mb-5 rounded-2xl p-4"
      aria-label={`Setting up ${hotelName ?? "your restaurant"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.12em] text-fg-faint">
            Setting up · {done} of {status.total} done
          </p>
          {next && (
            <>
              <p className="mt-1 font-display text-lg font-bold text-fg">{next.title}</p>
              <p className="mt-0.5 max-w-[54ch] text-sm leading-relaxed text-fg-soft">
                {next.why}
              </p>
            </>
          )}
        </div>

        {/* Four keys, not a percentage. A bar 50% full reads as half failed;
            two filled keys read as two things done. Same data. */}
        <span aria-hidden className="flex shrink-0 items-center gap-1.5 pt-1">
          {status.steps.map((s) => (
            <i
              key={s.key}
              className={
                s.done
                  ? "mise-bg-good block h-1.5 w-6 rounded-full"
                  : s.skipped
                    ? "block h-1.5 w-6 rounded-full border border-line"
                    : "block h-1.5 w-6 rounded-full bg-glass/20"
              }
            />
          ))}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link
          href="/onboarding"
          className="mise-press rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white"
        >
          Continue setting up
        </Link>
        <button
          type="button"
          onClick={() => {
            // NOT NOW ≠ STOP ASKING. This quietens the card for a week;
            // stopping entirely is a decision with a consequence and belongs
            // on the onboarding page, where the consequence can be explained.
            setGone(true);
            void api.post("/hotels/onboarding/snooze", { days: 7 }).catch(() => {});
          }}
          className="mise-press rounded-xl px-3 py-2 text-sm text-fg-faint hover:text-fg"
        >
          Not now
        </button>
      </div>
    </section>
  );
}
