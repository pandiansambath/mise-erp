"use client";

// MY SPACE — rebuilt from scratch, 2026-09-05.
//
//   "i checked the staff login... ui seriously not nice bro. we need a best ui
//    ux. it look very raw and very tight to see. please this is a very small
//    page bro, we have very few section like rota attendance doc payslip, that
//    is. so please build the entire UI from the scratch."
//
// He is right that it is a small page, and that was the problem rather than the
// excuse. Four things were laid out as if they were forty:
//
//   · a two-column grid squeezed the attendance table into half the width, so
//     dates wrapped onto two lines and the Hours header truncated to "HOURS W…"
//   · the identity band was five equal boxes, the fifth orphaned onto its own
//     row, saying things you learn once and never look up again
//   · every section rendered whether or not it had anything in it, so a new
//     starter met three large empty boxes
//   · the payslip status badge sat on top of the amount
//
// The rebuild follows his own house rule — click, don't scroll. The page is a
// personal header plus ONE section at a time, each with the full width it
// needs. That is what fixes the wrapping and the truncation: not smaller type,
// more room. And you only ever see the empty state of the thing you asked for.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  api,
  ApiError,
  downloadFile,
  postForm,
  type DocRequest,
  type DocumentItem,
  type Employee,
  type PayrollRow,
} from "@/lib/api";
import { Badge, Card, Spinner } from "@/components/ui";
import { TotalsStrip } from "@/components/PageKit";
import { RangeControls, rangeCaption } from "@/components/RangeControls";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useHotelTime } from "@/lib/time";
import { ROLE_LABELS } from "@/lib/permissions";
import { fmtHours } from "@/lib/quantity";
import type { AttendanceRow } from "@/lib/api";

/** Friendly download name: "Balaji - license.pdf" (sanitised, keeps extension). */
function docName(person: string, type: string, filename?: string): string {
  const ext = filename?.match(/\.[a-z0-9]+$/i)?.[0] ?? "";
  const t = type.replace(/_/g, " ").toLowerCase();
  return `${person} - ${t}${ext}`.replace(/[\\/:*?"<>|]/g, "");
}

/** What /me/rota returns — their own shifts, already filtered server-side. */
type MyShift = {
  id: string;
  date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  hours: string;
  notes: string | null;
};

/** What /me/attendance/history returns. Every field is declared on the server
 *  schema too: response_model drops anything it has not been told about, and
 *  this project has lost figures to that four times. */
type MyAttendanceHistory = {
  date_from: string;
  date_to: string;
  totals: {
    present: number;
    half_days: number;
    absent: number;
    recorded_days: number;
    total_hours: string;
    indicative_pay: string;
    basis: string;
  };
  days: AttendanceRow[];
};

const EMPTY_HISTORY: MyAttendanceHistory = {
  date_from: "",
  date_to: "",
  totals: {
    present: 0, half_days: 0, absent: 0, recorded_days: 0,
    total_hours: "0", indicative_pay: "0", basis: "",
  },
  days: [],
};

const isoDay = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const payTone: Record<string, "slate" | "amber" | "green"> = {
  DRAFT: "slate",
  APPROVED: "amber",
  PAID: "green",
};

const niceDate = (iso: string, withYear = false) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
  });

type Tab = "attendance" | "rota" | "payslips" | "documents";

/** One warm line, not a large empty box.
 *
 *  A new starter with nothing yet met three tall bordered rectangles saying
 *  variations of "nothing here", which reads as a broken page rather than an
 *  empty one. */
function Empty({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-2.5 px-5 py-10 text-sm text-fg-faint">
      <span aria-hidden className="text-lg opacity-70">{icon}</span>
      {children}
    </div>
  );
}

