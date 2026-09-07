"use client";

// WHAT THE AI MAY DO — one panel, wherever access is decided.
//
//   "under ai we have so many features nah, like haiku, sonnet, voice model.
//    i need a under ai what are all feature we gonna give — this permission
//    also i need"
//
// THIS FILE EXISTS BECAUSE I MADE THE SAME MISTAKE TWICE. Access is decided on
// three sheets — a PERSON, a JOB, and a ROLE the hotel invented — and the last
// time something shipped into two of the three it landed everywhere except the
// sheet he actually opened. AccessModal already carries that scar in a comment.
// I then added the AI settings to JobSheet alone, and he opened a custom role
// and found nothing. So this is a component, passed through the shared modal,
// and adding a fourth sheet cannot lose it.
//
// WHETHER they get AI is a permission and lives with the other switches — two
// places to turn one thing on is how the two drift apart. This is everything
// UNDER that yes, and it earns its own panel because a model costs money per
// question: "who may use it" without "how much" is half a control.

import type { ReactNode } from "react";

export type AiGrant = Record<string, unknown>;

export function AiGrantPanel({
  value,
  onChange,
  title = "What the AI may do",
  hint,
  idPrefix = "ai",
}: {
  value: AiGrant;
  onChange: (patch: AiGrant) => void;
  title?: string;
  hint?: ReactNode;
  /** So two panels on one screen never share an input id. */
  idPrefix?: string;
}) {
  const num = (k: string) => (value[k] as string | number | undefined) ?? "";

  return (
    <div className="mise-card-inset rounded-2xl p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-fg">✨ {title}</p>
        <p className="text-[11px] text-fg-faint">
          {hint ?? "applies once the assistant switch is on"}
        </p>
      </div>

      <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
            Model
          </span>
          <select
            value={(value.model as string) ?? ""}
            onChange={(e) => onChange({ model: e.target.value || undefined })}
            data-testid={`${idPrefix}-model`}
            className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm outline-none"
          >
            <option value="">Hotel default</option>
            <option value="haiku">Haiku — quick and cheap</option>
            <option value="sonnet">Sonnet — slower, better answers</option>
          </select>
        </label>

        <label className="flex items-end gap-2 pb-2.5">
          <input
            type="checkbox"
            checked={Boolean(value.voice)}
            onChange={(e) => onChange({ voice: e.target.checked })}
            data-testid={`${idPrefix}-voice`}
            className="h-4 w-4"
          />
          <span className="text-sm text-fg-soft">Let them talk to it</span>
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
            Max tokens per answer
          </span>
          <input
            value={num("max_tokens")}
            inputMode="numeric"
            placeholder="hotel default"
            onChange={(e) => onChange({ max_tokens: e.target.value.replace(/[^0-9]/g, "") })}
            data-testid={`${idPrefix}-tokens`}
            className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-fg-faint">
            Max messages a day
          </span>
          <input
            value={num("max_messages")}
            inputMode="numeric"
            placeholder="hotel default"
            onChange={(e) => onChange({ max_messages: e.target.value.replace(/[^0-9]/g, "") })}
            data-testid={`${idPrefix}-messages`}
            className="mise-well mt-1 min-h-[40px] w-full rounded-lg px-3 py-2 text-sm tabular-nums outline-none"
          />
        </label>
      </div>

      <p className="mt-2 text-[11px] text-fg-faint">
        Blank means the hotel&apos;s default. A cheaper model always applies; a dearer
        one still cannot exceed what your plan includes. These are a spend ceiling —
        the assistant is the one thing here that costs money every time it is asked.
      </p>
    </div>
  );
}
