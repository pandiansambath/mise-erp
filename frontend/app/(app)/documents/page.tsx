"use client";

import { useEffect, useRef, useState } from "react";
import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type DocumentItem,
  type ExpiringDoc,
} from "@/lib/api";
import { Card, PageHeader, Spinner } from "@/components/ui";
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

export default function DocumentsPage() {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canWrite = can(user?.role, "documents:write");
  const fileRef = useRef<HTMLInputElement>(null);

  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [docType, setDocType] = useState("LICENSE");
  const [expiry, setExpiry] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function load() {
    return Promise.all([
      api.get<DocumentItem[]>("/documents").then(setDocs),
      api.get<ExpiringDoc[]>("/documents/expiring?within_days=60").then(setExpiring).catch(() => {}),
    ]);
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

      <Card className="p-0">
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
              {docs.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-8 text-center text-slate-400">No documents yet.</td></tr>
              ) : docs.map((d) => (
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
