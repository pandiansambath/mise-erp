"use client";

// Render what the assistant actually writes.
//
// It replies in markdown — tables, bold, lists — and we were showing that as
// plain text, so a staff rota arrived as a wall of pipe characters. Stripping
// the syntax (the previous fix) only made it less obviously broken; the table
// was still gone.
//
// This is a small, deliberate subset rather than a markdown library: tables,
// bold, inline code, bullets and links are everything the assistant is told to
// use, and a full parser would pull in a dependency plus an XSS surface for
// features nothing emits.

import Link from "next/link";
import type { ReactNode } from "react";

/** **bold**, `code`, [label](/href) — inline only, no raw HTML passes through. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;

    if (tok.startsWith("**")) {
      out.push(<b key={key} className="font-semibold text-fg">{tok.slice(2, -2)}</b>);
    } else if (tok.startsWith("`")) {
      out.push(
        <code key={key} className="rounded bg-paper-3 px-1.5 py-0.5 text-[0.9em] text-brand-300">
          {tok.slice(1, -1)}
        </code>,
      );
    } else {
      const label = tok.slice(1, tok.indexOf("]"));
      const href = tok.slice(tok.indexOf("(") + 1, -1);
      // Only in-app links are clickable. An assistant-authored external URL is
      // not something to hand a user a one-tap path to.
      out.push(
        href.startsWith("/") ? (
          <Link key={key} href={href} className="text-brand-300 underline underline-offset-2">
            {label}
          </Link>
        ) : (
          <span key={key}>{label}</span>
        ),
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const isTableRow = (l: string) => l.trim().startsWith("|") && l.trim().endsWith("|");
const isDivider = (l: string) => /^\s*\|[\s|:-]+\|\s*$/.test(l);
const cells = (l: string) =>
  l.trim().slice(1, -1).split("|").map((c) => c.trim());

/** Take the table away with you.
 *
 * Markdown is stripped of its own formatting on the way out — a cell reading
 * "**Farm2Land**" in a spreadsheet is worse than one reading "Farm2Land". The
 * .xls is a plain HTML table, which every version of Excel and Numbers opens
 * without a library and without a build step.
 */
function downloadTable(head: string[], body: string[][], kind: "csv" | "xls") {
  const clean = (c: string) =>
    c.replace(/\*\*|__|`/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").trim();
  const stamp = new Date().toISOString().slice(0, 10);

  let blob: Blob;
  if (kind === "csv") {
    const esc = (c: string) => `"${clean(c).replace(/"/g, '""')}"`;
    const rows = [head.map(esc).join(","), ...body.map((r) => r.map(esc).join(","))];
    const bom = "\uFEFF";
    const nl = "\r\n";
    blob = new Blob([bom + rows.join(nl)], { type: "text/csv;charset=utf-8" });
  } else {
    const cell = (c: string, tag: string) =>
      `<${tag}>${clean(c).replace(/&/g, "&amp;").replace(/</g, "&lt;")}</${tag}>`;
    const html =
      `<html><head><meta charset="utf-8"></head><body><table border="1">` +
      `<tr>${head.map((h) => cell(h, "th")).join("")}</tr>` +
      body.map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`).join("") +
      `</table></body></html>`;
    blob = new Blob([html], { type: "application/vnd.ms-excel" });
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `dineai-${stamp}.${kind === "csv" ? "csv" : "xls"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = (text || "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── table ────────────────────────────────────────────────────────────
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const head = cells(line);
      const body: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        body.push(cells(lines[i]));
        i++;
      }
      blocks.push(
        // Scrolls inside itself: a wide table must never push the whole chat
        // sideways.
        <div key={`t${i}`} className="my-2 rounded-xl border border-line/70">
          {/* "suppose user asking like show staff list in table view means it
              needs to show with download as excel/csv kind of feature."
              A table he can read is halfway; a table he can take to his
              accountant is the thing. */}
          <div className="flex items-center justify-end gap-1 border-b border-line/70 px-2 py-1">
            <button
              type="button"
              onClick={() => downloadTable(head, body, "csv")}
              className="mise-press rounded-lg px-2 py-0.5 text-[10px] font-medium text-fg-faint hover:text-fg"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => downloadTable(head, body, "xls")}
              className="mise-press rounded-lg px-2 py-0.5 text-[10px] font-medium text-fg-faint hover:text-fg"
            >
              Excel
            </button>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line/70 bg-paper-3/50">
                {head.map((h, n) => (
                  <th key={n} className="px-3 py-2 text-left font-medium text-fg-soft">
                    {inline(h, `h${n}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {body.map((r, rn) => (
                <tr key={rn} className="border-b border-line/40 last:border-0">
                  {r.map((c, cn) => (
                    <td key={cn} className="px-3 py-1.5 text-fg">
                      {inline(c, `c${rn}-${cn}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>,
      );
      continue;
    }

    // ── headings ─────────────────────────────────────────────────────────
    // The model writes them constantly ("## Critical: Subscriptions") and
    // without this they printed as literal hashes — which is precisely the
    // "it looks like a .md file" complaint. Rendered by DEPTH, not by size
    // alone: a chat bubble has no room for a 32px h1, so the levels are
    // distinguished by weight and colour instead.
    const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const depth = heading[1].length;
      i++;
      blocks.push(
        <p
          key={`h${i}`}
          className={
            depth <= 2
              ? "mb-1 mt-3 text-[13px] font-semibold text-fg first:mt-0"
              : "mb-0.5 mt-2 text-[12px] font-semibold text-fg-soft first:mt-0"
          }
        >
          {inline(heading[2], `h${i}`)}
        </p>,
      );
      continue;
    }

    // ── a rule ───────────────────────────────────────────────────────────
    if (/^\s*([-*_]){2,}\s*$/.test(line)) {
      i++;
      blocks.push(<hr key={`r${i}`} className="my-2.5 border-line" />);
      continue;
    }

    // ── bullets ──────────────────────────────────────────────────────────
    if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul key={`u${i}`} className="my-1.5 space-y-1 pl-1">
          {items.map((it, n) => (
            <li key={n} className="flex gap-2">
              <span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-brand-400" />
              <span>{inline(it, `li${n}`)}</span>
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    // ── paragraph (blank lines become spacing, not empty <p>) ────────────
    if (line.trim() === "") {
      i++;
      continue;
    }
    blocks.push(
      <p key={`p${i}`} className="my-1 first:mt-0 last:mb-0">
        {inline(line, `p${i}`)}
      </p>,
    );
    i++;
  }

  return <div className="leading-[1.65]">{blocks}</div>;
}
