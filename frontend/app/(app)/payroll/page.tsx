"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type Employee, type PayrollRow } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import Link from "next/link";
import { SortTh, useSort } from "@/components/sortable";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate } from "@/lib/date";

type Advance = {
  id: string;
  employee_id: string;
  amount: string;
  reason: string | null;
  given_date: string;
  deduct_period: string;
  is_deducted: boolean;
};

const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const statusTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "slate",
  APPROVED: "amber",
  PAID: "green",
};

// Small "i" that pops a plain-English explainer — same pattern as the Money page,
// so a first-time owner can understand every number without training.
function InfoDot({
  id,
  text,
  open,
  onToggle,
}: {
  id: string;
  text: React.ReactNode;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <span className="relative inline-block align-middle">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle(id);
        }}
        className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded-full border border-line text-[10px] font-bold leading-none text-fg-faint transition-colors hover:border-brand-400 hover:text-brand-300"
        aria-label="What does this mean?"
      >
        i
      </button>
      {open && (
        <span className="absolute left-1/2 top-6 z-40 w-64 -translate-x-1/2 rounded-lg border border-line bg-paper-2 p-3 text-left text-xs font-normal normal-case leading-relaxed text-fg-soft shadow-xl shadow-black/40">
          {text}
        </span>
      )}
    </span>
  );
}

