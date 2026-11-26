"use client";

// Somebody's earlier run that is not finished, said out loud, with what can be
// done about it.
//
//   "yesterday I selected 1 person, 1 week… and ran… but not approved… then I
//    went to the next week and selected the same person… the confusion I got is
//    the previous week also I didn't finish… we need to show the user 'you have
//    an unapproved one… what shall we do'"
//
// Every choice says what it does, in the line under it, so nobody has to guess
// which of four buttons makes two payslips and which makes one.

import type { ReactNode } from "react";

import { SheetPopup } from "@/components/SheetPopup";
import { type Waiting, type WaitingList, waitingWords } from "@/components/payroll/lib";

export type WaitingDo = {
  /** Look at that run. Nothing here changes. */
  open?: (w: Waiting) => void;
  /** Approve that payslip where it is, and stay here. */
  approve?: (w: Waiting) => void;
  /** Take its days into the run being made: one payslip for both. */
  take?: (w: Waiting) => void;
  /** Put it back where it was. */
  untake?: (w: Waiting) => void;
  /** Two payslips, one in each run, and say no more about it. */
  leave?: (w: Waiting) => void;
};

/** One choice, and what it does, right under it. */
export function Act({
  label,
  says,
  onClick,
  tone,
  disabled = false,
}: {
  label: ReactNode;
  says: string;
  onClick: () => void;
  tone?: "brand" | "danger";
  disabled?: boolean;
}) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        data-tone={tone}
        className="mise-btn-flat mise-press min-h-[36px] px-3 text-xs font-semibold text-fg-soft disabled:opacity-50"
      >
        {label}
      </button>
      <span className="max-w-[13rem] text-[10px] leading-snug text-fg-faint">{says}</span>
    </span>
  );
}

export function WaitingNote({
  name,
  items,
  format,
  act,
  left = new Set<string>(),
  busy = false,
}: {
  name: string;
  items: Waiting[];
  format: (v: string) => string;
  act: WaitingDo;
  /** Ones somebody chose to leave as they are: not said again. */
  left?: Set<string>;
  busy?: boolean;
}) {
  const shown = items.filter((w) => !left.has(w.payslip_id));
  if (!shown.length) return null;
  return (
    <div className="space-y-2">
      {shown.map((w) =>
        w.taken ? (
          <div
            key={w.payslip_id}
            className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-400/40 bg-sky-500/10 px-3 py-2 text-sm"
          >
            <p className="min-w-0 flex-1 text-fg-soft">
              {`${name}’s days from Run ${w.number} (${w.label}) are coming into this run. When you save, Run ${w.number} loses ${name}’s payslip, and one payslip here covers both.`}
            </p>
            {act.untake && (
              <Act label="Put them back" says={`Leave them in Run ${w.number}.`} onClick={() => act.untake?.(w)} />
            )}
          </div>
        ) : (
          <div
            key={w.payslip_id}
            className="space-y-2 rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-sm"
          >
            <p className="text-fg">
              <b>{name}</b>
              {` already has ${waitingWords(w, format)}.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {act.open && (
                <Act
                  label={`Open Run ${w.number}`}
                  says="Look at it. Nothing here changes."
                  onClick={() => act.open?.(w)}
                />
              )}
              {act.approve && w.status === "DRAFT" && !w.held && (
                <Act
                  label={`Approve Run ${w.number}`}
                  says={`Agree ${name}’s payslip there, then carry on here.`}
                  onClick={() => act.approve?.(w)}
                  disabled={busy}
                />
              )}
              {act.take && (
                <Act
                  label="Take those days into this run"
                  tone="brand"
                  says={`One payslip here for both. Run ${w.number} keeps its other people.`}
                  onClick={() => act.take?.(w)}
                  disabled={busy}
                />
              )}
              {act.leave && (
                <Act
                  label="Leave it as it is"
                  says="Two payslips, one in each run."
                  onClick={() => act.leave?.(w)}
                />
              )}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/** A short chip for a row: what is still waiting for this person elsewhere. */
export function waitingChip(items: Waiting[]): { text: string; tone: "amber" | "sky" } | null {
  const taken = items.find((w) => w.taken);
  if (taken) return { text: `taking Run ${taken.number}’s days`, tone: "sky" };
  const w = items[0];
  if (!w) return null;
  const more = items.length > 1 ? ` (+${items.length - 1})` : "";
  return {
    text: `Run ${w.number} ${w.status === "DRAFT" ? "not approved" : "not paid"}${more}`,
    tone: "amber",
  };
}

/** Everybody with a run not finished, from the Payroll page's quiet line. */
export function WaitingSheet({
  list,
  format,
  onClose,
  onOpen,
}: {
  list: WaitingList;
  format: (v: string) => string;
  onClose: () => void;
  onOpen: (runId: string) => void;
}) {
  return (
    <SheetPopup
      columns={2}
      onClose={onClose}
      title="Still waiting"
      subtitle="Payslips that are a draft, or approved and not paid"
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-soft">
          A draft needs approving; an approved one needs marking as paid once the money has gone. Nothing here
          is in Expenses yet.
        </p>
        <ul className="space-y-2">
          {list.people.map((p) => (
            <li key={p.employee_id} className="mise-card-inset space-y-1.5 px-3 py-2.5">
              <p className="text-sm font-semibold text-fg">{p.name}</p>
              {p.runs.map((w) => (
                <div key={w.payslip_id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 text-fg-soft">{waitingWords(w, format)}</span>
                  <button
                    type="button"
                    onClick={() => onOpen(w.run_id)}
                    className="mise-btn-flat mise-press min-h-[36px] px-3 text-xs font-semibold text-fg-soft"
                  >
                    {`Open Run ${w.number}`}
                  </button>
                </div>
              ))}
            </li>
          ))}
        </ul>
      </div>
    </SheetPopup>
  );
}
