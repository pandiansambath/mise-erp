"use client";

// Dropdown that lets you pick an existing value OR add a new one — so users
// select from known options instead of free-typing (avoids typo duplicates),
// but can still register a new value via "+ Can't find? Add new…".
import { useState } from "react";

export function ComboBox({
  value,
  onChange,
  options,
  placeholder = "Select…",
  addLabel = "+ Can't find? Add new…",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder?: string;
  addLabel?: string;
  className?: string;
}) {
  // "adding" = typing a brand-new value. Also start in add-mode if the current
  // value isn't one of the known options (e.g. editing an existing custom value).
  const known = options.includes(value);
  const [adding, setAdding] = useState(false);
  const base =
    "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500";

  if (adding || (value && !known)) {
    return (
      <div className={`flex gap-1 ${className}`}>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type a new value"
          className={`${base} w-full`}
        />
        <button
          type="button"
          title="Pick from the list instead"
          onClick={() => {
            setAdding(false);
            onChange("");
          }}
          className="rounded-lg border border-slate-200 px-2 text-slate-400 hover:bg-slate-50"
        >
          ↩
        </button>
      </div>
    );
  }

  return (
    <select
      value={known ? value : ""}
      onChange={(e) => {
        if (e.target.value === "__add_new__") {
          setAdding(true);
          onChange("");
        } else {
          onChange(e.target.value);
        }
      }}
      className={`${base} ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      <option value="__add_new__">{addLabel}</option>
    </select>
  );
}
