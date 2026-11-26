"use client";

// One run: how far it has got, who is in it, and the next thing to do with it.
//
// The step it is at is said at the top, with the step after it. Every button at
// the bottom says, in a line under it, what it does: approving, paying, undoing a
// payment, putting back to draft and recalling are five different things, and a
// first-time owner should not have to find out which by pressing them. Tick some
// people and it is about them; tick nobody and it is about the run.

import { useCallback, useEffect, useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { Badge } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { Figure, Pager, Said, Tick, useNarrow } from "@/components/payroll/bits";
import { PayPopup } from "@/components/payroll/PayPopup";
import { RecallPopup } from "@/components/payroll/RecallPopup";
import { SlipSheet } from "@/components/payroll/SlipSheet";
import { Act, waitingChip, WaitingNote } from "@/components/payroll/Waiting";
import {
  afterClose,
  pence,
  people,
  type RunDetail,
  runTone,
  sayDay,
  sayDays,
  sayMinutes,
  type Slip,
  slipTone,
  slipWord,
  sumPence,
  type Waiting,
} from "@/components/payroll/lib";
import { api, ApiError, downloadFile } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

const PAGE = 8;
const PAGE_NARROW = 5;

/** Where the run is, and what comes next, in one sentence. */
function nextStep(run: RunDetail): { now: string; next: string } {
  const unpaid = run.people - run.paid;
  switch (run.status) {
    case "DRAFT":
      return {
        now: "Saved as a draft. Nobody has agreed these figures yet, and nothing is in Expenses.",
        next: "Next: check the figures, then press Approve.",
      };
    case "PART_APPROVED":
      return {
        now: `${run.approved} of ${run.people} approved. Nothing is in Expenses yet.`,
        next: "Next: approve the rest, or mark the approved ones as paid when the money has gone.",
      };
    case "APPROVED":
      return {
        now: "Approved: the figures are agreed. Nothing is in Expenses yet, because nothing has been paid.",
        next: "Next: when you have paid them, press Mark as paid.",
      };
    case "PART_PAID":
      return {
        now: `${run.paid} of ${run.people} paid, and in Expenses on the day each was paid.`,
        next: `Next: mark the other ${unpaid} as paid when they have been.`,
      };
    default:
      return {
        now: "Paid. Every payslip is in Expenses, on the day it was paid.",
        next: "Nothing more to do. Undo payment or Recall are here if it was a mistake.",
      };
  }
}

export function RunSheet({
  id,
  initial,
  canWrite,
  depth = 1,
  onClose,
  onChanged,
  onChange,
  onDuplicate,
  onOpenRun,
  onTake,
}: {
  id: string;
  /** Already in hand when it has just been saved. */
  initial?: RunDetail | null;
  canWrite: boolean;
  /** 2: opened from inside a run being put together, to look and come back. */
  depth?: 1 | 2;
  onClose: () => void;
  onChanged: () => void;
  /** Open the draft again to change it. */
  onChange?: (run: RunDetail) => void;
  onDuplicate?: (run: RunDetail) => void;
  /** Open another run in its place. */
  onOpenRun?: (runId: string) => void;
  /** Open this draft again to take one person's days from another run into it. */
  onTake?: (run: RunDetail, slip: Slip, from: Waiting) => void;
}) {
  const { format } = useCurrency();
  const confirm = useConfirm();
  const nested = depth === 2;
  const [run, setRun] = useState<RunDetail | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [slip, setSlip] = useState<string | null>(null);
  const [over, setOver] = useState<"pay" | "recall" | null>(null);
  const [left, setLeft] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setRun(await api.get<RunDetail>(`/payroll/runs/${id}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return onClose();
      setError(err instanceof ApiError ? err.message : "Could not open this run.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  function changed(next: RunDetail) {
    setRun(next);
    setTicked(new Set());
    onChanged();
  }

  async function act(work: () => Promise<RunDetail>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      changed(await work());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const slips = run?.slips ?? [];
  const some = slips.filter((s) => ticked.has(s.id));
  const about: Slip[] = some.length ? some : slips;
  const toApprove = about.filter((s) => s.status === "DRAFT" && !s.held);
  const toPay = about.filter((s) => s.status === "APPROVED" && !s.held);
  const paid = about.filter((s) => s.status === "PAID");
  const approved = about.filter((s) => s.status === "APPROVED");
  const net = (l: Slip[]) => sumPence(l.map((s) => s.net_pay));
  const ids = (l: Slip[]) => l.map((s) => s.id);
  // Said at the top while there is something to do here; once paid, the chip on
  // their line is enough.
  const waiting = slips.filter(
    (s) => s.status !== "PAID" && s.others.some((w) => !left.has(w.payslip_id)),
  );

  async function approve() {
    if (!run) return;
    const ok = await confirm({
      title: `Approve ${people(toApprove.length)}?`,
      message: `${format(net(toApprove))}, ${run.label}. Approving agrees the figures. Nothing goes into Expenses until they are marked as paid.`,
      confirmText: "Approve",
    });
    if (ok) await act(() => api.post<RunDetail>(`/payroll/runs/${run.id}/approve`, { payslip_ids: ids(toApprove) }));
  }

  async function approveThere(s: Slip, w: Waiting) {
    const ok = await confirm({
      title: `Approve Run ${w.number} for ${s.employee_name}?`,
      message: `${format(w.net)}, ${w.label}. It is agreed there. Nothing goes into Expenses until it is marked as paid.`,
      confirmText: "Approve it",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/payroll/runs/${w.run_id}/approve`, { payslip_ids: [w.payslip_id] });
      setNote(`Run ${w.number} approved for ${s.employee_name}.`);
      onChanged();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve it.");
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    if (!run) return;
    const ok = await confirm({
      title: `Undo the payment of ${people(paid.length)}?`,
      message: `${format(net(paid))} comes out of Expenses and they go back to approved. You can mark them as paid again.`,
      confirmText: "Undo the payment",
      tone: "danger",
    });
    if (ok) await act(() => api.post<RunDetail>(`/payroll/runs/${run.id}/unpay`, { payslip_ids: ids(paid) }));
  }

  async function backToDraft() {
    if (!run) return;
    await act(() => api.post<RunDetail>(`/payroll/runs/${run.id}/unapprove`, { payslip_ids: ids(approved) }));
  }

  async function email() {
    if (!run) return;
    const ready = slips.filter((s) => s.status !== "DRAFT").length;
    const ok = await confirm({
      title: `Email ${ready} payslip${ready === 1 ? "" : "s"}?`,
      message:
        "Each goes to that person’s own login email, as a PDF. Drafts are not sent, and anyone without a login is skipped and listed here.",
      confirmText: "Send",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await api.post<{ sent: number; skipped: string[] }>(`/payroll/runs/${run.id}/email`);
      setNote(`Sent ${res.sent}.${res.skipped.length ? ` Not sent: ${res.skipped.join("; ")}.` : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not email the payslips.");
    } finally {
      setBusy(false);
    }
  }

  const size = useNarrow() ? PAGE_NARROW : PAGE;
  const last = Math.max(0, Math.ceil(slips.length / size) - 1);
  const here = Math.min(page, last);
  const tool = "mise-btn-flat mise-press min-h-[40px] px-3 text-xs font-medium text-fg-soft disabled:opacity-50";
  const all = slips.length > 0 && ticked.size === slips.length;
  const step = run ? nextStep(run) : null;
  const whom = some.length ? `the ${people(some.length)} ticked` : "this run";

  return (
    <>
      <SheetPopup
        depth={depth}
        columns={4}
        onClose={onClose}
        onBack={nested ? onClose : undefined}
        title={run ? `Run ${run.number} · ${run.label}` : "Payroll run"}
        subtitle={run ? (run.note ?? `Made ${sayDay(run.created_at)}${run.created_by ? ` by ${run.created_by}` : ""}`) : undefined}
        footer={
          run && (
            <div className="flex flex-wrap items-start gap-2 px-1">
              <p className="mr-auto self-center text-xs text-fg-faint">
                {some.length
                  ? `${people(some.length)} ticked, ${format(net(some))}`
                  : `${people(slips.length)}, ${format(run.net)}`}
              </p>
              {canWrite && paid.length > 0 && (
                <Act
                  label={`Undo payment${paid.length < slips.length ? ` (${paid.length})` : ""}`}
                  says="Not paid after all: back to approved, out of Expenses."
                  onClick={() => void undo()}
                  disabled={busy}
                />
              )}
              {canWrite && approved.length > 0 && (
                <Act
                  label="Back to draft"
                  says="Un-agree it, so it can be changed."
                  onClick={() => void backToDraft()}
                  disabled={busy}
                />
              )}
              {canWrite && (
                <Act
                  label="Recall…"
                  tone="danger"
                  says={`Remove ${whom} as if it was never made. It asks first.`}
                  onClick={() => setOver("recall")}
                  disabled={busy}
                />
              )}
              {canWrite && toPay.length > 0 && (
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setOver("pay")}
                    className={`${toApprove.length ? "mise-btn-flat" : "mise-btn-key"} mise-press min-h-[44px] px-4 text-sm font-semibold disabled:opacity-50`}
                  >
                    {`Mark ${toPay.length === 1 ? toPay[0].employee_name : toPay.length} as paid`}
                  </button>
                  <span className="max-w-[14rem] text-[10px] leading-snug text-fg-faint">
                    The money has gone: it goes into Expenses on that day.
                  </span>
                </span>
              )}
              {canWrite && toApprove.length > 0 && (
                <span className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void approve()}
                    className="mise-btn-key mise-press min-h-[44px] px-4 text-sm font-semibold disabled:opacity-50"
                  >
                    {busy ? "One moment…" : `Approve ${people(toApprove.length)}, ${format(net(toApprove))}`}
                  </button>
                  <span className="max-w-[14rem] text-[10px] leading-snug text-fg-faint">
                    Agrees the figures. Nothing goes into Expenses yet.
                  </span>
                </span>
              )}
            </div>
          )
        }
      >
        {!run ? (
          <p className="py-10 text-center text-sm text-fg-faint">{error ?? "Opening…"}</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={runTone(run.status)}>{run.status_text}</Badge>
              {run.held > 0 && <Badge tone="amber">{`${run.held} on hold`}</Badge>}
              <div className="flex flex-wrap gap-1.5 sm:ml-auto">
                {canWrite && run.can_change && onChange && !nested && (
                  <button type="button" className={tool} onClick={() => onChange(run)}>
                    ✎ Change
                  </button>
                )}
                {canWrite && onDuplicate && !nested && (
                  <button type="button" className={tool} onClick={() => onDuplicate(run)}>
                    ⧉ Same again, next dates
                  </button>
                )}
                <button
                  type="button"
                  className={tool}
                  onClick={() => downloadFile(`/payroll/runs/${run.id}/export.csv`, `payroll-run-${run.number}.csv`)}
                >
                  ⬇ Spreadsheet
                </button>
                <button
                  type="button"
                  className={tool}
                  onClick={() => downloadFile(`/payroll/runs/${run.id}/payslips.pdf`, `payslips-run-${run.number}.pdf`)}
                >
                  ⬇ Payslips
                </button>
                {canWrite && run.draft < run.people && (
                  <button type="button" className={tool} disabled={busy} onClick={() => void email()}>
                    ✉ Email
                  </button>
                )}
              </div>
            </div>

            {step && (
              <p className="mise-well rounded-xl px-3 py-2 text-sm text-fg-soft">
                {`${step.now} `}
                <b className="text-fg">{step.next}</b>
              </p>
            )}

            <div className={`grid grid-cols-2 gap-1.5 ${pence(run.owed_back) ? "sm:grid-cols-6" : "sm:grid-cols-5"}`}>
              <Figure label="Pay" value={format(run.gross)} />
              <Figure label="Added" value={format(run.additions)} />
              <Figure label="Taken off" value={format(run.deductions)} tone={pence(run.deductions) ? "mise-tone-bad" : "text-fg"} />
              <Figure label="They get" value={format(run.net)} tone="text-fg" strong />
              <Figure
                label={run.paid ? "Paid, in Expenses" : "In Expenses"}
                value={format(run.paid_net)}
                tone={pence(run.paid_net) ? "mise-tone-good" : "text-fg-faint"}
                strong
              />
              {pence(run.owed_back) > 0 && (
                <Figure label="Owed back to you" value={format(run.owed_back)} tone="mise-tone-bad" strong />
              )}
            </div>

            <Said error={error} note={note} />

            {waiting.length > 0 && (
              <div className="space-y-2">
                {waiting.slice(0, 2).map((s) => (
                  <WaitingNote
                    key={s.id}
                    name={s.employee_name}
                    items={s.others}
                    format={format}
                    left={left}
                    busy={busy}
                    act={{
                      open: onOpenRun ? (w) => onOpenRun(w.run_id) : undefined,
                      approve: canWrite ? (w) => void approveThere(s, w) : undefined,
                      take:
                        canWrite && onTake && run.can_change && !nested
                          ? (w) => onTake(run, s, w)
                          : undefined,
                      leave: (w) => setLeft((l) => new Set(l).add(w.payslip_id)),
                    }}
                  />
                ))}
                {waiting.length > 2 && (
                  <p className="text-xs text-fg-faint">
                    {`${people(waiting.length - 2)} more with another run not finished: marked on their line below.`}
                  </p>
                )}
              </div>
            )}

            <div className="mise-card-inset overflow-hidden p-0">
              <div className="flex items-center gap-1 border-b border-line/60 px-1.5 py-0.5 text-[11px] text-fg-faint">
                <Tick
                  on={all}
                  onChange={() => setTicked(all ? new Set() : new Set(slips.map((s) => s.id)))}
                  label={all ? "Untick everybody" : "Tick everybody"}
                />
                <span className="flex-1">{all ? "Untick all" : "Tick all"}</span>
                <span className="pr-8">They get</span>
              </div>
              <ul className="divide-y divide-line/60">
                {slips.slice(here * size, (here + 1) * size).map((s) => {
                  const chip = waitingChip(s.others);
                  const owes = pence(s.net_pay) < 0;
                  return (
                    <li key={s.id} className="flex items-center gap-1 px-1.5">
                      <Tick
                        on={ticked.has(s.id)}
                        label={`Tick ${s.employee_name}`}
                        onChange={() =>
                          setTicked((t) => {
                            const n = new Set(t);
                            if (n.has(s.id)) n.delete(s.id);
                            else n.add(s.id);
                            return n;
                          })
                        }
                      />
                      <button
                        type="button"
                        disabled={nested}
                        onClick={() => setSlip(s.id)}
                        className="flex min-h-[54px] min-w-0 flex-1 items-center gap-3 rounded-xl py-1.5 pl-1 pr-2 text-left transition hover:bg-glass/5 disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-fg">
                            {s.employee_name}
                            {s.job_title && <span className="ml-1.5 text-xs font-normal text-fg-faint">{s.job_title}</span>}
                          </span>
                          <span className="flex flex-wrap items-center gap-1 text-[11px] text-fg-faint">
                            <span className="truncate">
                              {[
                                // Days taken in from another run: this payslip covers more than the run.
                                s.label !== run.label ? s.label : null,
                                s.pay_type === "HOURLY" || s.minutes ? sayMinutes(s.minutes) : null,
                                sayDays(s.days, s.half_days),
                                pence(s.additions) ? `+ ${format(s.additions)}` : null,
                                pence(s.other_deductions) + pence(s.advance_deduction)
                                  ? `− ${format(sumPence([s.other_deductions, s.advance_deduction]))}`
                                  : null,
                                s.paid_on ? `paid ${sayDay(s.paid_on)}` : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            {chip && (
                              <span className="mise-chip !text-[10px]" data-tone={chip.tone}>
                                {chip.text}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-3">
                          <Badge tone={owes ? "red" : s.held ? "amber" : slipTone(s.status)}>
                            {owes ? "Owes it back" : s.held ? "On hold" : slipWord(s.status)}
                          </Badge>
                          <span
                            className={`w-24 whitespace-nowrap text-right font-display text-base font-semibold tabular-nums ${owes ? "mise-tone-bad" : "text-fg"}`}
                          >
                            {format(owes ? s.net_pay.replace("-", "") : s.net_pay)}
                          </span>
                        </span>
                        {!nested && (
                          <span aria-hidden className="text-fg-faint">
                            ›
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            <Pager page={here} size={size} total={slips.length} onPage={setPage} />
            {nested && (
              <p className="text-[11px] text-fg-faint">
                Opened from the run you are putting together. To change one person here, open this run from the Payroll page.
              </p>
            )}
          </div>
        )}
      </SheetPopup>

      {slip && !nested && (
        <SlipSheet
          key={slip}
          id={slip}
          canWrite={canWrite}
          onClose={() => setSlip(null)}
          onChanged={(gone) => {
            if (gone) setSlip(null);
            onChanged();
            void load();
          }}
        />
      )}
      {run && over === "pay" && (
        <PayPopup
          depth={nested ? 3 : 2}
          runId={run.id}
          label={`Run ${run.number} · ${run.label}`}
          slips={toPay}
          onClose={() => setOver(null)}
          onPaid={(next) => {
            setOver(null);
            changed(next);
          }}
        />
      )}
      {run && over === "recall" && (
        <RecallPopup
          depth={nested ? 3 : 2}
          runId={run.id}
          payslipIds={some.length && some.length < slips.length ? ids(some) : null}
          onClose={() => setOver(null)}
          onDone={(gone) => {
            setOver(null);
            onChanged();
            if (gone) afterClose(onClose);
            else {
              setTicked(new Set());
              void load();
            }
          }}
        />
      )}
    </>
  );
}
