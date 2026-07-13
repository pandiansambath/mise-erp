"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type Employee, type PayrollRow } from "@/lib/api";
import { Badge, Button, Card, PageHeader, Segmented, Spinner } from "@/components/ui";
import { Bars } from "@/components/charts";
import Link from "next/link";
import { SortTh, useSort } from "@/components/sortable";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { localISODate } from "@/lib/date";
import { numeric } from "@/lib/sanitize";

type Advance = {
  id: string;
  employee_id: string;
  amount: string;
  reason: string | null;
  given_date: string;
  deduct_period: string;
  is_deducted: boolean;
};

const thisMonth = () => localISODate().slice(0, 7); // local YYYY-MM

// ISO week helpers — the backend speaks "2026-W28" for weekly-paid (hourly) staff.
const thisWeek = () => {
  const d = new Date();
  const thu = new Date(d); // ISO week number = week of this date's Thursday
  thu.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(thu.getFullYear(), 0, 4);
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const week = Math.round((thu.getTime() - week1Mon.getTime()) / (7 * 86400000)) + 1;
  return `${thu.getFullYear()}-W${String(week).padStart(2, "0")}`;
};

const isoWeekMonday = (w: string): Date => {
  const [y, wk] = [parseInt(w.slice(0, 4), 10), parseInt(w.slice(6), 10)];
  const jan4 = new Date(y, 0, 4);
  const week1Mon = new Date(jan4);
  week1Mon.setDate(jan4.getDate() - ((jan4.getDay() + 6) % 7));
  const mon = new Date(week1Mon);
  mon.setDate(week1Mon.getDate() + (wk - 1) * 7);
  return mon;
};

