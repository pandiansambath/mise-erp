"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Employee, type VisaAlert } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Donut } from "@/components/charts";
import { Select } from "@/components/Select";
import { SortTh, useSort } from "@/components/sortable";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { can } from "@/lib/permissions";
import { numeric } from "@/lib/sanitize";
import { spotlight, useDeepLink } from "@/components/fx";

const EMPTY = {
  full_name: "",
  job_title: "",
  salary_type: "MONTHLY",
  monthly_salary: "",
  hourly_rate: "",
  pay_day: "",
  pay_weekday: "",
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
  const sort = useSort<"code" | "name" | "title" | "pay">("name");
  const [alerts, setAlerts] = useState<VisaAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ⌘K "Add an employee" (?new=1) → spotlight the add form
  useDeepLink({ new: () => spotlight("employee-form") }, !loading);

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
      pay_day: e.pay_day != null ? String(e.pay_day) : "",
      pay_weekday: e.pay_weekday != null ? String(e.pay_weekday) : "",
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

  const sortedEmployees = sort.sortRows(employees, (e, k) =>
    k === "code"
      ? e.employee_code
      : k === "name"
        ? e.full_name
        : k === "title"
          ? e.job_title || ""
          : parseFloat((e.salary_type === "MONTHLY" ? e.monthly_salary : e.hourly_rate) || "0"),
  );

  if (loading) return <Spinner />;

  const inputCls =
    "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-brand-500/30";

  return (
    <div>
      <PageHeader title="Employees" subtitle="Your team, pay details, and UK compliance." />

      {alerts.length > 0 && (
        <Card className="mise-feel mb-6 border-amber-400/30">
          <p className="text-sm font-semibold text-amber-200">⚠️ Visa runway — who needs action, and when</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "Expired", test: (d: number) => d < 0, tone: "border-rose-500/40 text-rose-300" },
              { label: "≤ 30 days", test: (d: number) => d >= 0 && d <= 30, tone: "border-amber-400/40 text-amber-300" },
              { label: "31–60 days", test: (d: number) => d > 30 && d <= 60, tone: "border-amber-400/25 text-amber-200" },
              { label: "61–90 days", test: (d: number) => d > 60, tone: "border-line text-fg-soft" },
            ].map((bucket) => {
              const people = alerts.filter((a) => bucket.test(a.days_left));
              return (
                <div key={bucket.label} className={`mise-well rounded-xl border p-3 ${bucket.tone}`}>
                  <p className="text-[11px] font-semibold uppercase tracking-wide">{bucket.label}</p>
                  {people.length === 0 ? (
                    <p className="mt-1 text-xs opacity-60">nobody 🎉</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1">
                      {people.map((a) => (
                        <li key={a.employee_id} className="truncate text-xs" title={`${a.full_name} · ${a.visa_expiry_date}`}>
                          {a.full_name}
                          <span className="ml-1 opacity-70">
                            {a.days_left < 0 ? `${-a.days_left}d ago` : `${a.days_left}d`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {canWrite && (
        <Card className="mb-6" id="employee-form">
          <p className="mb-3 text-sm font-medium text-fg-soft">
            {editingId ? "Edit employee" : "Add employee"}
          </p>
          <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-fg-soft">Full name</label>
              <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Job title</label>
              <input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Chef, Cashier…" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Salary type</label>
              <Select
                value={form.salary_type}
                onChange={(v) => setForm({ ...form, salary_type: v })}
                className="mt-1"
                options={[
                  { value: "MONTHLY", label: "Monthly" },
                  { value: "HOURLY", label: "Hourly" },
                ]}
              />
            </div>
            {form.salary_type === "MONTHLY" ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Monthly salary</label>
                  <input value={form.monthly_salary} onChange={(e) => setForm({ ...form, monthly_salary: numeric(e.target.value) })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Usually paid on</label>
                  <Select
                    className="mt-1"
                    value={form.pay_day}
                    onChange={(v) => setForm({ ...form, pay_day: v })}
                    options={[{ value: "", label: "— (month end)" }, ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `the ${i + 1}${[1, 21].includes(i + 1) ? "st" : [2, 22].includes(i + 1) ? "nd" : [3, 23].includes(i + 1) ? "rd" : "th"}` }))]}
                  />
                  <p className="mt-1 text-[11px] text-fg-faint">their personal pay date — shown on payroll</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Hourly rate</label>
                  <input value={form.hourly_rate} onChange={(e) => setForm({ ...form, hourly_rate: numeric(e.target.value) })} inputMode="decimal" className={inputCls} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-fg-soft">Usually paid every</label>
                  <Select
                    className="mt-1"
                    value={form.pay_weekday}
                    onChange={(v) => setForm({ ...form, pay_weekday: v })}
                    options={[{ value: "", label: "— (any day)" }, ...["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d, i) => ({ value: String(i), label: d }))]}
                  />
                  <p className="mt-1 text-[11px] text-fg-faint">weekly-paid staff can be paid on ANY weekday — even Sunday</p>
                </div>
              </>
            )}
            <div>
              <label className="block text-sm font-medium text-fg-soft">Mobile</label>
              <input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">NI number</label>
              <input value={form.ni_number} onChange={(e) => setForm({ ...form, ni_number: e.target.value })} placeholder="QQ123456C" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Visa expiry</label>
              <input type="date" value={form.visa_expiry_date} onChange={(e) => setForm({ ...form, visa_expiry_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Sort code</label>
              <input value={form.bank_sort_code} onChange={(e) => setForm({ ...form, bank_sort_code: e.target.value })} placeholder="00-00-00" className={inputCls} />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Account no.</label>
              <input value={form.bank_account_no} onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })} className={inputCls} />
            </div>
            <div className="flex items-end gap-2 sm:col-span-3">
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? "Saving…" : editingId ? "Save changes" : "Add employee"}
              </button>
              {editingId && (
                <button type="button" onClick={reset} className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft">
                  Cancel
                </button>
              )}
              {error && <span className="text-sm text-rose-400">{error}</span>}
            </div>
          </form>
        </Card>
      )}

      {employees.length > 1 && (
        <Card className="mise-feel mb-6">
          <h3 className="font-semibold text-fg">How the team is paid</h3>
          <p className="text-xs text-fg-faint">hourly staff go on WEEKLY payroll runs; salaried on monthly</p>
          <div className="mt-4">
            <Donut
              centerLabel="people"
              centerValue={String(employees.length)}
              segments={[
                { label: "Hourly (weekly-paid)", value: employees.filter((e) => e.salary_type === "HOURLY").length, color: "#38bdf8" },
                { label: "Monthly salary", value: employees.filter((e) => e.salary_type === "MONTHLY").length, color: "#10b981" },
              ].filter((s) => s.value > 0)}
            />
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase text-fg-faint">
                <SortTh k="code" label="Code" sort={sort} />
                <SortTh k="name" label="Name" sort={sort} />
                <SortTh k="title" label="Job title" sort={sort} />
                <SortTh k="pay" label="Pay" sort={sort} right />
                <th className="px-5 py-3 font-medium">Visa</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {employees.length === 0 ? (
                <tr><td colSpan={6} className="px-5 py-8 text-center text-fg-faint">No employees yet.</td></tr>
              ) : (
                sortedEmployees.map((e) => {
                  const alert = alerts.find((a) => a.employee_id === e.id);
                  return (
                    <tr key={e.id} className="border-b border-line">
                      <td className="px-5 py-3 text-fg-faint">{e.employee_code}</td>
                      <td className="px-5 py-3 font-medium text-fg">
                        <span aria-hidden className="mise-raised mr-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold uppercase text-brand-300">
                          {e.full_name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}
                        </span>
                        {e.full_name}
                      </td>
                      <td className="px-5 py-3 text-fg-faint">{e.job_title || "—"}</td>
                      <td className="px-5 py-3 text-right text-fg-soft">
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
                            <span className="text-fg-faint">{e.visa_expiry_date}</span>
                          )
                        ) : (
                          <span className="text-fg-faint">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {canWrite && (
                          <button onClick={() => startEdit(e)} className="rounded-md border border-line px-2.5 py-1 text-xs font-medium text-fg-soft hover:bg-paper-2">
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
