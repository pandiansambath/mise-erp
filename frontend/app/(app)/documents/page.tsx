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
import { SheetPopup } from "@/components/SheetPopup";
import { DocViewer } from "@/components/DocViewer";
import { DocComments } from "@/components/DocComments";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { TotalsStrip } from "@/components/PageKit";
import { PersonPicker } from "@/components/PersonPicker";
import { Select } from "@/components/Select";
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
  const [dropOver, setDropOver] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);

  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [expiring, setExpiring] = useState<ExpiringDoc[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  // Which request's notes are open. One at a time: two open threads on one
  // screen is two conversations you have to keep apart by eye.
  const [noteOn, setNoteOn] = useState<string | null>(null);
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
  // Frozen at mount. Reading the clock during render is impure — the same list
  // would draw differently on two renders with no state change, which is
  // exactly the kind of thing that makes a UI flicker for no visible reason.
  const [nowMs] = useState(() => Date.now());
  /** Which job you are doing. Three stacked cards meant scrolling past two
   *  of them to reach the third. */
  // TWO TABS, NOT THREE.
  //
  //   "you split as 3 parts — venue files, staff doc, upload. What's the venue
  //    file and upload? It's really confusing even for me, I'm the developer.
  //    It's confusing for me, then think about laymans."
  //
  // The cause is grammatical and it is worth naming: "Venue files" and "Staff
  // documents" are NOUNS — two kinds of thing you might be looking at. "Upload"
  // is a VERB. Putting an action in a row of categories asks the reader to sort
  // it out, and the honest answer to "what is the difference between Venue files
  // and Upload?" is that there isn't one; Upload puts a file INTO Venue files.
  //
  // So the tabs are two kinds of document, and uploading is a button where the
  // other actions are.
  const [tab, setTab] = useState<"venue" | "staff">("venue");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [viewing, setViewing] = useState<{ id: string; filename: string } | null>(null);

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
      setPicked(null);
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
    "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-500/25";

  return (
    <div>
      <PageHeader title="Documents" subtitle="Licences, contracts, insurance, bills — with expiry alerts." />
      <input ref={reqFileRef} type="file" className="hidden" onChange={onReqFileChosen} />

      {/* WHAT IS TRUE RIGHT NOW, before anything you might do about it. */}
      <TotalsStrip
        className="mb-4"
        items={[
          { label: "Venue files", value: String(docs.length) },
          {
            label: "Expiring soon",
            value: String(expiring.length),
            tone: expiring.length > 0 ? "warn" : "plain",
            hint: expiring.length > 0 ? "needs renewing" : "all current",
          },
          {
            label: "Waiting on staff",
            value: String(requests.filter((r) => r.status === "PENDING").length),
            tone: requests.some((r) => r.status === "PENDING") ? "warn" : "plain",
          },
          {
            label: "To approve",
            value: String(requests.filter((r) => r.status === "UPLOADED").length),
            tone: requests.some((r) => r.status === "UPLOADED") ? "good" : "plain",
            hint: "sent in, unread",
          },
        ]}
      />

      {/* TWO KINDS OF DOCUMENT, AND ONE ACTION BESIDE THEM.
          The venue list leads because checking what is about to expire is why
          anyone opens this page; adding one is occasional. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="tablist" className="mise-card-inset flex flex-1 gap-1 overflow-x-auto p-1.5">
        {([
          // Named for whose they are, which is the only difference that
          // matters: ours, or somebody's we asked for.
          ["venue", "\u{1f3e0} The restaurant's", docs.length],
          ["staff", "\u{1f9d1} Asked from staff", requests.length],
        ] as const).map(([key, label, count]) => {
          const on = tab === key;
          return (
            <button
              key={key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(key as "venue" | "staff")}
              className={`mise-press flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${
                on ? "bg-brand-600 text-white shadow-sm" : "text-fg-soft hover:text-fg"
              }`}
            >
              {label}
              {count !== undefined && count > 0 && (
                <span
                  className={`rounded-md px-1.5 py-px text-[10px] tabular-nums ${
                    on ? "bg-white/20 text-white" : "bg-fg/10 text-fg-faint"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
        </div>
        {canWrite && (
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            data-tone="brand"
            data-testid="doc-add"
            className="mise-btn-flat mise-press min-h-[48px] shrink-0 px-4 text-sm"
          >
            + Add a document
          </button>
        )}
      </div>

      {expiring.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
          <p className="text-sm font-semibold text-amber-200">⚠️ Expiring soon</p>
          <ul className="mt-1 text-sm text-amber-300">
            {expiring.map((d) => (
              <li key={d.id}>
                {d.title} — {d.days_left < 0 ? `expired ${-d.days_left}d ago` : `in ${d.days_left}d`} ({d.expiry_date})
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === "venue" && (
      <Card className="mise-fade-in p-0">
        <div className="border-b border-line px-5 pt-4">
          <h3 className="font-semibold text-fg">Restaurant documents</h3>
          <p className="mb-3 mt-0.5 text-xs text-fg-faint">
            {/* "above" was true until the list moved above the forms. A
                direction word is a fact about the layout, and it goes stale
                the moment the layout changes — so this one names the section
                instead of pointing at where it used to be. */}
            Your venue&apos;s own files — licences, insurance, contracts, bills. Staff
            documents live under <b>Request a document from staff</b>, not here.
          </p>
        </div>
        {(() => {
          const venue = docs.filter((d) => d.related_entity_type !== "EMPLOYEE");
          const types = [...new Set(venue.map((d) => d.doc_type))];
          if (types.length < 2) return null;
          return (
            <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
              <button type="button" onClick={() => setTypeFilter("all")} className={`mise-press rounded-full px-3 py-1 text-xs font-medium ${typeFilter === "all" ? "bg-brand-600 text-white" : "mise-raised text-fg-soft"}`}>
                All ({venue.length})
              </button>
              {types.map((t) => (
                <button key={t} type="button" onClick={() => setTypeFilter(t)} className={`mise-press rounded-full px-3 py-1 text-xs font-medium ${typeFilter === t ? "bg-brand-600 text-white" : "mise-raised text-fg-soft"}`}>
                  {typeLabel(t)} ({venue.filter((d) => d.doc_type === t).length})
                </button>
              ))}
            </div>
          );
        })()}
        {/* Cards, per /staff and /purchasing.
            A document is a THING with a deadline, not a row of five columns —
            and the deadline was the third of them, in the same grey as the
            file size. The stripe carries it: red once expired, amber inside
            thirty days, quiet when there is nothing to chase. Same rule as the
            visa stripe on Employees, because it is the same question. */}
        {(() => {
          const shown = docs.filter(
            (d) =>
              d.related_entity_type !== "EMPLOYEE" &&
              (typeFilter === "all" || d.doc_type === typeFilter),
          );
          if (shown.length === 0) {
            return (
              <p className="px-5 py-8 text-center text-fg-faint">
                No restaurant documents{typeFilter !== "all" ? " of this type" : " yet"}.
              </p>
            );
          }
          const daysTo = (iso?: string | null) => {
            if (!iso) return null;
            const t = new Date(`${iso}T00:00:00`).getTime();
            if (Number.isNaN(t)) return null;
            return Math.round((t - nowMs) / 86_400_000);
          };
          return (
            <div className="mise-stagger grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((d) => {
                const left = daysTo(d.expiry_date);
                const stripe =
                  left == null
                    ? "bg-fg-faint/25"
                    : left < 0
                      ? "bg-rose-400/80"
                      : left <= 30
                        ? "bg-amber-400/80"
                        : "bg-emerald-400/60";
                return (
                  <div
                    key={d.id}
                    className="mise-card-inset relative flex flex-col overflow-hidden p-3.5 pl-4"
                  >
                    <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${stripe}`} />
                    <span className="truncate font-display text-sm font-semibold text-fg">
                      {d.title}
                    </span>
                    <span className="mt-0.5 truncate text-[11px] text-fg-faint">
                      {typeLabel(d.doc_type)} · {fmtSize(d.file_size)}
                    </span>
                    <dl className="mt-2.5 border-t border-line/50 pt-2 text-[11px]">
                      <div className="flex items-baseline justify-between gap-2">
                        <dt className="text-fg-faint">Expires</dt>
                        <dd
                          className={
                            left == null
                              ? "text-fg-faint"
                              : left < 0
                                ? "font-medium text-rose-300"
                                : left <= 30
                                  ? "font-medium text-amber-300"
                                  : "text-fg-soft"
                          }
                        >
                          {d.expiry_date
                            ? left != null && left < 0
                              ? `expired ${d.expiry_date}`
                              : `${d.expiry_date}${left != null && left <= 30 ? ` · ${left}d` : ""}`
                            : "no expiry"}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-2.5 flex gap-1.5">
                      {/* OPEN COMES FIRST. "I have only download option" — and a
                          licence you must download, find in a folder and open in
                          another app is a licence nobody checks. Looking at it is
                          the common act; keeping a copy is the rare one. */}
                      <button
                        onClick={() => setViewing({ id: d.id, filename: d.filename })}
                        data-tone="brand"
                        data-testid="doc-open"
                        className="mise-btn-flat mise-press flex-1 rounded-md px-2 py-1.5 text-xs"
                      >
                        Open
                      </button>
                      <button
                        onClick={() => downloadFile(`/documents/${d.id}/download`, d.filename)}
                        className="mise-press rounded-md border border-line px-2 py-1.5 text-xs text-fg-soft hover:bg-paper-2"
                      >
                        ⬇
                      </button>
                      {canWrite && (
                        <button
                          onClick={() => remove(d.id)}
                          className="mise-press rounded-md border border-line px-2 py-1.5 text-xs text-fg-faint hover:bg-paper-2"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>
      )}

      {/* The forms come AFTER the documents.
          "never make the user scroll to reach what the page is FOR" — his own
          rule, and this page broke it plainly: two forms stood between the
          title and the list of licences the page exists to keep an eye on.
          Uploading is occasional; checking what is about to expire is why you
          open Documents at all. */}
      {viewing && (
        <DocViewer
          path={`/documents/${viewing.id}/download`}
          filename={viewing.filename}
          onClose={() => setViewing(null)}
          onDownload={() => downloadFile(`/documents/${viewing.id}/download`, viewing.filename)}
        />
      )}

      {uploadOpen && canWrite && (
        <SheetPopup
          columns={3}
          onClose={() => setUploadOpen(false)}
          title="Add a document"
          subtitle="A licence, insurance, a contract, a bill — the restaurant's own paperwork"
        >
          <form onSubmit={upload} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-fg-soft">File</label>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileRef.current?.click(); }}
                onDragOver={(e) => { e.preventDefault(); setDropOver(true); }}
                onDragLeave={() => setDropOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f && fileRef.current) {
                    const dt = new DataTransfer();
                    dt.items.add(f);
                    fileRef.current.files = dt.files;
                    setPicked(f.name);
                  }
                }}
                className={`mise-well mt-1 flex cursor-pointer items-center gap-3 rounded-xl px-4 py-3 text-sm outline-none transition-all duration-200 focus:ring-2 focus:ring-brand-500/25 ${
                  dropOver ? "ring-2 ring-brand-400/40" : ""
                }`}
              >
                {saving ? (
                  <span className="mise-upload-ring shrink-0" aria-label="Uploading" />
                ) : (
                  <span aria-hidden className="text-lg">{picked ? "📄" : "📎"}</span>
                )}
                <span className={`min-w-0 flex-1 truncate ${picked ? "text-fg" : "text-fg-faint"}`}>
                  {saving ? "Uploading…" : picked ?? (dropOver ? "Drop it here" : "Drop a file here, or tap to choose")}
                </span>
                {picked && !saving && <span className="text-xs text-brand-300">change</span>}
              </div>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => setPicked(e.target.files?.[0]?.name ?? null)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Type</label>
              <Select
                value={docType}
                onChange={setDocType}
                className="mt-1"
                options={TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Expiry (optional)</label>
              <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputCls} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-fg-soft">Title (optional)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="defaults to filename" className={inputCls} />
            </div>
            <div className="flex items-end sm:col-span-4">
              <button type="submit" disabled={saving} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {saving ? "Uploading…" : "Upload"}
              </button>
              {error && <span className="ml-3 text-sm text-rose-400">{error}</span>}
            </div>
          </form>
        </SheetPopup>
      )}

      {tab === "staff" && canWrite && (
        <Card className="mb-6">
          <p className="mb-1 text-sm font-medium text-fg-soft">Request a document from staff</p>
          <p className="mb-3 text-xs text-fg-faint">
            They&apos;ll see it in their <b>My Space</b> as pending, upload it, then you approve.
          </p>
          <form onSubmit={createRequest} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-sm font-medium text-fg-soft">Staff member</label>
              {/* SEARCH, AND THE CODE STAYS READABLE.
                  "pandian sambath is big name which hiding the emp id... we
                   need cool ui dropdown with search feature."
                  The native select put name and code on one line and truncated
                  to "pandian sambath (EMPO…", cutting off the one part that
                  tells two people apart. Two lines, and you type to narrow. */}
              <PersonPicker
                className="mt-1"
                testId="doc-staff-picker"
                value={reqEmpId}
                onChange={setReqEmpId}
                placeholder="Search staff…"
                people={employees.map((emp) => ({
                  id: emp.id,
                  name: emp.full_name,
                  code: emp.employee_code,
                  note: emp.job_title || undefined,
                }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-fg-soft">Type</label>
              <Select
                value={reqType}
                onChange={setReqType}
                className="mt-1"
                options={TYPES.map((t) => ({ value: t, label: typeLabel(t) }))}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-fg-soft">What to provide</label>
              <input value={reqTitle} onChange={(e) => setReqTitle(e.target.value)} placeholder="e.g. Passport, Right-to-work" className={inputCls} />
            </div>
            <div className="sm:col-span-4">
              <button type="submit" className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Request document
              </button>
            </div>
          </form>

          {requests.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                    <th className="px-3 py-2 font-medium">Staff</th>
                    <th className="px-3 py-2 font-medium">Document</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="border-b border-line">
                      <td className="px-3 py-2 text-fg-soft">{r.employee_name}</td>
                      <td className="px-3 py-2 font-medium text-fg">{r.title}</td>
                      <td className="px-3 py-2">
                        <Badge tone={r.status === "APPROVED" ? "green" : r.status === "UPLOADED" ? "amber" : "slate"}>
                          {r.status.toLowerCase()}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end gap-1">
                          {r.document_id && (
                            <button onClick={() => downloadFile(`/documents/${r.document_id}/download`, docName(r.employee_name, r.doc_type, docs.find((x) => x.id === r.document_id)?.filename))} className="rounded-md border border-line px-2 py-1 text-xs text-brand-300 hover:bg-brand-400/10">View</button>
                          )}
                          {r.status === "PENDING" && (
                            <button onClick={() => pickReqFile(r.id)} className="rounded-md border border-line px-2 py-1 text-xs text-fg-soft hover:bg-paper-2" title="Upload this document for the staff member">Upload for them</button>
                          )}
                          {r.status === "UPLOADED" && (
                            <button onClick={() => approveRequest(r.id)} className="rounded-md border border-brand-400/30 bg-brand-400/10 px-2 py-1 text-xs font-medium text-brand-300">Approve</button>
                          )}
                          <button
                            type="button"
                            onClick={() => setNoteOn((n) => (n === r.id ? null : r.id))}
                            data-testid="doc-notes"
                            className="rounded-md border border-line px-2 py-1 text-xs text-fg-soft hover:bg-paper-2"
                            title="Notes about this document"
                          >
                            💬 Notes
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {/* The owner's end of the same thread. Kept as a row that
                      opens rather than a popup, so the note sits under the
                      document it is about — which is the entire point of
                      these not being chat messages. */}
                  {requests
                    .filter((r) => r.id === noteOn)
                    .map((r) => (
                      <tr key={`${r.id}-notes`} className="border-b border-line">
                        <td colSpan={4} className="px-3 py-3">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-faint">
                            Notes · {r.employee_name} · {r.title}
                          </p>
                          <DocComments requestId={r.id} mine="owner" />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
