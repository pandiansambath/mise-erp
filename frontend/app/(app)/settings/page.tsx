"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";

export default function SettingsPage() {
  const { currency, setCurrency } = useCurrency();
  const { user, hotel } = useAuth();
  const isAdmin = user?.role === "SUPER_ADMIN";

  const [allowance, setAllowance] = useState("0");
  const [penalty, setPenalty] = useState("0");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [savedPolicy, setSavedPolicy] = useState(false);

  useEffect(() => {
    if (hotel) {
      setAllowance(String(hotel.break_allowance_minutes ?? 0));
      setPenalty(hotel.break_penalty_per_min ?? "0");
    }
  }, [hotel]);

  async function saveBreakPolicy(e: React.FormEvent) {
    e.preventDefault();
    setSavingPolicy(true);
    setSavedPolicy(false);
    try {
      await api.patch("/hotels/me", {
        break_allowance_minutes: parseInt(allowance || "0", 10),
        break_penalty_per_min: penalty || "0",
      });
      setSavedPolicy(true);
    } finally {
      setSavingPolicy(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

  return (
    <div className="max-w-2xl">
      <PageHeader title="Settings" subtitle="Display preferences and account." />

      <Card className="mb-6">
        <h3 className="font-semibold text-slate-900">Display currency</h3>
        <p className="mt-1 text-sm text-slate-500">
          Amounts are stored in the restaurant&apos;s base currency (GBP). This converts
          what you see — it doesn&apos;t change the underlying figures.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {(Object.keys(CURRENCIES) as CurrencyCode[]).map((code) => {
            const active = currency === code;
            return (
              <button
                key={code}
                onClick={() => setCurrency(code)}
                className={`flex items-center justify-between rounded-lg border px-4 py-3 text-left transition ${
                  active
                    ? "border-brand-500 bg-brand-50"
                    : "border-slate-200 hover:border-slate-300"
                }`}
              >
                <span className="font-medium text-slate-800">
                  {CURRENCIES[code].symbol} {code}
                </span>
                <span className="text-sm text-slate-500">{CURRENCIES[code].label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Indicative rates (per £1): {" "}
          {(Object.keys(CURRENCIES) as CurrencyCode[])
            .map((c) => `${CURRENCIES[c].symbol}${CURRENCIES[c].rate}`)
            .join("  ·  ")}
        </p>
      </Card>

      {isAdmin && (
        <Card className="mb-6">
          <h3 className="font-semibold text-slate-900">Attendance: break &amp; penalty policy</h3>
          <p className="mt-1 text-sm text-slate-500">
            Paid break minutes allowed per shift. Minutes beyond this are flagged on the
            timesheet and charged at the penalty rate below.
          </p>
          <form onSubmit={saveBreakPolicy} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="sm:w-48">
              <label className="block text-sm font-medium text-slate-700">Break allowance (minutes)</label>
              <input value={allowance} onChange={(e) => setAllowance(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
            <div className="sm:w-48">
              <label className="block text-sm font-medium text-slate-700">
                Penalty per extra minute ({hotel?.base_currency ?? "GBP"})
              </label>
              <input value={penalty} onChange={(e) => setPenalty(e.target.value)} inputMode="decimal" className={inputCls} />
            </div>
            <button type="submit" disabled={savingPolicy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60">
              {savingPolicy ? "Saving…" : "Save policy"}
            </button>
            {savedPolicy && <span className="text-sm text-brand-600">Saved ✓</span>}
          </form>
          <p className="mt-2 text-xs text-slate-400">
            Set allowance to 0 with a 0 penalty to disable break penalties.
          </p>
        </Card>
      )}

      <Card>
        <h3 className="font-semibold text-slate-900">Account</h3>
        <dl className="mt-3 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="font-medium text-slate-800">{user?.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium text-slate-800">{user?.role.replace(/_/g, " ")}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
