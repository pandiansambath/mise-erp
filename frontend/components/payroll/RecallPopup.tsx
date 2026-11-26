"use client";

// Taking a run back, as if it had never been made.
//
//   "we need recall button to remove all traces for safety like by mistake we
//    did payroll"
//
// It says exactly what will go before it asks, counted by the server from the
// rows it would really remove. When money has been marked as paid it asks twice:
// once to read that, and once to type the word and say why. The word is checked
// by the server as well.

import { useEffect, useState } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { Said } from "@/components/payroll/bits";
import { people, type RecallPlan } from "@/components/payroll/lib";
import { api, ApiError } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

const WORD = "RECALL";

export function RecallPopup({
  runId,
  payslipIds,
  depth = 2,
  onClose,
  onDone,
}: {
  runId: string;
  /** Null = the whole run. */
  payslipIds: string[] | null;
  depth?: 2 | 3;
  onClose: () => void;
  onDone: (runGone: boolean) => void;
}) {
  const { format } = useCurrency();
  const [plan, setPlan] = useState<RecallPlan | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [word, setWord] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = payslipIds ? payslipIds.join(",") : "";

  useEffect(() => {
    let live = true;
    api
      .post<RecallPlan>(`/payroll/runs/${runId}/recall/preview`, {
        payslip_ids: ids ? ids.split(",") : null,
      })
      .then((p) => {
        if (live) setPlan(p);
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof ApiError ? err.message : "Could not look at this run.");
      });
    return () => {
      live = false;
    };
  }, [runId, ids]);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ recalled: number; run_gone: boolean }>(
        `/payroll/runs/${runId}/recall`,
        {
          payslip_ids: payslipIds,
          reason: reason.trim() || null,
          confirm: plan?.needs_word ? word.trim() : null,
        },
      );
      onDone(res.run_gone);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not recall it. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const needs = plan?.needs_word ?? false;
  const typed = word.trim().toUpperCase() === WORD && reason.trim().length >= 3;
  const what = plan ? (plan.whole_run ? `run ${plan.number}` : plan.people === 1 ? plan.names[0] : people(plan.people)) : "";
  const asking = !needs || step === 2;

  return (
    <SheetPopup
      depth={depth}
      columns={2}
      onClose={onClose}
      onBack={step === 2 ? () => setStep(1) : undefined}
      title={plan ? `Recall ${what}?` : "Recall"}
      subtitle={plan?.label}
      footer={
        <div className="grid grid-cols-1 gap-2 sm:flex sm:justify-end">
          <button type="button" onClick={onClose} className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm text-fg-soft">
            Keep it
          </button>
          {plan && !asking && (
            <button
              type="button"
              onClick={() => setStep(2)}
              className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm font-semibold"
              data-tone="danger"
            >
              Carry on
            </button>
          )}
          {plan && asking && (
            <button
              type="button"
              onClick={go}
              disabled={busy || (needs && !typed)}
              className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm font-semibold disabled:opacity-50"
              data-tone="danger"
            >
              {busy ? "Recalling…" : `Recall ${what}, ${format(plan.net)}`}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {!plan && !error && <p className="py-6 text-center text-fg-faint">Counting what would go…</p>}
        {plan && step === 1 && (
          <>
            <p className="text-fg-soft">This removes, for good:</p>
            <ul className="space-y-1.5">
              {plan.lines.map((l) => (
                <li key={l} className="mise-well flex gap-2 rounded-xl px-3 py-2 text-fg">
                  <span aria-hidden className="text-rose-400">
                    ✕
                  </span>
                  <span>{`${l}.`}</span>
                </li>
              ))}
            </ul>
            {plan.warnings.map((w) => (
              <p key={w} className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-fg-soft">
                {w}
              </p>
            ))}
            <p className="text-xs text-fg-faint">
              One line is kept in the audit log: who recalled it, when, how much, and why.
            </p>
            {!needs && (
              <label className="block">
                <span className="block text-[11px] text-fg-faint">Why (optional, kept with that line)</span>
                <input
                  value={reason}
                  maxLength={160}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. wrong week"
                  className="mise-well mt-1 w-full rounded-lg px-3 py-2 outline-none"
                />
              </label>
            )}
          </>
        )}
        {plan && step === 2 && (
          <>
            <p className="text-fg-soft">
              {`${format(plan.paid_net)} in this run is marked as paid. Recalling takes it out of Expenses and out of your profit. It does not bring the money back.`}
            </p>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Why? This is kept.</span>
              <input
                value={reason}
                maxLength={160}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. paid the wrong week"
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">{`Type ${WORD} to be sure`}</span>
              <input
                value={word}
                autoCapitalize="characters"
                autoComplete="off"
                onChange={(e) => setWord(e.target.value.slice(0, 20))}
                placeholder={WORD}
                className="mise-well mt-1 w-full rounded-lg px-3 py-2 tracking-widest outline-none"
              />
            </label>
          </>
        )}
        <Said error={error} />
      </div>
    </SheetPopup>
  );
}