export default function MySpacePage() {
  const { format } = useCurrency();
  const { time: fmtTime } = useHotelTime();
  const { user } = useAuth();

  const [emp, setEmp] = useState<Employee | null>(null);
  const [payslips, setPayslips] = useState<PayrollRow[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);
  const [requests, setRequests] = useState<DocRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [notLinked, setNotLinked] = useState(false);
  const [tab, setTab] = useState<Tab>("attendance");

  // Attendance over a range they choose, not a fixed tail of rows.
  const [attFrom, setAttFrom] = useState(() => isoDay(-30));
  const [attTo, setAttTo] = useState(() => isoDay(0));
  const [history, setHistory] = useState<MyAttendanceHistory>(EMPTY_HISTORY);
  const [attLoading, setAttLoading] = useState(true);

  // The rota leans forward: "when am I next on" is the question.
  const [rotaFrom, setRotaFrom] = useState(() => isoDay(-7));
  const [rotaTo, setRotaTo] = useState(() => isoDay(28));
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [rotaLoading, setRotaLoading] = useState(true);

  // Frozen at mount: reading the clock DURING render is impure, and this page
  // has no reason to notice midnight passing while it is open.
  const [today] = useState(() => isoDay(0));
  const [visaWarnFrom] = useState(() => isoDay(90));

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Employee>("/me/employee")
      .then(async (e) => {
        setEmp(e);
        await Promise.all([
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

  useEffect(() => {
    setAttLoading(true);
    api
      .get<MyAttendanceHistory>(`/me/attendance/history?date_from=${attFrom}&date_to=${attTo}`)
      .then(setHistory)
      .catch(() => setHistory(EMPTY_HISTORY))
      .finally(() => setAttLoading(false));
  }, [attFrom, attTo]);

  useEffect(() => {
    setRotaLoading(true);
    api
      .get<MyShift[]>(`/me/rota?date_from=${rotaFrom}&date_to=${rotaTo}`)
      .then(setShifts)
      .catch(() => setShifts([]))
      .finally(() => setRotaLoading(false));
  }, [rotaFrom, rotaTo]);

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
    setUploadMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      await postForm(`/me/document-requests/${uploadFor}/upload`, form);
      reloadDocs();
      setUploadMsg("Sent — your manager will review it.");
    } catch (err) {
      setUploadMsg(err instanceof ApiError ? err.message : "Could not upload that file");
    } finally {
      e.target.value = "";
      setUploadFor(null);
    }
  }

  const pendingReqs = requests.filter((r) => r.status !== "APPROVED");
  const toUpload = pendingReqs.filter((r) => r.status !== "UPLOADED").length;

  /** The next shift that has not happened yet — the single most useful fact on
   *  this page, and it used to be somewhere in a list you had to read. */
  const nextShift = useMemo(() => {
    return [...shifts]
      .filter((s) => s.date >= today)
      .sort((a, b) => (a.date + a.start_time).localeCompare(b.date + b.start_time))[0];
  }, [shifts, today]);

  if (loading) return <Spinner />;

  if (notLinked || !emp) {
    return (
      <div className="mx-auto max-w-lg py-10">
        <Card className="text-center">
          <p className="text-3xl" aria-hidden>🔗</p>
          <h1 className="mt-3 font-display text-xl font-semibold text-fg">Almost there</h1>
          <p className="mt-2 text-sm text-fg-faint">
            Your login isn&apos;t linked to an employee record yet, so there is nothing
            personal to show. Ask your manager to link it — Staff → Add member → pick
            your name.
          </p>
        </Card>
      </div>
    );
  }

  const firstName = emp.full_name.split(" ")[0];
  const initials = emp.full_name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const pay =
    emp.salary_type === "HOURLY"
      ? `${emp.hourly_rate ? format(emp.hourly_rate) : "—"}/hr`
      : `${emp.monthly_salary ? format(emp.monthly_salary) : "—"}/mo`;

  // Within 90 days, compared as ISO strings so nothing reads the clock here.
  const visaSoon = Boolean(emp.visa_expiry_date && emp.visa_expiry_date < visaWarnFrom);

  const TABS: { key: Tab; label: string; icon: string; count?: number }[] = [
    { key: "attendance", label: "Attendance", icon: "⏱" },
    { key: "rota", label: "Rota", icon: "📅", count: shifts.length || undefined },
    { key: "payslips", label: "Payslips", icon: "💷", count: payslips.length || undefined },
    { key: "documents", label: "Documents", icon: "📄", count: docs.length || undefined },
  ];

  return (
    <div className="mx-auto max-w-5xl">
      <input ref={fileRef} type="file" className="hidden" onChange={onFileChosen} />

      {/* THE PERSON, NOT A PAGE TITLE.
          This replaces "My Space" plus a five-box band. Who you are, what you
          are paid and what you can reach are one line of chips, because they
          are things you confirm at a glance and never study. */}
      <Card className="mise-feel overflow-hidden p-0">
        <div className="flex flex-wrap items-center gap-4 border-b border-line/60 bg-gradient-to-r from-brand-500/10 via-transparent to-transparent px-5 py-4">
          <span
            aria-hidden
            className="mise-neo-raised grid h-14 w-14 shrink-0 place-items-center rounded-2xl font-display text-lg font-semibold text-brand-300"
          >
            {initials || "🙋"}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-2xl font-semibold text-fg">
              Hi, {firstName}
            </h1>
            <p className="mt-0.5 truncate text-sm text-fg-faint">
              {emp.job_title || "Team member"} · {emp.employee_code}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="mise-chip">{pay}</span>
            <span className="mise-chip">{user ? ROLE_LABELS[user.role] ?? user.role : "Staff"}</span>
            {emp.visa_expiry_date && (
              <span
                className={visaSoon ? "mise-chip-warn" : "mise-chip"}
                title={`Visa expires ${emp.visa_expiry_date}`}
              >
                visa {emp.visa_expiry_date}
              </span>
            )}
          </div>
        </div>

        {/* NEXT SHIFT — the one thing staff open this page to find, and it was
            buried in a list you had to read down. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3 text-sm">
          {nextShift ? (
            <span className="text-fg-soft">
              <span aria-hidden className="mr-1.5">📅</span>
              Next on{" "}
              <b className="text-fg">
                {nextShift.date === today ? "today" : niceDate(nextShift.date)}
              </b>
              , {nextShift.start_time.slice(0, 5)}–{nextShift.end_time.slice(0, 5)}
            </span>
          ) : (
            <span className="text-fg-faint">
              <span aria-hidden className="mr-1.5">📅</span>
              No upcoming shifts rostered
            </span>
          )}
          <span className="text-fg-soft">
            <span aria-hidden className="mr-1.5">⏱</span>
            <b className="text-fg">{fmtHours(history.totals.total_hours)}</b> worked in{" "}
            {rangeCaption({ from: attFrom, to: attTo }).toLowerCase()}
          </span>
        </div>
      </Card>

      {/* SOMETHING IS ASKED OF YOU. Above the tabs on purpose: it is the only
          thing on this page with a deadline, and it disappears when done. */}
      {pendingReqs.length > 0 && (
        <Card className="mt-4 border-amber-400/30 bg-amber-400/[0.06]">
          <h2 className="font-semibold text-fg">
            <span aria-hidden className="mr-1.5">📋</span>
            {toUpload > 0
              ? `${toUpload} document${toUpload === 1 ? "" : "s"} to send`
              : "Waiting on your manager"}
          </h2>
          <ul className="mt-3 space-y-2">
            {pendingReqs.map((r) => (
              <li
                key={r.id}
                className="mise-card-inset flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{r.title}</p>
                  <p className="truncate text-xs text-fg-faint">
                    {r.doc_type.replace(/_/g, " ").toLowerCase()}
                  </p>
                </div>
                {r.status === "UPLOADED" ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="amber">awaiting approval</Badge>
                    {r.document_id && (
                      <button
                        onClick={() =>
                          downloadFile(
                            `/me/documents/${r.document_id}/download`,
                            docName(emp.full_name, r.doc_type),
                          )
                        }
                        className="mise-btn-flat mise-press min-h-[36px] px-3 py-1.5 text-xs text-fg-soft"
                      >
                        View
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => pickFile(r.id)}
                    data-tone="brand"
                    className="mise-btn-flat mise-press min-h-[40px] px-4 py-2 text-sm font-bold text-brand-300"
                  >
                    Upload
                  </button>
                )}
              </li>
            ))}
          </ul>
          {uploadMsg && <p className="mt-2 text-xs text-brand-300">{uploadMsg}</p>}
        </Card>
      )}

      {/* FOUR THINGS, ONE AT A TIME.
          A real switch, not a scroll-to. It is what gives each section the FULL
          width — which is what fixes the wrapped dates and the truncated
          "HOURS W…" header, neither of which was a font-size problem. */}
      <div
        role="tablist"
        aria-label="My Space sections"
        className="mise-card-inset mt-4 flex gap-1 overflow-x-auto p-1.5"
      >
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={on}
              onClick={() => setTab(t.key)}
              className={`mise-press flex min-h-[44px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${
                on ? "bg-brand-600 text-white shadow-sm" : "text-fg-soft hover:text-fg"
              }`}
            >
              <span aria-hidden>{t.icon}</span>
              {t.label}
              {t.count !== undefined && (
                <span
                  className={`rounded-md px-1.5 py-px text-[10px] tabular-nums ${
                    on ? "bg-white/20 text-white" : "bg-fg/10 text-fg-faint"
                  }`}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── ATTENDANCE ──────────────────────────────────────────────────── */}
      {tab === "attendance" && (
        <Card className="mise-fade-in mt-4 p-0">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 className="mr-auto font-semibold text-fg">My attendance</h2>
            <RangeControls
              range={{ from: attFrom, to: attTo }}
              onChange={(r) => { setAttFrom(r.from); setAttTo(r.to); }}
            />
          </div>

          <div className="px-5">
            <TotalsStrip
              items={[
                { label: "Hours worked", value: fmtHours(history.totals.total_hours), tone: "good", strong: true },
                { label: "Days present", value: String(history.totals.present) },
                { label: "Half days", value: String(history.totals.half_days) },
                {
                  label: "Absent",
                  value: String(history.totals.absent),
                  tone: history.totals.absent > 0 ? "warn" : "plain",
                },
              ]}
            />
          </div>

          {attLoading ? (
            <Empty icon="⏳">Loading your days…</Empty>
          ) : history.days.length === 0 ? (
            <Empty icon="⏱">
              Nothing recorded in {rangeCaption({ from: attFrom, to: attTo }).toLowerCase()}.
            </Empty>
          ) : (
            <div className="mt-4 overflow-x-auto">
              {/* FULL WIDTH is the whole fix. Squeezed into half a column this
                  same table wrapped "2026-08-07" onto two lines and cut the
                  Hours header down to "HOURS W…". */}
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-fg-faint">
                    <th className="px-5 py-2.5 font-medium">Date</th>
                    <th className="px-5 py-2.5 font-medium">In</th>
                    <th className="px-5 py-2.5 font-medium">Out</th>
                    <th className="px-5 py-2.5 text-right font-medium">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {history.days.map((a) => (
                    <tr key={a.date} className="border-b border-line/60 even:bg-glass/[0.02]">
                      <td className="whitespace-nowrap px-5 py-2.5 font-medium text-fg">
                        {niceDate(a.date)}
                      </td>
                      <td data-label="In" className="px-5 py-2.5 text-fg-soft">{fmtTime(a.clock_in)}</td>
                      <td data-label="Out" className="px-5 py-2.5 text-fg-soft">{fmtTime(a.clock_out)}</td>
                      <td data-label="Hours" className="px-5 py-2.5 text-right font-medium tabular-nums text-fg">
                        {fmtHours(a.working_hours)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ── ROTA ────────────────────────────────────────────────────────── */}
      {tab === "rota" && (
        <Card className="mise-fade-in mt-4 p-0">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 className="mr-auto font-semibold text-fg">My rota</h2>
            <span className="text-[11px] text-fg-faint">
              {shifts.length} shift{shifts.length === 1 ? "" : "s"} ·{" "}
              {shifts.reduce((t, s) => t + (parseFloat(s.hours) || 0), 0).toFixed(1)}h rostered
            </span>
            <RangeControls
              range={{ from: rotaFrom, to: rotaTo }}
              onChange={(r) => { setRotaFrom(r.from); setRotaTo(r.to); }}
            />
          </div>

          {rotaLoading ? (
            <Empty icon="⏳">Loading your shifts…</Empty>
          ) : shifts.length === 0 ? (
            <Empty icon="📅">No shifts rostered for you in this range.</Empty>
          ) : (
            <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              {shifts.map((sh) => {
                const isToday = sh.date === today;
                const past = sh.date < today;
                return (
                  <div
                    key={sh.id}
                    className={`mise-card-inset relative overflow-hidden px-4 py-3 pl-5 ${past ? "opacity-55" : ""}`}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-y-0 left-0 w-1 ${
                        isToday ? "bg-brand-400" : past ? "bg-line" : "bg-brand-400/40"
                      }`}
                    />
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-semibold text-fg">
                        {niceDate(sh.date)}
                      </p>
                      {isToday && <span className="mise-chip shrink-0 text-[10px]">today</span>}
                    </div>
                    <p className="mt-1 font-display text-lg font-semibold tabular-nums text-fg">
                      {sh.start_time.slice(0, 5)} – {sh.end_time.slice(0, 5)}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-fg-faint">
                      {fmtHours(sh.hours)} rostered
                      {sh.break_minutes > 0 ? ` · ${sh.break_minutes}m break` : ""}
                      {sh.notes ? ` · ${sh.notes}` : ""}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── PAYSLIPS ────────────────────────────────────────────────────── */}
      {tab === "payslips" && (
        <Card className="mise-fade-in mt-4 p-0">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 className="mr-auto font-semibold text-fg">My payslips</h2>
            <span className="text-[11px] text-fg-faint">newest first</span>
          </div>

          {payslips.length === 0 ? (
            <Empty icon="💷">No payslips yet — they appear once a pay run is finished.</Empty>
          ) : (
            <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              {payslips.map((p) => (
                <div key={p.id} className="mise-card-inset px-4 py-3.5">
                  {/* The badge sat ON the amount before. Its own line above,
                      where a status belongs — you read what KIND of payslip
                      this is, then how much. */}
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                      {p.pay_period}
                    </p>
                    <Badge tone={payTone[p.status] ?? "slate"}>{p.status}</Badge>
                  </div>
                  <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums text-fg">
                    {format(p.net_pay)}
                  </p>
                  <p className="text-[11px] text-fg-faint">take-home</p>
                  <button
                    onClick={() => downloadFile(`/me/payslips/${p.id}.pdf`, `payslip-${p.pay_period}.pdf`)}
                    className="mise-btn-flat mise-press mt-3 min-h-[40px] w-full px-4 py-2 text-sm font-medium text-fg-soft"
                  >
                    ⬇ Download PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── DOCUMENTS ───────────────────────────────────────────────────── */}
      {tab === "documents" && (
        <Card className="mise-fade-in mt-4 p-0">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <h2 className="mr-auto font-semibold text-fg">My documents</h2>
            <span className="text-[11px] text-fg-faint">shared with you by your manager</span>
          </div>

          {docs.length === 0 ? (
            <Empty icon="📄">Nothing shared with you yet.</Empty>
          ) : (
            <div className="grid gap-2.5 px-5 pb-5 sm:grid-cols-2">
              {docs.map((d) => {
                const expired = d.expiry_date ? d.expiry_date < today : false;
                return (
                  <div key={d.id} className="mise-card-inset flex items-center gap-3 px-4 py-3">
                    <span aria-hidden className="mise-well grid h-10 w-10 shrink-0 place-items-center rounded-xl text-base">
                      📄
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-fg">{d.title}</p>
                      <p className="truncate text-[11px] text-fg-faint">
                        {d.doc_type.replace(/_/g, " ").toLowerCase()}
                        {d.expiry_date ? ` · expires ${d.expiry_date}` : ""}
                      </p>
                    </div>
                    {expired && <Badge tone="amber">expired</Badge>}
                    <button
                      onClick={() =>
                        downloadFile(
                          `/me/documents/${d.id}/download`,
                          docName(emp.full_name, d.doc_type, d.filename),
                        )
                      }
                      className="mise-btn-flat mise-press min-h-[36px] shrink-0 px-3 py-1.5 text-xs text-fg-soft"
                    >
                      Download
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
