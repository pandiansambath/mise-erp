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

    // A token unique to THIS overlay, so cleanup can tell its own history
    // entry from somebody else's.
    const id = `ov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    window.history.pushState({ overlay: id }, "");
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
      //
      // ⚠️ ONLY if the top of the stack is still OURS. One overlay opening
      // another — the vendor sheet's "Edit details" — closes the first while
      // the second has already pushed. A blind history.back() then popped the
      // NEW overlay's entry, whose popstate handler closed it immediately: the
      // edit form opened and vanished in the same frame, which looked exactly
      // like a dead button. If somebody else is on top, leave the stack alone.
      const top = (window.history.state as { overlay?: string } | null)?.overlay;
      if (pushed.current && top === id) {
        pushed.current = false;
        window.history.back();
      }
      pushed.current = false;
    };
  }, [open]);
}
