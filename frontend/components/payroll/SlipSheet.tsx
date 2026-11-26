"use client";

// One person in a saved run: their days, what was added and taken off, whether
// they have been paid, and everything that can be done about it.

import { useCallback, useEffect, useState } from "react";

import { payMethodLabel } from "@/components/MarkPaidPopup";
import { SheetPopup } from "@/components/SheetPopup";
import { Badge } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { MoneyLine, Pager, Said, useNarrow } from "@/components/payroll/bits";
import { PayPopup } from "@/components/payroll/PayPopup";
import { RecallPopup } from "@/components/payroll/RecallPopup";
import {
  afterClose,
  basisWord,
  pence,
  rateWord,
  sayDay,
  sayDays,
  sayMinutes,
  sayWeekday,
  type SlipDetail,
  slipTone,
  slipWord,
  waitingWords,
} from "@/components/payroll/lib";
import { api, ApiError, downloadFile } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

const PAGE = 21;
const PAGE_NARROW = 9;

export function SlipSheet({
  id,
  canWrite,
  depth = 2,
  onClose,
  onChanged,
}: {
  id: string;
  canWrite: boolean;
  depth?: 1 | 2;
  onClose: () => void;
  /** The run changed under the list behind this. `gone` when this payslip did. */
  onChanged: (gone: boolean) => void;
}) {
  const { format } = useCurrency();
  const confirm = useConfirm();
  const [s, setS] = useState<SlipDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(0);
  const [over, setOver] = useState<"pay" | "recall" | null>(null);

  const load = useCallback(async () => {
    try {
      setS(await api.get<SlipDetail>(`/payroll/slips/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open this payslip.");
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(work: () => Promise<unknown>, gone = false) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await work();
      onChanged(gone);
      if (!gone) await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work. Nothing was changed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function approve() {
    if (!s) return;
    const ok = await confirm({
      title: `Approve ${s.employee_name}?`,
      message: `${format(s.net_pay)}, ${s.label}. Approving agrees the figure. Nothing goes into Expenses until it is marked as paid.`,
      confirmText: "Approve",
    });
    if (ok) await run(() => api.post(`/payroll/${s.id}/approve`));
  }

  async function undoPay() {
    if (!s?.run_id) return;
    const ok = await confirm({
      title: "Undo this payment?",
      message: `${s.employee_name}, ${format(s.net_pay)}, goes back to approved and comes out of Expenses${s.paid_on ? ` (${sayDay(s.paid_on)})` : ""}. You can mark it as paid again.`,
      confirmText: "Undo the payment",
      tone: "danger",
    });
    if (ok) await run(() => api.post(`/payroll/runs/${s.run_id}/unpay`, { payslip_ids: [s.id] }));
  }

  async function takeOut() {
    if (!s) return;
    const ok = await confirm({
      title: `Take ${s.employee_name} out of this run?`,
      message: `Their payslip of ${format(s.net_pay)} goes, and their days can be put in another run.${pence(s.advance_deduction) ? ` The ${format(s.advance_deduction)} advance goes back to owed.` : ""}`,
      confirmText: "Take them out",
      tone: "danger",
    });
    if (ok) await run(() => api.delete(`/payroll/${s.id}`), true);
  }

  async function email() {
    if (!s) return;
    const sent = await run(() => api.post(`/payroll/${s.id}/email`));
    if (sent) setNote(`Emailed to ${s.employee_name}.`);
  }

  const btn = "mise-btn-flat mise-press min-h-[42px] px-3 text-sm text-fg-soft disabled:opacity-50";
  const size = useNarrow() ? PAGE_NARROW : PAGE;
  const days = s?.day_list ?? [];
  const last = Math.max(0, Math.ceil(days.length / size) - 1);
  const here = Math.min(page, last);

  return (
    <>
      <SheetPopup
        depth={depth}
        columns={3}
        onClose={onClose}
        onBack={depth === 1 ? undefined : onClose}
        title={s?.employee_name ?? "Payslip"}
        subtitle={s ? `${s.run_number ? `Run ${s.run_number} · ` : ""}${s.label}` : undefined}
        footer={
          s && (
            <div className="flex flex-wrap items-center gap-2 px-1">
              <button type="button" className={btn} onClick={() => downloadFile(`/payroll/${s.id}/payslip.pdf`, `payslip-${s.employee_name}.pdf`)}>
                ⬇ Payslip
              </button>
              {canWrite && s.status !== "DRAFT" && (
                <button
                  type="button"
                  className={btn}
                  disabled={busy || !s.has_email}
                  title={s.has_email ? undefined : "They have no login, so there is no email address"}
                  onClick={() => void email()}
                >
                  ✉ Email
                </button>
              )}
              {canWrite && s.status !== "PAID" && (
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => void run(() => api.post(`/payroll/slips/${s.id}/hold`, { held: !s.held }))}
                >
                  {s.held ? "Let go" : "Hold back"}
                </button>
              )}
              {canWrite && s.status === "APPROVED" && s.run_id && (
                <button
                  type="button"
                  className={btn}
                  disabled={busy}
                  onClick={() => void run(() => api.post(`/payroll/runs/${s.run_id}/unapprove`, { payslip_ids: [s.id] }))}
                >
                  Back to draft
                </button>
              )}
              {canWrite && s.status === "PAID" && s.run_id && (
                <button type="button" className={btn} disabled={busy} onClick={() => void undoPay()}>
                  Undo payment
                </button>
              )}
              {canWrite && (
                <button
                  type="button"
                  className={btn}
                  data-tone="danger"
                  disabled={busy}
                  onClick={() => (s.status === "PAID" ? setOver("recall") : void takeOut())}
                >
                  {s.status === "PAID" ? "Recall…" : "Take out"}
                </button>
              )}
              {canWrite && !s.held && s.status === "DRAFT" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve()}
                  className="mise-btn-key mise-press ml-auto min-h-[42px] px-5 text-sm font-semibold disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              {canWrite && !s.held && s.status === "APPROVED" && s.run_id && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setOver("pay")}
                  className="mise-btn-key mise-press ml-auto min-h-[42px] px-5 text-sm font-semibold disabled:opacity-50"
                >
                  Mark as paid
                </button>
              )}
              {canWrite && (
                // What each button does, said once, so Undo payment, Back to draft,
                // Take out and Recall are never a guess.
                <p className="w-full text-[10px] leading-snug text-fg-faint">
                  {[
                    s.status !== "PAID" &&
                      (s.held
                        ? "Let go: it can be approved and paid again."
                        : "Hold back: left out when the run is approved or paid."),
                    s.status === "APPROVED" && s.run_id && "Back to draft: un-agree it, so it can be changed.",
                    s.status === "PAID" && s.run_id && "Undo payment: not paid after all, back to approved, out of Expenses.",
                    s.status === "PAID"
                      ? "Recall: remove this payslip as if it was never made. It asks first."
                      : "Take out: off this run; the days go back to Owed so far.",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          )
        }
      >
        {!s ? (
          <div className="py-8 text-center text-sm text-fg-faint">{error ?? "Opening…"}</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-fg-faint">
                <Badge tone={slipTone(s.status)}>{slipWord(s.status)}</Badge>
                {s.held && <Badge tone="amber">On hold</Badge>}
                <span>
                  {`${basisWord(s.basis)}${s.rate ? ` · ${format(s.rate)} ${rateWord(s.rate, s.pay_type)}` : ""}`}
                </span>
              </div>
              <Said error={error} note={note} />
              <div className="space-y-1.5">
                <MoneyLine label="Pay" value={format(s.gross_pay)} tone="text-fg" />
                {pence(s.overtime_pay) > 0 && (
                  <p className="text-[11px] text-fg-faint">{`of which overtime ${format(s.overtime_pay)}`}</p>
                )}
                {s.adjustments.map((a, i) => (
                  <MoneyLine
                    key={`${a.label}-${i}`}
                    label={a.label}
                    value={`${pence(a.amount) < 0 ? "−" : "+"} ${format(a.amount.replace("-", ""))}`}
                    tone={pence(a.amount) < 0 ? "mise-tone-bad" : "mise-tone-good"}
                  />
                ))}
                {pence(s.other_deductions) > 0 && !s.adjustments.some((a) => pence(a.amount) < 0) && (
                  <MoneyLine label="Other deductions" value={`− ${format(s.other_deductions)}`} tone="mise-tone-bad" />
                )}
                {pence(s.advance_deduction) > 0 && (
                  <MoneyLine label="Advance taken back" value={`− ${format(s.advance_deduction)}`} tone="mise-tone-bad" />
                )}
                <div className="border-t border-line pt-2">
                  {pence(s.net_pay) < 0 ? (
                    <MoneyLine label="Owed back to you" value={format(s.net_pay.replace("-", ""))} tone="mise-tone-bad" strong />
                  ) : (
                    <MoneyLine label="They get" value={format(s.net_pay)} tone="mise-tone-good" strong />
                  )}
                </div>
              </div>
              {pence(s.net_pay) < 0 && (
                // Only the old version could make one: an advance bigger than the pay,
                // with nothing to stop the payslip going below nothing.
                <p className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs leading-relaxed text-fg-soft">
                  {`This payslip is below nothing. The old version made it when an advance was bigger than the pay, and marked it paid. Nobody was paid ${format(s.net_pay.replace("-", ""))}: it is what ${s.employee_name} owes back. If the old version also put a minus amount in Expenses, it lowers your costs: Recall this payslip (it asks why) to take it out, then record the advance as it really stands.`}
                </p>
              )}
              {s.others.length > 0 && (
                <p className="mise-well rounded-xl px-3 py-2 text-xs leading-relaxed text-fg-soft">
                  {`${s.employee_name} also has ${s.others.map((w) => waitingWords(w, format)).join("; ")}.`}
                </p>
              )}
              <p className="mise-well rounded-xl px-3 py-2 text-xs leading-relaxed text-fg-soft">
                {pence(s.net_pay) < 0
                  ? "Not money paid out, so not counted as paid anywhere."
                  : s.status === "PAID"
                  ? `Paid${s.paid_on ? ` on ${sayDay(s.paid_on)}` : ""}${s.paid_method ? ` by ${payMethodLabel(s.paid_method).toLowerCase()}` : ""}${s.paid_reference ? `, reference ${s.paid_reference}` : ""}. It is in Expenses on that day.`
                  : s.status === "APPROVED"
                    ? "Approved and not paid yet, so it is not in Expenses."
                    : "A draft. Nobody has agreed it and it is not in Expenses."}
                {s.was_booked_on && ` The old version put it in Expenses on ${sayDay(s.was_booked_on)}.`}
                {s.emailed_at && ` Emailed ${sayDay(s.emailed_at)}.`}
              </p>
              {s.note && <p className="text-sm text-fg-soft">{s.note}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold text-fg">
                {s.day_lines
                  ? `${s.pay_type === "HOURLY" || s.minutes ? `${sayMinutes(s.minutes)} · ` : ""}${sayDays(s.days, s.half_days)}`
                  : "Made before days were kept one by one"}
              </h3>
              {!s.day_lines ? (
                <p className="text-sm text-fg-faint">
                  {`${sayDays(s.days, s.half_days)} and ${sayMinutes(s.minutes)} in ${s.label}. All of those dates count as paid.`}
                </p>
              ) : days.length === 0 ? (
                <p className="text-sm text-fg-faint">No days: this is extras only.</p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                    {days.slice(here * size, (here + 1) * size).map((d) => (
                      <div key={d.date} className="mise-well rounded-xl px-2 py-1.5">
                        <p className="flex justify-between text-[11px] text-fg-faint">
                          <span>{sayWeekday(d.date)}</span>
                          <span title={d.again ? "Paid again, on purpose" : d.typed ? "Typed by hand" : undefined}>
                            {d.again ? "2×" : d.typed ? "✎" : ""}
                          </span>
                        </p>
                        <p className="text-sm font-semibold tabular-nums text-fg">
                          {s.basis === "MANUAL"
                            ? "settled"
                            : s.pay_type === "HOURLY"
                              ? sayMinutes(d.minutes)
                              : d.half_days === 1
                                ? "½ day"
                                : "1 day"}
                        </p>
                        {s.basis !== "MANUAL" && (
                          <p className="text-[11px] tabular-nums text-fg-faint">{format(d.amount)}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  <Pager page={here} size={size} total={days.length} onPage={setPage} />
                </>
              )}
            </section>
          </div>
        )}
      </SheetPopup>

      {s?.run_id && over === "pay" && (
        <PayPopup
          depth={3}
          runId={s.run_id}
          label={s.label}
          slips={[s]}
          onClose={() => setOver(null)}
          onPaid={() => {
            setOver(null);
            onChanged(false);
            void load();
          }}
        />
      )}
      {s?.run_id && over === "recall" && (
        <RecallPopup
          depth={3}
          runId={s.run_id}
          payslipIds={[s.id]}
          onClose={() => setOver(null)}
          onDone={() => {
            setOver(null);
            afterClose(() => onChanged(true));
          }}
        />
      )}
    </>
  );
}
