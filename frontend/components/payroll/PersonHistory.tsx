"use client";

// One person's whole pay record: every payslip they ever had.

import { useEffect, useState } from "react";

import { payMethodLabel } from "@/components/MarkPaidPopup";
import { Select } from "@/components/Select";
import { SheetPopup } from "@/components/SheetPopup";
import { Badge } from "@/components/ui";
import { Figure, Pager } from "@/components/payroll/bits";
import {
  sayDay,
  sayDays,
  sayMinutes,
  type SlipStatus,
  slipTone,
  slipWord,
  sumPence,
} from "@/components/payroll/lib";
import { api, downloadFile, type Employee } from "@/lib/api";
import { useCurrency } from "@/lib/currency";

interface History {
  employee: {
    id: string;
    name: string;
    salary_type: string;
    monthly_salary: string | null;
    hourly_rate: string | null;
  };
  runs: {
    id: string;
    run_number: number | null;
    label: string;
    days_present: number;
    half_days: number;
    minutes: number;
    net_pay: string;
    status: SlipStatus;
    paid_on: string | null;
    paid_method: string | null;
  }[];
}

const PAGE = 7;

export function PersonHistory({
  employees,
  onClose,
  onOpen,
}: {
  employees: Employee[];
  onClose: () => void;
  onOpen: (payslipId: string) => void;
}) {
  const { format } = useCurrency();
  const [emp, setEmp] = useState("");
  const [hist, setHist] = useState<History | null>(null);
  const [page, setPage] = useState(0);

  useEffect(() => {
    if (!emp) return;
    let live = true;
    setPage(0);
    api
      .get<History>(`/payroll/history/${emp}`)
      .then((h) => live && setHist(h))
      .catch(() => live && setHist(null));
    return () => {
      live = false;
    };
  }, [emp]);

  const rows = hist?.runs ?? [];
  const paid = rows.filter((r) => r.status === "PAID");

  return (
    <SheetPopup onClose={onClose} title="Pay history" subtitle="Everything one person was ever paid" columns={3}>
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <Select
            value={emp}
            onChange={setEmp}
            placeholder="Whose?"
            options={employees.map((e) => ({ value: e.id, label: e.full_name, hint: e.employee_code }))}
          />
          {rows.length > 0 && hist && (
            <button
              type="button"
              onClick={() => downloadFile(`/payroll/history/${emp}/statement.pdf`, `pay-statement-${hist.employee.name}.pdf`)}
              className="mise-btn-flat mise-press min-h-[44px] px-4 text-sm text-fg-soft"
            >
              ⬇ All payslips (PDF)
            </button>
          )}
        </div>
        {hist && (
          <div className="grid grid-cols-3 gap-1.5">
            <Figure
              label="Rate"
              value={
                hist.employee.salary_type === "HOURLY"
                  ? `${format(hist.employee.hourly_rate ?? "0")} an hour`
                  : `${format(hist.employee.monthly_salary ?? "0")} a month`
              }
            />
            <Figure label="Paid" value={format(sumPence(paid.map((r) => r.net_pay)))} tone="mise-tone-good" />
            <Figure
              label="Not paid yet"
              value={format(sumPence(rows.filter((r) => r.status !== "PAID").map((r) => r.net_pay)))}
            />
          </div>
        )}
        {!emp ? (
          <p className="py-6 text-center text-sm text-fg-faint">Pick somebody.</p>
        ) : hist && rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-fg-faint">They have not been in a run yet.</p>
        ) : (
          <div className="mise-card-inset overflow-hidden p-0">
            <ul className="divide-y divide-line/60">
              {rows.slice(page * PAGE, (page + 1) * PAGE).map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="flex min-h-[52px] w-full items-center gap-3 px-3 py-1.5 text-left transition hover:bg-glass/5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">{r.label}</span>
                      <span className="block truncate text-[11px] text-fg-faint">
                        {[
                          r.run_number ? `run ${r.run_number}` : null,
                          sayDays(r.days_present, r.half_days),
                          r.minutes ? sayMinutes(r.minutes) : null,
                          r.paid_on
                            ? `paid ${sayDay(r.paid_on)}${r.paid_method ? `, ${payMethodLabel(r.paid_method).toLowerCase()}` : ""}`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <Badge tone={slipTone(r.status)}>{slipWord(r.status)}</Badge>
                    <span className="w-24 text-right font-display text-base font-semibold tabular-nums text-fg">
                      {format(r.net_pay)}
                    </span>
                    <span aria-hidden className="text-fg-faint">
                      ›
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pager page={page} size={PAGE} total={rows.length} onPage={setPage} />
      </div>
    </SheetPopup>
  );
}
