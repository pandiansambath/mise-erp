"use client";

// Tiny reusable table sorting: a useSort() hook + a <SortTh> header button, so
// any table gets click-to-sort columns with an arrow indicator, consistently.
//   const sort = useSort<"date" | "amount">("date", "desc");
//   const rows = sort.sortRows(data, (r, k) => k === "amount" ? +r.amount : r.date);
//   <SortTh k="date" label="Date" sort={sort} /> ... rows.map(...)

import { useState } from "react";

export type SortDir = "asc" | "desc";

export type Sort<K extends string> = {
  key: K;
  dir: SortDir;
  toggle: (k: K) => void;
  sortRows: <T>(rows: T[], val: (r: T, k: K) => string | number) => T[];
};

export function useSort<K extends string>(initialKey: K, initialDir: SortDir = "asc"): Sort<K> {
  const [key, setKey] = useState<K>(initialKey);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setKey(k);
      setDir("asc");
    }
  };

  const sortRows = <T,>(rows: T[], val: (r: T, k: K) => string | number): T[] =>
    [...rows].sort((a, b) => {
      const va = val(a, key);
      const vb = val(b, key);
      const cmp =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb));
      return dir === "asc" ? cmp : -cmp;
    });

  return { key, dir, toggle, sortRows };
}

export function SortTh<K extends string>({
  k,
  label,
  sort,
  right = false,
  className = "",
}: {
  k: K;
  label: string;
  sort: Sort<K>;
  right?: boolean;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th className={`px-5 py-3 font-medium ${right ? "text-right" : ""} ${className}`}>
      <button
        type="button"
        onClick={() => sort.toggle(k)}
        title={`Sort by ${label.toLowerCase()}`}
        className={`inline-flex items-center gap-1 transition hover:text-fg ${right ? "flex-row-reverse" : ""} ${active ? "text-fg" : ""}`}
      >
        {label}
        <span aria-hidden className={`text-[9px] ${active ? "text-brand-300" : "text-fg-faint/50"}`}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}
