"use client";

// Who is owed what so far: everybody's days that are in no run yet.
//
// Worked out by the same sums a run would use, so the figure here is the figure
// the run then shows. Tick the people, press Start, and the dates are already
// the first and the last of their unpaid days.

import { useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { Pager, Tick, useNarrow } from "@/components/payroll/bits";
import {
  type Owed,
  pence,
  people,
  sayDay,
  sayDays,
  sayMinutes,
  sumPence,
} from "@/components/payroll/lib";
import { useCurrency } from "@/lib/currency";

const PAGE = 8;
const PAGE_NARROW = 5;

export function OwedSheet({
  owed,
  canWrite,
  onClose,
  onStart,
}: {
  owed: Owed | null;
  canWrite: boolean;
  onClose: () => void;
  onStart: (from: string, to: string, ids: string[]) => void;
}) {
  const { format } = useCurrency();
  const [page, setPage] = useState(0);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const list = owed?.people ?? [];
  // Somebody who cannot be paid as things stand is shown, and not ticked.
  const canPay = (p: (typeof list)[number]) => pence(p.estimate) > 0 && !p.flags.some((f) => f.blocking);
  const payable = list.filter(canPay);
  const chosen = payable.filter((p) => !skipped.has(p.employee_id));
  const firsts = chosen.map((p) => p.first_day).filter((d): d is string => Boolean(d)).sort();
  const lasts = chosen.map((p) => p.last_day).filter((d): d is string => Boolean(d)).sort();
  const size = useNarrow() ? PAGE_NARROW : PAGE;
  const last = Math.max(0, Math.ceil(list.length / size) - 1);
  const here = Math.min(page, last);

  return (
    <SheetPopup
      columns={3}
      onClose={onClose}
      title="Owed so far"
      subtitle={owed ? `Days in no run yet, since ${sayDay(owed.date_from)}` : undefined}
      footer={
        canWrite && chosen.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-2">
            <p className="text-sm text-fg-soft">
              {`${people(chosen.length)}, ${format(sumPence(chosen.map((p) => p.estimate)))} before extras and advances`}
            </p>
            <button
              type="button"
              onClick={() => onStart(firsts[0], lasts[lasts.length - 1], chosen.map((p) => p.employee_id))}
              className="mise-btn-key mise-press min-h-[44px] px-5 text-sm font-semibold"
            >
              Start a run with them
            </button>
          </div>
        ) : undefined
      }
    >
      {!owed ? (
        <p className="py-8 text-center text-sm text-fg-faint">Working it out…</p>
      ) : list.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-faint">
          Nobody is owed anything. Every day worked is in a run.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="mise-card-inset overflow-hidden p-0">
            <ul className="divide-y divide-line/60">
              {list.slice(here * size, (here + 1) * size).map((p) => {
                const can = canPay(p);
                const on = can && !skipped.has(p.employee_id);
                return (
                  <li key={p.employee_id} className="flex items-center gap-1 px-1.5">
                    {canWrite && (
                      <Tick
                        on={on}
                        disabled={!can}
                        label={`${on ? "Leave out" : "Pay"} ${p.name}`}
                        onChange={() =>
                          setSkipped((s) => {
                            const n = new Set(s);
                            if (n.has(p.employee_id)) n.delete(p.employee_id);
                            else n.add(p.employee_id);
                            return n;
                          })
                        }
                      />
                    )}
                    <div className="flex min-h-[54px] min-w-0 flex-1 items-center gap-3 px-1 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">
                          {p.name}
                          {p.job_title && <span className="ml-1.5 text-xs font-normal text-fg-faint">{p.job_title}</span>}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 text-[11px] text-fg-faint">
                          <span>
                            {[
                              p.days || p.half_days ? sayDays(p.days, p.half_days) : "no new days",
                              p.minutes ? sayMinutes(p.minutes) : null,
                              p.first_day && p.last_day && p.first_day !== p.last_day
                                ? `${sayDay(p.first_day)} to ${sayDay(p.last_day)}`
                                : p.first_day
                                  ? sayDay(p.first_day)
                                  : null,
                              p.paid_to ? `paid up to ${sayDay(p.paid_to)}` : "never paid here",
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          {pence(p.waiting) > 0 && (
                            <span className="mise-chip !text-[10px]" data-tone="sky">
                              {`${format(p.waiting)} in a run`}
                            </span>
                          )}
                          {pence(p.advance_owed) > 0 && (
                            <span className="mise-chip !text-[10px]" data-tone="slate">
                              {`owes ${format(p.advance_owed)} advance`}
                            </span>
                          )}
                          {p.flags.slice(0, 2).map((f) => (
                            <span key={f.code} className="mise-chip !text-[10px]" data-tone={f.blocking ? "red" : "amber"}>
                              {f.text}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="shrink-0 font-display text-base font-semibold tabular-nums text-fg">
                        {format(p.estimate)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
          <Pager page={here} size={size} total={list.length} onPage={setPage} />
        </div>
      )}
    </SheetPopup>
  );
}
