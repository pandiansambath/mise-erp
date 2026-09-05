"use client";

import { fmtHours } from "@/lib/quantity";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { SubNav } from "@/components/SubNav";
import { spotlight } from "@/components/fx";
import { TotalsStrip } from "@/components/PageKit";
import { RangeControls, rangeCaption } from "@/components/RangeControls";
import { Sparkline } from "@/components/charts";
import { useAuth } from "@/lib/auth";
import { useCurrency } from "@/lib/currency";
import { useHotelTime } from "@/lib/time";
import { ROLE_LABELS } from "@/lib/permissions";

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

export default function MySpacePage() {
  const { format } = useCurrency();
  const { time: fmtTime } = useHotelTime();
  const { user } = useAuth();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [payslips, setPayslips] = useState<PayrollRow[]>([]);
  const [docs, setDocs] = useState<DocumentItem[]>([]);

  // Attendance over a range he chooses, not a fixed tail of rows.
  const [attFrom, setAttFrom] = useState(() => isoDay(-30));
  const [attTo, setAttTo] = useState(() => isoDay(0));
  const [history, setHistory] = useState<MyAttendanceHistory>(EMPTY_HISTORY);
  const [attLoading, setAttLoading] = useState(true);

  // The rota, defaulting to last week through the next four — "when am I next
  // on" is the question, so the range leans forward.
  const [rotaFrom, setRotaFrom] = useState(() => isoDay(-7));
  const [rotaTo, setRotaTo] = useState(() => isoDay(28));
  const [shifts, setShifts] = useState<MyShift[]>([]);
  const [rotaLoading, setRotaLoading] = useState(true);
  const rotaHours = shifts.reduce((t, s) => t + (parseFloat(s.hours) || 0), 0);

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

  // last-7-days totals for the phone swipe card (cutoff frozen at mount)
  const [weekCutoff] = useState(() => new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10));
  const weekStats = useMemo(() => {
    const week = attendance.filter((a) => a.date >= weekCutoff);
    return { n: week.length, hrs: week.reduce((t, a) => t + (parseFloat(a.working_hours ?? "0") || 0), 0) };
  }, [attendance, weekCutoff]);
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
          <p className="py-6 text-center text-sm text-fg-faint">
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
      <PageHeader
        title={`Hi, ${emp.full_name.split(" ")[0]}`}
        subtitle="Your attendance, your rota, your payslips and your documents — nobody else's."
      />

      {/* The four jobs, said out loud, the way every other section does it.
          These are what a staff login is FOR, and they were cards you had to
          know to scroll to. */}
      <SubNav
        items={[
          { key: "attendance", label: "My attendance", icon: "⏱", onSelect: () => spotlight("my-attendance") },
          { key: "rota", label: "My rota", icon: "📅", count: shifts.length || undefined, onSelect: () => spotlight("my-rota") },
          { key: "docs", label: "My documents", icon: "📄", count: docs.length || undefined, onSelect: () => spotlight("my-documents") },
          { key: "pay", label: "My payslips", icon: "💷", count: payslips.length || undefined, onSelect: () => spotlight("my-payslips") },
        ]}
      />

      {pendingReqs.length > 0 && (
        <Card className="mb-6 border-amber-400/30 bg-amber-400/5">
          <h3 className="font-semibold text-fg">📋 Requested from you</h3>
          <p className="mt-1 text-sm text-fg-faint">Your manager has asked for these documents.</p>
          <ul className="mt-3 divide-y divide-amber-400/20">
            {pendingReqs.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-sm font-medium text-fg">{r.title}</p>
                  <p className="text-xs text-fg-faint">{r.doc_type.replace(/_/g, " ").toLowerCase()}</p>
                </div>
                {r.status === "UPLOADED" ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="amber">awaiting approval</Badge>
                    {r.document_id && (
                      <button
                        onClick={() => downloadFile(`/me/documents/${r.document_id}/download`, docName(emp.full_name, r.doc_type))}
                        className="rounded-md border border-line px-2 py-1 text-xs text-brand-300 hover:bg-brand-400/10"
                      >
                        View
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => pickFile(r.id)}
                    className="mise-press rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
                  >
                    Upload
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mise-feel mb-6">
        <div className="mise-stagger grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="mise-well mise-feel rounded-xl p-3">
            <p className="text-xs uppercase text-fg-faint">Code</p>
            <p className="font-semibold text-fg">{emp.employee_code}</p>
          </div>
          <div className="mise-well mise-feel rounded-xl p-3">
            <p className="text-xs uppercase text-fg-faint">Job title</p>
            <p className="font-semibold text-fg">{emp.job_title || "—"}</p>
          </div>
          <div className="mise-well mise-feel rounded-xl p-3">
            <p className="text-xs uppercase text-fg-faint">Access</p>
            <p className="font-semibold text-fg">
              {user ? ROLE_LABELS[user.role] ?? user.role : "—"}
            </p>
          </div>
          <div className="mise-well mise-feel rounded-xl p-3">
            <p className="text-xs uppercase text-fg-faint">Pay</p>
            <p className="font-semibold text-fg">
              {emp.salary_type === "HOURLY"
                ? `${emp.hourly_rate ? format(emp.hourly_rate) : "—"}/hr`
                : `${emp.monthly_salary ? format(emp.monthly_salary) : "—"}/mo`}
            </p>
          </div>
          {emp.visa_expiry_date && (
            <div className="mise-well mise-feel rounded-xl p-3">
              <p className="text-xs uppercase text-fg-faint">Visa expiry</p>
              <p className="font-semibold text-fg">{emp.visa_expiry_date}</p>
            </div>
          )}
        </div>
      </Card>

      {/* Phone-first mini-app: the essentials as swipeable snap cards. The full
          tables below stay for desktop (and anyone who scrolls). */}
      <div className="mb-6 lg:hidden">
        <div className="mise-noscrollbar -mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
          {payslips.slice(0, 2).map((p) => (
            <div key={p.id} className="mise-raised mise-feel w-[76%] shrink-0 snap-center rounded-2xl p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Payslip · {p.pay_period}</p>
              <p className="mt-1.5 font-mono text-2xl font-bold text-brand-300">{format(p.net_pay)}</p>
              <div className="mt-2 flex items-center justify-between">
                <Badge tone={payTone[p.status] ?? "slate"}>{p.status}</Badge>
                <button
                  onClick={() => downloadFile(`/me/payslips/${p.id}.pdf`, `payslip-${p.pay_period}.pdf`)}
                  className="mise-press rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-brand-300"
                >
                  ⬇ PDF
                </button>
              </div>
            </div>
          ))}
          <div className="mise-raised mise-feel w-[76%] shrink-0 snap-center rounded-2xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">This week</p>
            <p className="mt-1.5 font-mono text-2xl font-bold text-fg">
              {Math.floor(weekStats.hrs)}h {String(Math.round((weekStats.hrs % 1) * 60)).padStart(2, "0")}m
            </p>
            <p className="mt-2 text-xs text-fg-faint">
              {weekStats.n} shift{weekStats.n === 1 ? "" : "s"} in the last 7 days
            </p>
          </div>
          <div className="mise-raised mise-feel w-[76%] shrink-0 snap-center rounded-2xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-faint">Documents</p>
            <p className="mt-1.5 font-mono text-2xl font-bold text-fg">{docs.length}</p>
            <p className="mt-2 text-xs text-fg-faint">
              {requests.filter((r) => r.status === "PENDING").length > 0
                ? `${requests.filter((r) => r.status === "PENDING").length} still needed from you ↑`
                : "nothing outstanding — all handed in ✓"}
            </p>
          </div>
        </div>
        <p className="mt-1 text-center text-[10px] text-fg-faint">swipe →</p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card id="my-payslips" className="p-0 scroll-mt-24">
          <h3 className="px-5 pt-4 font-semibold text-fg">My payslips</h3>
          {/* CARDS, per /staff. This is the page an employee opens about their
              own money, on their own phone — a four-column table is the wrong
              shape for that, and the pay was the second column rather than the
              thing you came to read. The stripe says whether it has been paid. */}
          {payslips.length === 0 ? (
            <p className="px-5 py-6 text-center text-fg-faint">No payslips yet.</p>
          ) : (
            <div className="mise-stagger grid gap-2 p-3 sm:grid-cols-2">
              {payslips.map((p) => (
                <div
                  key={p.id}
                  className="mise-card-inset relative flex items-center gap-3 overflow-hidden p-3 pl-4"
                >
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 w-1 ${
                      p.status === "PAID" ? "bg-emerald-400/70" : "bg-amber-400/80"
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-display text-lg font-semibold tabular-nums text-fg">
                      {format(p.net_pay)}
                    </span>
                    <span className="block truncate text-[11px] text-fg-faint">
                      {p.pay_period}
                    </span>
                  </span>
                  <Badge tone={payTone[p.status] ?? "slate"}>{p.status}</Badge>
                  <button
                    onClick={() =>
                      downloadFile(`/me/payslips/${p.id}.pdf`, `payslip-${p.pay_period}.pdf`)
                    }
                    className="mise-btn-flat mise-press shrink-0 px-2.5 py-1.5 text-xs text-brand-300"
                  >
                    PDF
                  </button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card id="my-attendance" className="p-0 scroll-mt-24">
          <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
            <h3 className="font-semibold text-fg">My attendance</h3>
            {(() => {
              const byDate = new Map(history.days.map((a) => [a.date, parseFloat(a.working_hours ?? "0") || 0]));
              const data: number[] = [];
              const labels: string[] = [];
              for (let i = 27; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                const iso = d.toISOString().slice(0, 10);
                data.push(byDate.get(iso) ?? 0);
                labels.push(d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
              }
              if (!data.some((v) => v > 0)) return null;
              return (
                <span className="mise-well flex items-center gap-2 rounded-lg px-3 py-1.5">
                  <Sparkline data={data} labels={labels} formatValue={(v) => `${v}h worked`} height={24} />
                  <span className="text-[10px] text-fg-faint">4 weeks</span>
                </span>
              );
            })()}
          </div>

          {/* GO BACK AND LOOK. The card showed the last 90 rows and no totals,
              which answers "was I in yesterday" and nothing else. The question
              staff actually ask is "how many hours did I do last month", and
              that needs a range and a sum. Same TimeRangePicker the rest of the
              app uses, so it is one control to learn, not a new one here. */}
          <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
            <RangeControls
              range={{ from: attFrom, to: attTo }}
              onChange={(r) => { setAttFrom(r.from); setAttTo(r.to); }}
            />
            <span className="text-[11px] text-fg-faint">{rangeCaption({ from: attFrom, to: attTo })}</span>
          </div>

          <div className="px-5 pt-3">
            <TotalsStrip
              items={[
                { label: "Hours worked", value: fmtHours(history.totals.total_hours), tone: "good", strong: true },
                { label: "Days present", value: String(history.totals.present) },
                { label: "Half days", value: String(history.totals.half_days) },
                { label: "Absent", value: String(history.totals.absent), tone: history.totals.absent > 0 ? "warn" : "plain" },
              ]}
            />
          </div>

          {/* The timesheet STAYS a table: reading down the Hours column is how
              you check a week, and no card grid does that. `mise-stack` gives
              the phone a card layout from the same markup. */}
          <div className="mt-3 overflow-x-auto">
            <table className="mise-stack w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                  <th className="px-5 py-2 font-medium">Date</th>
                  <th className="px-5 py-2 font-medium">In</th>
                  <th className="px-5 py-2 font-medium">Out</th>
                  <th className="px-5 py-2 text-right font-medium">Hours</th>
                </tr>
              </thead>
              <tbody>
                {attLoading ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-faint">Loading…</td></tr>
                ) : history.days.length === 0 ? (
                  <tr><td colSpan={4} className="px-5 py-6 text-center text-fg-faint">
                    Nothing recorded in {rangeCaption({ from: attFrom, to: attTo }).toLowerCase()}.
                  </td></tr>
                ) : history.days.map((a) => (
                  <tr key={a.date} className="border-b border-line">
                    <td className="px-5 py-2 text-fg-soft">{a.date}</td>
                    <td data-label="In" className="px-5 py-2 text-fg-soft">{fmtTime(a.clock_in)}</td>
                    <td data-label="Out" className="px-5 py-2 text-fg-soft">{fmtTime(a.clock_out)}</td>
                    <td data-label="Hours" className="px-5 py-2 text-right text-fg-soft">{fmtHours(a.working_hours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* MY ROTA. The rota page shows the whole team and needs a manager's
          permission to open, so a member of staff had no way at all to see when
          they were next on — they had to ask someone. This is the same data,
          filtered to them in the QUERY, so no one else's shift is ever loaded. */}
      <Card id="my-rota" className="mt-6 p-0 scroll-mt-24">
        <div className="flex flex-wrap items-center justify-between gap-2 px-5 pt-4">
          <h3 className="font-semibold text-fg">My rota</h3>
          <span className="text-[11px] text-fg-faint">
            {shifts.length} shift{shifts.length === 1 ? "" : "s"} · {rotaHours.toFixed(1)}h rostered
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-3">
          <RangeControls
            range={{ from: rotaFrom, to: rotaTo }}
            onChange={(r) => { setRotaFrom(r.from); setRotaTo(r.to); }}
          />
          <span className="text-[11px] text-fg-faint">past and upcoming</span>
        </div>

        <div className="mt-3 space-y-2 px-3 pb-3">
          {rotaLoading ? (
            <p className="px-2 py-6 text-center text-fg-faint">Loading…</p>
          ) : shifts.length === 0 ? (
            <p className="px-2 py-6 text-center text-fg-faint">
              No shifts rostered for you in this range.
            </p>
          ) : (
            shifts.map((sh) => {
              const todayIso = new Date().toISOString().slice(0, 10);
              const isToday = sh.date === todayIso;
              const past = sh.date < todayIso;
              return (
                <div
                  key={sh.id}
                  className={`mise-card-inset relative flex items-center gap-3 overflow-hidden px-4 py-3 pl-5 ${
                    past ? "opacity-60" : ""
                  }`}
                >
                  <span
                    aria-hidden
                    className={`absolute inset-y-0 left-0 w-1 ${isToday ? "bg-brand-400" : past ? "bg-line" : "bg-brand-400/40"}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">
                      {new Date(sh.date + "T00:00:00").toLocaleDateString("en-GB", {
                        weekday: "short", day: "numeric", month: "short",
                      })}
                      {isToday && (
                        <span className="mise-chip ml-2 align-middle text-[10px]">today</span>
                      )}
                    </p>
                    <p className="truncate text-[11px] text-fg-faint">
                      {sh.start_time.slice(0, 5)} – {sh.end_time.slice(0, 5)}
                      {sh.break_minutes > 0 ? ` · ${sh.break_minutes}m break` : ""}
                      {sh.notes ? ` · ${sh.notes}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-right">
                    <span className="block font-display text-sm font-semibold tabular-nums text-fg">
                      {fmtHours(sh.hours)}
                    </span>
                    <span className="block text-[10px] text-fg-faint">rostered</span>
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <Card id="my-documents" className="mt-6 p-0 scroll-mt-24">
        <h3 className="px-5 pt-4 font-semibold text-fg">My documents</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs uppercase text-fg-faint">
                <th className="px-5 py-2 font-medium">Title</th>
                <th className="px-5 py-2 font-medium">Type</th>
                <th className="px-5 py-2 font-medium">Status</th>
                <th className="px-5 py-2 font-medium">Expiry</th>
                <th className="px-5 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {docs.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-6 text-center text-fg-faint">No documents shared with you yet.</td></tr>
              ) : docs.map((d) => {
                const req = requests.find((r) => r.document_id === d.id);
                return (
                <tr key={d.id} className="border-b border-line">
                  <td className="px-5 py-2 font-medium text-fg">{d.title}</td>
                  <td className="px-5 py-2 text-fg-faint">{d.doc_type.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="px-5 py-2">
                    {req?.status === "APPROVED" ? (
                      <Badge tone="green">approved ✓</Badge>
                    ) : req?.status === "UPLOADED" ? (
                      <Badge tone="amber">awaiting approval</Badge>
                    ) : (
                      <Badge tone="slate">shared</Badge>
                    )}
                  </td>
                  <td className="px-5 py-2 text-fg-faint">{d.expiry_date || "—"}</td>
                  <td className="px-5 py-2 text-right">
                    <button onClick={() => downloadFile(`/me/documents/${d.id}/download`, docName(emp.full_name, d.doc_type, d.filename))} className="rounded-md border border-line px-2 py-1 text-xs text-brand-300 hover:bg-brand-400/10">Download</button>
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
