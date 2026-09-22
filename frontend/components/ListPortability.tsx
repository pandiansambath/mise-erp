"use client";

/** Take this list out, and bring one back in.
 *
 *     "so i exported the invebtory, likweise i need vebdor but here export
 *      feature is missing..exployee here also export fteayre not there"
 *
 *  One control, dropped onto any page that owns a list. It is a component
 *  rather than three buttons copied twice because the interesting part is not
 *  the buttons — it is the read→preview→commit sequence between them, and that
 *  sequence is where an import quietly loses rows if each page improvises it.
 *
 *  THE IMPORT IS TWO CALLS, ALWAYS. Read the file, show what would happen,
 *  write only what was agreed. There is no path through this component that
 *  writes without the plan being on screen first — which is the whole of
 *  "ask user to chekc and remove duplcaite ... before ading".
 */

import { useRef, useState } from "react";

import { ImportPlan, type Decision, type Plan } from "@/components/ImportPlan";
import { SheetPopup } from "@/components/SheetPopup";
import { api, ApiError, downloadFile, postForm } from "@/lib/api";

export function ListPortability({
  /** e.g. "vendors" — the API prefix and the filename stem. */
  base,
  /** "suppliers", "staff" — what to call them in a sentence. */
  noun,
  onDone,
}: {
  base: string;
  noun: string;
  onDone?: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const read = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Reset immediately: without this, choosing the SAME file twice after a
    // failed import fires no change event and the page looks frozen.
    e.target.value = "";
    if (!f) return;
    setBusy(true);
    setNote(null);
    try {
      const body = new FormData();
      body.append("file", f);
      setPlan(await postForm<Plan>(`/${base}/import/preview`, body));
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not read that file.");
    } finally {
      setBusy(false);
    }
  };

  const commit = async (decisions: Decision[]) => {
    setBusy(true);
    try {
      const res = await api.post<{
        counts: { created: number; updated: number; skipped: number; failed: number };
        failed: { name: string; why: string }[];
      }>(`/${base}/import/commit`, { rows: decisions, source: "file" });

      const c = res.counts;
      // The aftermath is a SENTENCE with the numbers in it, not a tick. "Done"
      // is what an import that lost half the file also says.
      setNote(
        `Added ${c.created}${c.updated ? `, updated ${c.updated}` : ""}` +
          `${c.skipped ? `, left ${c.skipped} alone` : ""}` +
          `${c.failed ? `. ${c.failed} could not be saved: ${res.failed[0]?.why}` : "."}`,
      );
      setPlan(null);
      onDone?.();
    } catch (err) {
      setNote(err instanceof ApiError ? err.message : "Could not save those.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => downloadFile(`/${base}/export.csv`, `dineai-${base}.csv`)}
          className="mise-press mise-well rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-soft"
        >
          ⬇ Export CSV
        </button>
        <button
          type="button"
          onClick={() => downloadFile(`/${base}/export.xlsx`, `dineai-${base}.xlsx`)}
          className="mise-press mise-well rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-soft"
        >
          ⬇ Excel
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="mise-press mise-well rounded-lg px-2.5 py-1.5 text-xs font-medium text-fg-soft disabled:opacity-50"
        >
          {busy && !plan ? "Reading…" : "⬆ Import"}
        </button>
        <button
          type="button"
          onClick={() =>
            downloadFile(`/${base}/import-template.xlsx`, `dineai-${base}-template.xlsx`)
          }
          className="mise-press rounded-lg px-2 py-1.5 text-[11px] text-fg-faint underline"
        >
          blank template
        </button>
      </div>

      {/* NO `accept` NARROWER THAN WHAT THE SERVER READS. Restricting this to
          images is what stopped him choosing his own spreadsheet on the AI
          page — the rejection happened in the file dialog, before any upload.
          The server takes csv and xlsx here, so the dialog offers both. */}
      <input
        ref={fileRef}
        type="file"
        accept=".csv,.xlsx,.xls,text/csv"
        className="hidden"
        onChange={read}
      />

      {note && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-fg-faint" role="status">
          {note}
        </p>
      )}

      {plan && (
          // columns={4} — the panel sizes itself from this, and with no
          // prop it defaults to 1: `max-w-[min(30rem,94vw)]`, which rendered
          // the whole comparison at 352px ON A 1440px SCREEN. A side-by-side
          // of what we hold against what the file says, in a phone-width
          // column, is most of why the preview reads as cramped.
        <SheetPopup onClose={() => setPlan(null)} title={`Import ${noun}`} columns={4}>
          <ImportPlan plan={plan} busy={busy} onCancel={() => setPlan(null)} onCommit={commit} />
        </SheetPopup>
      )}
    </>
  );
}