const weekLabel = (w: string): string => {
  if (!/^\d{4}-W\d{2}$/.test(w)) return w;
  const mon = isoWeekMonday(w);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${fmt(mon)} – ${fmt(sun)}`;
};

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
        <span className="fixed inset-x-4 top-24 z-50 rounded-xl border border-line bg-paper-2 p-3 text-left text-xs font-normal normal-case leading-relaxed text-fg-soft shadow-xl shadow-black/40 sm:absolute sm:inset-x-auto sm:left-1/2 sm:top-6 sm:z-40 sm:w-64 sm:-translate-x-1/2 sm:rounded-lg">
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

  // Pay cadence: monthly runs (salaried + hourly) or weekly runs (hourly staff
  // paid week-by-week). Each keeps its own picked period.
  const [cadence, setCadence] = useState<"MONTHLY" | "WEEKLY">("MONTHLY");
  const [period, setPeriod] = useState(thisMonth());
  const [week, setWeek] = useState(thisWeek());
  const active = cadence === "WEEKLY" ? week : period;
  const activeLabel = cadence === "WEEKLY" ? `week ${week.slice(6)} (${weekLabel(week)})` : period;
  const [workingDays, setWorkingDays] = useState("26");
  const [helpOpen, setHelpOpen] = useState(true);
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  const toggleInfo = (id: string) => setOpenInfo((cur) => (cur === id ? null : id));
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const sort = useSort<"employee" | "gross" | "deductions" | "net">("employee");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // run-payroll tick cascade + expanded payslip-preview row
  const [runNames, setRunNames] = useState<string[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

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

  async function changePeriod(p: string, c: "MONTHLY" | "WEEKLY" = cadence) {
    if (!p) return;
    if (c === "WEEKLY") setWeek(p);
    else setPeriod(p);
    setLoading(true);
    await load(p).finally(() => setLoading(false));
  }

  async function switchCadence(c: "MONTHLY" | "WEEKLY") {
    setCadence(c);
    await changePeriod(c === "WEEKLY" ? week : period, c);
  }

  async function runPayroll() {
    const ok = await confirm({
      title: cadence === "WEEKLY" ? "Run weekly payroll?" : "Run payroll?",
      message:
        cadence === "WEEKLY"
          ? `This calculates pay for ${activeLabel} for every hourly-paid employee (weekly-paid staff). Salaried staff are paid on their monthly run.`
          : `This calculates pay for ${period} using ${workingDays || "26"} working days for every active employee.`,
      confirmText: "Run payroll",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    // the cascade: everyone this run will touch, ticked off one by one
    const pool = cadence === "WEEKLY" ? employees.filter((e) => e.salary_type === "HOURLY") : employees;
    const names = (pool.length ? pool : employees).map((e) => e.full_name);
    setRunNames(names);
    const started = Date.now();
    try {
      const result = await api.post<PayrollRow[]>("/payroll/process", {
        pay_period: active,
        working_days: parseInt(workingDays || "26", 10),
      });
      // let the ticks finish their beat before the panel bows out
      const wait = Math.max(0, Math.min(names.length, 12) * 140 + 900 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      setRows(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run payroll");
    } finally {
      setRunNames(null);
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
    await load(active);
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
      setRows(await api.post<PayrollRow[]>(`/payroll/approve-all?pay_period=${active}`));
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
        deduct_period: active,
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
              <div className="mise-well rounded-lg p-3">
                <p className="font-semibold text-fg">Monthly-salary staff</p>
                <p className="mt-1">Daily rate = monthly salary ÷ <b className="text-fg">working days</b>.</p>
                <p>Pay = days present × daily rate <span className="text-fg-faint">(half-days at half)</span> + overtime.</p>
              </div>
              <div className="mise-well rounded-lg p-3">
                <p className="font-semibold text-fg">Hourly staff</p>
                <p className="mt-1">Pay = hours worked × hourly rate.</p>
                <p className="text-fg-faint">Hours come from attendance; rate must be ≥ your minimum wage (set in <Link href="/settings" className="underline">Settings</Link>).</p>
              </div>
            </div>
            <p>
              <b className="text-fg">Paying some people weekly?</b> Switch the cadence to{" "}
              <b className="text-fg">Weekly</b>, pick the week, and run — it pays your <b className="text-fg">hourly</b> staff
              for that Monday–Sunday week&apos;s attendance. Salaried staff aren&apos;t touched; run their month as usual.
              Weekly runs also recover any advance scheduled for the month that week ends in.
            </p>
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
            <p className="mise-well rounded-lg p-2.5 text-xs text-fg-faint">
              <b className="text-fg-soft">Two &ldquo;salary&rdquo; places — no double-count.</b> This page (Payroll) works out
              exact <b className="text-fg-soft">per-person</b> pay and makes payslips, but it does <b className="text-fg-soft">not</b> post to your
              P&amp;L. Your P&amp;L / Money labour cost comes only from the <b className="text-fg-soft">&ldquo;Staff Salaries&rdquo;</b> line in{" "}
              <Link href="/profile" className="text-brand-400 underline">Profile → Monthly overheads</Link> (a single monthly figure you set).
              Use Payroll to pay people accurately; use that overhead line for the P&amp;L number.
            </p>
          </div>
        )}
      </Card>

      <Card className="mise-feel mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-fg-faint">Pay cadence</label>
            <Segmented
              className="mt-1"
              value={cadence}
              onChange={switchCadence}
              options={[
                { value: "MONTHLY", label: "Monthly" },
                { value: "WEEKLY", label: "Weekly" },
              ]}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-fg-faint">
              {cadence === "WEEKLY" ? "Week" : "Pay period"}
              {cadence === "WEEKLY" && (
                <InfoDot
                  id="wk"
                  open={openInfo === "wk"}
                  onToggle={toggleInfo}
                  text="Weekly runs pay your hourly (weekly-paid) staff for one Monday–Sunday week of attendance. Salaried staff stay on the monthly run."
                />
              )}
            </label>
            {cadence === "WEEKLY" ? (
              <input type="week" value={week} onChange={(e) => changePeriod(e.target.value)} className="mise-well mt-1 rounded-lg px-3 py-2 text-sm" />
            ) : (
              <input type="month" value={period} onChange={(e) => changePeriod(e.target.value)} className="mise-well mt-1 rounded-lg px-3 py-2 text-sm" />
            )}
            {cadence === "WEEKLY" && <p className="mt-1 text-[11px] text-fg-faint">{weekLabel(week)}</p>}
          </div>
          {canWrite && (
            <>
              {cadence === "MONTHLY" && (
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
                  <input value={workingDays} onChange={(e) => setWorkingDays(numeric(e.target.value, { decimal: false }))} inputMode="numeric" className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm" />
                </div>
              )}
              <Button variant="primary" onClick={runPayroll} busy={busy} busyLabel="Running…">
                Run {cadence === "WEEKLY" ? "weekly " : ""}payroll
              </Button>
              {rows.some((r) => r.status === "DRAFT") && (
                <Button variant="soft" onClick={approveAll} disabled={busy}>
                  ✓ Approve all
                </Button>
              )}
            </>
          )}
          {rows.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => downloadFile(`/payroll/payslips.pdf?pay_period=${active}`, `payslips-${active}.pdf`)}
              title="Download every payslip for this period as one PDF"
            >
              ⬇ All payslips (PDF)
            </Button>
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
            Recovered from the selected period&apos;s payroll (<b className="text-fg-soft">{activeLabel}</b>).
          </p>
          <form onSubmit={addAdvance} className="mt-3 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-end">
            <div className="sm:w-48">
              <span className="block text-xs font-medium text-fg-faint">Employee</span>
              <div className="mt-1">
                <Select
                  value={advEmp}
                  onChange={setAdvEmp}
                  placeholder="Choose…"
                  options={employees.map((e) => ({ value: e.id, label: e.full_name }))}
                />
              </div>
            </div>
            <label className="block sm:w-32">
              <span className="block text-xs font-medium text-fg-faint">Amount</span>
              <input value={advAmount} onChange={(e) => setAdvAmount(numeric(e.target.value))} inputMode="decimal" placeholder="0.00" className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm" />
            </label>
            <label className="block flex-1 sm:min-w-[10rem]">
              <span className="block text-xs font-medium text-fg-faint">Reason (optional)</span>
              <input value={advReason} onChange={(e) => setAdvReason(e.target.value)} placeholder="e.g. medical emergency" className="mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm" />
            </label>
            <Button type="submit" variant="primary" busy={advBusy} busyLabel="Saving…" disabled={!advEmp || !advAmount}>
              Record advance
            </Button>
          </form>
          {advances.length > 0 && (
            <div className="mt-4 space-y-1.5">
              {advances.map((a) => (
                <div key={a.id} className="mise-well mise-feel flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
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
              <p className="pt-1 text-[11px] leading-relaxed text-fg-faint">
                <b className="text-fg-soft">recover 2026-07</b> = this money is taken back from that month&apos;s payroll ·{" "}
                <b className="text-fg-soft">pending</b> = not recovered yet (that month&apos;s pay hasn&apos;t been run) ·{" "}
                <b className="text-fg-soft">deducted</b> = already taken off a completed run.
              </p>
            </div>
          )}
        </Card>
      )}

      {runNames && (
        <Card className="mise-pop-lg mb-6 border-brand-400/30">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-brand-400" />
            <h3 className="font-semibold text-fg">Running {cadence === "WEEKLY" ? "weekly " : ""}payroll — {activeLabel}</h3>
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {runNames.slice(0, 12).map((n, i) => (
              <div key={n + i} className="mise-well flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-fg-soft">
                <span className="mise-tick-in text-brand-400" style={{ animationDelay: `${i * 140}ms` }}>✓</span>
                <span className="truncate">{n}</span>
              </div>
            ))}
          </div>
          {runNames.length > 12 && (
            <p className="mt-2 text-xs text-fg-faint">…and {runNames.length - 12} more</p>
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
                  <PayslipRow
                    key={r.id}
                    r={r}
                    canWrite={canWrite}
                    format={format}
                    open={expanded === r.id}
                    onToggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                    onAct={act}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {rows.length > 1 && (
        <Card className="mise-feel mt-6">
          <h3 className="font-semibold text-fg">Net pay by person</h3>
          <p className="text-xs text-fg-faint">this run, largest first</p>
          <div className="mise-well mt-4 rounded-xl p-3">
            <Bars
              formatValue={(v) => format(String(v))}
              items={[...rows]
                .sort((a, b) => parseFloat(b.net_pay) - parseFloat(a.net_pay))
                .slice(0, 12)
                .map((r) => ({ label: r.employee_name, value: Math.max(0, parseFloat(r.net_pay) || 0), color: "#d97742" }))}
            />
          </div>
        </Card>
      )}
    </div>
  );
}

/** A payslip line: label, dotted leader, monospace figure. */
function Line({ label, value, tone = "text-fg-soft" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-baseline gap-2 text-sm">
      <span className="text-fg-faint">{label}</span>
      <span className="mb-1 flex-1 border-b border-dotted border-line" />
      <span className={`font-mono ${tone}`}>{value}</span>
    </div>
  );
}

/** One payroll line that morphs open into a payslip preview on click. */
function PayslipRow({
  r,
  canWrite,
  format,
  open,
  onToggle,
  onAct,
}: {
  r: PayrollRow;
  canWrite: boolean;
  format: (v: string) => string;
  open: boolean;
  onToggle: () => void;
  onAct: (id: string, action: "approve" | "pay") => void;
}) {
  const overtime = parseFloat(r.overtime_pay) || 0;
  const basic = (parseFloat(r.gross_pay) || 0) - overtime;
  const adv = parseFloat(r.advance_deduction) || 0;
  const other = parseFloat(r.other_deductions) || 0;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-line transition-colors ${open ? "bg-brand-400/5" : "hover:bg-glass/5"}`}
      >
        <td className="px-5 py-3 font-medium text-fg">
          <span className={`mr-2 inline-block text-xs text-fg-faint transition-transform duration-200 ${open ? "rotate-90" : ""}`}>▶</span>
          {r.employee_name}
        </td>
        <td className="px-5 py-3 text-right text-fg-soft">{format(r.gross_pay)}</td>
        <td className="px-5 py-3 text-right text-rose-400">{format(String(adv + other))}</td>
        <td className="px-5 py-3 text-right font-semibold text-fg">{format(r.net_pay)}</td>
        <td className="px-5 py-3"><Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge></td>
        <td className="px-5 py-3 text-right">
          <button
            onClick={(e) => {
              e.stopPropagation();
              downloadFile(`/payroll/${r.id}/payslip.pdf`, `payslip-${r.employee_name}-${r.pay_period}.pdf`);
            }}
            className="mise-press rounded-md border border-line px-2.5 py-1 text-xs font-medium text-brand-300 hover:bg-brand-400/10"
          >
            ⬇ PDF
          </button>
        </td>
        {canWrite && (
          <td className="px-5 py-3 text-right">
            <div className="flex justify-end gap-1">
              {r.status === "DRAFT" && (
                <button onClick={(e) => { e.stopPropagation(); onAct(r.id, "approve"); }} className="mise-press rounded-md border border-line px-2 py-1 text-xs text-fg-soft hover:bg-paper-2">Approve</button>
              )}
              {r.status === "APPROVED" && (
                <button onClick={(e) => { e.stopPropagation(); onAct(r.id, "pay"); }} className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2 py-1 text-xs font-medium text-brand-300">Mark paid</button>
              )}
            </div>
          </td>
        )}
      </tr>
      {open && (
        <tr className="border-b border-line">
          <td colSpan={canWrite ? 7 : 6} className="px-5 pb-4 pt-1">
            <div className="mise-pop mise-well max-w-md rounded-xl p-4">
              <div className="flex items-baseline justify-between">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-fg-faint">Payslip · {r.pay_period}</p>
                <Badge tone={statusTone[r.status] ?? "slate"}>{r.status}</Badge>
              </div>
              <p className="mt-1 font-semibold text-fg">{r.employee_name}</p>
              <div className="mt-3 space-y-1.5">
                <Line label="Basic pay" value={format(String(basic))} />
                {overtime > 0 && <Line label="Overtime" value={`+ ${format(String(overtime))}`} tone="text-brand-300" />}
                <Line label="Gross" value={format(r.gross_pay)} tone="text-fg" />
                {adv > 0 && <Line label="Advance recovered" value={`− ${format(String(adv))}`} tone="text-rose-400" />}
                {other > 0 && <Line label="Other deductions" value={`− ${format(String(other))}`} tone="text-rose-400" />}
              </div>
              <div className="mt-3 flex items-baseline gap-2 border-t border-line pt-2">
                <span className="text-sm font-semibold text-fg">Net pay</span>
                <span className="mb-1 flex-1 border-b border-dotted border-line" />
                <span className="font-mono text-lg font-bold text-brand-300">{format(r.net_pay)}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
