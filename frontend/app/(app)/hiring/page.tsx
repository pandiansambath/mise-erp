"use client";

// Hiring — post vacancies to the public Mise job board (/careers) and work
// the applicant pipeline: NEW → SHORTLISTED → INTERVIEWED → HIRED/REJECTED,
// with one-tap resume downloads.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, downloadFile } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Select } from "@/components/Select";
import { useConfirm } from "@/components/confirm";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

type Posting = {
  id: string;
  title: string;
  department: string | null;
  employment_type: string;
  salary_text: string | null;
  location: string | null;
  description: string;
  status: string;
  closes_on: string | null;
  created_at: string;
  applications: number;
  new_applications: number;
};
type Application = {
  id: string;
  posting_id: string;
  applicant_name: string;
  email: string;
  phone: string | null;
  cover_note: string | null;
  resume_filename: string | null;
  status: string;
  created_at: string;
};

const TYPES = [
  { value: "FULL_TIME", label: "Full-time" },
  { value: "PART_TIME", label: "Part-time" },
  { value: "CASUAL", label: "Casual" },
  { value: "APPRENTICESHIP", label: "Apprenticeship" },
];
const STAGES = ["NEW", "SHORTLISTED", "INTERVIEWED", "HIRED", "REJECTED"] as const;
const STAGE_TONE: Record<string, "slate" | "amber" | "green" | "red"> = {
  NEW: "slate",
  SHORTLISTED: "amber",
  INTERVIEWED: "amber",
  HIRED: "green",
  REJECTED: "red",
};

const inputCls =
  "mise-well mt-1 w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow focus:ring-2 focus:ring-brand-500/30";

