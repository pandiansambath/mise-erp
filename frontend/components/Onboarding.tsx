"use client";

// Getting a brand-new restaurant off zero.
//
// A hotel signs up and lands on a dashboard of zeroes. Every number is correct
// and none of it means anything, because the app knows nothing about the
// business yet — and nothing on screen says which of fifteen sections to open
// first, or in what order, or why it matters.
//
// Three deliberate choices:
//
// **One next step, not six.** "You have six things to do" is paralysing. The
// panel names the next one, explains what it unlocks, and puts the other five
// underneath where they can be ignored.
//
// **Import beats typing.** Nobody keys in 200 stock items, and the halfway
// point of doing it by hand is where an onboarding gets abandoned. Every step
// that can be bulk-imported offers to hand a spreadsheet or a PDF to the
// assistant, which reads it and proposes rows to confirm.
//
// **It disappears by itself.** Progress is counted from real rows, never
// stored, so it cannot get stuck showing work that is already finished — and
// somebody who clears their data genuinely is back at the start.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Step = {
  key: string;
  title: string;
  why: string;
  href: string;
  import_kind: string | null;
  count: number;
  done: boolean;
};

type Status = {
  steps: Step[];
  done_count: number;
  total: number;
  complete: boolean;
  next_key: string | null;
  fresh: boolean;
};

const DISMISSED = "mise.onboarding.hidden";

export function Onboarding({ hotelName }: { hotelName?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [hidden, setHidden] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // localStorage, not session: dismissing this is a lasting preference, and
    // having it reappear on every sign-in would be nagging.
    setHidden(localStorage.getItem(DISMISSED) === "1");
    api
      .get<Status>("/hotels/onboarding")
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  if (!status || status.complete || hidden) return null;

  const next = status.steps.find((s) => s.key === status.next_key);
  const rest = status.steps.filter((s) => s.key !== status.next_key);
  const pct = Math.round((status.done_count / status.total) * 100);

  function openImport(kind: string) {
    // Hands the job straight to the assistant: one gesture opens the bubble
    // and the file chooser together. "ingest:" is the extract-then-confirm
    // path — rows are proposed and shown, and nothing is written until the
    // person says so. "chat:" would just talk about the file.
    window.dispatchEvent(
      new CustomEvent("mise:attach", { detail: { mode: `ingest:${kind}` } }),
    );
  }

  return (
    <section
      className="mise-pop mb-6 overflow-hidden rounded-2xl border border-brand-400/30 bg-gradient-to-b from-brand-400/[0.10] via-paper/95 to-paper/95 shadow-lg shadow-black/20"
      aria-label="Setting up your restaurant"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-line/60 px-5 py-3.5">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold text-fg">
            {status.fresh
              ? `Welcome${hotelName ? `, ${hotelName}` : ""} — let's get you set up`
              : "Finish setting up"}
          </h2>
          <p className="mt-0.5 text-xs text-fg-faint">
            {status.fresh
              ? "Six things, in the order that makes each one useful. Start with the first."
              : `${status.done_count} of ${status.total} done — the rest unlock the numbers that are still empty.`}
          </p>
        </div>
        {/* The bar is the reassurance: this ends. */}
        <div className="flex items-center gap-2">
          <div className="mise-well h-2 w-28 overflow-hidden rounded-full">
            <div
              className="h-full rounded-full bg-brand-500 transition-all duration-700"
              style={{ width: `${Math.max(4, pct)}%` }}
            />
          </div>
          <span className="text-xs tabular-nums text-fg-faint">{pct}%</span>
        </div>
      </div>

      {next && (
        <div className="px-5 py-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-brand-300">
            Do this next
          </p>
          <h3 className="mt-1 font-display text-lg font-semibold text-fg">{next.title}</h3>
          <p className="mt-1 max-w-prose text-sm leading-relaxed text-fg-soft">{next.why}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href={next.href}
              className="mise-press rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Open {next.href.replace("/", "")}
            </Link>
            {next.import_kind && (
              <button
                type="button"
                onClick={() => openImport(next.import_kind!)}
                title="Upload a spreadsheet, PDF or photo — the assistant reads it and you confirm what it found"
                className="mise-press rounded-lg border border-brand-400/40 bg-brand-400/10 px-4 py-2 text-sm font-medium text-brand-300"
              >
                📎 Import from a file instead
              </button>
            )}
          </div>
        </div>
      )}

      <div className="border-t border-line/60 px-5 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex w-full items-center justify-between text-left text-xs font-medium text-fg-faint transition hover:text-fg"
          aria-expanded={expanded}
        >
          <span>{expanded ? "Hide" : "Show"} the whole list ({rest.length} more)</span>
          <span aria-hidden className={`transition ${expanded ? "rotate-90" : ""}`}>
            ›
          </span>
        </button>
        {expanded && (
          <ul className="mt-3 space-y-1.5">
            {rest.map((s) => (
              <li
                key={s.key}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2"
              >
                <span
                  aria-hidden
                  className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] ${
                    s.done
                      ? "bg-brand-500 text-white"
                      : "border border-line-2 text-transparent"
                  }`}
                >
                  ✓
                </span>
                <span className={`min-w-0 flex-1 text-sm ${s.done ? "text-fg-faint line-through" : "text-fg"}`}>
                  {s.title}
                  {s.done && <span className="ml-2 text-[11px] no-underline">({s.count})</span>}
                </span>
                {!s.done && (
                  <Link
                    href={s.href}
                    className="mise-press shrink-0 rounded-lg border border-line px-2.5 py-1 text-[11px] text-fg-soft hover:border-brand-400/50 hover:text-brand-300"
                  >
                    Open
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => {
            localStorage.setItem(DISMISSED, "1");
            setHidden(true);
          }}
          className="mt-2 text-[11px] text-fg-faint underline-offset-4 hover:underline"
        >
          Hide this — I&apos;ll set up as I go
        </button>
      </div>
    </section>
  );
}