export default function PayrollPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "payroll:write");

  const [period, setPeriod] = useState(thisMonth());
  const [workingDays, setWorkingDays] = useState("26");
  const [helpOpen, setHelpOpen] = useState(true);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const toggleInfo = (id: string) => setOpenInfo((cur) => (cur === id ? null : id));
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const sort = useSort<"employee" | "gross" | "deductions" | "net">("employee");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Advances (money paid to staff early, deducted at the next run)
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [advances, setAdvances] = useState<Advance[]>([]);
  const [advEmp, setAdvEmp] = useState("");
  const [advAmount, setAdvAmount] = useState("");
  const [advReason, setAdvReason] = useState("");
  const [advBusy, setAdvBusy] = useState(false);
  const empName = (id: string) => employees.find((e) => e.id === id)?.full_name ?? "—";

  const load = useCallback(async (p: string) => {
    setRows(await api.get<PayrollRow[]>(`/payroll?pay_period=${p}`));
  }, []);

  const loadAdvances = useCallback(async () => {
    setAdvances(await api.get<Advance[]>("/payroll/advances").catch(() => []));
  }, []);

  useEffect(() => {
    load(period).finally(() => setLoading(false));
    api.get<Employee[]>("/employees").then((e) => setEmployees(e.filter((x) => x.is_active))).catch(() => {});
    loadAdvances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function changePeriod(p: string) {
    setPeriod(p);
    setLoading(true);
    await load(p).finally(() => setLoading(false));
  }

  async function runPayroll() {
    const ok = await confirm({
      title: "Run payroll?",
      message: `This calculates pay for ${period} using ${workingDays || "26"} working days for every active employee.`,
      confirmText: "Run payroll",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<PayrollRow[]>("/payroll/process", {
        pay_period: period,
        working_days: parseInt(workingDays || "26", 10),
      });
      setRows(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run payroll");
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, action: "approve" | "pay") {
    const ok = await confirm({
      title: action === "pay" ? "Mark as paid?" : "Approve payslip?",
      message:
        action === "pay"
          ? "Confirm this payslip has been paid to the employee."
          : "Approve this payslip so it can be paid.",
      confirmText: action === "pay" ? "Mark paid" : "Approve",
    });
    if (!ok) return;
    await api.post(`/payroll/${id}/${action}`);
    await load(period);
  }

  async function approveAll() {
    const drafts = rows.filter((r) => r.status === "DRAFT").length;
    if (!drafts) return;
    const ok = await confirm({
      title: `Approve all ${drafts} draft payslip${drafts === 1 ? "" : "s"}?`,
      message: "Approves every draft payslip for this period in one go, so they can be marked paid.",
      confirmText: "Approve all",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      setRows(await api.post<PayrollRow[]>(`/payroll/approve-all?pay_period=${period}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve all");
    } finally {
      setBusy(false);
    }
  }

  async function addAdvance(e: React.FormEvent) {
    e.preventDefault();
    if (!advEmp || !advAmount) return;
    setAdvBusy(true);
    setError(null);
    try {
      await api.post("/payroll/advances", {
        employee_id: advEmp,
        amount: advAmount,
        reason: advReason || null,
        given_date: localISODate(),
        deduct_period: period,
      });
      setAdvEmp("");
      setAdvAmount("");
      setAdvReason("");
      await loadAdvances();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the advance");
    } finally {
      setAdvBusy(false);
    }
  }

  const sortedRows = sort.sortRows(rows, (r, k) =>
    k === "employee"
      ? r.employee_name
      : k === "gross"
        ? parseFloat(r.gross_pay)
        : k === "deductions"
          ? parseFloat(r.advance_deduction) + parseFloat(r.other_deductions)
          : parseFloat(r.net_pay),
  );

  if (loading) return <Spinner />;

  const totalNet = rows.reduce((sum, r) => sum + parseFloat(r.net_pay), 0);

  return (
    <div>
      {/* click-away to close any open info popover */}
      {openInfo && <div className="fixed inset-0 z-30" onClick={() => setOpenInfo(null)} aria-hidden />}
      <PageHeader title="Payroll" subtitle="Run pay for the period, approve, and issue payslips." />

      {/* Plain-English explainer so a first-time owner understands every number. */}
      <Card className="mb-6 border-brand-500/20 bg-brand-500/5">
        <button onClick={() => setHelpOpen(!helpOpen)} className="flex w-full items-center justify-between text-left">
          <h3 className="font-semibold text-fg">How is this pay worked out?</h3>
          <span className={`text-fg-faint transition-transform duration-200 ${helpOpen ? "rotate-180" : ""}`}>▼</span>
        </button>
        {helpOpen && (
          <div className="mise-fade mt-3 space-y-3 text-sm text-fg-soft">
            <p>
              Pay is built from <b className="text-fg">attendance</b> — the days and hours you record on the{" "}
              <b className="text-fg">Attendance</b> page for the month. The <b className="text-fg">Rota</b> is only the{" "}
              <i>plan</i> (it forecasts cost); it doesn&apos;t pay anyone. Actual pay always comes from attendance.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-line bg-paper-2/50 p-3">
                <p className="font-semibold text-fg">Monthly-salary staff</p>
                <p className="mt-1">Daily rate = monthly salary ÷ <b className="text-fg">working days</b>.</p>
                <p>Pay = days present × daily rate <span className="text-fg-faint">(half-days at half)</span> + overtime.</p>
              </div>
              <div className="rounded-lg border border-line bg-paper-2/50 p-3">
                <p className="font-semibold text-fg">Hourly staff</p>
                <p className="mt-1">Pay = hours worked × hourly rate.</p>
                <p className="text-fg-faint">Hours come from attendance; rate must be ≥ UK minimum wage.</p>
              </div>
            </div>
            <p>
              <b className="text-fg">Working days</b> is the divisor that turns a monthly salary into a daily rate — set it to
              how many days a full month is for you (e.g. <b className="text-fg">26</b> if staff work 6 days/week,{" "}
              <b className="text-fg">30</b> for every day).
            </p>
            <p>
              <b className="text-fg">Where are the salaries set?</b> Each person&apos;s monthly salary or hourly rate lives on
              the <Link href="/employees" className="text-brand-400 underline">Employees</Link> page (edit the person). Payroll reads it from there.
            </p>
            <p>
              <b className="text-fg">Advances</b> = money you give someone early (e.g. an emergency). Record it in{" "}
              <b className="text-fg">Salary advances</b> below against the month you&apos;ll recover it — it&apos;s then automatically
              deducted from that run&apos;s <b className="text-fg">Net</b>. So <b className="text-fg">Net</b> = Gross − advances due − any other deductions.
            </p>
            <p className="text-fg-faint">
              <b className="text-fg">Penalties</b> (late / absence) are handled on <Link href="/attendance" className="text-brand-400 underline">Attendance</Link> — they change the
              days/hours recorded there, which then flows into pay. Each run starts as a{" "}
              <b className="text-fg">Draft</b> → <b className="text-fg">Approve</b> → <b className="text-fg">Mark paid</b>; download a payslip PDF per person, or the whole run as one PDF.
            </p>
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-fg-faint">Pay period</label>
            <input type="month" value={period} onChange={(e) => changePeriod(e.target.value)} className="mt-1 rounded-lg border border-line-2 px-3 py-2 text-sm" />
          </div>
          {canWrite && (
            <>
              <div className="w-32">
                <label className="block text-xs font-medium text-fg-faint">
                  Working days
                  <InfoDot
                    id="wd"
                    open={openInfo === "wd"}
                    onToggle={toggleInfo}
                    text="How many days count as a full month for salaried staff. Daily rate = monthly salary ÷ this. e.g. 26 for a 6-day week, 30 for every day. (Hourly staff ignore this — they're paid per hour.)"
                  />
                </label>
                <input value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm" />
              </div>
              <button onClick={runPayroll} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? "Running…" : "Run payroll"}
              </button>
              {rows.some((r) => r.status === "DRAFT") && (
                <button onClick={approveAll} disabled={busy} className="rounded-lg border border-brand-500/40 bg-brand-500/10 px-4 py-2 text-sm font-medium text-brand-300 hover:bg-brand-500/20 disabled:opacity-60">
                  ✓ Approve all
                </button>
              )}
            </>
          )}
          {rows.length > 0 && (
            <button
              onClick={() => downloadFile(`/payroll/payslips.pdf?pay_period=${period}`, `payslips-${period}.pdf`)}
              title="Download every payslip for this period as one PDF"
              className="rounded-lg border border-line-2 px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2"
            >
              ⬇ All payslips (PDF)
            </button>
          )}
          {rows.length > 0 && (
            <span className="ml-auto text-sm text-fg-faint">
              Net total: <span className="font-semibold text-fg">{format(String(totalNet))}</span>
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </Card>

      {canWrite && (
        <Card className="mb-6">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-fg">Salary advances</h3>
            <InfoDot
              id="adv"
              open={openInfo === "adv"}
              onToggle={toggleInfo}
              text="Money given to a person early (e.g. an emergency). Record it against the month you'll recover it — it's automatically deducted from that month's payroll Net when you run it."
            />
          </div>
          <p className="mt-1 text-xs text-fg-faint">
            Recovered from the selected period&apos;s payroll (<b className="text-fg-soft">{period}</b>).
          </p>
          <form onSubmit={addAdvance} className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
            <label className="block sm:w-48">
              <span className="block text-xs font-medium text-fg-faint">Employee</span>
              <select value={advEmp} onChange={(e) => setAdvEmp(e.target.value)} className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm">
                <option value="">Choose…</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>{e.full_name}</option>
                ))}
              </select>
            </label>
            <label className="block sm:w-32">
              <span className="block text-xs font-medium text-fg-faint">Amount</span>
              <input value={advAmount} onChange={(e) => setAdvAmount(e.target.value)} inputMode="decimal" placeholder="0.00" className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm" />
            </label>
            <label className="block flex-1 sm:min-w-[10rem]">
              <span className="block text-xs font-medium text-fg-faint">Reason (optional)</span>
              <input value={advReason} onChange={(e) => setAdvReason(e.target.value)} placeholder="e.g. medical emergency" className="mt-1 w-full rounded-lg border border-line-2 bg-transparent px-3 py-2 text-sm" />
            </label>
            <button disabled={advBusy || !advEmp || !advAmount} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {advBusy ? "Saving…" : "Record advance"}
            </button>
          </form>
          {advances.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {advances.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                  <span className="text-fg">
                    <b>{empName(a.employee_id)}</b> · {format(a.amount)}
                    {a.reason ? <span className="text-fg-faint"> — {a.reason}</span> : null}
                  </span>
                  <span className="flex items-center gap-2 text-xs">
                    <Badge tone="slate">recover {a.deduct_period}</Badge>
                    {a.is_deducted ? <Badge tone="green">deducted</Badge> : <Badge tone="amber">pending</Badge>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                <SortTh k="employee" label="Employee" sort={sort} />
                <SortTh k="gross" label="Gross" sort={sort} right />
                <SortTh k="deductions" label="Deductions" sort={sort} right />
                <SortTh k="net" label="Net" sort={sort} right />
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 text-right font-medium">Payslip</th>
                {canWrite && <th className="px-5 py-3"></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-5 py-8 text-center text-fg-faint">
                  No payroll for this period yet. {canWrite ? "Click “Run payroll”." : ""}
                </td></tr>
              ) : (
                sortedRows.map((r) => (
                  <tr key={r.id} className="border-b border-line">
                    <td className="px-5 py-3 font-medium text-fg">{r.employee_name}</td>
                    <td className="px-5 py-3 text-right text-fg-soft">{format(r.gross_pay)}</td>
                    <td className="px-5 py-3 text-right text-rose-400">
                      {format(String(parseFloat(r.advance_deduction) + parseFloat(r.other_deductions)))}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-fg">{format(r.net_pay)}</td>
                    <td className="px-5 py-3"><Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge></td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => downloadFile(`/payroll/${r.id}/payslip.pdf`, `payslip-${r.employee_name}-${r.pay_period}.pdf`)}
                        className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/10"
                      >
                        ⬇ PDF
                      </button>
                    </td>
                    {canWrite && (
                      <td className="px-5 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          {r.status === "DRAFT" && (
                            <button onClick={() => act(r.id, "approve")} className="rounded-md border border-line px-2 py-1 text-xs text-fg-soft hover:bg-paper-2">Approve</button>
                          )}
                          {r.status === "APPROVED" && (
                            <button onClick={() => act(r.id, "pay")} className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2 py-1 text-xs font-medium text-brand-300">Mark paid</button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
