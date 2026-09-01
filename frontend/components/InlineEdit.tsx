"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Edit a value where it is written.
 *
 *   "in inventory I want useful UI UX bro... like in-place edit... if we click
 *    means all detail need to show etc etc — not only here, in all pages"
 *
 * The pattern this replaces: to change one number you opened a form that asked
 * you about eight fields, seven of which you did not come to change. The form
 * still exists for creating things and for the fields that genuinely travel
 * together — this is for the single value you are looking at and want different.
 *
 * WHAT IT REFUSES TO DO IS THE INTERESTING PART.
 *
 * It does not save on blur. Blur fires when you tab away, when a dialog steals
 * focus, when the phone keyboard closes — none of which mean "yes, do it". A
 * value that writes itself to the database because you looked away is a value
 * you cannot trust, and this app is where his money lives. Enter or the tick
 * commits; Escape and the ✕ abandon; clicking away just leaves it open.
 *
 * It also does not swallow the failure. If the server says no the field stays
 * open with what you typed still in it, because the alternative — closing and
 * silently reverting — is how someone believes they changed a price and finds
 * out three weeks later that they did not.
 */
export function InlineEdit({
  value,
  onSave,
  label,
  placeholder = "—",
  type = "text",
  options,
  suffix,
  disabled = false,
  className = "",
}: {
  value: string;
  /** Throws to reject: the field stays open, showing what they typed. */
  onSave: (next: string) => Promise<void>;
  /** Announced to screen readers — the visible label is usually beside it. */
  label: string;
  placeholder?: string;
  type?: "text" | "number" | "date";
  /** Present = a dropdown rather than a free field. */
  options?: { value: string; label: string }[];
  /** "kg", "%" — shown after the value, never part of it. */
  suffix?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement | HTMLSelectElement>(null);

  // Someone else's edit (or a reload) should be visible while this is closed —
  // but must never overwrite what he is in the middle of typing.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [value, open]);

  useEffect(() => {
    if (open) ref.current?.focus();
  }, [open]);

  async function commit() {
    if (busy) return;
    const next = draft.trim();
    if (next === value.trim()) {
      setOpen(false);
      setErr(null);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSave(next);
      setOpen(false);
    } catch (e) {
      // Stay open, keep the typing. See the note at the top.
      setErr(e instanceof Error ? e.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  }

  function abandon() {
    setDraft(value);
    setErr(null);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-label={disabled ? label : `${label} — click to edit`}
        title={disabled ? undefined : `Edit ${label.toLowerCase()}`}
        className={`group inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition ${
          disabled ? "cursor-default" : "hover:bg-brand-400/10"
        } ${className}`}
      >
        <span className={`truncate ${value ? "text-fg" : "text-fg-faint"}`}>
          {value || placeholder}
          {value && suffix ? <span className="ml-0.5 text-fg-faint">{suffix}</span> : null}
        </span>
        {!disabled && (
          <span
            aria-hidden
            className="shrink-0 text-[10px] text-fg-faint opacity-0 transition group-hover:opacity-100"
          >
            ✏️
          </span>
        )}
      </button>
    );
  }

  return (
    <span className={`inline-flex flex-col gap-1 ${className}`}>
      <span className="inline-flex items-center gap-1">
        {options ? (
          <select
            ref={ref as React.RefObject<HTMLSelectElement>}
            value={draft}
            aria-label={label}
            disabled={busy}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") abandon();
            }}
            className="mise-well min-w-0 rounded-lg px-2 py-1 text-sm outline-none"
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            ref={ref as React.RefObject<HTMLInputElement>}
            type={type}
            value={draft}
            aria-label={label}
            disabled={busy}
            inputMode={type === "number" ? "decimal" : undefined}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void commit();
              }
              if (e.key === "Escape") abandon();
            }}
            className="mise-well w-full min-w-0 rounded-lg px-2 py-1 text-sm outline-none"
          />
        )}
        <button
          type="button"
          onClick={() => void commit()}
          disabled={busy}
          aria-label={`Save ${label.toLowerCase()}`}
          className="mise-press grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs text-white disabled:opacity-50"
        >
          {busy ? "…" : "✓"}
        </button>
        <button
          type="button"
          onClick={abandon}
          disabled={busy}
          aria-label={`Cancel editing ${label.toLowerCase()}`}
          className="mise-press grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-line text-xs text-fg-faint"
        >
          ✕
        </button>
      </span>
      {err && <span className="text-[10px] text-rose-300">{err}</span>}
    </span>
  );
}
