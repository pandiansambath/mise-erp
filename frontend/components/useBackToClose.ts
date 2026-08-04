"use client";

import { useEffect, useRef } from "react";

/** Make the browser BACK button close an overlay instead of leaving the page.
 *
 * Without this, opening a modal and pressing back navigates away entirely —
 * which on the Vendors page meant clicking "Edit details" and then back threw
 * you off the page you were working on. Back is the natural "dismiss" gesture
 * on a phone, and it was doing something far more destructive.
 *
 * How it works: opening pushes one history entry that changes nothing visible.
 * Back pops that entry, we see popstate, and close. Closing by any other route
 * (the ✕, Escape, the backdrop) removes the entry we added, so the user is never
 * left with a phantom step that appears to do nothing.
 */
export function useBackToClose(open: boolean, onClose: () => void) {
  // Whether OUR entry is currently on the stack, so we never pop somebody
  // else's — going back twice as fast as React re-renders would otherwise
  // steal a real navigation.
  const pushed = useRef(false);
  // Kept in a ref so a changing onClose never re-runs the effect (which would
  // push a second history entry). Written in an effect, not during render:
  // React may render speculatively and throw the result away.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    window.history.pushState({ overlay: true }, "");
    pushed.current = true;

    const onPop = () => {
      // The entry is gone — the browser popped it, not us.
      pushed.current = false;
      close.current();
    };
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Closed some other way: take our entry back off, or the next Back press
      // would appear to do nothing at all.
      if (pushed.current) {
        pushed.current = false;
        window.history.back();
      }
    };
  }, [open]);
}
