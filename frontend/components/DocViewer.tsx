"use client";

// OPENING A DOCUMENT, RATHER THAN ONLY DOWNLOADING IT.
//
//   "here I need open feature, but I have only download option. Please have an
//    open doc feature — like it needs to sense the doc type, whether excel,
//    csv, word, pdf etc, and accordingly it needs to open and show the doc."
//
// A licence you have to download, find in a folder and open in another app is a
// licence nobody checks. The point of keeping them here is being able to glance
// at one.
//
// WHAT CAN HONESTLY BE SHOWN, AND WHAT CANNOT.
//
// PDFs and images the browser renders itself. CSV is just text, so it can be
// parsed and drawn as a table — and it is worth drawing rather than dumping,
// because a comma-separated wall is not more readable than the download was.
// Plain text likewise.
//
// Word and Excel it cannot. Rendering .docx or .xlsx in a browser means
// shipping a large library that produces an approximation of the file — wrong
// fonts, dropped formatting, silently missing sheets. For a document somebody
// is checking a legal date on, an approximation is worse than an honest "this
// one needs Word". So those say so, and offer the download, instead of showing
// a broken preview and letting the reader assume it is faithful.
//
// Fetched as a blob rather than pointed at with an <iframe src>: these files
// sit behind an Authorization header, and an iframe cannot send one.

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchBlobUrl } from "@/lib/api";
import { SheetPopup } from "@/components/SheetPopup";

type Kind = "pdf" | "image" | "csv" | "text" | "office" | "unknown";

function kindOf(filename: string): Kind {
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "svg"].includes(ext)) return "image";
  if (ext === "csv" || ext === "tsv") return "csv";
  if (["txt", "md", "log", "json", "xml"].includes(ext)) return "text";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods"].includes(ext)) return "office";
  return "unknown";
}

const OFFICE_NAME: Record<string, string> = {
  doc: "Word", docx: "Word", odt: "Word",
  xls: "Excel", xlsx: "Excel", ods: "Excel",
  ppt: "PowerPoint", pptx: "PowerPoint",
};

/** A CSV split that respects quoted fields — a description containing a comma
 *  is common in an invoice and would otherwise shift every later column. */
function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function DocViewer({
  path,
  filename,
  onClose,
  onDownload,
}: {
  /** API path that returns the file, e.g. `/documents/<id>/download`. */
  path: string;
  filename: string;
  onClose: () => void;
  onDownload: () => void;
}) {
  const kind = useMemo(() => kindOf(filename), [filename]);
  const ext = (filename.split(".").pop() ?? "").toLowerCase();
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const made = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (kind === "office" || kind === "unknown") { setBusy(false); return; }
    (async () => {
      try {
        const u = await fetchBlobUrl(path);
        if (cancelled) return;
        made.current = u;
        if (kind === "csv" || kind === "text") {
          const body = await (await fetch(u)).text();
          if (!cancelled) setText(body);
        }
        if (!cancelled) setUrl(u);
      } catch {
        if (!cancelled) setErr("That file could not be opened.");
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, kind]);

  const table = useMemo(() => {
    if (kind !== "csv" || !text) return null;
    // Sniff the separator from the first line rather than assuming a comma: a
    // spreadsheet exported in a European locale uses semicolons, and guessing
    // wrong turns every row into one long cell.
    const first = text.split("\n")[0] ?? "";
    const sep = first.includes("\t") ? "\t" : (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";
    return parseCsv(text, sep).slice(0, 500);
  }, [kind, text]);

  return (
    <SheetPopup
      depth={2}
      columns={4}
      onClose={onClose}
      title={filename}
      subtitle={
        kind === "office"
          ? `${OFFICE_NAME[ext] ?? "Office"} file`
          : kind === "unknown"
            ? "File"
            : `${ext.toUpperCase()} · opened here`
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onDownload}
            className="mise-btn-flat mise-press min-h-[42px] px-4 text-sm font-semibold text-fg-soft"
          >
            ⬇ Download
          </button>
          {url && kind !== "csv" && kind !== "text" && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mise-btn-flat mise-press flex min-h-[42px] items-center px-4 text-sm font-semibold text-fg-soft"
            >
              ↗ Open in a new tab
            </a>
          )}
        </div>
      }
    >
      {busy && <p className="py-16 text-center text-sm text-fg-faint">Opening…</p>}

      {err && (
        <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300">
          {err}
        </p>
      )}

      {!busy && (kind === "office" || kind === "unknown") && (
        <div className="mise-card-inset rounded-2xl px-4 py-10 text-center">
          <p className="text-4xl" aria-hidden>
            {kind === "office" ? "📄" : "🗂"}
          </p>
          <p className="mt-3 text-sm font-semibold text-fg">
            {kind === "office"
              ? `This one opens in ${OFFICE_NAME[ext] ?? "Office"}`
              : "This file has no preview"}
          </p>
          {/* SAID PLAINLY RATHER THAN FAKED. Rendering .docx or .xlsx in a
              browser means shipping a large library that produces an
              APPROXIMATION — wrong fonts, dropped formatting, silently missing
              sheets. For a document somebody is checking a legal date on, an
              approximation is worse than an honest refusal. */}
          <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-fg-soft">
            {kind === "office"
              ? "Showing it here would mean redrawing it approximately — wrong fonts, dropped formatting, sometimes a missing sheet. For a document you are checking a date on, that is worse than opening the real thing."
              : "Download it and open it with whatever made it."}
          </p>
        </div>
      )}

      {!busy && kind === "pdf" && url && (
        <object data={url} type="application/pdf" className="h-[70vh] w-full rounded-xl">
          <p className="py-10 text-center text-sm text-fg-soft">
            Your browser will not show PDFs inline — use Download.
          </p>
        </object>
      )}

      {!busy && kind === "image" && url && (
        <div className="grid place-items-center rounded-xl bg-white p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={filename} className="max-h-[70vh] w-auto max-w-full" />
        </div>
      )}

      {!busy && kind === "text" && text !== null && (
        <pre className="mise-card-inset max-h-[70vh] overflow-auto rounded-xl p-4 text-xs leading-relaxed text-fg-soft">
          {text}
        </pre>
      )}

      {!busy && kind === "csv" && table && (
        <div className="mise-card-inset max-h-[70vh] overflow-auto rounded-xl">
          <table className="w-full border-collapse text-xs">
            <tbody>
              {table.map((r, i) => (
                <tr key={i} className={i === 0 ? "sticky top-0 bg-paper-2" : ""}>
                  {r.map((c, j) => (
                    <td
                      key={j}
                      className={`border-b border-line/60 px-2.5 py-1.5 ${
                        i === 0 ? "font-semibold text-fg" : "text-fg-soft"
                      }`}
                    >
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.length >= 500 && (
            <p className="px-3 py-2 text-[11px] text-fg-faint">
              Showing the first 500 rows — download it for the rest.
            </p>
          )}
        </div>
      )}
    </SheetPopup>
  );
}
