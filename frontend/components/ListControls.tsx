"use client";

// Finding one row in a long list, without scrolling for it.
//
//   "see this indent page — here I need to scroll to see if I need to see any
//    particular indent. Please have a sort, search, filter, these features
//    here" — and then: "not only indent but also the partner purchase order too"
//
// One control for both lists, because two lists that behave differently are two
// things to learn. It is deliberately small: a search box, a row of status
// chips, and a sort. Anything more and it becomes the thing you have to scroll
// past to reach the list.

import { useMemo, useState } from "react";

export type SortDir = "newest" | "oldest" | "high" | "low";

export type ListFilter = {
  q: string;
  status: string;
  sort: SortDir;
  /** How many rows at a time. 0 = all of them. */
  size: number;
  /** 1-based. */
  page: number;
};

export const PAGE_SIZES = [10, 50, 100, 0];

export const EMPTY_FILTER: ListFilter = {
  q: "",
  status: "all",
  sort: "newest",
  size: 10,
  page: 1,
};

/**
 * The controls. `statuses` are the chips — pass the ones this list actually
 * has, with their counts, so nobody clicks a filter that can only be empty.
 */
export function ListControls({
  value,
  onChange,
  statuses,
  placeholder,
  total,
  shown,
}: {
  value: ListFilter;
  onChange: (next: ListFilter) => void;
  statuses: {
    key: string;
    label: string;
    count: number;
    tone?: "warn" | "bad" | "good";
    /** What this bucket MEANS, on hover. A chip whose name a user cannot
     *  decode has to be able to explain itself where they are standing. */
    hint?: string;
  }[];
  placeholder: string;
  total: number;
  shown: number;
}) {
  // Any change to WHAT is listed resets to page one — filtering to three rows
  // while sitting on page 4 shows an empty list and looks broken.
  const set = (patch: Partial<ListFilter>) =>
    onChange({ ...value, page: 1, ...patch });

  return (
    <div className="border-b border-line px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-48">
          <span className="sr-only">{placeholder}</span>
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-fg-faint"
          >
            🔍
          </span>
          <input
            value={value.q}
            onChange={(e) => set({ q: e.target.value })}
            placeholder={placeholder}
            className="mise-well w-full rounded-xl py-2.5 pl-9 pr-8 text-sm text-fg outline-none transition focus:ring-2 focus:ring-brand-500/30"
          />
          {value.q && (
            <button
              type="button"
              onClick={() => set({ q: "" })}
              aria-label="Clear the search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-1.5 text-fg-faint hover:text-fg"
            >
              ✕
            </button>
          )}
        </label>

        <select
          value={value.sort}
          onChange={(e) => set({ sort: e.target.value as SortDir })}
          aria-label="Sort"
          className="mise-btn mise-press cursor-pointer appearance-none rounded-xl py-2 pl-3 pr-8 text-sm font-medium text-fg-soft outline-none"
        >
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="high">Biggest value</option>
          <option value="low">Smallest value</option>
        </select>
      </div>

      {statuses.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {statuses.map((s) => {
            const on = value.status === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => set({ status: on ? "all" : s.key })}
                title={s.hint ?? `Show only: ${s.label}`}
                className={`mise-press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition ${
                  on
                    ? "mise-btn-key font-semibold"
                    : s.tone === "bad"
                      ? "mise-btn text-rose-300"
                      : s.tone === "warn"
                        ? "mise-btn text-amber-300"
                        : "mise-btn text-fg-soft"
                }`}
              >
                {s.label}
                <span className="tabular-nums opacity-70">{s.count}</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-fg-faint">
          showing <b className="text-fg-soft">{shown}</b> of {total}
          {shown !== total && (
            <button
              type="button"
              onClick={() => onChange({ ...EMPTY_FILTER, size: value.size })}
              className="ml-2 underline decoration-dotted hover:text-fg"
            >
              show everything
            </button>
          )}
        </p>

        {/* How many at a time. His idea, and a good one: "instead of showing all
            and making the user scroll so deep, shall we have a pagination with
            show 1-10 1-50 1-100". */}
        <div className="flex items-center gap-1">
          {PAGE_SIZES.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => set({ size: n })}
              className={`mise-press rounded-lg px-2 py-1 text-[11px] tabular-nums transition ${
                value.size === n
                  ? "mise-btn-key font-semibold"
                  : "mise-btn text-fg-soft"
              }`}
            >
              {n === 0 ? "all" : n}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The pager itself — under the list, where you are when you need it. */
export function Pager({
  value,
  onChange,
  matched,
}: {
  value: ListFilter;
  onChange: (next: ListFilter) => void;
  /** How many rows passed the filter, before paging. */
  matched: number;
}) {
  if (!value.size || matched <= value.size) return null;
  const pages = Math.ceil(matched / value.size);
  const page = Math.min(value.page, pages);
  const from = (page - 1) * value.size + 1;
  const to = Math.min(page * value.size, matched);

  // A window around the current page, so a hundred pages does not become a
  // hundred buttons.
  const around = [page - 1, page, page + 1].filter((p) => p > 1 && p < pages);
  const nums = [...new Set([1, ...around, pages])].sort((a, b) => a - b);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-3 py-2.5">
      <span className="text-[11px] text-fg-faint tabular-nums">
        {from}–{to} of {matched}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onChange({ ...value, page: page - 1 })}
          className="mise-btn mise-press px-2.5 py-1.5 text-xs font-medium text-fg-soft disabled:opacity-35"
        >
          ‹ Back
        </button>
        {nums.map((n, i) => (
          <span key={n} className="flex items-center gap-1">
            {i > 0 && nums[i - 1] !== n - 1 && (
              <span className="px-0.5 text-[11px] text-fg-faint">…</span>
            )}
            <button
              type="button"
              onClick={() => onChange({ ...value, page: n })}
              aria-current={n === page ? "page" : undefined}
              className={`mise-press min-w-7 rounded-lg px-2 py-1 text-xs tabular-nums transition ${
                n === page
                  ? "bg-brand-500 font-semibold text-white"
                  : "border border-line text-fg-soft hover:border-brand-400/40"
              }`}
            >
              {n}
            </button>
          </span>
        ))}
        <button
          type="button"
          disabled={page >= pages}
          onClick={() => onChange({ ...value, page: page + 1 })}
          className="mise-press rounded-lg border border-line px-2.5 py-1 text-xs text-fg-soft disabled:opacity-35"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

/** Filter + sort in one place, so both lists agree on what "newest" means.
 *
 *  Returns the WHOLE matching set. Paging is applied separately by `pageOf`,
 *  because search has to run over everything — paginate first and you are only
 *  searching the page you happen to be on, which is worse than not paging. */
export function applyFilter<T>(
  rows: T[],
  f: ListFilter,
  get: (row: T) => { text: string; status: string; date: string; value: number },
): T[] {
  const q = f.q.trim().toLowerCase();
  const out = rows.filter((r) => {
    const g = get(r);
    if (f.status !== "all" && g.status !== f.status) return false;
    if (q && !g.text.toLowerCase().includes(q)) return false;
    return true;
  });
  const key = (r: T) => get(r);
  return out.sort((a, b) => {
    switch (f.sort) {
      case "oldest":
        return key(a).date.localeCompare(key(b).date);
      case "high":
        return key(b).value - key(a).value;
      case "low":
        return key(a).value - key(b).value;
      default:
        return key(b).date.localeCompare(key(a).date);
    }
  });
}

/** The slice of `rows` this page shows. */
export function pageOf<T>(rows: T[], f: ListFilter): T[] {
  if (!f.size) return rows;
  const pages = Math.max(1, Math.ceil(rows.length / f.size));
  const page = Math.min(Math.max(1, f.page), pages);
  return rows.slice((page - 1) * f.size, page * f.size);
}

/** Remembers a list's filter for the session, per list. */
export function useListFilter(key: string) {
  const [f, setF] = useState<ListFilter>(() => {
    if (typeof window === "undefined") return EMPTY_FILTER;
    try {
      const raw = sessionStorage.getItem(`mise.list.${key}`);
      return raw ? { ...EMPTY_FILTER, ...JSON.parse(raw) } : EMPTY_FILTER;
    } catch {
      return EMPTY_FILTER;
    }
  });
  const set = (next: ListFilter) => {
    setF(next);
    try {
      sessionStorage.setItem(`mise.list.${key}`, JSON.stringify(next));
    } catch {
      /* private mode — it just will not be remembered */
    }
  };
  return useMemo(() => [f, set] as const, [f]); // eslint-disable-line react-hooks/exhaustive-deps
}
