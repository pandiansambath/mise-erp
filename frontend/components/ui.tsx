// Small presentational primitives used across pages.
"use client";

import SpotlightCard from "@/components/reactbits/SpotlightCard";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { Sparkline } from "@/components/charts";
import { AnimatedNumber } from "@/components/fx";
import ChefMascot from "@/components/auth/ChefMascot";

export function Card({
  children,
  className = "",
  id,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** anchor for deep links — ⌘K one-click actions spotlight cards by id */
  id?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    /* THE BASE CARD IS PRESSED IN, like /staff and /purchasing.
     *
     * It carried `shadow-lg shadow-black/20` — an outer drop shadow, light
     * thrown ON it from above. Every page in the app is built from this
     * component, so while it was raised, every page I "converted" was a page
     * with inset cards sitting inside a raised one. That is the drift he kept
     * seeing and I kept fixing one page at a time.
     *
     * Same radius, same padding, same border: only where the light comes from
     * changes. A page that wants the old lift can still ask for it in
     * `className`. */
    <div
      id={id}
      className={`mise-card-inset rounded-2xl p-5 ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

const SPARK_TONES: Record<string, string> = {
  slate: "#94a3b8",
  brand: "#10b981",
  amber: "#f59e0b",
  rose: "#f43f5e",
  copper: "#eab78a",
};

/** A headline figure that rolls to its new value, keeping its formatting.
 *
 * Every page hands StatCard a string that has already been through the currency
 * formatter — "£3,848.96", "12 items", "6.5h". Rather than make thirty call
 * sites pass a raw number AND a formatter, this pulls the number back out,
 * animates it, and puts the original's prefix and suffix back around it. So one
 * change here gives every headline number in the app the same roll, and no page
 * had to be edited to get it.
 *
 * It deliberately does nothing to a value with no number in it ("—", "Off"),
 * and nothing when the digits are unchanged — a card that re-renders for an
 * unrelated reason should not replay its animation. `AnimatedNumber` already
 * honours prefers-reduced-motion.
 */
function StatValue({ value }: { value: ReactNode }) {
  if (typeof value !== "string" && typeof value !== "number") return <>{value}</>;
  const text = String(value);
  // prefix (currency, sign), the number itself, then whatever trails it.
  const m = text.match(/^([^\d-]*)(-?[\d,]*\.?\d+)(.*)$/);
  if (!m) return <>{text}</>;
  const [, prefix, digits, suffix] = m;
  const n = parseFloat(digits.replace(/,/g, ""));
  if (!Number.isFinite(n)) return <>{text}</>;

  // Match the ORIGINAL's shape: if it showed two decimals and thousands
  // separators, every frame of the count must too, or the number changes width
  // as it rolls and the whole row twitches.
  const dot = digits.indexOf(".");
  const decimals = dot < 0 ? 0 : digits.length - dot - 1;
  const grouped = digits.includes(",");
  const shape = (v: number) =>
    `${prefix}${v.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: grouped,
    })}${suffix}`;

  return <AnimatedNumber value={n} format={shape} from="previous" duration={520} />;
}

export function StatCard({
  label,
  value,
  hint,
  accent = "slate",
  href,
  delta,
  spark,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  accent?: "slate" | "brand" | "amber" | "rose" | "copper";
  /** Makes the whole card a shortcut (e.g. "Low stock" → inventory, filtered). */
  href?: string;
  /** e.g. { value: "↑ 12%", up: true } — tinted change chip next to the value */
  delta?: { value: string; up?: boolean };
  /** tiny trend line under the value (7–14 points) */
  spark?: number[];
}) {
  const accents: Record<string, string> = {
    slate: "text-fg",
    brand: "text-brand-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    copper: "text-copper-300",
  };
  // The cursor lights what it is over. A dashboard is scanned, not read, and a
  // soft follow-light helps the eye settle on the card it is already heading
  // for without anything shouting. Applied here rather than per-page so every
  // stat card behaves the same way.
  const body = (
    <SpotlightCard
      className="!h-full !rounded-2xl !border-0 !bg-transparent !p-0"
      spotlightColor="rgba(52, 211, 153, 0.12)"
    >
    <Card
      className={`mise-feel h-full hover:border-line-2 hover:bg-paper-2/90 ${
        href ? "group cursor-pointer hover:shadow-xl hover:shadow-black/30" : ""
      }`}
    >
      <p className="flex items-center justify-between text-xs font-medium uppercase tracking-wide text-fg-faint">
        {label}
        {href && (
          <span aria-hidden className="text-fg-faint opacity-0 transition group-hover:opacity-100">
            →
          </span>
        )}
      </p>
      <p className={`mt-2 flex items-baseline gap-2 text-2xl font-semibold ${accents[accent]}`}>
        <span className="font-mono tracking-tight">
          <StatValue value={value} />
        </span>
        {delta && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
              delta.up === false ? "bg-rose-400/15 text-rose-300" : "bg-brand-400/15 text-brand-300"
            }`}
          >
            {delta.value}
          </span>
        )}
      </p>
      {spark && spark.length > 1 && (
        <Sparkline data={spark} color={SPARK_TONES[accent]} height={30} className="mt-2 h-[30px]" />
      )}
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </Card>
    </SpotlightCard>
  );
  return href ? <Link href={href} className="block h-full">{body}</Link> : body;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  live = false,
  sticky = false,
}: {
  title: string;
  subtitle?: string;
  /** right-aligned slot for the page's primary actions */
  actions?: ReactNode;
  /** shows a pulsing "live" dot next to the title */
  live?: boolean;
  /** Keeps the header — and whatever is in `actions` — on screen while the page
   *  scrolls. For pages where one number stays relevant the whole way down
   *  (the till on Sales), so it is never something you scroll back up to find. */
  sticky?: boolean;
}) {
  return (
    <div
      className={`mb-6 flex flex-wrap items-end justify-between gap-3 ${
        sticky
          // The bleed MUST match AppShell's <main> padding exactly (px-4 lg:px-8).
            // A wider negative margin pushes the page sideways and the whole
            // body scrolls horizontally — on a phone, permanently.
            ? "sticky top-0 z-30 -mx-4 border-b border-line/60 bg-paper/85 px-4 py-3 backdrop-blur-md lg:-mx-8 lg:px-8"
          : ""
      }`}
    >
      <div>
        <h2 className="flex items-center gap-2.5 font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
          {title}
          {live && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-400/15 px-2 py-0.5 text-[10px] font-medium tracking-wide text-brand-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" /> LIVE
            </span>
          )}
        </h2>
        {subtitle && <p className="mt-1 text-sm text-fg-faint">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?: "slate" | "green" | "red" | "amber";
}) {
  // The colours live in CSS now (`.mise-chip`), mixed against the FOREGROUND so
  // they hold contrast in both themes. These were fixed pale shades on a 15%
  // tint: right on the dark theme, near-white on near-white in the light one.
  return (
    <span className="mise-chip" data-tone={tone === "slate" ? "slate" : tone}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-glass/15 border-t-brand-400" />
    </div>
  );
}

