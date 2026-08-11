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
/**
 * The RESTAURANT's timezone, not the laptop's.
 *
 * He caught this at 02:30 in India, which is 21:00 the previous day in London:
 *
 *   "now im using indian laptop time... but the site london time. Now I
 *    purchased 1 item and came to expense and nothing is there. Then I went to
 *    yesterday, here we can see the expense of that purchase. Super fishy bug...
 *    what laptop we using, what region we are, is not important — app needs to
 *    follow the app setting time which is UK."
 *
 * Exactly right. The server stamps a purchase with the hotel's calendar day, so
 * a "today" computed from the browser's clock asks for a different day and
 * finds nothing. Anyone travelling, or any kitchen with staff abroad, hits it.
 *
 * Set once when the hotel loads; every page that asks for "today" follows.
 */
let appZone: string | null = null;

export function setAppTimeZone(tz?: string | null): void {
  appZone = tz && tz.trim() ? tz.trim() : null;
}

export function getAppTimeZone(): string | null {
  return appZone;
}

export function localISODate(d: Date = new Date()): string {
  if (appZone) {
    try {
      // en-CA formats as YYYY-MM-DD, which is what every date param wants.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: appZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(d);
    } catch {
      // An unknown zone must not break every date on the page.
    }
  }
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}
