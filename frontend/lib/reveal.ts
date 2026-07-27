/**
 * Bring a form into view AND put the cursor in it.
 *
 * The old behaviour scrolled a form to `block: "start"` and stopped there — so it
 * landed under the sticky header, the caret stayed wherever it was, and you'd type
 * into a field you couldn't see. This centres the form instead and focuses its first
 * real input, with `preventScroll` so focusing never yanks the page a second time.
 */
export function revealForm(
  el: HTMLElement | null | undefined,
  opts: { focus?: boolean; select?: boolean } = {},
): void {
  if (!el) return;
  const { focus = true, select = false } = opts;

  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (!focus) return;
    // wait for the smooth scroll to settle, then take the caret there
    window.setTimeout(() => {
      const first = el.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]):not([readonly]), textarea:not([disabled]), select:not([disabled])',
      );
      if (!first) return;
      first.focus({ preventScroll: true });
      if (select && first instanceof HTMLInputElement) first.select();
    }, 340);
  });
}
