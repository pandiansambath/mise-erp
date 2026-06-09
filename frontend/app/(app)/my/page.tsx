"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type AttendanceRow,
  type DocRequest,
  type DocumentItem,
  type Employee,
  type PayrollRow,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { ROLE_LABELS } from "@/lib/permissions";

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Friendly download name: "Balaji - license.pdf" (sanitised, keeps extension). */
function docName(person: string, type: string, filename?: string): string {
  const ext = filename?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const t = type.replace(/_/g, " ").toLowerCase();
  return `${person} - ${t}${ext}`.replace(/[\\/:*?"<>|]/g, "");
}

const payTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "slate",
  APPROVED: "amber",
  PAID: "green",
};

export default function MySpacePage() {
  const { format } = useCurrency();
  const { user } = useAuth();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [payslips, setPayslips] = useState<PayrollRow[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);

  function reloadDocs() {
    api.get<DocumentItem[]>("/me/documents").then(setDocs).catch(() => {});
    api.get<DocRequest[]>("/me/document-requests").then(setRequests).catch(() => {});
  }

  function pickFile(requestId: string) {
    setUploadFor(requestId);
    fileRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadFor) return;
    const form = new FormData();
    form.append("file", file);
    try {
      await postForm(`/me/document-requests/${uploadFor}/upload`, form);
      reloadDocs();
    } catch {
      /* surfaced inline below via reload */
    } finally {
      e.target.value = "";
      setUploadFor(null);
    }
  }

  useEffect(() => {
    api
      .get<Employee>("/me/employee")
      .then(async (e) => {
        setEmp(e);
        await Promise.all([
          api.get<AttendanceRow[]>("/me/attendance").then(setAttendance).catch(() => {}),
          api.get<PayrollRow[]>("/me/payslips").then(setPayslips).catch(() => {}),
          api.get<DocumentItem[]>("/me/documents").then(setDocs).catch(() => {}),
          api.get<DocRequest[]>("/me/document-requests").then(setRequests).catch(() => {}),
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

  const pendingReqs = requests.filter((r) => r.status !== "APPROVED");

  return (
    <div>
      <input ref={fileRef} type="file" className="hidden" onChange={onFileChosen} />
      <PageHeader title={`Hi, ${emp.full_name.split(" ")[0]}`} subtitle="Your attendance, payslips and documents." />

      {pendingReqs.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <h3 className="font-semibold text-slate-900">📋 Requested from you</h3>
          <p className="mt-1 text-sm text-slate-500">Your manager has asked for these documents.</p>
          <ul className="mt-3 divide-y divide-amber-100">
            {pendingReqs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-slate-800">{r.title}</p>
                  <p className="text-xs text-slate-500">{r.doc_type.replace(/_/g, " ").toLowerCase()}</p>
                </div>
                {r.status === "UPLOADED" ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="amber">awaiting approval</Badge>
                    {r.document_id && (
                      <button
                        onClick={() => downloadFile(`/me/documents/${r.document_id}/download`, docName(emp.full_name, r.doc_type))}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50"
                      >
                        View
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => pickFile(r.id)}
                    className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Upload
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs uppercase text-slate-500">Code</p>
            <p className="font-semibold text-slate-900">{emp.employee_code}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Job title</p>
            <p className="font-semibold text-slate-900">{emp.job_title || "—"}</p>
          </div>
          <div>
            <p className="text-xs uppercase text-slate-500">Access</p>
            <p className="font-semibold text-slate-900">
              {user ? ROLE_LABELS[user.role] ?? user.role : "—"}
            </p>
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
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Expiry</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-slate-400">No documents shared with you yet.</td></tr>
              ) : docs.map((d) => {
                const req = requests.find((r) => r.document_id === d.id);
                return (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="px-5 py-2 font-medium text-slate-800">{d.title}</td>
                  <td className="px-5 py-2 text-slate-500">{d.doc_type.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="px-5 py-2">
                    {req?.status === "APPROVED" ? (
                      <Badge tone="green">approved ✓</Badge>
                    ) : req?.status === "UPLOADED" ? (
                      <Badge tone="amber">awaiting approval</Badge>
                    ) : (
                      <Badge tone="slate">shared</Badge>
                    )}
                  </td>
                  <td className="px-5 py-2 text-slate-500">{d.expiry_date || "—"}</td>
                  <td className="px-5 py-2 text-right">
                    <button onClick={() => downloadFile(`/me/documents/${d.id}/download`, docName(emp.full_name, d.doc_type, d.filename))} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">Download</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
