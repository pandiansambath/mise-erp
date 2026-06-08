"use client";

import { useEffect, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  type AttendanceRow,
  type DocumentItem,
  type Employee,
  type PayrollRow,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useCurrency } from "@/lib/currency";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const payTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "slate",
  APPROVED: "amber",
  PAID: "green",
};

export default function MySpacePage() {
  const { format } = useCurrency();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [payslips, setPayslips] = useState<PayrollRow[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);

  useEffect(() => {
    api
      .get<Employee>("/me/employee")
      .then(async (e) => {
        setEmp(e);
        await Promise.all([
          api.get<AttendanceRow[]>("/me/attendance").then(setAttendance).catch(() => {}),
          api.get<PayrollRow[]>("/me/payslips").then(setPayslips).catch(() => {}),
          api.get<DocumentItem[]>("/me/documents").then(setDocs).catch(() => {}),
        ]);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setNotLinked(true);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  if (notLinked || !emp) {
    return (
      <div>
        <PageHeader title="My Space" subtitle="Your attendance, payslips and documents." />
        <Card>
          <p className="py-6 text-center text-sm text-slate-500">
            Your login isn&apos;t linked to an employee record yet. Ask your manager to link it
            (Staff → Add member → pick your name).
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={`Hi, ${emp.full_name.split(" ")[0]}`} subtitle="Your attendance, payslips and documents." />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Code</p>
            <p className="font-semibold text-slate-900">{emp.employee_code}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Role</p>
            <p className="font-semibold text-slate-900">{emp.job_title || "Staff"}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Pay</p>
            <p className="font-semibold text-slate-900">
              {emp.salary_type === "HOURLY"
                ? `${emp.hourly_rate ? format(emp.hourly_rate) : "—"}/hr`
                : `${emp.monthly_salary ? format(emp.monthly_salary) : "—"}/mo`}
            </p>
          </div>
          {emp.visa_expiry_date && (
            <div>
              <p className="text-xs uppercase text-slate-500">Visa expiry</p>
              <p className="font-semibold text-slate-900">{emp.visa_expiry_date}</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-slate-900">My payslips</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-5 py-2 font-medium">Period</th>
                  <th className="px-5 py-2 text-right font-medium">Net pay</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {payslips.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">No payslips yet.</td></tr>
                ) : payslips.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="px-5 py-2 font-medium text-slate-800">{p.pay_period}</td>
                    <td className="px-5 py-2 text-right text-slate-700">{format(p.net_pay)}</td>
                    <td className="px-5 py-2"><Badge tone={payTone[p.status] ?? "slate"}>{p.status}</Badge></td>
                    <td className="px-5 py-2 text-right">
                      <button onClick={() => downloadFile(`/me/payslips/${p.id}.pdf`, `payslip-${p.pay_period}.pdf`)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">PDF</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="p-0">
          <h3 className="px-5 pt-4 font-semibold text-slate-900">Recent attendance</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">In</th>
                  <th className="px-5 py-2 font-medium">Out</th>
                  <th className="px-5 py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {attendance.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-slate-400">No attendance recorded.</td></tr>
                ) : attendance.map((a) => (
                  <tr key={a.date} className="border-b border-slate-100">
                    <td className="px-5 py-2 text-slate-600">{a.date}</td>
                    <td className="px-5 py-2 text-slate-600">{fmtTime(a.clock_in)}</td>
                    <td className="px-5 py-2 text-slate-600">{fmtTime(a.clock_out)}</td>
                    <td className="px-5 py-2 text-right text-slate-700">{a.working_hours ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Card className="mt-6 p-0">
        <h3 className="px-5 pt-4 font-semibold text-slate-900">My documents</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-2 font-medium">Title</th>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 font-medium">Expiry</th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={3} className="px-5 py-6 text-center text-slate-400">No documents shared with you yet.</td></tr>
              ) : docs.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="px-5 py-2 font-medium text-slate-800">{d.title}</td>
                  <td className="px-5 py-2 text-slate-500">{d.doc_type.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="px-5 py-2 text-slate-500">{d.expiry_date || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
