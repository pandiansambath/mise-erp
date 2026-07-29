"use client";

// The daily briefing — "here's how to make today better".
//
// Deliberately quiet: it renders nothing at all when the AI has nothing useful
// to say, when the plan doesn't include it, or when the allowance is spent. A
// dashboard panel that shows an error or an empty state every single day is
// worse than no panel, because people learn to ignore that whole region.

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

type Insight = {
  title: string;
  detail: string;
  severity: "info" | "watch" | "act";
  href: string | null;
};

const TONE: Record<Insight["severity"], { dot: string; ring: string; label: string }> = {
  act: { dot: "bg-rose-400", ring: "ring-rose-400/25", label: "Worth doing today" },
  watch: { dot: "bg-amber-400", ring: "ring-amber-400/25", label: "Keep an eye on" },
  info: { dot: "bg-brand-400", ring: "ring-brand-400/20", label: "Good to know" },
};

export function DailyBriefing() {
  const [items, setItems] = useState<Insight[] | null>(null);
  // Open on arrival — the whole point is that you SEE it when you walk in.
  // Collapsing is remembered, so someone who finds it noisy isn't nagged daily.
  const [open, setOpen] = useState(true);

  useEffect(() => {
    try {
      setOpen(localStorage.getItem("dineai.briefing.closed") !== "1");
    } catch {
      /* private mode — default to open */
    }
  }, []);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem("dineai.briefing.closed", next ? "0" : "1");
      } catch {
        /* nothing to remember it with; fine */
      }
      return next;
    });
  }

  useEffect(() => {
    api
      .get<{ insights: Insight[] }>("/assistant/insights")
      .then((d) => setItems(d.insights ?? []))
      .catch(() => setItems([]));
  }, []);

  // nothing to say, not on this plan, or out of allowance -> show nothing
  if (!items || items.length === 0) return null;

  return (
    <section className="mise-feel mb-6 overflow-hidden rounded-2xl border border-brand-400/20">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 border-b border-line/60 bg-gradient-to-r from-brand-500/10 to-transparent px-4 py-2.5 text-left transition hover:from-brand-500/[0.14]"
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-brand-500 to-sky-400 text-[11px] text-white"
          aria-hidden
        >
          ✦
        </span>
        <h2 className="text-sm font-semibold text-fg">Today&apos;s briefing</h2>
        {!open && (
          <span className="rounded-full bg-brand-500/15 px-2 py-0.5 text-[11px] font-medium text-brand-300">
            {items.length}
          </span>
        )}
        <span className="ml-auto hidden text-[11px] text-fg-faint sm:inline">
          from your own numbers
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`ml-2 h-4 w-4 shrink-0 text-fg-faint transition-transform ${open ? "" : "-rotate-90"}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
      <ul className="divide-y divide-line/50">
        {items.map((i, n) => {
          const tone = TONE[i.severity] ?? TONE.info;
          return (
            <li key={n} className="flex gap-3 px-4 py-3">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ${tone.dot} ${tone.ring}`}
                title={tone.label}
                aria-label={tone.label}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg">{i.title}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-fg-soft">{i.detail}</p>
                {i.href && (
                  <Link
                    href={i.href}
                    className="mt-1.5 inline-block text-xs font-medium text-brand-400 hover:underline"
                  >
                    Take a look →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}
