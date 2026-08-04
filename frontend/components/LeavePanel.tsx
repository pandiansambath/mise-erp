"use client";

// Who is off, and when.
//
// Leave used to exist only as an attendance status on a single day, which
// cannot answer the question anyone actually asks — "is anybody off next
// Tuesday?" — without opening each day in turn. So in practice rotas were built
// without checking, and the clash appeared on the day, when somebody did not
// turn up.
//
// Booking leave over shifts already rota'd is allowed on purpose: plans change,
// and the leave is the newer decision. But the clash is always SAID, because a
// rota still showing someone on holiday is worse than a refusal.

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Employee } from "@/lib/api";
import { Select } from "@/components/Select";
import { localISODate } from "@/lib/date";

type LeaveRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  start_date: string;
  end_date: string;
  days: number;
  kind: string;
  status: string;
  reason: string | null;
};

const KINDS = [
  { value: "ANNUAL", label: "Annual leave" },
  { value: "SICK", label: "Sick" },
  { value: "UNPAID", label: "Unpaid" },
  { value: "OTHER", label: "Other" },
];

/** A month back and three months on: enough to see what is booked without
 *  loading a year nobody scrolls through. */
const windowFrom = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return localISODate(d);
};
const windowTo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() + 3);
  return localISODate(d);
};

export function LeavePanel({
  employees,
  canWrite,
  onChanged,
}: {
  employees: Employee[];
  canWrite: boolean;
  /** The rota re-reads itself: a new leave can make a shift invalid. */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [empId, setEmpId] = useState("");
  const [from, setFrom] = useState(localISODate());
  const [to, setTo] = useState(localISODate());
  const [kind, setKind] = useState("ANNUAL");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(
        await api.get<LeaveRow[]>(
          `/employees/leave/list?date_from=${windowFrom()}&date_to=${windowTo()}`,
        ),
      );
    } catch {
      setRows([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function book(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setWarning(null);
    try {
      const res = await api.post<{ warning: string | null }>("/employees/leave", {
        employee_id: empId,
        start_date: from,
        end_date: to,
        kind,
        reason: reason.trim() || null,
      });
      // The booking succeeded; the warning is about shifts that now need moving.
      if (res.warning) setWarning(res.warning);
      setAdding(false);
      setReason("");
      load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not book that leave.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api.delete(`/employees/leave/${id}`);
      load();
      onChanged?.();
    } catch {
      /* the list re-reads either way */
    }
  }

  const today = localISODate();
  const upcoming = rows.filter((r) => r.end_date >= today);
  const past = rows.filter((r) => r.end_date < today);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-fg">
          Leave
          {upcoming.length > 0 && (
            <span className="ml-2 rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-300">
              {upcoming.length} booked
            </span>
          )}
        </h3>
        {canWrite && !adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setEmpId(employees[0]?.id ?? ""); }}
            className="mise-press rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-fg-soft hover:bg-paper-2"
          >
            + Book leave
          </button>
        )}
      </div>

      <p className="mt-1 text-xs text-fg-faint">
        The rota will refuse to schedule anyone who is on approved leave, and say until when.
      </p>

      {warning && (
        <p className="mise-pop mt-3 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2 text-xs leading-relaxed text-amber-200">
          {warning}
        </p>
      )}

      {adding && (
        <form onSubmit={book} className="mise-pop mt-3 space-y-2 rounded-xl border border-line bg-paper-2/40 p-3">
          <label className="block">
            <span className="block text-[11px] text-fg-faint">Who</span>
            <Select
              value={empId}
              onChange={setEmpId}
              className="mt-1"
              options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  // Keep the range valid as you type rather than rejecting it
                  // afterwards — most leave is a single day or a forward range.
                  if (e.target.value > to) setTo(e.target.value);
                }}
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">To (inclusive)</span>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Type</span>
              <Select value={kind} onChange={setKind} className="mt-1" options={KINDS} />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">Reason (optional)</span>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mise-well mt-1 w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              />
            </label>
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !empId}
              className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Book leave"}
            </button>
            <button
              type="button"
              onClick={() => { setAdding(false); setError(null); }}
              className="rounded-lg px-3 py-1.5 text-xs text-fg-faint hover:text-fg"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {upcoming.length === 0 && past.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line bg-paper-2/40 px-3 py-3 text-xs text-fg-faint">
          Nobody has leave booked. Book it here and the rota will know.
        </p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {[...upcoming, ...past].map((r) => {
            const done = r.end_date < today;
            return (
              <li
                key={r.id}
                className={`flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-sm ${
                  done ? "border-line bg-paper-2/30 opacity-60" : "border-brand-500/25 bg-brand-500/[0.05]"
                }`}
              >
                <span className="font-medium text-fg">{r.employee_name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-fg-faint">
                  {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                  {" · "}
                  {r.days} day{r.days === 1 ? "" : "s"}
                  {" · "}
                  {r.kind.toLowerCase()}
                  {r.reason ? ` · ${r.reason}` : ""}
                </span>
                {canWrite && !done && (
                  <button
                    type="button"
                    onClick={() => cancel(r.id)}
                    className="mise-press rounded-md border border-line px-2 py-1 text-[11px] text-fg-faint hover:text-fg"
                  >
                    Cancel
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