export default function HiringPage() {
  const { user } = useAuth();
  const canWrite = can(user?.role, "employees:write");
  const confirm = useConfirm();

  const [postings, setPostings] = useState<Posting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [empType, setEmpType] = useState("FULL_TIME");
  const [salary, setSalary] = useState("");
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [closesOn, setClosesOn] = useState("");

  // pipeline
  const [openId, setOpenId] = useState<string | null>(null);
  const [apps, setApps] = useState<Record<string, Application[]>>({});
  const [appsBusy, setAppsBusy] = useState(false);

  const reload = useCallback(
    () => api.get<Posting[]>("/jobs").then(setPostings),
    [],
  );
  useEffect(() => {
    reload()
      .catch(() => setError("Could not load your postings."))
      .finally(() => setLoading(false));
  }, [reload]);

  async function createPosting(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/jobs", {
        title,
        department: department || null,
        employment_type: empType,
        salary_text: salary || null,
        location: location || null,
        description,
        closes_on: closesOn || null,
      });
      setTitle(""); setDepartment(""); setSalary(""); setLocation(""); setDescription(""); setClosesOn("");
      setShowForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post the vacancy");
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(p: Posting) {
    const next = p.status === "OPEN" ? "CLOSED" : "OPEN";
    await api.patch(`/jobs/${p.id}`, { status: next }).catch(() => {});
    await reload();
  }

  async function removePosting(p: Posting) {
    const ok = await confirm({
      title: `Delete “${p.title}”?`,
      message:
        p.applications > 0
          ? `This permanently removes the posting AND its ${p.applications} application${p.applications === 1 ? "" : "s"} (incl. resumes).`
          : "This permanently removes the posting from the public board.",
      confirmText: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await api.delete(`/jobs/${p.id}`).catch(() => {});
    setOpenId((cur) => (cur === p.id ? null : cur));
    await reload();
  }

  async function openPipeline(p: Posting) {
    if (openId === p.id) {
      setOpenId(null);
      return;
    }
    setOpenId(p.id);
    if (!apps[p.id]) {
      setAppsBusy(true);
      try {
        const rows = await api.get<Application[]>(`/jobs/${p.id}/applications`);
        setApps((m) => ({ ...m, [p.id]: rows }));
      } catch {
        /* row shows empty state */
      } finally {
        setAppsBusy(false);
      }
    }
  }

  async function moveStage(a: Application, status: string) {
    const updated = await api
      .patch<Application>(`/jobs/applications/${a.id}`, { status })
      .catch(() => null);
    if (updated) {
      setApps((m) => ({
        ...m,
        [a.posting_id]: (m[a.posting_id] ?? []).map((x) => (x.id === a.id ? updated : x)),
      }));
      reload().catch(() => {});
    }
  }

  if (loading) return <Spinner />;

  const open = postings.filter((p) => p.status === "OPEN");
  const totalNew = postings.reduce((t, p) => t + p.new_applications, 0);

  return (
    <div>
      <PageHeader
        title="Hiring"
        subtitle="Post vacancies to the public Mise job board and run your applicant pipeline."
      />

      {/* vitals + the public-board link */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "open roles", value: String(open.length), cls: "text-fg" },
          { label: "total applicants", value: String(postings.reduce((t, p) => t + p.applications, 0)), cls: "text-fg" },
          { label: "waiting for review", value: String(totalNew), cls: totalNew ? "text-amber-300" : "text-fg-faint" },
        ].map((k) => (
          <div key={k.label} className="mise-well mise-feel rounded-2xl p-3.5">
            <p className={`font-mono text-2xl font-bold ${k.cls}`}>{k.value}</p>
            <p className="mt-0.5 text-[11px] text-fg-faint">{k.label}</p>
          </div>
        ))}
        <a
          href="/careers"
          target="_blank"
          rel="noreferrer"
          className="mise-raised mise-press flex flex-col justify-center rounded-2xl p-3.5"
        >
          <p className="text-sm font-semibold text-brand-400">View the public board →</p>
          <p className="mt-0.5 text-[11px] text-fg-faint">what applicants see, live</p>
        </a>
      </div>

      {error && <p className="mb-4 rounded-lg bg-rose-400/10 px-3 py-2 text-sm text-rose-300">{error}</p>}

      {canWrite && (
        <div className="mb-6">
          {!showForm ? (
            <button
              onClick={() => setShowForm(true)}
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
            >
              + Post a vacancy
            </button>
          ) : (
            <Card className="mise-pop">
              <p className="mb-3 text-sm font-medium text-fg-soft">New vacancy — goes live on the board the moment you post it</p>
              <form onSubmit={createPosting} className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block sm:col-span-2">
                    <span className="text-xs font-medium text-fg-faint">Role title *</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} placeholder="e.g. Tandoor Chef" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-fg-faint">Type</span>
                    <div className="mt-1">
                      <Select value={empType} onChange={setEmpType} options={TYPES} className="w-full" />
                    </div>
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-fg-faint">Department</span>
                    <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Kitchen, Floor…" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-fg-faint">Pay (shown publicly)</span>
                    <input value={salary} onChange={(e) => setSalary(e.target.value)} placeholder="£13.50/hr · £28k…" className={inputCls} />
                  </label>
                  <label className="block">
                    <span className="text-xs font-medium text-fg-faint">Location</span>
                    <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="defaults to your city" className={inputCls} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs font-medium text-fg-faint">About the role</span>
                  <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} placeholder="Shifts, the kitchen, what a great candidate looks like…" className={`${inputCls} resize-none`} />
                </label>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className="text-xs font-medium text-fg-faint">Auto-close on (optional)</span>
                    <input type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} className={inputCls} />
                  </label>
                  <button type="submit" disabled={saving} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                    {saving ? "Posting…" : "🚀 Post to the board"}
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="mise-raised mise-press rounded-lg px-4 py-2 text-sm font-medium text-fg-soft">
                    Cancel
                  </button>
                </div>
              </form>
            </Card>
          )}
        </div>
      )}

      {postings.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-fg-faint">
            No vacancies yet. {canWrite ? "Post one — it appears on the public board instantly." : ""}
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {postings.map((p) => (
            <Card key={p.id} className={`mise-feel p-0 ${p.status === "CLOSED" ? "opacity-70" : ""}`}>
              <button
                type="button"
                onClick={() => openPipeline(p)}
                aria-expanded={openId === p.id}
                className="flex w-full flex-wrap items-center gap-3 px-5 py-4 text-left"
              >
                <span aria-hidden className={`text-fg-faint transition-transform duration-200 ${openId === p.id ? "rotate-90" : ""}`}>›</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-fg">{p.title}</span>
                    <Badge tone={p.status === "OPEN" ? "green" : "slate"}>{p.status.toLowerCase()}</Badge>
                    {p.new_applications > 0 && (
                      <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                        {p.new_applications} new
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-fg-faint">
                    {TYPES.find((t) => t.value === p.employment_type)?.label ?? p.employment_type}
                    {p.department ? ` · ${p.department}` : ""}
                    {p.salary_text ? ` · ${p.salary_text}` : ""}
                    {p.location ? ` · 📍 ${p.location}` : ""}
                  </span>
                </span>
                <span className="mise-well shrink-0 rounded-xl px-3 py-1.5 text-center">
                  <span className="block font-mono text-lg font-bold text-fg">{p.applications}</span>
                  <span className="block text-[9px] uppercase tracking-wide text-fg-faint">applicants</span>
                </span>
              </button>

              {openId === p.id && (
                <div className="mise-pop border-t border-line px-5 py-4">
                  {canWrite && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      <button onClick={() => toggleStatus(p)} className="mise-raised mise-press rounded-lg px-3 py-1.5 text-xs font-medium text-fg-soft">
                        {p.status === "OPEN" ? "⏸ Close applications" : "▶ Reopen on the board"}
                      </button>
                      <button onClick={() => removePosting(p)} className="mise-press rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/10">
                        Delete
                      </button>
                    </div>
                  )}
                  {appsBusy && !apps[p.id] ? (
                    <p className="py-3 text-center text-sm text-fg-faint">Loading applicants…</p>
                  ) : (apps[p.id] ?? []).length === 0 ? (
                    <p className="py-3 text-center text-sm text-fg-faint">
                      No applications yet — the role is live on <Link href="/careers" className="text-brand-400 underline">the board</Link>.
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {(apps[p.id] ?? []).map((a) => (
                        <li key={a.id} className="mise-well rounded-xl p-3">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span aria-hidden className="mise-raised grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-bold text-fg">
                              {a.applicant_name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-fg">{a.applicant_name}</p>
                              <p className="truncate text-xs text-fg-faint">
                                {a.email}
                                {a.phone ? ` · ${a.phone}` : ""}
                              </p>
                            </div>
                            {a.resume_filename && (
                              <button
                                onClick={() => downloadFile(`/jobs/applications/${a.id}/resume`, a.resume_filename ?? "resume")}
                                className="mise-raised mise-press shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-300"
                              >
                                📄 CV
                              </button>
                            )}
                            {canWrite ? (
                              <div className="w-36 shrink-0">
                                <Select
                                  value={a.status}
                                  onChange={(v) => moveStage(a, v)}
                                  options={STAGES.map((s) => ({ value: s, label: s.charAt(0) + s.slice(1).toLowerCase() }))}
                                  className="w-full"
                                />
                              </div>
                            ) : (
                              <Badge tone={STAGE_TONE[a.status] ?? "slate"}>{a.status.toLowerCase()}</Badge>
                            )}
                          </div>
                          {a.cover_note && (
                            <p className="mt-2 rounded-lg bg-glass/5 px-3 py-2 text-xs leading-relaxed text-fg-soft">
                              “{a.cover_note}”
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
