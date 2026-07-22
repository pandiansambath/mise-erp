"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, API_BASE, ApiError, postForm, type Expense, type ExpenseCategory } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui";
import { Select } from "@/components/Select";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

// Overhead billing periods. A quarterly/annual amount is the TOTAL for that period;
// on post it's SPREAD evenly into that many monthly rows so the P&L stays smooth
// (nothing downstream changes — every row is still a normal monthly expense).
const PERIOD_MONTHS: Record<string, number> = { MONTHLY: 1, QUARTERLY: 3, ANNUAL: 12 };
const PERIOD_OPTS = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "Quarterly" },
  { value: "ANNUAL", label: "Annual" },
];
/** "YYYY-MM-01" for the month `add` months after `base` (handles year rollover). */
function monthStartAfter(base: Date, add: number): string {
  const d = new Date(base.getFullYear(), base.getMonth() + add, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export default function ProfilePage() {
  const { user, hotel, refreshHotel } = useAuth();
  const canExpenses = can(user?.role, "expenses:write");
  const canBrand = user?.role === "SUPER_ADMIN";
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthLabel = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // ── Monthly overheads (recurring fixed costs) ──────────────────────────────
  const [fixedCats, setFixedCats] = useState<ExpenseCategory[]>([]);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [periods, setPeriods] = useState<Record<string, string>>({}); // catId -> MONTHLY|QUARTERLY|ANNUAL
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── Change password ────────────────────────────────────────────────────────
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (pw.next.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwMsg({ ok: false, text: "New passwords don't match." });
      return;
    }
    setPwBusy(true);
    try {
      await api.post("/auth/change-password", { current_password: pw.current, new_password: pw.next });
      setPw({ current: "", next: "", confirm: "" });
      setPwMsg({ ok: true, text: "✓ Password changed — use it next time you log in." });
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof ApiError ? err.message : "Could not change password" });
    } finally {
      setPwBusy(false);
    }
  }

  // ── Hotel brand logo ────────────────────────────────────────────────────────
  const logoInput = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState<string | null>(null);
  const [logoVer, setLogoVer] = useState(0); // cache-buster for the preview after upload
  const [logoDrag, setLogoDrag] = useState(false);
  const logoSrc = hotel?.has_logo ? `${API_BASE}/api/hotels/${hotel.id}/logo?v=${logoVer}` : null;

  async function uploadLogo(file: File | undefined) {
            if (!file) return;
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await postForm("/hotels/logo", fd);
      await refreshHotel();
      setLogoVer((v) => v + 1);
      setLogoMsg("✓ Logo updated — it now appears across the app and on your PDFs.");
    } catch (err) {
      setLogoMsg(err instanceof ApiError ? err.message : "Could not upload the logo.");
    } finally {
      setLogoBusy(false);
    }
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    await uploadLogo(file);
  }

  async function removeLogo() {
    setLogoBusy(true);
    setLogoMsg(null);
    try {
      await api.delete("/hotels/logo");
      await refreshHotel();
      setLogoMsg("Logo removed — back to the default Mise mark.");
    } catch (err) {
      setLogoMsg(err instanceof ApiError ? err.message : "Could not remove the logo.");
    } finally {
      setLogoBusy(false);
    }
  }

  useEffect(() => {
    if (!canExpenses) return;
    const from = new Date();
    from.setDate(from.getDate() - 150);
    Promise.all([
      api.get<ExpenseCategory[]>("/expenses/categories"),
      api.get<Expense[]>(`/expenses?date_from=${iso(from)}&date_to=${iso(new Date())}`),
    ])
      .then(([cats, exps]) => {
        // Staff Salaries is EXCLUDED here on purpose: approved payroll posts real
        // wages into Expenses automatically — typing it again would double-count.
        const fixed = cats.filter(
          (c) => c.kind === "FIXED" && c.is_active && c.name !== "Staff Salaries"
        );
        setFixedCats(fixed);
        setRecent(exps);
        const pre: Record<string, string> = {};
        for (const c of fixed) {
          const latest = exps
            .filter((e) => e.category_id === c.id && e.is_recurring)
            .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
          if (latest) pre[c.id] = latest.amount;
        }
        setAmounts(pre);
      })
      .catch(() => {});
  }, [canExpenses]);

  const postedThisMonth = (catId: string) =>
    recent.some((e) => e.category_id === catId && e.date >= monthStart && e.is_recurring);

  async function postOverheads() {
    setPosting(true);
    setMsg(null);
    let posted = 0;
    try {
      for (const c of fixedCats) {
        const amt = amounts[c.id];
        if (!amt || !(parseFloat(amt) > 0) || postedThisMonth(c.id)) continue;
        const period = periods[c.id] || "MONTHLY";
        const months = PERIOD_MONTHS[period] ?? 1;
        const total = Math.round(parseFloat(amt) * 100) / 100;
        // Split evenly; any rounding pennies go on the first month.
        const per = Math.floor((total / months) * 100) / 100;
        const remainder = Math.round((total - per * months) * 100) / 100;
        for (let i = 0; i < months; i++) {
          const monthAmt = i === 0 ? per + remainder : per;
          await api.post<Expense>("/expenses", {
            category_id: c.id,
            date: monthStartAfter(now, i),
            amount: monthAmt.toFixed(2),
            is_recurring: true,
            recurrence: "MONTHLY", // always monthly rows so the P&L stays smooth
            description:
              months > 1
                ? `${c.name} (${period.toLowerCase()} split ${i + 1}/${months})`
                : `Monthly ${c.name}`,
          });
        }
        posted += 1;
      }
      const from = new Date();
      from.setDate(from.getDate() - 150);
      setRecent(await api.get<Expense[]>(`/expenses?date_from=${iso(from)}&date_to=${iso(new Date())}`));
      setMsg(
        posted > 0
          ? `Posted ${posted} overhead${posted === 1 ? "" : "s"} — quarterly/annual amounts were spread evenly across their months.`
          : "Nothing to post — this month is already set.",
      );
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "Could not post");
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Profile" subtitle="Your account in Mise." />

      {canBrand && (
        <Card
          className={`mb-6 transition-all duration-200 ${logoDrag ? "border-brand-400/60 bg-brand-400/5 ring-2 ring-brand-400/30" : ""}`}
          onDragOver={(e: React.DragEvent) => { e.preventDefault(); setLogoDrag(true); }}
          onDragLeave={() => setLogoDrag(false)}
          onDrop={(e: React.DragEvent) => {
            e.preventDefault();
            setLogoDrag(false);
            uploadLogo(e.dataTransfer.files?.[0]);
          }}
        >
          <input ref={logoInput} type="file" accept="image/png,image/jpeg" className="hidden" onChange={onLogoFile} />
          <div className="flex flex-wrap items-center gap-4">
            <div className="mise-well grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl">
              {logoBusy ? (
                <span className="mise-upload-ring" aria-label="Uploading" />
              ) : logoSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={logoVer} src={logoSrc} alt="Hotel logo" className="mise-pop h-full w-full object-contain" />
              ) : (
                <span className="text-2xl" aria-hidden>🏨</span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-fg">Hotel logo</h3>
              <p className="text-sm text-fg-faint">
                {logoDrag
                  ? "Drop it here —"
                  : "Drag a PNG/JPG anywhere on this card, or use the button."}{" "}
                Up to 2 MB. Replaces the Mise mark across the app and on your payslip / purchase-order PDFs.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => logoInput.current?.click()} disabled={logoBusy} className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
                {logoBusy ? "Saving…" : hotel?.has_logo ? "Replace" : "Upload logo"}
              </button>
              {hotel?.has_logo && (
                <button onClick={removeLogo} disabled={logoBusy} className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-soft hover:bg-paper-2 disabled:opacity-60">
                  Remove
                </button>
              )}
            </div>
          </div>
          {logoMsg && <p className="mt-3 text-sm text-brand-300">{logoMsg}</p>}
        </Card>
      )}

      <Card>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
            {initial}
          </div>
          <div>
            <p className="text-lg font-semibold text-fg">{user?.email}</p>
            <p className="text-sm text-fg-faint">{user?.role.replace(/_/g, " ")}</p>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-4 border-t border-line pt-6 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-fg-faint">Email</dt>
            <dd className="font-medium text-fg">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Role</dt>
            <dd className="font-medium text-fg">{user?.role.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-fg-faint">Status</dt>
            <dd className="font-medium text-brand-400">{user?.is_active ? "Active" : "Inactive"}</dd>
          </div>
        </dl>
      </Card>

      {hotel && (
        <Card className="mt-6">
          <h3 className="font-semibold text-fg">Restaurant</h3>
          <dl className="mt-3 grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-fg-faint">Name</dt>
              <dd className="font-medium text-fg">{hotel.name}</dd>
            </div>
            <div>
              <dt className="text-fg-faint">Location</dt>
              <dd className="font-medium text-fg">
                {hotel.city ? `${hotel.city}, ` : ""}
                {hotel.country}
              </dd>
            </div>
            <div>
              <dt className="text-fg-faint">Base currency</dt>
              <dd className="font-medium text-fg">{hotel.base_currency}</dd>
            </div>
          </dl>
        </Card>
      )}

      {canExpenses && (
        <Card className="mt-6">
          <h3 className="font-semibold text-fg">Overheads (fixed costs)</h3>
          <p className="mt-1 text-sm text-fg-faint">
            Your standing fixed costs (rent, gas, electricity…). Set each one&apos;s amount and how
            often it&apos;s billed, then post — they flow straight into your P&amp;L. Amounts remember
            last month&apos;s figures.
          </p>
          <p className="mt-2 rounded-lg border border-line bg-paper-2/50 p-2.5 text-xs leading-relaxed text-fg-faint">
            💡 <b className="text-fg-soft">Quarterly / annual are split evenly.</b> Rent is usually
            <b className="text-fg-soft"> Monthly</b>; a £1,200 <b className="text-fg-soft">Annual</b> insurance
            posts as <b className="text-fg-soft">£100 × 12 months</b>; a £3,000 <b className="text-fg-soft">Quarterly</b> rent
            as <b className="text-fg-soft">£1,000 × 3</b>. This keeps every month&apos;s profit accurate — one big
            bill never distorts a single month. (Each split is still an ordinary monthly expense, so nothing
            else changes.)
          </p>
          <p className="mt-2 rounded-lg border border-line bg-paper-2/50 p-2.5 text-xs leading-relaxed text-fg-faint">
            <b className="text-fg-soft">&ldquo;Staff Salaries&rdquo; here</b> is a single lump-sum estimate of monthly wages,
            so your P&amp;L has a labour cost even before you run payroll. It is <b className="text-fg-soft">not</b> the same as{" "}
            <Link href="/payroll" className="text-brand-400 underline">Payroll</Link> — that pays each person from their own rate
            (set on <Link href="/employees" className="text-brand-400 underline">Employees</Link>). Use this lump line for a quick
            forecast; use Payroll for the real, per-person pay run.
          </p>
          {fixedCats.length === 0 ? (
            <p className="mt-4 text-sm text-fg-faint">
              No fixed expense categories yet — add some on the Expenses page (kind: fixed).
            </p>
          ) : (
            <>
              <div className="mt-4 space-y-2">
                {fixedCats.map((c) => {
                  const period = periods[c.id] || "MONTHLY";
                  const months = PERIOD_MONTHS[period] ?? 1;
                  const amt = parseFloat(amounts[c.id] || "0");
                  const monthlyEq = amt / months;
                  const totalEq = fixedCats.reduce(
                    (t, x) =>
                      t +
                      (parseFloat(amounts[x.id] || "0") || 0) /
                        (PERIOD_MONTHS[periods[x.id] || "MONTHLY"] ?? 1),
                    0,
                  );
                  return (
                    <div key={c.id}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-[7rem] flex-1 text-sm text-fg-soft">{c.name}</span>
                      {postedThisMonth(c.id) ? (
                        <span className="text-xs font-medium text-brand-400">✓ posted for {monthLabel}</span>
                      ) : (
                        <>
                          <Select
                            value={period}
                            onChange={(v) => setPeriods({ ...periods, [c.id]: v })}
                            options={PERIOD_OPTS}
                            className="w-32"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amounts[c.id] ?? ""}
                            onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                            placeholder={`total / ${period.toLowerCase()}`}
                            className="w-32 rounded-lg border border-line-2 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
                          />
                          {months > 1 && amt > 0 && (
                            <span className="text-[11px] text-fg-faint">
                              = {(amt / months).toFixed(2)}/mo × {months}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                    {monthlyEq > 0 && totalEq > 0 && (
                      // this line's share of the monthly overhead bill
                      <div className="mt-1 flex items-center gap-2 pl-1">
                        <span className="mise-well h-1.5 flex-1 overflow-hidden rounded-full">
                          <span
                            className="block h-full rounded-full bg-copper-500/70 transition-[width] duration-500"
                            style={{ width: `${Math.max(2, (monthlyEq / totalEq) * 100)}%` }}
                          />
                        </span>
                        <span className="w-10 text-right text-[10px] tabular-nums text-fg-faint">
                          {Math.round((monthlyEq / totalEq) * 100)}%
                        </span>
                      </div>
                    )}
                    </div>
                  );
                })}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={postOverheads}
                  disabled={posting}
                  className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {posting ? "Posting…" : `Post overheads (from ${monthLabel})`}
                </button>
                {msg && <span className="text-sm text-fg-faint">{msg}</span>}
              </div>
            </>
          )}
        </Card>
      )}

      <Card className="mt-6">
        <h3 className="font-semibold text-fg">Change password</h3>
        <p className="mt-1 text-sm text-fg-faint">
          Enter your current password and choose a new one (at least 8 characters).
        </p>
        <form onSubmit={changePassword} className="mt-4 max-w-sm space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-fg-faint">Current password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-fg-faint">New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
            />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-fg-faint">Confirm new password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              className="mt-1 w-full rounded-lg border border-line-2 bg-glass/5 px-3 py-2 text-sm text-fg outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
            />
          </label>
          {pwMsg && (
            <p className={`text-sm ${pwMsg.ok ? "text-brand-400" : "text-rose-400"}`}>{pwMsg.text}</p>
          )}
          <button
            type="submit"
            disabled={pwBusy || !pw.current || !pw.next}
            className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {pwBusy ? "Updating…" : "Update password"}
          </button>
        </form>
        <p className="mt-4 border-t border-line pt-3 text-xs text-fg-faint">
          Two-factor and Google sign-in are on the roadmap.
        </p>
      </Card>
    </div>
  );
}
