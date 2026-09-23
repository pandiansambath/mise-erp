"use client";

// One supplier, consolidated — what we bought, what it cost, what we paid.
//
//     "in vendor page for each vednor i need confolsitead report of what we
//      purcahsed from that vedor ..total value till this date to this date
//      or.. last month last 2month tecet...i need a export featrue we can
//      eport as excel , csv pdf tooo... ...with super cool ui show them in UI
//      first...then if user need means he can clikc export and he can
//      downlaod"
//
// SEEN FIRST, DOWNLOADED SECOND. That is the order he asked for and it is the
// right one: a supplier report is the easiest thing in the world to download,
// open, and find covers the wrong three months.
//
// THE PERIOD IS A ROW OF PRESETS, not two date boxes. "last month last 2month
// tecet" is how the question is actually asked, and making somebody work out
// that last month started on the 1st is the kind of small friction that means
// the feature goes unused. The custom range is still there underneath.

import { useCallback, useEffect, useState } from "react";
import { SheetPopup } from "@/components/SheetPopup";
import { api, downloadFile } from "@/lib/api";

type SectionMeta = { key: string; label: string };
type PreviewSection = {
  key: string;
  title: string;
  note: string;
  columns: string[];
  money_cols: number[];
  rows: string[][];
  total: string[] | null;
};
type Preview = {
  vendor_name: string;
  date_from: string;
  date_to: string;
  sections: PreviewSection[];
};

