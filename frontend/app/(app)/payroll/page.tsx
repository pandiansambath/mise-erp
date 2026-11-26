"use client";

// PAYROLL IS A LIST OF RUNS.
//
//     "like currently we have monthly weekly... i need day wise, like custom date
//      i can pick and then i can pick for whom and all.. etc etc... full n full
//      customizable and playable"
//
// It was a page about ONE PERIOD: pick a month or a week, press Run, and the
// payslips under it. Any other dates lived in a popup of their own, one person
// at a time, and their runs could not be found again from here. Now a run is
// some dates and some people, whatever they are, and the page is the runs:
// what nobody has put in one yet, what is waiting to be agreed, what is waiting
// to be paid, and what was paid. Everything opens in place, over the list.

import { useCallback, useEffect, useState } from "react";

import { useConfirm } from "@/components/confirm";
import { useDeepLink } from "@/components/fx";
import { TotalsStrip } from "@/components/PageKit";
import { Advances } from "@/components/payroll/Advances";
import { Pager, Said } from "@/components/payroll/bits";
import { PayrollHelp } from "@/components/payroll/Help";
import {
  addMonths,
  afterClose,
  type Legacy,
  monthEnd,
  monthStart,
  type NextRun,
  type Owed,
  pence,
  people,
  type PresetKey,
  PRESETS,
  presetDates,
  type Run,
  type RunDetail,
  type Runs,
  runTone,
  type WaitingList,
  sayDay,
  today,
} from "@/components/payroll/lib";
import { OwedSheet } from "@/components/payroll/OwedSheet";
import { PersonHistory } from "@/components/payroll/PersonHistory";
import { type BuilderStart, RunBuilder } from "@/components/payroll/RunBuilder";
import { RunSheet } from "@/components/payroll/RunSheet";
import { SlipSheet } from "@/components/payroll/SlipSheet";
import { WaitingSheet } from "@/components/payroll/Waiting";
import { Select } from "@/components/Select";
import { SheetPopup } from "@/components/SheetPopup";
import { SubNav } from "@/components/SubNav";
import { Badge, Button, PageHeader, SkeletonCard } from "@/components/ui";
import { api, ApiError, type Employee } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const PAGE = 8;

type Status = "" | "DRAFT" | "APPROVED" | "PART_PAID" | "PAID";
type When = "" | "this_month" | "last_month" | "three_months" | "this_year" | "custom";

const STATUSES: { value: Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "APPROVED", label: "To pay" },
  { value: "PART_PAID", label: "Part paid" },
  { value: "PAID", label: "Paid" },
];

