// Small presentational primitives used across pages.
import Link from "next/link";
import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-line bg-paper/90 p-5 shadow-lg shadow-black/20 ${className}`}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  accent = "slate",
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: "slate" | "brand" | "amber" | "rose" | "copper";
  /** Makes the whole card a shortcut (e.g. "Low stock" → inventory, filtered). */
  href?: string;
}) {
  const accents: Record<string, string> = {
    slate: "text-fg",
    brand: "text-brand-400",
    amber: "text-amber-400",
    rose: "text-rose-400",
    copper: "text-copper-300",
  };
  const body = (
    <Card
      className={`transition duration-300 hover:border-line-2 hover:bg-paper-2/90 ${
        href ? "group cursor-pointer hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30" : ""
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
      <p className={`mt-2 text-2xl font-semibold ${accents[accent]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-fg-faint">{hint}</p>}
    </Card>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h2 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">
        {title}
      </h2>
      {subtitle && <p className="mt-1 text-sm text-fg-faint">{subtitle}</p>}
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
  const tones: Record<string, string> = {
    slate: "bg-glass/10 text-fg-soft",
    green: "bg-brand-400/15 text-brand-300",
    red: "bg-rose-400/15 text-rose-300",
    amber: "bg-amber-400/15 text-amber-200",
  };
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
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