/* ── Tactile controls (soft-neumorphic hybrid; see UI_MODERNIZATION_PLAN) ── */

const BTN_VARIANTS: Record<string, string> = {
  primary:
    "mise-btn-shine bg-gradient-to-r from-brand-500 to-brand-400 font-semibold text-ink-950 shadow-lg shadow-brand-500/25 hover:shadow-xl hover:shadow-brand-400/30",
  soft: "mise-raised text-fg",
  ghost: "border border-line text-fg-soft hover:border-line-2 hover:text-fg",
  danger: "bg-rose-500/15 text-rose-300 border border-rose-400/30 hover:bg-rose-500/25",
};

/** The tactile button: raised at rest, presses IN, busy morphs to a spinner. */
export function Button({
  children,
  variant = "soft",
  busy = false,
  busyLabel,
  size = "md",
  className = "",
  type = "button",
  ...rest
}: {
  children: ReactNode;
  variant?: keyof typeof BTN_VARIANTS;
  busy?: boolean;
  busyLabel?: string;
  size?: "sm" | "md";
  className?: string;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={busy || rest.disabled}
      {...rest}
      className={`mise-press inline-flex items-center justify-center gap-2 rounded-xl text-sm transition disabled:opacity-60 ${
        size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-4 py-2.5"
      } ${BTN_VARIANTS[variant]} ${className}`}
    >
      {busy && (
        <span
          className={`mise-pop h-3.5 w-3.5 animate-spin rounded-full border-2 ${
            variant === "primary" ? "border-ink-950/25 border-t-ink-950" : "border-glass/20 border-t-brand-400"
          }`}
          aria-hidden
        />
      )}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

/** Segmented control: an inset well track with a raised thumb that GLIDES. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`mise-well relative inline-flex rounded-xl p-1 ${className}`} role="tablist">
      <span
        className="mise-raised mise-spring absolute inset-y-1 rounded-lg"
        style={{ width: `calc(${100 / options.length}% - 4px)`, left: `calc(${(100 / options.length) * idx}% + 2px)` }}
        aria-hidden
      />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 flex-1 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-300 ${
            o.value === value ? "text-fg" : "text-fg-faint hover:text-fg-soft"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Springy toggle — the knob overshoots slightly, like a real switch. */
export function Toggle({
  on,
  onChange,
  disabled = false,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`mise-well relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-300 disabled:opacity-50 ${
        on ? "!bg-brand-500/80" : ""
      }`}
    >
      <span
        className={`mise-raised mise-spring inline-block h-4.5 w-4.5 rounded-full !bg-white ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}

/** Shimmering placeholder block — compose into card/table-shaped loading states. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`mise-shimmer rounded-lg bg-glass/10 ${className}`} aria-hidden />;
}

/** A ready-made loading card: header line + rows. Use instead of a bare Spinner. */
export function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <Card>
      <Skeleton className="h-4 w-36" />
      <div className="mt-4 space-y-2.5">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-3.5" />
        ))}
      </div>
    </Card>
  );
}

/** Designed empty state — never show "No data" text alone. */
export function EmptyState({
  icon = "🍽️",
  title,
  body,
  action,
  chef = true,
}: {
  icon?: string;
  title: string;
  body?: string;
  action?: ReactNode;
  /** the shrugging maître fronts empty states by default */
  chef?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-2 px-6 py-14 text-center">
      {chef ? (
        <ChefMascot mood="shrug" className="w-24" />
      ) : (
        <span className="grid h-14 w-14 place-items-center rounded-2xl border border-line bg-paper-2 text-2xl shadow-inner">
          {icon}
        </span>
      )}
      <p className="mt-4 font-display text-lg font-semibold text-fg">{title}</p>
      {body && <p className="mt-1.5 max-w-sm text-sm text-fg-faint">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Slide-over panel: right sheet on desktop, bottom sheet on mobile. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="mise-fade-in absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={`mise-drawer-in absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl border border-line bg-paper shadow-2xl shadow-black/50 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:rounded-none sm:border-y-0 sm:border-r-0 sm:border-l ${
          wide ? "sm:w-[min(640px,92vw)]" : "sm:w-[min(480px,92vw)]"
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-paper/95 px-5 py-4 backdrop-blur">
          <div className="font-display text-lg font-semibold text-fg">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mise-press grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-faint transition hover:border-line-2 hover:text-fg"
          >
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
