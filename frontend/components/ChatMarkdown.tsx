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
        <div key={`t${i}`} className="my-2 overflow-x-auto rounded-xl border border-line/70">
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
        </div>,
      );
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
