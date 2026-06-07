"use client";

import { Card, PageHeader } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { CURRENCIES, type CurrencyCode, useCurrency } from "@/lib/currency";

export default function SettingsPage() {
  const { currency, setCurrency } = useCurrency();
  const { user } = useAuth();

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
