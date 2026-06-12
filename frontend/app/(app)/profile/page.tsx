"use client";

import { useEffect, useState } from "react";
import { api, ApiError, type Expense, type ExpenseCategory } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { can } from "@/lib/permissions";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function ProfilePage() {
  const { user, hotel } = useAuth();
  const canExpenses = can(user?.role, "expenses:write");
  const initial = user?.email?.[0]?.toUpperCase() ?? "?";

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthLabel = now.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  // ── Monthly overheads (recurring fixed costs) ──────────────────────────────
  const [fixedCats, setFixedCats] = useState<ExpenseCategory[]>([]);
  const [recent, setRecent] = useState<Expense[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [posting, setPosting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!canExpenses) return;
    const from = new Date();
    from.setDate(from.getDate() - 150);
    Promise.all([
      api.get<ExpenseCategory[]>("/expenses/categories"),
      api.get<Expense[]>(`/expenses?date_from=${iso(from)}&date_to=${iso(new Date())}`),
    ])
      .then(([cats, exps]) => {
        const fixed = cats.filter((c) => c.kind === "FIXED" && c.is_active);
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
        await api.post<Expense>("/expenses", {
          category_id: c.id,
          date: monthStart,
          amount: amt,
          is_recurring: true,
          recurrence: "MONTHLY",
          description: `Monthly ${c.name}`,
        });
        posted += 1;
      }
      const from = new Date();
      from.setDate(from.getDate() - 150);
      setRecent(await api.get<Expense[]>(`/expenses?date_from=${iso(from)}&date_to=${iso(new Date())}`));
      setMsg(
        posted > 0
          ? `Posted ${posted} overhead${posted === 1 ? "" : "s"} to ${monthLabel}.`
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
          <h3 className="font-semibold text-fg">Monthly overheads</h3>
          <p className="mt-1 text-sm text-fg-faint">
            Your standing fixed costs (rent, gas, electricity…). Set the amounts and post them to
            this month&apos;s expenses in one click — they flow straight into your P&amp;L. Amounts
            remember last month&apos;s figures.
          </p>
          {fixedCats.length === 0 ? (
            <p className="mt-4 text-sm text-fg-faint">
              No fixed expense categories yet — add some on the Expenses page (kind: fixed).
            </p>
          ) : (
            <>
              <div className="mt-4 space-y-2">
                {fixedCats.map((c) => (
                  <div key={c.id} className="flex items-center gap-3">
                    <span className="flex-1 text-sm text-fg-soft">{c.name}</span>
                    {postedThisMonth(c.id) ? (
                      <span className="text-xs font-medium text-brand-400">✓ posted for {monthLabel}</span>
                    ) : (
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amounts[c.id] ?? ""}
                        onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                        placeholder="amount"
                        className="w-28 rounded-lg border border-line-2 px-3 py-1.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25"
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={postOverheads}
                  disabled={posting}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
                >
                  {posting ? "Posting…" : `Post to ${monthLabel}`}
                </button>
                {msg && <span className="text-sm text-fg-faint">{msg}</span>}
              </div>
            </>
          )}
        </Card>
      )}

      <Card className="mt-6">
        <h3 className="font-semibold text-fg">Security</h3>
        <p className="mt-1 text-sm text-fg-faint">
          Change-password, two-factor, and Google sign-in are on the roadmap.
        </p>
        <button
          disabled
          className="mt-3 cursor-not-allowed rounded-lg border border-line px-4 py-2 text-sm font-medium text-fg-faint"
        >
          Change password (coming soon)
        </button>
      </Card>
    </div>
  );
}
