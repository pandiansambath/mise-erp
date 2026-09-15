"use client";

// /control-room/plans — the price editor, joined by the feature × plan matrix
// the Control Room has never shown (ARCHITECTURE.md correction to the brief:
// `/platform/plans/matrix` IS called, but only by the tenant-facing /plan
// page — an operator has never been able to see what each plan includes
// while editing what it costs).

import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { useOperatorQuery, errorCopy } from "@/components/controlroom/useOperatorQuery";
import { Button, Card, PageHeader, Spinner } from "@/components/ui";

type PlanFull = {
  key: string;
  label: string;
  price_hint: string;
  price_annual_hint: string;
  max_users: number;
  blurb: string;
  ai_model_label: string;
  ai_daily_requests: number;
  ai_monthly_tokens: number;
  trial_days: number;
};

type FeatureRow = {
  key: string;
  label: string;
  description: string;
  is_ai: boolean;
  core: boolean;
  plans: Record<string, boolean>;
};

type MatrixResp = { features: FeatureRow[]; plans: PlanFull[] };

function ErrorCard({ error, onRetry }: { error: ApiError; onRetry: () => void }) {
  return (
    <div className="mise-card-inset relative flex items-start gap-3 overflow-hidden p-4 pl-5">
      <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-rose-400" />
      <span className="font-mono text-2xl font-bold leading-none text-danger">
        {error.status || "!"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-fg">This did not load</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-soft">{errorCopy(error)}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mise-btn-flat mise-press shrink-0 px-3 py-1.5 text-xs font-semibold"
      >
        Retry
      </button>
    </div>
  );
}

export default function PlansPage() {
  const matrixQ = useOperatorQuery<MatrixResp>("/platform/plans/matrix");
  // `/platform/plans/matrix` calls plans_public() with no override — it always
  // reflects the DEFAULT price, never what the operator saved. Seeding the
  // price editor from it meant the box reverted to the default on every visit,
  // and a Save then wiped the saved override wholesale (set_plan_prices
  // replaces plan_prices, it doesn't merge). `/platform/plans` passes the
  // saved overrides through, so the price editor reads from here instead —
  // the matrix query stays purely for the feature grid + per-plan blurb.
  const plansQ = useOperatorQuery<{ plans: PlanFull[] }>("/platform/plans");

  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [priceErr, setPriceErr] = useState<string | null>(null);
  const [priceMsg, setPriceMsg] = useState<string | null>(null);

  useEffect(() => {
    if (plansQ.data) {
      setPriceEdits(Object.fromEntries(plansQ.data.plans.map((p) => [p.key, p.price_hint])));
    }
  }, [plansQ.data]);

  async function savePrices() {
    setSavingPrices(true);
    setPriceErr(null);
    setPriceMsg(null);
    try {
      // Re-seed from the PATCH response so the box reflects exactly what was
      // saved, rather than re-fetching a different (unoverridden) endpoint.
      const res = await api.patch<{ plans: PlanFull[] }>("/platform/plans/prices", {
        prices: priceEdits,
      });
      setPriceEdits(Object.fromEntries(res.plans.map((p) => [p.key, p.price_hint])));
      setPriceMsg("Saved — live on the pricing page.");
      window.setTimeout(() => setPriceMsg(null), 3000);
    } catch (err) {
      setPriceErr(err instanceof ApiError ? err.message : "Could not save prices.");
    } finally {
      setSavingPrices(false);
    }
  }

  const plans = matrixQ.data?.plans ?? [];
  const features = matrixQ.data?.features ?? [];
  const loadError = matrixQ.error ?? plansQ.error;
  const stillLoading = matrixQ.loading || plansQ.loading || !matrixQ.data || !plansQ.data;
  const retryAll = () => {
    matrixQ.reload();
    plansQ.reload();
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Plans"
        subtitle="What each tier costs, and what it actually includes — the two things an operator has never seen side by side."
      />

      {loadError ? (
        <ErrorCard error={loadError} onRetry={retryAll} />
      ) : stillLoading ? (
        <Spinner />
      ) : (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                Displayed prices
              </h3>
              <Button variant="primary" size="sm" onClick={savePrices} busy={savingPrices}>
                Save prices
              </Button>
            </div>
            {priceErr && <p className="mt-2 text-xs font-medium text-danger">{priceErr}</p>}
            {priceMsg && <p className="mt-2 text-xs font-medium text-brand-300">{priceMsg}</p>}

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {plans.map((p) => (
                <div key={p.key} className="mise-well rounded-xl p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-fg">{p.label}</p>
                    <span className="mise-chip" data-tone="slate">
                      {p.max_users >= 100000 ? "∞ users" : `${p.max_users} users`}
                    </span>
                  </div>
                  <input
                    value={priceEdits[p.key] ?? ""}
                    onChange={(e) => setPriceEdits({ ...priceEdits, [p.key]: e.target.value })}
                    placeholder="e.g. £79/mo"
                    className="mise-well mt-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  <p className="mt-1 text-[11px] text-fg-faint">annual: {p.price_annual_hint}</p>
                  <dl className="mt-3 space-y-1 border-t border-line/60 pt-2.5 text-[11px]">
                    <div className="flex justify-between">
                      <dt className="text-fg-faint">AI model</dt>
                      <dd className="font-medium text-fg-soft">{p.ai_model_label}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-fg-faint">AI requests</dt>
                      <dd className="font-mono tabular-nums text-fg-soft">{p.ai_daily_requests}/day</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-fg-faint">AI tokens</dt>
                      <dd className="font-mono tabular-nums text-fg-soft">
                        {p.ai_monthly_tokens.toLocaleString("en-GB")}/mo
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-fg-faint">Free trial</dt>
                      <dd className="font-medium text-fg-soft">
                        {p.trial_days > 0 ? `${p.trial_days} days` : "none"}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-0">
            <div className="px-4 pt-4">
              <h3 className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-faint">
                Feature matrix
              </h3>
              <p className="mt-1 text-xs text-fg-faint">
                Every feature, every plan — the same registry the app enforces from, not a
                separate copy that can drift.
              </p>
            </div>
            <div className="mt-3 overflow-x-auto border-t border-line">
              <table className="mise-stack w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left font-mono text-[10px] uppercase tracking-[0.14em] text-fg-faint">
                    <th className="px-4 py-2">Feature</th>
                    {plans.map((p) => (
                      <th key={p.key} className="px-3 py-2 text-center">
                        {p.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {features.map((f) => (
                    <tr key={f.key} className="border-b border-line/60">
                      <td className="px-4 py-1.5">
                        <span className="text-xs font-medium text-fg">{f.label}</span>
                        {f.core && (
                          <span className="mise-chip ml-2" data-tone="slate">
                            core
                          </span>
                        )}
                      </td>
                      {plans.map((p) => (
                        <td key={p.key} data-label={p.label} className="px-3 py-1.5 text-center">
                          {f.plans[p.key] ? (
                            <span className="text-sm font-semibold text-brand-400">✓</span>
                          ) : (
                            <span className="text-sm text-fg-faint">–</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
