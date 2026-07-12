"use client";

import { useEffect, useMemo, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";
import { Sparkline } from "@/components/charts";

/** Friendly label + tone per action code. */
const ACTIONS: Record<string, { label: string; tone: "slate" | "green" | "red" | "amber" }> = {
  "vendor.price": { label: "Price set", tone: "amber" },
  "vendor.chosen": { label: "Supplier chosen", tone: "green" },
  "po.received": { label: "PO received", tone: "green" },
  "stock.waste": { label: "Waste logged", tone: "red" },
};

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api
      .get<AuditEvent[]>("/audit")
      .then(setEvents)
      .catch(() => setErr("Could not load the audit log."));
  }, []);

  // events per day, last 14 days — the house's pulse
  const pulse = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const e of events ?? []) {
      const d = e.created_at.slice(0, 10);
      byDay.set(d, (byDay.get(d) ?? 0) + 1);
    }
    const out: number[] = [];
    const labels: string[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
      labels.push(d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }));
    }
    return { out, labels };
  }, [events]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return events ?? [];
    return (events ?? []).filter(
      (e) =>
        e.summary.toLowerCase().includes(s) ||
        (e.user_email ?? "").toLowerCase().includes(s) ||
        e.action.toLowerCase().includes(s),
    );
  }, [events, q]);

  if (err) return <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{err}</p>;
  if (!events) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what — price changes, chosen suppliers, received POs and waste. Newest first."
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="mise-well flex max-w-sm flex-1 items-center gap-2 rounded-xl px-3.5 py-2">
          <span aria-hidden className="text-fg-faint">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by person, action or words…"
            className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
        {pulse.out.some((n) => n > 0) && (
          <div className="mise-well mise-feel flex items-center gap-3 rounded-xl px-4 py-2">
            <Sparkline data={pulse.out} labels={pulse.labels} formatValue={(v) => `${v} action${v === 1 ? "" : "s"}`} height={28} />
            <span className="text-[11px] text-fg-faint">activity · 14d</span>
          </div>
        )}
      </div>

      <Card className="p-0">
        {filtered.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-faint">
            {q ? `Nothing matches “${q}”.` : "No activity logged yet. Money-trust actions (price changes, receiving stock, waste…) will appear here."}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {filtered.map((e) => {
              const a = ACTIONS[e.action] ?? { label: e.action, tone: "slate" as const };
              const initials = (e.user_email || "?").slice(0, 2).toUpperCase();
              return (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3">
                  <span aria-hidden className="mise-raised mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-brand-300">
                    {initials}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Badge tone={a.tone}>{a.label}</Badge>
                    </span>
                    <span className="mt-1 block text-sm text-fg">{e.summary}</span>
                    <span className="block text-xs text-fg-faint">{e.user_email || "—"}</span>
                  </span>
                  <span className="shrink-0 whitespace-nowrap text-xs text-fg-faint">{when(e.created_at)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
