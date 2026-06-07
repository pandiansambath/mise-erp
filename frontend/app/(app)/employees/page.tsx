"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Employee, type VisaAlert } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";

const EMPTY = {
  full_name: "",
  job_title: "",
  salary_type: "MONTHLY",
  monthly_salary: "",
  hourly_rate: "",
  mobile: "",
  ni_number: "",
  visa_expiry_date: "",
  bank_sort_code: "",
  bank_account_no: "",
  joining_date: "",
};

function visaTone(days: number): "red" | "amber" {
  return days <= 7 ? "red" : "amber";
}

export default function EmployeesPage() {
  const { user } = useAuth();
  const { format } = useCurrency();
  const canWrite = can(user?.role, "employees:write");

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [alerts, setAlerts] = useState<VisaAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    return Promise.all([
      api.get<Employee[]>("/employees").then(setEmployees),
      api.get<VisaAlert[]>("/employees/visa-alerts?within_days=60").then(setAlerts).catch(() => {}),
    ]);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  function startEdit(e: Employee) {
    setEditingId(e.id);
    setForm({
      full_name: e.full_name,
      job_title: e.job_title ?? "",
      salary_type: e.salary_type,
      monthly_salary: e.monthly_salary ?? "",
      hourly_rate: e.hourly_rate ?? "",
      mobile: e.mobile ?? "",
      ni_number: e.ni_number ?? "",
      visa_expiry_date: e.visa_expiry_date ?? "",
      bank_sort_code: e.bank_sort_code ?? "",
      bank_account_no: e.bank_account_no ?? "",
      joining_date: e.joining_date ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function reset() {
    setEditingId(null);
    setForm(EMPTY);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload: Record<string, unknown> = { ...form };
    Object.keys(payload).forEach((k) => payload[k] === "" && delete payload[k]);
    try {
      if (editingId) await api.patch(`/employees/${editingId}`, payload);
      else await api.post("/employees", payload);
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save employee");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <PageHeader title="Employees" subtitle="Your team, pay details, and UK compliance." />

      {alerts.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">⚠️ Visa expiry alerts</p>
          <ul className="mt-1 text-sm text-amber-700">
            {alerts.map((a) => (
              <li key={a.employee_id}>
                {a.full_name} — visa {a.days_left < 0 ? `expired ${-a.days_left}d ago` : `expires in ${a.days_left}d`} ({a.visa_expiry_date})
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-slate-700">
            {editingId ? "Edit employee" : "Add employee"}
          </p>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Full name</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Job title</label>
              <input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Chef, Cashier…" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Salary type</label>
              <select value={form.salary_type} onChange={(e) => setForm({ ...form, salary_type: e.target.value })} className={inputCls}>
                <option value="MONTHLY">Monthly</option>
                <option value="HOURLY">Hourly</option>
              </select>
            </div>
            {form.salary_type === "MONTHLY" ? (
              <div>
                <label className="block text-sm font-medium text-slate-700">Monthly salary</label>
                <input value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: e.target.value })} inputMode="decimal" className={inputCls} />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-slate-700">Hourly rate</label>
                <input value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: e.target.value })} inputMode="decimal" className={inputCls} />
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700">Mobile</label>
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">NI number</label>
              <input value={form.ni_number} onChange={(e) => setForm({ ...form, ni_number: e.target.value })} placeholder="QQ123456C" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Visa expiry</label>
              <input type="date" value={form.visa_expiry_date} onChange={(e) => setForm({ ...form, visa_expiry_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Sort code</label>
              <input value={form.bank_sort_code} onChange={(e) => setForm({ ...form, bank_sort_code: e.target.value })} placeholder="00-00-00" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Account no.</label>
              <input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} className={inputCls} />
            </div>
            <div className="flex items-end gap-2 sm:col-span-3">
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Save changes" : "Add employee"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
              )}
              {error && <span className="text-sm text-rose-600">{error}</span>}
            </div>
          </form>
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-medium">Code</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Role</th>
                <th className="px-5 py-3 text-right font-medium">Pay</th>
                <th className="px-5 py-3 font-medium">Visa</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-400">No employees yet.</td></tr>
              ) : (
                employees.map((e) => {
                  const alert = alerts.find((a) => a.employee_id === e.id);
                  return (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-5 py-3 text-slate-500">{e.employee_code}</td>
                      <td className="px-5 py-3 font-medium text-slate-800">{e.full_name}</td>
                      <td className="px-5 py-3 text-slate-500">{e.job_title || "—"}</td>
                      <td className="px-5 py-3 text-right text-slate-700">
                        {e.salary_type === "MONTHLY"
                          ? e.monthly_salary ? `${format(e.monthly_salary)}/mo` : "—"
                          : e.hourly_rate ? `${format(e.hourly_rate)}/hr` : "—"}
                      </td>
                      <td className="px-5 py-3">
                        {e.visa_expiry_date ? (
                          alert ? (
                            <Badge tone={visaTone(alert.days_left)}>
                              {alert.days_left < 0 ? "Expired" : `${alert.days_left}d`}
                            </Badge>
                          ) : (
                            <span className="text-slate-400">{e.visa_expiry_date}</span>
                          )
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canWrite && (
                          <button onClick={() => startEdit(e)} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50">
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
