/**
 * Local calendar date as YYYY-MM-DD.
 *
 * Use this anywhere you need a *date* (a day on the calendar) for a query param,
 * a form default, or a "which day does this belong to" bucket.
 *
 * Do NOT use `new Date().toISOString().slice(0, 10)` for that — `toISOString()`
 * converts to UTC, so at local midnight in any timezone ahead of UTC (IST +5:30,
 * BST +1, …) it rolls back to the PREVIOUS day. That shifted whole weeks and made
 * "today" land on yesterday. This formats the local Y/M/D, so it's always the day
 * the user actually sees on their calendar.
 */
export function localISODate(d: Date = new Date()): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}
