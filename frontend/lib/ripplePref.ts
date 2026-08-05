"use client";

// Whether the touch ripple runs, per restaurant.
//
// He asked for the water effect on his own page and I put it everywhere, then
// he said: fine, but give each hotel a switch. So this is keyed by hotel id —
// two restaurants on the same browser (an operator, a group owner) get their
// own answer, and turning it off for one does not turn it off for the other.
//
// Kept on the device rather than in the database on purpose. It is a comfort
// setting about motion, like reducing animations, and those belong to the
// person looking at the screen — not to a row that would impose one operator's
// preference on every member of staff.
//
// The developer page has no switch: it is his, and the effect is the point.

const KEY = "mise.ripple.off.";

export function rippleEnabled(hotelId: string | null | undefined): boolean {
  if (typeof window === "undefined") return true;
  if (!hotelId) return true;
  try {
    return localStorage.getItem(KEY + hotelId) !== "1";
  } catch {
    return true; // private mode — on is the default
  }
}

export function setRippleEnabled(hotelId: string, on: boolean): void {
  try {
    if (on) localStorage.removeItem(KEY + hotelId);
    else localStorage.setItem(KEY + hotelId, "1");
    // The Ripple layer is mounted at the root and has no idea a settings page
    // exists, so tell it rather than making it poll.
    window.dispatchEvent(new CustomEvent("mise:ripple-pref"));
  } catch {
    /* nothing to do */
  }
}
