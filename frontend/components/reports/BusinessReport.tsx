"use client";

// The consolidated business report — everything about a period, one document.
//
//     "i need one consolidated super spceial export feature in pnl area that
//      includes litrelly al thre details like expense , sales, money ectetc
//      (for particluar days or whatever we choose)"
//     "have in excel, csv, pdf, words in all fomr we need to allwo user to
//      dnwload... please use cool colors and decorotaew with stuff"
//     "also have a cusotmised feature like ask user whther to iunclude tis
//      calcuateion or not or leave empty to keep default whihc give all the
//      consoldiated things as our sampe report"
//
// Modelled on the MBR he sent — `docs/Nirai_August_2026_Updated_MBR_v2.pdf`.
// Its shape is the specification: a stack of TITLED SECTIONS, each with its own
// total, and a note that is allowed to say what a number does not cover.
//
// EVERYTHING IS ON BY DEFAULT, because that is what "leave empty to keep
// default" means. The picker exists to take things OUT — a chooser that starts
// empty makes the common case the most work.
//
// IT PREVIEWS BEFORE IT DOWNLOADS. A report is the easiest thing in the world
// to download, open, and find is the wrong three weeks — and he has asked for a
// preview before a final action more than once.

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
  hotel_name: string;
  date_from: string;
  date_to: string;
  sections: PreviewSection[];
};

/** The four, in the order he listed them. */
const FORMATS = [
  { ext: "pdf", label: "PDF", icon: "🧾", hint: "to send or print" },
  { ext: "xlsx", label: "Excel", icon: "📊", hint: "a sheet per section, summable" },
  { ext: "docx", label: "Word", icon: "📝", hint: "to edit before sending on" },
  { ext: "csv", label: "CSV", icon: "📄", hint: "plain, for anything else" },
] as const;

export function BusinessReport({
  from,
  to,
  onClose,
}: {
  from: string;
  to: string;
  onClose: () => void;
}) {
  const [catalogue, setCatalogue] = useState<SectionMeta[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    // SERVED, not hardcoded here — a section added on the server shows up in
    // this picker without a second edit.
    api
      .get<{ sections: SectionMeta[] }>("/reports/mbr/sections")
      .then((r) => setCatalogue(r.sections))
      .catch(() => setCatalogue([]));
  }, []);

  /** Only what is switched ON. Empty string = everything, which is the server's
   *  default too, so the two halves agree about what "nothing chosen" means. */
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
      setPreview(await api.get<Preview>(`/reports/mbr?${q}`));
    } catch {
      setError("Could not build the report.");
    } finally {
      setLoading(false);
    }
  }, [from, to, chosen]);

  useEffect(() => {
    if (catalogue) load();
  }, [catalogue, load]);

  async function grab(ext: string) {
    setBusy(ext);
    try {
      const q = `date_from=${from}&date_to=${to}${chosen() ? `&sections=${chosen()}` : ""}`;
      const stem = (preview?.hotel_name || "dineai").toLowerCase().replace(/\s+/g, "-");
      await downloadFile(`/reports/mbr.${ext}?${q}`, `${stem}-report-${from}-to-${to}.${ext}`);
    } finally {
      setBusy(null);
    }
  }

  const allOn = catalogue ? off.size === 0 : true;

  return (
    <SheetPopup
      title="Full business report"
      subtitle={`Everything between ${from} and ${to}`}
      onClose={onClose}
      // ⚠️ WIDE, because this is a document.
      //
      //     "i guess u can increae the popup size and show confitabley..
      //      currently it bit tight"
      //
      // A five-column money table had its own horizontal scrollbar inside a
      // popup using a third of the screen. ~1152px, still capped at 95vw so a
      // phone is unaffected.
      columns={4}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.ext}
              type="button"
              onClick={() => grab(f.ext)}
              disabled={busy !== null || !preview}
              className="mise-press flex-1 rounded-xl bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
              title={f.hint}
            >
              {busy === f.ext ? "…" : `${f.icon} ${f.label}`}
            </button>
          ))}
        </div>
      }
    >
      {/* ── what goes in ────────────────────────────────────────────────── */}
      <div className="mise-card-inset rounded-2xl p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-fg">What to include</p>
          <button
            type="button"
            onClick={() => setOff(allOn ? new Set(catalogue?.map((s) => s.key)) : new Set())}
            className="mise-press text-xs text-fg-faint underline hover:text-fg"
          >
            {allOn ? "clear all" : "select all"}
          </button>
        </div>
        <p className="mt-0.5 text-xs text-fg-faint">
          Everything is in by default. Untick what you do not want.
        </p>

        {/* Chips, not a column of checkboxes — this is a short list and he
            should be able to see the whole choice without scrolling. */}
        <div className="mt-3 flex flex-wrap gap-2">
          {(catalogue ?? []).map((s) => {
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
        {catalogue && off.size === catalogue.length && (
          <p className="mt-3 text-xs text-amber-300">
            Nothing is selected, so the report would be empty. Pick at least one.
          </p>
        )}
      </div>

      {/* ── what it will look like ──────────────────────────────────────── */}
      {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}
      {loading && !preview && <p className="mt-4 text-sm text-fg-faint">Building…</p>}

      {/* NARROW TABLES SIT TWO-UP. A three-column table does not need 1100px,
          and pairing them halves how far anybody scrolls. Anything wider than
          three columns takes the full width rather than being squeezed. */}
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
      {preview?.sections.map((s) => (
        <div
          key={s.key}
          className={`mise-card-inset overflow-hidden rounded-2xl ${
            s.columns.length > 3 ? "xl:col-span-2" : ""
          }`}
        >
          <div className="border-b border-line bg-brand-400/[0.07] px-4 py-2.5">
            <p className="text-sm font-semibold text-fg">{s.title}</p>
            {s.note && <p className="mt-0.5 text-[11px] leading-relaxed text-fg-faint">{s.note}</p>}
          </div>
          {s.rows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-fg-faint">Nothing in this period.</p>
          ) : (
            // The only thing allowed to scroll sideways is a wide table, in its
            // own box, so the page itself never does.
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
                  {/* Long sections are cut here and complete in the file — a
                      preview is for recognising the right report, not reading
                      ninety rows of it. */}
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
      </div>
    </SheetPopup>
  );
}
