"use client";

import { useEffect, useState } from "react";
import { api, type AuditEvent } from "@/lib/api";
import { Badge, Card, PageHeader, Spinner } from "@/components/ui";

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

  useEffect(() => {
    api
      .get<AuditEvent[]>("/audit")
      .then(setEvents)
      .catch(() => setErr("Could not load the audit log."));
  }, []);

  if (err) return <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-300">{err}</p>;
  if (!events) return <Spinner />;

  return (
    <div>
      <PageHeader
        title="Audit log"
        subtitle="Who changed what — price changes, chosen suppliers, received POs and waste. Newest first."
      />
      <Card className="p-0">
        {events.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-faint">
            No activity logged yet. Money-trust actions (price changes, receiving stock, waste…)
            will appear here.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {events.map((e) => {
              const a = ACTIONS[e.action] ?? { label: e.action, tone: "slate" as const };
              return (
                <li key={e.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
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