const FORMATS = [
  { ext: "pdf", label: "PDF", icon: "🧾" },
  { ext: "xlsx", label: "Excel", icon: "📊" },
  { ext: "csv", label: "CSV", icon: "📄" },
  { ext: "docx", label: "Word", icon: "📝" },
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The periods people actually ask for, worked out here so nobody has to. */
function presets(): { key: string; label: string; from: string; to: string }[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const monthStart = (back: number) => new Date(y, m - back, 1);
  // Day 0 of the next month is the last day of this one — the trick that avoids
  // a table of month lengths and gets February right on its own.
  const monthEnd = (back: number) => new Date(y, m - back + 1, 0);
  return [
    { key: "this", label: "This month", from: iso(monthStart(0)), to: iso(now) },
    { key: "last", label: "Last month", from: iso(monthStart(1)), to: iso(monthEnd(1)) },
    { key: "2m", label: "Last 2 months", from: iso(monthStart(2)), to: iso(monthEnd(1)) },
    { key: "3m", label: "Last 3 months", from: iso(monthStart(3)), to: iso(monthEnd(1)) },
    { key: "6m", label: "Last 6 months", from: iso(monthStart(6)), to: iso(now) },
    { key: "year", label: "This year", from: iso(new Date(y, 0, 1)), to: iso(now) },
    { key: "all", label: "Everything", from: "2000-01-01", to: iso(now) },
  ];
}

export function VendorReport({
  vendorId,
  vendorName,
  onClose,
}: {
  vendorId: string;
  vendorName: string;
  onClose: () => void;
}) {
  const P = presets();
  const [period, setPeriod] = useState(P[1]); // last month — the usual question
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(P[1].from);
  const [to, setTo] = useState(P[1].to);

  const [catalogue, setCatalogue] = useState<SectionMeta[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ sections: SectionMeta[] }>("/vendors/report/sections")
      .then((r) => setCatalogue(r.sections))
      .catch(() => setCatalogue([]));
  }, []);

  function pick(p: (typeof P)[number]) {
    setPeriod(p);
    setCustom(false);
    setFrom(p.from);
    setTo(p.to);
  }

  const chosen = useCallback(() => {
    if (!catalogue) return "";
    const on = catalogue.filter((s) => !off.has(s.key)).map((s) => s.key);
    return on.length === catalogue.length ? "" : on.join(",");
  }, [catalogue, off]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = `date_from=${from}&date_to=${to}${chosen() ? `&sections=${chosen()}` : ""}`;
      setPreview(await api.get<Preview>(`/vendors/${vendorId}/report?${q}`));
    } catch {
      setError("Could not build this supplier's report.");
    } finally {
      setLoading(false);
    }
  }, [vendorId, from, to, chosen]);

  useEffect(() => {
    if (catalogue) load();
  }, [catalogue, load]);

  async function grab(ext: string) {
    setBusy(ext);
    try {
      const q = `date_from=${from}&date_to=${to}${chosen() ? `&sections=${chosen()}` : ""}`;
      const stem = vendorName.toLowerCase().replace(/\s+/g, "-");
      await downloadFile(`/vendors/${vendorId}/report.${ext}?${q}`, `${stem}-${from}-to-${to}.${ext}`);
    } finally {
      setBusy(null);
    }
  }

  const empty = catalogue !== null && off.size === catalogue.length;

  return (
    <SheetPopup
      title={vendorName}
      subtitle="Everything we have bought from them"
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.ext}
              type="button"
              onClick={() => grab(f.ext)}
              disabled={busy !== null || !preview || empty}
              className="mise-press flex-1 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {busy === f.ext ? "…" : `${f.icon} ${f.label}`}
            </button>
          ))}
        </div>
      }
    >
      {/* ── the period ──────────────────────────────────────────────────── */}
      <div className="mise-card-inset rounded-2xl p-4">
        <p className="text-sm font-semibold text-fg">Over what period</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {P.map((p) => {
            const on = !custom && period.key === p.key;
            return (
              <button
                key={p.key}
                type="button"
                onClick={() => pick(p)}
                className={`mise-press rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  on
                    ? "border-brand-400/50 bg-brand-400/10 text-brand-200"
                    : "border-line text-fg-soft"
                }`}
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setCustom(true)}
            className={`mise-press rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              custom ? "border-brand-400/50 bg-brand-400/10 text-brand-200" : "border-line text-fg-soft"
            }`}
          >
            Pick the dates
          </button>
        </div>

        {custom && (
          <div className="mise-pop mt-3 flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="block text-[11px] text-fg-faint">From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mise-well mt-1 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </label>
            <label className="block">
              <span className="block text-[11px] text-fg-faint">To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mise-well mt-1 rounded-xl px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
        )}
        <p className="mt-2 text-[11px] text-fg-faint">
          {from} to {to}
        </p>
      </div>

      {/* ── what goes in ────────────────────────────────────────────────── */}
      {catalogue && catalogue.length > 0 && (
        <div className="mise-card-inset mt-4 rounded-2xl p-4">
          <p className="text-sm font-semibold text-fg">What to include</p>
          <p className="mt-0.5 text-xs text-fg-faint">
            Everything is in by default. Untick what you do not want.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {catalogue.map((s) => {
              const on = !off.has(s.key);
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() =>
                    setOff((cur) => {
                      const next = new Set(cur);
                      if (next.has(s.key)) next.delete(s.key);
                      else next.add(s.key);
                      return next;
                    })
                  }
                  className={`mise-press rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "border-brand-400/50 bg-brand-400/10 text-brand-200"
                      : "border-line text-fg-faint"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {s.label}
                </button>
              );
            })}
          </div>
          {empty && (
            <p className="mt-3 text-xs text-amber-300">
              Nothing is selected, so the report would be empty. Pick at least one.
            </p>
          )}
        </div>
      )}

      {/* ── what it says ────────────────────────────────────────────────── */}
      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      {loading && !preview && <p className="mt-4 text-sm text-fg-faint">Working it out…</p>}

      {preview?.sections.map((s) => (
        <div key={s.key} className="mise-card-inset mt-4 overflow-hidden rounded-2xl">
          <div className="border-b border-line bg-brand-400/[0.07] px-4 py-2.5">
            <p className="text-sm font-semibold text-fg">{s.title}</p>
            {s.note && <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{s.note}</p>}
          </div>
          {s.rows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-fg-faint">
              Nothing from this supplier in this period.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-fg-faint">
                    {s.columns.map((c, i) => (
                      <th
                        key={c}
                        className={`whitespace-nowrap px-4 py-2 text-[11px] font-medium uppercase tracking-wide ${
                          s.money_cols.includes(i) ? "text-right" : "text-left"
                        }`}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {s.rows.slice(0, 12).map((row, j) => (
                    <tr key={j} className={j % 2 ? "bg-glass/[0.03]" : ""}>
                      {row.map((v, i) => (
                        <td
                          key={i}
                          className={`whitespace-nowrap px-4 py-1.5 ${
                            s.money_cols.includes(i)
                              ? "text-right tabular-nums text-fg"
                              : "text-fg-soft"
                          }`}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {s.total && (
                    <tr className="border-t border-line font-semibold">
                      {s.total.map((v, i) => (
                        <td
                          key={i}
                          className={`whitespace-nowrap px-4 py-2 ${
                            s.money_cols.includes(i) ? "text-right tabular-nums text-fg" : "text-fg"
                          }`}
                        >
                          {v}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
              {s.rows.length > 12 && (
                <p className="px-4 pb-3 pt-1 text-[11px] text-fg-faint">
                  …and {s.rows.length - 12} more. All of them are in the download.
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </SheetPopup>
  );
}
