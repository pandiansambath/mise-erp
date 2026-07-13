"use client";

// The public job board — every open vacancy across every hotel on Mise, in
// the landing's cinema language. No login: guests browse, filter and apply
// with a resume. Hotels manage everything from their Hiring page.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { API_BASE } from "@/lib/api";
import { Brand } from "@/components/Brand";

type Job = {
  id: string;
  title: string;
  hotel_name: string;
  city: string | null;
  country: string | null;
  department: string | null;
  employment_type: string;
  salary_text: string | null;
  location: string | null;
  created_at: string;
};
type JobDetail = Job & { description: string; closes_on: string | null };

const TYPE_LABEL: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CASUAL: "Casual",
  APPRENTICESHIP: "Apprenticeship",
};
const TYPE_TONE: Record<string, string> = {
  FULL_TIME: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  PART_TIME: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  CASUAL: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  APPRENTICESHIP: "border-violet-400/30 bg-violet-400/10 text-violet-300",
};

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const HUES = ["#10b981", "#38bdf8", "#f59e0b", "#a78bfa", "#f43f5e", "#22d3ee"];
const hueFor = (name: string) =>
  HUES[[...name].reduce((t, ch) => t + ch.charCodeAt(0), 0) % HUES.length];

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

/* ─────────────────────── apply modal ─────────────────────── */