const WHENS: { value: When; label: string }[] = [
  { value: "", label: "Any dates" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "three_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "custom", label: "From and to…" },
];

function whenDates(w: When): { from: string; to: string } | null {
  const now = today();
  if (w === "this_month") return { from: monthStart(now), to: monthEnd(now) };
  if (w === "last_month") {
    const f = addMonths(now, -1);
    return { from: f, to: monthEnd(f) };
  }
  if (w === "three_months") return { from: addMonths(now, -2), to: monthEnd(now) };
  if (w === "this_year") return { from: `${now.slice(0, 4)}-01-01`, to: `${now.slice(0, 4)}-12-31` };
  return null;
}

type Open =
  | { what: "build"; start: BuilderStart }
  | { what: "run"; id: string; initial?: RunDetail }
  | { what: "slip"; id: string }
  | { what: "owed" | "advances" | "history" | "help" | "legacy" | "waiting" }
  | null;

export default function PayrollPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "payroll:write");

  const [data, setData] = useState<Runs | null>(null);
  const [everything, setEverything] = useState<Runs | null>(null);
  const [owed, setOwed] = useState<Owed | null>(null);
  const [waiting, setWaiting] = useState<WaitingList | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [open, setOpen] = useState<Open>(null);
  const [starting, setStarting] = useState(false);

  // ── the list, narrowed ─────────────────────────────────────────────────────
  const [status, setStatus] = useState<Status>("");
  const [when, setWhen] = useState<When>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [who, setWho] = useState("");
  const [page, setPage] = useState(0);

  const range = when === "custom" ? { from, to } : whenDates(when);
  const query = new URLSearchParams();
  if (status) query.set("status", status);
  if (range?.from) query.set("date_from", range.from);
  if (range?.to) query.set("date_to", range.to);
  if (who) query.set("employee_id", who);
  const q = query.toString();

  const load = useCallback(async () => {
    try {
      const all = await api.get<Runs>("/payroll/runs");
      setEverything(all);
      setData(q ? await api.get<Runs>(`/payroll/runs?${q}`) : all);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open payroll.");
    }
  }, [q]);

  const loadOwed = useCallback(async () => {
    setOwed(await api.get<Owed>("/payroll/owed").catch(() => null));
    setWaiting(await api.get<WaitingList>("/payroll/waiting").catch(() => null));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void loadOwed();
    api.get<Employee[]>("/employees").then(setEmployees).catch(() => {});
  }, [loadOwed]);

  const changed = useCallback(() => {
    void load();
    void loadOwed();
  }, [load, loadOwed]);

  // /payroll?payslip=<id> and ?run=<id>: the Copilot, an email or the Expenses
  // page can land on the very record instead of on a list to find it in.
  useDeepLink({
    payslip: () => {
      const id = new URLSearchParams(window.location.search).get("payslip");
      if (id) setOpen({ what: "slip", id });
    },
    run: () => {
      const id = new URLSearchParams(window.location.search).get("run");
      if (id) setOpen({ what: "run", id });
    },
  });

  // ── starting a run ─────────────────────────────────────────────────────────
  /** New run, the way the last one was made: the same people, the same way of
   *  counting, and the same preset, so "last week" is last week again. */
  async function startNew() {
    setStarting(true);
    setNote(null);
    const next = await api.get<NextRun | null>("/payroll/runs/next").catch(() => null);
    setStarting(false);
    if (!next) return setOpen({ what: "build", start: {} });
    const key = PRESETS.find((p) => p.key === next.from_preset)?.key as PresetKey | undefined;
    const r = next.request;
    const dates = key ? presetDates(key, today(), r.week_start ?? 0) : null;
    setOpen({
      what: "build",
      start: {
        preset: dates ? key : r.only_dates ? "days" : "custom",
        request: {
          ...r,
          ...(dates ? { date_from: dates.from, date_to: dates.to, only_dates: null } : {}),
          // Who, and how each counts. A typed amount belongs to its own dates
          // and is carried on only by "Same again".
          people: r.people.map((p) => ({ employee_id: p.employee_id, basis: p.basis })),
        },
      },
    });
  }

  /** The same run again, on the dates that come next. */
  async function duplicate(runId: string) {
    setStarting(true);
    const next = await api.get<NextRun | null>(`/payroll/runs/next?run_id=${runId}`).catch(() => null);
    setStarting(false);
    if (!next) return setError("Could not copy that run.");
    setOpen({
      what: "build",
      start: {
        title: "Same again",
        subtitle: `Run ${next.from_number} (${next.from_label}), moved on to the next dates. Extras are not copied.`,
        preset: next.request.only_dates ? "days" : "custom",
        request: next.request,
      },
    });
  }

  /** Close what is open, and open something else once it has really gone. */
  const swap = (to_: Open) => {
    setOpen(null);
    afterClose(() => setOpen(to_));
  };

  async function oldOnesPaid(legacy: Legacy) {
    const ok = await confirm({
      title: `Mark ${legacy.payslips} old payslip${legacy.payslips === 1 ? "" : "s"} as paid?`,
      message: `${format(legacy.total)} goes back into Expenses, each on the day it was approved, the way it was before. Do this only if those people really were paid.`,
      confirmText: "They were paid",
    });
    if (!ok) return;
    try {
      await api.post("/payroll/legacy/paid", {});
      setOpen(null);
      setNote("Done. They are marked as paid, on the days they were approved.");
      changed();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark those as paid.");
    }
  }

  const job = (what: "owed" | "advances" | "history" | "help") => {
    setNote(null);
    setOpen({ what });
  };

  const rows = data?.runs ?? [];
  const last = Math.max(0, Math.ceil(rows.length / PAGE) - 1);
  const here = Math.min(page, last);
  const all = everything?.totals;
  const legacy = everything?.legacy;
  const narrowed = Boolean(q);

  return (
    <div>
      <PageHeader
        title="Payroll"
        subtitle="Pay anybody for any dates. Nothing is in Expenses until it is marked as paid."
        actions={
          canWrite && (
            <Button variant="primary" onClick={() => void startNew()} busy={starting} busyLabel="One moment…">
              ＋ New run
            </Button>
          )
        }
      />

      <SubNav
        items={[
          ...(canWrite
            ? [{ key: "new", label: "New run", shortLabel: "New", icon: "＋", onSelect: () => void startNew() }]
            : []),
          { key: "owed", label: "Owed so far", shortLabel: "Owed", icon: "⏳", count: owed?.people.length, onSelect: () => job("owed") },
          ...(canWrite
            ? [{ key: "advances", label: "Salary advances", shortLabel: "Advances", icon: "💵", onSelect: () => job("advances") }]
            : []),
          { key: "history", label: "Pay history", shortLabel: "History", icon: "📖", onSelect: () => job("history") },
          { key: "help", label: "How payroll works", shortLabel: "Help", icon: "❓", onSelect: () => job("help") },
        ]}
      />

      {legacy && legacy.payslips > 0 && (
        <div className="mise-card-inset mb-4 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
          <p className="min-w-0 flex-1 basis-64 text-sm text-fg-soft">
            <b className="text-fg">{`${legacy.payslips} payslip${legacy.payslips === 1 ? "" : "s"}, ${format(legacy.total)},`}</b>
            {" were approved before and never marked as paid. They used to be in Expenses all the same. They are not now."}
          </p>
          <button
            type="button"
            onClick={() => setOpen({ what: "legacy" })}
            className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm font-semibold"
          >
            Were they paid?
          </button>
        </div>
      )}

      <TotalsStrip
        className="mb-4"
        items={[
          {
            label: "Owed so far",
            value: (
              <button type="button" className="underline-offset-4 hover:underline" onClick={() => job("owed")}>
                {owed ? format(owed.estimate) : "…"}
              </button>
            ),
            // (Somebody with a day to look at but nothing to pay yet is not "owed".)
            hint: owed
              ? owed.people.some((p) => pence(p.estimate) > 0)
                ? `${people(owed.people.filter((p) => pence(p.estimate) > 0).length)}, in no run yet`
                : owed.people.length
                  ? `${people(owed.people.length)} with a day to look at`
                  : "every day is in a run"
              : undefined,
            strong: true,
          },
          { label: "Drafts", value: all ? format(all.draft_net) : "…", hint: "worked out, not agreed" },
          {
            label: "Approved, to pay",
            value: all ? format(all.approved_net) : "…",
            hint: "agreed, not in Expenses yet",
            tone: all && pence(all.approved_net) ? "warn" : "plain",
          },
          {
            label: "Paid",
            value: all ? format(all.paid_net) : "…",
            hint: "in Expenses, all runs",
            tone: "good",
          },
        ]}
      />

      <div className="mb-3 grid gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="grid grid-cols-5 gap-1 sm:flex">
          {STATUSES.map((s) => (
            <button
              key={s.value || "all"}
              type="button"
              aria-pressed={status === s.value}
              onClick={() => {
                setStatus(s.value);
                setPage(0);
              }}
              className={`mise-press min-h-[40px] rounded-xl px-2 text-xs sm:px-3.5 ${
                status === s.value ? "mise-btn-key font-semibold" : "mise-btn-flat text-fg-soft"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="sm:w-40">
            <Select
              value={when}
              onChange={(v) => {
                setWhen(v as When);
                setPage(0);
              }}
              options={WHENS}
            />
          </div>
          <div className="sm:w-48">
            <Select
              value={who}
              onChange={(v) => {
                setWho(v);
                setPage(0);
              }}
              options={[
                { value: "", label: "Anybody" },
                ...employees.map((e) => ({ value: e.id, label: e.full_name })),
              ]}
            />
          </div>
        </div>
        {when === "custom" && (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
            <input
              type="date"
              aria-label="From"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mise-well min-w-0 rounded-lg px-2.5 py-2 text-sm"
            />
            <input
              type="date"
              aria-label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mise-well min-w-0 rounded-lg px-2.5 py-2 text-sm"
            />
          </div>
        )}
        {narrowed && data && (
          <p className="text-xs text-fg-faint sm:ml-auto">
            {`${rows.length} ${rows.length === 1 ? "run" : "runs"} · ${format(data.totals.net)}, ${format(data.totals.paid_net)} of it paid`}
          </p>
        )}
      </div>

      <Said error={error} note={note} />

      {waiting && waiting.people.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen({ what: "waiting" })}
          className="mise-well mise-press mb-3 flex w-full flex-wrap items-center gap-x-2 rounded-xl px-3 py-2 text-left text-sm text-fg-soft"
        >
          <span className="min-w-0 flex-1">
            {[
              waiting.drafts
                ? `${people(waiting.drafts)} ${waiting.drafts === 1 ? "has" : "have"} a run waiting for approval`
                : null,
              waiting.approved
                ? `${people(waiting.approved)} approved and not paid yet`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <span className="text-xs font-semibold text-fg">See who ›</span>
        </button>
      )}

      {!data && !error ? (
        <SkeletonCard rows={6} />
      ) : rows.length === 0 ? (
        <div className="mise-card-inset rounded-2xl px-6 py-10 text-center">
          <p className="font-display text-lg font-semibold text-fg">
            {narrowed ? "No run matches." : "No payroll run yet."}
          </p>
          <p className="mt-1 text-sm text-fg-faint">
            {narrowed
              ? "Change the filters above to see more."
              : owed && owed.people.length
                ? `${people(owed.people.length)} owed ${format(owed.estimate)} so far.`
                : "A run is some dates and some people. Save it as a draft, approve it, then mark it as paid once the money has gone."}
          </p>
          {!narrowed && canWrite && (
            <div className="mt-4">
              <Button variant="primary" onClick={() => void startNew()}>
                ＋ New run
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <ul className="mise-stagger space-y-2">
            {rows.slice(here * PAGE, (here + 1) * PAGE).map((r) => (
              <RunRow key={r.id} r={r} format={format} onOpen={() => setOpen({ what: "run", id: r.id })} />
            ))}
          </ul>
          <div className="mt-3 flex justify-end">
            <Pager page={here} size={PAGE} total={rows.length} onPage={setPage} />
          </div>
        </>
      )}

      {open?.what === "build" && (
        <RunBuilder
          start={open.start}
          onClose={() => setOpen(null)}
          onSaved={(run) => {
            changed();
            swap({ what: "run", id: run.id, initial: run });
          }}
        />
      )}
      {open?.what === "run" && (
        <RunSheet
          key={open.id}
          id={open.id}
          initial={open.initial ?? null}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onChanged={changed}
          onChange={(run) =>
            swap({
              what: "build",
              start: {
                run,
                request: run.setup,
                preset:
                  (PRESETS.find((p) => p.key === run.setup.preset)?.key as PresetKey | undefined) ??
                  (run.setup.only_dates ? "days" : "custom"),
                subtitle: run.label,
              },
            })
          }
          onDuplicate={(run) => {
            setOpen(null);
            afterClose(() => void duplicate(run.id));
          }}
          onOpenRun={(id) => swap({ what: "run", id })}
          onTake={(run, slip, from) =>
            swap({
              what: "build",
              start: {
                run,
                request: run.setup,
                preset:
                  (PRESETS.find((p) => p.key === run.setup.preset)?.key as PresetKey | undefined) ??
                  (run.setup.only_dates ? "days" : "custom"),
                subtitle: `${run.label}: taking ${slip.employee_name}’s days from Run ${from.number}`,
                take: [{ employee_id: slip.employee_id, from }],
              },
            })
          }
        />
      )}
      {open?.what === "waiting" && waiting && (
        <WaitingSheet
          list={waiting}
          format={format}
          onClose={() => setOpen(null)}
          onOpen={(id) => swap({ what: "run", id })}
        />
      )}
      {open?.what === "slip" && (
        <SlipSheet
          key={open.id}
          id={open.id}
          depth={1}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onChanged={(gone) => {
            changed();
            if (gone) setOpen(null);
          }}
        />
      )}
      {open?.what === "owed" && (
        <OwedSheet
          owed={owed}
          canWrite={canWrite}
          onClose={() => setOpen(null)}
          onStart={(f, t, ids) =>
            swap({
              what: "build",
              start: {
                title: "Pay what is owed",
                preset: "custom",
                request: { date_from: f, date_to: t, people: ids.map((id) => ({ employee_id: id })) },
              },
            })
          }
        />
      )}
      {open?.what === "advances" && <Advances employees={employees} onClose={() => setOpen(null)} />}
      {open?.what === "history" && (
        <PersonHistory
          employees={employees}
          onClose={() => setOpen(null)}
          onOpen={(id) => swap({ what: "slip", id })}
        />
      )}
      {open?.what === "help" && <PayrollHelp onClose={() => setOpen(null)} />}
      {open?.what === "legacy" && legacy && (
        <LegacyPopup
          legacy={legacy}
          canWrite={canWrite}
          format={format}
          onClose={() => setOpen(null)}
          onPaid={() => void oldOnesPaid(legacy)}
          onOpen={(id) => swap({ what: "slip", id })}
        />
      )}
    </div>
  );
}

function RunRow({ r, format, onOpen }: { r: Run; format: (v: string) => string; onOpen: () => void }) {
  const names = r.names.slice(0, 3).join(", ");
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="mise-card-inset mise-press flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition hover:border-line-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-fg sm:text-base">{r.label}</span>
          <span className="block truncate text-xs text-fg-faint">
            {`Run ${r.number} · ${r.people > 3 ? `${names} and ${r.people - 3} more` : names}${r.note ? ` · ${r.note}` : ""}`}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-4">
          <span className="flex items-center gap-1.5">
            {r.held > 0 && <Badge tone="amber">{`${r.held} on hold`}</Badge>}
            <Badge tone={runTone(r.status)}>{r.status_text}</Badge>
          </span>
          <span className="text-right sm:w-32">
            <span className="block font-display text-base font-semibold tabular-nums text-fg">{format(r.net)}</span>
            {pence(r.owed_back) > 0 ? (
              // Below nothing, from the old version: owed to you, not paid out.
              <span className="block text-[11px] mise-tone-bad">{`${format(r.owed_back)} owed back`}</span>
            ) : r.status === "PART_PAID" ? (
              <span className="block text-[11px] text-fg-faint">{`${format(r.unpaid_net)} still to pay`}</span>
            ) : r.status === "DRAFT" || r.status === "PART_APPROVED" ? (
              <span className="block text-[11px] text-fg-faint">not approved yet</span>
            ) : r.status === "APPROVED" ? (
              <span className="block text-[11px] text-fg-faint">not paid yet</span>
            ) : r.last_paid_on ? (
              <span className="block text-[11px] text-fg-faint">{`paid ${sayDay(r.last_paid_on)}`}</span>
            ) : null}
          </span>
        </span>
        <span aria-hidden className="text-fg-faint">
          ›
        </span>
      </button>
    </li>
  );
}

/** Approved by the old version, which put them in Expenses there and then. */
function LegacyPopup({
  legacy,
  canWrite,
  format,
  onClose,
  onPaid,
  onOpen,
}: {
  legacy: Legacy;
  canWrite: boolean;
  format: (v: string) => string;
  onClose: () => void;
  onPaid: () => void;
  onOpen: (id: string) => void;
}) {
  const [page, setPage] = useState(0);
  const size = 6;
  return (
    <SheetPopup
      columns={2}
      onClose={onClose}
      title="Were these paid?"
      subtitle={`${legacy.payslips} approved before, ${format(legacy.total)}`}
      footer={
        canWrite && (
          <div className="grid gap-2 sm:flex sm:justify-end">
            <button type="button" onClick={onClose} className="mise-btn-flat mise-press min-h-[44px] px-4 text-sm text-fg-soft">
              Not all of them
            </button>
            <button type="button" onClick={onPaid} className="mise-btn-key mise-press min-h-[44px] px-5 text-sm font-semibold">
              Yes, they were all paid
            </button>
          </div>
        )
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-fg-soft">
          Approving used to put a wage in Expenses by itself. Now only paying does, so these came out. If they
          were paid, say so and each goes back on the day it was approved. If some were not, open the ones
          that were and mark them as paid.
        </p>
        <div className="mise-card-inset overflow-hidden p-0">
          <ul className="divide-y divide-line/60">
            {legacy.rows.slice(page * size, (page + 1) * size).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className="flex min-h-[48px] w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition hover:bg-glass/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-fg">{s.employee_name}</span>
                    <span className="block truncate text-[11px] text-fg-faint">
                      {`${s.label}${s.was_booked_on ? ` · was in Expenses on ${sayDay(s.was_booked_on)}` : ""}`}
                    </span>
                  </span>
                  <span className="font-display font-semibold tabular-nums text-fg">{format(s.net_pay)}</span>
                  <span aria-hidden className="text-fg-faint">
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <Pager page={page} size={size} total={legacy.rows.length} onPage={setPage} />
      </div>
    </SheetPopup>
  );
}
