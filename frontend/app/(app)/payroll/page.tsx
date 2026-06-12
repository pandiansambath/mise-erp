"use client";

import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile, type PayrollRow } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const statusTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "slate",
  APPROVED: "amber",
  PAID: "green",
};

export default function PayrollPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "payroll:write");

  const [period, setPeriod] = useState(thisMonth());
  const [workingDays, setWorkingDays] = useState("26");
  const [rows, setRows] = useState<PayrollRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: string) => {
    setRows(await api.get<PayrollRow[]>(`/payroll?pay_period=${p}`));
  }, []);

  useEffect(() => {
    load(period).finally(() => setLoading(false));
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

  if (loading) return <Spinner />;

  const totalNet = rows.reduce((sum, r) => sum + parseFloat(r.net_pay), 0);

  return (
    <div>
      <PageHeader title="Payroll" subtitle="Run pay for the period, approve, and issue payslips." />

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-fg-faint">Pay period</label>
            <input type="month" value={period} onChange={(e) => changePeriod(e.target.value)} className="mt-1 rounded-lg border border-line-2 px-3 py-2 text-sm" />
          </div>
          {canWrite && (
            <>
              <div className="w-28">
                <label className="block text-xs font-medium text-fg-faint">Working days</label>
                <input value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-lg border border-line-2 px-3 py-2 text-sm" />
              </div>
              <button onClick={runPayroll} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {busy ? "Running…" : "Run payroll"}
              </button>
            </>
          )}
          {rows.length > 0 && (
            <span className="ml-auto text-sm text-fg-faint">
              Net total: <span className="font-semibold text-fg">{format(String(totalNet))}</span>
            </span>
          )}
        </div>
        {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
      </Card>

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                <th className="px-5 py-3 font-medium">Employee</th>
                <th className="px-5 py-3 text-right font-medium">Gross</th>
                <th className="px-5 py-3 text-right font-medium">Deductions</th>
                <th className="px-5 py-3 text-right font-medium">Net</th>
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
                rows.map((r) => (
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