function ApplyModal({ job, onClose }: { job: JobDetail; onClose: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("applicant_name", name);
      fd.append("email", email);
      if (phone) fd.append("phone", phone);
      if (note) fd.append("cover_note", note);
      if (file) fd.append("resume", file);
      const r = await fetch(`${API_BASE}/api/public/jobs/${job.id}/apply`, {
        method: "POST",
        body: fd,
      });
      if (!r.ok) {
        const detail = await r.json().catch(() => null);
        throw new Error(detail?.detail ?? "Could not send your application");
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send your application");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="mise-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="mise-pop-lg relative flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60">
        {done ? (
          <div className="flex flex-col items-center px-8 py-14 text-center">
            <span className="grid h-16 w-16 place-items-center rounded-full bg-emerald-500/15 text-3xl">✓</span>
            <h3 className="mt-5 font-display text-2xl text-white">Application sent</h3>
            <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-400">
              <b className="text-slate-200">{job.hotel_name}</b> has your application for{" "}
              <b className="text-slate-200">{job.title}</b>. They&apos;ll reach out on the details you left.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mise-press mt-7 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-6 py-2.5 text-sm font-semibold text-ink-950"
            >
              Back to the board
            </button>
          </div>
        ) : (
          <>
            <div className="border-b border-white/5 px-6 py-4">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-emerald-300/80">
                Apply · {job.hotel_name}
              </p>
              <h3 className="mt-0.5 font-display text-xl text-white">{job.title}</h3>
            </div>
            <form onSubmit={submit} className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain px-6 py-5">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Your name *</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    minLength={2}
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-400">Email *</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
                  />
                </label>
              </div>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Phone</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-400">Why you? (a few lines)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  className="mt-1 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
                />
              </label>
              {/* resume dropzone */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") fileRef.current?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) setFile(f);
                }}
                className={`flex cursor-pointer items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 transition ${
                  dragOver
                    ? "border-emerald-400/70 bg-emerald-400/10"
                    : "border-white/15 bg-white/[0.03] hover:border-emerald-400/40"
                }`}
              >
                <span aria-hidden className="text-2xl">{file ? "📄" : "📎"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-white">
                    {file ? file.name : "Attach your CV / resume"}
                  </span>
                  <span className="text-[11px] text-slate-500">PDF, Word or a photo — up to 5 MB</span>
                </span>
                {file && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setFile(null);
                    }}
                    className="shrink-0 text-xs text-slate-400 hover:text-rose-300"
                  >
                    remove
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {error && <p className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-300">{error}</p>}
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="submit"
                  disabled={busy}
                  className="mise-press flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-emerald-500/20 disabled:opacity-60"
                >
                  {busy ? "Sending…" : "Send application"}
                </button>
                <button type="button" onClick={onClose} className="rounded-xl border border-white/10 px-5 py-3 text-sm text-slate-300">
                  Cancel
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────── the board ─────────────────────── */

export default function CareersPage() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [q, setQ] = useState("");
  const [type, setType] = useState<string>("all");
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    document.documentElement.classList.add("dark");
    fetch(`${API_BASE}/api/public/jobs`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setJobs)
      .catch(() => setJobs([]));
  }, []);

  async function openDetail(id: string) {
    try {
      const r = await fetch(`${API_BASE}/api/public/jobs/${id}`);
      if (r.ok) setDetail(await r.json());
    } catch {
      /* board stays */
    }
  }

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (jobs ?? []).filter(
      (j) =>
        (type === "all" || j.employment_type === type) &&
        (!needle ||
          `${j.title} ${j.hotel_name} ${j.city ?? ""} ${j.department ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [jobs, q, type]);

  const types = useMemo(
    () => ["all", ...new Set((jobs ?? []).map((j) => j.employment_type))],
    [jobs],
  );

  return (
    <div className="mise-dark-page min-h-screen bg-ink-950 text-slate-100">
      {/* nav */}
      <header className="fixed inset-x-0 top-0 z-40 border-b border-white/5 bg-ink-950/90 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <Link href="/" aria-label="Mise home">
            <Brand size={28} wordClassName="text-lg text-white" />
          </Link>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500 sm:block">
            The hospitality job board
          </span>
          <Link
            href="/signup"
            className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3.5 py-2 text-[13px] font-semibold text-emerald-300 transition hover:bg-emerald-400/20"
          >
            Hiring? Run your hotel on Mise
          </Link>
        </nav>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden pb-10 pt-32 sm:pt-36">
        <div className="mise-dots pointer-events-none absolute inset-0" aria-hidden />
        <div
          className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[780px] -translate-x-1/2 -translate-y-1/3 rounded-full opacity-60 blur-3xl"
          style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.25), rgba(234,183,138,0.1), transparent 70%)" }}
          aria-hidden
        />
        <div className="relative mx-auto max-w-6xl px-5 sm:px-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-emerald-300/80">
            Careers · powered by Mise
          </p>
          <h1 className="mt-3 font-display text-4xl leading-[1.05] text-white sm:text-6xl">
            Work where the <em className="mise-hero-text not-italic">fire</em> is.
          </h1>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-slate-400 sm:text-base">
            Open roles across independent hotels &amp; restaurants running on Mise — kitchens,
            floors and front desks that take their craft (and their people) seriously.
          </p>

          {/* search + filters */}
          <div className="mt-8 flex flex-wrap items-center gap-2.5">
            <div className="relative w-full max-w-md">
              <span aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">⌕</span>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search roles, hotels, cities…"
                className="w-full rounded-2xl border border-white/10 bg-white/[0.05] py-3 pl-10 pr-4 text-sm text-white outline-none backdrop-blur transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20"
              />
            </div>
            {types.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`rounded-full px-3.5 py-2 text-xs font-medium transition ${
                  type === t
                    ? "bg-emerald-500 text-ink-950"
                    : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08]"
                }`}
              >
                {t === "all" ? "All roles" : TYPE_LABEL[t] ?? t}
              </button>
            ))}
            {jobs && (
              <span className="ml-auto font-mono text-[11px] text-slate-500">
                {filtered.length} open role{filtered.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* the board */}
      <main className="relative mx-auto max-w-6xl px-5 pb-24 sm:px-6">
        {jobs === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="mise-shimmer h-44 rounded-3xl border border-white/5 bg-white/[0.03]" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] px-8 py-16 text-center">
            <p className="text-4xl" aria-hidden>🧑‍🍳</p>
            <h2 className="mt-4 font-display text-2xl text-white">No open roles right now</h2>
            <p className="mx-auto mt-2 max-w-sm text-sm text-slate-400">
              Kitchens hire fast — check back soon, or tell your favourite local their hotel
              should be running on Mise.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((j, i) => {
              const hue = hueFor(j.hotel_name);
              return (
                <button
                  key={j.id}
                  type="button"
                  onClick={() => openDetail(j.id)}
                  style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
                  className="mise-pop group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-5 text-left transition duration-300 hover:-translate-y-1 hover:border-emerald-400/30 hover:bg-white/[0.05] hover:shadow-2xl hover:shadow-emerald-500/5"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-[2px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                    style={{ background: `linear-gradient(90deg, transparent, ${hue}, transparent)` }}
                  />
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-bold text-ink-950"
                      style={{ background: `linear-gradient(135deg, ${hue}, ${hue}99)` }}
                    >
                      {monogram(j.hotel_name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-400">{j.hotel_name}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        📍 {j.location || j.city || "UK"} · {daysAgo(j.created_at)}
                      </p>
                    </div>
                  </div>
                  <h3 className="mt-4 font-display text-xl leading-snug text-white">{j.title}</h3>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${TYPE_TONE[j.employment_type] ?? "border-white/10 text-slate-300"}`}>
                      {TYPE_LABEL[j.employment_type] ?? j.employment_type}
                    </span>
                    {j.department && (
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-slate-300">
                        {j.department}
                      </span>
                    )}
                    {j.salary_text && (
                      <span className="rounded-full border border-copper-400/30 bg-copper-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-copper-200">
                        {j.salary_text}
                      </span>
                    )}
                  </div>
                  <p className="mt-4 text-xs font-semibold text-emerald-300 opacity-0 transition group-hover:opacity-100">
                    View &amp; apply →
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 text-xs text-slate-600 sm:px-6">
          <p>© {new Date().getFullYear()} Mise · every plate, every penny</p>
          <Link href="/" className="text-slate-500 transition hover:text-white">mise for hotels →</Link>
        </div>
      </footer>

      {/* detail + apply */}
      {detail && !applying && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true">
          <div className="mise-fade absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setDetail(null)} aria-hidden />
          <div className="mise-pop-lg relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-ink-900 shadow-2xl shadow-black/60">
            <div className="flex items-start gap-4 border-b border-white/5 px-6 py-5">
              <span
                aria-hidden
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-sm font-bold text-ink-950"
                style={{ background: `linear-gradient(135deg, ${hueFor(detail.hotel_name)}, ${hueFor(detail.hotel_name)}99)` }}
              >
                {monogram(detail.hotel_name)}
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-2xl leading-tight text-white">{detail.title}</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {detail.hotel_name} · 📍 {detail.location || detail.city || "UK"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                aria-label="Close"
                className="mise-press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
              <div className="flex flex-wrap gap-1.5">
                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${TYPE_TONE[detail.employment_type] ?? "border-white/10 text-slate-300"}`}>
                  {TYPE_LABEL[detail.employment_type] ?? detail.employment_type}
                </span>
                {detail.department && (
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-medium text-slate-300">
                    {detail.department}
                  </span>
                )}
                {detail.salary_text && (
                  <span className="rounded-full border border-copper-400/30 bg-copper-500/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-copper-200">
                    {detail.salary_text}
                  </span>
                )}
                {detail.closes_on && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-medium text-amber-300">
                    closes {detail.closes_on}
                  </span>
                )}
              </div>
              <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-300">
                {detail.description || "Ask us anything about the role when you apply."}
              </p>
            </div>
            <div className="border-t border-white/5 px-6 py-4">
              <button
                type="button"
                onClick={() => setApplying(true)}
                className="mise-press w-full rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-3 text-sm font-semibold text-ink-950 shadow-lg shadow-emerald-500/20"
              >
                Apply for this role →
              </button>
            </div>
          </div>
        </div>
      )}
      {detail && applying && (
        <ApplyModal
          job={detail}
          onClose={() => {
            setApplying(false);
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}
