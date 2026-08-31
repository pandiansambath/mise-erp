"use client";

/**
 * The card /staff and /purchasing are built from.
 *
 * Both reference pages press their shadow INTO the page; most of the rest of
 * the app threw light ON the card from outside (`mise-neo-raised`). Side by
 * side they read as two different applications, which is what he was pointing
 * at when he named those two pages as the standard.
 *
 * THE STRIPE HAS TO MEAN SOMETHING. On Employees it carries the visa, on
 * Documents the expiry — the one fact on the page with a deadline attached. A
 * stripe applied because every other card has one teaches people to stop
 * reading stripes, which costs the pages where it is load-bearing.
 */

/** Stripe colours, named by what they SAY rather than by what they are. */
export const STRIPE = {
  /** Nothing to chase. */
  none: "bg-fg-faint/25",
  /** Past its date. */
  overdue: "bg-rose-400/80",
  /** Close enough to act on. */
  soon: "bg-amber-400/80",
  /** Fine. */
  ok: "bg-emerald-400/60",
  /** The chosen one of several. */
  chosen: "bg-brand-400/70",
  /** A supplier, an inbound thing. */
  supply: "bg-sky-400/70",
} as const;

export type StripeTone = keyof typeof STRIPE;

/** Days from now to an ISO date, or null. `now` is passed in rather than read
 *  here: reading the clock during render is impure, and a list that draws
 *  differently on two renders with no state change is a flicker nobody can
 *  point at. */
export function daysUntil(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(`${iso}T00:00:00`).getTime();
  return Number.isNaN(t) ? null : Math.round((t - now) / 86_400_000);
}

/** The deadline rule, in one place: expired, within a month, or fine. */
export function deadlineTone(days: number | null): StripeTone {
  if (days == null) return "none";
  if (days < 0) return "overdue";
  return days <= 30 ? "soon" : "ok";
}

export function TileCard({
  tone = "none",
  onClick,
  title,
  className = "",
  children,
  ...rest
}: {
  tone?: StripeTone;
  onClick?: () => void;
  title?: string;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onClick" | "title">) {
  const body = (
    <>
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${STRIPE[tone]}`} />
      {children}
    </>
  );
  const shell = `mise-card-inset relative flex flex-col overflow-hidden p-3.5 pl-4 ${className}`;

  // A card you can act on is a BUTTON, so it is reachable by keyboard and
  // announced as pressable. A card you can only read stays a div — making
  // everything a button is how a screen reader ends up listing forty controls
  // that do nothing.
  return onClick ? (
    <button type="button" onClick={onClick} title={title} className={`${shell} mise-press text-left`} {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
      {body}
    </button>
  ) : (
    <div title={title} className={shell} {...rest}>
      {body}
    </div>
  );
}

/** A label/value row for a card's little stats block. */
export function TileRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "plain" | "warn" | "bad";
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-fg-faint">{label}</dt>
      <dd
        className={
          tone === "bad"
            ? "font-medium text-rose-300"
            : tone === "warn"
              ? "font-medium text-amber-300"
              : "tabular-nums text-fg"
        }
      >
        {value}
      </dd>
    </div>
  );
}
