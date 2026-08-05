"use client";

/** Remember the date range a user picked, for as long as they are working.
 *
 * Choosing "relative · 2 days" on Expenses, walking to another page and coming
 * back reset it to the default. That is the app forgetting something you told it
 * ten seconds ago, and it makes a filter feel broken rather than helpful.
 *
 * sessionStorage, deliberately, NOT localStorage:
 *   • it dies with the tab, so tomorrow starts fresh
 *   • today's numbers are the ones that matter, and a range remembered from last
 *     week showing £0 looks like lost data
 *   • it is also cleared on sign-out, so a shared terminal never hands your view
 *     to the next person
 *
 * Per PAGE, not global: "this month" is right for a P&L and wrong for a till.
 */

import type { Range } from "@/components/RangeControls";

const KEY = "mise.range.";

/** Sensible starting point for each page, used until the user chooses.
 *  Sales is a single day because a till is counted daily; reports default to the
 *  month because a P&L for one day answers nothing. */
export type RangeScope =
  | "expenses"
  | "reports"
  | "attendance"
  | "sales"
  | "waste"
  | "audit";

export function remember(scope: RangeScope, range: Range): void {
  try {
    sessionStorage.setItem(KEY + scope, JSON.stringify(range));
  } catch {
    // Private mode or a full quota — forgetting is survivable, crashing is not.
  }
}

export function recall(scope: RangeScope): Range | null {
  try {
    const raw = sessionStorage.getItem(KEY + scope);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Range;
    // Guard the shape: a half-written or hand-edited value must not take a page
    // down on load.
    if (typeof parsed?.from === "string" && typeof parsed?.to === "string") {
      return parsed;
    }
  } catch {
    /* fall through to the default */
  }
  return null;
}

/** Wipe every remembered range. Called on sign-out. */
export function forgetAll(): void {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith(KEY))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* nothing to do */
  }
}
