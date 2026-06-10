"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type DocRequest,
  type DocumentItem,
  type Employee,
  type ExpiringDoc,
} from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const TYPES = ["LICENSE", "INSURANCE", "VENDOR_CONTRACT", "EMPLOYEE_DOC", "UTILITY_BILL", "OTHER"];
const typeLabel = (t: string) => t.replace(/_/g, " ").toLowerCase();

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Friendly download name: "Balaji - license.pdf" (sanitised, keeps extension). */
function docName(person: string, type: string, filename?: string): string {
  const ext = filename?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const t = type.replace(/_/g, " ").toLowerCase();
  return `${person} - ${t}${ext}`.replace(/[\\/:*?"<>|]/g, "");
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "documents:write");
  const fileRef = useRef<HTMLInputElement>(null);
  const reqFileRef = useRef<HTMLInputElement>(null);
  const [uploadForReq, setUploadForReq] = useState<string | null>(null);

  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("LICENSE");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // request-a-document form
  const [reqEmpId, setReqEmpId] = useState("");
  const [reqType, setReqType] = useState("EMPLOYEE_DOC");
  const [reqTitle, setReqTitle] = useState("");

  function load() {
    return Promise.all([
      api.get<DocumentItem[]>("/documents").then(setDocs),
      api.get<ExpiringDoc[]>("/documents/expiring?within_days=60").then(setExpiring).catch(() => {}),
      api.get<Employee[]>("/employees").then(setEmployees).catch(() => {}),
      api.get<DocRequest[]>("/documents/requests").then(setRequests).catch(() => {}),
    ]);
  }

  async function createRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!reqEmpId || !reqTitle.trim()) {
      setError("Pick a staff member and a document title.");
      return;
    }
    setError(null);
    try {
      await api.post("/documents/requests", {
        employee_id: reqEmpId,
        doc_type: reqType,
        title: reqTitle.trim(),
      });
      setReqTitle("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create request");
    }
  }

  function pickReqFile(id: string) {
    setUploadForReq(id);
    reqFileRef.current?.click();
  }

  async function onReqFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !uploadForReq) return;
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await postForm(`/documents/requests/${uploadForReq}/upload`, form);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      e.target.value = "";
      setUploadForReq(null);
    }
  }

  async function approveRequest(id: string) {
    const ok = await confirm({
      title: "Approve this document?",
      message: "Mark the uploaded document as approved.",
      confirmText: "Approve",
    });
    if (!ok) return;
    try {
      await api.post(`/documents/requests/${id}/approve`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve");
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, []);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first");
      return;
    }
    setSaving(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    form.append("doc_type", docType);
    if (title) form.append("title", title);
    if (expiry) form.append("expiry_date", expiry);
    try {
      await postForm("/documents", form);
      setTitle("");
      setExpiry("");
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const ok = await confirm({
      title: "Delete document?",
      message: "This permanently removes the file. This can't be undone.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    setError(null);
    try {
      await api.delete(`/documents/${id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
    }
  }

  if (loading) return <Spinner />;

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

  return (
    <div>
      <PageHeader title="Documents" subtitle="Licences, contracts, insurance, bills — with expiry alerts." />
      <input ref={reqFileRef} type="file" className="hidden" onChange={onReqFileChosen} />

      {expiring.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-800">⚠️ Expiring soon</p>
          <ul className="mt-1 text-sm text-amber-700">
            {expiring.map((d) => (
              <li key={d.id}>
                {d.title} — {d.days_left < 0 ? `expired ${-d.days_left}d ago` : `in ${d.days_left}d`} ({d.expiry_date})
              </li>
            ))}
          </ul>
        </div>
      )}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-3 text-sm font-medium text-slate-700">Upload a document</p>
          <form onSubmit={upload} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">File</label>
              <input ref={fileRef} type="file" className="mt-1 w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Type</label>
              <select value={docType} onChange={(e) => setDocType(e.target.value)} className={inputCls}>
                {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Expiry (optional)</label>
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Title (optional)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="defaults to filename" className={inputCls} />
            </div>
            <div className="flex items-end sm:col-span-4">
              <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? "Uploading…" : "Upload"}
              </button>
              {error && <span className="ml-3 text-sm text-rose-600">{error}</span>}
            </div>
          </form>
        </Card>
      )}

      {canWrite && (
        <Card className="mb-6">
          <p className="mb-1 text-sm font-medium text-slate-700">Request a document from staff</p>
          <p className="mb-3 text-xs text-slate-400">
            They&apos;ll see it in their <b>My Space</b> as pending, upload it, then you approve.
          </p>
          <form onSubmit={createRequest} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-slate-700">Staff member</label>
              <select value={reqEmpId} onChange={(e) => setReqEmpId(e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Type</label>
              <select value={reqType} onChange={(e) => setReqType(e.target.value)} className={inputCls}>
                {TYPES.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">What to provide</label>
              <input value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="e.g. Passport, Right-to-work" className={inputCls} />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Request document
              </button>
            </div>
          </form>

          {requests.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="px-3 py-2 font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100">
                      <td className="px-3 py-2 text-slate-700">{r.employee_name}</td>
                      <td className="px-3 py-2 font-medium text-slate-800">{r.title}</td>
                      <td className="px-3 py-2">
                        <Badge tone={r.status === "APPROVED" ? "green" : r.status === "UPLOADED" ? "amber" : "slate"}>
                          {r.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.document_id && (
                            <button onClick={() => downloadFile(`/documents/${r.document_id}/download`, docName(r.employee_name, r.doc_type, docs.find((x) => x.id === r.document_id)?.filename))} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">View</button>
                          )}
                          {r.status === "PENDING" && (
                            <button onClick={() => pickReqFile(r.id)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50" title="Upload this document for the staff member">Upload for them</button>
                          )}
                          {r.status === "UPLOADED" && (
                            <button onClick={() => approveRequest(r.id)} className="rounded-md border border-brand-200 bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">Approve</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card className="p-0">
        <div className="border-b border-slate-100 px-5 pt-4">
          <h3 className="font-semibold text-slate-900">Restaurant documents</h3>
          <p className="mb-3 mt-0.5 text-xs text-slate-400">
            Your venue&apos;s own files — licences, insurance, contracts, bills. Staff documents live under their request above, not here.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="px-5 py-3 font-medium">Title</th>
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Expiry</th>
                <th className="px-5 py-3 text-right font-medium">Size</th>
                <th className="px-5 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {docs.filter((d) => d.related_entity_type !== "EMPLOYEE").length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No restaurant documents yet.</td></tr>
              ) : docs.filter((d) => d.related_entity_type !== "EMPLOYEE").map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="px-5 py-3 font-medium text-slate-800">{d.title}</td>
                  <td className="px-5 py-3 text-slate-500">{typeLabel(d.doc_type)}</td>
                  <td className="px-5 py-3 text-slate-500">{d.expiry_date || "—"}</td>
                  <td className="px-5 py-3 text-right text-slate-400">{fmtSize(d.file_size)}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex justify-end gap-1">
                      <button onClick={() => downloadFile(`/documents/${d.id}/download`, d.filename)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-brand-700 hover:bg-brand-50">Download</button>
                      {canWrite && (
                        <button onClick={() => remove(d.id)} className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:bg-slate-50">Delete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
