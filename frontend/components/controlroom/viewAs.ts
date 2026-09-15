// "View as" — open a hotel's own app on a short-lived, read-only token.
// Moved out of the old page.tsx's JSX so every hotel tab (Vitals, Activity,
// AI, Settings) can offer it from the same action bar without repeating the
// origin-switching logic.

import { api, ApiError } from "@/lib/api";

/** How long a "View as" key lasts, read by both this and SupportWindowPicker
 *  (components/DeletedHotels.tsx) — same localStorage key, one control. */
const MINUTES_KEY = "mise.imp.minutes";

export async function openSupportView(hotelId: string): Promise<void> {
  const mins = Number(localStorage.getItem(MINUTES_KEY) || 15);
  const r = await api.post<{ token: string }>(
    `/platform/hotels/${hotelId}/impersonate?minutes=${Number.isFinite(mins) ? mins : 15}`,
    {},
  );

  // Open the HOTEL's app, on the apex — belt and braces. The session is
  // already tab-scoped (sessionStorage), which alone stops the two logins
  // colliding, but the support view is the restaurant's app: serving it from
  // controlroom.dineai.cloud would put the operator's Control Room and a
  // hotel's dashboard on one origin and one storage area for no reason.
  const host = window.location.hostname;
  const apex = host.split(".").slice(-2).join(".");
  const base =
    host === "localhost" || /^\d+(\.\d+){3}$/.test(host)
      ? window.location.origin
      : `${window.location.protocol}//${apex}`;
  const win = window.open(`${base}/impersonate#t=${encodeURIComponent(r.token)}`, "_blank", "noopener");
  // The await above already broke the click's user-activation chain, so a
  // blocked popup is the common case here, not the rare one. window.open
  // returns null rather than throwing — surface it through the same
  // ApiError path the caller (hotels/[hotelId]/layout.tsx's viewAsErr) already
  // renders, instead of the button just flickering back to "View as".
  if (!win) {
    throw new ApiError(
      0,
      "Your browser blocked the support window — allow pop-ups for this site and try again.",
    );
  }
}
